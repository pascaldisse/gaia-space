import { afterEach, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "./Todo";
import { setProfileId } from "../session";

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
afterEach(() => { dispose?.(); document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); });

test("tasks lead; assigned tickets and bugs live in their own tab, retaining tracker metadata", async () => {
  let assigned = [
      { id:"issue-1", project_id:"p1", number:13, title:"Import fails", description:null, status_id:"open", assignee_id:"me", created_by:null, due_date:null, priority:"HIGH", archived:false, assignee_ids:["me"], source_entity_type:null, source_entity_id:null },
      { id:"issue-2", project_id:"p1", number:14, title:"Broken sign-in", description:null, status_id:"triage", assignee_id:"me", created_by:null, due_date:null, priority:"URGENT", archived:false, assignee_ids:["me"], source_entity_type:null, source_entity_id:null },
    ];
  (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
    if (command === "list_todos") return Promise.resolve([{ id:"task-1", profile_id:"me", content:"Write release note", due_date:null, project_id:"p1", done:false, source_entity_type:null, source_entity_id:null, notes:null, assignee_ids:["me"], content_kind:"text" }]);
    if (command === "list_issues") return Promise.resolve(assigned);
    if (command === "get_issue_detail") return Promise.resolve(args.id === "issue-2" ? { tags:[{ id:"bug", name:"Bug" }] } : { tags:[] });
    if (command === "list_issue_statuses") return Promise.resolve([{ id:"open", project_id:"p1", name:"Open", resolved:false, color:"#000", ordering:1 }, { id:"triage", project_id:"p1", name:"Triage", resolved:false, color:"#000", ordering:2 }]);
    if (command === "list_profiles") return Promise.resolve([{ id:"me", username:"me", display_name:"Me", archived:false }]);
    if (command === "list_projects") return Promise.resolve([{ id:"p1", name:"Atlas", key:"ATL", description:null, created_by:"me", archived:false, deadline:null, lead_id:null }]);
    return Promise.resolve([]);
  }};
  setProfileId("me"); const host = document.createElement("div"); document.body.appendChild(host); dispose = render(() => <Todo /> as any, host); await settle();

  /* MY TASKS SHOWS TASKS FIRST (owner, 2026-09-05: "die wirklichen Tasks im
     Vordergrund ... die Tickets vielleicht einen Extra Reiter"). Tracker work used to
     be a group INSIDE the list, which made the page read as a ticket ledger. */
  expect(host.textContent).toContain("Write release note");
  expect(host.textContent).not.toContain("Import fails");
  expect(host.textContent).not.toContain("Broken sign-in");

  const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLElement[];
  expect(tabs.map(tab => tab.textContent?.replace(/\d+/g, "").trim())).toEqual(["Tasks", "Tickets"]);
  // Tasks is the selected pane; the ticket count is carried, not the ticket rows.
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(tabs[0].getAttribute("aria-controls")).toBe("tasks-panel");
  expect(document.getElementById("tasks-panel")?.getAttribute("aria-labelledby")).toBe("tasks-tab");
  expect(tabs[1].textContent).toContain("2");

  tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key:"End", bubbles:true })); await settle();
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key:"Home", bubbles:true })); await settle();
  expect(document.activeElement).toBe(tabs[0]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");

  tabs[1].click(); await settle();

  // The second pane keeps every tracker fact the old inline group carried.
  expect(host.textContent).toContain("Import fails");
  expect(host.textContent).toContain("Ticket");
  expect(host.textContent).toContain("Bug");
  expect(host.textContent).toContain("Atlas");
  expect(host.textContent).toContain("Open");
  expect(host.textContent).toContain("high");
  expect(host.textContent).toContain("#13");
  // ...and the task list is not printed underneath it.
  expect(host.textContent).not.toContain("Write release note");

  assigned = [];
  setProfileId(""); setProfileId("me"); await settle();
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(host.textContent).toContain("Write release note");
  expect(host.textContent).not.toContain("Import fails");
});
