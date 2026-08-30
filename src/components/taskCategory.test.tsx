import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Todo from "../views/Todo";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";
import { reloadProjects, setProfileId } from "../session";
import { TODO_CATEGORIES } from "../api/personal";

/** ── A TASK'S CATEGORY ──────────────────────────────────────────────────────
 *
 *  WHAT KIND OF ACT THIS IS — optional, and it must STAY optional: most tasks never
 *  get one, so a task without a category may never look unfinished or broken.
 *
 *  The list is CLOSED and lives in ONE place (`api/personal`), shared with the Rust
 *  side that validates it. A free text field would produce "Review", "review" and
 *  "Reviewing" inside a week, and no two of them would ever group together.
 *
 *  ON A TILE IT CARRIES NO COLOUR. The state mark and the due date already colour a
 *  task card and both come from `deadlineBand()`/`urgencyOf()`. A category palette
 *  beside them would be a SECOND colour rule on one tile, and "what kind of work"
 *  would start competing with "how late". That is asserted here, not just commented,
 *  because it is exactly the kind of rule a later restyle quietly undoes.
 */

const profiles = [{ id: "me", username: "me", display_name: "Me", email: null, archived: false }];
const projects: unknown[] = [];
const base = {
  id: "t1", profile_id: "me", content: "EXIST application", due_date: null, project_id: null,
  done: false, source_entity_type: null, source_entity_id: null, notes: null,
  assignee_ids: [] as string[], content_kind: "text",
};

let todos: Record<string, unknown>[] = [];
let dispose: (() => void) | undefined;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];

const reply = (cmd: string): unknown => {
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_projects") return projects;
  if (cmd === "list_todos") return todos;
  if (cmd === "list_project_member_ids") return ["me"];
  return [];
};

const mount = async () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args: args ?? {} });
      if (cmd === "update_todo") {
        const patch = (args?.todo ?? {}) as Record<string, unknown>;
        return Promise.resolve({ ...todos[0], ...patch });
      }
      return Promise.resolve(reply(cmd));
    },
  };
  registerViews(["My Tasks", "Projects"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter());
  setProfileId("me");
  await reloadProjects();
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Todo /> as any, host);
  await new Promise(resolve => setTimeout(resolve, 60));
  return host;
};

