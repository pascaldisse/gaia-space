import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "./invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { personalApi } from "./personal";
import { chatApi } from "./chat";

// The web transport rewrites EVERY profile id in a request to the caller's own
// profile (identity law, space-server.rs `bind_session_identity`). So a command
// that names somebody ELSE must not call that argument `profileId` - otherwise
// "add Charles" silently becomes "add me", which is exactly what happened.

const realFetch = globalThis.fetch;
let sent: { cmd: string; body: any }[] = [];
afterEach(() => { globalThis.fetch = realFetch; sent = []; });
const serve = () => {
  sent = [];
  globalThis.fetch = (async (url: any, init: any) => {
    sent.push({ cmd: String(url).split("api/cmd/")[1] ?? String(url), body: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true, value: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};

describe("commands that name another person", () => {
  test("project membership sends memberId, never profileId", async () => {
    serve();
    await personalApi.addProjectMember("p1", "charles");
    await personalApi.removeProjectMember("p1", "charles");
    for (const call of sent) {
      expect(call.body.memberId).toBe("charles");
      expect(call.body.profileId).toBeUndefined();
    }
  });

  test("channel membership sends memberId, never profileId", async () => {
    serve();
    await chatApi.addChannelMember("c1", "charles", false);
    await chatApi.removeChannelMember("c1", "charles");
    for (const call of sent) {
      expect(call.body.memberId).toBe("charles");
      expect(call.body.profileId).toBeUndefined();
    }
  });
});
