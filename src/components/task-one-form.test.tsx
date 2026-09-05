import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "../views/Todo";
import ProjectTasks from "../views/ProjectTasks";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

/** ── ONE FORM FOR CREATING AND FOR EDITING A TASK ───────────────────────────
 *
 *  *"Beim Task-Erstellen … warum öffnet sich nicht eine Ansicht wie wenn ich einen
 *  Task BEARBEITE?"* (product owner, 2026-08-29)
 *
 *  Creating and editing ask for the same facts, so they must show the same fields in
 *  the same order. The drawer used to draw a thinner list of its own; it now renders
 *  THE editor (components/TaskRowEdit) in create mode. The first test below is the
 *  guard that keeps it that way: it reads the field names off BOTH surfaces and
 *  compares them, so a field added to one and forgotten in the other fails here.
 */

const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "you", username: "you", display_name: "You", email: null, archived: false },
];
const projects = [
  { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "me", archived: false, deadline: null, lead_id: null },
];
const existing = {
  id: "t1", profile_id: "me", content: "Ship the draft", due_date: null, project_id: "p1",
  done: false, source_entity_type: null, source_entity_id: null, notes: "already written",
  assignee_ids: ["me"], content_kind: "text", category: null,
};

let dispose: (() => void) | undefined;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let todos: Record<string, unknown>[] = [existing];

const reply = (cmd: string): unknown => {
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_projects") return projects;
  if (cmd === "list_todos") return todos;
  if (cmd === "list_project_todos") return todos;
  if (cmd === "list_project_member_ids") return ["me", "you"];
  if (cmd === "project_dashboard") return { project_id: "p1", open_issues: 0, open_todos: 1, member_count: 2, deadline: null };
  if (cmd === "list_issues") return [];
  return [];
};

const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

const mount = async (component: () => unknown, onProject = false) => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args: args ?? {} });
      if (cmd === "create_todo") return Promise.resolve({ ...existing, id: "t2", ...(args.input as object) });
      if (cmd === "update_todo") return Promise.resolve({ ...todos[0], ...(args.todo as object) });
      return Promise.resolve(reply(cmd));
    },
  };
  registerViews(["My Tasks", "Projects", "Project Tasks"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter());
  setProfileId("me");
  await reloadProjects();
  if (onProject) { setProjectId("p1"); navigate({ view: "Project Tasks", projectId: "p1" }); }
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  setProfileId(""); setProjectId("");
  calls.length = 0;
  todos = [existing];
});

/** The field names a person SEES, in the order they see them: the two written fields
 *  by their accessible names, then every meta control by its label. */
const fieldNames = (root: ParentNode): string[] => {
  const form = root.querySelector(".task-edit")!;
  const names: string[] = [];
  for (const node of Array.from(form.querySelectorAll("input[aria-label], textarea[aria-label], .tm-label"))) {
    if (node.classList.contains("tm-label")) names.push(node.textContent!.trim());
    else names.push(node.getAttribute("aria-label")!.replace(/^Task /, "").replace(/^./, letter => letter.toUpperCase()));
  }
  return names;
};

const click = (node: Element) => (node as HTMLElement).click();
const press = (node: Element) => node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
const type = (node: Element, value: string) => {
  (node as HTMLInputElement).value = value;
  node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
};
const newTask = (host: ParentNode) =>
  [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "New task")!;
const control = (host: ParentNode, label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".tm-trigger")]
    .find(button => button.querySelector(".tm-label")?.textContent === label)!;
const option = (host: ParentNode, name: string) =>
  [...host.querySelectorAll(".tm-menu [role=option]")]
    .find(node => node.querySelector(".tm-opt-name")?.textContent === name)!;

