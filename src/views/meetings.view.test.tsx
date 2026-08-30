import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Meetings from "./Meetings";
import { setProfileId } from "../session";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";

type Call = { cmd: string; args: Record<string, unknown> };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const settle = () => new Promise(done => setTimeout(done, 35));

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; globalThis.fetch = realFetch; setProfileId(""); });

function mount() {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const cmd = url.split("api/cmd/")[1];
    const args = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ cmd, args });
    const value = cmd === "list_profiles" ? [{ id: "pa", username: "pat", display_name: "Pat", archived: false }] : [];
    return new Response(JSON.stringify({ ok: true, value }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  registerViews(["Dashboard", "Calendar", "Meetings"]); setAvailableViews(["Dashboard", "Calendar", "Meetings"]); initRouter(createMemoryAdapter("meetings"));
  setProfileId("pa");
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Meetings /> as any, host);
  return host;
}

describe("meetings view", () => {
  test("books a described recurring meeting and links back to Calendar", async () => {
    const host = mount(); await settle();
    expect(host.querySelector(".meeting-calendar-link")?.getAttribute("href")).toContain("calendar");
    // The composer is no longer permanent furniture on the surface — it is a drawer
    // opened by the header's primary action. Opening it is the only step added here;
    // every field, label and assertion below is unchanged.
    (host.querySelector("button.meeting-new") as HTMLButtonElement).click(); await settle();
    const form = host.querySelector("form[aria-label='New meeting']") as HTMLFormElement;
    const title = form.querySelector("input[aria-label='Meeting title']") as HTMLInputElement;
    title.value = "Planning"; title.dispatchEvent(new Event("input", { bubbles: true }));
    const description = form.querySelector("textarea[aria-label='Meeting description']") as HTMLTextAreaElement;
    description.value = "Priorities"; description.dispatchEvent(new Event("input", { bubbles: true }));
    const recurrence = form.querySelector("input[aria-label='RRULE recurrence']") as HTMLInputElement;
    recurrence.value = "FREQ=WEEKLY;COUNT=4"; recurrence.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle();
    const create = calls.find(call => call.cmd === "create_meeting");
    expect(create).toBeTruthy();
    const createdMeeting = create!.args.meeting as { id: string };
    expect(createdMeeting).toMatchObject({ title: "Planning", description: "Priorities", rrule: "FREQ=WEEKLY;COUNT=4", organizer_id: "pa", visibility: "participants", modification_preference: "organizer-only", archived: false });
    expect(calls.some(call => call.cmd === "attach_meeting_channel" && call.args.id === createdMeeting.id)).toBe(true);
    expect(host.querySelector(".meeting-permalink")?.textContent).toContain("calendar");
  });

  /* THE LIST IS THE KNOWLEDGE CARD (design rollout). A meeting row must carry the
     mark tile, the bold title, EXACTLY ONE meta line and the arrow — the same parts
     `.documents-library-card` has. Two stacked muted lines are what this replaced. */
  test("a meeting is listed as a card: tile, title, one meta line, arrow", async () => {
    const meeting = {
      id: "m1", title: "Planning", description: "", starts_at: 4102444800, ends_at: 4102448400,
      location: "Room 4.12", rrule: "", organizer_id: "pa", visibility: "participants",
      modification_preference: "organizer-only", archived: false, channel_id: null,
    };
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const cmd = url.split("api/cmd/")[1];
      const args = init.body ? JSON.parse(String(init.body)) : {};
      calls.push({ cmd, args });
      const value = cmd === "list_profiles"
        ? [{ id: "pa", username: "pat", display_name: "Pat", archived: false }]
        : cmd === "list_meetings" ? [meeting] : [];
      return new Response(JSON.stringify({ ok: true, value }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    registerViews(["Dashboard", "Calendar", "Meetings"]); setAvailableViews(["Dashboard", "Calendar", "Meetings"]); initRouter(createMemoryAdapter("meetings"));
    setProfileId("pa");
    const host = document.createElement("div"); document.body.appendChild(host);
    dispose = render(() => <Meetings /> as any, host);
    await settle();
    const row = host.querySelector(".meeting-row") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector(".meeting-row-icon svg")).toBeTruthy();
    expect(row.querySelector(".meeting-row-copy strong")?.textContent).toBe("Planning");
    expect(row.querySelectorAll(".meeting-row-copy small").length).toBe(1);
    expect(row.querySelector(".meeting-row-copy small")?.textContent).toContain("Room 4.12");
    expect(row.querySelector(".meeting-row-open")?.textContent).toBe("\u2192");
  });
});
