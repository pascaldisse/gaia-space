import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import ChannelWorkspace from "./ChannelWorkspace";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { setProfileId } from "../session";

let dispose: (() => void) | undefined;
const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
const channel = { id: "channel-1", content_type: "public", name: "Design", description: null, project_id: null, archived: false };
const settle = () => new Promise(resolve => setTimeout(resolve, 80));
const reply = (cmd: string, _args: Record<string, unknown>) => {
  if (cmd === "get_channel") return channel;
  if (cmd === "list_channel_members") return [{ channel_id: channel.id, profile_id: "me", administrator: true }];
  if (cmd === "list_profiles") return [{ id: "me", username: "me", display_name: "Me", email: null, archived: false }];
  if (["list_projects", "list_mentions_for_profile", "list_meetings", "list_messages_page", "list_channels_with_meta", "list_applications", "list_pinned_messages", "list_scheduled_messages"].includes(cmd)) return [];
  if (cmd === "private_feed") return channel;
  if (cmd === "get_channel_notification_preference") return { profile_id: "me", channel_id: channel.id, email_enabled: true, push_enabled: true, thread_scope: "all" };
  if (cmd === "create_channel_call") return { ..._args.meeting as object };
  return [];
};

beforeEach(() => {
  calls.length = 0;
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: Record<string, unknown> = {}) => { calls.push({ cmd, args }); return Promise.resolve(reply(cmd, args)); } };
  registerViews(["Chat"]); setAvailableViews(null); initRouter(createMemoryAdapter());
  setProfileId("me"); navigate({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" });
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; setProfileId(""); });

test("/channel/:id/messages renders channel Call and Video, and Video creates its meeting", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <ChannelWorkspace /> as any, host);
  await settle();
  expect(host.querySelector('[aria-label="Call"]')).toBeTruthy();
  host.querySelector<HTMLButtonElement>('[aria-label="Video"]')!.click();
  await settle();
  expect(calls.find(call => call.cmd === "create_channel_call")?.args.meeting).toMatchObject({ channel_id: channel.id, video_provider: "livekit" });
  expect(host.querySelector('[aria-label="Live call"]')).toBeTruthy();
});
test("Call controls explain a missing acting profile without creating a meeting", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <ChannelWorkspace /> as any, host);
  await settle();
  setProfileId("");
  await Promise.resolve();
  const video = host.querySelector<HTMLButtonElement>('[aria-label="Video"]')!;
  expect(video.disabled).toBe(true);
  expect(video.title).toBe("Sign-in still loading");
  // A stale browser event can reach the already-rendered listener while identity changes.
  // The handler must still explain the guard instead of silently returning.
  video.disabled = false;
  video.click();
  await Promise.resolve();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Sign-in still loading");
  expect(calls.some(call => call.cmd === "create_channel_call")).toBe(false);
});
