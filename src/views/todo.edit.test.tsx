import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import type { Todo as TodoItem } from "../api/personal";
import { setProfileId } from "../session";

// An existing task had no way to be edited at all — only completed or deleted.
// This is the missing write: clicking a task opens it for editing, in place,
// with the same controls the composer uses; Save sends the whole merged todo
// through `update_todo`, Cancel discards the draft and calls nothing.

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

describe("editing an existing task", () => {
  test("clicking a task opens it, and Save sends the merged todo through update_todo", async () => {
    stubTauriIpc();
    setProfileId("pa");
    let stored = todo();
    reply = (cmd) => {
      if (cmd === "list_todos") return [stored];
      if (cmd === "list_profiles") return [{ id: "pa", username: "pa", display_name: "Pa", archived: false }];
      if (cmd === "list_projects") return [];
      if (cmd === "update_todo") return stored;
      return [];
    };
    const host = await mount();

    // Not editable yet: no edit surface, just the read-only card.
    expect(host.querySelector(".task-open")).toBeNull();
    const openButton = host.querySelector<HTMLButtonElement>("button.task-tile-body");
    expect(openButton).not.toBeNull();
    expect(openButton!.textContent).toContain("Buy milk");

    openButton!.click();
    await settle();

    const editing = host.querySelector(".task-open");
    expect(editing).not.toBeNull();
    const titleInput = editing!.querySelector<HTMLInputElement>(".composer-title");
    expect(titleInput?.value).toBe("Buy milk");

    titleInput!.value = "Buy oat milk";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    const notes = editing!.querySelector<HTMLTextAreaElement>(".composer-notes")!;
    notes.value = "the good kind";
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    const buttons = Array.from(editing!.querySelectorAll("button"));
    const saveButton = buttons.find((b) => b.textContent === "Save") as HTMLButtonElement;
    expect(saveButton).toBeDefined();
    stored = { ...stored, content: "Buy oat milk", notes: "the good kind" };
    saveButton.click();
    await settle();

    const update = calls.find((c) => c.cmd === "update_todo");
    expect(update).toBeDefined();
    expect(update!.args.todo.id).toBe("t1");
    // Identity and any field the edit form never touches are carried through unchanged.
    expect(update!.args.todo.profile_id).toBe("pa");
    expect(update!.args.todo.content).toBe("Buy oat milk");
    expect(update!.args.todo.notes).toBe("the good kind");
    expect(update!.args.todo.done).toBe(false);

    // The edit surface closes and the card reflects the saved content.
    expect(host.querySelector(".task-open")).toBeNull();
    expect(host.textContent).toContain("Buy oat milk");
  });

  test("Cancel discards the draft without calling update_todo", async () => {
    stubTauriIpc();
    setProfileId("pa");
    reply = (cmd) => {
      if (cmd === "list_todos") return [todo()];
      if (cmd === "list_profiles") return [{ id: "pa", username: "pa", display_name: "Pa", archived: false }];
      if (cmd === "list_projects") return [];
      return [];
    };
    const host = await mount();
    host.querySelector<HTMLButtonElement>("button.task-tile-body")!.click();
    await settle();

    const editing = host.querySelector(".task-open")!;
    const titleInput = editing.querySelector<HTMLInputElement>(".composer-title")!;
    titleInput.value = "Something else entirely";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    const buttons = Array.from(editing.querySelectorAll("button"));
    (buttons.find((b) => b.textContent === "Cancel") as HTMLButtonElement).click();
    await settle();

    expect(calls.some((c) => c.cmd === "update_todo")).toBe(false);
    expect(host.querySelector(".task-open")).toBeNull();
    expect(host.textContent).toContain("Buy milk");
    expect(host.textContent).not.toContain("Something else entirely");
  });

  test("the delete and complete controls stay outside the edit trigger", async () => {
    stubTauriIpc();
    setProfileId("pa");
    reply = (cmd) => {
      if (cmd === "list_todos") return [todo()];
      if (cmd === "list_profiles") return [{ id: "pa", username: "pa", display_name: "Pa", archived: false }];
      if (cmd === "list_projects") return [];
      return [];
    };
    const host = await mount();
    host.querySelector<HTMLButtonElement>(".task-tile-check")!.click();
    await settle();
    // Ticking the checkbox is a completion write, never an edit-open.
    expect(calls.some((c) => c.cmd === "set_todo_completion")).toBe(true);
    expect(host.querySelector(".task-open")).toBeNull();
  });
});
