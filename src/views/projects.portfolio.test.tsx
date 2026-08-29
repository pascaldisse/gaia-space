import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Projects, { DESCRIPTION_MAX, deriveKey, shortDescription } from "./Projects";
import { setProfileId, setProjectId } from "../session";

// The portfolio strip and the per-row health signals are read off ONE issue read plus
// ONE status read (plus one task read and one channel read), whatever the number of
// projects. A failed count is an error on screen, never a silent zero.
//
// `/projects` IS A LIST (stage 19): the row shows what tells you whether a project is
// healthy — open tickets, open tasks, unread, deadline, lead — and the health chips run
// through `metricTone`, so a count of 0 carries no tone.

/** The health chips of one row, in document order. */
const healthOf = (host: HTMLElement) =>
  [...host.querySelectorAll(".project-card")].map((card) =>
    [...card.querySelectorAll(".project-health .paper-pill")].map((pill) => pill.textContent),
  );

const calls: { cmd: string; args: any }[] = [];
let reply: (cmd: string) => unknown = () => [];
let dispose: (() => void) | undefined;

const stubTauriIpc = () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => {
      calls.push({ cmd, args });
      const value = reply(cmd);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
  };
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  reply = () => [];
  delete (window as any).__TAURI_INTERNALS__;
  // Session state is process-global: hand it back the way you found it.
  setProjectId(""); setProfileId("");
});

const settle = () => new Promise((done) => setTimeout(done, 40));
const project = (over: Record<string, unknown> = {}) => ({
  id: "p1", name: "Atlas", key: "ATL", description: null,
  created_by: "p-owner", archived: false, deadline: null, ...over,
});
const issue = (over: Record<string, unknown> = {}) => ({
  id: "i1", project_id: "p1", number: 1, title: "Work", description: null,
  status_id: "open", assignee_id: null, created_by: null, due_date: null,
  priority: null, archived: false, assignee_ids: [], ...over,
});
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Projects /> as any, host);
  await settle();
  return host;
};

