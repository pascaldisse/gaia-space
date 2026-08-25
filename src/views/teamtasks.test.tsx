import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import TeamTasks from "./TeamTasks";
import ProjectTasks from "./ProjectTasks";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId, setProjectId } from "../session";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;
let failProjectReload = false;
let failTeamTodos = false;
const projects = [
  { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "me", archived: false, deadline: null, lead_id: "other" },
  { id: "p2", name: "Borealis", key: "BOR", description: null, created_by: "other", archived: false, deadline: null, lead_id: null },
];
const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "other", username: "other", display_name: "Other person", email: null, archived: false },
];
const todos = [
  { id: "mine", profile_id: "me", content: "Mine", due_date: null, project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: ["me"], content_kind: "text" },
  { id: "theirs", profile_id: "other", content: "Theirs", due_date: null, project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: ["other"], content_kind: "text" },
  { id: "other-project", profile_id: "other", content: "Other project", due_date: null, project_id: "p2", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: ["other"], content_kind: "text" },
];
let teamTodoResponse = todos;
const response = (command: string) => {
  if (command === "list_projects") {
    if (failProjectReload) return new Error("projects unavailable");
    return projects;
  }
  if (command === "list_profiles") return profiles;
  if (command === "list_team_todos") {
    if (failTeamTodos) return new Error("team tasks unavailable");
    return teamTodoResponse;
  }
  if (command === "list_project_todos") return todos.filter(todo => todo.project_id === "p1");
  if (command === "list_project_member_ids") return ["me", "other"];
  return [];
};
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
async function mount(component: () => unknown, options: { failProjectReload?: boolean; failTeamTodos?: boolean } = {}) {
  (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: Record<string, unknown>) => { calls.push({ command, args }); const result = response(command); return result instanceof Error ? Promise.reject(result) : Promise.resolve(result); } };
  registerViews(["Projects", "Team Tasks", "Project Tasks"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  setProfileId("me"); await reloadProjects(); failProjectReload = options.failProjectReload ?? false; failTeamTodos = options.failTeamTodos ?? false;
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(component as any, host); await settle();
  return host;
}
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; teamTodoResponse = todos; failProjectReload = false; failTeamTodos = false; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); });

describe("Team Tasks", () => {
  test("shows every member's open project work by project and defaults to all assignees", async () => {
    const host = await mount(() => <TeamTasks /> as any);
    expect(Array.from(host.querySelectorAll(".tt-group")).map(group => group.getAttribute("aria-label"))).toEqual(["Atlas", "Borealis"]);
    expect(Array.from(host.querySelectorAll(".tt-row strong")).map(row => row.textContent)).toEqual(["Mine", "Theirs", "Other project"]);
    expect(calls.find(call => call.command === "list_team_todos")?.args).toMatchObject({ profileId: "me", includeDone: false });
    expect(host.querySelector<HTMLSelectElement>(".picker select")?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Show completed"]')?.checked).toBe(false);
  });

  test("reports team task load failure without rendering the empty state", async () => {
    const host = await mount(() => <TeamTasks /> as any, { failTeamTodos: true });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load team tasks: Error: team tasks unavailable");
    expect(host.textContent).not.toContain("No team tasks match these filters.");
  });
  test("reports project metadata load failure without fabricating a project label", async () => {
    const host = await mount(() => <TeamTasks /> as any, { failProjectReload: true });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load team tasks: Error: projects unavailable");
    expect(host.textContent).not.toContain("No team tasks match these filters.");
    expect(host.textContent).not.toContain("Unavailable project");
  });
  test("shows the empty state only after successful loads return zero matches", async () => {
    teamTodoResponse = [];
    const host = await mount(() => <TeamTasks /> as any);
    expect(host.textContent).toContain("No team tasks match these filters.");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  test("informational lead does not hide another member's tasks or disable assignment", async () => {
    const host = await mount(() => { navigate({ view: "Project Tasks", projectId: "p1" }); return <ProjectTasks /> as any; });
    expect(Array.from(host.querySelectorAll(".project-task-row strong")).map(row => row.textContent)).toEqual(["Mine", "Theirs"]);
    host.querySelector<HTMLButtonElement>(".planning-actions button")!.click(); await settle();
    const assignees = Array.from(host.querySelectorAll<HTMLInputElement>(".project-work-people input[type=checkbox]"));
    expect(assignees).toHaveLength(2);
    expect(assignees.every(input => !input.disabled)).toBe(true);
  });
});
