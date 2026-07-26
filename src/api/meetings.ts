import { invoke } from "@tauri-apps/api/core";

export type Meeting = { id:string; title:string; description:string|null; starts_at:number; ends_at:number; rrule:string|null; location:string|null; organizer_id:string|null; channel_id:string|null; archived:boolean };
export type MeetingParticipant = { meeting_id:string; profile_id:string; status:"invited"|"accepted"|"declined" };
export type MeetingOccurrence = { id:string; meeting_id:string; title:string; starts_at:number; ends_at:number; location:string|null };
export type LivekitConfig = { server_path?:string; host?:string; port?:number; api_key?:string; api_secret?:string };
export type CallJoin = { url:string; room:string; token:string };
export type LivekitStatus = { running:boolean; url:string; pid:number|null };
const call = <T>(command:string, args:Record<string, unknown> = {}) => invoke<T>(command, args);

export const meetingsApi = {
  list: () => call<Meeting[]>("list_meetings"), get: (id:string) => call<Meeting|null>("get_meeting", {id}),
  create: (meeting:Meeting) => call<void>("create_meeting", {meeting}), update: (meeting:Meeting) => call<void>("update_meeting", {meeting}), archive: (id:string, archived:boolean) => call<void>("archive_meeting", {id, archived}),
  occurrences: (range_start:number, range_end:number) => call<MeetingOccurrence[]>("expand_meeting_occurrences", {rangeStart:range_start, rangeEnd:range_end}),
  participants: (meeting_id:string) => call<MeetingParticipant[]>("list_meeting_participants", {meetingId:meeting_id}),
  invite: (meeting_id:string, profile_id:string) => call<void>("invite_meeting_participant", {meetingId:meeting_id, profileId:profile_id}),
  rsvp: (meeting_id:string, profile_id:string, status:MeetingParticipant["status"]) => call<void>("set_meeting_participant_status", {meetingId:meeting_id, profileId:profile_id, status}),
  startServer: (config?:LivekitConfig) => call<LivekitStatus>("start_livekit_server", {config}), status: (config?:LivekitConfig) => call<LivekitStatus>("livekit_server_status", {config}),
  joinCall: (meeting_id:string, participant_id:string, display_name:string, config?:LivekitConfig) => call<CallJoin>("join_meeting_call", {meetingId:meeting_id, participantId:participant_id, displayName:display_name, config}),
};
