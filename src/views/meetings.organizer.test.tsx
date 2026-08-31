/** ISSUE #5, THE THIRD FACT — A MEETING NOBODY COULD SEE IS NOT CREATED.
 *
 *  `MEETING_READ_SCOPE` (src-tauri/src/meetings.rs) shows a `participants` meeting to
 *  its organizer, to an invited participant, or through a project channel. A row with
 *  `organizer_id` null matches NONE of them: the write succeeds and the meeting is then
 *  invisible to the very person who booked it — "create meeting doesn't work", with a
 *  green command in the log.
 *
 *  So the composer refuses first, and says why. This lives in its own file because the
 *  state under test is "the workspace can name no profile at all", which has to hold
 *  from the surface's first render (the composer's draft takes its organizer then).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Meetings from "./Meetings";
import { reloadProfiles, setProfileId } from "../session";
import { NO_ORGANIZER } from "../calendar";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";

type Call = { cmd: string; args: Record<string, unknown> };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 35));

beforeEach(async () => {
  // A workspace that can name nobody: `list_profiles` is empty, so identity
  // resolution (`ensureDefaults`) has nothing to fall back to.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const cmd = String(url).split("api/cmd/")[1];
    calls.push({ cmd, args: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, value: [] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  registerViews(["Dashboard", "Calendar", "Meetings"]);
  setAvailableViews(["Dashboard", "Calendar", "Meetings"]);
  initRouter(createMemoryAdapter("meetings"));
  /* The profile cache is process-wide (one module registry for the whole run), so the
     empty list is loaded THROUGH it before the surface renders — otherwise a profile
     another file happened to load would resolve the identity this test denies. */
  await reloadProfiles();
  setProfileId("");
  calls.length = 0;
});

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  globalThis.fetch = realFetch; setProfileId("");
  delete (window as any).__TAURI_INTERNALS__;
});

describe("organizer resolution follows the command transport", () => {
  test("a web session sends create_meeting with a null organizer for server rebinding", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <Meetings /> as any, host);
    await settle();

    (host.querySelector("button.meeting-new") as HTMLButtonElement).click();
    await settle();
    const form = host.querySelector("form[aria-label='New meeting']") as HTMLFormElement;
    const title = form.querySelector("input[aria-label='Meeting title']") as HTMLInputElement;
    title.value = "Planning";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const create = calls.find((call) => call.cmd === "create_meeting");
    expect(create).toBeTruthy();
    expect((create!.args.meeting as { organizer_id: string | null }).organizer_id).toBeNull();
  });

  test("desktop IPC refuses an unresolved organizer and says why in the composer", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <Meetings /> as any, host);
    await settle();
    (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args }); return Promise.resolve([]);
    } };
    (host.querySelector("button.meeting-new") as HTMLButtonElement).click();
    await settle();
    const form = host.querySelector("form[aria-label='New meeting']") as HTMLFormElement;
    const title = form.querySelector("input[aria-label='Meeting title']") as HTMLInputElement;
    title.value = "Planning";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(calls.some((call) => call.cmd === "create_meeting")).toBe(false);
    expect(host.querySelector(".mtd-error")?.textContent ?? "").toBe(NO_ORGANIZER);
  });
});
