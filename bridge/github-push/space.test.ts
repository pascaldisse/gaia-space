import { describe, expect, test } from "bun:test";
import { SpaceApi } from "./space.ts";

describe("Space API authentication", () => {
  test("falls back to a login session when no permanent token exists", async () => {
    let loginBody: unknown; let cookie = "";
    const server = Bun.serve({ port: 0, fetch: async (request) => {
      if (new URL(request.url).pathname === "/api/auth/login") {
        loginBody = await request.json();
        return new Response(JSON.stringify({ ok: true }), { headers: { "set-cookie": "space_session=session-token; HttpOnly" } });
      }
      cookie = request.headers.get("cookie") || "";
      return Response.json({ ok: true, value: { id: "message", channel_id: "channel", text: "hello" } });
    } });
    try {
      const api = new SpaceApi(`http://127.0.0.1:${server.port}`, { username: "bridge", password: "secret" });
      await api.login();
      await api.createMessage("channel", "hello");
      expect(loginBody).toEqual({ username: "bridge", password: "secret" });
      expect(cookie).toBe("space_session=session-token");
    } finally { server.stop(true); }
  });
});
