import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { meetingsApi, type CallJoin, type Meeting } from "../api/meetings";

type DeviceLists = { audioinput: MediaDeviceInfo[]; videoinput: MediaDeviceInfo[]; audiooutput: MediaDeviceInfo[] };
type DeviceKind = keyof DeviceLists;
const emptyDevices: DeviceLists = { audioinput: [], videoinput: [], audiooutput: [] };
const sourceFor = (participant: Participant) => participant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack
  ? Track.Source.ScreenShare
  : Track.Source.Camera;

function VideoTile(props: { participant: Participant }) {
  let video: HTMLVideoElement | undefined;
  let audio: HTMLAudioElement | undefined;
  const source = () => sourceFor(props.participant);
  const publication = () => props.participant.getTrackPublication(source());
  createEffect(() => {
    const track = publication()?.videoTrack;
    if (!track || !video) return;
    track.attach(video);
    onCleanup(() => track.detach(video));
  });
  createEffect(() => {
    const track = props.participant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (!track || !audio || props.participant.isLocal) return;
    track.attach(audio);
    onCleanup(() => track.detach(audio));
  });
  const name = () => props.participant.name || props.participant.identity;
  return <article class="call-tile" aria-label={`${name()}${props.participant.isLocal ? ", you" : ""}`}>
    <audio ref={audio} autoplay />
    <Show when={publication()?.videoTrack} fallback={<div class="call-avatar" aria-hidden="true">{name().slice(0, 1).toUpperCase()}</div>}>
      <video ref={video} autoplay muted={props.participant.isLocal} playsinline />
    </Show>
    <div class="call-tile-meta"><strong>{name()}</strong><small>{source() === Track.Source.ScreenShare ? "Screen sharing" : props.participant.isLocal ? "You" : "Connected"}</small></div>
  </article>;
}

function DevicePicker(props: { label: string; kind: DeviceKind; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (deviceId: string) => void }) {
  return <label class="call-device-picker"><span>{props.label}</span><select aria-label={`Select ${props.label.toLowerCase()}`} disabled={props.disabled || props.devices.length === 0} onChange={event => props.onChange(event.currentTarget.value)}>
    <option value="">{props.devices.length ? `Default ${props.label.toLowerCase()}` : "No devices found"}</option>
    <For each={props.devices}>{device => <option value={device.deviceId}>{device.label || `${props.label} ${device.deviceId.slice(0, 6)}`}</option>}</For>
  </select></label>;
}

