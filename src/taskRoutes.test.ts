import { beforeEach, expect, test } from "bun:test";
import { taskRoute, ledgerRoute } from "./taskRoutes";
import { buildPath, createHashAdapter, createPathAdapter, initRouter, navigate, parsePath, registerViews, route, setAvailableViews, setRoutePending } from "./router";

beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/space/");
  setRoutePending(false);
  registerViews(["Dashboard", taskRoute, ledgerRoute, "Team Tasks", "Project Workspace"]);
  setAvailableViews(null);
});

test("task URLs retain the original view; ledger owns a separate URL", () => {
  expect(parsePath("todo")).toEqual({ view: "To-Do" });
  expect(parsePath("to-do")).toEqual({ view: "To-Do" });
  expect(parsePath("task-ledger")).toEqual({ view: "Task Ledger" });
  expect(buildPath({ view: "To-Do" })).toBe("to-do");
  expect(buildPath({ view: "Task Ledger" })).toBe("task-ledger");
  expect(parsePath("team-tasks")).toEqual({ view: "Team Tasks" });
  expect(parsePath("projects/p1/tasks")).toEqual({ view: "Project Workspace", projectId: "p1", tab: "tasks" });
});

test("web /todo canonicalizes to Tasks and survives reload", () => {
  history.replaceState(null, "", "/space/todo");
  initRouter(createPathAdapter("/space/"));
  expect(route().view).toBe("To-Do");
  expect(location.pathname).toBe("/space/to-do");
  initRouter(createPathAdapter("/space/"));
  expect(route().view).toBe("To-Do");
  navigate("Task Ledger");
  expect(location.pathname).toBe("/space/task-ledger");
  initRouter(createPathAdapter("/space/"));
  expect(route().view).toBe("Task Ledger");
});

test("native hash /todo canonicalizes to Tasks", () => {
  history.replaceState(null, "", "/#/todo");
  initRouter(createHashAdapter());
  expect(route().view).toBe("To-Do");
  expect(location.hash).toBe("#/to-do");
  initRouter(createHashAdapter());
  expect(route().view).toBe("To-Do");
});
