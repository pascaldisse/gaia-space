import { describe, expect, test } from "bun:test";
import { parseConfig, RoomLink, type GaiaEvent, type SpaceMessage, type SpaceTransport } from "./src.ts";
import {
  channelDigest, createWholeSpace, deriveRoomId, digestDue, digestText, isBridgeableChannel, isValidRoomId, mappingsOf,
  MemoryMappingStore, parseHubCommand, parseWholeSpace, Provisioner, slug, uniqueRoomId,
  type GaiaProvisioning, type SpaceChannel, type SpaceDiscovery, type WholeSpaceConfig,
} from "./whole-space.ts";

const channel = (id: string, name: string | null, overrides: Partial<SpaceChannel> = {}): SpaceChannel => ({ id, name, archived: false, project_id: null, content_type: "chat", ...overrides });
const config = (overrides: Partial<WholeSpaceConfig> = {}): WholeSpaceConfig => ({ ...parseWholeSpace({ hubRoomId: "chat-mtgc29i7-3jcc" })!, ...overrides });

const fakeSpace = (channels: SpaceChannel[], messages: Record<string, SpaceMessage[]> = {}): SpaceDiscovery & { posted: string[] } => ({
  posted: [] as string[],
  bridgeAuthorId: async () => "bridge-profile",
  listChannels: async () => channels,
  listMessages: async (channelId: string) => messages[channelId] ?? [],
  postMessage: async function (this: { posted: string[] }, channelId: string, text: string, messageId?: string) { this.posted.push(`${channelId}:${text}`); return messageId ?? "bridge-post"; },
});

const fakeGaia = (rooms: string[] = []) => {
  const created: string[] = [], titles: Record<string, string> = {}, sent: string[] = [], eventsByRoom: Record<string, GaiaEvent[]> = {};
  const gaia = {
    created, titles, sent, eventsByRoom,
    listRooms: async () => [...rooms],
    ensureRoom: async (roomId: string) => { created.push(roomId); if (!rooms.includes(roomId)) rooms.push(roomId); },
    setTitle: async (roomId: string, title: string) => { titles[roomId] = title; },
    events: async (roomId: string) => eventsByRoom[roomId] ?? [],
    send: async (roomId: string, text: string) => { sent.push(`${roomId}:${text}`); },
  };
  return gaia as typeof gaia & GaiaProvisioning;
};

describe("whole-space config", () => {
  test("requires a valid hub room id and fills documented defaults", () => {
    const parsed = parseWholeSpace({ hubRoomId: "chat-mtgc29i7-3jcc" })!;
    expect(parsed.hubRoomId).toBe("chat-mtgc29i7-3jcc");
    expect(parsed.roomIdPrefix).toBe("space-");
    expect(parsed.discoveryIntervalMs).toBe(60_000);
    expect(parsed.hub).toEqual({ digestEnabled: false, digestIntervalMs: 900_000, commandsEnabled: false, commandPrefix: "!bridge" });
    expect(parseWholeSpace(undefined)).toBeUndefined();
    expect(() => parseWholeSpace({})).toThrow("hubRoomId");
    expect(() => parseWholeSpace({ hubRoomId: "has/slash" })).toThrow("not a valid GAIA room id");
    expect(() => parseWholeSpace({ hubRoomId: "hub", discoveryIntervalMs: 0 })).toThrow("must be positive");
    expect(() => parseWholeSpace({ hubRoomId: "hub", filter: { excludeChannelIds: [""] } })).toThrow("excludeChannelIds[0]");
  });

  test("mode is inferred, whole-space needs no static mappings, and no secret is baked in", () => {
    const whole = parseConfig({ wholeSpace: { hubRoomId: "hub" }, space: { sessionCookie: "space_session=test" }, gaia: { workspaceId: "workspace-1" } });
    expect(whole.mode).toBe("whole-space");
    expect(whole.mappings).toEqual([]);
    expect(whole.wholeSpace?.hubRoomId).toBe("hub");
    const mapped = parseConfig({ mappings: [{ spaceChannelId: "c", roomId: "r" }], space: { sessionCookie: "x" }, gaia: { workspaceId: "w" } });
    expect(mapped.mode).toBe("mappings");
    expect(() => parseConfig({ mode: "whole-space", space: { sessionCookie: "x" }, gaia: { workspaceId: "w" } })).toThrow("wholeSpace is required");
    expect(() => parseConfig({ mode: "nonsense", mappings: [], space: { sessionCookie: "x" }, gaia: { workspaceId: "w" } })).toThrow("config mode");
  });
});

