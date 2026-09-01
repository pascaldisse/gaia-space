/** Whole-space mode: every visible Space channel gets its OWN GAIA room, plus one hub room.
 *  Nothing is hardcoded — channels are discovered, room ids are derived deterministically,
 *  and the derived table is persisted so a channel rename never re-provisions a second room.
 *  Only GAIA/Space routes that exist are used (see README "Verified capabilities"). */
import type { Config, GaiaEvent, GaiaTransport, SpaceMessage, SpaceTransport } from "./src.ts";

export type SpaceChannel = { id: string; name: string | null; archived: boolean; project_id: string | null; content_type?: string; unread_count?: number; last_message_at?: number | null };
export type ChannelFilter = { includeArchived: boolean; includeChannelIds: string[]; excludeChannelIds: string[]; projectIds: string[]; contentTypes: string[] };
export type WholeSpaceConfig = {
  hubRoomId: string;
  roomIdPrefix: string;
  roomTitlePrefix: string;
  mappingStatePath: string;
  discoveryIntervalMs: number;
  filter: ChannelFilter;
  hub: { digestEnabled: boolean; digestIntervalMs: number; commandsEnabled: boolean; commandPrefix: string };
};
export type MappingRecord = { channelId: string; roomId: string; channelName: string | null; provisionedAt: string };
export type MappingState = { version: 1; rooms: Record<string, MappingRecord> };

export const emptyMappingState = (): MappingState => ({ version: 1, rooms: {} });

/* ---------- config ---------- */

const bool = (value: unknown, fallback: boolean) => (value === undefined ? fallback : value === true);
const stringList = (value: unknown, name: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`config ${name} must be an array of strings`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`config ${name}[${index}] must be a non-empty string`);
    return item.trim();
  });
};
const positive = (value: unknown, name: string, fallback: number) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`config ${name} must be positive`);
  return number;
};
const text = (value: unknown, name: string, fallback: string) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`config ${name} must be a string`);
  return value;
};

/** Parse the `wholeSpace` block. Returns undefined when the config stays in static-mapping mode. */
export function parseWholeSpace(raw: unknown): WholeSpaceConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new Error("config wholeSpace must be an object");
  const input = raw as Record<string, unknown>;
  const hubRoomId = text(input.hubRoomId, "wholeSpace.hubRoomId", "").trim();
  if (!hubRoomId) throw new Error("config wholeSpace.hubRoomId must be a non-empty string");
  if (!isValidRoomId(hubRoomId)) throw new Error("config wholeSpace.hubRoomId is not a valid GAIA room id");
  const filterInput = (input.filter ?? {}) as Record<string, unknown>;
  const hubInput = (input.hub ?? {}) as Record<string, unknown>;
  const prefix = text(input.roomIdPrefix, "wholeSpace.roomIdPrefix", "space-");
  if (prefix && !/^[A-Za-z0-9._-]*$/.test(prefix)) throw new Error("config wholeSpace.roomIdPrefix may only contain letters, numbers, dots, underscores, hyphens");
  return {
    hubRoomId,
    roomIdPrefix: prefix,
    roomTitlePrefix: text(input.roomTitlePrefix, "wholeSpace.roomTitlePrefix", "#"),
    mappingStatePath: text(input.mappingStatePath, "wholeSpace.mappingStatePath", "bridge/room-link/state/whole-space-map.json"),
    discoveryIntervalMs: positive(input.discoveryIntervalMs, "wholeSpace.discoveryIntervalMs", 60_000),
    filter: {
      includeArchived: bool(filterInput.includeArchived, false),
      includeChannelIds: stringList(filterInput.includeChannelIds, "wholeSpace.filter.includeChannelIds"),
      excludeChannelIds: stringList(filterInput.excludeChannelIds, "wholeSpace.filter.excludeChannelIds"),
      projectIds: stringList(filterInput.projectIds, "wholeSpace.filter.projectIds"),
      contentTypes: stringList(filterInput.contentTypes, "wholeSpace.filter.contentTypes"),
    },
    hub: {
      digestEnabled: bool(hubInput.digestEnabled, false),
      digestIntervalMs: positive(hubInput.digestIntervalMs, "wholeSpace.hub.digestIntervalMs", 900_000),
      commandsEnabled: bool(hubInput.commandsEnabled, false),
      commandPrefix: text(hubInput.commandPrefix, "wholeSpace.hub.commandPrefix", "!bridge").trim() || "!bridge",
    },
  };
}

