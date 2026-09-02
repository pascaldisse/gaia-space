/** Space chat ↔ GAIA room bridge. All endpoints and timing are configurable.
 *  Two modes: `mappings` (an explicit routing table) and `whole-space` (every discovered
 *  Space channel gets its own GAIA room, plus a hub room — see whole-space.ts). */
import { channelDiscoveryOn, createWholeSpace, digestDue, digestText, FileMappingStore, HttpGaiaProvisioning, mappingsOf, parseWholeSpace, type WholeSpaceConfig } from "./whole-space.ts";
import { authorOriginGuard, FileLedgerStore, OwnAccountGuard, type OriginGuard } from "./own-account.ts";

export type Mapping = { spaceChannelId: string; roomId: string };
export type Config = {
  mode: "mappings" | "whole-space";
  wholeSpace?: WholeSpaceConfig;
  mappings: Mapping[];
  space: {
    baseUrl: string; personalAccessToken?: string; username?: string; password?: string; sessionCookie?: string; pollIntervalMs: number; requestTimeoutMs: number;
    /** Opt-in: the credential belongs to a human, so suppress by message origin, not by author. */
    ownAccountMode: boolean;
    outboundIdPrefix: string;
    outboundLedgerPath: string;
    outboundLedgerLimit: number;
  };
  gaia: { baseUrl: string; workspaceId: string; replyTimeoutMs: number; pollIntervalMs: number; requestTimeoutMs: number };
};
export type SpaceMessage = { id: string; channel_id: string; author_id: string | null; text: string; created_at: number; thread_of: string | null; archived: boolean };
export type GaiaEvent = { id: string; author: string; text: string };

