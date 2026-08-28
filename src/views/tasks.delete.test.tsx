import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import TeamTasks from "./TeamTasks";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

/** ── DELETING A TASK ────────────────────────────────────────────────────────
 *
 *  THE RULE: the CREATOR (`profile_id`) may delete. Being ASSIGNED a task is not
 *  owning it — a task bound to a project, or carried for somebody else, is SHARED,
 *  and deleting it to clear your own list would delete another person's work. Those
 *  rows carry no button and say why instead ("Only the owner can delete this").
 *
 *  Two doors on both task surfaces: the row's right-click menu, and the opened task's
 *  own facts. Neither deletes on click; both open the ConfirmDialog, which NAMES the
 *  task. Cancelling sends no command at all; confirming sends exactly one, carrying
 *  `{ id, actorId }` — the identity the server's owner gate runs against.
 */

const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "other", username: "other", display_name: "Other Person", email: null, archived: false },
];
const projects = [
  { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "me", archived: false, deadline: null, lead_id: null },
];
const task = (over: Record<string, unknown>) => ({
  id: "t", profile_id: "me", content: "Task", due_date: null, project_id: null, done: false,
  source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: [] as string[],
  content_kind: "text", ...over,
});
/** My tasks shows BOTH: what I made, and what other people put on me. */
const myTodos = [
  task({ id: "t-mine", content: "Mine alone" }),
  task({ id: "t-theirs", profile_id: "other", content: "Theirs on me", project_id: "p1", assignee_ids: ["me"] }),
];
/** Team tasks is made of project work: shared by definition. */
const teamTodos = [
  task({ id: "t-mine", content: "Mine alone", project_id: "p1", assignee_ids: ["me"] }),
  task({ id: "t-theirs", profile_id: "other", content: "Theirs on me", project_id: "p1", assignee_ids: ["me"] }),
];

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let deleteFails = "";
let dispose: (() => void) | undefined;

const reply = (cmd: string) => {
  if (cmd === "list_todos") return myTodos;
  if (cmd === "list_team_todos") return teamTodos;
  if (cmd === "list_projects") return projects;
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_project_member_ids") return ["me", "other"];
  return [];
};

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const mount = async (component: () => unknown) => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args: args ?? {} });
      if (cmd === "delete_todo" && deleteFails) return Promise.reject(new Error(deleteFails));
      return Promise.resolve(reply(cmd));
    },
  };
  registerViews(["My Tasks", "Team Tasks", "Project Tasks", "Projects"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter());
  setProfileId("me");
  await reloadProjects();
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0; deleteFails = "";
  delete (window as any).__TAURI_INTERNALS__;
  setProfileId(""); setProjectId("");
});

const rightClick = (element: HTMLElement) =>
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
const menuEntries = () => Array.from(document.querySelectorAll<HTMLElement>(".context-menu .context-item")).map(item => item.textContent);
const menuEntry = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".context-menu button.context-item")).find(item => item.textContent === label);
const deleteCalls = () => calls.filter(call => call.cmd === "delete_todo");
const confirmDanger = () => document.querySelector(".confirm-danger") as HTMLButtonElement;

/** Both surfaces open a task by clicking its row body; the danger row lives there. */
const rowOf = (host: HTMLElement, selector: string, title: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector)).find(row => row.textContent?.includes(title))!;

