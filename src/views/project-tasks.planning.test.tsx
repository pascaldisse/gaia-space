import { afterEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import ProjectTasks from "./ProjectTasks";
import { navigate, registerViews, route } from "../router";
import { projectId } from "../session";

let dispose: (() => void) | undefined;
const realFetch = globalThis.fetch;
const issue = { id: "i1", project_id: "p1", number: 7, title: "Plan the release", description: null, status_id: "s1", assignee_id: null, assignee_ids: [], created_by: null, due_date: "2026-08-30", priority: null, archived: false };
let calls: { command: string; body: Record<string, unknown> }[] = [];
// A fixed sleep is a wager on machine speed: CI lost it (the board link was still
// the pre-load `/dashboard` href after 30ms). Wait for the condition, not the clock.
async function until(check: () => boolean, timeoutMs = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`condition never held; calls=${JSON.stringify(calls)} text=${document.body.textContent?.slice(0, 400)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Serve through the IPC global rather than `mock.module`: an ES module's imports
// are evaluated BEFORE its own `mock.module` call, so a module mock can never fix
// this file's own graph — it only leaks into later files. Both transports (Tauri
// core and the HTTP shim) read this global, so the stub holds whichever one the
// component ended up bound to.
function serve(table: Record<string, unknown>) {
  calls = [];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, body: args ?? {} });
      return table[command] ?? [];
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
  await until(() =>
    host.textContent?.includes("Plan the release") === true &&
    ((host.querySelector("a.primary") as HTMLAnchorElement | null)
      ?.getAttribute("href")
      ?.includes("boards") ?? false));

  expect(host.textContent).toContain("Plan the release");
  expect(host.textContent).toContain("Open board");
  const board = host.querySelector('a.primary') as HTMLAnchorElement;
  expect(board.getAttribute("href")).toContain("boards");
  board.click();
  expect(projectId()).toBe("p1");
  expect(route().view).toBe("Boards");
  // The tag options arrive on their own resource, and the select is re-rendered
  // when they do: a single set+dispatch can land on a node that is about to be
  // replaced (it did, on CI). Keep selecting until the refetch is observed.
  await until(() => {
    if (calls.some(call =>
      call.command === "list_issues" && (call.body as { tag_id?: string }).tag_id === "t1")) return true;
    const tag = host.querySelector('select[aria-label="Filter by tag"]') as HTMLSelectElement | null;
    if (!tag || !Array.from(tag.options).some(option => option.value === "t1")) return false;
    tag.value = "t1";
    tag.dispatchEvent(new Event("change", { bubbles: true }));
    return false;
  });
  expect(calls.filter(call => call.command === "list_issues").slice(-1)[0]?.body).toMatchObject({ project_id: "p1", tag_id: "t1" });
});
