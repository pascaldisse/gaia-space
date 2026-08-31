/** ── THE ONE DEFINITION OF "WHAT NEEDS ME" ──────────────────────────────────
 *
 *  THE LAW: no surface may compute its own idea of what is waiting for a
 *  person. Home, the Inbox and the rail badge read THIS module and nothing
 *  else. If a new surface needs a count, it calls `attentionCount()`; if it
 *  needs the rows, it calls `needsYou()`. Adding a second rule anywhere else is
 *  the defect this file exists to end.
 *
 *  THE DEFECT THAT PROVED IT: the rail's badge summed `unread_count` over ALL
 *  channels (it said 2), while Home counted unread mentions + unread DMs only
 *  (it said nothing). The two unreads sat in an entity-bound channel
 *  ("Time off · profile-…"), which is neither a mention nor a DM. Both rules
 *  were defensible alone; together they were nonsense.
 *
 *  TWO STREAMS, NEVER MIXED — this separation is the whole point:
 *
 *    NEEDS YOU  — a WORKLIST. It empties. It carries the badge count. Every
 *                 item can be resolved (read it, open it, complete it).
 *    ORGANISATION — a FEED. It never empties. It carries NO count. It is read,
 *                 not cleared. It reports what OTHER people did.
 *
 *  An item belongs to exactly one stream, decided by ADDRESSING, not by read
 *  state: if the thing is aimed at me (named me, assigned me, asked for my
 *  review, was delivered to my notification row as a personal matter) it is
 *  work; if it is a report of somebody's completed action it is news.
 *  `ORGANISATION_EVENTS` is the closed set of "news" event types — everything
 *  else that lands in my notifications is work.
 *
 *  WHAT COUNTS AS "NEEDS YOU" (the exact rule, one place, seven sources):
 *    0. unread replies in a THREAD I take part in (wrote the root, or replied)
 *       — a reply to my message addresses me, which is the whole test above.
 *         Thread channels are filtered out of the channel list on purpose, so
 *         this is the ONE place they can be seen; `list_unread_threads` already
 *         applies participation, authorship and the parent channel's ACL.
 *    1. unread mentions of me
 *    2. unread DM channels                      (one item per channel)
 *    3. unread ENTITY-BOUND channels            (one item per channel)
 *       — an entity channel is narrow by construction: you are in it because
 *         you are involved in that absence/issue/document. This is the source
 *         the old badge counted and the old Home card dropped.
 *    4. open todos assigned to me
 *    5. open issues assigned to me
 *    6. unread notifications addressed to me whose event type is NOT
 *       organisation news (mention notifications are deduplicated against 1)
 *  DELIBERATELY EXCLUDED: unread in public/project channels. A busy channel is
 *  not a claim on a person, and counting it is what made the badge meaningless.
 *
 *  ORGANISATION is sourced from the same substrate: activity notifications that
 *  reached me (issue/review/document/git/deployment/todo/project/absence) plus
 *  the org-wide `directory_feed_events` (joined/left/role changed). It is
 *  honest about its horizon: it shows the activity this workspace delivered to
 *  this profile, never a private feed of someone else's.
 */

import { createResource, createRoot, createSignal } from "solid-js";
import { chatApi, type ChannelSummary, type MentionView, type UnreadThread } from "./api/chat";
import { personalApi, type Dashboard, type Notification, type Todo } from "./api/personal";
import { platformApi, type DirectoryFeedEvent } from "./api/platform";
import { reviewApi, type Review, type ReviewParticipant } from "./api/review";
import type { Route } from "./router";
import { profileId } from "./session";
import type { Tone } from "./statusTone";

/** Which worklist source produced a row. Used for icons and grouping only —
 *  never to re-derive the count, which is `needsYou().length` and nothing else. */
export type AttentionKind = "mention" | "dm" | "channel" | "thread" | "todo" | "issue" | "review" | "notification";

