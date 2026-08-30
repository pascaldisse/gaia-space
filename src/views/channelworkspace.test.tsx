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
  // The backend returns the EFFECTIVE membership: a project channel inherits the
  // project's people, so this answer matches list_project_member_ids below.
  if (cmd === "list_channel_members") {
    const id = String(args.channelId);
    return id === "c-project"
      ? [{ channel_id: id, profile_id: "me", administrator: true }, { channel_id: id, profile_id: "other", administrator: false }]
      : [{ channel_id: id, profile_id: "me", administrator: true }];
  }
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

  test("THE CHANNEL OWNS NO TAB ROW: it points at the project that does", async () => {
    // THE PRINCIPLE (stage 19, views/ProjectWorkspace.tsx): the tab row belongs to the
    // PROJECT; which channel you are reading is a selection inside its Chats tab.
    // This surface used to draw Messages · Overview · Tasks · Calendar · Files & Links
    // · Notes & Decisions, and five of those six were about the PROJECT while hanging
    // off the CHANNEL — the same five surfaces reachable two ways, with two tab rows.
    const host = await mount("c-project");
    expect(host.querySelector(".cw-kicker")?.textContent).toBe("Atlas");
    expect(host.querySelectorAll(".cw-tab")).toHaveLength(0);
    expect(host.querySelector(".cw-tabs")).toBeNull();
    // Nothing became unreachable: the one link out goes to the project workspace,
    // where all five of those surfaces now live under ONE tab row.
    const owner = host.querySelector<HTMLAnchorElement>(".cw-owner a");
    expect(owner?.textContent).toContain("Atlas workspace");
    expect(owner?.getAttribute("href")).toBe("/projects/p1");
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
    expect(host.textContent).toContain("Me · Responsible");
  });

  test("members chip counts the project's people and links to where they are managed", async () => {
    // THE BUG: the header said "1 members" (the channel_members row) while the Team
    // rail listed the project's four. One channel cannot have two memberships.
    const host = await mount("c-project");
    const chip = host.querySelector<HTMLAnchorElement>(".cw-metrics .cw-pill-link");
    expect(chip?.textContent).toContain("2");
    expect(chip?.textContent).toContain("from Atlas");
    // The count is an act: it leads to the only place membership can be changed.
    expect(chip?.getAttribute("href")).toBe("/projects/p1/settings");
  });

  test("a channel without a project keeps a plain, unlinked members chip", async () => {
    const host = await mount("c-loose");
    expect(host.querySelector(".cw-metrics .cw-pill-link")).toBeNull();
    expect(host.querySelector(".cw-metrics .cw-pill")?.textContent).toContain("1");
  });
});
