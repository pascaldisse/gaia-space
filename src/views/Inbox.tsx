import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  personalApi,
  type Notification,
  type SubscriptionScope,
  type SubscriptionSetting,
} from "../api/personal";
import { Icon, type IconName } from "../components/Icon";
import { ProfilePicker } from "../components/Pickers";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { entityView, linkProps } from "../router";
import { humanError, profileId } from "../session";
import "./Inbox.css";

// Inbox — the human notification feed for the active profile. Same store the
// Overview summarises, surfaced as a first-class destination: read/unread
// hierarchy, category filters, and every row deep-linked to a real URL.

type Scope = "all" | "unread";
type Category = { key: string; label: string; icon: IconName; tone: string };

// Event types follow a `domain.action` convention, so the domain gives a
// stable, data-driven grouping. Unknown domains fall back to "Updates".
const CATEGORIES: Record<string, Category> = {
  mention: { key: "mention", label: "Mentions", icon: "chat", tone: "mention" },
  message: { key: "message", label: "Messages", icon: "chat", tone: "mention" },
  chat: { key: "chat", label: "Messages", icon: "chat", tone: "mention" },
  comment: { key: "comment", label: "Comments", icon: "chat", tone: "mention" },
  issue: { key: "issue", label: "Issues", icon: "check", tone: "issue" },
  task: { key: "task", label: "Tasks", icon: "check", tone: "issue" },
  todo: { key: "todo", label: "Tasks", icon: "check", tone: "issue" },
  review: { key: "review", label: "Code reviews", icon: "review", tone: "review" },
  pipeline: { key: "pipeline", label: "Pipelines", icon: "pipeline", tone: "review" },
  meeting: { key: "meeting", label: "Meetings", icon: "clock", tone: "meeting" },
  calendar: { key: "calendar", label: "Calendar", icon: "calendar", tone: "meeting" },
  absence: { key: "absence", label: "Time off", icon: "clock", tone: "absence" },
  project: { key: "project", label: "Projects", icon: "layers", tone: "project" },
  document: { key: "document", label: "Knowledge", icon: "book", tone: "doc" },
  doc: { key: "doc", label: "Knowledge", icon: "book", tone: "doc" },
};
const UPDATES: Category = { key: "updates", label: "Updates", icon: "inbox", tone: "updates" };

const categoryOf = (item: Notification): Category => {
  const [domain] = item.event_type.split(".");
  return CATEGORIES[(domain || item.event_type).toLowerCase()] ?? UPDATES;
};

// "issue.assigned" → "Assigned"; a bare event type keeps a neutral label.
const actionLabel = (eventType: string) => {
  const tail = eventType.split(".").slice(1).join(" ").replace(/[_-]+/g, " ").trim();
  return tail ? tail[0].toUpperCase() + tail.slice(1) : "Update";
};

