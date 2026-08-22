import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import ProjectTasks from "./ProjectTasks";
import { navigate, registerViews } from "../router";

let dispose: (() => void) | undefined;
const realFetch = globalThis.fetch;
const issue = { id: "i1", project_id: "p1", number: 7, title: "Plan the release", description: null, status_id: "s1", assignee_id: null, assignee_ids: [], created_by: null, due_date: "2026-08-30", priority: null, archived: false };
let calls: { command: string; body: Record<string, unknown> }[] = [];
const wait = () => new Promise(resolve => setTimeout(resolve, 30));

function serve(table: Record<string, unknown>) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const command = url.split("api/cmd/")[1] ?? url;
    calls.push({ command, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, value: table[command] ?? [] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  dispose?.(); dispose = undefined;
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
  navigate({ view: "Dashboard" });
});

test("project tasks filters persisted issues and links to the matching board", async () => {
  serve({
    list_projects: [{ id: "p1", name: "Orbital", key: "ORB", archived: false }],
    list_profiles: [],
    list_issues: [issue],
    list_issue_statuses: [{ id: "s1", project_id: "p1", name: "In progress", resolved: false, color: "#00c2a8", ordering: 0 }],
    list_planning_tags: [{ id: "t1", project_id: "p1", parent_id: null, name: "release", archived: false }],
  });
  registerViews(["Dashboard", "Project Tasks", "Boards"]);
  navigate({ view: "Project Tasks", projectId: "p1" });
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <ProjectTasks />, host);
  await wait();

  expect(host.textContent).toContain("Plan the release");
  expect(host.textContent).toContain("Open board");
  expect((host.querySelector('a.primary') as HTMLAnchorElement).getAttribute("href")).toContain("boards");
  const tag = host.querySelector('select[aria-label="Filter by tag"]') as HTMLSelectElement;
  tag.value = "t1";
  tag.dispatchEvent(new Event("change", { bubbles: true }));
  await wait();
  expect(calls.filter(call => call.command === "list_issues").at(-1)?.body).toMatchObject({ project_id: "p1", tag_id: "t1" });
});
