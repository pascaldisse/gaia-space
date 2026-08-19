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
    expect(isForwardable(message("human", "human"), "bridge", seen)).toBe(true);
    expect(isForwardable(message("bridge", "bridge"), "bridge", seen)).toBe(false);
    expect(isForwardable(message("seen", "human"), "bridge", seen)).toBe(false);
    expect(isForwardable({ ...message("thread", "human"), thread_of: "root" }, "bridge", seen)).toBe(false);
    expect(isForwardable({ ...message("archived", "human"), archived: true }, "bridge", seen)).toBe(false);
    expect(isForwardable(message("blank", "human", "  "), "bridge", seen)).toBe(false);
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
      postMessage: async (channel, text) => { posted.push(`${channel}:${text}`); messages.push(message("bridge-reply", "bridge-profile", text)); },
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
