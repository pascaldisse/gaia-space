import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const calls: string[] = [];
const ipcCommands: string[] = [];
const remoteAudioAttachments: HTMLMediaElement[] = [];
const remoteVideoAttachments: HTMLVideoElement[] = [];
const remoteVideoDetachments: HTMLVideoElement[] = [];
const remoteListeners = new Map<string, ((...args: any[]) => void)[]>();
let remoteVideoPublication: { videoTrack: { attach: (element: HTMLVideoElement) => void; detach: (element: HTMLVideoElement) => void } } | undefined;
const emitRemote = (event: string) => remoteListeners.get(event)?.forEach(listener => listener());
const devices = [{ deviceId: "mic-1", label: "Studio microphone" }];
const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal,
  getTrackPublication: () => undefined,
  on: () => undefined,
  off: () => undefined,
});
const remoteParticipant = {
  ...participant(false),
  on: (event: string, listener: (...args: any[]) => void) => remoteListeners.set(event, [...(remoteListeners.get(event) ?? []), listener]),
  off: (event: string, listener: (...args: any[]) => void) => remoteListeners.set(event, (remoteListeners.get(event) ?? []).filter(item => item !== listener)),
  getTrackPublication: (source: string) => source === "camera" ? remoteVideoPublication : source === "microphone" ? { audioTrack: { attach: (element: HTMLMediaElement) => remoteAudioAttachments.push(element), detach: () => undefined } } : undefined,
};
class FakeRoom {
  static getLocalDevices = async () => devices as MediaDeviceInfo[];
  localParticipant = {
    ...participant(true),
    setMicrophoneEnabled: async (enabled: boolean) => { calls.push(`microphone:${enabled}`); },
    setCameraEnabled: async (enabled: boolean) => { calls.push(`camera:${enabled}`); },
    setScreenShareEnabled: async (enabled: boolean) => { calls.push(`screen:${enabled}`); },
    publishData: async (payload: Uint8Array) => { calls.push(`chat:${new TextDecoder().decode(payload)}`); },
  };
  remoteParticipants = new Map([["them", remoteParticipant]]);
  listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  async connect() { this.listeners.get("connection")?.forEach(listener => listener("connected")); }
  async disconnect() { calls.push("leave"); }
  async switchActiveDevice(kind: string, deviceId: string) { calls.push(`device:${kind}:${deviceId}`); return true; }
}
mock.module("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: { ConnectionStateChanged: "connection", ParticipantConnected: "participant-connected", ParticipantDisconnected: "participant-disconnected", TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", LocalTrackPublished: "track-published", LocalTrackUnpublished: "track-unpublished", DataReceived: "data-received" },
  ParticipantEvent: { TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", TrackPublished: "track-published", TrackUnpublished: "track-unpublished", LocalTrackPublished: "local-track-published", LocalTrackUnpublished: "local-track-unpublished", TrackMuted: "track-muted", TrackUnmuted: "track-unmuted" },
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
}));
const { default: CallPanel } = await import("./CallPanel");

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meeting: Meeting = { id: "meeting-1", title: "Design review", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: null, visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: null, video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; ipcCommands.length = 0; remoteAudioAttachments.length = 0; remoteVideoAttachments.length = 0; remoteVideoDetachments.length = 0; remoteListeners.clear(); remoteVideoPublication = undefined; delete (window as any).__TAURI_INTERNALS__; });

test("a participant tile reacts to video subscription and unsubscription", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    if (command === "list_meeting_recordings" || command === "list_meeting_transcript_segments") return [];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  const tile = host.querySelector('article[aria-label="Them"]') as HTMLElement;
  expect(tile.querySelector("video")).toBeNull();
  expect(tile.querySelector(".call-avatar")).not.toBeNull();
  remoteVideoPublication = { videoTrack: { attach: element => remoteVideoAttachments.push(element), detach: element => remoteVideoDetachments.push(element) } };
  emitRemote("track-subscribed");
  await settle();
  const video = tile.querySelector("video") as HTMLVideoElement;
  expect(video).toBeInstanceOf(HTMLVideoElement);
  expect(remoteVideoAttachments).toEqual([video]);
  remoteVideoPublication = undefined;
  emitRemote("track-unsubscribed");
  await settle();
  expect(remoteVideoDetachments).toEqual([video]);
  expect(tile.querySelector("video")).toBeNull();
  expect(tile.querySelector(".call-avatar")).not.toBeNull();
});
test("joining exposes native media controls, device selectors, and a clean leave", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    ipcCommands.push(command);
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "start_meeting_recording") return { egress_id: "EG_1", status: "recording" };
    if (command === "stop_meeting_recording") return { egress_id: "EG_1", status: "stopped" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    if (command === "list_meeting_recordings") return [];
if (command === "list_meeting_transcript_segments") return [{ id: "segment-1", meeting_id: "meeting-1", speaker_id: "them", text: "Caption proof", started_at: 1, ended_at: 2, source: "external", created_at: 1 }];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(calls).toEqual(["microphone:true", "camera:true"]);
  expect(host.textContent).toContain("Connected · 2");
  expect(remoteAudioAttachments).toHaveLength(1);
  expect(remoteAudioAttachments[0]).toBeInstanceOf(HTMLAudioElement);
  expect(host.querySelectorAll("select")).toHaveLength(3);
  const chat = host.querySelector('input[aria-label="Chat message"]') as HTMLInputElement;
  chat.value = "Ship it"; chat.dispatchEvent(new Event("input", { bubbles: true }));
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Send") as HTMLButtonElement).click();
  await settle();
  expect(calls.some(call => call.includes('chat:') && call.includes("Ship it"))).toBe(true);
  expect(host.textContent).toContain("Ship it");
expect(host.textContent).toContain("Caption proof");
expect(ipcCommands).toContain("list_meeting_transcript_segments");
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Mute microphone") as HTMLButtonElement).click();
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Turn camera off") as HTMLButtonElement).click();
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Share screen") as HTMLButtonElement).click();
  await settle();
  expect(calls).toEqual(["microphone:true", "camera:true", expect.stringContaining("chat:"), "microphone:false", "camera:false", "screen:true"]);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Start recording") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("start_meeting_recording");
  expect(host.textContent).toContain("Recording recording");
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Stop recording") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("stop_meeting_recording");
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Leave call") as HTMLButtonElement).click();
  await settle();
  expect(calls).toContain("leave");
  expect(host.textContent).toContain("Join call");
});