// Relative in the feed, absolute on hover — the exact moment stays one tooltip away.
const relativeTime = (seconds: number) => {
  const elapsed = Math.floor(Date.now() / 1000) - seconds;
  if (elapsed < 45) return "just now";
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const timestamp = (seconds: number) => new Date(seconds * 1000).toLocaleString();

// Best-effort routing from the anchored entity to the view that owns it, using
// the app's existing registry — every link lands on a real URL.
const relatedRoute = (item: Notification) =>
  item.entity_type && item.entity_id && entityView(item.entity_type)
    ? { view: entityView(item.entity_type)!, entityType: item.entity_type, entityId: item.entity_id }
    : undefined;

export default function Inbox() {
  const [scope, setScope] = createSignal<Scope>("all");
  const [category, setCategory] = createSignal("all");
  const [error, setError] = createSignal("");
  const [notifications, { refetch }] = createResource(profileId, (id) =>
    id ? personalApi.notifications(id) : Promise.resolve([] as Notification[]),
  );

  const everything = () => notifications() ?? [];
  const unreadAll = createMemo(() => everything().filter((item) => !item.read_at));

  // Only categories actually present in the feed become filters.
  const categories = createMemo(() => {
    const tally = new Map<string, { category: Category; count: number }>();
    for (const item of everything()) {
      const category = categoryOf(item);
      const entry = tally.get(category.key) ?? { category, count: 0 };
      entry.count += 1;
      tally.set(category.key, entry);
    }
    return [...tally.values()].sort((a, b) => b.count - a.count);
  });

  const visible = createMemo(() =>
    everything().filter(
      (item) =>
        (scope() === "all" || !item.read_at) &&
        (category() === "all" || categoryOf(item).key === category()),
    ),
  );
  const unread = createMemo(() => visible().filter((item) => !item.read_at));
  const earlier = createMemo(() => visible().filter((item) => item.read_at));

  const markRead = async (id: string) => {
    try {
      setError("");
      await personalApi.markRead(id);
      await refetch();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const markAllRead = async () => {
    try {
      setError("");
      await Promise.all(unreadAll().map((item) => personalApi.markRead(item.id)));
      await refetch();
    } catch (reason) {
      setError(humanError(reason));
    }
  };

  const row = (item: Notification) => {
    const category = categoryOf(item);
    const route = relatedRoute(item);
    const isUnread = !item.read_at;
    return (
      <li classList={{ unread: isUnread }}>
        <span class="inbox-ic" classList={{ [category.tone]: true }} aria-hidden="true">
          <Icon name={category.icon} size={16} />
        </span>
        <div class="inbox-body">
          <div class="inbox-line">
            <Show when={isUnread}>
              <span class="inbox-dot" role="img" aria-label="Unread" />
            </Show>
            <strong>{item.title}</strong>
          </div>
          <Show when={item.body}>
            <p>{item.body}</p>
          </Show>
          <div class="inbox-meta">
            <span class="inbox-chip" classList={{ [category.tone]: true }}>
              {category.label}
            </span>
            <span class="inbox-action">{actionLabel(item.event_type)}</span>
            <time title={timestamp(item.created_at)}>{relativeTime(item.created_at)}</time>
          </div>
        </div>
        <div class="inbox-row-actions">
          <Show when={route}>
            <a class="ghost inbox-open" {...linkProps(route!)} title="Open the related item">
              Open
            </a>
          </Show>
          <Show when={isUnread}>
            <button class="ghost" onClick={() => markRead(item.id)} title="Mark this notification as read">
              Mark read
            </button>
          </Show>
        </div>
      </li>
    );
  };

  // Subscription editor: per-event delivery plus scoped (project/team/…) overrides.
  const [settings, { refetch: refetchSettings }] = createResource(profileId, (id) =>
    id ? personalApi.subscriptions(id) : Promise.resolve([] as SubscriptionSetting[]),
  );
  const [scopes, { refetch: refetchScopes }] = createResource(profileId, (id) =>
    id ? personalApi.subscriptionScopes(id) : Promise.resolve([] as SubscriptionScope[]),
  );
  // Event types seen in the feed, merged with the ones already configured.
  const eventTypes = createMemo(() => {
    const seen = new Set<string>(everything().map((item) => item.event_type));
    for (const setting of settings() ?? []) seen.add(setting.event_type);
    return [...seen].sort();
  });
  const settingFor = (eventType: string) =>
    (settings() ?? []).find((entry) => entry.event_type === eventType);
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
              <span class="rail-row-val">
                {settingFor(eventType)?.enabled === false ? "Muted" : "On"}
              </span>
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
        <Icon name="inbox" size={13} /> Inbox summary
      </h3>
      <div class="rail-metrics">
        <div class="rail-metric accent">
          <span class="rail-num">{unreadAll().length}</span>
          <span class="rail-lbl">Unread</span>
        </div>
        <div class="rail-metric">
          <span class="rail-num">{everything().length}</span>
          <span class="rail-lbl">Total</span>
        </div>
      </div>
      <Show when={unreadAll().length}>
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
      <WorkspaceHeader
        icon="inbox"
        title="Inbox"
        actions={
          <>
            <ProfilePicker identity />
            <Show when={unreadAll().length}>
              <button class="primary" onClick={markAllRead}>
                Mark all read
              </button>
            </Show>
          </>
        }
      >
        Everything addressed to you — mentions, assignments, reviews, and updates across your work.
      </WorkspaceHeader>

      <Show when={error()}>
        <p class="inbox-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!profileId()}>
        <div class="inbox-blank">
          <span class="inbox-blank-ic">
            <Icon name="user" size={22} />
          </span>
          <div>
            <h2>Choose who you're acting as</h2>
            <p>Pick a profile above — or add one in Organization — to see the notifications addressed to you.</p>
          </div>
          <a class="primary inbox-blank-cta" {...linkProps({ view: "Members" })}>
            Open Organization
          </a>
        </div>
      </Show>

      <Show when={profileId()}>
        {/* A failed load is an error, never an empty inbox. */}
        <Show when={notifications.error}>
          <p class="inbox-error" role="alert">
            {humanError(notifications.error)}
          </p>
        </Show>
        <Show when={notifications.loading}>
          <p class="inbox-muted">Loading your inbox…</p>
        </Show>

        <Show when={!notifications.loading && !notifications.error}>
          {/* Nothing has ever arrived — onboarding composition, not a bare line. */}
          <Show when={!everything().length}>
            <div class="view-cols inbox-cols inbox-onboarding">
              <div class="view-main">
                <section class="inbox-blank">
                  <span class="inbox-blank-ic">
                    <Icon name="inbox" size={22} />
                  </span>
                  <div>
                    <h2>You're all caught up</h2>
                    <p>
                      Mentions, assignments, review requests, and updates addressed to you will land in this feed.
                    </p>
                  </div>
                  <a class="ghost inbox-blank-cta" {...linkProps({ view: "Dashboard" })}>
                    Go to Overview
                  </a>
                </section>
              </div>
              <aside class="view-rail inbox-rail">
                {summaryCard()}
                {subscriptionsCard()}
                <div class="rail-card">
                  <h3>How it works</h3>
                  <p class="rail-empty">
                    Updates from your work arrive here, with the related item one click away.
                  </p>
                </div>
              </aside>
            </div>
          </Show>

          <Show when={everything().length}>
            <div class="view-cols inbox-cols">
              <div class="view-main">
                <div class="inbox-filters">
                  <div class="inbox-scope">
                    <button
                      classList={{ on: scope() === "all" }}
                      aria-pressed={scope() === "all"}
                      onClick={() => setScope("all")}
                    >
                      All
                    </button>
                    <button
                      classList={{ on: scope() === "unread" }}
                      aria-pressed={scope() === "unread"}
                      onClick={() => setScope("unread")}
                    >
                      Unread
                      <Show when={unreadAll().length}>
                        <em>{unreadAll().length}</em>
                      </Show>
                    </button>
                  </div>
                </div>

                <div class="inbox-groups">
                  <section>
                    <h2>
                      Unread <span>{unread().length}</span>
                    </h2>
                    <Show
                      when={unread().length}
                      fallback={
                        <div class="inbox-clear">
                          <span class="inbox-clear-ic">
                            <Icon name="check" size={16} />
                          </span>
                          <p>
                            {scope() === "unread" || category() !== "all"
                              ? "Nothing unread in this filter."
                              : "You're all caught up — no unread notifications."}
                          </p>
                        </div>
                      }
                    >
                      <ul class="inbox-list">
                        <For each={unread()}>{row}</For>
                      </ul>
                    </Show>
                  </section>

                  <Show when={scope() === "all" && earlier().length}>
                    <section>
                      <h2>
                        Earlier <span>{earlier().length}</span>
                      </h2>
                      <ul class="inbox-list">
                        <For each={earlier()}>{row}</For>
                      </ul>
                    </section>
                  </Show>
                </div>
              </div>

              <aside class="view-rail inbox-rail">
                {summaryCard()}
                <Show when={categories().length > 1}>
                  <div class="rail-card">
                    <h3>By type</h3>
                    <div class="rail-rows">
                      <button
                        class="rail-row"
                        classList={{ muted: category() !== "all" }}
                        aria-pressed={category() === "all"}
                        onClick={() => setCategory("all")}
                      >
                        <span class="rail-row-ic">
                          <Icon name="inbox" size={13} />
                        </span>
                        <span class="rail-row-label">All types</span>
                        <span class="rail-row-val">{everything().length}</span>
                      </button>
                      <For each={categories()}>
                        {({ category: entry, count }) => (
                          <button
                            class="rail-row"
                            classList={{ muted: category() !== "all" && category() !== entry.key }}
                            aria-pressed={category() === entry.key}
                            onClick={() => setCategory(category() === entry.key ? "all" : entry.key)}
                          >
                            <span class="rail-row-ic">
                              <Icon name={entry.icon} size={13} />
                            </span>
                            <span class="rail-row-label">{entry.label}</span>
                            <span class="rail-row-val">{count}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
                {subscriptionsCard()}
              </aside>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
