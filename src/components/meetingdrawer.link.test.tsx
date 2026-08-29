import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));

import { render } from "solid-js/web";
import MeetingDrawer, { type MeetingForm } from "./MeetingDrawer";
import { meetingLinkError, hasMeetingLink } from "../api/meetings";
import { reloadProfiles, setProfileId } from "../session";

/*  The law under test, in the product owner's words: "we have no meeting tool of our
 *  own, we meet on Google — I want to paste a link and get in with one click", and
 *  "when I create a meeting I cannot choose participants".
 *
 *  So three things must hold, and each is checked as a FACT, not as a claim:
 *    1. A link is a URL or it is REFUSED WITH A MESSAGE. No silent repair, no
 *       silent drop, and nothing provider-specific parsed out of it.
 *    2. Participants are PICKED FROM A LIST in the composer, TaskDrawer's control.
 *    3. Joining leaves the webview. `window.open` would open a Google Meet inside
 *       an embedded browser with no session and no camera permission, so the
 *       desktop hands the URL to the OS (`tauri-plugin-opener`) and the web build
 *       renders a plain `target="_blank" rel="noopener"` link. */

const settle = () => new Promise(resolve => setTimeout(resolve, 40));
let dispose: (() => void) | undefined;
const reply = (cmd: string) => {
  if (cmd === "list_profiles") return [
    { id: "me", username: "me", display_name: "Me", email: null, archived: false },
    { id: "mia", username: "mia", display_name: "Mia Berger", email: null, archived: false },
    { id: "gone", username: "gone", display_name: "Archived Person", email: null, archived: true },
  ];
  return [];
};
const blank = (): MeetingForm => ({
  title: "", description: null, starts_at: 1893456000, ends_at: 1893459600, rrule: null,
  location: null, organizer_id: "me", channel_id: null, visibility: "participants",
  modification_preference: "organizer-only", meeting_url: null,
});
const mount = async (form: MeetingForm, invitees: string[], sink: { added: string[]; removed: string[]; fields: [string, unknown][] }) => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string) => Promise.resolve(reply(cmd)) };
  setProfileId("me"); await reloadProfiles();
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <MeetingDrawer
    form={form}
    setField={(field, value) => sink.fields.push([field as string, value])}
    invitees={invitees}
    addInvitee={(id) => sink.added.push(id)}
    removeInvitee={(id) => sink.removed.push(id)}
    onSubmit={(event) => event.preventDefault()}
    onClose={() => {}}
  /> as any, host);
  await settle();
  return host;
};

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); });

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("a meeting link is a web address or it is refused by name", () => {
  expect(meetingLinkError(null)).toBe("");
  expect(meetingLinkError("   ")).toBe("");
  expect(meetingLinkError("https://meet.google.com/abc-defg-hij")).toBe("");
  expect(meetingLinkError("HTTP://zoom.us/j/1?pwd=x")).toBe("");
  for (const bad of ["meet.google.com/abc", "javascript:alert(1)", "file:///etc/passwd", "https://", "https:///nohost"]) {
    expect(meetingLinkError(bad)).not.toBe("");
  }
  // The Join affordance appears on exactly the meetings whose link would work.
  expect(hasMeetingLink({ meeting_url: "https://meet.google.com/x" })).toBe(true);
  expect(hasMeetingLink({ meeting_url: "meet.google.com/x" })).toBe(false);
  expect(hasMeetingLink({ meeting_url: null })).toBe(false);
});

test("the composer offers a meeting link field and objects to a bad one where it was typed", async () => {
  const sink = { added: [] as string[], removed: [] as string[], fields: [] as [string, unknown][] };
  const host = await mount({ ...blank(), meeting_url: "meet.google.com/abc" }, [], sink);

  const field = host.querySelector<HTMLInputElement>('input[aria-label="Meeting link"]');
  expect(field).toBeTruthy();
  expect(field!.value).toBe("meet.google.com/abc");
  expect(field!.getAttribute("aria-invalid")).toBe("true");
  const complaint = host.querySelector('[role="alert"]');
  expect(complaint?.textContent).toContain("http://");
});

test("participants are picked from the profile list, archived people excluded, and toggling reports both ways", async () => {
  const sink = { added: [] as string[], removed: [] as string[], fields: [] as [string, unknown][] };
  const host = await mount(blank(), ["mia"], sink);

  const boxes = [...host.querySelectorAll<HTMLInputElement>('.mtd-people input[type="checkbox"]')];
  const names = [...host.querySelectorAll('.mtd-person')].map(node => node.textContent?.trim());
  expect(names).toEqual(["Me", "Mia Berger"]);
  expect(boxes).toHaveLength(2);
  // The already-invited person is shown as invited, not offered as if they were not.
  expect(boxes[1].checked).toBe(true);
  expect(boxes[0].checked).toBe(false);

  boxes[0].click();
  expect(sink.added).toEqual(["me"]);
  boxes[1].click();
  expect(sink.removed).toEqual(["mia"]);
  // Choosing WHO COMES must not have touched WHO CAN SEE IT: they are separate facts.
  expect(sink.fields.map(([field]) => field)).not.toContain("visibility");
});

test("the desktop hands a meeting link to the operating system, never to the webview", () => {
  const api = source("../api/meetings.ts");
  const view = source("../views/Meetings.tsx");
  expect(api).toContain('from "@tauri-apps/plugin-opener"');
  expect(api).toContain("openUrl(url.trim())");
  // The one failure this whole path exists to prevent. Matched WITH the parenthesis:
  // the prose above the component names `window.open` precisely to say why not.
  expect(view).not.toContain("window.open(");
  // And on the web, where there is no plugin, the act is an ordinary safe link.
  expect(view).toContain('target="_blank" rel="noopener"');
});