/* ---------- deterministic room ids ---------- */

/** GAIA's own rule (daemon domain/workspace.ts `isValidRoomId`): 1-64 of [A-Za-z0-9._-], no slashes. */
export const isValidRoomId = (roomId: string) => /^[A-Za-z0-9._-]{1,64}$/.test(roomId);

export const slug = (value: string) =>
  value.replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);

/** Stable 8-hex digest of the channel id: the identity anchor, so renaming a channel
 *  changes only the readable half and the room keeps resolving to the same channel. */
export function channelDigest(channelId: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let index = 0; index < channelId.length; index++) {
    const code = channelId.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 8);
}

/** `<prefix><slug(name)>-<digest(channelId)>`, clamped to GAIA's 64-char room id limit. */
export function deriveRoomId(channel: SpaceChannel, prefix: string): string {
  const readable = slug(channel.name ?? "") || "channel";
  const digest = channelDigest(channel.id);
  const roomId = `${prefix}${readable}-${digest}`.slice(0, 64).replace(/-+$/, "");
  if (!isValidRoomId(roomId)) throw new Error(`derived room id is invalid: ${roomId}`);
  return roomId;
}

/** Collision guard: two channels whose slug+digest collide (or a room id already taken by
 *  something else) get a numeric suffix instead of silently sharing one room. */
export function uniqueRoomId(candidate: string, taken: ReadonlySet<string>): string {
  if (!taken.has(candidate)) return candidate;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const next = `${candidate.slice(0, 60)}-${suffix}`;
    if (!taken.has(next)) return next;
  }
  throw new Error(`cannot derive a free room id for ${candidate}`);
}

export const isBridgeableChannel = (channel: SpaceChannel, filter: ChannelFilter) => {
  if (channel.id.startsWith("thread:")) return false; // threads are opened from their root, never bridged as peers
  if (channel.archived && !filter.includeArchived) return false;
  if (filter.excludeChannelIds.includes(channel.id)) return false;
  if (filter.includeChannelIds.length && !filter.includeChannelIds.includes(channel.id)) return false;
  if (filter.projectIds.length && !(channel.project_id && filter.projectIds.includes(channel.project_id))) return false;
  if (filter.contentTypes.length && !(channel.content_type && filter.contentTypes.includes(channel.content_type))) return false;
  return true;
};

/* ---------- persistence ---------- */

export interface MappingStore { load(): Promise<MappingState>; save(state: MappingState): Promise<void>; }

/** Atomic file store: write temp + rename, so a crash mid-write never truncates the table. */
export class FileMappingStore implements MappingStore {
  constructor(private readonly path: string) {}
  async load(): Promise<MappingState> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return emptyMappingState();
    const parsed = JSON.parse(await file.text()) as Partial<MappingState>;
    if (!parsed || parsed.version !== 1 || !parsed.rooms || typeof parsed.rooms !== "object") throw new Error(`mapping state ${this.path} is malformed`);
    return { version: 1, rooms: parsed.rooms as Record<string, MappingRecord> };
  }
  async save(state: MappingState): Promise<void> {
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
    const { rename, mkdir } = await import("node:fs/promises");
    await mkdir(this.path.replace(/\/[^/]*$/, ""), { recursive: true }).catch(() => {});
    await rename(temporary, this.path);
  }
}
export class MemoryMappingStore implements MappingStore {
  constructor(private state: MappingState = emptyMappingState()) {}
  async load(): Promise<MappingState> { return structuredClone(this.state); }
  async save(state: MappingState): Promise<void> { this.state = structuredClone(state); }
}

/* ---------- transports (extensions of the verified ones) ---------- */

