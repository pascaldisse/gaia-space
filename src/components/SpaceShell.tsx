import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js";
import "./SpaceShell.css";
// Light chat surface. Scoped under `.theme-space-light`, which only this shell sets:
// loading it here (not lazily from the workspace) keeps the rules deterministic.
import "../views/ChatSpaceLight.css";
import { Icon, type IconName } from "./Icon";
import NewChannelDialog from "./NewChannelDialog";
import { actingProfileId as chatActingProfileId, setActingProfileId } from "../chatIdentity";
import { chatApi, type ChannelSummary } from "../api/chat";
import { platformApi } from "../api/platform";
import { currentUser, isWeb, profileId, profiles, reloadProfiles, projects, reloadProjects, workspaceId, workspaces } from "../session";
import { linkEntity, linkProps, route } from "../router";
import { viewLabel } from "../nav";

/**
 * Communication-first shell (GAIA Space redesign, stage 1).
 *
 * Three columns, exactly the prototype's grid: 68px rail · 304px sidebar · 1fr content.
 * It REPLACES the topbar chrome only while `navLayout() === "chat-first"`; the grouped
 * and flat layouts keep the existing shell in App.tsx untouched, and every registered
 * view stays reachable — the rail's "More" panel is built from the live view registry,
 * not from a hand-written list, so a new view can never become unreachable here.
 */

export type ShellView = { name: string; icon: IconName };

/** view name -> rail entry. Labels are the product's own words; views are the app's own names. */
const RAIL: { label: string; view: string; icon: IconName; badge?: "chat" | "mentions" }[] = [
  { label: "Home", view: "Home", icon: "home" },
  { label: "Chats", view: "Chat", icon: "chat", badge: "chat" },
  { label: "Activity", view: "Inbox", icon: "inbox", badge: "mentions" },
  // "Tasks" is the SHARED work surface — everybody's running project work (Team Tasks),
  // not the private To-Do list. To-Do stays reachable through the rail's "More" panel,
  // which is built from the live view registry.
  { label: "Tasks", view: "Team Tasks", icon: "check" },
  { label: "Calendar", view: "Calendar", icon: "calendar" },
  { label: "Development", view: "Development", icon: "target" },
];

const SIDE_LINKS: { label: string; view: string; icon: IconName; strong?: boolean; badge?: "chat" | "mentions" }[] = [
  { label: "Today", view: "Home", icon: "home", strong: true },
  { label: "Threads", view: "Chat", icon: "chat", strong: true, badge: "chat" },
  { label: "Mentions", view: "Inbox", icon: "inbox", badge: "mentions" },
  { label: "Calendar", view: "Calendar", icon: "calendar" },
  { label: "Development", view: "Development", icon: "target" },
];

const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

