import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import TeamTasks from "./TeamTasks";
import ProjectTasks from "./ProjectTasks";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

// Team Tasks answers "who is on what", across every project the caller belongs to.
// Its defaults ARE the feature: all people, running work only.

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;

const projects = [
  { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "me", archived: false, deadline: null, lead_id: "other" },
  { id: "p2", name: "Borealis", key: "BOR", description: null, created_by: "other", archived: false, deadline: null, lead_id: null },
];
const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "other", username: "other", display_name: "Other Person", email: null, archived: false },
];
const teamTodos = [
  { id: "t1", profile_id: "me", content: "Atlas mine", due_date: null, project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: ["me"], content_kind: "text" },
  { id: "t2", profile_id: "other", content: "Atlas theirs", due_date: "2020-01-01", project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: ["other"], content_kind: "text" },
  { id: "t3", profile_id: "other", content: "Borealis theirs", due_date: null, project_id: "p2", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: ["other"], content_kind: "text" },
];

// Failure switches for master's load-failure requirements (5680579), adapted to this
// file's fixture: a read that fails is an ERROR the view must name, never silence.
let failProjectReload = false;
let failTeamTodos = false;
let teamTodoResponse: typeof teamTodos | [] = teamTodos;

const reply = (cmd: string) => {
  if (cmd === "list_projects") return failProjectReload ? new Error("projects unavailable") : projects;
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_team_todos") return failTeamTodos ? new Error("team tasks unavailable") : teamTodoResponse;
  if (cmd === "list_project_todos") return teamTodos.filter(todo => todo.project_id === "p1");
  if (cmd === "list_project_member_ids") return ["me", "other"];
  return [];
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const mount = async (component: () => unknown, options: { failProjectReload?: boolean; failTeamTodos?: boolean } = {}) => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); const result = reply(cmd); return result instanceof Error ? Promise.reject(result) : Promise.resolve(result); } };
  registerViews(["Projects", "Team Tasks", "Project Tasks"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  // The session cache is seeded from a SUCCESSFUL read first; the switches then decide
  // what the view's own reload sees, exactly as master's fixture did.
  setProfileId("me"); await reloadProjects();
  failProjectReload = options.failProjectReload ?? false; failTeamTodos = options.failTeamTodos ?? false;
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; teamTodoResponse = teamTodos; failProjectReload = false; failTeamTodos = false; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); });

