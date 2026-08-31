/** ISSUE #5 — "create meeting doesn't work".
 *
 *  The native side is innocent: `create_meeting`, `attach_meeting_channel`,
 *  `invite_meeting_participant` and `list_meetings` all accept the composer's exact
 *  payload over the real command route (see the Rust tests added beside them). What
 *  breaks is the FIRST line of the client's `create`: `crypto.randomUUID()`.
 *
 *  `crypto.randomUUID` exists ONLY IN A SECURE CONTEXT. The web build is served at
 *  `http://<host>/space/`, which is not one, so the property is undefined there and
 *  the call throws `TypeError` BEFORE any command is sent. The catch turns it into
 *  the composer's error line, so the surface says something went wrong while the
 *  network shows no request at all — exactly the report.
 *
 *  `Applications.tsx` already writes `crypto.randomUUID?.() ?? …`, which is the same
 *  bug met once before and guarded in one place only.
 *
 *  This test reproduces the insecure context by removing the property, and asserts the
 *  ONE fact a person cares about: pressing "Create meeting" sends `create_meeting`.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Meetings from "./Meetings";
import { setProfileId } from "../session";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";

type Call = { cmd: string; args: Record<string, unknown> };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
const realRandomUUID = crypto.randomUUID;
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 35));

/** A page that is not a secure context: the property is simply absent. */
const enterInsecureContext = () => {
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
};
const leaveInsecureContext = () => {
  Object.defineProperty(crypto, "randomUUID", { value: realRandomUUID, configurable: true, writable: true });
};

beforeEach(() => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const cmd = String(url).split("api/cmd/")[1];
    calls.push({ cmd, args: init.body ? JSON.parse(String(init.body)) : {} });
    const value = cmd === "list_profiles"
      ? [{ id: "pa", username: "pat", display_name: "Pat", archived: false }]
      : cmd === "attach_meeting_channel" ? "channel-1" : [];
    return new Response(JSON.stringify({ ok: true, value }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  registerViews(["Dashboard", "Calendar", "Meetings"]);
  setAvailableViews(["Dashboard", "Calendar", "Meetings"]);
  initRouter(createMemoryAdapter("meetings"));
  setProfileId("pa");
});

afterEach(() => {
  leaveInsecureContext();
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  globalThis.fetch = realFetch; setProfileId("");
});

/** The fetch stub, with a chosen command made to fail. */
const serveWith = (failing?: string, people = [{ id: "pa", username: "pat", display_name: "Pat", archived: false }]) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const cmd = String(url).split("api/cmd/")[1];
    calls.push({ cmd, args: init.body ? JSON.parse(String(init.body)) : {} });
    if (cmd === failing)
      return new Response(JSON.stringify({ ok: false, error: "channel refused" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    const value = cmd === "list_profiles"
      ? people
      : cmd === "attach_meeting_channel" ? "channel-1" : [];
    return new Response(JSON.stringify({ ok: true, value }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
};

const mount = () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Meetings /> as any, host);
  return host;
};

const book = async (host: HTMLElement) => {
  (host.querySelector("button.meeting-new") as HTMLButtonElement).click();
  await settle();
  const form = host.querySelector("form[aria-label='New meeting']") as HTMLFormElement;
  const title = form.querySelector("input[aria-label='Meeting title']") as HTMLInputElement;
  title.value = "Planning";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
};

describe("a meeting is created on a page that is not a secure context", () => {
  test("the composer still sends create_meeting when crypto.randomUUID is absent", async () => {
    enterInsecureContext();
    const host = mount();
    await settle();
    await book(host);
    const create = calls.find((call) => call.cmd === "create_meeting");
    expect(create).toBeTruthy();
    const meeting = create!.args.meeting as { id: string };
    expect(typeof meeting.id).toBe("string");
    expect(meeting.id.length).toBeGreaterThan(0);
    // Two meetings booked in the same page must not collide on one id.
    expect(host.querySelector(".meeting-error")?.textContent ?? "").toBe("");
  });

  test("a secure context is unaffected: the same act sends the same command", async () => {
    const host = mount();
    await settle();
    await book(host);
    expect(calls.some((call) => call.cmd === "create_meeting")).toBe(true);
  });
});

/** ISSUE #5, THE SECOND HALF. `attach_meeting_channel` runs AFTER the meeting is
 *  stored. When one outer catch owned the whole sequence, its refusal closed the
 *  composer over nothing: the form kept the draft, no notice was said and the list was
 *  never refetched — a booked meeting reported as a failed create. */
describe("a second act on a stored meeting is not a failed create", () => {
  test("a refused attach_meeting_channel keeps the create, says so, and still reloads the list", async () => {
    serveWith("attach_meeting_channel");
    const host = mount();
    await settle();
    await book(host);

    expect(calls.some((call) => call.cmd === "create_meeting")).toBe(true);
    expect(calls.some((call) => call.cmd === "attach_meeting_channel")).toBe(true);
    // The meeting exists, so the surface says so — and the drawer is gone.
    expect(host.querySelector(".meeting-notice")?.textContent ?? "").toContain("created");
    expect(host.querySelector("form[aria-label='New meeting']")).toBeNull();
    // The refusal is still reported, as itself.
    expect(host.querySelector(".meeting-error")?.textContent ?? "").toContain("channel refused");
    // The list is read again AFTER the create, so the new meeting can appear.
    const created = calls.findIndex((call) => call.cmd === "create_meeting");
    const reloaded = calls.map((call, index) => ({ ...call, index }))
      .filter((call) => call.cmd === "list_meetings" && call.index > created);
    expect(reloaded.length).toBeGreaterThan(0);
  });
});
