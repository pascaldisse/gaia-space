import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import {
  buildPath, parsePath, registerViews, setAvailableViews, navigate, route,
  createMemoryAdapter, initRouter, hrefFor, entityView, setRoutePending, linkContainer, channelTabs, projectTabs, type RouterAdapter,
} from "./router";

const VIEWS = ["Dashboard", "To-Do", "Team Tasks", "Projects", "Project Workspace", "Project Overview", "Project Tasks", "Project Steering", "Project Settings", "Calendar", "Code Reviews", "Chat", "Documents", "Meetings", "Members", "Users"];

/** Adapter with an explicit history stack, so back/forward/reload are testable without a DOM. */
function stackAdapter(initial: string) {
  const stack: string[] = [initial];
  let index = 0;
  let listener: () => void = () => {};
  const adapter: RouterAdapter = {
    read: () => stack[index],
    write: (path, replace) => { if (replace) stack[index] = path; else { stack.splice(index + 1); stack.push(path); index = stack.length - 1; } },
    href: (path) => "/space/" + path,
    subscribe: (fn) => { listener = fn; },
  };
  return {
    adapter, stack,
    url: () => stack[index],
    back: () => { if (index > 0) { index--; listener(); } },
    forward: () => { if (index < stack.length - 1) { index++; listener(); } },
    reload: () => initRouter(adapter),
    replace: (path: string) => { stack[index] = path; }, // inject a historical entry without firing popstate
  };
}

beforeEach(() => { setRoutePending(false); registerViews(VIEWS); setAvailableViews(VIEWS); initRouter(createMemoryAdapter()); });

describe("legacy task links redirect to tasks", () => {
  // Tasks are tasks now (task unification). The migration that folded issues into
  // tasks kept ids, but there is no single-task URL in this grammar (a task opens
  // inline, in its row) — so an old link lands on a real, useful surface instead of
  // 404ing, and NORMALIZES there (unlike the old Issues context-free route, which
  // stayed on its own untouched address).
  test("a project-scoped task link lands on that project's Tasks tab", () => {
    expect(parsePath("projects/p-1/issues/i-1")).toMatchObject({ view: "Project Workspace", projectId: "p-1", tab: "tasks" });
    const env = stackAdapter("projects/p-1/issues/i-1");
    initRouter(env.adapter);
    expect(route()).toMatchObject({ view: "Project Workspace", projectId: "p-1", tab: "tasks" });
    expect(env.url()).toBe("projects/p-1/tasks"); // normalized to the canonical tab address
  });

  test("a context-free task link (Goto, bookmark) lands on the reader's own tasks", () => {
    expect(parsePath("issues/i-1")).toMatchObject({ view: "To-Do" });
    // The bare `/issues` list has no equivalent (there is no task list any more);
    // only a link that named a specific task has somewhere honest to land.
    expect(parsePath("issues").view).toBe("Dashboard");
    const env = stackAdapter("issues/i-1");
    initRouter(env.adapter);
    expect(route().view).toBe("To-Do");
    expect(env.url()).toBe("to-do");
  });
});

describe("auth-pending policy", () => {
  test("an admin-only URL is retained while the session is unresolved", () => {
    setRoutePending(true);
    setAvailableViews(VIEWS.filter((v) => v !== "Users")); // pre-auth: role unknown
    const env = stackAdapter("users");
    initRouter(env.adapter);
    expect(env.url()).toBe("users"); // held, not rewritten
    expect(route().view).toBe("Users");
  });

  test("admin keeps the route once auth settles", () => {
    setRoutePending(true);
    const env = stackAdapter("users");
    initRouter(env.adapter);
    setAvailableViews(VIEWS); // admin
    setRoutePending(false);
    expect(route().view).toBe("Users");
    expect(env.url()).toBe("users");
  });

  test("a member is normalized away from it once auth settles", () => {
    setRoutePending(true);
    const env = stackAdapter("users");
    initRouter(env.adapter);
    setAvailableViews(VIEWS.filter((v) => v !== "Users")); // member
    setRoutePending(false);
    expect(route().view).toBe("Dashboard");
    expect(env.url()).toBe("dashboard");
  });
});

