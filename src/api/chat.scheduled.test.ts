import { test, expect, afterEach } from "bun:test";
import { chatApi } from "./chat";

// The scheduling contract is a wire contract: command names and argument keys must match
// src-tauri/src/chat.rs, and "leave it alone" (null) must stay distinct from a new value.
const seen: { command: string; args: Record<string, unknown> }[] = [];
afterEach(() => { seen.length = 0; delete (window as any).__TAURI_INTERNALS__; });

function record(result: unknown = {}) {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return result; },
  };
}

test("scheduling sends a UTC timestamp and an explicit thread target", async () => {
  record();
  await chatApi.scheduleMessage({ id: "s-1", channelId: "c", authorId: "pb", text: "later", scheduledAt: 1800 });
  expect(seen[0]).toEqual({
    command: "schedule_message",
    args: { id: "s-1", channelId: "c", authorId: "pb", text: "later", threadOf: null, scheduledAt: 1800 },
  });
  await chatApi.scheduleMessage({ id: "s-2", channelId: "c", authorId: "pb", text: "reply", scheduledAt: 1900, threadOf: "m-1" });
  expect(seen[1].args.threadOf).toBe("m-1");
});

test("an edit moves text and time independently", async () => {
  record();
  await chatApi.updateScheduledMessage("s-1", "pb", "new body");
  expect(seen[0].args).toEqual({ id: "s-1", authorId: "pb", text: "new body", scheduledAt: null });
  await chatApi.updateScheduledMessage("s-1", "pb", null, 2000);
  expect(seen[1].args).toEqual({ id: "s-1", authorId: "pb", text: null, scheduledAt: 2000 });
});

test("listing and cancelling cross IPC under the declared names", async () => {
  record([]);
  await chatApi.listScheduledMessages("pb");
  await chatApi.listScheduledMessages("pb", "c", "pending");
  await chatApi.getScheduledMessage("s-1", "pb");
  await chatApi.cancelScheduledMessage("s-1", "pb");
  expect(seen.map((e) => e.command)).toEqual([
    "list_scheduled_messages",
    "list_scheduled_messages",
    "get_scheduled_message",
    "cancel_scheduled_message",
  ]);
  expect(seen[0].args).toEqual({ authorId: "pb", channelId: null, status: null });
  expect(seen[1].args).toEqual({ authorId: "pb", channelId: "c", status: "pending" });
});
