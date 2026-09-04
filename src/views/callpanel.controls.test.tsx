// Substep 3: bottom-center control bar, ⋯ device/room-id menu, chat+captions drawer.
import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal, isSpeaking: false,
  getTrackPublication: () => undefined,
  on: () => undefined,
  off: () => undefined,
});
class FakeRoom {
  static getLocalDevices = async () => [{ deviceId: "mic-1", label: "Studio microphone" }] as MediaDeviceInfo[];
  localParticipant = {
    ...participant(true),
    setMicrophoneEnabled: async () => undefined,
    setCameraEnabled: async () => undefined,
    setScreenShareEnabled: async () => undefined,
    publishData: async () => undefined,
  };
  remoteParticipants = new Map([["them", participant(false)]]);
  listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  async connect() { this.listeners.get("connection")?.forEach(listener => listener("connected")); }
  async disconnect() { /* noop */ }
  async switchActiveDevice() { return true; }
}
mock.module("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: { ConnectionStateChanged: "connection", ParticipantConnected: "participant-connected", ParticipantDisconnected: "participant-disconnected", TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", LocalTrackPublished: "track-published", LocalTrackUnpublished: "track-unpublished", DataReceived: "data-received" },
  ParticipantEvent: { TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", TrackPublished: "track-published", TrackUnpublished: "track-unpublished", LocalTrackPublished: "local-track-published", LocalTrackUnpublished: "local-track-unpublished", TrackMuted: "track-muted", TrackUnmuted: "track-unmuted", IsSpeakingChanged: "speaking-changed" },
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
}));
const { default: CallPanel } = await import("./CallPanel");

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meeting: Meeting = { id: "meeting-1", title: "Design review", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: null, visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: null, video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
const invoke = async (command: string) => {
  if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
  if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
  if (command === "list_meeting_recordings" || command === "list_meeting_transcript_segments") return [];
  throw new Error(`unexpected command: ${command}`);
};
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; });

test("the control bar sits on the stage with mic/camera/share/leave as labelled controls, and the drawer starts closed", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  const bar = host.querySelector(".call-control-bar") as HTMLElement;
  expect(bar).not.toBeNull();
  expect(bar.parentElement!.classList.contains("call-stage")).toBe(true); // overlay lives inside the bounded stage
  for (const label of ["Mute microphone", "Turn camera off", "Share screen", "Leave call"]) {
    expect(bar.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  }
  expect(host.querySelector(".call-drawer")).toBeNull(); // default closed
  expect(host.querySelector(".call-menu")).toBeNull(); // default closed
});

test("the ⋯ menu is where the device pickers and room id live, closed until opened", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(host.querySelectorAll("select")).toHaveLength(0);
  (host.querySelector('[aria-label="More options: devices, room id"]') as HTMLButtonElement).click();
  await settle();
  expect(host.querySelectorAll("select")).toHaveLength(3);
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent === "Copy room id")).toBe(true);
});

test("chat and captions share one collapsible drawer, toggled from the control bar", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  (host.querySelector('[aria-label="Toggle in-call chat"]') as HTMLButtonElement).click();
  await settle();
  expect(host.querySelector('input[aria-label="Chat message"]')).not.toBeNull();
  expect(host.querySelectorAll(".call-drawer")).toHaveLength(1); // one drawer, not two panels
  (host.querySelector('[aria-label="Toggle live captions"]') as HTMLButtonElement).click();
  await settle();
  expect(host.querySelector('input[aria-label="Chat message"]')).toBeNull();
  expect(host.querySelectorAll(".call-drawer")).toHaveLength(1);
  // Toggling the same tab again closes the drawer.
  (host.querySelector('[aria-label="Toggle live captions"]') as HTMLButtonElement).click();
  await settle();
  expect(host.querySelector(".call-drawer")).toBeNull();
});
