import { describe, expect, test } from "bun:test";
import {
  applyChannelRead,
  buildNeedsYou,
  buildOrganisation,
  countNeedsYou,
  emptySources,
  isOrganisationEvent,
  readActor,
  unreadChannelTotal,
  type AttentionSources,
} from "./attention";
import type { ChannelSummary, MentionView, UnreadThread } from "./api/chat";
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

  // A reply to my message addresses me. Thread channels are filtered out of the
  // channel list on purpose, so before this source they could not reach ANY surface:
  // the badge, Home and the Inbox were all blind to them at once.
  test("unread replies in a thread I take part in are work, counted like everything else", () => {
    const thread: UnreadThread = {
      channel_id: "thread:msg-1",
      parent_channel_id: "c-design",
      parent_channel_name: "design",
      root_message_id: "msg-1",
      root_excerpt: "Which way should the worklist read?",
      unread_count: 2,
      last_reply_at: 1200,
      last_reply_author: "Ada",
    };
    const s = sources({ threads: [thread] });
    expect(countNeedsYou(s)).toBe(1);
    expect(buildNeedsYou(s)[0]).toMatchObject({
      kind: "thread",
      title: "Ada replied in “Which way should the worklist read?”",
      detail: "2 unread replies · thread in #design",
      // The thread's own id: Chat decodes it back to parent + open panel.
      route: { view: "Chat", entityType: "channel", entityId: "thread:msg-1" },
    });
    expect(buildNeedsYou(s)[0].resolve).toBeDefined();
  });

  test("a single unread reply is not pluralised into nonsense", () => {
    const s = sources({ threads: [{ channel_id: "thread:m", parent_channel_id: "c", parent_channel_name: null, root_message_id: "m", root_excerpt: "q", unread_count: 1, last_reply_at: 1, last_reply_author: null } as UnreadThread] });
    expect(buildNeedsYou(s)[0]).toMatchObject({ title: "Someone replied in “q”", detail: "1 unread reply · thread in #c" });
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

  // The rule tightened: a worklist answers "what is directed at me". A task I wrote
  // for myself is my own list, not an inbox item — and Home showed it twice, once
  // under "My tasks" and once under "Needs you". The discriminator is AUTHORSHIP.
  test("work somebody else put on me counts; my own list and other people's do not", () => {
    const s = sources({
      todos: [
        todo({ id: "put-on-me", profile_id: "other", assignee_ids: [ME] }),
        todo({ id: "my-own", assignee_ids: [ME] }),
        todo({ id: "theirs", profile_id: "other", assignee_ids: ["other"] }),
      ],
    });
    expect(buildNeedsYou(s).map((item) => item.id)).toEqual(["todo:put-on-me"]);
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

describe("the actor convention", () => {
  test("an emitted actor line is read, never guessed", () => {
    expect(readActor("by Ada Lovelace · Orbital")).toEqual({ actor: "Ada Lovelace", detail: "Orbital" });
    expect(readActor("by Ada Lovelace")).toEqual({ actor: "Ada Lovelace", detail: undefined });
  });
  test("free text stays free text: no actor is invented", () => {
    expect(readActor("Fixes the login crash")).toEqual({ detail: "Fixes the login crash" });
    expect(readActor(null)).toEqual({ detail: undefined });
  });
  test("the feed names the person the emitter recorded", () => {
    const [event] = buildOrganisation({
      ...emptySources(ME),
      notifications: [
        {
          id: "n",
          recipient_id: ME,
          event_type: "todo.completed",
          title: "Prepare the review",
          body: "by GAIA Organization · Demo Project",
          entity_type: "todo",
          entity_id: "t1",
          created_at: 10,
          read_at: null,
        },
      ],
    });
    expect(event).toMatchObject({ actor: "GAIA Organization", verb: "completed a task", object: "Prepare the review", detail: "Demo Project" });
  });
});

/** ── READING A CHANNEL CLEARS BOTH BADGES ──────────────────────────────────
 *  The defect: opening a channel wrote the read marker but only the caller's own
 *  list re-read it, so the row badge and the aggregate Chats badge both stayed
 *  at 1. These tests are the aggregate side, pure: one snapshot in, both numbers
 *  out. */
describe("reading a channel clears the badges it fed", () => {
  test("unread=1 → markRead → the aggregate Chats badge is 0", () => {
    const before = sources({ channels: [channel({ id: "c-open", unread_count: 1 })] });
    expect(unreadChannelTotal(before.channels)).toBe(1);
    const after = applyChannelRead(before, "c-open");
    expect(unreadChannelTotal(after.channels)).toBe(0);
  });

  test("the channel's own row badge drops to 0, and only that row's", () => {
    const before = sources({
      channels: [channel({ id: "c-open", unread_count: 1 }), channel({ id: "c-other", unread_count: 4 })],
    });
    const after = applyChannelRead(before, "c-open");
    expect(after.channels.find((c) => c.id === "c-open")!.unread_count).toBe(0);
    expect(after.channels.find((c) => c.id === "c-other")!.unread_count).toBe(4);
    expect(unreadChannelTotal(after.channels)).toBe(4);
  });

  test("an entity channel read stops needing you", () => {
    const before = sources({
      channels: [channel({ id: "entity:absence:a1", content_type: "entity-bound", name: "Time off", unread_count: 1 })],
    });
    expect(countNeedsYou(before)).toBe(1);
    expect(countNeedsYou(applyChannelRead(before, "entity:absence:a1"))).toBe(0);
  });

  test("reading the channel reads the mentions inside it", () => {
    const mention = { id: "m1", channel_id: "c-open", channel_name: "design", notification_id: "n1", read: false, text: "hey @me", created_at: 900 } as MentionView;
    const before = sources({ mentions: [mention], channels: [channel({ id: "c-open", unread_count: 1 })] });
    expect(countNeedsYou(before)).toBe(1);
    expect(countNeedsYou(applyChannelRead(before, "c-open"))).toBe(0);
  });

  test("reading a thread channel clears its worklist row", () => {
    const thread = { channel_id: "thread:m1", parent_channel_id: "c1", parent_channel_name: "design", root_message_id: "m1", root_excerpt: "q", unread_count: 1, last_reply_at: 5, last_reply_author: "Ada" } as UnreadThread;
    const before = sources({ threads: [thread] });
    expect(countNeedsYou(before)).toBe(1);
    expect(countNeedsYou(applyChannelRead(before, "thread:m1"))).toBe(0);
  });

  test("the snapshot is not mutated in place — surfaces re-read, never observe a tear", () => {
    const before = sources({ channels: [channel({ id: "c-open", unread_count: 1 })] });
    applyChannelRead(before, "c-open");
    expect(before.channels[0].unread_count).toBe(1);
  });

  test("work that is not unread text survives being in a read channel", () => {
    const before = sources({
      channels: [channel({ id: "c-open", content_type: "dm", unread_count: 1 })],
      todos: [todo({ id: "t9", profile_id: "someone-else", assignee_ids: [ME] })],
    });
    expect(countNeedsYou(before)).toBe(2);
    expect(countNeedsYou(applyChannelRead(before, "c-open"))).toBe(1);
  });

  test("an unknown or empty channel id changes nothing", () => {
    const before = sources({ channels: [channel({ id: "c-open", unread_count: 1 })] });
    expect(unreadChannelTotal(applyChannelRead(before, "c-missing").channels)).toBe(1);
    expect(applyChannelRead(before, "")).toBe(before);
  });

  test("an archived channel never feeds the aggregate badge", () => {
    expect(unreadChannelTotal([channel({ id: "c-old", unread_count: 3, archived: true })])).toBe(0);
  });
});
