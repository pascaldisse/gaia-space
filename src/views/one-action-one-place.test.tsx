import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import { setProfileId, setProjectId, reloadProfiles } from "../session";

// ONE ACTION, ONE PLACE. The page header and an empty state both offered "New task",
// so an empty surface showed the same button twice. Whichever is drawn, exactly one is.
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 40));
const store: any = { todos: [] as any[] };

const mountWith = async (todos: any[]) => {
  store.todos = todos;
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string) => {
      if (cmd === "list_todos") return Promise.resolve(store.todos);
      if (cmd === "list_profiles") return Promise.resolve([{ id: "p1", username: "me", display_name: "Me", archived: false }]);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve([]);
    },
  };
  await reloadProfiles();
  setProfileId("p1");
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Todo /> as any, host);
  await settle();
  return host;
};

const newTaskButtons = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "New task");

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
});

describe("one action, one place", () => {
  test("an empty surface shows exactly one New task, and it is the empty state's", async () => {
    const host = await mountWith([]);
    expect(newTaskButtons(host).length).toBe(1);
    expect(host.querySelector(".empty-lead")?.contains(newTaskButtons(host)[0])).toBe(true);
  });

  test("with content the header carries it, and the empty state is gone", async () => {
    const host = await mountWith([
      { id: "t1", profile_id: "p1", content: "Something open", due_date: null, project_id: null, done: false,
        source_entity_type: null, source_entity_id: null, notes: null, content_kind: "text", assignee_ids: ["p1"] },
    ]);
    expect(newTaskButtons(host).length).toBe(1);
    expect(host.querySelector(".empty-lead")).toBeNull();
  });
});