describe("one form, two acts", () => {
  test("creating and editing show the SAME fields in the SAME order", async () => {
    const host = await mount(() => <Todo /> as any);

    // EDIT: the row opens into the editor.
    host.querySelector<HTMLButtonElement>(".task-tile-body")!.click();
    await settle();
    const editing = fieldNames(host);
    host.querySelector<HTMLButtonElement>(".task-edit-actions .ghost")!.click();
    await settle();

    /* ADDRESS ONLY: creating happens IN THE LIST now, not in a panel sliding in from
       the right — the product owner asked for the same shape the row editing has, and
       a thing should be made where it will live. The form is the same one; only its
       host moved, so the test looks for it at the top of the list. */
    // CREATE: the same editor, over a blank draft, at the head of the list.
    click(newTask(host));
    await settle();
    const creating = fieldNames(host);

    // LINKS is the one field EDIT has that CREATE does not: a link hangs off a task's
    // id (`add_todo_link`), and a task being created has none yet. So it is compared
    // separately — same fields everywhere else, in the same order.
    expect(creating).toEqual(editing.filter(name => name !== "Link URL" && name !== "Link title"));
    expect(editing).toEqual(["Title", "Description", "Due date", "Project", "Assignee", "Category", "Link URL", "Link title"]);
    // And the order is the one a person decides in — stated, so a reshuffle fails here.
    expect(creating).toEqual(["Title", "Description", "Due date", "Project", "Assignee", "Category"]);
    // The only differences are what the ACTS differ in: nothing to tick done, nothing
    // to delete, nothing to link (nothing exists yet to hang a link off), and the
    // primary says which act it is.
    expect(host.querySelector(".task-create-grid .task-edit-done")).toBeNull();
    expect(host.querySelector(".task-create-grid .task-edit-danger")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".task-create-grid .composer-submit")!.textContent).toContain("Create task");
  });

  test("the editing form's primary is Save, and it carries Done and Delete", async () => {
    const host = await mount(() => <Todo /> as any);
    host.querySelector<HTMLButtonElement>(".task-tile-body")!.click();
    await settle();
    expect(host.querySelector<HTMLButtonElement>(".composer-submit")!.textContent).toBe("Save");
    expect(host.querySelector(".task-edit-done")).toBeTruthy();
    expect(host.querySelector(".task-edit-danger")).toBeTruthy();
  });

  test("creating sends exactly one create_todo, carrying every field that was set", async () => {
    const host = await mount(() => <Todo /> as any);
    click(newTask(host));
    await settle();

    type(host.querySelector('input[aria-label="Task title"]')!, "Draft the brief");
    type(host.querySelector('textarea[aria-label="Task description"]')!, "One page, no more");

    click(control(host, "Due date"));
    await settle();
    press([...host.querySelectorAll(".tm-quick-btn")].find(button => button.textContent === "Today")!);
    await settle();

    click(control(host, "Project"));
    await settle();
    press(option(host, "Atlas"));
    await settle();

    click(control(host, "Assignee"));
    await settle();
    press(option(host, "You"));
    await settle();

    click(control(host, "Category"));
    await settle();
    press(option(host, "Review"));
    await settle();

    host.querySelector<HTMLButtonElement>(".task-create-grid .composer-submit")!.click();
    await settle();

    const writes = calls.filter(call => call.cmd === "create_todo");
    expect(writes.length).toBe(1);
    const input = writes[0].args.input as Record<string, unknown>;
    expect(input).toMatchObject({
      profile_id: "me", content: "Draft the brief", notes: "One page, no more",
      project_id: "p1", assignee_ids: ["you"], category: "review", done: false,
    });
    expect(typeof input.due_date).toBe("string");
    expect(String(input.due_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Identity is the server's to mint: the blank draft's empty id never goes out.
    expect(input.id).toBeUndefined();
    // The drawer closes on a successful write.
    expect(host.querySelector(".task-create-grid")).toBeNull();
  });

  test("cancelling writes nothing", async () => {
    const host = await mount(() => <Todo /> as any);
    click(newTask(host));
    await settle();
    type(host.querySelector('input[aria-label="Task title"]')!, "Never mind");
    host.querySelector<HTMLButtonElement>(".task-create-grid .task-edit-actions .ghost")!.click();
    await settle();
    expect(host.querySelector(".task-create-grid")).toBeNull();
    expect(calls.some(call => call.cmd === "create_todo")).toBe(false);
    expect(calls.some(call => call.cmd === "update_todo")).toBe(false);
  });

  test("from a project surface the project is INHERITED: no chooser, and the write carries it", async () => {
    const host = await mount(() => <ProjectTasks /> as any, true);
    click(newTask(host));
    await settle();

    // The context is a fact here, so it is not asked: no Project control at all.
    expect(fieldNames(host)).toEqual(["Title", "Description", "Due date", "Assignee", "Category"]);
    expect(host.querySelector(".task-create-grid")!.textContent).not.toContain("No project — personal");

    type(host.querySelector('input[aria-label="Task title"]')!, "Ship the fix");
    host.querySelector<HTMLButtonElement>(".task-create-grid .composer-submit")!.click();
    await settle();

    const writes = calls.filter(call => call.cmd === "create_todo");
    expect(writes.length).toBe(1);
    expect(writes[0].args.input).toMatchObject({ profile_id: "me", project_id: "p1", content: "Ship the fix", done: false });
  });
});