describe("deterministic room ids", () => {
  test("same channel id always yields the same room id, valid for GAIA", () => {
    const first = deriveRoomId(channel("chan-42", "Design & Ops"), "space-");
    expect(first).toBe(deriveRoomId(channel("chan-42", "Design & Ops"), "space-"));
    expect(first).toBe(`space-design-ops-${channelDigest("chan-42")}`);
    expect(isValidRoomId(first)).toBe(true);
  });

  test("rename keeps the channel digest, so identity survives a readable half changing", () => {
    expect(deriveRoomId(channel("chan-42", "Renamed"), "space-").endsWith(channelDigest("chan-42"))).toBe(true);
    expect(deriveRoomId(channel("other", "Design & Ops"), "space-")).not.toBe(deriveRoomId(channel("chan-42", "Design & Ops"), "space-"));
  });

  test("unnamed, unicode, and very long names stay inside the 64-char room id rule", () => {
    for (const name of [null, "Über Grüße", "x".repeat(200), "🙂🙂🙂"]) expect(isValidRoomId(deriveRoomId(channel(`id-${name}`, name), "space-"))).toBe(true);
    expect(slug("Über Grüße")).toBe("uber-grusse");
  });

  test("collisions get a suffix instead of two channels sharing one room", () => {
    expect(uniqueRoomId("space-x", new Set(["space-x"]))).toBe("space-x-2");
    expect(uniqueRoomId("space-x", new Set(["space-x", "space-x-2"]))).toBe("space-x-3");
    expect(uniqueRoomId("space-x", new Set())).toBe("space-x");
  });
});

describe("channel filter", () => {
  const base = config().filter;
  test("threads and archived channels are never bridged by default", () => {
    expect(isBridgeableChannel(channel("thread:abc", "reply"), base)).toBe(false);
    expect(isBridgeableChannel(channel("c1", "general", { archived: true }), base)).toBe(false);
    expect(isBridgeableChannel(channel("c1", "general", { archived: true }), { ...base, includeArchived: true })).toBe(true);
  });
  test("include/exclude/project/content-type lists all narrow the space", () => {
    expect(isBridgeableChannel(channel("c1", "g"), { ...base, excludeChannelIds: ["c1"] })).toBe(false);
    expect(isBridgeableChannel(channel("c2", "g"), { ...base, includeChannelIds: ["c1"] })).toBe(false);
    expect(isBridgeableChannel(channel("c1", "g"), { ...base, includeChannelIds: ["c1"] })).toBe(true);
    expect(isBridgeableChannel(channel("c1", "g", { project_id: "p1" }), { ...base, projectIds: ["p1"] })).toBe(true);
    expect(isBridgeableChannel(channel("c1", "g", { project_id: null }), { ...base, projectIds: ["p1"] })).toBe(false);
    expect(isBridgeableChannel(channel("c1", "g", { content_type: "docs" }), { ...base, contentTypes: ["chat"] })).toBe(false);
  });
});

describe("provisioning", () => {
  test("creates one room per channel, titles it, and is idempotent on a second run", async () => {
    const space = fakeSpace([channel("c1", "General"), channel("c2", "Design"), channel("thread:x", "reply")]);
    const gaia = fakeGaia();
    const store = new MemoryMappingStore();
    const provisioner = new Provisioner(space, gaia, store, config());
    const first = await provisioner.run();
    expect(first.created).toHaveLength(2);
    expect(first.skipped).toHaveLength(1);
    expect(gaia.titles[first.created[0]!.roomId]).toBe("#General");
    const second = await provisioner.run();
    expect(second.created).toHaveLength(0);
    expect(second.existing).toHaveLength(2);
    expect(mappingsOf(await store.load())).toEqual([
      { spaceChannelId: "c1", roomId: first.created[0]!.roomId },
      { spaceChannelId: "c2", roomId: first.created[1]!.roomId },
    ]);
  });

  test("a renamed channel keeps its room and only re-titles it", async () => {
    const channels = [channel("c1", "General")];
    const space = fakeSpace(channels);
    const gaia = fakeGaia();
    const store = new MemoryMappingStore();
    const provisioner = new Provisioner(space, gaia, store, config());
    const roomId = (await provisioner.run()).created[0]!.roomId;
    channels[0] = channel("c1", "General Chat");
    const after = await provisioner.run();
    expect(after.created).toHaveLength(0);
    expect(after.existing[0]!.roomId).toBe(roomId);
    expect(gaia.titles[roomId]).toBe("#General Chat");
  });

  test("never reuses a room id that already exists in the workspace, including the hub", async () => {
    const taken = deriveRoomId(channel("c1", "General"), "space-");
    const gaia = fakeGaia([taken, "chat-mtgc29i7-3jcc"]);
    const result = await new Provisioner(fakeSpace([channel("c1", "General")]), gaia, new MemoryMappingStore(), config()).run();
    expect(result.created[0]!.roomId).toBe(`${taken}-2`);
  });

  test("a room deleted out from under the bridge is re-created under the same id", async () => {
    const gaia = fakeGaia();
    const store = new MemoryMappingStore();
    const provisioner = new Provisioner(fakeSpace([channel("c1", "General")]), gaia, store, config());
    const roomId = (await provisioner.run()).created[0]!.roomId;
    gaia.listRooms = async () => [];
    await provisioner.run();
    expect(gaia.created.filter(id => id === roomId)).toHaveLength(2);
  });
});

