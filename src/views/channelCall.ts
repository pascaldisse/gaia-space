import { newId, type Channel } from "../api/chat";
import { type Meeting } from "../api/meetings";
export const CHAT_CALL_DURATION_SECONDS = Number(import.meta.env.VITE_CHAT_CALL_DURATION_SECONDS) || 60 * 60;
export const CALL_RING_SECONDS = Number(import.meta.env.VITE_CALL_RING_SECONDS) || 60;
export const CALL_LIVE_JOINABLE_SECONDS = Number(import.meta.env.VITE_CALL_LIVE_JOINABLE_SECONDS) || CHAT_CALL_DURATION_SECONDS;
// Compatibility alias for callers which used the former channel-only name.
export const CHANNEL_CALL_RING_SECONDS = CALL_RING_SECONDS;
export const buildChannelCallMeeting = (
  channel: Pick<Channel, "id" | "name" | "content_type">,
  organizerId: string,
  now = Math.floor(Date.now() / 1_000),
  durationSeconds = CHAT_CALL_DURATION_SECONDS,
): Meeting => ({
  id: newId("meeting"), title: channel.name ?? channel.content_type, description: null,
  starts_at: now, ends_at: now + durationSeconds, rrule: null, location: null,
  organizer_id: organizerId, channel_id: channel.id, visibility: "participants",
  modification_preference: "organizer-only", archived: false, video_provider: "livekit",
  video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled",
  video_started_at: null, video_ended_at: null, video_ended_by: null,
  source_entity_type: null, source_entity_id: null,
});
const ringing = (meeting: Meeting, now: number, ringSeconds = CALL_RING_SECONDS) =>
  meeting.video_status === "scheduled" && meeting.starts_at <= now && now - meeting.starts_at <= ringSeconds;
const liveJoinable = (meeting: Meeting, now: number) =>
  meeting.video_status === "live" && meeting.video_started_at !== null && now - meeting.video_started_at <= CALL_LIVE_JOINABLE_SECONDS;
/** The one incoming-call predicate. `dismissed` contains locally declined/accepted calls;
 *  remote RSVP status is folded into it by the shell before this function is called. */
export const findIncomingCalls = (
  meetings: Meeting[] | undefined,
  selfId: string | null | undefined,
  now = Math.floor(Date.now() / 1_000),
  ringSeconds = CALL_RING_SECONDS,
  dismissed: ReadonlySet<string> = new Set(),
): Meeting[] => (meetings ?? []).filter((meeting) =>
  !meeting.archived && !!meeting.channel_id && !!selfId && meeting.organizer_id !== selfId &&
  !dismissed.has(meeting.id) && (ringing(meeting, now, ringSeconds) || liveJoinable(meeting, now)),
);
export const resolveChannelCall = (meetings: Meeting[] | undefined, channelId: string, now = Math.floor(Date.now() / 1_000)): Meeting | null => {
  const calls = meetings?.filter((meeting) => !meeting.archived && meeting.channel_id === channelId) ?? [];
  return calls.find((meeting) => meeting.video_status === "live") ?? calls.find((meeting) => ringing(meeting, now)) ?? null;
};
export const findLiveChannelMeeting = (meetings: Meeting[] | undefined, channelId: string, organizerId: string | null | undefined, now = Math.floor(Date.now() / 1_000), dismissed?: ReadonlySet<string>): Meeting | undefined =>
  findIncomingCalls(meetings, organizerId, now, CALL_RING_SECONDS, dismissed).find((meeting) => meeting.channel_id === channelId);
export const channelCallLabel = (meeting: Pick<Meeting, "video_status">) => meeting.video_status === "scheduled" ? "Incoming call" : "Call live";
