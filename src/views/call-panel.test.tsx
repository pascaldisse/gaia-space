import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const calls: string[] = [];
const devices = [{ deviceId: "mic-1", label: "Studio microphone" }];
const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal,
  getTrackPublication: () => undefined,
});
class FakeRoom {
  static getLocalDevices = async () => devices as MediaDeviceInfo[];
  localParticipant = {
    ...participant(true),
    setMicrophoneEnabled: async (enabled: boolean) => { calls.push(`microphone:${enabled}`); },
    setCameraEnabled: async (enabled: boolean) => { calls.push(`camera:${enabled}`); },
    setScreenShareEnabled: async (enabled: boolean) => { calls.push(`screen:${enabled}`); },
  };
  remoteParticipants = new Map();
  listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  async connect() { this.listeners.get("connection")?.forEach(listener => listener("connected")); }
  async disconnect() { calls.push("leave"); }
  async switchActiveDevice(kind: string, deviceId: string) { calls.push(`device:${kind}:${deviceId}`); return true; }
}
mock.module("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: { ConnectionStateChanged: "connection", ParticipantConnected: "participant-connected", ParticipantDisconnected: "participant-disconnected", TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", LocalTrackPublished: "track-published", LocalTrackUnpublished: "track-unpublished" },
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
}));
const { default: CallPanel } = await import("./CallPanel");

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meeting: Meeting = { id: "meeting-1", title: "Design review", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: null, archived: false };
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; delete (window as any).__TAURI_INTERNALS__; });

test("joining exposes native media controls, device selectors, and a clean leave", async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
    expect(command).toBe("join_meeting_call");
    return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
  } };
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" />, host);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Join call") as HTMLButtonElement).click();
  await settle();
  expect(calls).toEqual(["microphone:true", "camera:true"]);
  expect(host.textContent).toContain("1 participant");
  expect(host.querySelectorAll("select")).toHaveLength(3);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Mute microphone") as HTMLButtonElement).click();
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Turn camera off") as HTMLButtonElement).click();
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Share screen") as HTMLButtonElement).click();
  await settle();
  expect(calls).toEqual(["microphone:true", "camera:true", "microphone:false", "camera:false", "screen:true"]);
  (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Leave call") as HTMLButtonElement).click();
  await settle();
  expect(calls).toContain("leave");
  expect(host.textContent).toContain("Join call");
});
