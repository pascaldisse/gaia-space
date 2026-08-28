import { createMemo, createSignal, For, Show } from "solid-js";
import { personalApi, type Notification } from "../api/personal";
import { Icon, type IconName } from "../components/Icon";
import PageHeader, { Chip } from "../components/PageHeader";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import SourceLink from "../components/SourceLink";
import { Disclosure, SectionHeading } from "../components/blocks";
import { linkProps, navigate, route } from "../router";
import { humanError, profileId } from "../session";
import { UI_LOCALE } from "../calendar";
import {
  ACTIVITY_FILTERS,
  asActivityFilter,
  attentionCount,
  attentionLoading,
  attentionSources,
  filterAttention,
  isOrganisationEvent,
  needsYou,
  organisation,
  refreshAttention,
  type ActivityFilter,
  type AttentionItem,
  type AttentionKind,
  type OrganisationEvent,
} from "../attention";
import "./Inbox.css";

// ── THE ACTIVITY VIEW ───────────────────────────────────────────────────────
// Two streams, never mixed, and NEITHER of them computed here:
//
//   NEEDS YOU     — the worklist. It empties, it carries the count, its rows
//                   can be resolved where they stand.
//   ORGANISATION  — the feed. It never empties, it carries NO count, it is read
//                   rather than cleared.
//
// Every number and every row comes from `src/attention.ts`. This file must never
// grow a rule of its own — that is exactly the defect (a rail badge saying 2
// while Home said nothing) the module exists to prevent.

type Category = { key: string; label: string; icon: IconName; tone: string };

/** The worklist's own filter axis: what KIND of thing is waiting, not which
 *  backend delivered it. */
const KINDS: Record<AttentionKind, Category> = {
  mention: { key: "mention", label: "Mentions", icon: "chat", tone: "mention" },
  dm: { key: "dm", label: "Direct messages", icon: "chat", tone: "mention" },
  channel: { key: "channel", label: "Channels", icon: "chat", tone: "mention" },
  thread: { key: "thread", label: "Threads", icon: "chat", tone: "mention" },
  todo: { key: "todo", label: "Tasks", icon: "check", tone: "issue" },
  issue: { key: "issue", label: "Tickets", icon: "check", tone: "issue" },
  review: { key: "review", label: "Code reviews", icon: "review", tone: "review" },
  notification: { key: "notification", label: "Updates", icon: "inbox", tone: "updates" },
};

/** The filter row is the SAME set the Activity sidebar lists, and it lives in the
 *  ROUTE (`/inbox/<filter>`), not in a signal here: the sidebar can highlight it, a
 *  deep link arrives filtered, back/forward stay honest. Meaning (filter -> kinds)
 *  belongs to attention.ts; only the icon is presentation. */
const FILTER_ICON: Record<ActivityFilter, IconName> = {
  all: "inbox", mentions: "chat", messages: "chat", assigned: "check", reviews: "review", updates: "inbox",
};

/** Icons for the organisation feed, by event domain. News is not work, so it
 *  never borrows the worklist's accent tones. */
const FEED_ICON = (verb: string): IconName =>
  verb.includes("review") ? "review"
  : verb.includes("ticket") ? "check"
  : verb.includes("task") ? "check"
  : verb.includes("document") ? "book"
  : verb.includes("project") ? "layers"
  : verb.includes("commit") || verb.includes("deployment") ? "pipeline"
  : "user";

// Relative in the feed, absolute on hover — the exact moment stays one tooltip away.
const relativeTime = (seconds: number) => {
  if (!seconds) return "";
  const elapsed = Math.floor(Date.now() / 1000) - seconds;
  if (elapsed < 45) return "just now";
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(seconds * 1000).toLocaleDateString(UI_LOCALE, { month: "short", day: "numeric" });
};
const timestamp = (seconds: number) => (seconds ? new Date(seconds * 1000).toLocaleString(UI_LOCALE) : "");

