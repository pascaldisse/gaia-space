// Substep 1: bounded call stage + scroll-safety + noise removal.
// Layout assertions here are CSS-source assertions (jsdom does no box layout), plus
// DOM/markup assertions for the parts jsdom *can* see: element presence, classes,
// and that the noise (eyebrow label, in-call room id, recording error boxes) is gone.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal,
  getTrackPublication: () => undefined,
  on: () => undefined,
  off: () => undefined,
});
class FakeRoom {
  static getLocalDevices = async () => [] as MediaDeviceInfo[];
  localParticipant = {
    ...participant(true),
    setMicrophoneEnabled: async () => undefined,
    setCameraEnabled: async () => undefined,
    setScreenShareEnabled: async () => undefined,
    publishData: async () => undefined,
  };
  remoteParticipants = new Map();
  listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  async connect() { this.listeners.get("connection")?.forEach(listener => listener("connected")); }
  async disconnect() { /* noop */ }
  async switchActiveDevice() { return true; }
}
mock_module();
function mock_module() {
  const { mock } = require("bun:test");
  mock.module("livekit-client", () => ({
    Room: FakeRoom,
    RoomEvent: { ConnectionStateChanged: "connection", ParticipantConnected: "participant-connected", ParticipantDisconnected: "participant-disconnected", TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", LocalTrackPublished: "track-published", LocalTrackUnpublished: "track-unpublished", DataReceived: "data-received" },
    ParticipantEvent: { TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", TrackPublished: "track-published", TrackUnpublished: "track-unpublished", LocalTrackPublished: "local-track-published", LocalTrackUnpublished: "local-track-unpublished", TrackMuted: "track-muted", TrackUnmuted: "track-unmuted" },
    Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
  }));
}
const { default: CallPanel } = await import("./CallPanel");

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meeting: Meeting = { id: "meeting-1", title: "Design review", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: null, visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: null, video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; });

test("the call stage is a bounded element, present before and after joining", async () => {
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  const stage = host.querySelector("[data-call-stage]");
  expect(stage).not.toBeNull();
  expect(stage!.classList.contains("call-stage")).toBe(true);
});

test("expand toggle switches the stage into theatre height once connected", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    if (command === "list_meeting_recordings" || command === "list_meeting_transcript_segments") return [];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  const stage = host.querySelector("[data-call-stage]") as HTMLElement;
  expect(stage.classList.contains("theatre")).toBe(false);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Expand") as HTMLButtonElement).click();
  await settle();
  expect(stage.classList.contains("theatre")).toBe(true);
});

test("the noise is gone: no LiveKit eyebrow label, no in-call room id line, no recording error boxes", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    // "command denied": the actor check fails outright.
    if (command === "recording_actor_status") throw new Error("command denied");
    // and the recordings list fetch fails too (both prior error boxes, gone).
    if (command === "list_meeting_recordings") throw new Error("command denied");
    if (command === "list_meeting_transcript_segments") return [];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(host.textContent).not.toContain("LiveKit meeting");
  expect(host.textContent).not.toContain("Room: meeting-meeting-1");
  expect(host.textContent).not.toContain("recording state unavailable");
  expect(host.textContent).not.toContain("Recording is unavailable");
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent === "Start recording")).toBe(false);
  const chip = host.querySelector(".call-state-chip") as HTMLElement;
  expect(chip.textContent).toContain("Connected");
});

test("CSS: the stage and its two host containers keep the message list scrollable, not the stage growing to fit content", () => {
  const meetingsCss = readFileSync(new URL("./Meetings.css", import.meta.url), "utf8");
  expect(meetingsCss).toMatch(/\.call-stage\{[^}]*height:var\(--call-stage-height\)/);
  expect(meetingsCss).toMatch(/\.call-stage\.theatre\{[^}]*height:var\(--call-stage-height-theatre\)/);
  const cwCss = readFileSync(new URL("./ChannelWorkspace.css", import.meta.url), "utf8");
  expect(cwCss).toMatch(/\.cw-call-panel\s*\{[^}]*flex:\s*none/);
  const chatCss = readFileSync(new URL("./Chat.css", import.meta.url), "utf8");
  expect(chatCss).toMatch(/\.message-pane\s*\{[^}]*overflow-y:\s*auto/);
  expect(chatCss).toMatch(/\.chat-detail\s*\{[^}]*overflow-y:\s*auto/);
});
