import { test, expect, afterEach } from "bun:test";
import { chatApi } from "./chat";

// Mentions are an IPC contract too: the edit path must be able to say "leave the
// mentions alone" (null) as distinctly as "there are none now" ([]), because the two
// mean opposite things to the backend diff.
const seen: { command: string; args: Record<string, unknown> }[] = [];
afterEach(() => { seen.length = 0; delete (window as any).__TAURI_INTERNALS__; });

function record(result: unknown = {}) {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return result; },
  };
}

test("an edit without a mention list leaves the stored mentions untouched", async () => {
  record();
  await chatApi.updateMessage("m-1", "typo fixed");
  expect(seen[0]).toEqual({ command: "update_message", args: { id: "m-1", text: "typo fixed", mentionIds: null } });
});

test("an explicit empty list clears the mentions rather than being dropped as falsy", async () => {
  record();
  await chatApi.updateMessage("m-1", "never mind", []);
  expect(seen[0].args).toEqual({ id: "m-1", text: "never mind", mentionIds: [] });
  await chatApi.updateMessage("m-1", "hi @bob", ["pb"]);
  expect(seen[1].args.mentionIds).toEqual(["pb"]);
});

test("the mentions inbox and its badge cross IPC under the declared names", async () => {
  record([]);
  await chatApi.listMentionsForProfile("pb", true);
  await chatApi.listMentionsForProfile("pb");
  await chatApi.countUnreadMentions("pb");
  expect(seen.map((e) => e.command)).toEqual([
    "list_mentions_for_profile",
    "list_mentions_for_profile",
    "count_unread_mentions",
  ]);
  expect(seen[0].args).toEqual({ profileId: "pb", unreadOnly: true });
  // an omitted filter is an explicit null: the command signature is Option<bool>
  expect(seen[1].args).toEqual({ profileId: "pb", unreadOnly: null });
  expect(seen[2].args).toEqual({ profileId: "pb" });
});
