import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import ChannelWorkspace from "./ChannelWorkspace";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { setProfileId, setProjectId } from "../session";

// The channel workspace is chrome around the existing Chat view. Two laws are tested
// because both are product decisions, not implementation details:
//  1. a channel WITHOUT a project has no work surfaces -> no tab row at all;
//  2. the "Channel status" numbers are PROJECT numbers and say so in their own title.

let dispose: (() => void) | undefined;

const projects = [
  { id: "p1", name: "Atlas", key: "ATL", description: null, created_by: "me", archived: false, deadline: "2030-01-01", lead_id: "me" },
];
const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "other", username: "other", display_name: "Other Person", email: null, archived: false },
];
const channels: Record<string, unknown> = {
  "c-project": { id: "c-project", content_type: "public", name: "video-factory", description: "Skripte und Produktion", project_id: "p1", archived: false },
  "c-loose": { id: "c-loose", content_type: "public", name: "wasserkocher", description: "Kein Projekt", project_id: null, archived: false },
};

const reply = (cmd: string, args: Record<string, unknown>) => {
  if (cmd === "get_channel") return channels[String(args.id)] ?? null;
  if (cmd === "list_projects") return projects;
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_channel_members") return [{ channel_id: String(args.channelId), profile_id: "me", administrator: true }];
  if (cmd === "list_mentions_for_profile") return [];
  if (cmd === "list_project_member_ids") return ["me", "other"];
  if (cmd === "project_dashboard_aggregate") return { project_id: "p1", open_issues: 2, open_todos: 5, member_count: 70, deadline: "2030-01-01" };
  if (cmd === "list_meetings") return [];
  return [];
};

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const mount = async (channelId: string) => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => Promise.resolve(reply(cmd, args ?? {})) };
  registerViews(["Chat", "Project Overview", "Project Tasks", "Calendar", "Documents"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter());
  setProfileId("me");
  navigate({ view: "Chat", entityType: "channel", entityId: channelId, tab: "messages" });
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <ChannelWorkspace /> as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); });

describe("channel workspace", () => {
  test("a channel without a project shows no tab row and no project rail", async () => {
    const host = await mount("c-loose");
    expect(host.querySelector(".cw-tabs")).toBeNull();
    expect(host.querySelector(".cw-rail")).toBeNull();
    // The channel itself is still fully rendered — nothing is hidden but the work tabs.
    expect(host.querySelector(".cw-title h1")?.textContent).toContain("wasserkocher");
  });

  test("a project-bound channel shows every work tab, kicker first", async () => {
    const host = await mount("c-project");
    expect(host.querySelector(".cw-kicker")?.textContent).toBe("Atlas");
    const tabs = Array.from(host.querySelectorAll(".cw-tab")).map(node => node.textContent);
    expect(tabs).toEqual(["Messages", "Overview", "Tasks", "Calendar", "Files & Links", "Notes & Decisions"]);
    expect(host.querySelector(".cw-tab.active")?.textContent).toBe("Messages");
  });

  test("Channel status shows PROJECT numbers under the project's own name", async () => {
    const host = await mount("c-project");
    const card = host.querySelector(".cw-rail .cw-card") as HTMLElement;
    // The label carries the project, so no figure can claim to be about this channel alone.
    expect(card.querySelector("h2")?.textContent).toBe("Atlas · Project status");
    const stats = Array.from(card.querySelectorAll(".cw-stat")).map(row => row.textContent);
    expect(stats[0]).toContain("Open tasks");
    expect(stats[0]).toContain("5");
    expect(stats[1]).toContain("Tickets");
    expect(stats[1]).toContain("2");
    // Project members, with the informational lead role, come from the project — not the channel.
    expect(host.textContent).toContain("Other Person · Member");
    expect(host.textContent).toContain("Me · Lead");
  });
});
