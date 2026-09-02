import { describe, expect, test } from "bun:test";
import { RoomLink, isForwardable, parseConfig, type GaiaEvent, type GaiaTransport, type SpaceMessage, type SpaceTransport } from "./src.ts";

const message = (id: string, author_id: string | null, text = "hello"): SpaceMessage => ({ id, channel_id: "space-1", author_id, text, created_at: 1, thread_of: null, archived: false });

describe("configuration and loop guard", () => {
  test("mapping config has parameter defaults and requires GAIA workspace", () => {
    const config = parseConfig({ mappings: [{ spaceChannelId: "space-1", roomId: "room-1" }], space: { sessionCookie: "space_session=test" }, gaia: { workspaceId: "workspace-1" } });
    expect(config.mappings).toEqual([{ spaceChannelId: "space-1", roomId: "room-1" }]);
    expect(config.space.pollIntervalMs).toBe(1000);
    expect(config.gaia.replyTimeoutMs).toBe(120000);
    expect(() => parseConfig({ mappings: [], space: { sessionCookie: "x" }, gaia: {} })).toThrow("gaia.workspaceId");
  });

  test("never forwards bridge-authored, archived, threaded, blank, or seen messages", () => {
    const seen = new Set(["seen"]);
    const byAuthor = (candidate: SpaceMessage) => candidate.author_id === "bridge";
    expect(isForwardable(message("human", "human"), byAuthor, seen)).toBe(true);
    expect(isForwardable(message("bridge", "bridge"), byAuthor, seen)).toBe(false);
    expect(isForwardable(message("seen", "human"), byAuthor, seen)).toBe(false);
    expect(isForwardable({ ...message("thread", "human"), thread_of: "root" }, byAuthor, seen)).toBe(false);
    expect(isForwardable({ ...message("archived", "human"), archived: true }, byAuthor, seen)).toBe(false);
    expect(isForwardable(message("blank", "human", "  "), byAuthor, seen)).toBe(false);
  });

  test("own-account mode is off by default and its knobs have defaults", () => {
    const config = parseConfig({ mappings: [], space: { sessionCookie: "space_session=t" }, gaia: { workspaceId: "w" } });
    expect(config.space.ownAccountMode).toBe(false);
    expect(config.space.outboundIdPrefix).toBe("bridge-");
    expect(config.space.outboundLedgerLimit).toBe(5000);
    expect(parseConfig({ mappings: [], space: { sessionCookie: "t", ownAccountMode: true, outboundLedgerLimit: 10 }, gaia: { workspaceId: "w" } }).space.ownAccountMode).toBe(true);
    expect(() => parseConfig({ mappings: [], space: { sessionCookie: "t", ownAccountMode: true, outboundIdPrefix: "has space" }, gaia: { workspaceId: "w" } })).toThrow("outboundIdPrefix");
  });
});

describe("RoomLink", () => {
  test("forwards one new Space message, returns its agent reply, then ignores its own post", async () => {
    const messages: SpaceMessage[] = [message("old", "human", "old")];
    const posted: string[] = [];
    const sent: string[] = [];
    let eventReads = 0;
    const space: SpaceTransport = {
      bridgeAuthorId: async () => "bridge-profile",
      listMessages: async () => messages,
      postMessage: async (channel, text, messageId) => { posted.push(`${channel}:${text}`); const id = messageId ?? "bridge-reply"; messages.push(message(id, "bridge-profile", text)); return id; },
    };
    const gaia: GaiaTransport = {
      events: async (): Promise<GaiaEvent[]> => eventReads++ === 0 ? [{ id: "before", author: "user", text: "prior" }] : [{ id: "before", author: "user", text: "prior" }, { id: "reply", author: "terra", text: "agent reply" }],
      send: async (_room, text) => { sent.push(text); },
    };
    const link = new RoomLink([{ spaceChannelId: "space-1", roomId: "room-1" }], space, gaia, 100, 1);
    expect(await link.pollOnce()).toBe(0); // prime historical messages
    messages.push(message("incoming", "person-42", "can you help?"));
    expect(await link.pollOnce()).toBe(1);
    expect(sent).toEqual(["Space message from person-42: can you help?"]);
    expect(posted).toEqual(["space-1:agent reply"]);
    expect(await link.pollOnce()).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