describe("grammar", () => {
  test("view routes are canonical slugs, never hash", () => {
    expect(buildPath({ view: "Code Reviews" })).toBe("code-reviews");
    expect(buildPath({ view: "To-Do" })).toBe("to-do");
    expect(parsePath("code-reviews").view).toBe("Code Reviews");
    expect(buildPath({ view: "Code Reviews" })).not.toContain("#");
  });

  /* THE OBVIOUS SPELLING OF THE TASK AREA IS THE TASK AREA. `todo`/`tasks` are
     aliases of the working surface; the generated read-only ledger owns its own
     slug and can never take the address people type. */
  test("todo and tasks are the task area, not the ledger", () => {
    registerViews([
      { name: "To-Do", aliases: ["todo", "tasks"] },
      { name: "Task Ledger", slug: "task-ledger" },
      "Dashboard",
    ]);
    setAvailableViews(null);
    expect(parsePath("todo").view).toBe("To-Do");
    expect(parsePath("tasks").view).toBe("To-Do");
    expect(parsePath("to-do").view).toBe("To-Do");
    expect(parsePath("task-ledger").view).toBe("Task Ledger");
    expect(buildPath({ view: "To-Do" })).toBe("to-do");
    expect(buildPath({ view: "Task Ledger" })).toBe("task-ledger");
    registerViews(VIEWS);
  });

  // ── THE PROJECT WORKSPACE ────────────────────────────────────────────
  // One project, one tab row, five tabs. The tab is ROUTE STATE, so a deep link
  // arrives on the right tab and the sidebar can highlight it.
  test("the five project tabs round-trip through the one projectTabs grammar", () => {
    expect([...projectTabs]).toEqual(["chats", "tasks", "calendar", "knowledge", "dev"]);
    for (const tab of projectTabs) {
      const path = `projects/p-1/${tab}`;
      expect(parsePath(path)).toMatchObject({ view: "Project Workspace", projectId: "p-1", tab });
      expect(buildPath({ view: "Project Workspace", projectId: "p-1", tab })).toBe(path);
    }
  });

  test("the bare project URL is the workspace landing, and it is NOT a tab", () => {
    // The project's own name is its home. A tab row whose landing is also one of its
    // entries would name the same place twice, so the overview has no tab segment.
    expect(parsePath("projects/p-1")).toMatchObject({ view: "Project Workspace", projectId: "p-1" });
    expect(parsePath("projects/p-1").tab).toBeUndefined();
    expect(buildPath({ view: "Project Workspace", projectId: "p-1" })).toBe("projects/p-1");
    // An unknown tab is not a route: it degrades to the fallback, never to a blank tab.
    expect(parsePath("projects/p-1/nonsense")).toMatchObject({ view: "Dashboard" });
  });

  test("a channel is an OBJECT INSIDE the Chats tab, never a tab of its own", () => {
    const target = { view: "Project Workspace", projectId: "p-1", tab: "chats", entityType: "channel", entityId: "c-7" };
    expect(buildPath(target)).toBe("projects/p-1/chats/c-7");
    expect(parsePath("projects/p-1/chats/c-7")).toMatchObject(target);
    // The tab with no channel selected is still a real, linkable address.
    expect(buildPath({ view: "Project Workspace", projectId: "p-1", tab: "chats" })).toBe("projects/p-1/chats");
  });

  test("Steering and Settings stay reachable, and are NOT tabs", () => {
    expect(buildPath({ view: "Project Steering", projectId: "p-1" })).toBe("projects/p-1/steering");
    expect(parsePath("projects/p-1/steering")).toMatchObject({ view: "Project Steering", projectId: "p-1" });
    expect(parsePath("projects/p-1/steering").tab).toBeUndefined();
    expect(buildPath({ view: "Project Settings", projectId: "p-1" })).toBe("projects/p-1/settings");
    expect(parsePath("projects/p-1/settings")).toMatchObject({ view: "Project Settings", projectId: "p-1" });
  });

  test("the surfaces that BECAME tabs keep their shipped addresses and land on the tab", () => {
    // Every link already written across the app keeps working. It no longer opens a
    // page of its own; it arrives on the tab where that surface now lives. The address
    // is CANONICAL on both sides (build(parse(x)) === x), so resync never loops.
    const landsOn = (from: Parameters<typeof buildPath>[0], path: string, tab?: string) => {
      expect(buildPath(from)).toBe(path);
      expect(parsePath(path)).toMatchObject({ view: "Project Workspace", projectId: "p-1", ...(tab ? { tab } : {}) });
      expect(buildPath(parsePath(path))).toBe(path);
    };
    landsOn({ view: "Project Tasks", projectId: "p-1" }, "projects/p-1/tasks", "tasks");
    landsOn({ view: "Calendar", projectId: "p-1" }, "projects/p-1/calendar", "calendar");
    // The old Project Overview page: its content IS the landing now.
    landsOn({ view: "Project Overview", projectId: "p-1" }, "projects/p-1");
    // ...and the legacy `/overview` spelling still resolves rather than 404-ing.
    expect(parsePath("projects/p-1/overview")).toMatchObject({ view: "Project Workspace", projectId: "p-1" });
  });

  test("document routes carry a valid container type + id, incl. the null container", () => {
    expect(buildPath({ view: "Documents", entityType: "document", entityId: "d-1", containerType: "kb", containerId: "book-9" }))
      .toBe("documents/kb/book-9/d-1");
    expect(parsePath("documents/kb/book-9/d-1")).toMatchObject({ containerType: "kb", containerId: "book-9", entityId: "d-1" });
    expect(parsePath("documents/project/-/d-2")).toMatchObject({ containerType: "project", entityId: "d-2" });
    expect(parsePath("documents/project/-/d-2").containerId).toBeUndefined();
    expect(parsePath("documents/my-docs/prof-1")).toMatchObject({ view: "Documents", containerType: "my-docs", containerId: "prof-1" });
    expect(parsePath("documents/my-docs/prof-1").entityId).toBeUndefined();
    expect(parsePath("documents/not-a-container/id")).toEqual({ view: "Dashboard" });
    expect(parsePath("documents/kb")).toMatchObject({ view: "Documents", entityType: "document", entityId: "kb" });
  });

  test("an unknown container type or an unusable container id never survives the grammar", () => {
    // Unknown types fall back, in either arity, and case is not a container type.
    expect(parsePath("documents/not-a-container/id")).toEqual({ view: "Dashboard" });
    expect(parsePath("documents/not-a-container/id/d-1")).toEqual({ view: "Dashboard" });
    expect(parsePath("documents/My-Docs/prof-1")).toEqual({ view: "Dashboard" });
    // A blank / whitespace-only container id is not an id.
    expect(parsePath("documents/kb/%20")).toEqual({ view: "Dashboard" });
    expect(parsePath("documents/kb/%20/d-1")).toEqual({ view: "Dashboard" });
    // buildPath is canonical too: a forged container type is dropped, not echoed back.
    expect(buildPath({ view: "Documents", containerType: "not-a-container", containerId: "x" })).toBe("documents");
    expect(buildPath({ view: "Documents", entityType: "document", entityId: "d-1", containerType: "evil", containerId: "x" }))
      .toBe("documents/d-1");
    // A container type with a blank id degrades to the null-container placeholder.
    expect(buildPath({ view: "Documents", containerType: "kb", containerId: "   " })).toBe("documents/kb/-");
    // Round trip stays stable.
    expect(parsePath(buildPath({ view: "Documents", containerType: "kb", containerId: "book-9" })))
      .toMatchObject({ view: "Documents", containerType: "kb", containerId: "book-9" });
  });

  test("container selection writes its active context URL", () => {
    const env = stackAdapter("documents/my-docs/profile-1");
    initRouter(env.adapter);
    linkContainer("project", "project-2");
    expect(env.url()).toBe("documents/project/project-2");
    expect(route()).toMatchObject({ view: "Documents", containerType: "project", containerId: "project-2" });
    linkContainer("kb", "book-3");
    expect(env.url()).toBe("documents/kb/book-3");
  });

  test("channels/meetings/profiles/projects/reviews resolve", () => {
    expect(parsePath("channels/c-1")).toMatchObject({ view: "Chat", entityType: "channel", entityId: "c-1" });
    expect(parsePath("meetings/m-1")).toMatchObject({ view: "Meetings", entityType: "meeting", entityId: "m-1" });
    expect(parsePath("profiles/pr-1")).toMatchObject({ view: "Members", entityType: "profile", entityId: "pr-1" });
    // A project link from Goto still resolves — to the workspace, which is where a
    // project now opens. The entity grammar builds the same address either way.
    expect(buildPath({ view: "Projects", entityType: "project", entityId: "p-1" })).toBe("projects/p-1");
    expect(parsePath("projects/p-1")).toMatchObject({ view: "Project Workspace", projectId: "p-1" });
    expect(parsePath("reviews/r-1")).toMatchObject({ view: "Code Reviews", entityType: "review", entityId: "r-1" });
    expect(entityView("channel")).toBe("Chat");
  });

  test("the channel workspace tab round-trips and opens the Chat view", () => {
    expect(parsePath("channel/c-1/messages"))
      .toMatchObject({ view: "Chat", entityType: "channel", entityId: "c-1", tab: "messages" });
    expect(buildPath({ view: "Chat", entityType: "channel", entityId: "c-1", tab: "messages" }))
      .toBe("channel/c-1/messages");
    // An unknown tab is not a route: it degrades to the fallback, never to a blank Chat.
    expect(parsePath("channel/c-1/nonsense")).toMatchObject({ view: "Dashboard" });
    // The tab-free channel link keeps its existing canonical form.
    expect(buildPath({ view: "Chat", entityType: "channel", entityId: "c-1" })).toBe("channels/c-1");
  });

  test("every workspace tab round-trips through the one channelTabs grammar", () => {
    expect([...channelTabs]).toEqual(["messages", "overview", "tasks", "calendar", "files", "notes"]);
    for (const tab of channelTabs) {
      const path = `channel/c-1/${tab}`;
      expect(parsePath(path)).toMatchObject({ view: "Chat", entityType: "channel", entityId: "c-1", tab });
      expect(buildPath(parsePath(path))).toBe(path);
    }
  });

  test("ids with unusual characters survive a round trip", () => {
    const id = "a/b c#d?e";
    const path = buildPath({ view: "Meetings", entityType: "meeting", entityId: id });
    expect(parsePath(path).entityId).toBe(id);
  });

  test("query strings are outside route grammar", () => {
    expect(parsePath("projects/p-1/tasks?tab=activity")).toMatchObject({
      view: "Project Workspace", projectId: "p-1", tab: "tasks",
    });
    expect(parsePath("documents/kb/book-1/d-1?preview=1")).toMatchObject({
      view: "Documents", containerType: "kb", containerId: "book-1", entityId: "d-1",
    });
  });
});