/** ── THE ACTIVITY FILTERS ───────────────────────────────────────────────────
 *  Activity's sidebar entries are FILTERS over this one worklist, never links to
 *  another mode. They are expressed as GROUPS OF `AttentionKind` — the kind an
 *  item already carries — so no surface invents a second classification.
 *
 *  The groups PARTITION the kinds: every kind belongs to exactly one filter
 *  (asserted in `activityFilter.test.ts`). A kind with no filter would be
 *  reachable under "All" only, which is how a label with nothing behind it
 *  (`provisional`) happened in the first place.
 *
 *  JUDGEMENT CALLS, stated once:
 *    - `thread` sits under MENTIONS. The head comment's own test for the
 *      worklist is ADDRESSING, and it already rules that a reply to my message
 *      addresses me — the same fact as someone writing my name. It is not a
 *      "message" I have merely not read.
 *    - `dm` + `channel` get their own MESSAGES entry: they are unread
 *      conversations, resolved by reading, not by doing work.
 *    - `notification` gets UPDATES rather than being dropped: it is work
 *      addressed to me (organisation news is already excluded upstream), so it
 *      must be reachable under a filter, not only under All.
 *  The filter id is also the URL segment (`/inbox/<filter>`); `all` is the bare
 *  view, so the unfiltered list has exactly one spelling. */
export type ActivityFilter = "all" | "mentions" | "messages" | "assigned" | "reviews" | "updates";

export const ACTIVITY_FILTERS: { id: ActivityFilter; label: string; kinds: AttentionKind[] }[] = [
  { id: "all", label: "All", kinds: [] }, // empty = no narrowing, not "no kinds"
  { id: "mentions", label: "Mentions", kinds: ["mention", "thread"] },
  { id: "messages", label: "Messages", kinds: ["dm", "channel"] },
  { id: "assigned", label: "Assigned", kinds: ["todo", "issue"] },
  { id: "reviews", label: "Reviews", kinds: ["review"] },
  { id: "updates", label: "Updates", kinds: ["notification"] },
];

const FILTER_IDS = ACTIVITY_FILTERS.map((entry) => entry.id);
export const isActivityFilter = (value: string): value is ActivityFilter =>
  (FILTER_IDS as string[]).includes(value);

/** Unknown filter degrades to All — never to a blank page. */
export const asActivityFilter = (value: string | undefined): ActivityFilter =>
  value && isActivityFilter(value) ? value : "all";

export const kindsOfFilter = (filter: ActivityFilter): AttentionKind[] =>
  ACTIVITY_FILTERS.find((entry) => entry.id === filter)?.kinds ?? [];

/** Pure: narrow a worklist to a filter. THE one place the narrowing happens. */
export const filterAttention = (items: AttentionItem[], filter: ActivityFilter): AttentionItem[] => {
  if (filter === "all") return items;
  const kinds = kindsOfFilter(filter);
  return items.filter((item) => kinds.includes(item.kind));
};

/** The count of ONE filter, from the same source as the badge. The rail badge
 *  keeps showing `attentionCount()` — a filter narrows the view, never the
 *  number of things that need you. */
export const attentionFilterCount = (filter: ActivityFilter): number =>
  filter === "all" ? attentionCount() : filterAttention(needsYou(), filter).length;

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  /** What the person has to look at. */
  title: string;
  /** Where it lives — "#design", "2 unread", a project key. */
  detail?: string;
  /** Seconds since epoch; the worklist is newest-first. */
  at: number;
  /** The verb of the row's action button ("Reply", "Open", "Mark read"). */
  action: string;
  tone: Tone;
  route: Route;
  /** The chat anchor the work was born from, when it has one: a task raised in a
   *  channel must lead back to the message that raised it (feeds `SourceLink`). */
  anchor?: { entityType: string; entityId: string };
  /** Present when the row can be cleared in place. Absent = open it to resolve. */
  resolve?: () => Promise<void>;
};