describe("portfolio summary and open-issue counts", () => {
  // Nobody types a key any more (it is not a question in the drawer); the name alone
  // produces it, and uniqueness is settled by uniqueKey (projects.members.test.tsx).
  test("a key is derived from the name", () => {
    expect(deriveKey("Marketing site redesign")).toBe("MARKE");
    expect(deriveKey("a-b c!d")).toBe("ABCD");
    expect(deriveKey("")).toBe("");
  });

  /* A CARD MUST ALWAYS FIT IN THE WINDOW. The description is free text with no server
     limit, so the card cuts it — at a word boundary, ending in an ellipsis, never wider
     than DESCRIPTION_MAX. The CSS line-clamp is the second guard and cannot be asserted
     here; what IS asserted is that the DOM never receives more than the limit. */
  test("a description is cut to 96 characters at a word boundary, and a short one is untouched", () => {
    expect(DESCRIPTION_MAX).toBe(96);
    expect(shortDescription(null)).toBe("");
    expect(shortDescription("   ")).toBe("");
    const short = "A small project.";
    expect(shortDescription(short)).toBe(short);

    const long = "Rebuilding the customer portal so that invoices, contracts and support tickets finally live in one place instead of three.";
    const cut = shortDescription(long);
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(cut.endsWith("\u2026")).toBe(true);
    // The cut lands between words: no half word before the ellipsis.
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1).endsWith(" ")).toBe(false);
    expect(long[cut.length - 1]).toBe(" ");

    // One unbroken word longer than any limit still has to fit: the hard cut wins.
    const wall = "x".repeat(300);
    expect(shortDescription(wall)).toBe(`${"x".repeat(95)}\u2026`);
  });

  test("counts come from one issue read and one status read, not one per card", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => {
      if (cmd === "list_projects") return [project(), project({ id: "p2", name: "Borea", key: "BOR", deadline: "2030-01-02" })];
      if (cmd === "list_issue_statuses") return [{ id: "open", project_id: "p1", name: "Open", resolved: false, color: "#fff", ordering: 0 }, { id: "done", project_id: "p1", name: "Done", resolved: true, color: "#fff", ordering: 1 }];
      if (cmd === "list_issues") return [
        issue(), issue({ id: "i2" }),
        issue({ id: "i3", status_id: "done" }),        // resolved -> not open
        issue({ id: "i4", archived: true }),            // archived -> not open
        issue({ id: "i5", project_id: "p2" }),
      ];
      // Open TASKS per project: one cross-project read, grouped client-side.
      if (cmd === "list_team_todos") return [
        { id: "t1", profile_id: "p-owner", content: "Write it", due_date: null, project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: [], content_kind: "text" },
        { id: "t2", profile_id: "p-owner", content: "Done already", due_date: null, project_id: "p1", done: true, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: [], content_kind: "text" },
      ];
      // UNREAD in a project's channels: the signal that a project is talking to you.
      if (cmd === "list_channels_with_meta") return [
        { id: "c1", content_type: "public", name: "general", description: null, project_id: "p2", archived: false, member_count: 2, unread_count: 3, last_message_at: 1 },
      ];
      return [];
    };
    const host = await mount();

    expect(calls.filter((c) => c.cmd === "list_issues")).toHaveLength(1);
    expect(calls.filter((c) => c.cmd === "list_issue_statuses")).toHaveLength(1);
    // THE LAW IS "NOT ONE PER CARD", not "exactly one call": these two reads are keyed
    // on the acting identity, so they legitimately re-run when the session settles.
    // What must never happen is a read that carries a project — that is the N+1 shape.
    const taskReads = calls.filter((c) => c.cmd === "list_team_todos");
    const channelReads = calls.filter((c) => c.cmd === "list_channels_with_meta");
    expect(taskReads.length).toBeGreaterThan(0);
    expect(channelReads.length).toBeGreaterThan(0);
    for (const call of [...taskReads, ...channelReads])
      expect(Object.keys(call.args ?? {})).not.toContain("projectId");
    expect(calls.filter((c) => c.cmd === "list_project_todos")).toHaveLength(0);

    // Atlas: 2 open tickets, 1 running task, nothing unread, no deadline.
    // Borea: 1 open ticket, no task (so the chip is a quiet 0), 3 unread, a deadline.
    // ZERO CARRIES NO TONE, and an unread count of 0 is not a chip at all.
    const health = healthOf(host);
    expect(health[0]).toEqual(["2 open tickets", "1 open tasks"]);
    expect(health[1].slice(0, 3)).toEqual(["1 open tickets", "0 open tasks", "3 unread"]);
    // THE DEADLINE IS NOT A HEALTH CHIP. It is the card's one pill at the edge, the same
    // shape a task tile carries, coloured only by bandTone(deadlineBand(…)); and a card
    // without a date says so quietly rather than going blank.
    expect(health[1]).toHaveLength(3);
    const pills = [...host.querySelectorAll(".project-card .project-due")];
    expect(pills.map((pill) => pill.textContent)).toEqual(["No deadline", "Due 2030-01-02"]);
    expect(pills[0].className).toContain("untoned");
    // 2030 is far away, so the far band — never red for a date nobody is near.
    expect(pills[1].className).toContain("teal");
    const quiet = host.querySelectorAll(".project-health .paper-pill.untoned");
    expect([...quiet].map((pill) => pill.textContent)).toContain("0 open tasks");

    // A ROW IS A LINK: one click, a real href, reachable by keyboard — never a
    // double-click target, and never a `role=button` div.
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".project-card a.project-open-link")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/projects/p1", "/projects/p2"]);

    // Portfolio totals repeated the same facts that the cards already carry and gave
    // two projects three oversized empty tiles. The scalable index has search and
    // explicit work filters instead; the cards remain the single source of project
    // health facts.
    expect(host.querySelectorAll(".metric-tile")).toHaveLength(0);
    expect((host.querySelector('[aria-label="Search projects"]') as HTMLInputElement)?.placeholder).toBe("Search projects");
    expect([...host.querySelectorAll(".portfolio-filters button")].map((button) => button.textContent))
      .toEqual(["All projects", "Needs attention", "Due soon"]);
  });

  test("a refused issue read is an error on screen, never a silent zero", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => {
      if (cmd === "list_projects") return [project()];
      if (cmd === "list_issues") return new Error("not authorized");
      return [];
    };
    const host = await mount();
    const alert = host.querySelector('.error[role="alert"]');
    expect(alert?.textContent).toContain("Open-ticket counts are unavailable");
    // No silent zero: the ticket chip is absent entirely rather than reading "0".
    const chips = [...host.querySelectorAll(".project-health .paper-pill")].map((n) => n.textContent);
    expect(chips.some((text) => text?.includes("open tickets"))).toBe(false);
  });

  test("the board, the matrix report and the access panel have LEFT this page", async () => {
    // They are administration of ONE project and were rendered on the list of EVERY
    // project. They now live in the project you open: board + matrix on its Dev tab,
    // access in its Settings. This is the guard that they do not creep back.
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : []);
    const host = await mount();
    setProjectId("p1"); // even with a project selected, the list stays a list
    await settle();

    expect(host.querySelector(".board-report")).toBeNull();
    expect(host.querySelector(".board-matrix")).toBeNull();
    expect(host.querySelector(".project-access")).toBeNull();
    expect(host.querySelector(".project-open")).toBeNull();
    // Exactly one h1, and it is still the page's own.
    expect([...host.querySelectorAll("h1")].map((n) => n.textContent)).toEqual(["Projects"]);
  });
});
