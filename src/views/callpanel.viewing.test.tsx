// Viewing controls: Expand (in page) · Fullscreen (owns the screen) · Pop out (follows
// you out of the tab) · Hide self view. Each is drawn ONLY where the browser supports it:
// a control that cannot work must not be offered.
import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "solid-js/web";
import type { Meeting } from "../api/meetings";

const participant = (isLocal: boolean) => ({
  identity: isLocal ? "me" : "them", name: isLocal ? "Me" : "Them", isLocal, isSpeaking: false,
  getTrackPublication: () => undefined, on: () => undefined, off: () => undefined,
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
  remoteParticipants = new Map([["them", participant(false)]]);
  listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  async connect() { this.listeners.get("connection")?.forEach(listener => listener("connected")); }
  async disconnect() { /* noop */ }
  async switchActiveDevice() { return true; }
}
mock.module("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: { ConnectionStateChanged: "connection", Disconnected: "disconnected", ParticipantConnected: "participant-connected", ParticipantDisconnected: "participant-disconnected", TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", LocalTrackPublished: "track-published", LocalTrackUnpublished: "track-unpublished", DataReceived: "data-received" },
  ParticipantEvent: { TrackSubscribed: "track-subscribed", TrackUnsubscribed: "track-unsubscribed", TrackPublished: "track-published", TrackUnpublished: "track-unpublished", LocalTrackPublished: "local-track-published", LocalTrackUnpublished: "local-track-unpublished", TrackMuted: "track-muted", TrackUnmuted: "track-unmuted", IsSpeakingChanged: "speaking-changed" },
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen" } },
}));

const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const meeting: Meeting = { id: "meeting-1", title: "Pascal · Jannes", description: null, starts_at: 1, ends_at: 2, rrule: null, location: null, organizer_id: "me", channel_id: "chan-1", visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null, video_status: "live", video_started_at: 1, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null };
const invoke = async (command: string) => {
  if (command === "join_meeting_call") return { url: "ws://livekit.test", room: "meeting-meeting-1", token: "signed-token" };
  if (command === "recording_actor_status") return { available: false, profile_id: null, source: null, reason: "Call recording is not available in web mode." };
  if (command === "list_meeting_recordings" || command === "list_meeting_transcript_segments") return [];
  throw new Error(`unexpected command: ${command}`);
};
const button = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll("button")).find(item => item.textContent === label) as HTMLButtonElement | undefined;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  delete (window as any).__TAURI_INTERNALS__;
  delete (document as any).fullscreenEnabled; delete (document as any).fullscreenElement;
  delete (document as any).pictureInPictureEnabled; delete (document as any).pictureInPictureElement;
  delete (Element.prototype as any).requestFullscreen; delete (document as any).exitFullscreen;
});
const mount = async (options: { fullscreen?: boolean; pip?: boolean } = {}) => {
  (window as any).__TAURI_INTERNALS__ = { invoke };
  if (options.fullscreen) {
    (document as any).fullscreenEnabled = true;
    (document as any).fullscreenElement = null;
    (Element.prototype as any).requestFullscreen = function (this: Element) { (document as any).fullscreenElement = this; document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
    (document as any).exitFullscreen = () => { (document as any).fullscreenElement = null; document.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); };
  }
  if (options.pip) (document as any).pictureInPictureEnabled = true;
  const host = document.createElement("div"); document.body.append(host);
  dispose = render(() => <CallPanel meeting={meeting} identity="me" displayName="Me" autoJoin />, host);
  await settle();
  return host;
};
const { default: CallPanel } = await import("./CallPanel");

test("fullscreen puts the STAGE on the screen and reports its own state", async () => {
  const host = await mount({ fullscreen: true });
  const stage = host.querySelector("[data-call-stage]") as HTMLElement;
  expect(button(host, "Fullscreen")).toBeDefined();
  button(host, "Fullscreen")!.click();
  await settle();
  expect((document as any).fullscreenElement).toBe(stage);
  expect(stage.classList.contains("fullscreen")).toBe(true);
  const exit = button(host, "Exit fullscreen")!;
  expect(exit.getAttribute("aria-pressed")).toBe("true");
  exit.click();
  await settle();
  expect((document as any).fullscreenElement).toBeNull();
  expect(stage.classList.contains("fullscreen")).toBe(false);
});

test("a browser without the Fullscreen API is not offered the button at all", async () => {
  const host = await mount();
  expect(button(host, "Fullscreen")).toBeUndefined();
});

test("pop out asks the REMOTE video for picture-in-picture, and says so when there is none", async () => {
  const host = await mount({ pip: true });
  const popout = button(host, "Pop out");
  expect(popout).toBeDefined();
  popout!.click();
  await settle();
  // No remote video track is published in this fake room, so the panel must say that
  // rather than fail silently.
  expect(host.textContent).toContain("Nothing to pop out yet");
  let asked = 0;
  const video = document.createElement("video");
  (video as any).requestPictureInPicture = () => { asked += 1; return Promise.resolve({}); };
  host.querySelector(".call-tiles")!.append(video);
  button(host, "Pop out")!.click();
  await settle();
  expect(asked).toBe(1);
  expect(button(host, "Put back")).toBeDefined();
});

test("self view can be hidden and brought back from the ⋯ menu", async () => {
  const host = await mount();
  expect(host.querySelector(".call-pip")).not.toBeNull();
  button(host, "⋯")!.click();
  await settle();
  button(host, "Hide self view")!.click();
  await settle();
  expect(host.querySelector(".call-pip")).toBeNull();
  button(host, "Show self view")!.click();
  await settle();
  expect(host.querySelector(".call-pip")).not.toBeNull();
});

test("CSS: a fullscreen stage drops the fixed page height instead of staying a 360px box", () => {
  const css = readFileSync(new URL("./Meetings.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.call-stage\.fullscreen[^{]*\{[^}]*height:100%/);
});