export type OrganisationEvent = {
  id: string;
  at: number;
  /** Who did it. "Someone" when the substrate did not record a name. */
  actor: string;
  /** What they did, past tense: "opened", "merged", "completed". */
  verb: string;
  /** What they did it to. */
  object: string;
  detail?: string;
  route?: Route;
  /** The chat anchor, when the event carries one (feeds `SourceLink`). */
  anchor?: { entityType: string; entityId: string };
};

/** The closed set of "somebody did a thing" event types. Members go to the
 *  ORGANISATION feed and are NEVER counted; non-members that land in my
 *  notifications are addressed to me and count as work. */
export const ORGANISATION_EVENTS: ReadonlySet<string> = new Set([
  "issue.created",
  "issue.updated",
  "issue.archived",
  "review.created",
  "review.updated",
  "review.merged",
  "review.participant_updated",
  "review.discussion_created",
  "review.discussion_updated",
  "review.suggestion_updated",
  "document.updated",
  "git.commit",
  "deployment.status_changed",
  "todo.created",
  "todo.completed",
  "project.created",
  "absence.created",
  "absence.approved",
  "absence.deleted",
]);

export const isOrganisationEvent = (eventType: string): boolean =>
  ORGANISATION_EVENTS.has(eventType.trim().toLowerCase());

/** Everything the two streams are built from. Kept as plain data so the rules
 *  below are pure and testable without a backend. */
export type AttentionSources = {
  profileId: string;
  mentions: MentionView[];
  channels: ChannelSummary[];
  threads: UnreadThread[];
  dashboard: Dashboard | null;
  todos: Todo[];
  notifications: Notification[];
  directory: DirectoryFeedEvent[];
  reviewRequests: { review: Review; participant: ReviewParticipant }[];
};

export const emptySources = (profileId = ""): AttentionSources => ({
  profileId,
  mentions: [],
  channels: [],
  threads: [],
  dashboard: null,
  todos: [],
  notifications: [],
  directory: [],
  reviewRequests: [],
});

const trimTitle = (text: string, fallback: string) => {
  const value = text.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 90) : fallback;
};
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

const channelRoute = (channelId: string): Route => ({ view: "Chat", entityType: "channel", entityId: channelId });

/** ── STREAM 1: NEEDS YOU ────────────────────────────────────────────────────
 *  Pure. Newest first. One row per waiting thing; no row appears twice (a
 *  mention and its notification row are the same fact and collapse to one). */
