/** Space chat ↔ GAIA room bridge. All endpoints and timing are configurable. */
export type Mapping = { spaceChannelId: string; roomId: string };
export type Config = {
  mappings: Mapping[];
  space: { baseUrl: string; username?: string; password?: string; sessionCookie?: string; pollIntervalMs: number; requestTimeoutMs: number };
  gaia: { baseUrl: string; workspaceId: string; replyTimeoutMs: number; pollIntervalMs: number; requestTimeoutMs: number };
};
export type SpaceMessage = { id: string; channel_id: string; author_id: string | null; text: string; created_at: number; thread_of: string | null; archived: boolean };
export type GaiaEvent = { id: string; author: string; text: string };

const defaults: Omit<Config, "mappings"> = {
  space: { baseUrl: "http://127.0.0.1:8090", pollIntervalMs: 1_000, requestTimeoutMs: 15_000 },
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
  if (!Array.isArray(input.mappings)) throw new Error("config mappings must be an array");
  const mappings = input.mappings.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`config mappings[${index}] must be an object`);
    const mapping = item as Record<string, unknown>;
    return { spaceChannelId: requiredString(mapping.spaceChannelId, `mappings[${index}].spaceChannelId`), roomId: requiredString(mapping.roomId, `mappings[${index}].roomId`) };
  });
  const spaceInput = (input.space ?? {}) as Record<string, unknown>;
  const gaiaInput = (input.gaia ?? {}) as Record<string, unknown>;
  const space = {
    baseUrl: typeof spaceInput.baseUrl === "string" ? requiredString(spaceInput.baseUrl, "space.baseUrl") : defaults.space.baseUrl,
    username: typeof spaceInput.username === "string" ? requiredString(spaceInput.username, "space.username") : undefined,
    password: typeof spaceInput.password === "string" ? requiredString(spaceInput.password, "space.password") : undefined,
    sessionCookie: typeof spaceInput.sessionCookie === "string" ? requiredString(spaceInput.sessionCookie, "space.sessionCookie") : undefined,
    pollIntervalMs: positive(spaceInput.pollIntervalMs, "space.pollIntervalMs", defaults.space.pollIntervalMs),
    requestTimeoutMs: positive(spaceInput.requestTimeoutMs, "space.requestTimeoutMs", defaults.space.requestTimeoutMs),
  };
  if (!space.sessionCookie && (!space.username || !space.password)) throw new Error("config space requires sessionCookie or username and password");
  return { mappings, space, gaia: {
    baseUrl: typeof gaiaInput.baseUrl === "string" ? requiredString(gaiaInput.baseUrl, "gaia.baseUrl") : defaults.gaia.baseUrl,
    workspaceId: requiredString(gaiaInput.workspaceId, "gaia.workspaceId"),
    replyTimeoutMs: positive(gaiaInput.replyTimeoutMs, "gaia.replyTimeoutMs", defaults.gaia.replyTimeoutMs),
    pollIntervalMs: positive(gaiaInput.pollIntervalMs, "gaia.pollIntervalMs", defaults.gaia.pollIntervalMs),
    requestTimeoutMs: positive(gaiaInput.requestTimeoutMs, "gaia.requestTimeoutMs", defaults.gaia.requestTimeoutMs),
  }};
}
export async function loadConfig(path: string): Promise<Config> { return parseConfig(JSON.parse(await Bun.file(path).text())); }

export interface SpaceTransport { bridgeAuthorId(): Promise<string>; listMessages(channelId: string): Promise<SpaceMessage[]>; postMessage(channelId: string, text: string): Promise<void>; }
export interface GaiaTransport { events(roomId: string): Promise<GaiaEvent[]>; send(roomId: string, text: string): Promise<void>; }
export const inboundText = (message: SpaceMessage) => `Space message from ${message.author_id ?? "unknown"}: ${message.text}`;
export const isForwardable = (message: SpaceMessage, bridgeAuthorId: string, seen: ReadonlySet<string>) => !message.archived && !message.thread_of && !!message.text.trim() && message.author_id !== bridgeAuthorId && !seen.has(message.id);
export const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export class RoomLink {
  private readonly seen = new Set<string>();
  private primed = false;
  constructor(private readonly mappings: Mapping[], private readonly space: SpaceTransport, private readonly gaia: GaiaTransport, private readonly replyTimeoutMs: number, private readonly replyPollIntervalMs: number) {}
  async pollOnce(): Promise<number> {
    const bridgeAuthorId = await this.space.bridgeAuthorId();
    let forwarded = 0;
    for (const mapping of this.mappings) {
      const messages = await this.space.listMessages(mapping.spaceChannelId);
      if (!this.primed) { for (const message of messages) this.seen.add(message.id); continue; }
      for (const message of messages.filter(item => isForwardable(item, bridgeAuthorId, this.seen))) {
        const before = new Set((await this.gaia.events(mapping.roomId)).map(event => event.id));
        await this.gaia.send(mapping.roomId, inboundText(message));
        const reply = await this.waitForReply(mapping.roomId, before);
        await this.space.postMessage(mapping.spaceChannelId, reply.text);
        this.seen.add(message.id);
        forwarded++;
      }
    }
    this.primed = true;
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
  constructor(private readonly config: Config["space"]) { this.cookie = config.sessionCookie; }
  private async authenticated(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.cookie) await this.login();
    return request(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { "content-type": "application/json", cookie: this.cookie!, ...(init.headers ?? {}) } }, this.config.requestTimeoutMs);
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
  async postMessage(channelId: string, text: string): Promise<void> {
    await this.authenticated("/api/cmd/create_message", { method: "POST", body: JSON.stringify({ message: { id: `bridge-${crypto.randomUUID()}`, channel_id: channelId, author_id: null, text, created_at: Math.floor(Date.now() / 1000), edited_at: null, thread_of: null, archived: false } }) });
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
  const config = await loadConfig(path);
  const link = new RoomLink(config.mappings, new HttpSpaceTransport(config.space), new HttpGaiaTransport(config.gaia), config.gaia.replyTimeoutMs, config.gaia.pollIntervalMs);
  console.log(`room-link started: ${config.mappings.length} mapping(s)`);
  for (;;) { try { await link.pollOnce(); } catch (error) { console.error("room-link poll failed:", error); } await sleep(config.space.pollIntervalMs); }
}
