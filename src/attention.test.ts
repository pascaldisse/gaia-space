import { describe, expect, test } from "bun:test";
import {
  buildNeedsYou,
  buildOrganisation,
  countNeedsYou,
  emptySources,
  isOrganisationEvent,
  type AttentionSources,
} from "./attention";
import type { ChannelSummary, MentionView } from "./api/chat";
import type { Notification, Todo } from "./api/personal";
import type { DirectoryFeedEvent } from "./api/platform";

const ME = "profile-me";

const channel = (over: Partial<ChannelSummary>): ChannelSummary => ({
  id: "c1",
  content_type: "channel",
  name: "general",
  description: null,
  project_id: null,
  archived: false,
  member_count: 3,
  unread_count: 0,
  last_message_at: 100,
  ...over,
} as ChannelSummary);

const notification = (over: Partial<Notification>): Notification => ({
  id: "n1",
  recipient_id: ME,
  event_type: "meeting.invited",
  title: "Standup",
  body: null,
  entity_type: null,
  entity_id: null,
  created_at: 500,
  read_at: null,
  ...over,
});

const todo = (over: Partial<Todo>): Todo => ({
  id: "t1",
  profile_id: ME,
  content: "Write the spec",
  due_date: null,
  project_id: null,
  done: false,
  source_entity_type: null,
  source_entity_id: null,
  notes: null,
  assignee_ids: [],
  content_kind: "text",
  ...over,
});

const sources = (over: Partial<AttentionSources>): AttentionSources => ({ ...emptySources(ME), ...over });

describe("one definition of what needs me", () => {
  // THE PRODUCT OWNER'S DEFECT, as a test: two unreads in an entity-bound
  // channel. The old rail badge said 2, the old Home card said 0. One rule now
  // answers both, and it answers 2.
  test("an unread in an entity-bound channel is work, and is counted", () => {
    const s = sources({
      channels: [
        channel({ id: "entity:absence:a1", content_type: "entity-bound", name: "Time off · profile-me", unread_count: 2 }),
      ],
    });
    expect(countNeedsYou(s)).toBe(1);
    expect(buildNeedsYou(s)[0]).toMatchObject({ kind: "channel", detail: "2 unread messages" });
  });

  test("a busy public channel is noise, not a claim on a person", () => {
    expect(countNeedsYou(sources({ channels: [channel({ unread_count: 9 })] }))).toBe(0);
  });

  test("unread DMs and mentions stay work", () => {
    const mention = { id: "m1", channel_id: "c9", channel_name: "design", notification_id: "n9", read: false, text: "hey @me", created_at: 900 } as MentionView;
    const s = sources({ mentions: [mention], channels: [channel({ id: "dm1", content_type: "dm", name: "Ada", unread_count: 1 })] });
    expect(countNeedsYou(s)).toBe(2);
  });

  test("a mention and its notification row are one fact, not two", () => {
    const mention = { id: "m1", channel_id: "c9", channel_name: "design", notification_id: "n-dup", read: false, text: "hey @me", created_at: 900 } as MentionView;
    const s = sources({ mentions: [mention], notifications: [notification({ id: "n-dup", event_type: "mention.created" })] });
    expect(countNeedsYou(s)).toBe(1);
  });

  test("assigned work counts, other people's work does not", () => {
    const s = sources({
      todos: [todo({ id: "mine", assignee_ids: [ME] }), todo({ id: "theirs", profile_id: "other", assignee_ids: ["other"] })],
    });
    expect(buildNeedsYou(s).map((item) => item.id)).toEqual(["todo:mine"]);
  });

  test("read notifications and organisation news never reach the worklist", () => {
    const s = sources({
      notifications: [
        notification({ id: "read", read_at: 10 }),
        notification({ id: "news", event_type: "issue.created" }),
        notification({ id: "work" }),
      ],
    });
    expect(buildNeedsYou(s).map((item) => item.id)).toEqual(["notification:work"]);
  });

  test("no identity means no worklist, not somebody else's", () => {
    expect(countNeedsYou({ ...sources({ channels: [channel({ content_type: "dm", unread_count: 4 })] }), profileId: "" })).toBe(0);
  });
});

describe("the organisation feed", () => {
  test("news is a feed: not counted, not cleared, read state irrelevant", () => {
    const s = sources({
      notifications: [
        notification({ id: "a", event_type: "issue.created", title: "Ship it", created_at: 1 }),
        notification({ id: "b", event_type: "todo.completed", title: "Old task", read_at: 5, created_at: 2 }),
      ],
    });
    expect(buildOrganisation(s).length).toBe(2);
    expect(countNeedsYou(s)).toBe(0);
  });

  test("directory events are organisation news with a real actor", () => {
    const event: DirectoryFeedEvent = {
      id: "d1",
      event_type: "member.joined",
      profile_id: "p9",
      profile_name: "Ada Lovelace",
      team_id: null,
      team_name: null,
      role_id: null,
      role_name: null,
      created_at: 900,
    };
    const [first] = buildOrganisation(sources({ directory: [event] }));
    expect(first).toMatchObject({ actor: "Ada Lovelace", verb: "joined the organisation" });
  });

  test("the feed is chronological, newest first", () => {
    const s = sources({
      notifications: [
        notification({ id: "old", event_type: "git.commit", created_at: 100 }),
        notification({ id: "new", event_type: "review.merged", created_at: 999 }),
      ],
    });
    expect(buildOrganisation(s).map((event) => event.id)).toEqual(["activity:new", "activity:old"]);
  });

  test("the two streams are disjoint by event type", () => {
    expect(isOrganisationEvent("todo.completed")).toBe(true);
    expect(isOrganisationEvent("project.created")).toBe(true);
    expect(isOrganisationEvent("mention.created")).toBe(false);
  });
});
