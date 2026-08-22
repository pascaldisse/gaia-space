import { invoke } from "@tauri-apps/api/core";

export type Meeting = { id:string; title:string; description:string|null; starts_at:number; ends_at:number; rrule:string|null; location:string|null; organizer_id:string|null; channel_id:string|null; archived:boolean };
export type MeetingParticipant = { meeting_id:string; profile_id:string; status:"invited"|"accepted"|"declined" };
export type MeetingOccurrence = { id:string; meeting_id:string; title:string; starts_at:number; ends_at:number; location:string|null };
export type LivekitConfig = { server_path?:string; host?:string; port?:number; api_key?:string; api_secret?:string; egress_url?:string; recording_filepath?:string };
export type CallJoin = { url:string; room:string; token:string };
export type CallRecording = { egress_id:string; status:"recording"|"stopped" };
export type LivekitStatus = { running:boolean; url:string; pid:number|null };
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
  startServer: (config?:LivekitConfig) => call<LivekitStatus>("start_livekit_server", {config}), status: (config?:LivekitConfig) => call<LivekitStatus>("livekit_server_status", {config}),
  joinCall: (meeting_id:string, participant_id:string, display_name:string, config?:LivekitConfig) => call<CallJoin>("join_meeting_call", {meetingId:meeting_id, participantId:participant_id, displayName:display_name, config}),
startRecording: (meeting_id:string, participant_id:string, config?:LivekitConfig) => call<CallRecording>("start_meeting_recording", {meetingId:meeting_id, participantId:participant_id, config}),
stopRecording: (meeting_id:string, participant_id:string, config?:LivekitConfig) => call<CallRecording>("stop_meeting_recording", {meetingId:meeting_id, participantId:participant_id, config}),
};
