import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { personalApi, type Notification } from "../api/personal";
import { ProfilePicker } from "../components/Pickers";
import { Icon, type IconName } from "../components/Icon";
import { profileId } from "../session";
import { requestView } from "../nav";
import "./Inbox.css";

// Inbox = the human notification feed (mentions, assignments, review requests…)
// pulled from the same store the Overview summarises — surfaced here as a
// first-class destination so people, not tooling, sit at the centre of the app.

// ── Time labels ── relative for the feed ("2h ago"), absolute on hover so the
// exact moment is always one tooltip away without cluttering the row.
const relTime = (ts: number) => {
  const secs = Math.floor(Date.now() / 1000) - ts;
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fullTime = (ts: number) => new Date(ts * 1000).toLocaleString();

// ── Categories ── event types follow a `domain.action` convention; the domain
// gives us a stable, data-driven grouping with a human label, icon, and tone.
// Unknown domains degrade gracefully to a neutral "Updates" bucket.
type Cat = { key: string; label: string; icon: IconName; tone: string };
const CAT_META: Record<string, Cat> = {
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
const domainOf = (eventType: string) => (eventType.split(".")[0] || eventType).toLowerCase();
const catOf = (n: Notification): Cat =>
  CAT_META[domainOf(n.event_type)] ?? { key: "updates", label: "Updates", icon: "inbox", tone: "updates" };
// friendly action label from the tail of the event type: "issue.assigned" → "Assigned"
const actionLabel = (eventType: string) => {
  const tail = eventType.split(".").slice(1).join(" ").replace(/[_-]+/g, " ").trim();
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : "Update";
};

// ── Deep links ── best-effort routing from a notification's anchored entity to
// the destination that owns it, reusing the app's existing view registry. Every
// mapped target lands somewhere real and relevant — no invented behaviour.
const ENTITY_VIEW: Record<string, string> = {
  profile: "Organization", project: "Projects", issue: "Projects", channel: "Projects",
  document: "Knowledge", doc: "Knowledge", review: "Projects", meeting: "Calendar",
  calendar: "Calendar", todo: "To-Do", task: "To-Do", absence: "Absences",
};
const linkFor = (n: Notification) =>
  n.entity_type ? ENTITY_VIEW[n.entity_type.toLowerCase()] : undefined;

type Scope = "all" | "unread";

export default function Inbox() {
  const [items, { refetch }] = createResource(profileId, (id) =>
    id ? personalApi.notifications(id, false) : Promise.resolve([] as Notification[]));
  const [scope, setScope] = createSignal<Scope>("all");
  const [cat, setCat] = createSignal<string>("all");

  const all = () => items() ?? [];
  const unreadAll = () => all().filter((n) => !n.read_at);
  // categories present in the data drive the filter chips — never show an empty one.
  const cats = createMemo(() => {
    const seen = new Map<string, { cat: Cat; count: number }>();
    for (const n of all()) {
      const c = catOf(n);
      const e = seen.get(c.key) ?? { cat: c, count: 0 };
      e.count++; seen.set(c.key, e);
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  });

  // apply scope + category filters, then split into unread / earlier buckets.
  const filtered = () => all().filter((n) =>
    (scope() === "all" || !n.read_at) && (cat() === "all" || catOf(n).key === cat()));
  const unread = () => filtered().filter((n) => !n.read_at);
  const read = () => filtered().filter((n) => n.read_at);

  const markRead = async (id: string) => { await personalApi.markRead(id); refetch(); };
  const markAll = async () => { await Promise.all(unreadAll().map((n) => personalApi.markRead(n.id))); refetch(); };
  const openEntity = (n: Notification) => { const v = linkFor(n); if (v) requestView(v); };

  const row = (n: Notification, isUnread: boolean) => {
    const c = catOf(n);
    const target = linkFor(n);
    return <li classList={{ unread: isUnread }}>
      <span class="inbox-ic" classList={{ [c.tone]: true }} aria-hidden="true"><Icon name={c.icon} size={16} /></span>
      <div class="inbox-body">
        <div class="inbox-line">
          <Show when={isUnread}><span class="inbox-dot" aria-label="Unread" /></Show>
          <strong>{n.title}</strong>
        </div>
        <Show when={n.body}><p>{n.body}</p></Show>
        <div class="inbox-meta">
          <span class="inbox-chip" classList={{ [c.tone]: true }}>{c.label}</span>
          <span class="inbox-action">{actionLabel(n.event_type)}</span>
          <time title={fullTime(n.created_at)}>{relTime(n.created_at)}</time>
        </div>
      </div>
      <div class="inbox-row-actions">
        <Show when={target}>
          <button class="ghost inbox-open" onClick={() => openEntity(n)} title="Open the related item">Open</button>
        </Show>
        <Show when={isUnread}>
          <button class="ghost" onClick={() => markRead(n.id)} title="Mark this notification as read">Mark read</button>
        </Show>
      </div>
    </li>;
  };

  return <section class="inbox-view">
    <header class="inbox-head">
      <div class="inbox-title">
        <span class="inbox-title-ic"><Icon name="inbox" size={20} /></span>
        <div>
          <h1>Inbox</h1>
          <p>Everything addressed to you — mentions, assignments, reviews, and updates across your work.</p>
        </div>
      </div>
      <div class="inbox-head-actions">
        <ProfilePicker />
        <Show when={unreadAll().length}>
          <button class="primary" onClick={markAll}>Mark all read</button>
        </Show>
      </div>
    </header>

    <Show when={!profileId()}>
      <div class="inbox-blank">
        <span class="inbox-blank-ic"><Icon name="user" size={22} /></span>
        <h2>Choose who you're acting as</h2>
        <p>Pick a profile above — or add one in Organization — to see the notifications addressed to you.</p>
        <button class="primary" onClick={() => requestView("Organization")}>Open Organization</button>
      </div>
    </Show>

    <Show when={profileId()}>
      <Show when={items.loading}><p class="inbox-muted">Loading your inbox…</p></Show>
      <Show when={!items.loading}>
        {/* ── Filter bar ── scope (all / unread) + data-driven category chips ── */}
        <div class="inbox-filters">
          <div class="inbox-scope">
            <button classList={{ on: scope() === "all" }} onClick={() => setScope("all")}>All</button>
            <button classList={{ on: scope() === "unread" }} onClick={() => setScope("unread")}>
              Unread<Show when={unreadAll().length}><em>{unreadAll().length}</em></Show>
            </button>
          </div>
          <Show when={cats().length > 1}>
            <div class="inbox-cats">
              <button classList={{ on: cat() === "all" }} onClick={() => setCat("all")}>All types</button>
              <For each={cats()}>{({ cat: c, count }) =>
                <button classList={{ on: cat() === c.key, [c.tone]: true }} onClick={() => setCat(c.key)}>
                  <Icon name={c.icon} size={13} /> {c.label}<em>{count}</em>
                </button>}</For>
            </div>
          </Show>
        </div>

        {/* ── Fully empty ── no notifications at all ── */}
        <Show when={!all().length}>
          <div class="inbox-blank">
            <span class="inbox-blank-ic"><Icon name="inbox" size={22} /></span>
            <h2>You're all caught up</h2>
            <p>Mentions, assignments, review requests, and updates addressed to you will land here.</p>
            <button class="ghost" onClick={() => requestView("MyWork")}>Go to Overview</button>
          </div>
        </Show>

        <Show when={all().length}>
          <div class="inbox-groups">
            <section>
              <h2>Unread <span>{unread().length}</span></h2>
              <Show when={unread().length} fallback={
                <div class="inbox-clear">
                  <span class="inbox-clear-ic"><Icon name="check" size={16} /></span>
                  <p>{scope() === "unread" || cat() !== "all" ? "Nothing unread in this filter." : "You're all caught up — no unread notifications."}</p>
                </div>}>
                <ul class="inbox-list">
                  <For each={unread()}>{n => row(n, true)}</For>
                </ul>
              </Show>
            </section>

            <Show when={scope() === "all" && read().length}>
              <section>
                <h2>Earlier <span>{read().length}</span></h2>
                <ul class="inbox-list">
                  <For each={read()}>{n => row(n, false)}</For>
                </ul>
              </section>
            </Show>
          </div>
        </Show>
      </Show>
    </Show>
  </section>;
}
