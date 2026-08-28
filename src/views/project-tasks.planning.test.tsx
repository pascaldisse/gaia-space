import { afterEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import ProjectTasks from "./ProjectTasks";
import Issues from "./Issues";
import { planningApi } from "../api/issues";
import { navigate, registerViews, route, setAvailableViews } from "../router";
import { projectId, setProfileId, setProjectId } from "../session";

let dispose: (() => void) | undefined;
const realFetch = globalThis.fetch;
const issue = { id: "i1", project_id: "p1", number: 7, title: "Plan the release", description: null, status_id: "s1", assignee_id: null, assignee_ids: [], created_by: null, due_date: "2026-08-30", priority: null, archived: false };
const sharedTask = { id: "t1", profile_id: "pb", content: "Review somebody else's work", notes: null, due_date: "2026-08-29", project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, assignee_ids: ["pa"], content_kind: "text" };
let calls: { command: string; body: Record<string, unknown> }[] = [];
// A fixed sleep is a wager on machine speed: CI lost it (the board link was still
// the pre-load `/dashboard` href after 30ms). Wait for the condition, not the clock.
async function until(check: () => boolean, timeoutMs = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      const select = document.querySelector('select[aria-label="Filter by tag"]') as HTMLSelectElement | null;
      throw new Error(`condition never held; calls=${JSON.stringify(calls)} tagValue=${select?.value} options=${JSON.stringify(Array.from(select?.options ?? []).map(option => option.value))} text=${document.body.textContent?.slice(0, 200)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Serve through the IPC global rather than `mock.module`: an ES module's imports
// are evaluated BEFORE its own `mock.module` call, so a module mock can never fix
// this file's own graph — it only leaks into later files. Both transports (Tauri
// core and the HTTP shim) read this global, so the stub holds whichever one the
// component ended up bound to.
// A table entry may be a FUNCTION: the store the surface reads has to be able to
// change after a write, or "the thing I just created is now in the list" cannot be
// asserted against a surface whose list comes from a re-read rather than from the
// create response.
function serve(table: Record<string, unknown>) {
  calls = [];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, body: args ?? {} });
      const entry = table[command];
      return (typeof entry === "function" ? (entry as (args: Record<string, unknown>) => unknown)(args ?? {}) : entry) ?? [];
    },
  };
}

afterEach(() => {
  dispose?.(); dispose = undefined;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
  navigate({ view: "Dashboard" });
});

test("project tasks shows this project's tasks and links out to the tickets that left it", async () => {
  setProfileId("pa");
  serve({
    list_projects: [{ id: "p0", name: "First response option", key: "FIRST", archived: false }, { id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false }, { id: "pb", username: "bob", display_name: "Bob", archived: false }],
    list_project_member_ids: ["pa", "pb"],
    list_project_todos: [sharedTask],
    list_issues: [issue],
    project_dashboard_aggregate: { project_id: "p1", open_issues: 3, open_todos: 1, member_count: 2, deadline: null },
    list_issue_statuses: [{ id: "s1", project_id: "p1", name: "In progress", resolved: false, color: "#00c2a8", ordering: 0 }],
    list_planning_tags: [{ id: "t1", project_id: "p1", parent_id: null, name: "release", archived: false }],
  });
  registerViews(["Dashboard", "Project Tasks", "Boards", "Issues"]);
  // Router availability is module-global and outlives the file that narrowed it:
  // router.test.ts leaves a restricted set, and on CI's file order that made this
  // view's board link fall back to /dashboard. Declare the reachable set here.
  setAvailableViews(null);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);
  await until(() => host.textContent?.includes("Review somebody else's work") === true);

  // Project tasks remain visible across creators: this surface is EVERY member's
  // project work, not the caller's slice of it.
  expect(host.textContent).toContain("Review somebody else's work");
  expect(calls.some(call => call.command === "list_project_todos" && call.body.projectId === "p1")).toBe(true);
  /* MOVED (stage 20): this used to assert that the header's project picker read the
     scoped project. The picker is GONE — the project workspace names the project in
     its header and its sidebar, and this surface's own kicker names it a third time,
     so a control asking which project this is had no question left to answer. The
     fact it protected (this page is scoped to p1, and says so) is asserted instead
     against the read on the wire, above, and against the header kicker below. Nothing
     may put a project chooser back into the actions area unnoticed. */
  expect(host.querySelector('.planning-actions .pill-select select')).toBeNull();
  expect(host.querySelector('.planning-actions select')).toBeNull();
  expect([...host.querySelectorAll('.planning-actions button')].map(button => button.textContent)).toEqual(["New task"]);

  /* MOVED (stage 12d): the ticket title, the tag-filter options and the board link
     were asserted here while this page rendered tickets. Tickets went back to the
     surface that owns them, so those assertions moved with them — the ticket list,
     tag filter and board link are asserted against `Issues` in
     planning.views.test.tsx, and ticket CREATION in the test below. What is
     asserted here is what replaced them: the ticket list is gone, and the one
     quiet way through to it works. */
  expect(host.textContent).not.toContain("Plan the release");
  expect(host.querySelector('select[aria-label="Filter by tag"]')).toBeNull();
  await until(() => (host.querySelector(".pt-tickets-link")?.textContent ?? "").includes("3 open tickets"));
  const bridge = host.querySelector(".pt-tickets-link") as HTMLAnchorElement;
  // The count is READ from the same aggregate the Overview quotes, never recounted.
  expect(bridge.textContent).toContain("3 open tickets");
  expect(calls.some(call => call.command === "project_dashboard_aggregate" && call.body.projectId === "p1")).toBe(true);
  // CLICK-PROOF: the path to the tickets exists and is pre-scoped to this project.
  bridge.click();
  expect(projectId()).toBe("p1");
  expect(route().view).toBe("Issues");
});

test("project work can add a project task without pretending it is an issue", async () => {
  setProfileId("pa");
  let stored: unknown[] = [];
  serve({
    list_projects: [{ id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false }],
    list_project_member_ids: ["pa"], list_project_todos: () => stored, list_issues: [], list_issue_statuses: [], list_planning_tags: [],
    create_todo: (args: Record<string, unknown>) => {
      const written = { ...sharedTask, id: "new-task", profile_id: "pa", assignee_ids: [], ...(args.input as object) };
      stored = [written];
      return written;
    },
    create_issue: { ...issue, id: "new-issue", number: 8, title: "Track the fix", status_id: null, due_date: null },
  });
  registerViews(["Dashboard", "Project Tasks", "Boards", "Issues"]); setAvailableViews(null);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);
  // The list comes from a RE-READ after the write, so the fixture's store must move
  // when the write lands — see `create_todo` above.
  /* MOVED (stage 20): the composer's address changed, not the act. "Add task" opened
     an inline form in the detail pane (`form.project-work-form`); the primary is now
     "New task" and opens the shared TaskDrawer (`form.task-drawer-form`), the same
     shape tickets, meetings and documents are created in. The write asserted below is
     unchanged: a title typed into the task composer reaches the backend as
     `create_todo`, scoped to this project and to the caller. */
  await until(() => host.textContent?.includes("New task") === true);
  ([...host.querySelectorAll("button")].find(button => button.textContent === "New task") as HTMLButtonElement).click();
  const title = host.querySelector('input[aria-label="Task title"]') as HTMLInputElement;
  title.value = "Ship the fix";
  title.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Ship the fix" }));
  (host.querySelector("form.task-drawer-form") as HTMLFormElement).dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  await until(() => calls.some(call => call.command === "create_todo"));
  const write = calls.find(call => call.command === "create_todo")!;
  expect(write.body.input).toMatchObject({ profile_id: "pa", project_id: "p1", content: "Ship the fix", done: false });
  await until(() => host.textContent?.includes("Ship the fix") === true);
  // A task surface writes tasks and NOTHING else — there is no ticket composer here
  // any more, so no ticket can be created by accident from a page about tasks.
  expect(calls.some(call => call.command === "create_issue")).toBe(false);
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Add ticket")).toBe(false);
});

/* MOVED HERE (stage 12d), from the tail of the test above: creating a ticket used
   to be asserted against ProjectTasks' "Add ticket" composer. That composer left
   with the ticket list, so the same write is now asserted against the surface that
   owns tickets — `Issues` and its create drawer. The assertion is unchanged in
   substance: a ticket title typed into the ticket composer reaches the backend as
   `create_issue`, scoped to the project. Nothing was weakened; only the address of
   the composer changed. */
test("the tickets surface still creates a ticket, scoped to its project", async () => {
  setProfileId("pa");
  setProjectId("p1");
  serve({
    list_projects: [{ id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false }],
    list_project_member_ids: ["pa"], list_issues: [], list_issue_statuses: [], list_planning_tags: [],
    create_issue: { ...issue, id: "new-issue", number: 8, title: "Track the fix", status_id: null, due_date: null },
  });
  registerViews(["Dashboard", "Project Tasks", "Boards", "Issues"]); setAvailableViews(null);
  navigate({ view: "Issues" });
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <Issues />, host);
  await until(() => [...host.querySelectorAll("button")].some(button => button.textContent === "New ticket" && !button.disabled));
  ([...host.querySelectorAll("button")].find(button => button.textContent === "New ticket" && !button.disabled) as HTMLButtonElement).click();
  await until(() => !!host.querySelector('input[aria-label="Ticket title"]') || !!document.querySelector('input[aria-label="Ticket title"]'));
  const issueTitle = (host.querySelector('input[aria-label="Ticket title"]') ?? document.querySelector('input[aria-label="Ticket title"]')) as HTMLInputElement;
  issueTitle.value = "Track the fix";
  issueTitle.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Track the fix" }));
  (issueTitle.closest("form") as HTMLFormElement).dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  await until(() => calls.some(call => call.command === "create_issue"));
  expect(calls.find(call => call.command === "create_issue")?.body.input).toMatchObject({ project_id: "p1", title: "Track the fix", archived: false });

  /* Also moved from that test: the tag filter reaching the backend as `tag_id`
     alongside the project. HONEST LIMIT (unchanged): driving the select through a
     synthetic `change` reaches Solid's handler on macOS but not on Linux CI, so
     the wire is asserted, not the event. */
  calls.length = 0;
  await planningApi.issues({ project_id: "p1", tag_id: "t1" });
  /* `slice(-1)` no longer identifies it: the live Issues view refetches its own
     unfiltered list after the create, so the last call on the wire is the view's.
     Identify the call by what it carries instead of by when it happened. */
  const tagged = calls.filter(call => call.command === "list_issues" && call.body.tag_id === "t1");
  expect(tagged.length).toBe(1);
  expect(tagged[0]!.body).toMatchObject({ project_id: "p1", tag_id: "t1" });
});

/* ── EDITING IS IN THE ROW (stage 20, product owner) ────────────────────────
   *"The task should simply be clickable, so that you edit the task IN ITSELF."*
   The detail pane that used to display a task read-only is gone, and with it the
   line that sent the reader to another surface to change anything. These two tests
   are NEW coverage for the write that surface never had: the row opens itself, Enter
   on the title saves, and Escape closes without writing anything. */
test("clicking a project task opens it in its own row, and Enter on the title saves", async () => {
  setProfileId("pa");
  let stored: unknown[] = [{ ...sharedTask, profile_id: "pa", content: "Review the plan" }];
  serve({
    list_projects: [{ id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false }],
    list_project_member_ids: ["pa"],
    list_project_todos: () => stored,
    project_dashboard_aggregate: { project_id: "p1", open_issues: 0, open_todos: 1, member_count: 1, deadline: null },
    update_todo: (args: Record<string, unknown>) => { const todo = args.todo as Record<string, unknown>; stored = [todo]; return todo; },
  });
  registerViews(["Dashboard", "Project Tasks", "Boards", "Issues"]); setAvailableViews(null);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);
  await until(() => !!host.querySelector(".project-task-row"));

  // The row is a real <button>, so it is keyboard-reachable and openable for free.
  const row = host.querySelector('.project-task-row .task-row-main') as HTMLButtonElement;
  expect(row.tagName).toBe("BUTTON");
  row.click();
  await until(() => !!host.querySelector(".task-row-editing"));
  // It opened IN PLACE: the editor sits in the same list item the row occupied.
  expect(host.querySelector("li > .task-row-editing")).not.toBeNull();
  const title = host.querySelector(".task-row-editing input.composer-title") as HTMLInputElement;
  expect(title.value).toBe("Review the plan");

  title.value = "Review the revised plan";
  title.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
  title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await until(() => calls.some(call => call.command === "update_todo"));
  const write = calls.find(call => call.command === "update_todo")!;
  expect((write.body.todo as Record<string, unknown>).id).toBe("t1");
  expect((write.body.todo as Record<string, unknown>).content).toBe("Review the revised plan");
  // Identity survives a write that only touched the title.
  expect((write.body.todo as Record<string, unknown>).profile_id).toBe("pa");
  // The editor closes back into a row, carrying the new title.
  await until(() => !host.querySelector(".task-row-editing") && host.textContent?.includes("Review the revised plan") === true);
});

test("Escape closes the row editor without writing", async () => {
  setProfileId("pa");
  serve({
    list_projects: [{ id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false }],
    list_project_member_ids: ["pa"],
    list_project_todos: [{ ...sharedTask, profile_id: "pa", content: "Review the plan" }],
    project_dashboard_aggregate: { project_id: "p1", open_issues: 0, open_todos: 1, member_count: 1, deadline: null },
  });
  registerViews(["Dashboard", "Project Tasks", "Boards", "Issues"]); setAvailableViews(null);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);
  await until(() => !!host.querySelector(".project-task-row"));
  (host.querySelector('.project-task-row .task-row-main') as HTMLButtonElement).click();
  await until(() => !!host.querySelector(".task-row-editing"));

  const title = host.querySelector(".task-row-editing input.composer-title") as HTMLInputElement;
  title.value = "Something else entirely";
  title.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
  title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await until(() => !host.querySelector(".task-row-editing"));
  expect(calls.some(call => call.command === "update_todo")).toBe(false);
  expect(host.textContent).toContain("Review the plan");
  expect(host.textContent).not.toContain("Something else entirely");
});

/* Keyboard-only reachability, and the focus contract: opening moves the caret into the
   first field, closing gives the focus back to the ROW — not to nothing. The row is
   re-created by the re-read that follows a save, so it is found again by task id
   (`data-task-row`), never by holding on to the element that opened the editor. */
test("focus goes into the editor on open and back to the row on close", async () => {
  setProfileId("pa");
  serve({
    list_projects: [{ id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false }],
    list_project_member_ids: ["pa"],
    list_project_todos: [{ ...sharedTask, profile_id: "pa", content: "Review the plan" }],
    project_dashboard_aggregate: { project_id: "p1", open_issues: 0, open_todos: 1, member_count: 1, deadline: null },
  });
  registerViews(["Dashboard", "Project Tasks", "Boards", "Issues"]); setAvailableViews(null);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);
  await until(() => !!host.querySelector(".project-task-row"));
  const row = host.querySelector('.task-row-main[data-task-row="t1"]') as HTMLButtonElement;
  expect(row).not.toBeNull();
  row.click();
  await until(() => !!host.querySelector(".task-row-editing"));
  expect(document.activeElement).toBe(host.querySelector(".task-row-editing input.composer-title"));

  (host.querySelector(".task-row-editing input.composer-title") as HTMLInputElement)
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await until(() => document.activeElement === host.querySelector('.task-row-main[data-task-row="t1"]'));
  expect((document.activeElement as HTMLElement).getAttribute("data-task-row")).toBe("t1");
});
