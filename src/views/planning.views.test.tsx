import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Issues from "./Issues";
import ProjectTasks from "./ProjectTasks";
import { setProfileId, setProjectId } from "../session";

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const issue = { id: "i1", project_id: "p1", number: 7, title: "Ship planning", description: null, status_id: "s1", assignee_id: "pa", assignee_ids: ["pa"], created_by: "pa", due_date: null, priority: null, archived: false };
const settle = () => new Promise(resolve => setTimeout(resolve, 60));

const serve = () => {
  globalThis.fetch = (async (url: string) => {
    const command = url.split("api/cmd/")[1] ?? url;
    const table: Record<string, unknown> = {
      list_issues: [issue],
      list_issue_statuses: [{ id: "s1", project_id: "p1", name: "In progress", resolved: false, color: "#00c2a8", ordering: 0 }],
      list_planning_tags: [{ id: "t1", project_id: "p1", parent_id: null, name: "release", archived: false }],
      list_profiles: [{ id: "pa", username: "alice", display_name: "Alice", archived: false, created_at: 0 }],
      list_projects: [{ id: "p1", name: "Planning", key: "PLAN", description: null, deadline: null, archived: false, created_by: "pa" }],
    };
    return new Response(JSON.stringify({ ok: true, value: table[command] ?? [] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProjectId(""); setProfileId("");
});

describe("planning views", () => {
  test("workspace issues exposes persisted status, tag, and assignee filters with a board link", async () => {
    setProjectId("p1"); serve();
    const host = document.createElement("div"); document.body.appendChild(host);
    dispose = render(() => <Issues />, host);
    await settle();
    expect(host.querySelector('select[aria-label="Filter by status"]')).toBeTruthy();
    expect(host.querySelector('select[aria-label="Filter by tag"]')?.textContent).toContain("release");
    expect(host.textContent).toContain("Ship planning");
    expect([...host.querySelectorAll("a")].some(link => link.textContent?.includes("Open board"))).toBe(true);
  });

  test("project tasks scopes the same issue tracker and keeps its board link", async () => {
    setProjectId("p1"); serve();
    const host = document.createElement("div"); document.body.appendChild(host);
    dispose = render(() => <ProjectTasks />, host);
    await settle();
    expect(host.querySelector('select[aria-label="Filter by status"]')).toBeTruthy();
    expect(host.querySelector('select[aria-label="Filter by tag"]')?.textContent).toContain("release");
    expect(host.textContent).toContain("Ship planning");
    expect(host.textContent).toContain("Open board");
  });
});
