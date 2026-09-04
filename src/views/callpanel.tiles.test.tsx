// Substep 2: tiles grid, self PiP, waiting state, audioOnly avatar grid.
import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const remoteBase = (identity: string, name: string) => ({
  identity, name, isLocal: false, isSpeaking: false,
  getTrackPublication: () => undefined,
  on: () => undefined,
  off: () => undefined,
});
class FakeRoom {
  static getLocalDevices = async () => [] as MediaDeviceInfo[];
  remoteCount: number;
  constructor(remoteCount = 1) { this.remoteCount = remoteCount; }
  localParticipant = {
    identity: "me", name: "Me", isLocal: true, isSpeaking: false,
    getTrackPublication: () => undefined,
    on: () => undefined,
    off: () => undefined,
    setMicrophoneEnabled: async () => undefined,
    setCameraEnabled: async () => undefined,
    setScreenShareEnabled: async () => undefined,
    publishData: async () => undefined,
  };
  get remoteParticipants() {
    const entries: [string, any][] = [];
    for (let index = 0; index < this.remoteCount; index += 1) entries.push([`them-${index}`, remoteBase(`them-${index}`, `Them ${index}`)]);
    return new Map(entries);
  }
  listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  async connect() { this.listeners.get("connection")?.forEach(listener => listener("connected")); }
  async disconnect() { /* noop */ }
  async switchActiveDevice() { return true; }
}
let remoteCountForNextRoom = 1;
mock.module("livekit-client", () => ({
  Room: class extends FakeRoom { constructor() { super(remoteCountForNextRoom); } },
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
const join = async (host: HTMLElement) => {
  (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
};
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; delete (window as any).__TAURI_INTERNALS__; remoteCountForNextRoom = 1; });

test("alone in the room: self renders as the PiP, not a main tile, with a waiting message", async () => {
  remoteCountForNextRoom = 0;
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  await join(host);
  expect(host.textContent).toContain("Waiting for others");
  const pip = host.querySelector(".call-pip");
  expect(pip).not.toBeNull();
  expect(pip!.querySelector('article[aria-label="Me, you"]')).not.toBeNull();
  // The self tile is ONLY inside the PiP, never also in the main grid.
  const mainGrid = host.querySelector(".call-tiles");
  expect(mainGrid!.querySelector('article[aria-label="Me, you"]')).toBeNull();
});

test("grid class follows remote participant count: 1 full, 2 side-by-side, 3-4 a 2x2, >4 auto-fit", async () => {
  const cases: [number, string][] = [[1, "call-grid-1"], [2, "call-grid-2"], [4, "call-grid-2x2"], [6, "call-grid-auto"]];
  for (const [count, expectedClass] of cases) {
    remoteCountForNextRoom = count;
    (window as any).__TAURI_INTERNALS__ = { invoke };
    const host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
    await join(host);
    const grid = host.querySelector(".call-tiles") as HTMLElement;
    expect(grid.classList.contains(expectedClass)).toBe(true);
    expect(grid.querySelectorAll("article")).toHaveLength(count);
    dispose(); dispose = undefined; host.remove();
  }
});

test("audioOnly mode renders avatar circles, not video, for both the grid and the self PiP", async () => {
  remoteCountForNextRoom = 2;
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" audioOnly />, host);
  await join(host);
  expect(host.querySelectorAll("video")).toHaveLength(0);
  expect(host.querySelectorAll(".call-audio-participant")).toHaveLength(3); // 2 remote + self PiP
  const grid = host.querySelector(".call-tiles") as HTMLElement;
  expect(grid.classList.contains("audio-only")).toBe(true);
});
