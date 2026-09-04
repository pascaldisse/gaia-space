import { UI_LOCALE } from "../calendar";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
  props.participant.on(ParticipantEvent.IsSpeakingChanged, refresh);
  onCleanup(() => {
    props.participant.off(ParticipantEvent.TrackSubscribed, refresh);
    props.participant.off(ParticipantEvent.TrackUnsubscribed, refresh);
    props.participant.off(ParticipantEvent.TrackPublished, refresh);
    props.participant.off(ParticipantEvent.TrackUnpublished, refresh);
    props.participant.off(ParticipantEvent.LocalTrackPublished, refresh);
    props.participant.off(ParticipantEvent.LocalTrackUnpublished, refresh);
    props.participant.off(ParticipantEvent.TrackMuted, refresh);
    props.participant.off(ParticipantEvent.TrackUnmuted, refresh);
    props.participant.off(ParticipantEvent.IsSpeakingChanged, refresh);
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
  return <article class="call-tile" classList={{ speaking: !!props.participant.isSpeaking }} aria-label={`${name()}${props.participant.isLocal ? ", you" : ""}`}>
    <audio ref={audio} autoplay />
    <Show when={publication()?.videoTrack} fallback={<div class="call-avatar" aria-hidden="true">{name().slice(0, 1).toUpperCase()}</div>}>
      <video ref={setVideo} autoplay muted={props.participant.isLocal} playsinline data-source={source() === Track.Source.ScreenShare ? "screen" : "camera"} />
    </Show>
    <div class="call-tile-meta"><strong>{name()}</strong><small>{source() === Track.Source.ScreenShare ? "Screen sharing" : props.participant.isLocal ? "You" : "Connected"}</small></div>
  </article>;
}
function AudioParticipant(props: { participant: Participant }) {
  const name = () => props.participant.name || props.participant.identity;
  return <article class="call-audio-participant" aria-label={`${name()}${props.participant.isLocal ? ", you" : ""}`}><span class="call-avatar" aria-hidden="true">{name().slice(0, 1).toUpperCase()}</span><span><strong>{name()}</strong><small>{props.participant.isSpeaking ? "Speaking" : props.participant.isLocal ? "You" : "Listening"}</small></span></article>;
}
function DevicePicker(props: { label: string; kind: DeviceKind; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (deviceId: string) => void }) {
  return <label class="call-device-picker"><span>{props.label}</span><select aria-label={`Select ${props.label.toLowerCase()}`} disabled={props.disabled || props.devices.length === 0} onChange={event => props.onChange(event.currentTarget.value)}>
    <option value="">{props.devices.length ? `Default ${props.label.toLowerCase()}` : "No devices found"}</option>
    <For each={props.devices}>{device => <option value={device.deviceId}>{device.label || `${props.label} ${device.deviceId.slice(0, 6)}`}</option>}</For>
  </select></label>;
}

export default function CallPanel(props: { meeting: Meeting; identity: string; displayName: string; audioOnly?: boolean; autoJoin?: boolean }) {
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
  const [actorChecked, setActorChecked] = createSignal(false);
  const [join, setJoin] = createSignal<CallJoin>();
  const [theatre, setTheatre] = createSignal(false);
  const connected = () => state() === "connected";
  // The stage grid holds everyone but the local participant; self is the small PiP.
  // Memoized so a burst of participants() writes (several toggles in one tick) settles
  // to one stable snapshot before the stage and PiP <Show> boundaries read it.
  const remoteParticipants = createMemo(() => participants().filter(item => !item.isLocal));
  const selfParticipant = createMemo(() => participants().find(item => item.isLocal));
  // 1 -> full, 2 -> side-by-side, 3-4 -> 2x2, >4 -> auto-fit minmax (Meet-style tiling).
  const gridClass = createMemo(() => {
    const count = remoteParticipants().length;
    if (count <= 1) return "call-grid-1";
    if (count === 2) return "call-grid-2";
    if (count <= 4) return "call-grid-2x2";
    return "call-grid-auto";
  });
  const organizer = () => props.meeting.organizer_id === props.identity;
  const activeRecording = () => recordings().find(item => ["starting", "recording", "stopping"].includes(item.status));
  const recordingInProgress = () => activeRecording()?.status === "recording";
  // Recording is only ever offered once the native side has confirmed it can name
  // an acting profile; a refusal removes the control instead of disabling it inline.
  const recordingAvailable = () => organizer() && actorChecked() && !actorRefusal();
  const timeLabel = (seconds: number | null) => seconds === null ? "—" : new Date(seconds * 1_000).toLocaleString(UI_LOCALE);
  const lifecycleFact = () => {
    const started = props.meeting.video_started_at === null ? "" : `Started ${timeLabel(props.meeting.video_started_at)}`;
    const ended = props.meeting.video_ended_at === null ? "" : `Ended ${timeLabel(props.meeting.video_ended_at)}${props.meeting.video_ended_by ? ` by ${props.meeting.video_ended_by}` : ""}`;
    return [started, ended].filter(Boolean).join(" · ");
  };
  // Top-left state chip: Meet-style short words, not a sentence.
  const stateLabel = () => {
    const value = state();
    if (value === "connecting") return "Connecting…";
    if (value === "reconnecting") return "Reconnecting";
    if (value === "connected") return `Connected${join() ? ` · ${participants().length}` : ""}`;
    return value.charAt(0).toUpperCase() + value.slice(1);
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
      if (participant?.status === "accepted" || participant?.status === "invited") return connect();
      throw new Error("You need an invitation before entering this meeting call.");
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
      await Promise.all([next.localParticipant.setMicrophoneEnabled(true), next.localParticipant.setCameraEnabled(!props.audioOnly)]);
      setMicrophoneOn(true); setCameraOn(!props.audioOnly); setNotice(props.audioOnly ? "Microphone is on." : "Microphone and camera are on.");
      void loadDevices();
      // Recording state is server truth, not per-window memory: a participant who
      // joins late (or after an app restart) must still see that this call is being
      // recorded, and the organizer must be able to stop that job. Both are guarded
      // against a leave() that lands while they are still in flight (see isCurrent).
      const joinedRoom = next;
      void syncRecording(joinedRoom);
      void syncTranscript(joinedRoom);
    } catch (reason) {
      await next?.disconnect();
      setRoom(undefined); setParticipants([]); setJoin(undefined); setState("disconnected");
      setError(`Could not join this call: ${String(reason)}`);
    }
  };
  let autoJoinRequested = false;
  createEffect(() => {
    if (props.autoJoin && !autoJoinRequested) { autoJoinRequested = true; void connect(); }
  });
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
  // A call this async has already finished by the time it resolves if the user
  // left in the meantime: `room()` will have moved on to a different Room instance
  // (or none). Writing state for a call that is no longer current would resurrect
  // signals a disposed part of the tree still depends on, so every write here is
  // gated on the joined Room still being the live one.
  const syncRecording = async (joinedRoom: Room) => {
    try { const status = await meetingsApi.recordingActor(); if (room() !== joinedRoom) return; setActorRefusal(status.available ? undefined : (status.reason ?? "This installation cannot determine who is acting.")); }
    catch (reason) { if (room() === joinedRoom) setActorRefusal(`Recording identity unavailable: ${String(reason)}`); }
    finally { if (room() === joinedRoom) setActorChecked(true); }
    try { const list = await meetingsApi.recordings(props.meeting.id); if (room() === joinedRoom) setRecordings(list); }
    catch (reason) { console.debug("call recording state unavailable", reason); }
  };
  const syncTranscript = async (joinedRoom: Room) => {
    try { const segments = await meetingsApi.transcriptSegments(props.meeting.id); if (room() === joinedRoom) setTranscriptSegments(segments); }
    catch (reason) { if (room() === joinedRoom) setNotice(`Connected; captions unavailable: ${String(reason)}`); }
  };
  const toggleRecording = async () => {
    if (!recordingAvailable()) return;
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
  const copyRoomId = async () => {
    const id = join()?.room ?? props.meeting.video_room_id;
    if (!id) return;
    try { await navigator.clipboard.writeText(id); setNotice("Room id copied."); setMenuOpen(false); }
    catch (reason) { setError(`Could not copy room id: ${String(reason)}`); }
  };
  // Drawer holds chat OR captions, never both: one collapsible side panel inside the
  // stage, toggled by its own control-bar button, default closed. The ⋯ menu is the
  // same idea for the device pickers + room id, which are settings, not stage content.
  const [drawerTab, setDrawerTab] = createSignal<"chat" | "captions">();
  const toggleDrawer = (tab: "chat" | "captions") => setDrawerTab(current => current === tab ? undefined : tab);
  const [menuOpen, setMenuOpen] = createSignal(false);
  onCleanup(() => { void room()?.disconnect(); });
  return <section class="call-panel" aria-label="Live call">
    <header class="call-topbar">
      <p class="call-state-chip" data-call-state={state()}><Show when={join()}><strong>{stateLabel()}</strong></Show><Show when={!join()}>{props.meeting.title}</Show></p>
      <Show when={room()} fallback={<button class="primary" disabled={state() === "connecting" || waitingForAdmission()} onClick={() => void requestJoin()}>{state() === "connecting" ? "Joining…" : waitingForAdmission() ? "Waiting for admission…" : "Join call"}</button>}>
        <button type="button" class="ghost small call-theatre-toggle" aria-pressed={theatre()} onClick={() => setTheatre(value => !value)}>{theatre() ? "Collapse" : "Expand"}</button>
      </Show>
    </header>
    <Show when={error()}><p class="meeting-error" role="alert">{error()}</p></Show>
    <Show when={notice()}><p class="call-notice" role="status">{notice()}</p></Show>
    <Show when={waitingForAdmission()}><p class="call-lobby" role="status">Lobby request sent. The organizer can admit you from the meeting participants list.</p></Show>
    <Show when={activeRecording()}>{active => <p class="call-recording" role="status">Recording {active().status} · captured by LiveKit Egress</p>}</Show>
    <Show when={!join()}><Show when={props.meeting.video_room_id}>{room => <p class="call-room">Room: {room()} · {props.meeting.video_status}</p>}</Show></Show>
    <Show when={lifecycleFact()}>{fact => <p class="call-room">{fact()}</p>}</Show>
    <div class="call-stage" classList={{ theatre: theatre() }} data-call-stage aria-live="polite">
      <div class={`call-tiles ${gridClass()}${props.audioOnly ? " audio-only" : ""}`}>
        <For each={remoteParticipants()}>{participant => props.audioOnly ? <AudioParticipant participant={participant} /> : <VideoTile participant={participant} />}</For>
      </div>
      <Show when={connected() && remoteParticipants().length === 0}><p class="call-waiting">Waiting for others…</p></Show>
      <Show when={selfParticipant()} keyed>{self => <div class="call-pip" aria-label="Your preview">{props.audioOnly ? <AudioParticipant participant={self} /> : <VideoTile participant={self} />}</div>}</Show>
      <Show when={room()}>
        <Show when={drawerTab()} keyed>{tab => <aside class="call-drawer" aria-label={tab === "chat" ? "In-call chat" : "Live captions"}>
          <div class="call-drawer-head">
            <div class="call-drawer-tabs">
              <button type="button" classList={{ active: tab === "chat" }} onClick={() => setDrawerTab("chat")}>Chat<Show when={chatMessages().length}> ({chatMessages().length})</Show></button>
              <button type="button" classList={{ active: tab === "captions" }} onClick={() => setDrawerTab("captions")}>Captions<Show when={transcriptSegments().length}> ({transcriptSegments().length})</Show></button>
            </div>
            <button type="button" class="ghost small" aria-label="Close drawer" onClick={() => setDrawerTab(undefined)}>×</button>
          </div>
          <Show when={tab === "chat"}>
            <div class="call-chat-messages" aria-live="polite"><Show when={chatMessages().length === 0}><p>Messages sent here are delivered to people currently in this call.</p></Show><For each={chatMessages()}>{message => <p><strong>{message.author}</strong><span>{message.text}</span></p>}</For></div>
            <form class="call-chat-compose" onSubmit={event => { event.preventDefault(); void sendChat(); }}><input aria-label="Chat message" value={chatDraft()} onInput={event => setChatDraft(event.currentTarget.value)} maxlength={2_000} placeholder="Message everyone in this call" /><button disabled={!chatDraft().trim()}>Send</button></form>
          </Show>
          <Show when={tab === "captions"}>
            <div class="call-chat-messages" aria-live="polite"><Show when={transcriptSegments().length === 0}><p>Captions appear here when a transcriber submits transcript segments.</p></Show><For each={transcriptSegments()}>{segment => <p><strong>{segment.speaker_id ?? "Unknown speaker"}</strong><span>{segment.text}</span></p>}</For></div>
          </Show>
        </aside>}</Show>
        <Show when={menuOpen()}><div class="call-menu" role="menu" aria-label="More call options">
          <button type="button" class="ghost small" onClick={() => void copyRoomId()}>Copy room id</button>
          <DevicePicker label="Microphone" kind="audioinput" devices={devices().audioinput} disabled={!connected()} onChange={id => void switchDevice("audioinput", id)} /><Show when={!props.audioOnly}><DevicePicker label="Camera" kind="videoinput" devices={devices().videoinput} disabled={!connected()} onChange={id => void switchDevice("videoinput", id)} /></Show><DevicePicker label="Speaker" kind="audiooutput" devices={devices().audiooutput} disabled={!connected()} onChange={id => void switchDevice("audiooutput", id)} />
        </div></Show>
        <div class="call-control-bar" role="toolbar" aria-label="Call controls">
          <button type="button" class="call-btn call-btn-mic" classList={{ active: microphoneOn() }} aria-pressed={microphoneOn()} aria-label={microphoneOn() ? "Mute microphone" : "Unmute microphone"} onClick={() => void toggleMicrophone()}>{microphoneOn() ? "Mute microphone" : "Unmute microphone"}</button>
          <Show when={!props.audioOnly}>
            <button type="button" class="call-btn call-btn-camera" classList={{ active: cameraOn() }} aria-pressed={cameraOn()} aria-label={cameraOn() ? "Turn camera off" : "Turn camera on"} onClick={() => void toggleCamera()}>{cameraOn() ? "Turn camera off" : "Turn camera on"}</button>
            <button type="button" class="call-btn call-btn-share" classList={{ active: screenSharing() }} aria-pressed={screenSharing()} aria-label={screenSharing() ? "Stop sharing" : "Share screen"} onClick={() => void toggleScreenShare()}>{screenSharing() ? "Stop sharing" : "Share screen"}</button>
          </Show>
          <button type="button" class="call-btn call-btn-captions" classList={{ active: drawerTab() === "captions" }} aria-pressed={drawerTab() === "captions"} aria-label="Toggle live captions" onClick={() => toggleDrawer("captions")}>Captions</button>
          <button type="button" class="call-btn call-btn-chat" classList={{ active: drawerTab() === "chat" }} aria-pressed={drawerTab() === "chat"} aria-label="Toggle in-call chat" onClick={() => toggleDrawer("chat")}>Chat</button>
          <Show when={recordingAvailable()}><button type="button" class="call-btn call-btn-record" classList={{ active: recordingInProgress(), recording: true }} aria-pressed={recordingInProgress()} disabled={!!activeRecording() && !recordingInProgress()} onClick={() => void toggleRecording()}>{recordingInProgress() ? "Stop recording" : activeRecording() ? `Recording ${activeRecording()!.status}…` : "Start recording"}</button></Show>
          <button type="button" class="call-btn call-btn-menu" aria-pressed={menuOpen()} aria-expanded={menuOpen()} aria-label="More options: devices, room id" onClick={() => setMenuOpen(value => !value)}>⋯</button>
          <button type="button" class="call-btn call-btn-leave danger" aria-label="Leave call" onClick={() => void leave()}>Leave call</button>
          <Show when={organizer()}><button type="button" class="call-btn call-btn-end danger outline" aria-label="End call" onClick={() => void endCall()}>End call</button></Show>
        </div>
      </Show>
    </div>
    <Show when={recordings().length}><section class="call-transcript" aria-label="Recording history"><div class="call-chat-heading"><strong>Recording history</strong><span>{recordings().length} job{recordings().length === 1 ? "" : "s"}</span></div><div class="call-chat-messages"><For each={recordings()}>{item => <p><strong>{item.status}</strong><span>{item.filepath ?? "No file path"} · started {timeLabel(item.started_at)}{item.stopped_at === null ? "" : ` · stopped ${timeLabel(item.stopped_at)}`}{item.last_error ? ` · ${item.last_error}` : ""}</span></p>}</For></div></section></Show>
  </section>;
}
