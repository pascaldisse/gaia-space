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
  "c-dm": { id: "c-dm", content_type: "dm", name: "Other Person", description: null, project_id: null, archived: false },
};

/** Every command the surface fires, so a membership edit can be proven to reach the
    backend with the right channel and the right person — and to never be fired at a
    project channel, where the backend refuses it. */
const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
const channelMembers: Record<string, string[]> = {};

const reply = (cmd: string, args: Record<string, unknown>) => {
  if (cmd === "get_channel") return channels[String(args.id)] ?? null;
  if (cmd === "list_projects") return projects;
  if (cmd === "list_profiles") return profiles;
  // The backend returns the EFFECTIVE membership: a project channel inherits the
  // project's people, so this answer matches list_project_member_ids below.
  if (cmd === "list_channel_members") {
    const id = String(args.channelId);
    const roster = channelMembers[id] ?? (id === "c-project" ? ["me", "other"] : ["me"]);
    return roster.map((profile_id) => ({ channel_id: id, profile_id, administrator: profile_id === "me" }));
  }
  if (cmd === "add_channel_member") {
    const id = String(args.channelId);
    const roster = channelMembers[id] ?? ["me"];
    channelMembers[id] = [...roster, String(args.memberId ?? args.profileId)];
    return null;
  }
  if (cmd === "remove_channel_member") {
    const id = String(args.channelId);
    const gone = String(args.memberId ?? args.profileId);
    channelMembers[id] = (channelMembers[id] ?? ["me"]).filter((entry) => entry !== gone);
    return null;
  }
  if (cmd === "list_mentions_for_profile") return [];
  if (cmd === "list_project_member_ids") return ["me", "other"];
  if (cmd === "project_dashboard_aggregate") return { project_id: "p1", open_issues: 2, open_todos: 5, member_count: 70, deadline: "2030-01-01" };
  if (cmd === "list_meetings") return [];
  return [];
};

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const mount = async (channelId: string) => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args: args ?? {} });
      return Promise.resolve(reply(cmd, args ?? {}));
    },
  };
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

afterEach(() => {
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  calls.length = 0;
  for (const key of Object.keys(channelMembers)) delete channelMembers[key];
  setProfileId(""); setProjectId("");
});

/** Click a PillMenu option by its visible label. The list is PORTALLED, so it is
    searched from document.body, not from the host. */
const pickFromMenu = async (trigger: HTMLElement, label: string) => {
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
  const option = Array.from(document.querySelectorAll(".pill-menu-option"))
    .find((node) => node.textContent?.trim() === label) as HTMLElement | undefined;
  expect(option).toBeTruthy();
  option!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
};

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

  test("a channel without a project manages its own members from the header chip", async () => {
    // THE BUG: membership of a project-LESS conversation was only editable in the old
    // Chat members panel, which the workspace hides. The chip is now the door.
    const host = await mount("c-loose");
    expect(host.querySelector(".cw-metrics .cw-pill-link")).toBeNull();
    const chip = host.querySelector<HTMLButtonElement>(".cw-metrics .cw-pill-button");
    expect(chip?.textContent).toContain("1");
    expect(chip?.textContent).toContain("manage");
    expect(chip?.getAttribute("aria-expanded")).toBe("false");

    // Opening the chip opens the Team panel in the rail — the same rail a project
    // channel has, holding the controls a project channel is refused.
    chip!.click();
    await settle();
    const rail = host.querySelector<HTMLElement>(".cw-rail");
    expect(rail?.getAttribute("aria-label")).toBe("Channel members");
    expect(host.querySelector(".cw-body")?.className).toContain("with-rail");
    expect(rail?.textContent).toContain("Me");

    // ADD: only profiles who are NOT already in are offered, and the add reaches the
    // backend for THIS channel with THAT person.
    const trigger = rail!.querySelector<HTMLElement>(".cw-team-add .pill-menu-trigger")!;
    expect(trigger).toBeTruthy();
    await pickFromMenu(trigger, "Other Person");
    const added = calls.find((call) => call.cmd === "add_channel_member");
    expect(added?.args.channelId).toBe("c-loose");
    expect(added?.args.memberId ?? added?.args.profileId).toBe("other");
    expect(host.querySelector(".cw-rail")?.textContent).toContain("Other Person");
    expect(host.querySelector(".cw-metrics .cw-pill-button")?.textContent).toContain("2");

    // REMOVE is offered per person and reaches the backend too.
    const remove = Array.from(host.querySelectorAll<HTMLButtonElement>(".cw-person-remove"))
      .find((button) => button.getAttribute("aria-label") === "Remove Other Person");
    remove!.click();
    await settle();
    const removed = calls.find((call) => call.cmd === "remove_channel_member");
    expect(removed?.args.channelId).toBe("c-loose");
    expect(removed?.args.memberId ?? removed?.args.profileId).toBe("other");
    expect(host.querySelector(".cw-metrics .cw-pill-button")?.textContent).toContain("1");
  });

  test("a PROJECT channel offers no roster controls — only the project's settings", async () => {
    // The backend refuses add/remove on an inherited roster; offering the control
    // would only produce a refusal, so the surface never draws one.
    const host = await mount("c-project");
    expect(host.querySelector(".cw-metrics .cw-pill-button")).toBeNull();
    expect(host.querySelector(".cw-team")).toBeNull();
    expect(host.querySelector(".cw-person-remove")).toBeNull();
    expect(host.querySelector(".cw-team-add")).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>(".cw-metrics .cw-pill-link")?.getAttribute("href"))
      .toBe("/projects/p1/settings");
    expect(calls.some((call) => call.cmd === "add_channel_member" || call.cmd === "remove_channel_member")).toBe(false);
  });

  test("a DM shows no roster controls: its two people ARE the conversation", async () => {
    const host = await mount("c-dm");
    expect(host.querySelector(".cw-metrics .cw-pill-button")).toBeNull();
    expect(host.querySelector(".cw-metrics .cw-pill")?.textContent).toContain("1");
  });
});