describe("My tasks: the creator deletes, the assignee does not", () => {
  const openRow = async (host: HTMLElement, title: string) => {
    const row = rowOf(host, ".task-tile", title);
    row.querySelector<HTMLButtonElement>(".task-tile-body")!.click();
    await settle();
  };

  test("the opened task I created carries the red button", async () => {
    const host = await mount(() => <Todo /> as any);
    await openRow(host, "Mine alone");
    const button = host.querySelector<HTMLButtonElement>(".task-danger-row .delete-button");
    expect(button).toBeTruthy();
    expect(button!.getAttribute("aria-label")).toBe("Delete Mine alone");
  });

  test("a SHARED task somebody else created shows no button, and says why", async () => {
    const host = await mount(() => <Todo /> as any);
    await openRow(host, "Theirs on me");
    expect(host.querySelector(".task-danger-row .delete-button")).toBeNull();
    expect(host.querySelector(".task-danger-row .delete-denied")?.textContent).toBe("Only the owner can delete this");
  });

  test("right-click offers Delete task… on mine only", async () => {
    const host = await mount(() => <Todo /> as any);
    rightClick(rowOf(host, ".task-tile", "Mine alone"));
    await settle();
    // The row's old glyph buttons are words in this menu now; only the DELETE entry
    // is owner-gated, which is what this test is about.
    expect(menuEntries()).toEqual(["Open", "Postpone by a day", "Postpone by a week", "Delete task…"]);
    document.querySelector<HTMLButtonElement>(".context-menu button.context-item")!.blur();
    window.dispatchEvent(new Event("mousedown"));
    await settle();
    rightClick(rowOf(host, ".task-tile", "Theirs on me"));
    await settle();
    expect(menuEntries()).toEqual(["Open", "Postpone by a day", "Postpone by a week", "Convert to ticket"]);
    expect(menuEntries()).not.toContain("Delete task…");
  });

  test("cancelling deletes nothing", async () => {
    const host = await mount(() => <Todo /> as any);
    await openRow(host, "Mine alone");
    host.querySelector<HTMLButtonElement>(".task-danger-row .delete-button")!.click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);
    expect(document.querySelector(".confirm-body")?.textContent).toContain("Mine alone");
    (document.querySelector(".confirm-cancel") as HTMLButtonElement).click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);
    expect(document.querySelector(".confirm-root")).toBeNull();
  });

  test("confirming sends exactly one delete_todo with the id and the actor", async () => {
    const host = await mount(() => <Todo /> as any);
    await openRow(host, "Mine alone");
    host.querySelector<HTMLButtonElement>(".task-danger-row .delete-button")!.click();
    await settle();
    confirmDanger().click();
    await settle();
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].args).toEqual({ id: "t-mine", actorId: "me" });
  });

  test("a refused delete is shown on the surface, never swallowed", async () => {
    deleteFails = "delete_todo refused";
    const host = await mount(() => <Todo /> as any);
    rightClick(rowOf(host, ".task-tile", "Mine alone"));
    await settle();
    menuEntry("Delete task…")!.click();
    await settle();
    confirmDanger().click();
    await settle();
    expect(host.querySelector(".personal-error")?.textContent).toContain("delete_todo refused");
  });
});

describe("Team tasks: other people's work is not yours to delete", () => {
  const openRow = async (host: HTMLElement, title: string) => {
    const row = rowOf(host, ".tt-row", title);
    row.querySelector<HTMLButtonElement>(".task-row-main")!.click();
    await settle();
  };

  test("the task I created carries the button; the one put on me does not", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    await openRow(host, "Mine alone");
    expect(host.querySelector<HTMLButtonElement>(".task-danger-row .delete-button")?.getAttribute("aria-label"))
      .toBe("Delete Mine alone");
    await openRow(host, "Theirs on me");
    expect(host.querySelector(".task-danger-row .delete-button")).toBeNull();
    expect(host.querySelector(".task-danger-row .delete-denied")?.textContent).toBe("Only the owner can delete this");
  });

  test("right-click on a row I do not own has no Delete entry", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    rightClick(rowOf(host, ".tt-row", "Theirs on me"));
    await settle();
    expect(menuEntries()).toEqual(["Open"]);
  });

  test("confirming from the row menu sends one delete_todo with the actor", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    rightClick(rowOf(host, ".tt-row", "Mine alone"));
    await settle();
    expect(menuEntries()).toEqual(["Open", "Delete task…"]);
    menuEntry("Delete task…")!.click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);
    confirmDanger().click();
    await settle();
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].args).toEqual({ id: "t-mine", actorId: "me" });
  });

  test("cancelling deletes nothing, and a refusal is said out loud", async () => {
    deleteFails = "delete_todo refused";
    const host = await mount(() => <TeamTasks /> as any);
    rightClick(rowOf(host, ".tt-row", "Mine alone"));
    await settle();
    menuEntry("Delete task…")!.click();
    await settle();
    (document.querySelector(".confirm-cancel") as HTMLButtonElement).click();
    await settle();
    expect(deleteCalls()).toHaveLength(0);

    rightClick(rowOf(host, ".tt-row", "Mine alone"));
    await settle();
    menuEntry("Delete task…")!.click();
    await settle();
    confirmDanger().click();
    await settle();
    expect(host.querySelector(".planning-error")?.textContent).toContain("delete_todo refused");
  });
});
