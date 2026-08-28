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

const reply = (cmd: string) => {
  if (cmd === "list_projects") return projects;
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_team_todos") return teamTodos;
  if (cmd === "list_project_todos") return teamTodos.filter(todo => todo.project_id === "p1");
  if (cmd === "list_project_member_ids") return ["me", "other"];
  return [];
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const mount = async (component: () => unknown) => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd)); } };
  registerViews(["Projects", "Team Tasks", "Project Tasks"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  setProfileId("me"); await reloadProjects();
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); });

describe("team tasks", () => {
  test("groups running todos from every project, including other people's", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    const groups = Array.from(host.querySelectorAll(".tt-group")).map(group => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Atlas", "Borealis"]);
    const rows = Array.from(host.querySelectorAll(".tt-row strong")).map(node => node.textContent);
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
    // The assignee filter is a PillSelect now (value-as-label); it is still the
    // same native <select>, named by aria-label instead of a caption beside it.
    const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Assignee"]')!;
    expect(picker.value).toBe("");
    const done = host.querySelector<HTMLInputElement>('input[aria-label="Show completed"]')!;
    expect(done.checked).toBe(false);
    expect(host.querySelectorAll(".tt-row").length).toBe(3);
  });

  test("show completed re-reads with include_done", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    const done = host.querySelector<HTMLInputElement>('input[aria-label="Show completed"]')!;
    done.checked = true; done.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.filter(entry => entry.cmd === "list_team_todos").some(entry => entry.args.includeDone === true)).toBe(true);
  });
});

describe("informational-lead law", () => {
  // p1's lead is "other". Acting as "me" (a plain member, NOT the lead) must change nothing.
  test("a non-lead member sees every task and can still create tasks for other people", async () => {
    const host = await mount(() => { navigate({ view: "Project Tasks", projectId: "p1" }); return <ProjectTasks /> as any; });
    const rows = Array.from(host.querySelectorAll(".project-task-row strong")).map(node => node.textContent);
    expect(rows).toEqual(["Atlas mine", "Atlas theirs"]);
    host.querySelectorAll<HTMLButtonElement>(".planning-actions button")[0].click();
    await settle();
    const others = Array.from(host.querySelectorAll<HTMLInputElement>(".project-work-people input[type=checkbox]"));
    expect(others.length).toBe(2);
    expect(others.every(box => !box.disabled)).toBe(true);
  });
});
