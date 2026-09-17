import { afterEach, expect, mock, test, describe } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));

import { render } from "solid-js/web";
import RecipientPicker, { findExistingDirectChannel } from "./RecipientPicker";
import { setProfileId, reloadProfiles } from "../session";
import { navigate, registerViews, route, setAvailableViews } from "../router";

// New message is a PICKER, not a form: one search, one unified list of people and
// channels, and the kind of thing picked decides the act — never a content-type
// question asked up front. DM identity is a LOOKUP over the existing create_channel
// call, never a second creator.

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 60));

const profiles = [
  { id: "me", username: "me", display_name: "Me", email: null, archived: false },
  { id: "ana", username: "ana", display_name: "Ana", email: null, archived: false },
  { id: "bo", username: "bo", display_name: "Bo", email: null, archived: false },
];
const channelsFixture = [
  { id: "c-team", content_type: "public", name: "Team", description: null, project_id: null, archived: false, member_count: 5, unread_count: 0, last_message_at: null },
  { id: "c-dm-ana", content_type: "dm", name: "Me \u00b7 Ana", description: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null },
];
const membersByChannel: Record<string, { channel_id: string; profile_id: string; administrator: boolean }[]> = {
  "c-dm-ana": [{ channel_id: "c-dm-ana", profile_id: "me", administrator: false }, { channel_id: "c-dm-ana", profile_id: "ana", administrator: false }],
  "c-team": [],
};

const reply = (cmd: string, args: Record<string, unknown>) => {
  if (cmd === "list_profiles") return profiles;
  if (cmd === "list_channels_with_meta") return channelsFixture;
  if (cmd === "list_channel_members") return membersByChannel[args.channelId as string] ?? [];
  if (cmd === "create_channel") return args.channel;
  return [];
};

const mount = async (onClose: () => void = () => {}) => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd, args)); },
  };
  registerViews(["Chat"]);
  setAvailableViews(null);
  navigate({ view: "Chat" });
  setProfileId("me");
  await reloadProfiles();
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <RecipientPicker onClose={onClose} /> as any, host);
  await settle();
  return host;
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  calls.length = 0;
  delete (window as any).__TAURI_INTERNALS__;
  setProfileId("");
});

const rowLabels = (host: HTMLElement) => Array.from(host.querySelectorAll(".rp-row strong")).map((node) => node.textContent);

describe("RecipientPicker", () => {
  test("renders people and channels in one unified list", async () => {
    const host = await mount();
    const labels = rowLabels(host);
    expect(labels).toContain("Ana");
    expect(labels).toContain("Bo");
    expect(labels).toContain("Team");
    // No content-type question anywhere in the primary flow.
    expect(host.querySelector("select")).toBeNull();
  });

  test("typing filters across people and channels together", async () => {
    const host = await mount();
    const input = host.querySelector<HTMLInputElement>(".rp-search input")!;
    input.value = "tea";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(rowLabels(host)).toEqual(["Team"]);
  });

  test("picking a person with no existing DM reuses the create_channel path and navigates", async () => {
    const host = await mount();
    const row = Array.from(host.querySelectorAll(".rp-row")).find((node) => node.textContent?.includes("Bo"))!;
    (row as HTMLElement).click();
    await settle();
    const created = calls.find((entry) => entry.cmd === "create_channel")!;
    expect(created).toBeDefined();
    expect(created.args.memberIds).toEqual(["me", "bo"]);
    expect((created.args.channel as any).content_type).toBe("dm");
    expect(route().view).toBe("Chat");
    expect(route().entityId).toBe((created.args.channel as any).id);
  });

  test("picking a person with an existing DM opens it without creating a second one", async () => {
    const host = await mount();
    const row = Array.from(host.querySelectorAll(".rp-row")).find((node) => node.textContent?.includes("Ana"))!;
    (row as HTMLElement).click();
    await settle();
    expect(calls.some((entry) => entry.cmd === "create_channel")).toBe(false);
    expect(route().entityId).toBe("c-dm-ana");
  });

  test("clicking a channel navigates to it", async () => {
    const host = await mount();
    const row = Array.from(host.querySelectorAll(".rp-row")).find((node) => node.textContent?.includes("Team"))!;
    (row as HTMLElement).click();
    await settle();
    expect(route().entityId).toBe("c-team");
    expect(calls.some((entry) => entry.cmd === "create_channel")).toBe(false);
  });

  test("Enter picks the first result — alphabetically first with no recent-activity channel", async () => {
    const host = await mount();
    // No channel here carries last_message_at, so the list is one plain A–Z order:
    // Ana, Bo, Team — Enter must act on Ana, whichever way "first" was computed.
    expect(rowLabels(host)[0]).toBe("Ana");
    const input = host.querySelector<HTMLInputElement>(".rp-search input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(route().entityId).toBe("c-dm-ana");
  });

  test("Escape closes the picker", async () => {
    let closed = 0;
    const host = await mount(() => { closed += 1; });
    const input = host.querySelector<HTMLInputElement>(".rp-search input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();
    expect(closed).toBe(1);
  });

  test("New group: multi-select checkmarks and a name field, one create_channel call carrying every chosen id", async () => {
    const host = await mount();
    Array.from(host.querySelectorAll(".rp-action-row")).find((node) => node.textContent?.includes("New group"))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    // Group mode drops channels from the pickable set — only people are invitable.
    expect(rowLabels(host)).toEqual(["Ana", "Bo"]);
    const rows = Array.from(host.querySelectorAll(".rp-row"));
    (rows.find((node) => node.textContent?.includes("Ana")) as HTMLElement).click();
    (rows.find((node) => node.textContent?.includes("Bo")) as HTMLElement).click();
    await settle();
    expect(host.querySelectorAll(".rp-check.checked").length).toBe(2);
    const nameField = host.querySelector<HTMLInputElement>(".rp-group-name input")!;
    nameField.value = "Launch crew";
    nameField.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    host.querySelector<HTMLButtonElement>(".rp-btn.rp-primary")!.click();
    await settle();
    const created = calls.find((entry) => entry.cmd === "create_channel")!;
    expect(created).toBeDefined();
    expect(new Set(created.args.memberIds as string[])).toEqual(new Set(["me", "ana", "bo"]));
    expect((created.args.channel as any).name).toBe("Launch crew");
    expect(route().entityId).toBe((created.args.channel as any).id);
  });
});

describe("findExistingDirectChannel", () => {
  test("matches only the dm row whose exact two-person membership is {self, other}", async () => {
    const rows = [
      { id: "a", content_type: "dm", name: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null, description: null },
      { id: "b", content_type: "dm", name: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null, description: null },
    ] as any;
    const listMembers = async (id: string) => (id === "b" ? [{ profile_id: "me" }, { profile_id: "them" }] : [{ profile_id: "me" }, { profile_id: "someone-else" }]);
    const found = await findExistingDirectChannel(rows, "me", "them", listMembers);
    expect(found?.id).toBe("b");
  });

  test("no match returns undefined rather than guessing", async () => {
    const rows = [{ id: "a", content_type: "dm", name: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null, description: null }] as any;
    const listMembers = async () => [{ profile_id: "me" }, { profile_id: "someone-else" }];
    const found = await findExistingDirectChannel(rows, "me", "them", listMembers);
    expect(found).toBeUndefined();
  });
});