const defaults: Omit<Config, "mappings" | "mode" | "wholeSpace"> = {
  space: { baseUrl: "http://127.0.0.1:8090", pollIntervalMs: 1_000, requestTimeoutMs: 15_000, ownAccountMode: false, outboundIdPrefix: "bridge-", outboundLedgerPath: "bridge/room-link/state/outbound-ids.json", outboundLedgerLimit: 5_000 },
  gaia: { baseUrl: "http://127.0.0.1:8787", workspaceId: "", replyTimeoutMs: 120_000, pollIntervalMs: 1_000, requestTimeoutMs: 15_000 },
};
const requiredString = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`config ${name} must be a non-empty string`);
  return value.trim();
};
const positive = (value: unknown, name: string, fallback: number) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`config ${name} must be positive`);
  return number;
};
export function parseConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") throw new Error("config must be an object");
  const input = raw as Record<string, unknown>;
  const wholeSpace = parseWholeSpace(input.wholeSpace);
  const mode = input.mode === undefined ? (wholeSpace ? "whole-space" : "mappings") : input.mode;
  if (mode !== "mappings" && mode !== "whole-space") throw new Error('config mode must be "mappings" or "whole-space"');
  if (mode === "whole-space" && !wholeSpace) throw new Error("config wholeSpace is required in whole-space mode");
  // In whole-space mode the routing table is derived and persisted, so `mappings` is optional.
  if (!Array.isArray(input.mappings) && mode === "mappings") throw new Error("config mappings must be an array");
  const mappings = (Array.isArray(input.mappings) ? input.mappings : []).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`config mappings[${index}] must be an object`);
    const mapping = item as Record<string, unknown>;
    return { spaceChannelId: requiredString(mapping.spaceChannelId, `mappings[${index}].spaceChannelId`), roomId: requiredString(mapping.roomId, `mappings[${index}].roomId`) };
  });
  const spaceInput = (input.space ?? {}) as Record<string, unknown>;
  const gaiaInput = (input.gaia ?? {}) as Record<string, unknown>;
  const space = {
    baseUrl: typeof spaceInput.baseUrl === "string" ? requiredString(spaceInput.baseUrl, "space.baseUrl") : defaults.space.baseUrl,
    // Preferred credential: a Space personal access token. Sent as `Authorization: Bearer`,
    // so no password is ever transmitted and no session cookie is minted or stored.
    personalAccessToken: typeof spaceInput.personalAccessToken === "string" ? requiredString(spaceInput.personalAccessToken, "space.personalAccessToken") : undefined,
    username: typeof spaceInput.username === "string" ? requiredString(spaceInput.username, "space.username") : undefined,
    password: typeof spaceInput.password === "string" ? requiredString(spaceInput.password, "space.password") : undefined,
    sessionCookie: typeof spaceInput.sessionCookie === "string" ? requiredString(spaceInput.sessionCookie, "space.sessionCookie") : undefined,
    pollIntervalMs: positive(spaceInput.pollIntervalMs, "space.pollIntervalMs", defaults.space.pollIntervalMs),
    requestTimeoutMs: positive(spaceInput.requestTimeoutMs, "space.requestTimeoutMs", defaults.space.requestTimeoutMs),
    ownAccountMode: spaceInput.ownAccountMode === undefined ? defaults.space.ownAccountMode : spaceInput.ownAccountMode === true,
    outboundIdPrefix: spaceInput.outboundIdPrefix === undefined ? defaults.space.outboundIdPrefix : requiredString(spaceInput.outboundIdPrefix, "space.outboundIdPrefix"),
    outboundLedgerPath: spaceInput.outboundLedgerPath === undefined ? defaults.space.outboundLedgerPath : requiredString(spaceInput.outboundLedgerPath, "space.outboundLedgerPath"),
    outboundLedgerLimit: positive(spaceInput.outboundLedgerLimit, "space.outboundLedgerLimit", defaults.space.outboundLedgerLimit),
  };
  if (!space.personalAccessToken && !space.sessionCookie && (!space.username || !space.password)) throw new Error("config space requires personalAccessToken or sessionCookie or username and password");
  // Own-account mode leans on the id prefix as its stateless second guard, so it must be usable.
  if (space.ownAccountMode && !/^[A-Za-z0-9._-]+$/.test(space.outboundIdPrefix)) throw new Error("config space.outboundIdPrefix must be non-empty and may only contain letters, numbers, dots, underscores, hyphens");
  return { mode, wholeSpace, mappings, space, gaia: {
    baseUrl: typeof gaiaInput.baseUrl === "string" ? requiredString(gaiaInput.baseUrl, "gaia.baseUrl") : defaults.gaia.baseUrl,
    workspaceId: requiredString(gaiaInput.workspaceId, "gaia.workspaceId"),
    replyTimeoutMs: positive(gaiaInput.replyTimeoutMs, "gaia.replyTimeoutMs", defaults.gaia.replyTimeoutMs),
    pollIntervalMs: positive(gaiaInput.pollIntervalMs, "gaia.pollIntervalMs", defaults.gaia.pollIntervalMs),
    requestTimeoutMs: positive(gaiaInput.requestTimeoutMs, "gaia.requestTimeoutMs", defaults.gaia.requestTimeoutMs),
  }};
}
export async function loadConfig(path: string): Promise<Config> { return parseConfig(JSON.parse(await Bun.file(path).text())); }

/** `postMessage` returns the id the Space server stored — `create_message` answers with the whole
 *  message view, and the id is the one the client sent (only `author_id` is rebound server-side). */
export interface SpaceTransport { bridgeAuthorId(): Promise<string>; listMessages(channelId: string): Promise<SpaceMessage[]>; postMessage(channelId: string, text: string, messageId?: string): Promise<string>; }
export interface GaiaTransport { events(roomId: string): Promise<GaiaEvent[]>; send(roomId: string, text: string): Promise<void>; }
export const inboundText = (message: SpaceMessage) => `Space message from ${message.author_id ?? "unknown"}: ${message.text}`;
/** Channel content only — never a thread reply, never archived, never blank, never seen, and never
 *  a message this bridge itself originated (what "own" means is the guard's decision). */
export const isForwardable = (message: SpaceMessage, ownOrigin: (message: SpaceMessage) => boolean, seen: ReadonlySet<string>) =>
  !message.archived && !message.thread_of && !!message.text.trim() && !ownOrigin(message) && !seen.has(message.id);