export function buildNeedsYou(sources: AttentionSources): AttentionItem[] {
  const me = sources.profileId;
  if (!me) return [];
  const items: AttentionItem[] = [];

  // 1. Mentions — someone wrote my name.
  const mentionNotificationIds = new Set<string>();
  for (const mention of sources.mentions) {
    if (mention.read) continue;
    mentionNotificationIds.add(mention.notification_id);
    items.push({
      id: `mention:${mention.id}`,
      kind: "mention",
      title: trimTitle(mention.text ?? "", "You were mentioned"),
      detail: mention.channel_name ? `#${mention.channel_name}` : "Direct message",
      at: mention.created_at,
      action: "Reply",
      tone: "teal",
      route: channelRoute(mention.channel_id),
    });
  }

  // 2 + 3. Unread in a channel that is ABOUT me: a DM, or an entity channel I
  //        am in because I am involved in the entity. Public/project channel
  //        noise is deliberately not here.
  for (const channel of sources.channels) {
    if (channel.archived || channel.unread_count <= 0) continue;
    const isDm = channel.content_type === "dm";
    const isEntity = channel.content_type === "entity-bound";
    if (!isDm && !isEntity) continue;
    items.push({
      id: `channel:${channel.id}`,
      kind: isDm ? "dm" : "channel",
      title: channel.name ?? (isDm ? "Direct message" : "Channel"),
      detail: plural(channel.unread_count, "unread message"),
      at: channel.last_message_at ?? 0,
      action: isDm ? "Reply" : "Open",
      tone: isDm ? "amber" : "teal",
      route: channelRoute(channel.id),
      resolve: () => markChannelRead(channel.id, me),
    });
  }

  // 3b. Unread replies in a thread I take part in. The backend has already decided
  //     participation, authorship and visibility; this is presentation only — the row
  //     must SAY what it is, so a person knows why it is on their list.
  for (const thread of sources.threads) {
    const who = thread.last_reply_author ?? "Someone";
    items.push({
      id: `thread:${thread.channel_id}`,
      kind: "thread",
      title: `${who} replied in “${trimTitle(thread.root_excerpt, "your message")}”`,
      detail: `${thread.unread_count} unread ${thread.unread_count === 1 ? "reply" : "replies"} · thread in #${thread.parent_channel_name ?? thread.parent_channel_id}`,
      at: thread.last_reply_at ?? 0,
      action: "Reply",
      tone: "teal",
      // The thread channel's OWN route: Chat decodes it back to the parent plus the
      // open thread panel, so the click lands on the replies, not merely near them.
      route: channelRoute(thread.channel_id),
      resolve: () => markChannelRead(thread.channel_id, me),
    });
  }

  // 4. Todos SOMEBODY ELSE put on me.
  //
  // Not every task of mine belongs in this list. A worklist answers "what is
  // directed at me"; my own to-do list answers "what am I doing" — and Home shows
  // both, side by side, so a task I wrote for myself appeared in the same column
  // twice under two headings. The discriminator is authorship, not assignment: an
  // item enters attention because ANOTHER person aimed it here.
  for (const todo of sources.todos) {
    if (todo.done) continue;
    if (todo.profile_id === me) continue;
    if (!todo.assignee_ids.includes(me)) continue;
    items.push({
      id: `todo:${todo.id}`,
      kind: "todo",
      title: trimTitle(todo.content, "Task"),
      detail: todo.due_date ? `Due ${todo.due_date}` : undefined,
      at: 0,
      action: "Open",
      tone: "",
      route: todo.project_id ? { view: "Project Tasks", projectId: todo.project_id } : { view: "To-Do" },
      anchor:
        todo.source_entity_type && todo.source_entity_id
          ? { entityType: todo.source_entity_type, entityId: todo.source_entity_id }
          : undefined,
    });
  }

  // 5. Tickets assigned to me.
  for (const issue of sources.dashboard?.assigned_issues ?? []) {
    items.push({
      id: `issue:${issue.id}`,
      kind: "issue",
      title: trimTitle(issue.title, "Ticket"),
      detail: issue.due_date ? `Due ${issue.due_date}` : undefined,
      at: 0,
      action: "Open",
      tone: "",
      route: { view: "Issues", entityType: "issue", entityId: issue.id, projectId: issue.project_id },
    });
  }

  // 6. Review requests where the turn is mine.
  for (const { review } of sources.reviewRequests) {
    items.push({
      id: `review:${review.id}`,
      kind: "review",
      title: trimTitle(review.title, "Code review"),
      detail: `Review #${review.number}`,
      at: 0,
      action: "Review",
      tone: "amber",
      route: { view: "Code Reviews", entityType: "review", entityId: review.id },
    });
  }

  // 7. Everything else the notification store addressed to me and I have not read.
  for (const notification of sources.notifications) {
    if (notification.read_at) continue;
    if (isOrganisationEvent(notification.event_type)) continue;
    if (mentionNotificationIds.has(notification.id)) continue;
    items.push({
      id: `notification:${notification.id}`,
      kind: "notification",
      title: trimTitle(notification.title, "Notification"),
      detail: notification.body ?? undefined,
      at: notification.created_at,
      action: "Mark read",
      tone: "teal",
      route: routeForAnchor(notification.entity_type, notification.entity_id) ?? { view: "Inbox" },
      resolve: () => personalApi.markRead(notification.id),
    });
  }

  return items.sort((a, b) => b.at - a.at);
}

