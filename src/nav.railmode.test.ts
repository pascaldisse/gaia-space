import { describe, expect, it } from "bun:test";
import { MOBILE_RAIL_MODES, navPlacement, railModeOfRoute, railModeOfView, setNavPlacement, setShowDevelopment, viewsInMode, type RailMode } from "./nav";
import { parsePath, registerViews, setAvailableViews } from "./router";

// The rail selects a mode; the sidebar shows that mode's objects. The mode is DERIVED
// from the route and stored nowhere, so these tests guard the one relationship that
// would otherwise rot silently: URL -> mode -> sidebar.

const ALL_VIEWS = [
  "Home", "Dashboard", "To-Do", "Absences", "Projects", "Repos", "Code Reviews", "Pipelines",
  "Issues", "Boards", "Chat", "Inbox", "Documents", "Blogs", "Calendar", "Meetings",
  "Dev Environments", "Packages", "Members", "Locations", "Admin", "Applications", "Users",
  "Development", "Team Tasks", "Project Tasks", "Project Overview", "Project Steering",
  "Project Settings", "Project Workspace", "Settings",
];

registerViews([...ALL_VIEWS.filter(v => v !== "To-Do"), { name: "To-Do", aliases: ["todo", "tasks"] }, { name: "Task Ledger", slug: "task-ledger" }]);
setAvailableViews(null);

const modeOfPath = (path: string): RailMode => railModeOfRoute(parsePath(path));

describe("rail mode derived from the view", () => {
  it("maps each rail destination to its own mode", () => {
    expect(railModeOfView("Home")).toBe("home");
    expect(railModeOfView("Chat")).toBe("chats");
    expect(railModeOfView("Inbox")).toBe("home");
    expect(railModeOfView("To-Do")).toBe("tasks");
    expect(railModeOfView("Team Tasks")).toBe("tasks");
    expect(railModeOfView("Task Ledger")).toBe("tasks");
    expect(railModeOfView("Calendar")).toBe("home");
    expect(railModeOfView("Documents")).toBe("library");
    expect(railModeOfView("Development")).toBe("development");
  });

  it("puts every view in EXACTLY ONE mode", () => {
    const modes: RailMode[] = ["home", "chats", "projects", "library", "development", "more"];
    const seen = new Map<string, RailMode>();
    for (const mode of modes)
      for (const view of viewsInMode(mode)) {
        expect(seen.has(view)).toBe(false);
        seen.set(view, mode);
      }
  });

  it("sends unmapped/registry views to More, so nothing becomes unreachable", () => {
    // "Projects" left this list on purpose: it now has a rail mode of its own, so
    // the four project surfaces no longer pile up in the drawer for the homeless.
    for (const view of ["Admin", "Settings", "A Brand New View"])
      expect(railModeOfView(view)).toBe("more");
    expect(railModeOfView("Documents")).toBe("library");
    expect(railModeOfView("Blogs")).toBe("library");
  });

  it("keeps people/locations with the calendars and Dashboard with Home", () => {
    expect(railModeOfView("Members")).toBe("home");
    expect(railModeOfView("Locations")).toBe("home");
    expect(railModeOfView("Absences")).toBe("home");
    expect(railModeOfView("Dashboard")).toBe("home");
  });
});

describe("deep links arrive with the right mode", () => {
  it("a channel URL is a conversation", () => {
    expect(modeOfPath("channel/c-1/messages")).toBe("chats");
    // Even a channel work tab keeps the Chats sidebar: the object is still the channel.
    expect(modeOfPath("channel/c-1/tasks")).toBe("chats");
    expect(modeOfPath("channels/c-1")).toBe("chats");
  });

  it("a ticket URL is Development — unless it is scoped to a project", () => {
    expect(modeOfPath("issues/i-9")).toBe("development");
    expect(modeOfPath("boards")).toBe("development");
    expect(modeOfPath("reviews/r-2")).toBe("development");
    // A PROJECT ROUTE IS ALWAYS THE PROJECTS MODE (stage 19). A ticket opened at
    // `/projects/<id>/issues/<id>` renders inside the project workspace, under the
    // project's own tab row, so the sidebar must list projects — not repositories.
    // Deriving the mode from the view name alone put this in the wrong sidebar.
    expect(modeOfPath("projects/p-1/issues/i-9")).toBe("projects");
  });

  it("every project address resolves to the projects mode, whatever it renders", () => {
    for (const path of [
      "projects",
      "projects/p-1",
      "projects/p-1/chats",
      "projects/p-1/chats/c-7",   // a channel INSIDE the project
      "projects/p-1/tasks",
      "projects/p-1/calendar",
      "projects/p-1/knowledge",
      "projects/p-1/dev",
      "projects/p-1/steering",
      "projects/p-1/settings",
      "projects/p-1/issues/i-9",
    ]) expect(modeOfPath(path)).toBe("projects");
  });

  it("a document URL is Knowledge", () => {
    expect(modeOfPath("documents/d-1")).toBe("library");
    expect(modeOfPath("documents/project/p-1/d-1")).toBe("library");
  });

  it("task and calendar URLs keep their mode across project scoping", () => {
    // A project-scoped task surface belongs to the project, not to the personal
    // task list: it is reached from inside a project and must not switch the mode.
    expect(modeOfPath("projects/p-1/tasks")).toBe("projects");
    expect(modeOfPath("team-tasks")).toBe("tasks");
    expect(modeOfPath("to-do")).toBe("tasks");
    expect(modeOfPath("todo")).toBe("tasks");
    expect(modeOfPath("task-ledger")).toBe("tasks");
    // The project's calendar is the project's Calendar TAB, so it stays in the
    // projects mode: leaving for the calendar sidebar would lose the project.
    expect(modeOfPath("projects/p-1/calendar")).toBe("projects");
    expect(modeOfPath("calendar")).toBe("home");
    expect(modeOfPath("meetings/m-1")).toBe("home");
  });

  it("the entity type wins over a shared view name", () => {
    expect(railModeOfRoute({ view: "Documents", entityType: "channel" })).toBe("chats");
  });

  it("an unparseable route degrades with the fallback view, never to a wrong sidebar", () => {
    expect(modeOfPath("nope/nothing")).toBe(railModeOfView(parsePath("nope/nothing").view));
  });
});

describe("responsive rail preferences", () => {
  it("defaults desktop placement to left", () => { expect(navPlacement()).toBe("left"); setNavPlacement("right"); expect(navPlacement()).toBe("right"); setNavPlacement("left"); });
  it("folds development into More when hidden", () => { setShowDevelopment(false); expect(railModeOfView("Issues")).toBe("more"); setShowDevelopment(true); expect(railModeOfView("Issues")).toBe("development"); });
  it("limits mobile rail to five destinations", () => { expect(MOBILE_RAIL_MODES).toEqual(["home", "chats", "tasks", "projects", "more"]); expect(MOBILE_RAIL_MODES.length).toBeLessThanOrEqual(5); });
});
