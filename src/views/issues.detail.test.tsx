import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import IssueDetail from "./IssueDetail";
import { planningApi } from "../api/issues";
import { reloadProfiles } from "../session";

// `get_issue_detail` serialises the issue FLATTENED into the detail object
// (`#[serde(flatten)]` in src-tauri/src/issues.rs). The client used to read
// `detail.issue`, got undefined, and the panel sat on "Loading issue…" forever —
// so an issue appeared to have no title, assignee, due date, priority or sub-items.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; globalThis.fetch = realFetch; });

const flat = {
  id: "i1", project_id: "p1", number: 3, title: "test issue", description: "the body",
  status_id: "s1", assignee_id: "pa", assignee_ids: ["pa", "pb"], created_by: "pa", due_date: "2026-08-30", priority: "HIGH", archived: false,
  tags: [{ id: "t1", project_id: "p1", parent_id: null, name: "bug", archived: false }],
  checklists: [{ id: "c1", issue_id: "i1", title: "Acceptance", ordering: 0 }],
  time_total_minutes: 45,
  comments: [{ id: "cm1", issue_id: "i1", author_id: "pa", body: "Please verify the fix.", created_at: 1_700_000_000, edited_at: null }],
  activities: [{ id: "ac1", issue_id: "i1", activity_type: "created", actor_id: "pa", detail: "Issue created", created_at: 1_700_000_000 }],
  children: [{ id: "i2", project_id: "p1", number: 4, title: "sub work", description: null, status_id: null, assignee_id: "pb", assignee_ids: ["pb"], created_by: null, due_date: "2026-09-01", priority: null, archived: false }],
};
const child = { ...flat.children[0], tags: [], checklists: [], time_total_minutes: 0, children: [] };
const people = [
  { id: "pa", username: "alice", display_name: "Alice", archived: false, created_at: 0 },
  { id: "pb", username: "bob", display_name: "Bob", archived: false, created_at: 0 },
  { id: "pd", username: "dora", display_name: "Dora", archived: false, created_at: 0 },
];

let sent: { cmd: string; body: any }[] = [];
const serve = (table: Record<string, unknown>) => {
  sent = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    sent.push({ cmd, body: init?.body ? JSON.parse(init.body) : {} });
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
    /* ADDRESS ONLY (date-field pass): the due date is picked in the product's own month
       grid now (components/DateField.tsx) — a native `<input type=date>` drew its calendar
       in a layer no CSS reaches. The stored value is the same ISO string; what a test can
       read is the WRITTEN form the trigger shows, which is the point of the control. */
    expect(host.querySelector('.idp-field button.date-trigger')?.textContent).toContain("Aug 30, 2026");
    // status, priority, sub-items and time all belong to the same one surface
    expect(host.textContent).toContain("Acceptance");
    expect(host.textContent).toContain("#4 sub work");
    expect(host.textContent).toContain("45 min");
    expect(host.textContent).toContain("bug");
expect(host.textContent).toContain("Please verify the fix.");
// The stored activity detail still reads "Issue created" (fixture line 25) — the
// view translates it at render, so old rows read as tickets without a migration.
expect(host.textContent).toContain("Ticket created");
    const priority = [...host.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "URGENT"))!;
    expect(priority.value).toBe("HIGH");
  });

  test("posting a comment is wired to the persisted issue command", async () => {
serve({ get_issue_detail: flat, create_issue_comment: { ...flat.comments[0], id: "cm2", body: "Ship it" } });
const host = document.createElement("div"); document.body.appendChild(host);
dispose = render(() => <IssueDetail issueId="i1" />, host);
await settle();
const input = host.querySelector('textarea[aria-label="New comment"]') as HTMLTextAreaElement;
input.value = "Ship it"; input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Ship it" }));
(host.querySelector(".comment-form button") as HTMLButtonElement).click();
await settle();
const write = sent.find(c => c.cmd === "create_issue_comment");
expect(write?.body.input).toEqual({ issue_id: "i1", author_id: null, body: "Ship it" });
});
test("an issue carries several people, and only project members can be added", async () => {
    serve({ get_issue_detail: flat, list_profiles: people, list_project_member_ids: ["pa", "pb"], set_issue_assignees: ["pa", "pb", "pd"] });
    await reloadProfiles();
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueDetail issueId="i1" />, host);
    await settle();

    // Both assignees are shown as removable chips — not one dropdown value.
    const chips = [...host.querySelectorAll(".assignee-chip")].map(c => c.textContent);
    expect(chips.length).toBe(2);
    expect(chips.join(" ")).toContain("Alice");
    expect(chips.join(" ")).toContain("Bob");
    expect(host.textContent).toContain("Assigned to Alice, Bob");

    // The add list offers project members who are not already on the issue — never outsiders.
    const add = host.querySelector('select[aria-label="Add assignee"]') as HTMLSelectElement;
    const offered = [...add.options].map(o => o.textContent);
    expect(offered).not.toContain("Alice");
    expect(offered).not.toContain("Dora");

    // Removing one writes the remaining list, never a single id.
    (host.querySelector('.assignee-chip button[aria-label="Remove Alice"]') as HTMLButtonElement).click();
    await settle();
    const write = sent.find(c => c.cmd === "set_issue_assignees");
    expect(write?.body.profileIds).toEqual(["pb"]);
  });

  test("a sub-issue opens as the issue it is, with its own people, and comes back", async () => {
    serve({ get_issue_detail: flat, list_profiles: people, list_project_member_ids: ["pa", "pb"] });
    await reloadProfiles();
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueDetail issueId="i1" />, host);
    await settle();

    // The sub-item shows who works it before you even open it.
    expect(host.querySelector(".idp-child-people")?.textContent).toContain("Bob");

    serve({ get_issue_detail: child, list_profiles: people, list_project_member_ids: ["pa", "pb"] });
    (host.querySelector(".idp-child.link") as HTMLButtonElement).click();
    await settle();

    // It is a full issue surface: its own number, description, dates, assignees.
    expect((host.querySelector(".idp-title") as HTMLInputElement).value).toBe("sub work");
    // ADDRESS ONLY (date-field pass), as above: the trigger states the date in words.
    expect(host.querySelector('.idp-field button.date-trigger')?.textContent).toContain("Sep 1, 2026");
    expect([...host.querySelectorAll(".assignee-chip")].map(c => c.textContent).join(" ")).toContain("Bob");

    serve({ get_issue_detail: flat, list_profiles: people, list_project_member_ids: ["pa", "pb"] });
    (host.querySelector(".idp-back") as HTMLButtonElement).click();
    await settle();
    expect((host.querySelector(".idp-title") as HTMLInputElement).value).toBe("test issue");
  });
});