export default function CallPanel(props: { meeting: Meeting; identity: string; displayName: string }) {
  const [room, setRoom] = createSignal<Room>();
  const [state, setState] = createSignal("disconnected");
  const [participants, setParticipants] = createSignal<Participant[]>([]);
  const [devices, setDevices] = createSignal<DeviceLists>(emptyDevices);
  const [notice, setNotice] = createSignal("");
  const [error, setError] = createSignal("");
  const [microphoneOn, setMicrophoneOn] = createSignal(false);
  const [cameraOn, setCameraOn] = createSignal(false);
  const [screenSharing, setScreenSharing] = createSignal(false);
  const [waitingForAdmission, setWaitingForAdmission] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [join, setJoin] = createSignal<CallJoin>();
  const connected = () => state() === "connected";
  const organizer = () => props.meeting.organizer_id === props.identity;
  const sync = () => {
    const current = room();
    if (current) setParticipants([current.localParticipant, ...current.remoteParticipants.values()]);
  };
  const loadDevices = async () => {
    try {
      const [audioinput, videoinput, audiooutput] = await Promise.all([
        Room.getLocalDevices("audioinput", true), Room.getLocalDevices("videoinput", true), Room.getLocalDevices("audiooutput"),
      ]);
      setDevices({ audioinput, videoinput, audiooutput });
    } catch (reason) { setNotice(`Connected; device list unavailable: ${String(reason)}`); }
  };
  const requestJoin = async () => {
    if (organizer()) return connect();
    try {
      setError("");
      const participant = (await meetingsApi.participants(props.meeting.id, props.identity)).find(item => item.profile_id === props.identity);
      if (participant?.status === "accepted") return connect();
      if (participant?.status === "invited") { setWaitingForAdmission(true); setNotice("You are in the lobby. The organizer must admit you before you can join."); return; }
      throw new Error("You need an invitation before entering this meeting lobby.");
    } catch (reason) { setError(`Could not request entry: ${String(reason)}`); }
  };
  createEffect(() => {
    if (!waitingForAdmission()) return;
    const timer = window.setInterval(() => { void requestJoin(); }, 3_000);
    onCleanup(() => window.clearInterval(timer));
  });
  const connect = async () => {
    if (state() === "connecting") return;
    let next: Room | undefined;
    try {
      setError(""); setNotice(""); setWaitingForAdmission(false); setState("connecting");
      const credentials = await meetingsApi.joinCall(props.meeting.id, props.identity, props.displayName);
      next = new Room(); setRoom(next); setJoin(credentials);
      next.on(RoomEvent.ConnectionStateChanged, value => { setState(value.toLowerCase()); sync(); });
      next.on(RoomEvent.ParticipantConnected, sync); next.on(RoomEvent.ParticipantDisconnected, sync);
      next.on(RoomEvent.TrackSubscribed, sync); next.on(RoomEvent.TrackUnsubscribed, sync);
      next.on(RoomEvent.LocalTrackPublished, sync); next.on(RoomEvent.LocalTrackUnpublished, sync);
      await next.connect(credentials.url, credentials.token);
      sync();
      await Promise.all([next.localParticipant.setMicrophoneEnabled(true), next.localParticipant.setCameraEnabled(true)]);
      setMicrophoneOn(true); setCameraOn(true); setNotice("Microphone and camera are on.");
      void loadDevices();
    } catch (reason) {
      await next?.disconnect();
      setRoom(undefined); setParticipants([]); setJoin(undefined); setState("disconnected");
      setError(`Could not join this call: ${String(reason)}`);
    }
  };
  const leave = async () => {
    const current = room();
    if (current) await current.disconnect();
    setRoom(undefined); setParticipants([]); setJoin(undefined); setState("disconnected");
    setMicrophoneOn(false); setCameraOn(false); setScreenSharing(false); setWaitingForAdmission(false); setRecording(false); setDevices(emptyDevices); setNotice("");
  };
  const toggleMicrophone = async () => {
    const current = room(); if (!current) return;
    const next = !microphoneOn(); await current.localParticipant.setMicrophoneEnabled(next); setMicrophoneOn(next); sync();
  };
  const toggleCamera = async () => {
    const current = room(); if (!current) return;
    const next = !cameraOn(); await current.localParticipant.setCameraEnabled(next); setCameraOn(next); sync();
  };
  const toggleScreenShare = async () => {
    const current = room(); if (!current) return;
    const next = !screenSharing(); await current.localParticipant.setScreenShareEnabled(next, { audio: true }); setScreenSharing(next); sync();
  };
  const toggleRecording = async () => {
    if (!organizer()) return;
    try {
      setError("");
      if (recording()) { await meetingsApi.stopRecording(props.meeting.id, props.identity); setRecording(false); setNotice("Recording stopped; the Egress worker is saving the file."); }
      else { await meetingsApi.startRecording(props.meeting.id, props.identity); setRecording(true); setNotice("Recording started by the LiveKit Egress worker."); }
    } catch (reason) { setError(`Could not change recording: ${String(reason)}`); }
  };
  const switchDevice = async (kind: DeviceKind, deviceId: string) => {
    const current = room(); if (!current || !deviceId) return;
    try { await current.switchActiveDevice(kind, deviceId, true); }
    catch (reason) { setError(`Could not change ${kind}: ${String(reason)}`); }
  };
  onCleanup(() => { void room()?.disconnect(); });
  return <section class="call-panel" aria-label="Live call">
    <header class="call-heading"><div><p class="call-eyebrow">LiveKit meeting</p><h3>{props.meeting.title}</h3><p class="call-state">State: <strong data-call-state>{state()}</strong>{join() && <> · {participants().length} participant{participants().length === 1 ? "" : "s"}</>}</p></div>
      <Show when={room()} fallback={<button class="primary" disabled={state() === "connecting" || waitingForAdmission()} onClick={() => void requestJoin()}>{state() === "connecting" ? "Joining…" : waitingForAdmission() ? "Waiting for admission…" : "Join call"}</button>}><button class="danger" onClick={() => void leave()}>Leave call</button></Show>
    </header>
    <Show when={error()}><p class="meeting-error" role="alert">{error()}</p></Show>
    <Show when={notice()}><p class="call-notice" role="status">{notice()}</p></Show>
    <Show when={waitingForAdmission()}><p class="call-lobby" role="status">Lobby request sent. The organizer can admit you from the meeting participants list.</p></Show>
    <Show when={recording()}><p class="call-recording" role="status">Recording in progress · captured by LiveKit Egress</p></Show>
    <Show when={join()}><p class="call-room">Room: {join()!.room}</p></Show>
    <div class="call-tiles" aria-live="polite"><For each={participants()}>{participant => <VideoTile participant={participant} />}</For><Show when={connected() && participants().length === 0}><p class="call-empty">You are connected. Waiting for participants…</p></Show></div>
    <Show when={room()}><footer class="call-controls"><div class="call-toggle-group"><button classList={{ active: microphoneOn() }} aria-pressed={microphoneOn()} onClick={() => void toggleMicrophone()}>{microphoneOn() ? "Mute microphone" : "Unmute microphone"}</button><button classList={{ active: cameraOn() }} aria-pressed={cameraOn()} onClick={() => void toggleCamera()}>{cameraOn() ? "Turn camera off" : "Turn camera on"}</button><button classList={{ active: screenSharing() }} aria-pressed={screenSharing()} onClick={() => void toggleScreenShare()}>{screenSharing() ? "Stop sharing" : "Share screen"}</button><Show when={organizer()}><button classList={{ active: recording(), recording: true }} aria-pressed={recording()} onClick={() => void toggleRecording()}>{recording() ? "Stop recording" : "Start recording"}</button></Show></div>
      <div class="call-devices"><DevicePicker label="Microphone" kind="audioinput" devices={devices().audioinput} disabled={!connected()} onChange={id => void switchDevice("audioinput", id)} /><DevicePicker label="Camera" kind="videoinput" devices={devices().videoinput} disabled={!connected()} onChange={id => void switchDevice("videoinput", id)} /><DevicePicker label="Speaker" kind="audiooutput" devices={devices().audiooutput} disabled={!connected()} onChange={id => void switchDevice("audiooutput", id)} /></div>
    </footer></Show>
  </section>;
}
