import { UI_LOCALE } from "../calendar";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { ParticipantEvent, Room, RoomEvent, Track, type Participant } from "livekit-client";
import { meetingsApi, type CallJoin, type CallRecording, type CallTranscriptSegment, type Meeting } from "../api/meetings";
import { newId } from "../api/ids";

type DeviceLists = { audioinput: MediaDeviceInfo[]; videoinput: MediaDeviceInfo[]; audiooutput: MediaDeviceInfo[] };
type DeviceKind = keyof DeviceLists;
type ChatMessage = { id: string; author: string; text: string };
const chatEncoder = new TextEncoder();
const chatDecoder = new TextDecoder();
const emptyDevices: DeviceLists = { audioinput: [], videoinput: [], audiooutput: [] };
const sourceFor = (participant: Participant) => participant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack
  ? Track.Source.ScreenShare
  : Track.Source.Camera;

function VideoTile(props: { participant: Participant }) {
  const [version, setVersion] = createSignal(0);
  const [video, setVideo] = createSignal<HTMLVideoElement>();
  let audio: HTMLAudioElement | undefined;
  const source = () => sourceFor(props.participant);
  const publication = () => { version(); return props.participant.getTrackPublication(source()); };
  const refresh = () => setVersion(current => current + 1);
  props.participant.on(ParticipantEvent.TrackSubscribed, refresh);
  props.participant.on(ParticipantEvent.TrackUnsubscribed, refresh);
  props.participant.on(ParticipantEvent.TrackPublished, refresh);
  props.participant.on(ParticipantEvent.TrackUnpublished, refresh);
  props.participant.on(ParticipantEvent.LocalTrackPublished, refresh);
  props.participant.on(ParticipantEvent.LocalTrackUnpublished, refresh);
  props.participant.on(ParticipantEvent.TrackMuted, refresh);
  props.participant.on(ParticipantEvent.TrackUnmuted, refresh);
  onCleanup(() => {
    props.participant.off(ParticipantEvent.TrackSubscribed, refresh);
    props.participant.off(ParticipantEvent.TrackUnsubscribed, refresh);
    props.participant.off(ParticipantEvent.TrackPublished, refresh);
    props.participant.off(ParticipantEvent.TrackUnpublished, refresh);
    props.participant.off(ParticipantEvent.LocalTrackPublished, refresh);
    props.participant.off(ParticipantEvent.LocalTrackUnpublished, refresh);
    props.participant.off(ParticipantEvent.TrackMuted, refresh);
    props.participant.off(ParticipantEvent.TrackUnmuted, refresh);
  });
  createEffect(() => {
    version();
    const track = publication()?.videoTrack;
    const element = video();
    if (!track || !element) return;
    track.attach(element);
    onCleanup(() => track.detach(element));
  });
  createEffect(() => {
    version();
    const track = props.participant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (!track || !audio || props.participant.isLocal) return;
    track.attach(audio);
    onCleanup(() => track.detach(audio));
  });
  const name = () => props.participant.name || props.participant.identity;
  return <article class="call-tile" aria-label={`${name()}${props.participant.isLocal ? ", you" : ""}`}>
    <audio ref={audio} autoplay />
    <Show when={publication()?.videoTrack} fallback={<div class="call-avatar" aria-hidden="true">{name().slice(0, 1).toUpperCase()}</div>}>
      <video ref={setVideo} autoplay muted={props.participant.isLocal} playsinline />
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
  const [recordings, setRecordings] = createSignal<CallRecording[]>([]);
  const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = createSignal("");
const [transcriptSegments, setTranscriptSegments] = createSignal<CallTranscriptSegment[]>([]);
  // Native answer to "can this machine name who is acting?". Undefined until asked.
  const [actorRefusal, setActorRefusal] = createSignal<string>();
  const [join, setJoin] = createSignal<CallJoin>();
  const connected = () => state() === "connected";
  const organizer = () => props.meeting.organizer_id === props.identity;
  const activeRecording = () => recordings().find(item => ["starting", "recording", "stopping"].includes(item.status));
  const recordingInProgress = () => activeRecording()?.status === "recording";
  const timeLabel = (seconds: number | null) => seconds === null ? "—" : new Date(seconds * 1_000).toLocaleString(UI_LOCALE);
  const lifecycleFact = () => {
    const started = props.meeting.video_started_at === null ? "" : `Started ${timeLabel(props.meeting.video_started_at)}`;
    const ended = props.meeting.video_ended_at === null ? "" : `Ended ${timeLabel(props.meeting.video_ended_at)}${props.meeting.video_ended_by ? ` by ${props.meeting.video_ended_by}` : ""}`;
    return [started, ended].filter(Boolean).join(" · ");
  };
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
      const credentials = await meetingsApi.joinCall(props.meeting.id);
      next = new Room(); setRoom(next); setJoin(credentials);
      next.on(RoomEvent.ConnectionStateChanged, value => { setState(value.toLowerCase()); sync(); });
      next.on(RoomEvent.ParticipantConnected, sync); next.on(RoomEvent.ParticipantDisconnected, sync);
      next.on(RoomEvent.TrackSubscribed, sync); next.on(RoomEvent.TrackUnsubscribed, sync);
      next.on(RoomEvent.LocalTrackPublished, sync); next.on(RoomEvent.LocalTrackUnpublished, sync);
      next.on(RoomEvent.DataReceived, (payload, _participant) => {
        try {
          const message = JSON.parse(chatDecoder.decode(payload)) as ChatMessage;
          if (typeof message.id !== "string" || typeof message.author !== "string" || typeof message.text !== "string") return;
          setChatMessages(items => items.some(item => item.id === message.id) ? items : [...items, message]);
        } catch { /* Ignore non-chat data packets from other LiveKit features. */ }
      });
      await next.connect(credentials.url, credentials.token);
      sync();
      await Promise.all([next.localParticipant.setMicrophoneEnabled(true), next.localParticipant.setCameraEnabled(true)]);
      setMicrophoneOn(true); setCameraOn(true); setNotice("Microphone and camera are on.");
      void loadDevices();
      // Recording state is server truth, not per-window memory: a participant who
      // joins late (or after an app restart) must still see that this call is being
      // recorded, and the organizer must be able to stop that job.
      void syncRecording();
void syncTranscript();
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
    setMicrophoneOn(false); setCameraOn(false); setScreenSharing(false); setWaitingForAdmission(false); setRecordings([]); setChatMessages([]); setChatDraft(""); setTranscriptSegments([]); setDevices(emptyDevices); setNotice("");
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
  const syncRecording = async () => {
    // Ask the native side who it thinks is acting before drawing a control that
    // depends on the answer; an unresolvable actor is refused server-side, so the
    // button must say that rather than look armed.
    try { const status = await meetingsApi.recordingActor(); setActorRefusal(status.available ? undefined : (status.reason ?? "This installation cannot determine who is acting.")); }
    catch (reason) { setActorRefusal(`Recording identity unavailable: ${String(reason)}`); }
    try { setRecordings(await meetingsApi.recordings(props.meeting.id)); }
    catch (reason) { setNotice(`Connected; recording state unavailable: ${String(reason)}`); }
  };
  const syncTranscript = async () => {
try { setTranscriptSegments(await meetingsApi.transcriptSegments(props.meeting.id)); }
catch (reason) { setNotice(`Connected; captions unavailable: ${String(reason)}`); }
};
const toggleRecording = async () => {
    if (!organizer() || actorRefusal()) return;
    try {
      setError("");
      const active = activeRecording();
      if (active?.status === "recording") {
        const updated = await meetingsApi.stopRecording(props.meeting.id);
        setRecordings(items => items.map(item => item.id === updated.id ? updated : item));
        setNotice("Recording stop requested; the Egress worker is saving the file.");
      } else if (!active) {
        const updated = await meetingsApi.startRecording(props.meeting.id);
        setRecordings(items => [updated, ...items.filter(item => item.id !== updated.id)]);
        setNotice("Recording started by the LiveKit Egress worker.");
      }
    } catch (reason) { setError(`Could not change recording: ${String(reason)}`); }
  };
  // Leaving is this client's act; ending is the organizer's decision about the call
  // itself, so it is a separate control and a separate server-side transition.
  const endCall = async () => {
    if (!organizer()) return;
    try { setError(""); await meetingsApi.endCall(props.meeting.id); await leave(); setNotice("Call ended for everyone."); }
    catch (reason) { setError(`Could not end this call: ${String(reason)}`); }
  };
  const switchDevice = async (kind: DeviceKind, deviceId: string) => {
    const current = room(); if (!current || !deviceId) return;
    try { await current.switchActiveDevice(kind, deviceId, true); }
    catch (reason) { setError(`Could not change ${kind}: ${String(reason)}`); }
  };
  const sendChat = async () => {
    const current = room(); const text = chatDraft().trim();
    if (!current || !text) return;
    const message: ChatMessage = { id: newId(), author: props.displayName || props.identity, text };
    try {
      await current.localParticipant.publishData(chatEncoder.encode(JSON.stringify(message)), { reliable: true });
      setChatMessages(items => [...items, message]); setChatDraft("");
    } catch (reason) { setError(`Could not send chat message: ${String(reason)}`); }
  };
  onCleanup(() => { void room()?.disconnect(); });
  return <section class="call-panel" aria-label="Live call">
    <header class="call-heading"><div><p class="call-eyebrow">LiveKit meeting</p><h3>{props.meeting.title}</h3><p class="call-state">State: <strong data-call-state>{state()}</strong>{join() && <> · {participants().length} participant{participants().length === 1 ? "" : "s"}</>}</p></div>
      <Show when={room()} fallback={<button class="primary" disabled={state() === "connecting" || waitingForAdmission()} onClick={() => void requestJoin()}>{state() === "connecting" ? "Joining…" : waitingForAdmission() ? "Waiting for admission…" : "Join call"}</button>}><span class="call-leave-group"><button class="danger" onClick={() => void leave()}>Leave call</button><Show when={organizer()}><button class="danger" onClick={() => void endCall()}>End call</button></Show></span></Show>
    </header>
    <Show when={error()}><p class="meeting-error" role="alert">{error()}</p></Show>
    <Show when={notice()}><p class="call-notice" role="status">{notice()}</p></Show>
    <Show when={waitingForAdmission()}><p class="call-lobby" role="status">Lobby request sent. The organizer can admit you from the meeting participants list.</p></Show>
    <Show when={activeRecording()}>{active => <p class="call-recording" role="status">Recording {active().status} · captured by LiveKit Egress</p>}</Show>
    <Show when={organizer() && actorRefusal()}><p class="call-notice" role="status">Recording is unavailable: {actorRefusal()}</p></Show>
    <Show when={join()} fallback={<Show when={props.meeting.video_room_id}>{room => <p class="call-room">Room: {room()} · {props.meeting.video_status}</p>}</Show>}><p class="call-room">Room: {join()!.room}</p></Show>
    <Show when={lifecycleFact()}>{fact => <p class="call-room">{fact()}</p>}</Show>
    <div class="call-tiles" aria-live="polite"><For each={participants()}>{participant => <VideoTile participant={participant} />}</For><Show when={connected() && participants().length === 0}><p class="call-empty">You are connected. Waiting for participants…</p></Show></div>
    <Show when={room()}><section class="call-chat" aria-label="In-call chat"><div class="call-chat-heading"><strong>Chat</strong><span>{chatMessages().length} message{chatMessages().length === 1 ? "" : "s"}</span></div><div class="call-chat-messages" aria-live="polite"><Show when={chatMessages().length === 0}><p>Messages sent here are delivered to people currently in this call.</p></Show><For each={chatMessages()}>{message => <p><strong>{message.author}</strong><span>{message.text}</span></p>}</For></div><form class="call-chat-compose" onSubmit={event => { event.preventDefault(); void sendChat(); }}><input aria-label="Chat message" value={chatDraft()} onInput={event => setChatDraft(event.currentTarget.value)} maxlength={2_000} placeholder="Message everyone in this call" /><button disabled={!chatDraft().trim()}>Send</button></form></section><section class="call-transcript" aria-label="Live captions"><div class="call-chat-heading"><strong>Live captions</strong><span>{transcriptSegments().length} segment{transcriptSegments().length === 1 ? "" : "s"}</span></div><div class="call-chat-messages" aria-live="polite"><Show when={transcriptSegments().length === 0}><p>Captions appear here when a transcriber submits transcript segments.</p></Show><For each={transcriptSegments()}>{segment => <p><strong>{segment.speaker_id ?? "Unknown speaker"}</strong><span>{segment.text}</span></p>}</For></div></section><Show when={recordings().length}><section class="call-transcript" aria-label="Recording history"><div class="call-chat-heading"><strong>Recording history</strong><span>{recordings().length} job{recordings().length === 1 ? "" : "s"}</span></div><div class="call-chat-messages"><For each={recordings()}>{item => <p><strong>{item.status}</strong><span>{item.filepath ?? "No file path"} · started {timeLabel(item.started_at)}{item.stopped_at === null ? "" : ` · stopped ${timeLabel(item.stopped_at)}`}{item.last_error ? ` · ${item.last_error}` : ""}</span></p>}</For></div></section></Show><footer class="call-controls"><div class="call-toggle-group"><button classList={{ active: microphoneOn() }} aria-pressed={microphoneOn()} onClick={() => void toggleMicrophone()}>{microphoneOn() ? "Mute microphone" : "Unmute microphone"}</button><button classList={{ active: cameraOn() }} aria-pressed={cameraOn()} onClick={() => void toggleCamera()}>{cameraOn() ? "Turn camera off" : "Turn camera on"}</button><button classList={{ active: screenSharing() }} aria-pressed={screenSharing()} onClick={() => void toggleScreenShare()}>{screenSharing() ? "Stop sharing" : "Share screen"}</button><Show when={organizer()}><button classList={{ active: recordingInProgress(), recording: true }} aria-pressed={recordingInProgress()} disabled={!!actorRefusal() || (!!activeRecording() && !recordingInProgress())} title={actorRefusal()} onClick={() => void toggleRecording()}>{recordingInProgress() ? "Stop recording" : activeRecording() ? `Recording ${activeRecording()!.status}…` : "Start recording"}</button></Show></div>
      <div class="call-devices"><DevicePicker label="Microphone" kind="audioinput" devices={devices().audioinput} disabled={!connected()} onChange={id => void switchDevice("audioinput", id)} /><DevicePicker label="Camera" kind="videoinput" devices={devices().videoinput} disabled={!connected()} onChange={id => void switchDevice("videoinput", id)} /><DevicePicker label="Speaker" kind="audiooutput" devices={devices().audiooutput} disabled={!connected()} onChange={id => void switchDevice("audiooutput", id)} /></div>
    </footer></Show>
  </section>;
}