/** The count, and the ONLY count. The rail badge, Home and the Inbox header all
 *  read this, so they cannot disagree again. */
export const countNeedsYou = (sources: AttentionSources): number => buildNeedsYou(sources).length;

/** ── READING A CHANNEL, APPLIED TO THE SNAPSHOT ─────────────────────────────
 *
 *  THE DEFECT: opening a channel called `mark_channel_read` and refetched ONLY
 *  the caller's own channel list. Every other surface — the rail's Chats badge
 *  (its own resource), the channel row, Home — kept the stale snapshot, so the
 *  badge stayed at 1 until a full reload. The write was fine; the READERS were
 *  stale.
 *
 *  So the fact "this channel is read now" is applied to THE snapshot, purely and
 *  in one place, and every surface that reads `attentionSources()` becomes
 *  correct in the same tick. The server refetch that follows confirms it; it is
 *  no longer what makes the badge move.
 *
 *  Reading a channel clears, for that channel id:
 *    - its unread_count (the Chats badge and the channel row's own badge)
 *    - the unread thread rows that ARE that channel
 *    - mentions of me inside it (they are read once I have read the channel)
 *  It does NOT touch todos/issues/reviews: those are work, not unread text. */
export function applyChannelRead(sources: AttentionSources, channelId: string): AttentionSources {
  if (!channelId) return sources;
  return {
    ...sources,
    channels: sources.channels.map((channel) =>
      channel.id === channelId && channel.unread_count > 0 ? { ...channel, unread_count: 0 } : channel,
    ),
    threads: sources.threads.filter((thread) => thread.channel_id !== channelId),
    mentions: sources.mentions.map((mention) =>
      mention.channel_id === channelId && !mention.read ? { ...mention, read: true } : mention,
    ),
  };
}

/** The unread CONVERSATION total — the rail's "Chats" badge. It lived inline in
 *  SpaceShell, which is why it could disagree with everything else; it is the
 *  same sum, computed once, from the same snapshot. */
export const unreadChannelTotal = (channels: ChannelSummary[]): number =>
  channels.reduce((sum, channel) => sum + (channel.archived ? 0 : Math.max(0, channel.unread_count || 0)), 0);

const ROUTE_BY_ENTITY: Record<string, string> = {
  project: "Projects",
  issue: "Issues",
  channel: "Chat",
  document: "Documents",
  blog: "Blogs",
  meeting: "Meetings",
  profile: "Members",
  review: "Code Reviews",
  absence: "Time off",
  todo: "To-Do",
};

/** An anchor becomes a link only when the grammar knows the entity; otherwise
 *  the row stays a statement of fact rather than a dead link. */
export function routeForAnchor(entityType: string | null, entityId: string | null): Route | undefined {
  if (!entityType || !entityId) return undefined;
  // Message ids have no standalone route grammar; Chat is the safe real surface.
  if (entityType === "message") return { view: "Chat" };
  const view = ROUTE_BY_ENTITY[entityType];
  return view ? { view, entityType, entityId } : undefined;
}

/** ── STREAM 2: ORGANISATION ─────────────────────────────────────────────────
 *  Pure. Never counted, never cleared, newest first. */
