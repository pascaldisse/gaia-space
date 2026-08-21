import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Boards from "./Boards";
import { setProfileId, setProjectId } from "../session";

// A column with no mapped status silently refused every issue — the server answers
// "Column needs at least one mapped status before moving issues" (src-tauri/src/issues.rs).
// Moving into such a column now maps a status named after the column first.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
let calls: { cmd: string; body: any }[] = [];
// The session is process-global and localStorage-backed: a test that sets it and
// walks away decides what the NEXT file renders (a leaked project id made the
// projects view mount a whole board and the deadline control vanished).
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; globalThis.fetch = realFetch; calls = []; setProjectId(""); setProfileId(""); });

const open = { id: "c-open", board_id: "b1", name: "open", ordering: 0, status_ids: ["s-open"] };
const progress = { id: "c-prog", board_id: "b1", name: "in progress", ordering: 1, status_ids: [] as string[] };
const issue = { id: "i1", project_id: "p1", number: 3, title: "test issue", description: null, status_id: "s-open", assignee_id: null, created_by: null, due_date: null, priority: null, archived: false };

const serve = () => {
  globalThis.fetch = (async (url: any, init: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ cmd, body });
    const table: Record<string, unknown> = {
      list_boards: [{ id: "b1", project_id: "p1", name: "B1", backlog_type: "MANUAL", archived: false }],
      list_issue_statuses: [{ id: "s-open", project_id: "p1", name: "open", resolved: false, color: "#fff", ordering: 0 }],
      list_board_columns: [open, progress],
      list_board_issues: [issue],
      list_backlog_issues: [],
      list_sprints: [],
      get_issue_detail: { ...issue, tags: [], checklists: [], time_total_minutes: 0, children: [] },
      create_issue_status: { id: "s-prog", project_id: "p1", name: "in progress", resolved: false, color: "#00c2a8", ordering: 1 },
      save_board_column: { ...progress, status_ids: ["s-prog"] },
      move_issue_on_board: null,
    };
    return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};
const settle = () => new Promise(done => setTimeout(done, 60));

describe("board columns accept work", () => {
  test("moving into an unmapped column maps a status before the move", async () => {
    setProjectId("p1");
    serve();
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <Boards />, host);
    await settle();

    const button = [...host.querySelectorAll(".card-move button")].find(b => b.textContent?.includes("in progress")) as HTMLButtonElement;
    expect(button).toBeTruthy();
    button.click();
    await settle();

    const mapped = calls.find(c => c.cmd === "save_board_column");
    const moved = calls.findIndex(c => c.cmd === "move_issue_on_board");
    expect(mapped?.body.input.status_ids).toEqual(["s-prog"]);
    expect(moved).toBeGreaterThan(calls.findIndex(c => c.cmd === "save_board_column"));
    expect(calls[moved].body.columnId).toBe("c-prog");
  });
});
