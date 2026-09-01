import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import ChannelWorkspace from "./ChannelWorkspace";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { setProfileId, setProjectId } from "../session";
import { setSelectedChannel } from "../chatChannelSelection";

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
  "dm1": { id: "dm1", content_type: "dm", name: "Me · Other Person", description: null, project_id: null, archived: false },
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

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); setProjectId(""); setSelectedChannel(null); });

describe("channel workspace", () => {
  test("a channel without a project shows no tab row and no project rail", async () => {
    const host = await mount("c-loose");
    expect(host.querySelector(".cw-tabs")).toBeNull();
    expect(host.querySelector(".cw-rail")).toBeNull();
    // The channel itself is still fully rendered — nothing is hidden but the work tabs.
    expect(host.querySelector(".cw-title h1")?.textContent).toContain("wasserkocher");
    expect(host.querySelector('[aria-label="Message refresh"]')).toBeNull();
    expect(host.textContent).not.toContain("Refresh:2s");
    expect(host.querySelector('[aria-label="Message refresh"]')).toBeNull();
    expect(host.textContent).not.toContain("Refresh:2s");
  });

  test("a sidebar-seeded project channel reserves its rail and real header immediately", async () => {
    setSelectedChannel({ id: "c-project", content_type: "public", name: "video-factory", description: null, project_id: "p1", archived: false, member_count: 2, unread_count: 0, last_message_at: null });
    const host = await mount("c-project");
    expect(host.querySelector(".cw-title h1")?.textContent).toBe("# video-factory");
    expect(host.querySelector(".cw-body")?.classList.contains("with-rail")).toBe(true);
    expect(host.querySelector(".cw-rail")).toBeTruthy();
  });

  test("a seeded direct message has a person header, not a channel hash", async () => {
    setSelectedChannel({ id: "dm1", content_type: "dm", name: "Me · Other Person", description: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null, headerLabel: "Other Person" });
    const host = await mount("dm1");
    expect(host.querySelector(".cw-dm-title h1")?.textContent).toBe("Other Person");
    expect(host.querySelector(".cw-dm-title .avatar")).toBeTruthy();
    expect(host.querySelector(".cw-title h1")?.textContent).not.toContain("#");
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

  test("project sidebar sections are collapsed by default and their header controls toggle them", async () => {
    const host = await mount("c-project");
    const status = host.querySelector<HTMLButtonElement>(".cw-rail-toggle[aria-controls=\"cw-project-status\"]");
    const team = host.querySelector<HTMLButtonElement>(".cw-rail-toggle[aria-controls=\"cw-project-team\"]");
    expect(status?.textContent).toContain("Project status");
    expect(team?.textContent).toContain("Team");
    expect(status?.getAttribute("aria-expanded")).toBe("false");
    expect(team?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("#cw-project-status")).toBeNull();
    expect(host.querySelector("#cw-project-team")).toBeNull();

    status?.click();
    await settle();
    const card = host.querySelector("#cw-project-status") as HTMLElement;
    expect(status?.getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector("h2")?.textContent).toBe("Atlas · Project status");
    const stats = Array.from(card.querySelectorAll(".cw-stat")).map(row => row.textContent);
    expect(stats[0]).toContain("Open tasks");
    expect(stats[0]).toContain("5");
    expect(stats[1]).toContain("Tickets");
    expect(stats[1]).toContain("2");

    team?.click();
    await settle();
    expect(team?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("#cw-project-team")?.textContent).toContain("Other Person · Member");
    expect(host.textContent).toContain("Me · Responsible");
  });
});