describe("a task's category", () => {
  afterEach(() => {
    dispose?.(); dispose = undefined;
    document.body.innerHTML = "";
    delete (window as any).__TAURI_INTERNALS__;
    setProfileId("");
    calls.length = 0;
  });

  test("the closed list is ONE list, and every value is lowercase and unique", () => {
    // The Rust side validates against its own copy of these ids; if the two lists
    // ever drift, a category saved here is refused there. Same strings, both sides.
    const ids: string[] = TODO_CATEGORIES.map(option => option.id);
    expect(ids).toEqual(["create", "improve", "review", "decide", "admin"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const option of TODO_CATEGORIES) {
      expect(String(option.id)).toBe(String(option.id).toLowerCase());
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  test("a task WITHOUT a category shows nothing at all — no placeholder, no empty slot", async () => {
    todos = [{ ...base, category: null }];
    const host = await mount();

    expect(host.textContent).toContain("EXIST application");
    // Not "No category", not "—", not an empty chip: absent means absent.
    expect(host.querySelector(".task-tile-cat")).toBeNull();
    expect(host.textContent).not.toContain("No category");
  });

  test("a category shows as a WORD on the tile and carries no colour of its own", async () => {
    todos = [{ ...base, category: "admin" }];
    const host = await mount();

    const tag = host.querySelector<HTMLElement>(".task-tile-cat");
    expect(tag).toBeTruthy();
    expect(tag!.textContent).toBe("Admin");
    // THE RULE THIS FILE EXISTS FOR: no category dot on a tile. Colour on a task card
    // belongs to the deadline system alone.
    expect(tag!.querySelector(".tm-cat-dot")).toBeNull();
    expect(host.querySelectorAll(".task-tile .tm-cat-dot").length).toBe(0);
  });

  test("an unknown stored value still shows itself rather than vanishing", async () => {
    // A row written by an older build, or by hand. Dropping the fact silently would
    // be worse than showing a word we did not plan for.
    todos = [{ ...base, category: "sonstiges" }];
    const host = await mount();

    expect(host.querySelector(".task-tile-cat")?.textContent).toBe("sonstiges");
  });
});

describe("the tile's meta line joins itself", () => {
  afterEach(() => {
    dispose?.(); dispose = undefined;
    document.body.innerHTML = "";
    delete (window as any).__TAURI_INTERNALS__;
    setProfileId("");
    calls.length = 0;
  });

  /** A separator is a thing BETWEEN two facts. Placed by hand beside each fact, it
   *  outlives whatever it was meant to separate: the category printed "Review ·" with
   *  nothing after it, and a notes-only task printed "· notes". */
  test("a lone fact carries no separator, on either side", async () => {
    todos = [{ ...base, category: "review" }];
    const host = await mount();
    const meta = host.querySelector(".task-tile-meta")!;
    expect(meta.textContent).toBe("Review");
    expect(meta.querySelectorAll(".sep").length).toBe(0);
  });

  test("a task with only notes does not start with a separator", async () => {
    todos = [{ ...base, category: null, notes: "Just a note" }];
    const host = await mount();
    const meta = host.querySelector(".task-tile-meta")!;
    expect(meta.textContent).toBe("Just a note");
    expect(meta.querySelectorAll(".sep").length).toBe(0);
  });

  test("three facts are joined by exactly two separators", async () => {
    todos = [{ ...base, category: "create", assignee_ids: ["me"], notes: "Draft it" }];
    const host = await mount();
    const meta = host.querySelector(".task-tile-meta")!;
    expect(meta.querySelectorAll(".sep").length).toBe(2);
    expect(meta.textContent).toBe("Create·Me·Draft it");
  });
});

describe("Done is a button, not a setting", () => {
  afterEach(() => {
    dispose?.(); dispose = undefined;
    document.body.innerHTML = "";
    delete (window as any).__TAURI_INTERNALS__;
    setProfileId("");
    calls.length = 0;
  });

  /** Ticking work off is one of the two reasons anybody opens this editor. As a bare
   *  checkbox beside Save and Delete it was the lightest thing in a row of proper
   *  buttons, so it read as a setting rather than an act. */
  const openEditor = async () => {
    todos = [{ ...base }];
    const host = await mount();
    host.querySelector<HTMLButtonElement>(".task-tile-body")!.click();
    await new Promise(resolve => setTimeout(resolve, 60));
    return host;
  };

  test("it is a real button in the footer, and states its own pressed state", async () => {
    const host = await openEditor();
    const done = host.querySelector<HTMLButtonElement>(".task-edit-actions .task-edit-done")!;
    expect(done).toBeTruthy();
    expect(done.tagName).toBe("BUTTON");
    // A toggle says whether it is on; it does not hide that inside a checkbox.
    expect(done.getAttribute("aria-pressed")).toBe("false");
    expect(done.querySelector("input")).toBeNull();
  });

  test("it says which way it goes, and flips when pressed", async () => {
    const host = await openEditor();
    const done = () => host.querySelector<HTMLButtonElement>(".task-edit-done")!;
    expect(done().textContent).toContain("Mark done");

    done().click();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(done().getAttribute("aria-pressed")).toBe("true");
    expect(done().textContent).toContain("Done");
    expect(done().className).toContain("on");
  });

  test("Done, Delete, Cancel and Save sit in ONE row, in that order", async () => {
    const host = await openEditor();
    const footer = host.querySelector(".task-edit-actions")!;
    const labels = Array.from(footer.children)
      .map(child => (child.textContent ?? "").trim())
      .filter(text => text.length);
    // State · destroy · (spacer) · leave · keep. Delete is handed in by My tasks, which
    // owns deletion; it belongs in this row, not in a strip below the card.
    expect(labels).toEqual(["Mark done", "Delete", "Cancel", "Save"]);
  });
});

/** THE MARKDOWN SWITCH WAS WITHDRAWN, THE DATA WAS NOT.
 *
 *  The control asked for a STORAGE FORMAT ("Markdown body") — a question about the
 *  machine rather than the work. It is gone from both task surfaces. What must NOT
 *  follow is a silent rewrite of history: a title written as markdown before today
 *  still renders as markdown, so nobody's task suddenly sprouts raw asterisks. */
describe("the markdown switch is gone, and old tasks still read correctly", () => {
  afterEach(() => {
    dispose?.(); dispose = undefined;
    document.body.innerHTML = "";
    delete (window as any).__TAURI_INTERNALS__;
    setProfileId("");
    calls.length = 0;
  });

  test("the opened editor offers no markdown control at all", async () => {
    todos = [{ ...base }];
    const host = await mount();
    host.querySelector<HTMLButtonElement>(".task-tile-body")!.click();
    await new Promise(resolve => setTimeout(resolve, 60));

    expect(host.querySelector(".task-edit")).toBeTruthy();
    expect(host.querySelector(".task-edit-md")).toBeNull();
    expect(host.textContent).not.toContain("Markdown");
  });

  test("a title stored as markdown STILL renders as markdown", async () => {
    todos = [{ ...base, content: "Ship **the** draft", content_kind: "markdown" }];
    const host = await mount();
    expect(host.querySelector(".task-tile-title strong")?.textContent).toBe("the");
  });

  test("a plain title is shown verbatim, asterisks and all", async () => {
    todos = [{ ...base, content: "Ship **the** draft", content_kind: "text" }];
    const host = await mount();
    const title = host.querySelector(".task-tile-title")!;
    expect(title.querySelector("strong")).toBeNull();
    expect(title.textContent).toBe("Ship **the** draft");
  });

  test("saving an untouched task does not change its stored kind", async () => {
    todos = [{ ...base, content_kind: "markdown" }];
    const host = await mount();
    host.querySelector<HTMLButtonElement>(".task-tile-body")!.click();
    await new Promise(resolve => setTimeout(resolve, 60));
    host.querySelector<HTMLButtonElement>(".composer-submit")!.click();
    await new Promise(resolve => setTimeout(resolve, 60));

    const sent = calls.filter(call => call.cmd === "update_todo").pop();
    expect(sent).toBeTruthy();
    // The field the person can no longer see must survive the save untouched.
    expect((sent!.args.todo as Record<string, unknown>).content_kind).toBe("markdown");
  });
});
