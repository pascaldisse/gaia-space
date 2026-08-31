import { afterEach, expect, test, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import { setProfileId } from "../session";

/* ── A GROUP IS A DAY, NOT THE READ THAT FILLED IT (GS issue #2, My tasks) ─────
 * Todo.tsx rebuilds its day groups — and the task objects inside them — from every
 * fresh read. `<For>` keys BY REFERENCE, so an unchanged list looked like a whole
 * new list: the section and its rows were disposed and rebuilt, and an OPEN row
 * editor died with them (typed title reverted, button row rebuilt mid-keystroke).
 * The re-read here is the app's own: ticking ANOTHER task calls refetch().
 */

let dispose: (() => void) | undefined;
let calls: string[] = [];

const rows = () => [
  { id: "t1", profile_id: "pa", content: "Review the release notes", notes: null, due_date: null,
    project_id: null, done: false, source_entity_type: null, source_entity_id: null,
    assignee_ids: ["pa"] as string[], content_kind: "text", category: null },
  { id: "t2", profile_id: "pa", content: "Water the plants", notes: null, due_date: null,
    project_id: null, done: false, source_entity_type: null, source_entity_id: null,
    assignee_ids: ["pa"] as string[], content_kind: "text", category: null },
];

function serve() {
  calls = [];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (command: string) => {
      calls.push(command);
      if (command === "list_todos") return rows();
      if (command === "list_profiles") return [{ id: "pa", username: "alice", display_name: "Alice", archived: false }];
      return [];
    },
  };
}

async function until(check: () => boolean, timeoutMs = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`condition never held; calls=${JSON.stringify(calls)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  dispose?.(); dispose = undefined;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  document.body.innerHTML = "";
  setProfileId("");
});

test("my tasks: a re-read does not tear down the group holding an open row editor", async () => {
  setProfileId("pa");
  serve();
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <Todo /> as unknown as never, host);

  await until(() => !!host.querySelector('[data-task-row="t1"]'));
  const group = host.querySelector('[aria-label="No date tasks"]') as HTMLElement;
  (host.querySelector('[data-task-row="t1"]') as HTMLElement).click();
  await until(() => !!host.querySelector("input.composer-title"));

  const title = host.querySelector("input.composer-title") as HTMLInputElement;
  title.value = "Review the release notes — edited";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  const before = Array.from(host.querySelectorAll(".task-edit-actions button")).map(node => node.textContent?.trim());
  expect(before).toContain("Save");

  // The app's own re-read: ticking a DIFFERENT task refetches the list.
  const reads = calls.filter(command => command === "list_todos").length;
  (host.querySelector('[aria-label="Mark Water the plants done"]') as HTMLElement).click();
  await until(() => calls.filter(command => command === "list_todos").length > reads);
  await new Promise(resolve => setTimeout(resolve, 40));

  const after = host.querySelector("input.composer-title") as HTMLInputElement | null;
  expect(host.querySelector('[aria-label="No date tasks"]') === group).toBe(true); // group kept
  expect(after === title).toBe(true);                                              // row never unmounted
  expect(after?.value).toBe("Review the release notes — edited");                   // typed text survives
  expect(Array.from(host.querySelectorAll(".task-edit-actions button")).map(n => n.textContent?.trim())).toEqual(before);
});
