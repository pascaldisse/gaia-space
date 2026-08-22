import { afterEach, expect, test, mock } from "bun:test";
import { invoke } from "./invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { platformApi } from "./platform";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
test("member location assignment names its target member", async () => {
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, value: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await platformApi.addMemberLocation("member-1", "Berlin", "Building");
  expect(body.memberId).toBe("member-1");
  expect(body.profileId).toBeUndefined();
});
