import { describe, expect, test, beforeEach } from "bun:test";
import {
  buildPath, parsePath, registerViews, setAvailableViews, navigate, route,
  createMemoryAdapter, initRouter, hrefFor, entityView, setRoutePending, linkContainer, linkEntity, type RouterAdapter,
} from "./router";

const VIEWS = ["Dashboard", "To-Do", "Projects", "Code Reviews", "Issues", "Chat", "Documents", "Meetings", "Members", "Users"];

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
  };
}

beforeEach(() => { setRoutePending(false); registerViews(VIEWS); setAvailableViews(VIEWS); initRouter(createMemoryAdapter()); });

describe("context-free entity links", () => {
  test("an issue link without project context is a real route, not a bare view", () => {
    expect(buildPath({ view: "Issues", entityType: "issue", entityId: "i-1" })).toBe("issues/i-1");
    expect(parsePath("issues/i-1")).toMatchObject({ view: "Issues", entityType: "issue", entityId: "i-1" });
    expect(parsePath("issues/i-1").projectId).toBeUndefined();
    expect(parsePath("issues").entityId).toBeUndefined(); // the plain view URL stays a view URL
  });

  test("Goto's context-free URL survives new tab / reload", () => {
    const env = stackAdapter("issues/i-1"); // pasted or opened in a new tab
    initRouter(env.adapter);
    expect(route()).toMatchObject({ view: "Issues", entityType: "issue", entityId: "i-1" });
    expect(env.url()).toBe("issues/i-1"); // not normalized away
    env.reload();
    expect(route()).toMatchObject({ entityType: "issue", entityId: "i-1" });
  });

  test("resolving the owner canonicalizes in place, leaving no history trap", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    navigate({ view: "Issues", entityType: "issue", entityId: "i-1" }); // Goto: project unknown
    linkEntity("issue", "i-1", { projectId: "p-1" }, true);             // view resolved the project
    expect(env.url()).toBe("projects/p-1/issues/i-1");
    env.back();
    expect(route().view).toBe("Dashboard"); // back skips the pre-canonical twin
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
    expect(buildPath({ view: "Issues" })).not.toContain("#");
  });

  test("issue routes carry project context", () => {
    const path = buildPath({ view: "Issues", entityType: "issue", entityId: "i-1", projectId: "p-1" });
    expect(path).toBe("projects/p-1/issues/i-1");
    expect(parsePath(path)).toMatchObject({ view: "Issues", entityType: "issue", entityId: "i-1", projectId: "p-1" });
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
    expect(parsePath("projects/p-1")).toMatchObject({ view: "Projects", entityType: "project", entityId: "p-1" });
    expect(parsePath("reviews/r-1")).toMatchObject({ view: "Code Reviews", entityType: "review", entityId: "r-1" });
    expect(entityView("channel")).toBe("Chat");
  });

  test("ids with unusual characters survive a round trip", () => {
    const id = "a/b c#d?e";
    const path = buildPath({ view: "Meetings", entityType: "meeting", entityId: id });
    expect(parsePath(path).entityId).toBe(id);
  });

  test("query strings are outside route grammar", () => {
    expect(parsePath("projects/p-1/issues/i-1?tab=activity")).toMatchObject({
      view: "Issues", projectId: "p-1", entityId: "i-1",
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
    setAvailableViews(["Dashboard", "Issues"]);
    navigate({ view: "Code Reviews" });
    expect(route().view).toBe("Dashboard");
    expect(env.url()).toBe("dashboard");
  });
});

describe("history", () => {
  test("back/forward restore prior routes (popstate)", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    navigate({ view: "Issues", entityType: "issue", entityId: "i-1", projectId: "p-1" });
    navigate({ view: "Chat", entityType: "channel", entityId: "c-9" });
    expect(env.url()).toBe("channels/c-9");

    env.back();
    expect(route()).toMatchObject({ view: "Issues", entityId: "i-1", projectId: "p-1" });
    env.back();
    expect(route().view).toBe("Dashboard");
    expect(route().entityId).toBeUndefined();
    env.forward();
    expect(route()).toMatchObject({ view: "Issues", entityId: "i-1" });
  });

  test("back from an entity URL to the view URL clears the entity", () => {
    const env = stackAdapter("issues");
    initRouter(env.adapter);
    navigate({ view: "Issues", entityType: "issue", entityId: "i-1", projectId: "p-1" });
    env.back();
    expect(route().entityId).toBeUndefined();
    expect(route().view).toBe("Issues");
  });

  test("reload of a deep URL rebuilds the same route (authenticated boot)", () => {
    const env = stackAdapter("projects/p-7/issues/i-7");
    initRouter(env.adapter);
    const before = route();
    env.reload();
    expect(route()).toMatchObject(before);
    expect(env.url()).toBe("projects/p-7/issues/i-7"); // survives boot untouched
  });

  test("boot before the view registry is known still normalizes once registered", () => {
    registerViews([]);
    const env = stackAdapter("issues");
    initRouter(env.adapter);
    expect(route().view).toBe("Dashboard");
    registerViews(VIEWS);
    setAvailableViews(VIEWS);
    expect(parsePath("issues").view).toBe("Issues");
  });
});

describe("links", () => {
  test("hrefFor produces a real base-prefixed URL with no hash", () => {
    const env = stackAdapter("dashboard");
    initRouter(env.adapter);
    const href = hrefFor({ view: "Issues", entityType: "issue", entityId: "i-1", projectId: "p-1" });
    expect(href).toBe("/space/projects/p-1/issues/i-1");
    expect(href).not.toContain("#");
  });
});