export default function SpaceShell(props: {
  /** Every view registered in App.tsx, in registration order. Drives the "More" panel. */
  views: ShellView[];
  active: string;
  /** Opens the EXISTING Goto / full-text search overlay. */
  onOpenSearch: () => void;
  children: JSX.Element;
}): JSX.Element {
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  /** `undefined` = closed; a string (possibly "") = open, bound to that project. */
  const [newChannelFor, setNewChannelFor] = createSignal<string | undefined>();

  // Identity: web is bound to the authenticated profile, desktop to the acting one.
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();
  // Chat's "Acting as" picker moved here when Chat's own sidebar stopped rendering.
  // Desktop only: on web the chat identity is the signed-in account and is not a choice.
  void reloadProfiles().catch(() => undefined);
  const actingPeople = () => (profiles() ?? []).filter((person) => !person.archived);
  const chatActing = () => chatActingProfileId() ?? actingProfileId() ?? "";

  const [channels] = createResource(actingProfileId, (id) =>
    id ? chatApi.listChannelsWithMeta(id) : Promise.resolve<ChannelSummary[]>([]),
  );
  const [mentionCount] = createResource(actingProfileId, (id) =>
    id ? chatApi.countUnreadMentions(id) : Promise.resolve(0),
  );
  // projects() is lazy (auth must land first); ask once so group headers can resolve names.
  void reloadProjects().catch(() => undefined);

  const unreadTotal = () => (channels() ?? []).reduce((sum, channel) => sum + (channel.unread_count || 0), 0);
  const badgeOf = (kind?: "chat" | "mentions") =>
    kind === "chat" ? unreadTotal() : kind === "mentions" ? (mentionCount() ?? 0) : 0;

  // The header names the real organization. Order of truth: the organization record,
  // then the connected workspace, and only then the product name as a last resort — a
  // failing/absent org read must not rename somebody's workspace.
  const [organization] = createResource(() => platformApi.organization().catch(() => undefined));
  const workspaceName = () =>
    organization()?.name?.trim() ||
    workspaces().find((workspace) => workspace.id === workspaceId())?.name ||
    "GAIA Space";
  const meLabel = () => currentUser()?.display_name ?? currentUser()?.username ?? "?";

  const activeChannelId = () => (route().entityType === "channel" ? route().entityId : undefined);

  /** Named channels grouped by owning project; project-less channels land in a final section.
   *  DMs/threads carry no name and are not part of the project channel list. */
  const groups = createMemo(() => {
    const term = filter().trim().toLowerCase();
    const named = (channels() ?? [])
      .filter((channel) => !channel.archived && !!channel.name)
      .filter((channel) => !term || (channel.name ?? "").toLowerCase().includes(term));
    const byProject = new Map<string, ChannelSummary[]>();
    const loose: ChannelSummary[] = [];
    for (const channel of named) {
      if (channel.project_id) {
        const list = byProject.get(channel.project_id) ?? [];
        list.push(channel);
        byProject.set(channel.project_id, list);
      } else loose.push(channel);
    }
    const nameOf = (id: string) => projects()?.find((project) => project.id === id)?.name ?? id;
    const sections = [...byProject.entries()]
      .map(([id, list]) => ({ id, label: nameOf(id), channels: list }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (loose.length) sections.push({ id: "", label: "Other channels", channels: loose });
    return sections;
  });

  const railViews = new Set(RAIL.map((entry) => entry.view));
  const moreViews = () => props.views.filter((view) => !railViews.has(view.name));

  const railItem = (entry: (typeof RAIL)[number]) => (
    <a
      class="rail-item"
      title={entry.label}
      aria-label={entry.label}
      classList={{ active: props.active === entry.view }}
      {...linkProps({ view: entry.view })}
    >
      <span class="rail-icon" aria-hidden="true"><Icon name={entry.icon} size={18} /></span>
      <span class="rail-label">{entry.label}</span>
      <Show when={badgeOf(entry.badge) > 0}><span class="rail-badge">{badgeOf(entry.badge)}</span></Show>
    </a>
  );

  const sideLink = (entry: (typeof SIDE_LINKS)[number]) => (
    <a class="side-link" classList={{ active: props.active === entry.view }} {...linkProps({ view: entry.view })}>
      <span class="side-icon" aria-hidden="true"><Icon name={entry.icon} size={15} /></span>
      {entry.strong ? <strong>{entry.label}</strong> : entry.label}
      <Show when={badgeOf(entry.badge) > 0}><span class="count">{badgeOf(entry.badge)}</span></Show>
    </a>
  );

  return (
    <div class="space-chat-shell theme-space-light">
      <aside class="rail" aria-label="Main navigation">
        <div class="mark" aria-hidden="true">G</div>
        <For each={RAIL}>{railItem}</For>
        <button
          class="rail-item"
          title="More"
          aria-label="More"
          aria-expanded={moreOpen()}
          classList={{ active: moreOpen() }}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span class="rail-icon" aria-hidden="true"><Icon name="menu" size={18} /></span>
          <span class="rail-label">More</span>
        </button>
        <div class="rail-spacer" />
        <button class="round-action" aria-label="Create new" title="Create new" onClick={props.onOpenSearch}>
          <Icon name="plus" size={20} />
        </button>
        <a class="profile" title={meLabel()} aria-label={meLabel()} {...linkProps({ view: "Settings" })}>
          {initials(meLabel())}
        </a>
      </aside>

      <Show when={moreOpen()}>
        <div class="more-backdrop" onClick={() => setMoreOpen(false)} />
        <nav class="more-panel" aria-label="All views">
          <h2>All views</h2>
          <For each={moreViews()}>
            {(view) => (
              <a
                class="more-item"
                classList={{ active: props.active === view.name }}
                {...linkProps({ view: view.name })}
                onClick={() => setMoreOpen(false)}
              >
                <span class="side-icon" aria-hidden="true"><Icon name={view.icon} size={16} /></span>
                {viewLabel(view.name)}
              </a>
            )}
          </For>
        </nav>
      </Show>

      <aside class="space-sidebar" aria-label="Channels">
        <div class="workspace-name">
          <strong>{workspaceName()}</strong>
          <div class="tiny-actions">
            <button class="tiny-btn" aria-label="Search" title="Search" onClick={props.onOpenSearch}>
              <Icon name="search" size={14} />
            </button>
            <button class="tiny-btn" aria-label="New channel" title="New channel" onClick={() => setNewChannelFor("")}>
              <Icon name="edit" size={14} />
            </button>
          </div>
        </div>
        <input
          class="side-search"
          type="search"
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <For each={SIDE_LINKS}>{sideLink}</For>

        <For each={groups()}>
          {(group) => (
            <div class="section">
              <div class="section-head">
                <span>{group.label}</span>
                {/* The `+` is where "new conversation" lives now (it left Chat's sidebar). */}
                <button class="section-add" aria-label={`New channel in ${group.label}`} title="New channel" onClick={() => setNewChannelFor(group.id)}>+</button>
              </div>
              <For each={group.channels}>
                {(channel) => (
                  <a
                    class="channel"
                    classList={{ active: activeChannelId() === channel.id, unread: channel.unread_count > 0 }}
                    {...linkProps({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" })}
                  >
                    <span class="hash" aria-hidden="true">#</span>
                    {channel.name}
                    <Show when={channel.unread_count > 0}><span class="count">{channel.unread_count}</span></Show>
                  </a>
                )}
              </For>
            </div>
          )}
        </For>
        <Show when={!groups().length}>
          <div class="section"><div class="side-empty">No channels yet.</div></div>
        </Show>

        <Show when={!isWeb() && actingPeople().length > 1}>
          <label class="side-acting">
            <span>Acting as</span>
            <select
              aria-label="Acting as"
              value={chatActing()}
              onChange={(event) => setActingProfileId(event.currentTarget.value || null)}
            >
              <For each={actingPeople()}>{(person) => <option value={person.id}>{person.display_name || person.username}</option>}</For>
            </select>
          </label>
        </Show>
      </aside>

      <Show when={newChannelFor() !== undefined}>
        <NewChannelDialog
          projectId={newChannelFor() || undefined}
          projectLabel={groups().find((group) => group.id === newChannelFor())?.label}
          onClose={() => setNewChannelFor(undefined)}
          onCreated={(id) => linkEntity("channel", id)}
        />
      </Show>

      <main class="space-main">
        <header class="commandbar">
          <button class="command-search" onClick={props.onOpenSearch}>
            <Icon name="search" size={16} />
            Search messages, tasks, dates and tickets
          </button>
          <div class="top-actions">
            <a class="btn" {...linkProps({ view: "Meetings" })}>Schedule meeting</a>
            <a class="btn primary" {...linkProps({ view: "Chat" })}>New message</a>
          </div>
        </header>
        <section class="space-content">{props.children}</section>
      </main>
    </div>
  );
}
