import { afterEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import ProjectTasks from "./ProjectTasks";
import TeamTasks from "./TeamTasks";
import { navigate, registerViews, setAvailableViews } from "../router";
import { setProfileId } from "../session";

/* ── AN OPEN EDITOR IS NOT A VIEW OF THE LIST (GS issue #2) ──────────────────
 * The list polls every 15s and re-reads on window focus. Each read returns FRESH
 * task objects, and `<For>` keys rows BY REFERENCE — so every row was disposed and
 * rebuilt, taking the open in-row editor with it: typed text vanished and the button
 * row (Done / Delete / Cancel / Save) was rebuilt mid-keystroke. These tests type
 * into an open editor, fire the refresh the app itself fires, and demand the text
 * and the buttons are still there.
 */

let dispose: (() => void) | undefined;
let calls: string[] = [];

function serve(table: Record<string, unknown>) {
  calls = [];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => {
      calls.push(command);
      const entry = table[command];
      return (typeof entry === "function" ? (entry as (args: Record<string, unknown>) => unknown)(args ?? {}) : entry) ?? [];
    },
  };
}

async function until(check: () => boolean, timeoutMs = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`condition never held; calls=${JSON.stringify(calls)} text=${document.body.textContent?.slice(0, 300)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// A fresh object per read: that is what the transport really does, and it is the
// whole mechanism of the bug.
const task = () => ({
  id: "t1", profile_id: "pa", content: "Review the release notes", notes: null,
  due_date: null, project_id: "p1", done: false, source_entity_type: null,
  source_entity_id: null, assignee_ids: [] as string[], content_kind: "text", category: null,
});
const profilesTable = [{ id: "pa", username: "alice", display_name: "Alice", archived: false }];
const projectsTable = [{ id: "p1", name: "Orbital", key: "ORB", archived: false }];

afterEach(() => {
  dispose?.(); dispose = undefined;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  document.body.innerHTML = "";
  navigate({ view: "Dashboard" });
});

async function openEditorAndType(host: HTMLElement) {
  await until(() => !!host.querySelector('[data-task-row="t1"]'));
  (host.querySelector('[data-task-row="t1"]') as HTMLElement).click();
  await until(() => !!host.querySelector("input.composer-title"));
  const title = host.querySelector("input.composer-title") as HTMLInputElement;
  title.value = "Review the release notes — edited";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  return title;
}

function buttonLabels(host: HTMLElement) {
  return Array.from(host.querySelectorAll(".task-edit-actions button")).map(node => node.textContent?.trim());
}

test("project tasks: a background re-read does not wipe the row editor being typed into", async () => {
  setProfileId("pa");
  serve({
    list_projects: projectsTable,
    list_profiles: profilesTable,
    list_project_member_ids: ["pa"],
    list_project_todos: () => [task()],
    project_dashboard_aggregate: { project_id: "p1", open_issues: 0, open_todos: 1, member_count: 1, deadline: null },
    list_issue_statuses: [],
    list_planning_tags: [],
  });
  registerViews(["Dashboard", "Project Tasks"]);
  setAvailableViews(null);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);

  const title = await openEditorAndType(host);
  const before = buttonLabels(host);
  expect(before).toContain("Save");

  // The app's own refresh: window focus re-reads the list.
  const reads = calls.filter(command => command === "list_project_todos").length;
  window.dispatchEvent(new Event("focus"));
  await until(() => calls.filter(command => command === "list_project_todos").length > reads);
  await new Promise(resolve => setTimeout(resolve, 30));

  const after = host.querySelector("input.composer-title") as HTMLInputElement | null;
  expect(after === title).toBe(true);                          // same element: never unmounted
  expect(after?.value).toBe("Review the release notes — edited"); // typed text survives
  expect(buttonLabels(host)).toEqual(before);                  // buttons did not switch
});

test("team tasks: a background re-read does not wipe the row editor being typed into", async () => {
  setProfileId("pa");
  serve({
    list_projects: projectsTable,
    list_profiles: profilesTable,
    list_project_member_ids: ["pa"],
    list_team_todos: () => [task()],
  });
  registerViews(["Dashboard", "Team Tasks"]);
  setAvailableViews(null);
  navigate({ view: "Team Tasks" });
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <TeamTasks />, host);

  const title = await openEditorAndType(host);
  const before = buttonLabels(host);

  const reads = calls.filter(command => command === "list_team_todos").length;
  window.dispatchEvent(new Event("focus"));
  await until(() => calls.filter(command => command === "list_team_todos").length > reads);
  await new Promise(resolve => setTimeout(resolve, 30));

  const after = host.querySelector("input.composer-title") as HTMLInputElement | null;
  expect(after === title).toBe(true);
  expect(after?.value).toBe("Review the release notes — edited");
  expect(buttonLabels(host)).toEqual(before);
});
