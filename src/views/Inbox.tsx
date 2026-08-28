import { createMemo, createSignal, For, Show } from "solid-js";
import { personalApi, type Notification, type SubscriptionScope, type SubscriptionSetting } from "../api/personal";
import { createResource } from "solid-js";
import { Icon, type IconName } from "../components/Icon";
import PageHeader, { Chip } from "../components/PageHeader";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import SourceLink from "../components/SourceLink";
import { Disclosure, MetricGrid, MetricTile, SectionHeading } from "../components/blocks";
import { linkProps } from "../router";
import { humanError, profileId } from "../session";
import { UI_LOCALE } from "../calendar";
import {
  attentionCount,
  attentionLoading,
  attentionSources,
  isOrganisationEvent,
  needsYou,
  organisation,
  refreshAttention,
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
  todo: { key: "todo", label: "Tasks", icon: "check", tone: "issue" },
  issue: { key: "issue", label: "Tickets", icon: "check", tone: "issue" },
  review: { key: "review", label: "Code reviews", icon: "review", tone: "review" },
  notification: { key: "notification", label: "Updates", icon: "inbox", tone: "updates" },
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
  const [kind, setKind] = createSignal<"all" | AttentionKind>("all");
  const [error, setError] = createSignal("");

  const worklist = createMemo(() => needsYou());
  const feed = createMemo(() => organisation());
  const visible = createMemo(() => worklist().filter((item) => kind() === "all" || item.kind === kind()));

  /** The kinds actually present become filters — nothing else. */
  const kindTally = createMemo(() => {
    const tally = new Map<AttentionKind, number>();
    for (const item of worklist()) tally.set(item.kind, (tally.get(item.kind) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  });

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

  // ── Subscriptions: unchanged behaviour, still the rail's second card.
  const [settings, { refetch: refetchSettings }] = createResource(profileId, (id) =>
    id ? personalApi.subscriptions(id) : Promise.resolve([] as SubscriptionSetting[]),
  );
  const [scopes, { refetch: refetchScopes }] = createResource(profileId, (id) =>
    id ? personalApi.subscriptionScopes(id) : Promise.resolve([] as SubscriptionScope[]),
  );
  const eventTypes = createMemo(() => {
    const seen = new Set<string>(notifications().map((item) => item.event_type));
    for (const setting of settings() ?? []) seen.add(setting.event_type);
    return [...seen].sort();
  });
  const settingFor = (eventType: string) => (settings() ?? []).find((entry) => entry.event_type === eventType);
  const toggleSetting = async (eventType: string) => {
    const id = profileId();
    if (!id) return;
    try {
      setError("");
      await personalApi.saveSubscription({
        profile_id: id,
        event_type: eventType,
        enabled: !(settingFor(eventType)?.enabled ?? true),
      });
      await refetchSettings();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const toggleScope = async (scope: SubscriptionScope) => {
    try {
      setError("");
      await personalApi.saveSubscriptionScope({ ...scope, enabled: !scope.enabled });
      await refetchScopes();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const removeScope = async (scope: SubscriptionScope) => {
    try {
      setError("");
      await personalApi.deleteSubscriptionScope(scope);
      await refetchScopes();
    } catch (reason) {
      setError(humanError(reason));
    }
  };

  const subscriptionsCard = () => (
    <div class="rail-card">
      <h3>
        <Icon name="inbox" size={13} /> Subscriptions
      </h3>
      <div class="rail-rows">
        <For each={eventTypes()}>
          {(eventType) => (
            <button
              class="rail-row"
              classList={{ muted: settingFor(eventType)?.enabled === false }}
              aria-pressed={settingFor(eventType)?.enabled !== false}
              title="Turn this event type on or off for your feed"
              onClick={() => toggleSetting(eventType)}
            >
              <span class="rail-row-label">{eventType}</span>
              <span class="rail-row-val">{settingFor(eventType)?.enabled === false ? "Muted" : "On"}</span>
            </button>
          )}
        </For>
        <Show when={!eventTypes().length}>
          <p class="rail-empty">No event types yet — subscriptions appear as events arrive.</p>
        </Show>
      </div>
      <Show when={(scopes() ?? []).length}>
        <h3>Scoped</h3>
        <div class="rail-rows">
          <For each={scopes() ?? []}>
            {(scope) => (
              <div class="rail-row">
                <span class="rail-row-label">
                  {scope.event_type} · {scope.target_type}:{scope.target_id}
                </span>
                <button class="ghost" onClick={() => toggleScope(scope)}>
                  {scope.enabled ? "On" : "Muted"}
                </button>
                <button class="ghost" onClick={() => removeScope(scope)} title="Remove this scope">
                  Remove
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );

  const summaryCard = () => (
    <div class="rail-card">
      <h3>
        <Icon name="inbox" size={13} /> At a glance
      </h3>
      {/* ONE COUNT, and it is `attentionCount()`. The second tile counts news,
          and news is never a claim on anyone — hence no tone, ever. */}
      <MetricGrid label="Inbox at a glance" class="pairs">
        <MetricTile value={attentionCount()} label="Needs you" tone="teal" />
        <MetricTile value={feed().length} label="Organisation" />
      </MetricGrid>
      <Show when={unreadNotifications().length}>
        <div class="rail-actions">
          <button class="primary" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
      </Show>
    </div>
  );

  return (
    <section class="inbox-view">
      <PageHeader
        title="Inbox"
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

        <div class="view-cols inbox-cols">
          <div class="view-main">
            {/* ── STREAM 1 ── the worklist, first, with the count. */}
            <section class="inbox-needs" aria-label="Needs you">
              <SectionHeading
                title="Needs you"
                meta={attentionCount() ? `${attentionCount()} waiting` : "nothing waiting"}
              />
              <Show when={kindTally().length > 1}>
                <div class="inbox-filters">
                  <div class="inbox-cats">
                    <button classList={{ on: kind() === "all" }} aria-pressed={kind() === "all"} onClick={() => setKind("all")}>
                      All<em>{worklist().length}</em>
                    </button>
                    <For each={kindTally()}>
                      {([entry, count]) => (
                        <button
                          classList={{ on: kind() === entry }}
                          aria-pressed={kind() === entry}
                          onClick={() => setKind(kind() === entry ? "all" : entry)}
                        >
                          <Icon name={KINDS[entry].icon} size={13} />
                          {KINDS[entry].label}
                          <em>{count}</em>
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
                    when={kind() !== "all"}
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
                      title="Nothing of that kind is waiting."
                      actions={<GhostPill onClick={() => setKind("all")}>Clear filter</GhostPill>}
                    />
                  </Show>
                }
              >
                <ul class="inbox-list">
                  <For each={visible()}>{workRow}</For>
                </ul>
              </Show>
            </section>

            {/* ── STREAM 2 ── the feed. No count, no clearing, never merged above. */}
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

            <Show when={earlier().length}>
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

          <aside class="view-rail inbox-rail">
            {summaryCard()}
            {subscriptionsCard()}
          </aside>
        </div>
      </Show>
    </section>
  );
}
