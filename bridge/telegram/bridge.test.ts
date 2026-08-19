import { afterEach, describe, expect, test } from "bun:test";
import { ConfigError, readConfig } from "./config.ts";
import { emptyState, loadState, saveState } from "./state.ts";
import { TelegramApi } from "./telegram.ts";

const files: string[] = [];
afterEach(async () => { for (const file of files.splice(0)) await Bun.file(file).delete(); });

describe("configuration", () => {
  test("refuses to start without a bot token", () => {
    expect(() => readConfig({ SPACE_PASSWORD: "secret", SPACE_CHANNEL_ID: "general" })).toThrow(ConfigError);
  });

  test("uses only documented non-secret defaults", () => {
    const config = readConfig({ TELEGRAM_BOT_TOKEN: "token", SPACE_PASSWORD: "secret", SPACE_CHANNEL_ID: "general" });
    expect(config.spaceServerUrl).toBe("http://127.0.0.1:8090");
    expect(config.spaceUsername).toBe("admin");
    expect(config.pollIntervalMs).toBe(1_500);
  });

  test("rejects invalid polling periods", () => {
    expect(() => readConfig({ TELEGRAM_BOT_TOKEN: "token", SPACE_PASSWORD: "secret", SPACE_CHANNEL_ID: "general", TELEGRAM_POLL_INTERVAL_MS: "0" })).toThrow("positive integer");
  });
});

describe("state", () => {
  test("round-trips chat mapping and cursor", async () => {
    const path = `/tmp/gaia-space-telegram-${crypto.randomUUID()}.json`;
    files.push(path);
    const state = emptyState();
    state.lastUpdateId = 42;
    state.chats["-100123"] = { channelId: "telegram-bridge" };
    state.inboundSpaceMessageIds.push("inbound-1");
    await saveState(path, state);
    expect(await loadState(path)).toEqual(state);
  });

  test("missing state begins empty", async () => {
    expect(await loadState(`/tmp/absent-${crypto.randomUUID()}.json`)).toEqual(emptyState());
  });
});

describe("Telegram API", () => {
  test("retries getUpdates after Telegram 429 retry_after", async () => {
    let calls = 0;
    const delays: number[] = [];
    const request = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 2 } }), { status: 429 });
      return new Response(JSON.stringify({ ok: true, result: [{ update_id: 7 }] }), { status: 200 });
    }) as typeof fetch;
    const api = new TelegramApi("test-token", request, async (delay) => { delays.push(delay); });
    expect(await api.getUpdates(1)).toEqual([{ update_id: 7 }]);
    expect(calls).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  test("sends chat_id as a JSON string", async () => {
    let body = "";
    const request = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as typeof fetch;
    await new TelegramApi("test-token", request).sendMessage("-100123", "hello");
    expect(JSON.parse(body)).toEqual({ chat_id: "-100123", text: "hello" });
  });
});