const ACTIVITY_VERBS: Record<string, { verb: string; object: (n: Notification) => string }> = {
  "issue.created": { verb: "opened a ticket", object: (n) => n.title },
  "issue.updated": { verb: "updated a ticket", object: (n) => n.title },
  "issue.archived": { verb: "closed a ticket", object: (n) => n.title },
  "review.created": { verb: "opened a review", object: (n) => n.title },
  "review.updated": { verb: "updated a review", object: (n) => n.title },
  "review.merged": { verb: "merged a review", object: (n) => n.title },
  "review.participant_updated": { verb: "changed review participants", object: (n) => n.title },
  "review.discussion_created": { verb: "started a review discussion", object: (n) => n.title },
  "review.discussion_updated": { verb: "resolved a review discussion", object: (n) => n.title },
  "review.suggestion_updated": { verb: "acted on a suggestion", object: (n) => n.title },
  "document.updated": { verb: "published a document", object: (n) => n.title },
  "git.commit": { verb: "pushed a commit", object: (n) => n.title },
  "deployment.status_changed": { verb: "changed a deployment", object: (n) => n.title },
  "todo.created": { verb: "created a task", object: (n) => n.title },
  "todo.completed": { verb: "completed a task", object: (n) => n.title },
  "project.created": { verb: "created a project", object: (n) => n.title },
  "absence.created": { verb: "booked time off", object: (n) => n.title },
  "absence.approved": { verb: "had time off approved", object: (n) => n.title },
  "absence.deleted": { verb: "removed time off", object: (n) => n.title },
};

const DIRECTORY_VERBS: Record<string, string> = {
  "member.joined": "joined the organisation",
  "member.left": "left the organisation",
  "team.joined": "joined a team",
  "team.left": "left a team",
  "role.changed": "changed role",
};

/** THE ACTOR CONVENTION (mirrored in `src-tauri/src/events.rs::actor_body`):
 *  the notification store has no actor column, so an emitter that knows who
 *  acted writes `by <name>` or `by <name> · <context>` into the body. Anything
 *  else is left alone — a name is read, never guessed out of free text. */
export function readActor(body: string | null): { actor?: string; detail?: string } {
  const match = /^by ([^·]+?)(?:\s·\s(.*))?$/.exec((body ?? "").trim());
  if (!match) return { detail: body ?? undefined };
  return { actor: match[1].trim(), detail: match[2]?.trim() || undefined };
}

export function buildOrganisation(sources: AttentionSources): OrganisationEvent[] {
  const events: OrganisationEvent[] = [];

  for (const notification of sources.notifications) {
    const type = notification.event_type.trim().toLowerCase();
    const shape = ACTIVITY_VERBS[type];
    if (!shape) continue;
    const { actor, detail } = readActor(notification.body);
    events.push({
      id: `activity:${notification.id}`,
      at: notification.created_at,
      // "Someone" is the honest answer when the emitter recorded no actor.
      actor: actor ?? "Someone",
      verb: shape.verb,
      object: trimTitle(shape.object(notification), type),
      detail,
      route: routeForAnchor(notification.entity_type, notification.entity_id),
      anchor:
        notification.entity_type && notification.entity_id
          ? { entityType: notification.entity_type, entityId: notification.entity_id }
          : undefined,
    });
  }

  for (const event of sources.directory) {
    events.push({
      id: `directory:${event.id}`,
      at: event.created_at,
      actor: event.profile_name,
      verb: DIRECTORY_VERBS[event.event_type] ?? event.event_type,
      object: event.team_name ?? event.role_name ?? "",
      detail: event.team_name && event.role_name ? `as ${event.role_name}` : undefined,
      route: { view: "Members", entityType: "profile", entityId: event.profile_id },
    });
  }

  return events.sort((a, b) => b.at - a.at);
}

/** ── LOADING ────────────────────────────────────────────────────────────────
 *  One fetch of every source. A source that fails degrades to empty rather than
 *  blanking the whole worklist: a dead review backend must not hide a mention. */
const settled = async <T,>(work: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work;
  } catch {
    return fallback;
  }
};

/** Open reviews whose turn is mine. Bounded: the worklist is a worklist, not a
 *  report, so it inspects the newest open reviews only. */
