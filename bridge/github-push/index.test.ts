import { afterEach, describe, expect, test } from "bun:test";
import { createHandler } from "./index.ts";
import type { GitHubPushConfig } from "./config.ts";
import { emptyState } from "./state.ts";
import { signatureFor } from "./verify.ts";

const stateFiles: string[] = [];
afterEach(async () => { for (const path of stateFiles.splice(0)) for (const candidate of [path, `${path}.tmp`]) if (await Bun.file(candidate).exists()) await Bun.file(candidate).delete(); });

function config(overrides: Partial<GitHubPushConfig> = {}): GitHubPushConfig {
  const statePath = `bridge/github-push/.test-state-${crypto.randomUUID()}.json`;
  stateFiles.push(statePath);
  return { port: 8093, webhookSecret: "hook-secret", notifyToken: "notify-secret", spaceServerUrl: "http://space", spaceToken: "token", channelId: "default-channel", repoChannelMap: { "acme/widgets": "mapped-channel" }, statePath, maxCommits: 5, notifyMaxText: 4000, ...overrides };
}
function serverFor(configValue: GitHubPushConfig, poster: { createMessage(channel: string, text: string): Promise<unknown> }) {
  return Bun.serve({ port: 0, fetch: createHandler(configValue, { login: async () => {}, ...poster }, emptyState()) });
}
async function signedRequest(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const raw = JSON.stringify(body);
  return fetch(url, { method: "POST", headers: { "x-hub-signature-256": await signatureFor("hook-secret", raw), ...headers }, body: raw });
}

describe("GitHub push bridge HTTP routes", () => {
  test("rejects missing webhook signatures", async () => {
    const server = serverFor(config(), { createMessage: async () => ({}) });
    try { expect((await fetch(`http://127.0.0.1:${server.port}/hooks/github`, { method: "POST", body: "{}" })).status).toBe(401); } finally { server.stop(true); }
  });
  test("deduplicates a delivery and persists its ID", async () => {
    const configValue = config(); let posts = 0;
    const server = serverFor(configValue, { createMessage: async () => { posts++; return {}; } });
    const body = { ref: "refs/heads/main", pusher: { name: "octo" }, repository: { full_name: "acme/widgets" }, commits: [] };
    try {
      const url = `http://127.0.0.1:${server.port}/hooks/github`;
      expect((await signedRequest(url, body, { "x-github-event": "push", "x-github-delivery": "delivery-1" })).status).toBe(200);
      expect((await signedRequest(url, body, { "x-github-event": "push", "x-github-delivery": "delivery-1" })).status).toBe(200);
      expect(posts).toBe(1);
      expect((await Bun.file(configValue.statePath).json() as { deliveryIds: string[] }).deliveryIds).toEqual(["delivery-1"]);
    } finally { server.stop(true); }
  });
  test("authorizes /notify", async () => {
    const messages: string[] = []; const server = serverFor(config(), { createMessage: async (_channel, text) => { messages.push(text); return {}; } });
    try {
      const url = `http://127.0.0.1:${server.port}/notify`;
      expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await fetch(url, { method: "POST", headers: { authorization: "Bearer notify-secret", "content-type": "application/json" }, body: JSON.stringify({ repo: "local/paloptic", ref: "main", text: "Deployed", url: "https://paloptic.com" }) })).status).toBe(200);
      expect(messages[0]).toContain("local/paloptic → main");
      expect((await fetch(url, { method: "POST", headers: { authorization: "Bearer notify-secret", "content-type": "application/json" }, body: JSON.stringify({ repo: "local/paloptic", text: "x".repeat(4001) }) })).status).toBe(413);
      expect((await fetch(url, { method: "POST", headers: { authorization: "Bearer notify-secret", "content-type": "application/json" }, body: JSON.stringify({ repo: "local/paloptic", text: "ok", url: `https://example.test/${"x".repeat(2048)}` }) })).status).toBe(413);
    } finally { server.stop(true); }
  });
  test("reports failed posts in health metrics", async () => {
    const server = serverFor(config(), { createMessage: async () => { throw new Error("Space down"); } });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      expect((await fetch(`${url}/notify`, { method: "POST", headers: { authorization: "Bearer notify-secret", "content-type": "application/json" }, body: JSON.stringify({ repo: "local/paloptic", text: "Deployed" }) })).status).toBe(200);
      expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ ok: true, posted: 0, failed: 1, lastDeliveryAt: null });
    } finally { server.stop(true); }
  });
  test("posts to Space with a permanent token and retries a 5xx once", async () => {
    let attempts = 0; let received: unknown; let authorization = "";
    const space = Bun.serve({ port: 0, fetch: async (request) => {
      attempts++; authorization = request.headers.get("authorization") || ""; received = await request.json();
      if (attempts === 1) return Response.json({ ok: false, error: "retry" }, { status: 503 });
      return Response.json({ ok: true, value: { id: "message", channel_id: "mapped-channel", text: "ok" } });
    } });
    const configValue = config({ spaceServerUrl: `http://127.0.0.1:${space.port}` });
    const { SpaceApi } = await import("./space.ts");
    const api = new SpaceApi(configValue.spaceServerUrl, { token: "spat_test" });
    const bridge = Bun.serve({ port: 0, fetch: createHandler(configValue, api, emptyState()) });
    try {
      const response = await signedRequest(`http://127.0.0.1:${bridge.port}/hooks/github`, { ref: "refs/heads/main", pusher: { name: "octo" }, repository: { full_name: "acme/widgets" }, commits: [] }, { "x-github-event": "push", "x-github-delivery": "delivery-space" });
      expect(response.status).toBe(200); expect(attempts).toBe(2); expect(authorization).toBe("Bearer spat_test");
      expect((received as { message: { channel_id: string } }).message.channel_id).toBe("mapped-channel");
    } finally { bridge.stop(true); space.stop(true); }
  });
});
