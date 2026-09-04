import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Chat from "./Chat";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { setProfileId } from "../session";

type Invocation = { cmd: string; args: Record<string, unknown> };
let dispose: (() => void) | undefined;
let calls: Invocation[] = [];
let meetings: any[] = [];
const channel = { id: "channel-1", content_type: "public", name: "Design", description: null, project_id: null, archived: false, member_count: 2, unread_count: 0, last_message_at: null };
const settle = () => new Promise(resolve => setTimeout(resolve, 80));
const reply = (cmd: string, args: Record<string, unknown>) => {
  if (cmd === "list_profiles") return [{ id: "me", username: "me", display_name: "Me", avatar_url: null, archived: false }, { id: "you", username: "you", display_name: "You", avatar_url: null, archived: false }];
  if (cmd === "list_channels_with_meta") return [channel];
  if (cmd === "private_feed") return channel;
  if (cmd === "list_channel_members") return [{ channel_id: "channel-1", profile_id: "me", administrator: true }, { channel_id: "channel-1", profile_id: "you", administrator: false }];
  if (cmd === "list_meetings") return meetings;
  if (cmd === "list_messages_page") return { messages: [], next_cursor: null, has_more: false };
  if (cmd === "get_channel_notification_preference") return { profile_id: "me", channel_id: "channel-1", email_enabled: true, push_enabled: true, thread_scope: "all" };
  if (cmd === "list_mentions_for_profile" || cmd === "list_pinned_messages" || cmd === "list_scheduled_messages" || cmd === "list_applications" || cmd === "list_projects") return [];
  if (cmd === "create_channel_call") { meetings = [...meetings, args.meeting]; return args.meeting; }
  return [];
};
const mount = async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Chat /> as any, host);
  await settle(); return host;
};
beforeEach(() => {
  calls = []; meetings = [];
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown> = {}) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd, args)); } };
  registerViews(["Chat"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  setProfileId("me"); navigate({ view: "Chat", entityType: "channel", entityId: "channel-1" });
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); });

describe("chat calls", () => {
  test("renders Call and Video controls", async () => {
    const host = await mount();
    expect(host.querySelector('[aria-label="Call"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Video"]')).toBeTruthy();
  });
  test("Video creates a LiveKit meeting bound to the open channel", async () => {
    const host = await mount();
    host.querySelector<HTMLButtonElement>('[aria-label="Video"]')!.click();
    await settle();
    const call = calls.find(item => item.cmd === "create_channel_call");
    expect(call?.args.meeting).toMatchObject({ channel_id: "channel-1", video_provider: "livekit", visibility: "participants" });
    expect(calls.some(item => item.cmd === "join_meeting_call")).toBe(true);
    expect(host.querySelector('[aria-label="Live call"]')).toBeTruthy();
  });
  test("shows a join banner for a live channel meeting", async () => {
    const now = Math.floor(Date.now() / 1_000);
    meetings = [{ id: "meeting-live", title: "Design", description: null, starts_at: now, ends_at: now + 300, rrule: null, location: null, organizer_id: "you", channel_id: "channel-1", visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: "livekit", video_room_id: "room", join_url: null, meeting_url: null, video_status: "live", video_started_at: now, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null }];
    const host = await mount();
    expect(host.querySelector(".chat-live-call")?.textContent).toContain("Call live");
    expect(host.querySelector(".chat-live-call button")?.textContent).toBe("Join");
  });
});
