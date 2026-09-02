import { describe, expect, test } from "bun:test";
import { HttpSpaceTransport, RoomLink, isForwardable, parseConfig, type GaiaEvent, type GaiaTransport, type SpaceMessage, type SpaceTransport } from "./src.ts";

const message = (id: string, author_id: string | null, text = "hello"): SpaceMessage => ({ id, channel_id: "space-1", author_id, text, created_at: 1, thread_of: null, archived: false });

describe("configuration and loop guard", () => {
  test("mapping config has parameter defaults and requires GAIA workspace", () => {
    const config = parseConfig({ mappings: [{ spaceChannelId: "space-1", roomId: "room-1" }], space: { sessionCookie: "space_session=test" }, gaia: { workspaceId: "workspace-1" } });
    expect(config.mappings).toEqual([{ spaceChannelId: "space-1", roomId: "room-1" }]);
    expect(config.space.pollIntervalMs).toBe(1000);
    expect(config.gaia.replyTimeoutMs).toBe(120000);
    expect(() => parseConfig({ mappings: [], space: { sessionCookie: "x" }, gaia: {} })).toThrow("gaia.workspaceId");
  });

  test("a personal access token is a complete Space credential on its own", () => {
    const config = parseConfig({ mappings: [], space: { personalAccessToken: " pat-secret " }, gaia: { workspaceId: "workspace-1" } });
    expect(config.space.personalAccessToken).toBe("pat-secret");
    expect(config.space.password).toBeUndefined();
  });

  test("existing cookie and username/password credentials still parse, and no credential still fails", () => {
    expect(parseConfig({ mappings: [], space: { sessionCookie: "space_session=t" }, gaia: { workspaceId: "w" } }).space.sessionCookie).toBe("space_session=t");
    expect(parseConfig({ mappings: [], space: { username: "u", password: "p" }, gaia: { workspaceId: "w" } }).space.username).toBe("u");
    expect(() => parseConfig({ mappings: [], space: { username: "u" }, gaia: { workspaceId: "w" } })).toThrow("personalAccessToken");
  });
});

describe("HttpSpaceTransport credentials", () => {
  const spaceConfig = (extra: Record<string, unknown>) => parseConfig({ mappings: [], space: { baseUrl: "http://space.test", ...extra }, gaia: { workspaceId: "w" } }).space;
  const withFetch = async <T>(handler: (url: string, init: RequestInit) => Response, body: (calls: { url: string; init: RequestInit }[]) => Promise<T>): Promise<T> => {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => { const url = String(input); calls.push({ url, init }); return handler(url, init); }) as typeof fetch;
    try { return await body(calls); } finally { globalThis.fetch = original; }
  };
  const meResponse = new Response(JSON.stringify({ user: { profile_id: "bridge-profile" } }), { headers: { "content-type": "application/json" } });

  test("token auth sends Authorization Bearer, never logs in, and never sends a cookie", async () => {
    await withFetch(() => meResponse.clone(), async calls => {
      const transport = new HttpSpaceTransport(spaceConfig({ personalAccessToken: "pat-secret" }));
      expect(await transport.bridgeAuthorId()).toBe("bridge-profile");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("http://space.test/api/auth/me");
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer pat-secret");
      expect(headers.cookie).toBeUndefined();
      expect(calls.some(call => call.url.includes("/api/auth/login"))).toBe(false);
    });
  });

  test("the token also authorizes /api/cmd routes", async () => {
    await withFetch(() => new Response(JSON.stringify({ value: [] }), { headers: { "content-type": "application/json" } }), async calls => {
      const transport = new HttpSpaceTransport(spaceConfig({ personalAccessToken: "pat-secret" }));
      expect(await transport.listMessages("channel-1")).toEqual([]);
      expect(calls[0]!.url).toBe("http://space.test/api/cmd/list_messages");
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer pat-secret");
    });
  });

  test("without a token the pre-existing cookie path is unchanged", async () => {
    await withFetch(() => meResponse.clone(), async calls => {
      const transport = new HttpSpaceTransport(spaceConfig({ sessionCookie: "space_session=abc" }));
      expect(await transport.bridgeAuthorId()).toBe("bridge-profile");
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers.cookie).toBe("space_session=abc");
      expect(headers.authorization).toBeUndefined();
    });
  });

  test("without a token or cookie the username/password login still runs first", async () => {
    // `Response` drops `set-cookie` on read, so the login reply is a minimal stand-in.
    const loginResponse = { ok: true, status: 200, headers: { get: (name: string) => name === "set-cookie" ? "space_session=fresh; HttpOnly" : null } } as unknown as Response;
    await withFetch(url => url.includes("/api/auth/login") ? loginResponse : meResponse.clone(), async calls => {
      const transport = new HttpSpaceTransport(spaceConfig({ username: "bridge", password: "pw" }));
      expect(await transport.bridgeAuthorId()).toBe("bridge-profile");
      expect(calls[0]!.url).toBe("http://space.test/api/auth/login");
      expect((calls[1]!.init.headers as Record<string, string>).cookie).toBe("space_session=fresh");
    });
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
