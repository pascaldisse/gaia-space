import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import IssueDetail from "./IssueDetail";
import { planningApi } from "../api/issues";

// `get_issue_detail` serialises the issue FLATTENED into the detail object
// (`#[serde(flatten)]` in src-tauri/src/issues.rs). The client used to read
// `detail.issue`, got undefined, and the panel sat on "Loading issue…" forever —
// so an issue appeared to have no title, assignee, due date, priority or sub-items.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; globalThis.fetch = realFetch; });

const flat = {
  id: "i1", project_id: "p1", number: 3, title: "test issue", description: "the body",
  status_id: "s1", assignee_id: "pa", created_by: "pa", due_date: "2026-08-30", priority: "HIGH", archived: false,
  tags: [{ id: "t1", project_id: "p1", parent_id: null, name: "bug", archived: false }],
  checklists: [{ id: "c1", issue_id: "i1", title: "Acceptance", ordering: 0 }],
  time_total_minutes: 45,
  children: [{ id: "i2", project_id: "p1", number: 4, title: "sub work", description: null, status_id: null, assignee_id: null, created_by: null, due_date: null, priority: null, archived: false }],
};

const serve = (table: Record<string, unknown>) => {
  globalThis.fetch = (async (url: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};
const settle = () => new Promise(done => setTimeout(done, 40));

describe("issue detail contract", () => {
  test("the flattened server shape is normalised into { issue, … }", async () => {
    serve({ get_issue_detail: flat });
    const detail = await planningApi.issue("i1");
    expect(detail?.issue.number).toBe(3);
    expect(detail?.issue.priority).toBe("HIGH");
    expect(detail?.children.length).toBe(1);
    expect(detail?.time_total_minutes).toBe(45);
  });

  test("the nested shape still works", async () => {
    const { tags, checklists, time_total_minutes, children, ...issue } = flat as any;
    serve({ get_issue_detail: { issue, tags, checklists, time_total_minutes, children } });
    const detail = await planningApi.issue("i1");
    expect(detail?.issue.title).toBe("test issue");
  });

  test("the panel renders the work instead of loading forever", async () => {
    serve({ get_issue_detail: flat, list_checklist_items: [] });
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueDetail issueId="i1" statuses={[{ id: "s1", project_id: "p1", name: "open", resolved: false, color: "#fff", ordering: 0 }]} />, host);
    await settle();

    expect(host.textContent).not.toContain("Loading issue");
    expect(host.textContent).toContain("#3");
    expect((host.querySelector(".idp-title") as HTMLInputElement).value).toBe("test issue");
    expect((host.querySelector(".idp-description") as HTMLTextAreaElement).value).toBe("the body");
    expect((host.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-08-30");
    // status, priority, sub-items and time all belong to the same one surface
    expect(host.textContent).toContain("Acceptance");
    expect(host.textContent).toContain("#4 sub work");
    expect(host.textContent).toContain("45 min");
    expect(host.textContent).toContain("bug");
    const priority = [...host.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "URGENT"))!;
    expect(priority.value).toBe("HIGH");
  });
});
