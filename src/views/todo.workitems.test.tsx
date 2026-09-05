import { afterEach, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import { setProfileId } from "../session";

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
afterEach(() => { dispose?.(); document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); });

/* MY TASKS SHOWS TASKS, full stop (task unification, 2026-09). There used to be a
   second pane here for tracker work (a separate Issue entity, assigned tasks and
   bugs); that entity is gone. A dev task now lives on the SAME task list, distinguished
   only by its `category` ("dev") and, when it started from a message, a SourceLink
   badge — there is no second tab and no `list_issues` read on this page any more. */
test("tasks lead: My tasks reads only list_todos, never a legacy issue command, and renders every task in one list", async () => {
  const calls: string[] = [];
  (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
    calls.push(command);
    if (command === "list_todos") return Promise.resolve([
      { id:"task-1", profile_id:"me", content:"Write release note", due_date:null, project_id:"p1", done:false, source_entity_type:null, source_entity_id:null, notes:null, assignee_ids:["me"], content_kind:"text", category:null },
      { id:"task-2", profile_id:"me", content:"Import fails", due_date:null, project_id:"p1", done:false, source_entity_type:null, source_entity_id:null, notes:null, assignee_ids:["me"], content_kind:"text", category:"dev" },
    ]);
    if (command === "list_profiles") return Promise.resolve([{ id:"me", username:"me", display_name:"Me", archived:false }]);
    if (command === "list_projects") return Promise.resolve([{ id:"p1", name:"Atlas", key:"ATL", description:null, created_by:"me", archived:false, deadline:null, lead_id:null }]);
    return Promise.resolve([]);
  }};
  setProfileId("me"); const host = document.createElement("div"); document.body.appendChild(host); dispose = render(() => <Todo /> as any, host); await settle();

  // Both tasks are on the ONE list — a dev-category task is not sorted into a
  // second pane, and there is no tab to click to find it.
  expect(host.textContent).toContain("Write release note");
  expect(host.textContent).toContain("Import fails");
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);

  // The legacy tracker reads are gone with the entity: this page never asks for them.
  expect(calls).not.toContain("list_issues");
  expect(calls).not.toContain("list_issue_statuses");
  expect(calls).not.toContain("get_issue_detail");
});