export default function Inbox() {
  const [error, setError] = createSignal("");

  /** THE filter: read from the route, unknown degrades to All. */
  const filter = createMemo<ActivityFilter>(() => asActivityFilter(route().view === "Inbox" ? route().tab : undefined));
  const showFilter = (next: ActivityFilter) =>
    navigate(next === "all" ? { view: "Inbox" } : { view: "Inbox", tab: next });

  const worklist = createMemo(() => needsYou());
  const feed = createMemo(() => organisation());
  const visible = createMemo(() => filterAttention(worklist(), filter()));
  const selectedFilter = createMemo(() => ACTIVITY_FILTERS.find((entry) => entry.id === filter()) ?? ACTIVITY_FILTERS[0]);
  const worklistTitle = () => filter() === "all" ? "Needs you" : selectedFilter().label;
  const worklistMeta = () => filter() === "all"
    ? (attentionCount() ? `${attentionCount()} waiting` : "nothing waiting")
    : (visible().length ? `${visible().length} waiting` : "nothing waiting");

  /** Every filter with its own count, from the one source. A filter with nothing in
   *  it right now is still offered while it is the active one — otherwise the pill
   *  you just clicked would vanish under you. */
  const filterTally = createMemo(() =>
    ACTIVITY_FILTERS.map((entry) => ({ ...entry, count: filterAttention(worklist(), entry.id).length })).filter(
      (entry) => entry.id === "all" || entry.count > 0 || entry.id === filter(),
    ),
  );

  /** The notification store, read straight from the shared snapshot: this view
   *  keeps its archive and its subscription editor without a second fetch. */
  const notifications = (): Notification[] => attentionSources().notifications;
  const unreadNotifications = createMemo(() => notifications().filter((item) => !item.read_at));
  /** Read personal notifications: not work any more, and not organisation news
   *  either. Kept, collapsed, so nothing that used to be reachable is lost. */
  const earlier = createMemo(() =>
    notifications().filter((item) => item.read_at && !isOrganisationEvent(item.event_type)),
  );

  const guard = async (work: () => Promise<unknown>) => {
    try {
      setError("");
      await work();
      await refreshAttention();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const resolve = (item: AttentionItem) => guard(() => item.resolve!());
  const markAllRead = () => guard(() => Promise.all(unreadNotifications().map((item) => personalApi.markRead(item.id))));

  // ── A worklist row: what it is, where it lives, and how to be rid of it.
  const workRow = (item: AttentionItem) => {
    const category = KINDS[item.kind];
    return (
      <li class="unread">
        <span class="inbox-ic" classList={{ [category.tone]: true }} aria-hidden="true">
          <Icon name={category.icon} size={16} />
        </span>
        <div class="inbox-body">
          <div class="inbox-line">
            <span class="inbox-dot" role="img" aria-label="Waiting for you" />
            <strong>{item.title}</strong>
          </div>
          <Show when={item.detail}>
            <p>{item.detail}</p>
          </Show>
          <div class="inbox-meta">
            <span class="inbox-chip" classList={{ [category.tone]: true }}>
              {category.label}
            </span>
            <Show when={item.at}>
              <time title={timestamp(item.at)}>{relativeTime(item.at)}</time>
            </Show>
            {/* A task raised in a channel leads back to the message that raised it. */}
            <Show when={item.anchor}>
              {(anchor) => <SourceLink entityType={anchor().entityType} entityId={anchor().entityId} />}
            </Show>
          </div>
        </div>
        <div class="inbox-row-actions">
          <a class="ghost inbox-open" {...linkProps(item.route)} title="Open the related item">
            {item.action}
          </a>
          <Show when={item.resolve}>
            <button class="ghost" onClick={() => resolve(item)} title="Clear this from your list">
              Clear
            </button>
          </Show>
        </div>
      </li>
    );
  };

  // ── A feed row: actor, verb, object, and a way back to the object.
  const feedRow = (event: OrganisationEvent) => (
    <li class="inbox-feed-row">
      <span class="inbox-ic" aria-hidden="true">
        <Icon name={FEED_ICON(event.verb)} size={16} />
      </span>
      <div class="inbox-body">
        <div class="inbox-line">
          <strong>{event.actor}</strong> <span class="inbox-verb">{event.verb}</span>
          <Show when={event.object}>
            {" "}
            <Show when={event.route} fallback={<span class="inbox-object">{event.object}</span>}>
              <a class="inbox-object" {...linkProps(event.route!)}>
                {event.object}
              </a>
            </Show>
          </Show>
        </div>
        <div class="inbox-meta">
          <Show when={event.detail}>
            <span class="inbox-feed-detail">{event.detail}</span>
          </Show>
          <time title={timestamp(event.at)}>{relativeTime(event.at)}</time>
        </div>
      </div>
    </li>
  );

  return (
    <section class="inbox-view">
      <PageHeader
        icon="inbox"
        title="Inbox"
        subline="What is waiting for you, and what the organisation has been doing"
        chips={
          <Show when={attentionCount()}>
            <Chip value={attentionCount()} label="needs you" />
          </Show>
        }
        actions={
          <Show when={unreadNotifications().length}>
            <button class="primary" onClick={markAllRead}>
              Mark all read
            </button>
          </Show>
        }
      />

      <Show when={error()}>
        <p class="inbox-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!profileId()}>
        <EmptyState
          icon={<Icon name="user" size={18} />}
          title="No profile is active"
          hint="Pick who you're acting as in the account menu at the bottom of the sidebar — or add a profile in Organization."
          actions={<a class="primary" {...linkProps({ view: "Members" })}>Open Organization</a>}
        />
      </Show>

      <Show when={profileId()}>
        <Show when={attentionLoading() && !worklist().length && !feed().length}>
          <p class="inbox-muted">Loading your inbox…</p>
        </Show>

        <div class="inbox-main">
            {/* ── STREAM 1 ── the worklist, first, with the count. */}
            <section class="inbox-needs" aria-label="Needs you">
              <SectionHeading
                title={worklistTitle()}
                meta={worklistMeta()}
              />
              <Show when={filterTally().length > 1}>
                <div class="inbox-filters">
                  <div class="inbox-cats" role="navigation" aria-label="Worklist filters">
                    <For each={filterTally()}>
                      {(entry) => (
                        <button
                          data-filter={entry.id}
                          classList={{ on: filter() === entry.id }}
                          aria-pressed={filter() === entry.id}
                          onClick={() => showFilter(entry.id)}
                        >
                          <Icon name={FILTER_ICON[entry.id]} size={13} />
                          {entry.label}
                          <em classList={{ zero: entry.count === 0 }}>{entry.count}</em>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <Show
                when={visible().length}
                fallback={
                  /* An empty worklist is GOOD NEWS, and a person looking at good
                     news wants nothing done to them: one quiet line, no
                     onboarding, no button that leaves the page. A filter that
                     hides everything is a different fact and can be cleared. */
                  <Show
                    when={filter() !== "all"}
                    fallback={
                      <div class="inbox-clear">
                        <span class="inbox-clear-ic">
                          <Icon name="check" size={16} />
                        </span>
                        <p>You're all caught up — nothing needs you right now.</p>
                      </div>
                    }
                  >
                    <EmptyState
                      variant="no-match"
                      title="This filter matches nothing."
                      hint="Other things may still be waiting for you."
                      actions={<GhostPill onClick={() => showFilter("all")}>Show all</GhostPill>}
                    />
                  </Show>
                }
              >
                <ul class="inbox-list">
                  <For each={visible()}>{workRow}</For>
                </ul>
              </Show>
            </section>

            {/* Organisation news belongs to the complete Inbox. A filtered worklist
                must not repeat this unchanged feed below every distinct filter. */}
            <Show when={filter() === "all"}>
              <section class="inbox-org" aria-label="Organisation">
                <SectionHeading title="Organisation" meta="What your colleagues did" />
                <Show
                  when={feed().length}
                  fallback={<p class="inbox-muted">No organisation activity yet.</p>}
                >
                  <ul class="inbox-list inbox-feed">
                    <For each={feed()}>{feedRow}</For>
                  </ul>
                </Show>
              </section>
            </Show>

            <Show when={filter() === "all" && earlier().length}>
              <Disclosure class="inbox-earlier" title="Earlier notifications" meta={`${earlier().length} read`}>
                <ul class="inbox-list">
                  <For each={earlier()}>
                    {(item) => (
                      <li>
                        <span class="inbox-ic" aria-hidden="true">
                          <Icon name="inbox" size={16} />
                        </span>
                        <div class="inbox-body">
                          <div class="inbox-line">
                            <strong>{item.title}</strong>
                          </div>
                          <Show when={item.body}>
                            <p>{item.body}</p>
                          </Show>
                          <div class="inbox-meta">
                            <span class="inbox-action">{item.event_type}</span>
                            <time title={timestamp(item.created_at)}>{relativeTime(item.created_at)}</time>
                          </div>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Disclosure>
            </Show>
        </div>
      </Show>
    </section>
  );
}
