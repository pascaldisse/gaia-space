import { newId, type Channel } from "../api/chat";
import { type Meeting } from "../api/meetings";

export const CHAT_CALL_DURATION_SECONDS = Number(import.meta.env.VITE_CHAT_CALL_DURATION_SECONDS) || 60 * 60;

export const buildChannelCallMeeting = (
  channel: Pick<Channel, "id" | "name" | "content_type">,
  organizerId: string,
  now = Math.floor(Date.now() / 1_000),
  durationSeconds = CHAT_CALL_DURATION_SECONDS,
): Meeting => ({
  id: newId("meeting"),
  title: channel.name ?? channel.content_type,
  description: null,
  starts_at: now,
  ends_at: now + durationSeconds,
  rrule: null,
  location: null,
  organizer_id: organizerId,
  channel_id: channel.id,
  visibility: "participants",
  modification_preference: "organizer-only",
  archived: false,
  video_provider: "livekit",
  video_room_id: null,
  join_url: null,
  meeting_url: null,
  video_status: "scheduled",
  video_started_at: null,
  video_ended_at: null,
  video_ended_by: null,
  source_entity_type: null,
  source_entity_id: null,
});

export const findLiveChannelMeeting = (meetings: Meeting[] | undefined, channelId: string): Meeting | undefined =>
  meetings?.find((meeting) => meeting.channel_id === channelId && meeting.video_status === "live");
