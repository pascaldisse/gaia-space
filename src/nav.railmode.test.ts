import { describe, expect, it } from "bun:test";
import { railModeOfRoute, railModeOfView, viewsInMode, type RailMode } from "./nav";
import { parsePath, registerViews, setAvailableViews } from "./router";

// The rail selects a mode; the sidebar shows that mode's objects. The mode is DERIVED
// from the route and stored nowhere, so these tests guard the one relationship that
// would otherwise rot silently: URL -> mode -> sidebar.

const ALL_VIEWS = [
  "Home", "Dashboard", "To-Do", "Absences", "Projects", "Repos", "Code Reviews", "Pipelines",
  "Issues", "Boards", "Chat", "Inbox", "Documents", "Blogs", "Calendar", "Meetings",
  "Dev Environments", "Packages", "Members", "Locations", "Admin", "Applications", "Users",
  "Development", "Team Tasks", "Project Tasks", "Project Overview", "Project Steering",
  "Project Settings", "Settings",
];

registerViews(ALL_VIEWS);
setAvailableViews(null);

const modeOfPath = (path: string): RailMode => railModeOfRoute(parsePath(path));

describe("rail mode derived from the view", () => {
  it("maps each rail destination to its own mode", () => {
    expect(railModeOfView("Home")).toBe("home");
    expect(railModeOfView("Chat")).toBe("chats");
    expect(railModeOfView("Inbox")).toBe("activity");
    expect(railModeOfView("To-Do")).toBe("tasks");
    expect(railModeOfView("Calendar")).toBe("calendar");
    expect(railModeOfView("Development")).toBe("development");
  });

  it("puts every view in EXACTLY ONE mode", () => {
    const modes: RailMode[] = ["home", "chats", "activity", "tasks", "calendar", "development", "more"];
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
    for (const view of ["Documents", "Blogs", "Admin", "Settings", "A Brand New View"])
      expect(railModeOfView(view)).toBe("more");
  });

  it("keeps people/locations with the calendars and Dashboard with Home", () => {
    expect(railModeOfView("Members")).toBe("calendar");
    expect(railModeOfView("Locations")).toBe("calendar");
    expect(railModeOfView("Absences")).toBe("calendar");
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

  it("a ticket URL is Development", () => {
    expect(modeOfPath("projects/p-1/issues/i-9")).toBe("development");
    expect(modeOfPath("issues/i-9")).toBe("development");
    expect(modeOfPath("boards")).toBe("development");
    expect(modeOfPath("reviews/r-2")).toBe("development");
  });

  it("a document URL is More", () => {
    expect(modeOfPath("documents/d-1")).toBe("more");
    expect(modeOfPath("documents/project/p-1/d-1")).toBe("more");
  });

  it("task and calendar URLs keep their mode across project scoping", () => {
    // A project-scoped task surface belongs to the project, not to the personal
    // task list: it is reached from inside a project and must not switch the mode.
    expect(modeOfPath("projects/p-1/tasks")).toBe("projects");
    expect(modeOfPath("team-tasks")).toBe("tasks");
    expect(modeOfPath("to-do")).toBe("tasks");
    expect(modeOfPath("projects/p-1/calendar")).toBe("calendar");
    expect(modeOfPath("meetings/m-1")).toBe("calendar");
  });

  it("the entity type wins over a shared view name", () => {
    expect(railModeOfRoute({ view: "Documents", entityType: "channel" })).toBe("chats");
  });

  it("an unparseable route degrades with the fallback view, never to a wrong sidebar", () => {
    expect(modeOfPath("nope/nothing")).toBe(railModeOfView(parsePath("nope/nothing").view));
  });
});