describe("team tasks", () => {
  test("groups running todos from every project, including other people's", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    const groups = Array.from(host.querySelectorAll(".tt-group")).map(group => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Atlas", "Borealis"]);
    /* ADDRESS ONLY (task-card pass): the team row is the shared task TILE now
       (`.task-tile`, views/taskCards.css), so its title is `.task-tile-title` instead
       of a bare <strong>. Same three rows, same order, same grouping. */
    const rows = Array.from(host.querySelectorAll(".task-tile .task-tile-title")).map(node => node.textContent);
    expect(rows).toEqual(["Atlas mine", "Atlas theirs", "Borealis theirs"]);
    // Creator and assignee of somebody else's task are both visible.
    expect(host.textContent).toContain("Other Person");
    // Each group heading links to that project's Project Tasks view.
    const hrefs = Array.from(host.querySelectorAll<HTMLAnchorElement>(".tt-group-head a")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["/projects/p1/tasks", "/projects/p2/tasks"]);
  });

  test("assignee filter defaults to ALL people and completed work is hidden", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    const call = calls.find(entry => entry.cmd === "list_team_todos")!;
    // Only the caller's own identity is sent (authorization subject), never an
    // assignee narrowing — the default view is everybody's work.
    expect(call.args).toMatchObject({ profileId: "me", includeDone: false });
    /* ADDRESS ONLY (picker pass): the assignee filter is a PillMenu now — the
       product draws its open state instead of handing it to the operating system.
       The resting control is a named button whose LABEL is the current value, so
       "no narrowing" is readable without opening it. */
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Assignee"]')!;
    expect(picker.textContent).toContain("All profiles");
    /* ADDRESS ONLY (task-card pass): "Show done" is a toggle BUTTON in the one
       action row now, beside "New task" — it only ever ADDS rows, so it never belonged
       behind the "Filter" disclosure. Off is still the default, which is the fact
       under test. */
    const done = [...host.querySelectorAll<HTMLButtonElement>(".task-actionbar button")].find(button => button.textContent === "Show done")!;
    expect(done.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelectorAll(".task-tile").length).toBe(3);
  });

  // ── master's load-failure requirements (5680579), adapted to our empty-state copy ──
  test("reports team task load failure without rendering an empty state", async () => {
    const host = await mount(() => <TeamTasks /> as any, { failTeamTodos: true });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load team tasks: Error: team tasks unavailable");
    expect(host.textContent).not.toContain("No team tasks match these filters.");
    expect(host.textContent).not.toContain("Nobody has a running task yet");
  });

  test("reports project metadata load failure without fabricating a project label", async () => {
    const host = await mount(() => <TeamTasks /> as any, { failProjectReload: true });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load team tasks: Error: projects unavailable");
    expect(host.textContent).not.toContain("Nobody has a running task yet");
    expect(host.textContent).not.toContain("Unknown project");
  });

  test("shows the nothing-yet state only after successful loads return zero rows", async () => {
    teamTodoResponse = [];
    const host = await mount(() => <TeamTasks /> as any);
    expect(host.textContent).toContain("Nobody has a running task yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  test("show done re-reads with include_done", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    // ADDRESS ONLY: the toggle is a button in the action row (see above); the write it
    // triggers — a re-read with include_done — is unchanged.
    const done = [...host.querySelectorAll<HTMLButtonElement>(".task-actionbar button")].find(button => button.textContent === "Show done")!;
    done.click();
    await settle();
    expect(calls.filter(entry => entry.cmd === "list_team_todos").some(entry => entry.args.includeDone === true)).toBe(true);
  });
});

describe("informational-lead law", () => {
  // p1's lead is "other". Acting as "me" (a plain member, NOT the lead) must change nothing.
  test("a non-lead member sees every task and can still create tasks for other people", async () => {
    const host = await mount(() => { navigate({ view: "Project Tasks", projectId: "p1" }); return <ProjectTasks /> as any; });
    const rows = Array.from(host.querySelectorAll(".project-task-row .task-tile-title")).map(node => node.textContent);
    /* ORDER, not membership (task-card pass): the project list is grouped Today /
       Later / No date, the same three groups My tasks uses. "Atlas theirs" is due
       2020-01-01 (overdue = today's work), "Atlas mine" has no date. Both are still
       there, which is the law under test. */
    expect(rows).toEqual(["Atlas theirs", "Atlas mine"]);
    /* MOVED (stage 20): the assignee checkboxes used to live in the detail pane's
       inline form (`.project-work-people`). That form is gone — creation is the shared
       TaskDrawer now.
       ADDRESS ONLY AGAIN (2026-08-29, one-form pass): the drawer no longer draws a
       field list of its own — it renders THE task editor (TaskRowEdit) in create mode,
       so assignees are picked in the same Assignee control an EDIT uses, a popover of
       options, not a `.wid-people` checkbox list. The law under test is untouched and
       is asserted on the new address: a plain member opens creation and is offered
       every member of the project, the lead included, with nothing disabled. */
    /* ADDRESS ONLY (task-card pass): the header's actions area is gone — the primary
       lives in the surface's ONE action row (`.task-actionbar`), as on My tasks. */
    host.querySelector<HTMLButtonElement>(".task-actionbar .doc-action-primary")!.click();
    await settle();
    const assignee = [...host.querySelectorAll<HTMLButtonElement>(".wid-panel .tm-trigger")]
      .find(button => button.querySelector(".tm-label")?.textContent === "Assignee")!;
    expect(assignee.disabled).toBe(false);
    assignee.click();
    await settle();
    const others = Array.from(host.querySelectorAll(".wid-panel .tm-menu [role=option]"));
    expect(others.map(node => node.querySelector(".tm-opt-name")?.textContent)).toEqual(["Me", "Other Person"]);
  });
});