test("a persisted running egress job is shown on join, so a restart cannot strand it", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    ipcCommands.push(command);
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    // The job was started by a previous process; only SQLite remembers it.
    if (command === "list_meeting_recordings") return [{ id: "rec-1", meeting_id: "meeting-1", egress_id: "EG_1", status: "recording", filepath: "recordings/meeting-meeting-1.mp4", started_by: "me", started_at: 1, stopped_at: null }];
    if (command === "stop_meeting_recording") return { id: "rec-1", meeting_id: "meeting-1", egress_id: "EG_1", status: "stopped", filepath: null, started_by: "me", started_at: 1, stopped_at: 2 };
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("list_meeting_recordings");
  expect(host.textContent).toContain("Recording recording");
  expect(host.textContent).toContain("Recording history");
  expect(host.textContent).toContain("recordings/meeting-meeting-1.mp4");
  // The organizer can stop the job they never started in this process.
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Stop recording") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("stop_meeting_recording");
  expect(host.textContent).not.toContain("Recording recording");
});

// The backend refuses recording when it cannot name the acting profile. Rather than
// offer a button that throws, the control is removed entirely (no error box either):
// a control that looks armed and does nothing is the interface lying about intent.
test("an unresolvable native actor removes the recording control instead of disabling it", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    ipcCommands.push(command);
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "recording_actor_status") return { available: false, profile_id: null, source: null, reason: "This installation has 2 profiles, so the app cannot tell who is acting" };
    if (command === "list_meeting_recordings") return [];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Start recording")).toBe(false);
  expect(host.textContent).not.toContain("cannot tell who is acting");
  expect(host.textContent).not.toContain("Recording is unavailable");
});

test("only the organizer can end the call, and a non-organizer sees leave alone", async () => {
  const invoke = async (command: string) => {
    ipcCommands.push(command);
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    if (command === "list_meeting_recordings") return [];
    if (command === "list_meeting_participants") return [{ meeting_id: "meeting-1", profile_id: "me", status: "accepted" }];
    if (command === "end_meeting_call") return true;
    throw new Error(`unexpected command: ${command}`);
  };
  (window as any).__TAURI_INTERNALS__ = { invoke };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  const end = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "End call") as HTMLButtonElement;
  expect(end).toBeDefined();
  end.click();
  await settle();
  expect(ipcCommands).toContain("end_meeting_call");
  expect(calls).toContain("leave");
  dispose?.(); dispose = undefined; host.remove();

  // A guest may leave their own client but never end the meeting for everyone.
  const guestHost = document.createElement("div"); document.body.append(guestHost);
  dispose = render(() => <CallPanel meeting={{ ...meeting, organizer_id: "host" }} identity="me" displayName="Me" />, guestHost);
  (guestHost.querySelector("button") as HTMLButtonElement).click();
  await settle();
  expect(Array.from(guestHost.querySelectorAll("button")).some(button => button.textContent === "End call")).toBe(false);
  expect(Array.from(guestHost.querySelectorAll("button")).some(button => button.textContent === "Leave call")).toBe(true);
});

test("a meeting that already has a bound room shows it before anyone joins", async () => {
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={{ ...meeting, video_provider: "livekit", video_room_id: "meeting-meeting-1", join_url: "ws://livekit.test", video_status: "ended", video_started_at: 1, video_ended_at: 2, video_ended_by: "me" }} identity="me" displayName="Me" />, host);
  await settle();
  expect(host.textContent).toContain("meeting-meeting-1");
  expect(host.textContent).toContain("ended");
  expect(host.textContent).toContain("Started");
  expect(host.textContent).toContain("Ended");
  expect(host.textContent).toContain("by me");
});

test("an invited attendee joins without an RSVP round trip", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    ipcCommands.push(command);
    if (command === "list_meeting_participants") return [{ meeting_id: "meeting-1", profile_id: "me", status: "invited" }];
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    if (command === "list_meeting_recordings" || command === "list_meeting_transcript_segments") return [];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={{ ...meeting, organizer_id: "host" }} identity="me" displayName="Me" />, host);
  (host.querySelector("button") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("list_meeting_participants");
  expect(ipcCommands).toContain("join_meeting_call");
  expect(host.textContent).toContain("Connected");
});
