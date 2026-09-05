import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Steering, { deadlineTone } from "./Steering";
import { reloadProjects, setProfileId, setProjectId } from "../session";
import { initRouter, createMemoryAdapter, registerViews, setAvailableViews } from "../router";

// Steering IS the project home: the surfaces of the project are counted from the
// list commands that already exist, each count is a real link, and a project with a
// deadline says how close it is. A denied read is an error, never an empty state.

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
  created_by: "me", archived: false, deadline: null, ...over,
});
const mount = async () => {
  registerViews(["Chat", "Documents", "Calendar", "Packages", "Project Steering", "Project Tasks", "Dashboard"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("projects/p1/steering"));
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Steering /> as any, host);
  await settle();
  return host;
};

describe("project at a glance inside Steering", () => {
  test("deadline tone and note are computed from dates alone", () => {
    expect(deadlineTone("2030-01-10", "2030-01-10")).toMatchObject({ tone: "soon", note: "due today" });
    expect(deadlineTone("2030-01-07", "2030-01-10")).toMatchObject({ tone: "overdue", note: "3 days overdue" });
    expect(deadlineTone("2030-01-09", "2030-01-10")).toMatchObject({ tone: "overdue", note: "1 day overdue" });
    expect(deadlineTone("2030-01-15", "2030-01-10")).toMatchObject({ tone: "soon", note: "in 5 days" });
    expect(deadlineTone("2030-02-10", "2030-01-10")).toMatchObject({ tone: "ok" });
  });

  test("the stat band counts each surface of the project and links to it", async () => {
    stubTauriIpc();
    setProfileId("me"); setProjectId("p1");
    reply = (cmd) => {
      switch (cmd) {
        case "list_projects": return [project()];
        case "list_project_todos": return [
          { id: "t1", profile_id: "me", content: "One", due_date: null, project_id: "p1", done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: [], content_kind: "text", category: "dev" },
        ];
        case "list_channels_with_meta": return [
          { id: "c1", content_type: "public", name: "general", description: null, project_id: "p1", archived: false, member_count: 1, unread_count: 0, last_message_at: null },
          { id: "c2", content_type: "public", name: "other", description: null, project_id: "p2", archived: false, member_count: 1, unread_count: 0, last_message_at: null },
        ];
        case "list_documents": return [
          { id: "d1", container_type: "project", container_id: "p1", folder_id: null, doc_type: "md", title: "Doc", body: null, version: 1, archived: false },
          { id: "d2", container_type: "kb", container_id: null, folder_id: null, doc_type: "md", title: "Other", body: null, version: 1, archived: false },
        ];
        case "list_meetings": return [
          { id: "m1", title: "Standup", description: null, starts_at: Date.now() / 1000 + 3600, ends_at: Date.now() / 1000 + 7200, rrule: null, location: null, organizer_id: null, channel_id: "c1", video_provider: "native", video_status: "scheduled", archived: false },
          { id: "m2", title: "Past", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: null, channel_id: "c1", video_provider: "native", video_status: "scheduled", archived: false },
        ];
        case "list_package_repositories": return [{ id: "pk1", project_id: "p1", name: "repo", format: "npm", mode: "HOSTING", description: null, archived: false }];
        default: return [];
      }
    };
    await reloadProjects().catch(() => undefined);
    const host = await mount();

    const stats = [...host.querySelectorAll("a.metric-tile")].map((n) => [n.textContent, n.getAttribute("href")]);
    expect(stats).toEqual([
      // EVERY STAT OPENS THE PROJECT'S OWN TAB (stage 19). The old targets
      // (`/issues`, `/boards`, `/chat`, `/documents`) dropped the project on the way
      // and landed the reader in the global list. Dev tasks live on the Dev tab;
      // packages have no project tab and keep theirs.
      ["1Open tasks", "/projects/p1/tasks"],
      ["1Dev tasks", "/projects/p1/dev"],
      ["1Channels", "/projects/p1/chats"],
      ["1Documents", "/projects/p1/knowledge"],
      ["1Upcoming meetings", "/projects/p1/calendar"],
      ["1Packages", "/packages"],
    ]);
    // The buckets Steering already had are still there.
    expect(host.querySelectorAll(".steering-bucket")).toHaveLength(3);
  });

  test("a denied surface read renders an error, not an all-clear overview", async () => {
    stubTauriIpc();
    setProfileId("me"); setProjectId("p1");
    reply = (cmd) => (cmd === "list_documents" ? new Error("not authorized") : cmd === "list_projects" ? [project()] : []);
    const host = await mount();
    expect(host.querySelector('.error[role="alert"]')?.textContent).toContain("Could not load the project overview");
    expect(host.querySelector("a.metric-tile")).toBeNull();
  });

  test("a project carrying a deadline shows the banner with its urgency", async () => {
    stubTauriIpc();
    setProfileId("me"); setProjectId("p1");
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    reply = (cmd) => (cmd === "list_projects" ? [project({ deadline: soon })] : []);
    await reloadProjects().catch(() => undefined);
    const host = await mount();
    const banner = host.querySelector(".st-deadline");
    expect(banner?.classList.contains("soon")).toBe(true);
    expect(banner?.textContent).toContain("in 3 days");
  });
});
