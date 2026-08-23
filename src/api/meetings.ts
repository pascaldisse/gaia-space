import { invoke } from "@tauri-apps/api/core";

export type Meeting = { id:string; title:string; description:string|null; starts_at:number; ends_at:number; rrule:string|null; location:string|null; organizer_id:string|null; channel_id:string|null; video_provider:"native"|"meet"; video_status:"scheduled"|"live"|"ended"|"cancelled"; access_level:"PRIVATE"|"PUBLIC"; archived:boolean };
export type MeetingParticipant = { meeting_id:string; profile_id:string; status:"invited"|"accepted"|"declined" };
export type MeetingOccurrence = { id:string; meeting_id:string; title:string; starts_at:number; ends_at:number; location:string|null };
export type LivekitConfig = { server_path?:string; host?:string; port?:number; api_key?:string; api_secret?:string; egress_url?:string; recording_filepath?:string; egress_timeout_ms?:number; recording_reservation_ttl_seconds?:number; recording_max_stop_attempts?:number };
export type CallJoin = { url:string; room:string; token:string };
export type CallRecording = { id:string; meeting_id:string; egress_id:string|null; status:"starting"|"recording"|"stopping"|"stopped"|"failed"; filepath:string|null; started_by:string|null; started_at:number; stopped_at:number|null; stop_attempts:number; last_error:string|null };
export type CallTranscriptSegment = { id:string; meeting_id:string; speaker_id:string|null; text:string; started_at:number; ended_at:number; source:"external"|"manual"; created_at:number };
export type LivekitStatus = { running:boolean; url:string; pid:number|null };
// Whether the native side can name the acting profile at all. `available:false` means
// recording is refused (fail-closed) and `reason` says why, so the UI can say so too.
export type RecordingActorStatus = { available:boolean; profile_id:string|null; source:"environment"|"sole_profile"|null; reason:string|null };
const call = <T>(command:string, args:Record<string, unknown> = {}) => invoke<T>(command, args);

export const meetingsApi = {
  // Every read carries the acting profile. The web transport overwrites it with
  // the session profile; the desktop transport has no session to overwrite it.
  list: (profileId:string) => call<Meeting[]>("list_meetings", {profileId}), get: (id:string, profileId:string) => call<Meeting|null>("get_meeting", {id, profileId}),
  create: (meeting:Meeting) => call<void>("create_meeting", {meeting}), update: (meeting:Meeting) => call<void>("update_meeting", {meeting}), archive: (id:string, archived:boolean) => call<void>("archive_meeting", {id, archived}),
  occurrences: (range_start:number, range_end:number, profileId:string) => call<MeetingOccurrence[]>("expand_meeting_occurrences", {rangeStart:range_start, rangeEnd:range_end, profileId}),
  participants: (meeting_id:string, profileId:string) => call<MeetingParticipant[]>("list_meeting_participants", {meetingId:meeting_id, profileId}),
  invite: (meeting_id:string, profile_id:string) => call<void>("invite_meeting_participant", {meetingId:meeting_id, profileId:profile_id}),
  rsvp: (meeting_id:string, profile_id:string, status:MeetingParticipant["status"]) => call<void>("set_meeting_participant_status", {meetingId:meeting_id, profileId:profile_id, status}),
  // Runtime + join carry NO identity and NO config over IPC either: the LiveKit endpoint
  // and keys come from native config/env, the joining profile from `actor::resolve`.
  startServer: () => call<LivekitStatus>("start_livekit_server"), status: () => call<LivekitStatus>("livekit_server_status"),
  joinCall: (meeting_id:string) => call<CallJoin>("join_meeting_call", {meetingId:meeting_id}),
  // Recording carries NO identity and NO config over IPC. The acting profile is resolved
  // natively (`actor::resolve`) and the Egress endpoint/filepath/timeouts come from
  // LIVEKIT_* env / native defaults, so a compromised webview can neither record as
  // somebody else nor redirect the output.
  startRecording: (meeting_id:string) => call<CallRecording>("start_meeting_recording", {meetingId:meeting_id}),
  stopRecording: (meeting_id:string) => call<CallRecording>("stop_meeting_recording", {meetingId:meeting_id}),
  // Recording history is meeting-read scoped against the native actor; start/stop stay organizer-only.
  recordings: (meeting_id:string) => call<CallRecording[]>("list_meeting_recordings", {meetingId:meeting_id}),
  transcriptSegments: (meeting_id:string) => call<CallTranscriptSegment[]>("list_meeting_transcript_segments", {meetingId:meeting_id}),
  recordingActor: () => call<RecordingActorStatus>("recording_actor_status"),
};