export const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export class RoomLink {
  private readonly seen = new Set<string>();
  // Priming is PER CHANNEL: a channel linked later (whole-space discovery) primes its own
  // history instead of replaying it, and already-linked channels keep forwarding uninterrupted.
  private readonly primed = new Set<string>();
  constructor(private mappings: Mapping[], private readonly space: SpaceTransport, private readonly gaia: GaiaTransport, private readonly replyTimeoutMs: number, private readonly replyPollIntervalMs: number, private readonly origin: OriginGuard = authorOriginGuard()) {}
  /** Replace the routing table in place, keeping seen/primed state (used after re-discovery). */
  setMappings(mappings: Mapping[]): void { this.mappings = mappings; }
  async pollOnce(): Promise<number> {
    const bridgeAuthorId = await this.space.bridgeAuthorId();
    let forwarded = 0;
    for (const mapping of this.mappings) {
      const messages = await this.space.listMessages(mapping.spaceChannelId);
      if (!this.primed.has(mapping.spaceChannelId)) { for (const message of messages) this.seen.add(message.id); this.primed.add(mapping.spaceChannelId); continue; }
      for (const message of messages.filter(item => isForwardable(item, candidate => this.origin.isOwnOrigin(candidate, bridgeAuthorId), this.seen))) {
        const before = new Set((await this.gaia.events(mapping.roomId)).map(event => event.id));
        await this.gaia.send(mapping.roomId, inboundText(message));
        const reply = await this.waitForReply(mapping.roomId, before);
        // Claim (and durably record) the outbound id BEFORE posting: a crash in between can only
        // suppress a message that was never written, never replay one that was.
        const claimed = await this.origin.claim();
        await this.origin.confirm(await this.space.postMessage(mapping.spaceChannelId, reply.text, claimed));
        this.seen.add(message.id);
        forwarded++;
      }
    }
    return forwarded;
  }
  private async waitForReply(roomId: string, before: ReadonlySet<string>): Promise<GaiaEvent> {
    const deadline = Date.now() + this.replyTimeoutMs;
    while (Date.now() < deadline) {
      const reply = (await this.gaia.events(roomId)).find(event => !before.has(event.id) && event.author !== "user" && event.text.trim());
      if (reply) return reply;
      await sleep(this.replyPollIntervalMs);
    }
    throw new Error(`GAIA reply timeout for room ${roomId}`);
  }
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: HTTP ${response.status} ${await response.text()}`);
  return response;
}
export class HttpSpaceTransport implements SpaceTransport {
  private cookie: string | undefined;
  private authorId: string | undefined;
  /** Token auth wins over cookie/password: when a personal access token is configured the
   *  bridge never logs in, so no password leaves this process and no session is created. */
  private readonly token: string | undefined;
  constructor(private readonly config: Config["space"]) { this.token = config.personalAccessToken; this.cookie = this.token ? undefined : config.sessionCookie; }
  /** Public JSON command helper so discovery (whole-space.ts) reuses this session, never a second login. */
  async authenticatedJson(path: string, body: unknown): Promise<unknown> {
    return (await this.authenticated(path, { method: "POST", body: JSON.stringify(body) })).json();
  }
  private async authenticated(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token && !this.cookie) await this.login();
    const credential = this.token ? { authorization: `Bearer ${this.token}` } : { cookie: this.cookie! };
    return request(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { "content-type": "application/json", ...credential, ...(init.headers ?? {}) } }, this.config.requestTimeoutMs);
  }
  private async login(): Promise<void> {
    const response = await request(`${this.config.baseUrl.replace(/\/$/, "")}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: this.config.username, password: this.config.password }) }, this.config.requestTimeoutMs);
    const cookie = response.headers.get("set-cookie");
    if (!cookie) throw new Error("Space login did not return a session cookie");
    this.cookie = cookie.split(";", 1)[0];
  }
  async bridgeAuthorId(): Promise<string> {
    if (!this.authorId) {
      const payload = await (await this.authenticated("/api/auth/me")).json() as { user?: { profile_id?: string } };
      this.authorId = requiredString(payload.user?.profile_id, "Space session profile_id");
    }
    return this.authorId;
  }
  async listMessages(channelId: string): Promise<SpaceMessage[]> {
    const payload = await (await this.authenticated("/api/cmd/list_messages", { method: "POST", body: JSON.stringify({ channel_id: channelId }) })).json() as { value?: SpaceMessage[] };
    if (!Array.isArray(payload.value)) throw new Error("Space list_messages returned malformed response");
    return payload.value;
  }
  async postMessage(channelId: string, text: string, messageId?: string): Promise<string> {
    const id = messageId ?? `bridge-${crypto.randomUUID()}`;
    const response = await this.authenticated("/api/cmd/create_message", { method: "POST", body: JSON.stringify({ message: { id, channel_id: channelId, author_id: null, text, created_at: Math.floor(Date.now() / 1000), edited_at: null, thread_of: null, archived: false } }) });
    const payload = await response.json().catch(() => ({})) as { value?: { id?: string } };
    return typeof payload.value?.id === "string" && payload.value.id ? payload.value.id : id;
  }
}
export class HttpGaiaTransport implements GaiaTransport {
  constructor(private readonly config: Config["gaia"]) {}
  private url(roomId: string, suffix: string) { return `${this.config.baseUrl.replace(/\/$/, "")}/api/workspaces/${encodeURIComponent(this.config.workspaceId)}/rooms/${encodeURIComponent(roomId)}${suffix}`; }
  async events(roomId: string): Promise<GaiaEvent[]> {
    const payload = await (await request(this.url(roomId, "/events?limit=200"), {}, this.config.requestTimeoutMs)).json() as { events?: GaiaEvent[] };
    if (!Array.isArray(payload.events)) throw new Error("GAIA events returned malformed response");
    return payload.events;
  }
  async send(roomId: string, text: string): Promise<void> { await request(this.url(roomId, "/messages"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }, this.config.requestTimeoutMs); }
}