describe("per-channel isolation and late linking", () => {
  test("each channel's message only reaches its own room, and a channel linked later does not replay history", async () => {
    const messages: Record<string, SpaceMessage[]> = {
      c1: [{ id: "m1", channel_id: "c1", author_id: "human", text: "hi from c1", created_at: 1, thread_of: null, archived: false }],
      c2: [{ id: "old", channel_id: "c2", author_id: "human", text: "ancient", created_at: 1, thread_of: null, archived: false }],
    };
    const sent: string[] = [];
    const space: SpaceTransport = {
      bridgeAuthorId: async () => "bridge-profile",
      listMessages: async (channelId: string) => messages[channelId] ?? [],
      postMessage: async (_channel: string, _text: string, messageId?: string) => messageId ?? "bridge-post",
    };
    let replyIndex = 0;
    const gaia = { events: async () => (replyIndex++ % 2 === 0 ? [] : [{ id: `r${replyIndex}`, author: "gaia", text: "ack" }]), send: async (roomId: string, text: string) => { sent.push(`${roomId}:${text}`); } };
    const link = new RoomLink([{ spaceChannelId: "c1", roomId: "room-c1" }], space, gaia, 100, 1);
    await link.pollOnce(); // primes c1 only
    messages.c1!.push({ id: "m2", channel_id: "c1", author_id: "human", text: "second", created_at: 2, thread_of: null, archived: false });
    link.setMappings([{ spaceChannelId: "c1", roomId: "room-c1" }, { spaceChannelId: "c2", roomId: "room-c2" }]);
    expect(await link.pollOnce()).toBe(1); // c1 forwards, c2 primes its backlog
    expect(sent).toEqual(["room-c1:Space message from human: second"]);
    expect(sent.some(entry => entry.startsWith("room-c2"))).toBe(false);
  });
});

describe("hub", () => {
  test("digest carries headlines only — never message text from any channel", async () => {
    const result = { created: [{ channelId: "c1", roomId: "space-general-1", channelName: "General", provisionedAt: "now" }], existing: [], skipped: [channel("c9", "secret")] };
    const text = digestText(result, "hub");
    expect(text).toContain("General → space-general-1");
    expect(text).toContain("not linked (filtered): 1");
    expect(text).not.toContain("secret");
    expect(digestDue(0, 1000, 900)).toBe(true);
    expect(digestDue(500, 1000, 900)).toBe(false);
  });

  test("commands are parsed only with the configured prefix", () => {
    expect(parseHubCommand("!bridge list", "!bridge")).toEqual({ name: "list", args: [] });
    expect(parseHubCommand("  !bridge SYNC now ", "!bridge")).toEqual({ name: "sync", args: ["now"] });
    expect(parseHubCommand("bridge list", "!bridge")).toBeUndefined();
    expect(parseHubCommand("!bridge", "!bridge")).toBeUndefined();
  });

  test("hub answers list/sync/status in the hub room and ignores its own backlog", async () => {
    const space = fakeSpace([channel("c1", "General")]);
    const gaia = fakeGaia();
    const whole = config({ hub: { digestEnabled: false, digestIntervalMs: 900_000, commandsEnabled: true, commandPrefix: "!bridge" } });
    const runner = createWholeSpace(space, gaia, new MemoryMappingStore(), whole);
    await runner.provision();
    gaia.eventsByRoom[whole.hubRoomId] = [{ id: "e0", author: "user", text: "!bridge list" }];
    expect(await runner.hub.pollOnce()).toBe(0); // backlog primed, never answered
    gaia.eventsByRoom[whole.hubRoomId] = [...gaia.eventsByRoom[whole.hubRoomId]!, { id: "e1", author: "user", text: "!bridge status" }, { id: "e2", author: "user", text: "!bridge nope" }];
    expect(await runner.hub.pollOnce()).toBe(2);
    expect(gaia.sent[0]).toContain(`${whole.hubRoomId}:hub ${whole.hubRoomId}; linked channels 1`);
    expect(gaia.sent[1]).toContain("unknown command");
  });

  test("hub stays silent when commands are disabled", async () => {
    const gaia = fakeGaia();
    const runner = createWholeSpace(fakeSpace([]), gaia, new MemoryMappingStore(), config());
    gaia.eventsByRoom["chat-mtgc29i7-3jcc"] = [{ id: "e1", author: "user", text: "!bridge list" }];
    expect(await runner.hub.pollOnce()).toBe(0);
    expect(gaia.sent).toEqual([]);
  });
});
