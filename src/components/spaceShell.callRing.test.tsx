import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SpaceShell from "./SpaceShell";
import { setProfileId } from "../session";
import { navigate, registerViews, route, setAvailableViews } from "../router";
import type { Meeting } from "../api/meetings";

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const now = Math.floor(Date.now() / 1_000);
const incoming = (status: Meeting["video_status"] = "scheduled"): Meeting => ({
  id: "call-1", title: "Design", description: null, starts_at: now, ends_at: now + 3600, rrule: null, location: null,
  organizer_id: "caller", channel_id: "channel-1", visibility: "participants", modification_preference: "organizer-only",
  archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: status,
  video_started_at: status === "live" ? now : null, video_ended_at: status === "ended" ? now : null, video_ended_by: null,
  source_entity_type: null, source_entity_id: null,
});
const settle = () => new Promise(done => setTimeout(done, 35));
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.innerHTML = ""; globalThis.fetch = realFetch;
  setProfileId(""); window.history.replaceState({}, "", "/");
});
const mount = (meetings: Meeting[], calls: string[]) => {
  setProfileId("me");
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const command = String(url).split("api/cmd/")[1] ?? "";
    if (command === "list_meetings") return new Response(JSON.stringify({ ok: true, value: meetings }), { headers: { "content-type": "application/json" } });
    if (command === "list_meeting_participants") return new Response(JSON.stringify({ ok: true, value: [{ meeting_id: "call-1", profile_id: "me", status: "invited" }] }), { headers: { "content-type": "application/json" } });
    if (command === "set_meeting_participant_status") { calls.push(String(init?.body)); return new Response(JSON.stringify({ ok: true, value: null }), { headers: { "content-type": "application/json" } }); }
    if (command === "list_channels_with_meta") return new Response(JSON.stringify({ ok: true, value: [{ id: "channel-1", content_type: "public", name: "Design", description: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null }] }), { headers: { "content-type": "application/json" } });
    if (command === "list_profiles" || command === "list_projects") return new Response(JSON.stringify({ ok: true, value: [] }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, value: [] }), { headers: { "content-type": "application/json" } });
  }) as any;
  registerViews(["Chat"]); setAvailableViews(null); navigate({ view: "Chat" });
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <SpaceShell views={[{ name: "Chat", icon: "chat" }]} active="Chat" onOpenSearch={() => {}}><div /></SpaceShell>, host);
  return host;
};
describe("global incoming call ring", () => {
  test("renders caller and Accept navigates plus accepts RSVP", async () => {
    const calls: string[] = []; const host = mount([incoming()], calls); await settle();
    expect(host.querySelector(".incoming-call-ring")?.textContent).toContain("caller");
    (host.querySelector(".accept") as HTMLButtonElement).click(); await settle();
    expect(calls.join()).toContain('"status":"accepted"'); expect(route()).toMatchObject({ entityType: "channel", entityId: "channel-1", tab: "messages" });
  });
  test("Decline persists RSVP and hides the ring", async () => {
    const calls: string[] = []; const host = mount([incoming()], calls); await settle();
    (host.querySelector(".decline") as HTMLButtonElement).click(); await settle();
    expect(calls.join()).toContain('"status":"declined"'); expect(host.querySelector(".incoming-call-ring")).toBeNull();
  });
  test("ended calls never render", async () => {
    const calls: string[] = []; const host = mount([incoming("ended")], calls); await settle();
    expect(host.querySelector(".incoming-call-ring")).toBeNull();
  });
});