if (import.meta.main) {
  const path = Bun.argv[2] ?? "config.json";
  const provisionOnly = Bun.argv.includes("--provision-only");
  const config = await loadConfig(path);
  const space = new HttpSpaceTransport(config.space);
  const gaiaTransport = new HttpGaiaTransport(config.gaia);
  // Default: a dedicated bridge account, suppression by author (unchanged). Own-account mode:
  // a human's credential, suppression by the durable ledger of ids this bridge posted.
  const origin = config.space.ownAccountMode
    ? await OwnAccountGuard.open(new FileLedgerStore(config.space.outboundLedgerPath), config.space.outboundLedgerLimit, config.space.outboundIdPrefix)
    : authorOriginGuard();
  if (config.space.ownAccountMode) console.log(`own-account mode: forwarding the token owner's manual messages; suppressing ids from ${config.space.outboundLedgerPath} and prefix "${config.space.outboundIdPrefix}"`);

  if (config.mode === "mappings") {
    const link = new RoomLink(config.mappings, space, gaiaTransport, config.gaia.replyTimeoutMs, config.gaia.pollIntervalMs, origin);
    console.log(`room-link started: ${config.mappings.length} mapping(s)`);
    for (;;) { try { await link.pollOnce(); } catch (error) { console.error("room-link poll failed:", error); } await sleep(config.space.pollIntervalMs); }
  }

  const wholeSpace = config.wholeSpace!;
  const gaia = new HttpGaiaProvisioning(config.gaia, gaiaTransport);
  const runner = createWholeSpace(channelDiscoveryOn(space), gaia, new FileMappingStore(wholeSpace.mappingStatePath), wholeSpace);
  let result = await runner.provision();
  console.log(`whole-space started: hub ${wholeSpace.hubRoomId}; linked ${result.created.length + result.existing.length} channel(s) (${result.created.length} new, ${result.skipped.length} filtered out)`);
  if (provisionOnly) { console.log(JSON.stringify(await runner.store.load(), null, 2)); process.exit(0); }

  const link = new RoomLink(mappingsOf(await runner.store.load()), space, gaiaTransport, config.gaia.replyTimeoutMs, config.gaia.pollIntervalMs, origin);
  let lastDiscovery = Date.now(), lastDigest = 0;
  for (;;) {
    try {
      const now = Date.now();
      if (now - lastDiscovery >= wholeSpace.discoveryIntervalMs) {
        lastDiscovery = now;
        const next = await runner.provision();
        if (next.created.length) link.setMappings(mappingsOf(await runner.store.load()));
        result = next;
      }
      if (wholeSpace.hub.digestEnabled && digestDue(lastDigest, now, wholeSpace.hub.digestIntervalMs)) {
        lastDigest = now;
        await gaia.send(wholeSpace.hubRoomId, digestText(result, wholeSpace.hubRoomId));
      }
      await runner.hub.pollOnce();
      await link.pollOnce();
    } catch (error) { console.error("whole-space poll failed:", error); }
    await sleep(config.space.pollIntervalMs);
  }
}