export interface SpaceDiscovery extends SpaceTransport { listChannels(): Promise<SpaceChannel[]>; }
export interface GaiaProvisioning extends GaiaTransport { listRooms(): Promise<string[]>; ensureRoom(roomId: string): Promise<void>; setTitle(roomId: string, title: string): Promise<void>; }

/* ---------- provisioning ---------- */

export type ProvisionResult = { created: MappingRecord[]; existing: MappingRecord[]; skipped: SpaceChannel[] };

/** Discover → filter → derive → create-missing → persist. Idempotent: a second run creates nothing. */
export class Provisioner {
  constructor(private readonly space: SpaceDiscovery, private readonly gaia: GaiaProvisioning, private readonly store: MappingStore, private readonly config: WholeSpaceConfig) {}
  async run(): Promise<ProvisionResult> {
    const channels = await this.space.listChannels();
    const state = await this.store.load();
    const existingRooms = new Set(await this.gaia.listRooms());
    const taken = new Set<string>([...existingRooms, ...Object.values(state.rooms).map(record => record.roomId), this.config.hubRoomId]);
    const created: MappingRecord[] = [], existing: MappingRecord[] = [], skipped: SpaceChannel[] = [];
    for (const channel of channels) {
      if (!isBridgeableChannel(channel, this.config.filter)) { skipped.push(channel); continue; }
      const known = state.rooms[channel.id];
      if (known) {
        // A channel keeps its room forever; only the human-readable title follows a rename.
        if (!existingRooms.has(known.roomId)) await this.gaia.ensureRoom(known.roomId);
        if (known.channelName !== (channel.name ?? null)) {
          await this.gaia.setTitle(known.roomId, `${this.config.roomTitlePrefix}${channel.name ?? channel.id}`);
          state.rooms[channel.id] = { ...known, channelName: channel.name ?? null };
        }
        existing.push(state.rooms[channel.id]!);
        continue;
      }
      const roomId = uniqueRoomId(deriveRoomId(channel, this.config.roomIdPrefix), taken);
      taken.add(roomId);
      await this.gaia.ensureRoom(roomId);
      await this.gaia.setTitle(roomId, `${this.config.roomTitlePrefix}${channel.name ?? channel.id}`);
      const record: MappingRecord = { channelId: channel.id, roomId, channelName: channel.name ?? null, provisionedAt: new Date().toISOString() };
      state.rooms[channel.id] = record;
      created.push(record);
    }
    await this.store.save(state);
    return { created, existing, skipped };
  }
}

export const mappingsOf = (state: MappingState) => Object.values(state.rooms).map(record => ({ spaceChannelId: record.channelId, roomId: record.roomId }));

/* ---------- hub ---------- */

export type HubCommand = { name: string; args: string[] };

/** Hub messages are headlines only — channel names and counts, never message bodies —
 *  so one channel's content can never leak into another channel's room via the hub. */
export const digestText = (result: ProvisionResult, hubRoomId: string) => {
  const lines = [`GAIA bridge digest — hub ${hubRoomId}`, `linked channels: ${result.created.length + result.existing.length}`];
  if (result.created.length) lines.push(`newly linked: ${result.created.map(record => `${record.channelName ?? record.channelId} → ${record.roomId}`).join(", ")}`);
  if (result.skipped.length) lines.push(`not linked (filtered): ${result.skipped.length}`);
  return lines.join("\n");
};

export const parseHubCommand = (text: string, prefix: string): HubCommand | undefined => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return undefined;
  const [name, ...args] = trimmed.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  return name ? { name: name.toLowerCase(), args } : undefined;
};

/** Reads `<prefix> list|sync|status` from hub-room events and answers into the same room.
 *  Only routes proven to exist are used: GET room events, POST room messages. */
