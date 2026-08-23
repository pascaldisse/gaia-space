import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const calls: string[] = [];
const ipcCommands: string[] = [];
const remoteAudioAttachments: HTMLMediaElement[] = [];
const devices = [{ deviceId: "mic-1", label: "Studio microphone" }];
const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal,
  getTrackPublication: () => undefined,
});
const remoteParticipant = {
  ...participant(false),
  getTrackPublication: (source: string) => source === "microphone" ? { audioTrack: { attach: (element: HTMLMediaElement) => remoteAudioAttachments.push(element), detach: () => undefined } } : undefined,
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
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
}));
const { default: CallPanel } = await import("./CallPanel");

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meeting: Meeting = { id: "meeting-1", title: "Design review", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: null, archived: false };
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; ipcCommands.length = 0; remoteAudioAttachments.length = 0; delete (window as any).__TAURI_INTERNALS__; });

test("joining exposes native media controls, device selectors, and a clean leave", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    ipcCommands.push(command);
    if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
    if (command === "start_meeting_recording") return { egress_id: "EG_1", status: "recording" };
    if (command === "stop_meeting_recording") return { egress_id: "EG_1", status: "stopped" };
    if (command === "recording_actor_status") return { available: true, profile_id: "me", source: "sole_profile", reason: null };
    if (command === "list_meeting_recordings") return [];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(calls).toEqual(["microphone:true", "camera:true"]);
  expect(host.textContent).toContain("2 participants");
  expect(remoteAudioAttachments).toHaveLength(1);
  expect(remoteAudioAttachments[0]).toBeInstanceOf(HTMLAudioElement);
  expect(host.querySelectorAll("select")).toHaveLength(3);
  const chat = host.querySelector('input[aria-label="Chat message"]') as HTMLInputElement;
  chat.value = "Ship it"; chat.dispatchEvent(new Event("input", { bubbles: true }));
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Send") as HTMLButtonElement).click();
  await settle();
  expect(calls.some(call => call.includes('chat:') && call.includes("Ship it"))).toBe(true);
  expect(host.textContent).toContain("Ship it");
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Mute microphone") as HTMLButtonElement).click();
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Turn camera off") as HTMLButtonElement).click();
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Share screen") as HTMLButtonElement).click();
  await settle();
  expect(calls).toEqual(["microphone:true", "camera:true", expect.stringContaining("chat:"), "microphone:false", "camera:false", "screen:true"]);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Start recording") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("start_meeting_recording");
  expect(host.textContent).toContain("Recording in progress");
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
  expect(host.textContent).toContain("Recording in progress");
  // The organizer can stop the job they never started in this process.
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Stop recording") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toContain("stop_meeting_recording");
  expect(host.textContent).not.toContain("Recording in progress");
});

// The backend refuses recording when it cannot name the acting profile. The UI must
// say so rather than offer a button that throws: a control that looks armed and does
// nothing is the interface lying about what the system will do.
test("an unresolvable native actor disables recording and explains why", async () => {
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
  const record = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Start recording") as HTMLButtonElement;
  expect(record.disabled).toBe(true);
  expect(host.textContent).toContain("cannot tell who is acting");
  record.click();
  await settle();
  expect(ipcCommands).not.toContain("start_meeting_recording");
});

test("an invited attendee waits in the lobby until the organizer accepts the RSVP", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    ipcCommands.push(command);
    if (command === "list_meeting_participants") return [{ meeting_id: "meeting-1", profile_id: "me", status: "invited" }];
    throw new Error(`unexpected command: ${command}`);
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={{ ...meeting, organizer_id: "host" }} identity="me" displayName="Me" />, host);
  (host.querySelector("button") as HTMLButtonElement).click();
  await settle();
  expect(ipcCommands).toEqual(["list_meeting_participants"]);
  expect(host.textContent).toContain("Lobby request sent");
  expect(host.textContent).toContain("Waiting for admission…");
});
