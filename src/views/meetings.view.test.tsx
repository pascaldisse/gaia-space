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
    expect(create!.args.meeting).toMatchObject({ title: "Planning", description: "Priorities", rrule: "FREQ=WEEKLY;COUNT=4", organizer_id: "pa", archived: false });
    expect(host.querySelector(".meeting-permalink")?.textContent).toContain("calendar");
  });
});