export class Hub {
  private readonly handled = new Set<string>();
  private primed = false;
  constructor(private readonly gaia: GaiaProvisioning, private readonly store: MappingStore, private readonly config: WholeSpaceConfig, private readonly provision: () => Promise<ProvisionResult>) {}
  async pollOnce(): Promise<number> {
    if (!this.config.hub.commandsEnabled) return 0;
    const events = await this.gaia.events(this.config.hubRoomId);
    if (!this.primed) { for (const event of events) this.handled.add(event.id); this.primed = true; return 0; }
    let answered = 0;
    for (const event of events) {
      if (this.handled.has(event.id)) continue;
      this.handled.add(event.id);
      const command = parseHubCommand(event.text ?? "", this.config.hub.commandPrefix);
      if (!command) continue;
      await this.gaia.send(this.config.hubRoomId, await this.answer(command));
      answered++;
    }
    return answered;
  }
  private async answer(command: HubCommand): Promise<string> {
    if (command.name === "sync") { const result = await this.provision(); return digestText(result, this.config.hubRoomId); }
    const state = await this.store.load();
    const records = Object.values(state.rooms);
    if (command.name === "list") return records.length ? records.map(record => `${record.channelName ?? record.channelId} → ${record.roomId}`).join("\n") : "no channels linked yet";
    if (command.name === "status") return `hub ${this.config.hubRoomId}; linked channels ${records.length}; prefix ${this.config.roomIdPrefix || "(none)"}; digest ${this.config.hub.digestEnabled ? "on" : "off"}`;
    return `unknown command "${command.name}"; try ${this.config.hub.commandPrefix} list|sync|status`;
  }
}

/* ---------- HTTP transports ---------- */

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

/** Channel discovery. `list_channels` is `CommandPolicy::Unavailable` over HTTP, so the
 *  bridge uses `list_channels_with_meta`, whose `profile_id` the server rewrites to the
 *  session's own profile (`bind_session_identity`) — the bridge can never list someone else's channels. */
export function channelDiscoveryOn<T extends SpaceTransport & { authenticatedJson(path: string, body: unknown): Promise<unknown> }>(transport: T): SpaceDiscovery {
  const discovery = transport as unknown as SpaceDiscovery;
  discovery.listChannels = async () => {
    const profileId = await transport.bridgeAuthorId();
    const payload = await transport.authenticatedJson("/api/cmd/list_channels_with_meta", { profile_id: profileId }) as { value?: SpaceChannel[] };
    if (!Array.isArray(payload.value)) throw new Error("Space list_channels_with_meta returned malformed response");
    return payload.value;
  };
  return discovery;
}

export class HttpGaiaProvisioning implements GaiaProvisioning {
  constructor(private readonly config: Config["gaia"], private readonly inner: GaiaTransport) {}
  private base() { return `${this.config.baseUrl.replace(/\/$/, "")}/api/workspaces/${encodeURIComponent(this.config.workspaceId)}`; }
  events(roomId: string): Promise<GaiaEvent[]> { return this.inner.events(roomId); }
  send(roomId: string, text: string): Promise<void> { return this.inner.send(roomId, text); }
  async listRooms(): Promise<string[]> {
    const payload = await (await request(`${this.base()}/snapshot`, {}, this.config.requestTimeoutMs)).json() as { snapshot?: { rooms?: { id: string }[] } };
    const rooms = payload.snapshot?.rooms;
    if (!Array.isArray(rooms)) throw new Error("GAIA snapshot returned malformed room list");
    return rooms.map(room => room.id);
  }
  /** POST /rooms creates the room when missing (and selects it — the daemon has no create-only route). */
  async ensureRoom(roomId: string): Promise<void> {
    await request(`${this.base()}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId }) }, this.config.requestTimeoutMs);
  }
  async setTitle(roomId: string, title: string): Promise<void> {
    await request(`${this.base()}/rooms/${encodeURIComponent(roomId)}/title`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title.slice(0, 120) }) }, this.config.requestTimeoutMs);
  }
}

/* ---------- runner ---------- */

export type WholeSpaceRunner = { provision(): Promise<ProvisionResult>; hub: Hub; store: MappingStore };

export function createWholeSpace(space: SpaceDiscovery, gaia: GaiaProvisioning, store: MappingStore, config: WholeSpaceConfig): WholeSpaceRunner {
  const provisioner = new Provisioner(space, gaia, store, config);
  const provision = () => provisioner.run();
  return { provision, hub: new Hub(gaia, store, config, provision), store };
}

export const digestDue = (lastAt: number, now: number, intervalMs: number) => now - lastAt >= intervalMs;
export type { SpaceMessage };