describe("normalization", () => {
  test("unknown route resolves to Dashboard AND rewrites the URL", () => {
    const env = stackAdapter("not-a-view");
    initRouter(env.adapter);
    expect(route().view).toBe("Dashboard");
    expect(env.url()).toBe("dashboard"); // URL and UI agree — no silent mismatch
  });

  test("hidden/unauthorized view (web: Code Reviews) is normalized away", () => {
    setAvailableViews(VIEWS.filter((v) => v !== "Code Reviews"));
    const env = stackAdapter("code-reviews/r-1");
    initRouter(env.adapter);
    expect(route().view).toBe("Dashboard");
    expect(env.url()).toBe("dashboard");
  });

  test("navigate to an unavailable view falls back instead of writing a dead URL", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    setAvailableViews(["Dashboard", "To-Do"]);
    navigate({ view: "Code Reviews" });
    expect(route().view).toBe("Dashboard");
    expect(env.url()).toBe("dashboard");
  });
});

describe("history", () => {
  test("popstate replaces a now-hidden historical entry with its canonical fallback", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    navigate({ view: "Code Reviews", entityType: "review", entityId: "r-1" });
    navigate({ view: "Chat", entityType: "channel", entityId: "c-9" });
    setAvailableViews(VIEWS.filter((view) => view !== "Code Reviews"));

    env.back();
    expect(route()).toEqual({ view: "Dashboard" });
    expect(env.url()).toBe("dashboard");
  });

  test("popstate replaces unknown and malformed historical entries with the fallback", () => {
    for (const historicalPath of ["not-a-view", "documents/not-a-container/id"]) {
      const env = stackAdapter("dashboard");
      initRouter(env.adapter);
      navigate({ view: "Code Reviews", entityType: "review", entityId: "i-1" });
      env.replace(historicalPath);
      navigate({ view: "Chat", entityType: "channel", entityId: "c-9" });

      env.back();
      expect(route()).toEqual({ view: "Dashboard" });
      expect(env.url()).toBe("dashboard");
    }
  });

  test("back/forward restore valid prior routes without rewriting their URLs (popstate)", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    navigate({ view: "Code Reviews", entityType: "review", entityId: "r-1" });
    navigate({ view: "Chat", entityType: "channel", entityId: "c-9" });
    expect(env.url()).toBe("channels/c-9");

    env.back();
    expect(route()).toMatchObject({ view: "Code Reviews", entityId: "r-1" });
    expect(env.url()).toBe("reviews/r-1");
    env.back();
    expect(route().view).toBe("Dashboard");
    expect(route().entityId).toBeUndefined();
    expect(env.url()).toBe("dashboard");
    env.forward();
    expect(route()).toMatchObject({ view: "Code Reviews", entityId: "r-1" });
    expect(env.url()).toBe("reviews/r-1");
  });

  // Project-scoped state round-trips through history the same way — the Project
  // Workspace tab carries `projectId` where an entity route used to (tasks, before
  // task unification, were the only project-scoped entity; the Dev tab is now).
  test("back/forward restore a project tab without rewriting its URL", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    navigate({ view: "Project Workspace", projectId: "p-1", tab: "dev" });
    navigate({ view: "Chat", entityType: "channel", entityId: "c-9" });
    expect(env.url()).toBe("channels/c-9");

    env.back();
    expect(route()).toMatchObject({ view: "Project Workspace", projectId: "p-1", tab: "dev" });
    expect(env.url()).toBe("projects/p-1/dev");
  });

  test("back from an entity URL to the view URL clears the entity", () => {
    const env = stackAdapter("reviews");
    initRouter(env.adapter);
    navigate({ view: "Code Reviews", entityType: "review", entityId: "r-1" });
    env.back();
    expect(route().entityId).toBeUndefined();
    expect(route().view).toBe("Code Reviews");
  });

  test("reload of a deep URL rebuilds the same route (authenticated boot)", () => {
    const env = stackAdapter("projects/p-7/dev");
    initRouter(env.adapter);
    const before = route();
    env.reload();
    expect(route()).toMatchObject(before);
    expect(env.url()).toBe("projects/p-7/dev"); // survives boot untouched
  });

  test("boot before the view registry is known still normalizes once registered", () => {
    registerViews([]);
    const env = stackAdapter("reviews");
    initRouter(env.adapter);
    expect(route().view).toBe("Dashboard");
    registerViews(VIEWS);
    setAvailableViews(VIEWS);
    expect(parsePath("reviews").view).toBe("Code Reviews");
  });

  // A legacy task link is a normalizing redirect, so it does NOT survive reload
  // untouched the way a still-canonical deep URL does — see "legacy task links
  // redirect to tasks" above.
  test("reload of a legacy task URL lands on, and rewrites to, the Tasks tab", () => {
    const env = stackAdapter("projects/p-7/issues/i-7");
    initRouter(env.adapter);
    expect(route()).toMatchObject({ view: "Project Workspace", projectId: "p-7", tab: "tasks" });
    expect(env.url()).toBe("projects/p-7/tasks");
  });
});

describe("links", () => {
  test("hrefFor produces a real base-prefixed URL with no hash", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    const href = hrefFor({ view: "Code Reviews", entityType: "review", entityId: "r-1" });
    expect(href).toBe("/space/reviews/r-1");
    expect(href).not.toContain("#");
  });
});

describe("project workspace routes", () => {
  test("steering and settings keep canonical project context", () => {
    expect(buildPath({ view: "Project Steering", projectId: "p-1" })).toBe("projects/p-1/steering");
    expect(parsePath("projects/p-1/steering")).toMatchObject({ view: "Project Steering", projectId: "p-1" });
    expect(buildPath({ view: "Project Settings", projectId: "p-1" })).toBe("projects/p-1/settings");
    expect(parsePath("projects/p-1/settings")).toMatchObject({ view: "Project Settings", projectId: "p-1" });
  });
});

// Availability is module-global: leaving a narrowed set behind breaks whichever
// file runs next (it did — project-tasks lost its board link on CI).
afterAll(() => setAvailableViews(null));
