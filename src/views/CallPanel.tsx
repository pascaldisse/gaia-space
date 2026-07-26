import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { meetingsApi, type CallJoin, type Meeting } from "../api/meetings";

function VideoTile(props:{participant:Participant}) {
  let element: HTMLVideoElement | undefined;
  createEffect(() => {
    const publication = props.participant.getTrackPublication(Track.Source.Camera);
    const track = publication?.videoTrack;
    if (!track || !element) return;
    track.attach(element);
    onCleanup(() => track.detach(element));
  });
  return <article class="call-tile"><video ref={element} autoplay muted={props.participant.isLocal} playsinline /><strong>{props.participant.name || props.participant.identity}</strong><small>{props.participant.isLocal ? "You" : "Connected"}</small></article>;
}

export default function CallPanel(props:{meeting:Meeting; identity:string; displayName:string}) {
  const [room,setRoom] = createSignal<Room>(); const [state,setState] = createSignal("disconnected"); const [participants,setParticipants] = createSignal<Participant[]>([]); const [capture,setCapture] = createSignal(""); const [error,setError] = createSignal(""); const [muted,setMuted] = createSignal(false); const [join,setJoin] = createSignal<CallJoin>();
  const sync = () => { const current=room(); if (current) setParticipants([current.localParticipant, ...current.remoteParticipants.values()]); };
  const connect = async () => {
    try {
      setError(""); setCapture(""); setState("connecting");
      const credentials = await meetingsApi.joinCall(props.meeting.id, props.identity, props.displayName);
      const next = new Room(); setRoom(next); setJoin(credentials);
      next.on(RoomEvent.ConnectionStateChanged, value => { setState(value.toLowerCase()); sync(); });
      next.on(RoomEvent.ParticipantConnected, sync); next.on(RoomEvent.ParticipantDisconnected, sync); next.on(RoomEvent.TrackSubscribed, sync); next.on(RoomEvent.TrackUnsubscribed, sync);
      await next.connect(credentials.url, credentials.token); sync();
      try { await next.localParticipant.setMicrophoneEnabled(true); await next.localParticipant.setCameraEnabled(true); setCapture("Microphone and camera published."); }
      catch (mediaError) { setCapture(`Connected; media capture unavailable: ${String(mediaError)}`); }
    } catch (connectError) { setState("disconnected"); setError(String(connectError)); }
  };
  const leave = async () => { const current=room(); if (current) { await current.disconnect(); } setRoom(undefined); setParticipants([]); setState("disconnected"); setJoin(undefined); };
  const toggleMute = async () => { const current=room(); if (!current) return; const next=!muted(); await current.localParticipant.setMicrophoneEnabled(!next); setMuted(next); };
  onCleanup(() => { void room()?.disconnect(); });
  return <section class="call-panel"><div class="call-heading"><div><h3>Live call</h3><p>State: <strong data-call-state>{state()}</strong></p></div>{room() ? <div class="call-actions"><button onClick={toggleMute}>{muted()?"Unmute":"Mute"}</button><button class="danger" onClick={leave}>Leave</button></div> : <button class="primary" onClick={connect}>Join call</button>}</div>{error() && <p class="meeting-error">{error()}</p>}{capture() && <p class="call-capture">{capture()}</p>}{join() && <small class="call-room">Room: {join()!.room}</small>}<div class="call-tiles"><For each={participants()}>{participant=><VideoTile participant={participant}/>}</For></div></section>;
}
