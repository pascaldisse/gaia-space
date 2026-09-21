// Call lifecycle across MEETINGS, not across one browser session.
// Prod, 2026-09-21: the organizer ended a call, the other party stayed connected to a
// live SFU room, and the next Call press minted a second meeting that the reused panel
// never joined. Three facts pinned here:
//   1. a server-side disconnect (room deleted) says so instead of dropping to idle,
//   2. a new meeting in the same panel instance auto-joins,
//   3. an idle panel can be closed.
import { afterEach, expect, mock, test } from "bun:test";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal, isSpeaking: false,
  getTrackPublication: () => undefined, on: () => undefined, off: () => undefined,
});
const rooms: FakeRoom[] = [];
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
  disconnects = 0;
  constructor() { rooms.push(this); }
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  emit(event: string, ...args: any[]) { this.listeners.get(event)?.forEach(listener => listener(...args)); }
  async connect() { this.emit("connection", "connected"); }
  async disconnect() { this.disconnects += 1; this.emit("disconnected"); }
  async switchActiveDevice() { return true; }
}
mock.module("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: { ConnectionStateChanged: "connection", Disconnected: "disconnected", ParticipantConnected: "participant-connected", ParticipantDisconnected: "participant-disconnected", TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", LocalTrackPublished: "track-published", LocalTrackUnpublished: "track-unpublished", DataReceived: "data-received" },
  ParticipantEvent: { TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", TrackPublished: "track-published", TrackUnpublished: "track-unpublished", LocalTrackPublished: "local-track-published", LocalTrackUnpublished: "local-track-unpublished", TrackMuted: "track-muted", TrackUnmuted: "track-unmuted", IsSpeakingChanged: "speaking-changed" },
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
}));
const { default: CallPanel } = await import("./CallPanel");

const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meetingWith = (id: string): Meeting => ({ id, title: "Pascal · Jannes", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: "chan-1", visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: "live", video_started_at: 1, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null });
const joins: string[] = [];
const invoke = async (command: string, args?: any) => {
  if (command === "join_meeting_call") { joins.push(args.meetingId); return { url: "ws://livekit.test", room: `meeting-${args.meetingId}`, token: "signed-token" }; }
  if (command === "recording_actor_status") return { available: false, profile_id: null, source: null, reason: "Call recording is not available in web mode." };
  if (command === "list_meeting_recordings" || command === "list_meeting_transcript_segments") return [];
  throw new Error(`unexpected command: ${command}`);
};
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; rooms.length = 0; joins.length = 0; delete (window as any).__TAURI_INTERNALS__; });

test("a server-side disconnect reports that the call ended instead of going quiet", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meetingWith("meeting-1")} identity="me" displayName="Me" autoJoin />, host);
  await settle();
  expect(host.querySelector(".call-state-chip")!.textContent).toContain("Connected");
  rooms[0].emit("disconnected");
  await settle();
  expect(host.textContent).toContain("This call has ended.");
  expect(Array.from(host.querySelectorAll("button")).some(b => b.textContent === "Join call")).toBe(true);
});

test("leaving on purpose does NOT claim the call ended", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meetingWith("meeting-1")} identity="me" displayName="Me" autoJoin />, host);
  await settle();
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Leave call") as HTMLButtonElement).click();
  await settle();
  expect(host.textContent).not.toContain("This call has ended.");
});

test("a second call in the same panel instance is joined, not left ringing", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const [meeting, setMeeting] = createSignal(meetingWith("meeting-1"));
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting()} identity="me" displayName="Me" autoJoin />, host);
  await settle();
  expect(joins).toEqual(["meeting-1"]);
  setMeeting(meetingWith("meeting-2"));
  await settle();
  expect(joins).toEqual(["meeting-1", "meeting-2"]);
  // the first room is not left running in the background
  expect(rooms[0].disconnects).toBe(1);
  expect(host.querySelector(".call-state-chip")!.textContent).toContain("Connected");
});

test("an idle panel offers Close only when a host owns it, and never mid-call", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  let closed = 0;
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meetingWith("meeting-1")} identity="me" displayName="Me" onClose={() => { closed += 1; }} />, host);
  const close = () => Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Close") as HTMLButtonElement | undefined;
  expect(close()).toBeDefined();
  close()!.click();
  expect(closed).toBe(1);
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(close()).toBeUndefined();
});
