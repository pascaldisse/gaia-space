import { describe, expect, test } from "bun:test";
import { type Channel } from "../api/chat";
import { type Meeting } from "../api/meetings";
import { buildChannelCallMeeting, CHANNEL_CALL_RING_SECONDS, findLiveChannelMeeting, resolveChannelCall } from "./channelCall";
const channel: Channel = { id: "channel-1", content_type: "public", name: "Design", description: null, project_id: null, archived: false };
const meeting = (id: string, channel_id: string | null, video_status: Meeting["video_status"], starts_at = 100, organizer_id = "me"): Meeting => ({
id, title: "Design", description: null, starts_at, ends_at: 200, rrule: null, location: null,
organizer_id, channel_id, visibility: "participants", modification_preference: "organizer-only",
archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null,
video_status, video_started_at: null, video_ended_at: null, video_ended_by: null,
source_entity_type: null, source_entity_id: null,
});
describe("channel call", () => {
test("builds a participant-only LiveKit meeting for the channel", () => {
expect(buildChannelCallMeeting(channel, "me", 100, 300)).toMatchObject({ title: "Design", organizer_id: "me", channel_id: "channel-1", starts_at: 100, ends_at: 400, visibility: "participants", video_provider: "livekit", video_status: "scheduled" });
});
test("resolves a live or ringing call without minting a second room", () => {
const live = meeting("live", "channel-1", "live", 1, "other");
const ringing = meeting("ringing", "channel-1", "scheduled", 100, "other");
expect(resolveChannelCall([meeting("other", "channel-2", "live"), live], "channel-1", 200)).toBe(live);
expect(resolveChannelCall([ringing], "channel-1", 100 + CHANNEL_CALL_RING_SECONDS)).toBe(ringing);
expect(resolveChannelCall([meeting("old", "channel-1", "scheduled", 1)], "channel-1", 1 + CHANNEL_CALL_RING_SECONDS + 1)).toBeNull();
});
test("banner excludes the organizer and ended calls", () => {
const live = meeting("live", "channel-1", "live", 100, "other");
expect(findLiveChannelMeeting([live], "channel-1", "me", 200)).toBe(live);
expect(findLiveChannelMeeting([live], "channel-1", "other", 200)).toBeUndefined();
expect(findLiveChannelMeeting([meeting("ended", "channel-1", "ended")], "channel-1", "me", 200)).toBeUndefined();
});
});