const REVIEW_SCAN_LIMIT = 25;
async function loadReviewRequests(profileId: string) {
  const reviews = await settled(reviewApi.list(), [] as Review[]);
  const open = reviews.filter((review) => review.state !== "Merged" && review.state !== "Closed").slice(0, REVIEW_SCAN_LIMIT);
  const found: { review: Review; participant: ReviewParticipant }[] = [];
  for (const review of open) {
    const participants = await settled(reviewApi.listParticipants(review.id), [] as ReviewParticipant[]);
    const mine = participants.find(
      (participant) => participant.profile_id === profileId && participant.role === "Reviewer",
    );
    // "Requested" means the ball is in my court: my turn, or no verdict yet.
    if (mine && (mine.their_turn || mine.state === null || mine.state === "waiting")) {
      found.push({ review, participant: mine });
    }
  }
  return found;
}

export async function loadAttention(profileId: string): Promise<AttentionSources> {
  if (!profileId) return emptySources("");
  const [mentions, channels, threads, dashboard, todos, notifications, directory, reviewRequests] = await Promise.all([
    settled(chatApi.listMentionsForProfile(profileId, true), [] as MentionView[]),
    settled(chatApi.listChannelsWithMeta(profileId), [] as ChannelSummary[]),
    settled(chatApi.listUnreadThreads(profileId), [] as UnreadThread[]),
    settled<Dashboard | null>(personalApi.dashboard(profileId), null),
    settled(personalApi.todos(profileId), [] as Todo[]),
    settled(personalApi.notifications(profileId), [] as Notification[]),
    settled(platformApi.directoryFeed(50), [] as DirectoryFeedEvent[]),
    loadReviewRequests(profileId),
  ]);
  return { profileId, mentions, channels, threads, dashboard, todos, notifications, directory, reviewRequests };
}

/** ── THE LIVE SINGLETON ─────────────────────────────────────────────────────
 *  One resource for the whole app: the rail badge, Home and the Inbox read the
 *  SAME snapshot, so a disagreement is not merely discouraged, it is impossible.
 *  Identity comes from the session, so a consumer needs no wiring at all: it
 *  imports one accessor and is correct. `setAttentionProfile` exists for tests
 *  and for a surface that must pin an identity explicitly. */
const store = createRoot(() => {
  const [override, setOverride] = createSignal<string | null>(null);
  const profile = () => override() ?? profileId();
  const [sources, { refetch, mutate }] = createResource(profile, loadAttention, {
    initialValue: emptySources(""),
  });
  return { profile, setOverride, sources, refetch, mutate };
});

/** Pin the identity attention reads (tests, or a surface acting as someone). */
export const setAttentionProfile = (value: string) => {
  store.setOverride(value);
};
export const attentionProfile = store.profile;
/** Raw snapshot, for surfaces that need both streams from one read. */
export const attentionSources = (): AttentionSources => store.sources() ?? emptySources(store.profile());
export const attentionLoading = () => store.sources.loading;
/** THE worklist. */
export const needsYou = (): AttentionItem[] => buildNeedsYou(attentionSources());
/** THE feed. */
export const organisation = (): OrganisationEvent[] => buildOrganisation(attentionSources());
/** THE count — worklist only, never the feed. */
export const attentionCount = (): number => needsYou().length;
/** Re-read every source (after resolving an item, or on a chat event). */
export const refreshAttention = async () => {
  await store.refetch();
};
/** Mark a channel read: write it, apply it to the shared snapshot at once (so
 *  every badge drops in the same tick), then confirm against the backend.
 *  THE one entry point — a surface must never call `chatApi.markChannelRead`
 *  directly, or it goes back to updating only itself. */
export const markChannelRead = async (channelId: string, profileId: string): Promise<void> => {
  if (!channelId || !profileId) return;
  store.mutate((current) => applyChannelRead(current ?? emptySources(profileId), channelId));
  try {
    await chatApi.markChannelRead(channelId, profileId);
  } finally {
    await refreshAttention();
  }
};

/** Resolve one worklist item where it stands, then re-read. */
export const resolveAttentionItem = async (item: AttentionItem) => {
  if (!item.resolve) return;
  await item.resolve();
  await refreshAttention();
};
