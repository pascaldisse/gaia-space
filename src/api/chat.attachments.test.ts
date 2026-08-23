import { test, expect, afterEach } from "bun:test";
import { chatApi } from "./chat";

// The attachment lifecycle is an IPC contract: the state transition and the removal
// must reach the native side under the exact names/keys the Rust commands declare,
// otherwise a failed upload can never be retried or cleared.
const seen: { command: string; args: Record<string, unknown> }[] = [];
afterEach(() => { seen.length = 0; delete (window as any).__TAURI_INTERNALS__; });

function record() {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return {}; },
  };
}

test("attachment upload state and removal cross IPC with the declared argument names", async () => {
  record();
  await chatApi.setMessageAttachmentState("msg-1", "att-1", "uploading");
  await chatApi.setMessageAttachmentState("msg-1", "att-1", "failed", "network down");
  await chatApi.removeMessageAttachment("msg-1", "att-1");
  expect(seen.map((e) => e.command)).toEqual([
    "set_message_attachment_state",
    "set_message_attachment_state",
    "remove_message_attachment",
  ]);
  // an omitted error is an explicit null, not a missing key: the command signature is Option<String>
  // the owning message rides along: the backend scopes and authorizes on it
  expect(seen[0].args).toEqual({ messageId: "msg-1", id: "att-1", state: "uploading", error: null });
  expect(seen[1].args).toEqual({ messageId: "msg-1", id: "att-1", state: "failed", error: "network down" });
  expect(seen[2].args).toEqual({ messageId: "msg-1", id: "att-1" });
});

test("a new attachment carries its lifecycle state to the backend", async () => {
  record();
  await chatApi.addMessageAttachment("msg-1", {
    id: "att-2",
    file_name: "f.txt",
    mime_type: "text/plain",
    byte_length: 2,
    data_url: "data:,hi",
    upload_state: "completed",
  });
  expect(seen[0].command).toBe("add_message_attachment");
  expect(seen[0].args.messageId).toBe("msg-1");
  expect((seen[0].args.attachment as Record<string, unknown>).upload_state).toBe("completed");
});
