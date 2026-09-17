import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import type { Todo as TodoItem } from "../api/personal";
import { setProfileId } from "../session";

// My tasks read `list_todos` with no `.error` guard and no ErrorBoundary in the app:
// a rejected read rendered the view blank (zero rows, no message). Mirrors
// teamtasks.test.tsx:99 for this surface.

const calls: { cmd: string; args: any }[] = [];
let reply: (cmd: string, args: any) => unknown = () => [];
let dispose: (() => void) | undefined;

const stubTauriIpc = () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => {
      calls.push({ cmd, args });
      const value = reply(cmd, args);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
  };
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  reply = () => [];
  delete (window as any).__TAURI_INTERNALS__;
  setProfileId("");
});

const settle = () => new Promise((done) => setTimeout(done, 40));
const todo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: "t1", profile_id: "pa", content: "Buy milk", due_date: null, project_id: null,
  done: false, source_entity_type: null, source_entity_id: null, notes: null,
  assignee_ids: [] as string[], content_kind: "text", ...over,
});
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Todo /> as any, host);
  await settle();
  return host;
};

describe("my tasks load failure", () => {
  test("reports my tasks load failure without rendering an empty state", async () => {
    stubTauriIpc();
    setProfileId("pa");
    reply = (cmd) => {
      if (cmd === "list_todos") return new Error("todos unavailable");
      if (cmd === "list_profiles") return [{ id: "pa", username: "pa", display_name: "Pa", archived: false }];
      if (cmd === "list_projects") return [];
      if (cmd === "list_issues") return [];
      return [];
    };
    const host = await mount();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load tasks: Error: todos unavailable");
    expect(host.textContent).not.toContain("No tasks yet");
    expect(host.querySelectorAll(".task-tile").length).toBe(0);
  });

  test("two open own-unassigned todos render on a successful load", async () => {
    stubTauriIpc();
    setProfileId("pa");
    reply = (cmd) => {
      if (cmd === "list_todos") return [todo({ id: "t1", content: "Buy milk" }), todo({ id: "t2", content: "Water plants" })];
      if (cmd === "list_profiles") return [{ id: "pa", username: "pa", display_name: "Pa", archived: false }];
      if (cmd === "list_projects") return [];
      if (cmd === "list_issues") return [];
      return [];
    };
    const host = await mount();

    expect(host.querySelector('[role="alert"]')).toBeNull();
    const rows = Array.from(host.querySelectorAll(".task-tile .task-tile-title")).map(node => node.textContent);
    expect(rows).toEqual(["Buy milk", "Water plants"]);
  });
});
