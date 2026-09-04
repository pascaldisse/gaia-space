import { describe, expect, test } from "bun:test";
import { type Channel } from "../api/chat";
import { type Meeting } from "../api/meetings";
import { buildChannelCallMeeting, findLiveChannelMeeting } from "./channelCall";

const channel: Channel = { id: "channel-1", content_type: "public", name: "Design", description: null, project_id: null, archived: false };
const meeting = (id: string, channel_id: string | null, video_status: Meeting["video_status"]): Meeting => ({
  id, title: "Design", description: null, starts_at: 100, ends_at: 200, rrule: null, location: null,
  organizer_id: "me", channel_id, visibility: "participants", modification_preference: "organizer-only",
  archived: false, video_provider: "livekit", video_room_id: null, join_url: null, meeting_url: null,
  video_status, video_started_at: null, video_ended_at: null, video_ended_by: null,
  source_entity_type: null, source_entity_id: null,
});

describe("channel call", () => {
  test("builds a participant-only LiveKit meeting for the channel", () => {
    expect(buildChannelCallMeeting(channel, "me", 100, 300)).toMatchObject({
      title: "Design", organizer_id: "me", channel_id: "channel-1", starts_at: 100, ends_at: 400,
      visibility: "participants", video_provider: "livekit", video_status: "scheduled",
    });
  });

  test("finds only a live meeting belonging to the channel", () => {
    const live = meeting("live", "channel-1", "live");
    expect(findLiveChannelMeeting([meeting("other", "channel-2", "live"), meeting("ended", "channel-1", "ended"), live], "channel-1")).toBe(live);
    expect(findLiveChannelMeeting([meeting("other", "channel-2", "live")], "channel-1")).toBeUndefined();
  });
});
