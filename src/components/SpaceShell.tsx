import { For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js";
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
import { attentionCount, setAttentionProfile } from "../attention";
import { isViewAvailable, linkEntity, linkProps, route, type Route } from "../router";
import { railModeOfRoute, railModeOfView, viewLabel, type RailMode } from "../nav";

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

/** The rail is a set of MODES. `landing` is the view the mode opens on when no more
 *  specific object is known — a mode must never land on a naked sidebar. */
const RAIL: { mode: RailMode; label: string; landing: string; icon: IconName; badge?: "chat" | "mentions" }[] = [
  { mode: "home", label: "Home", landing: "Home", icon: "home" },
  { mode: "chats", label: "Chats", landing: "Chat", icon: "chat", badge: "chat" },
  { mode: "activity", label: "Activity", landing: "Inbox", icon: "inbox", badge: "mentions" },
  // "Tasks" lands on the PRIVATE list (My tasks); Team Tasks — everybody's running
  // project work — is the second entry of that mode's sidebar.
  { mode: "tasks", label: "Tasks", landing: "To-Do", icon: "check" },
  { mode: "calendar", label: "Calendar", landing: "Calendar", icon: "calendar" },
  { mode: "development", label: "Development", landing: "Development", icon: "target" },
];

/** `provisional` = the entry has no route of its own YET (Activity's filters land on the
 *  Inbox until Lane 1's two-stream Activity view ships). It navigates, but it never claims
 *  to be the selected object — two lit pills for one URL is a lie. */
type SideEntry = { label: string; view: string; icon: IconName; strong?: boolean; provisional?: boolean; badge?: "chat" | "mentions" };

/** Per-mode sidebar links. Threads and Mentions are no longer permanent global entries:
 *  Threads lives in Chats (a thread IS a conversation), Mentions in Activity (it is one
 *  of that mode's filters). Nothing lost — both are one click from their own mode. */
const MODE_LINKS: Record<RailMode, SideEntry[]> = {
  home: [
    { label: "Today", view: "Home", icon: "home", strong: true },
    { label: "Dashboard", view: "Dashboard", icon: "grid" },
    { label: "Schedule", view: "Calendar", icon: "calendar" },
    { label: "Meetings", view: "Meetings", icon: "calendar-nav" },
    { label: "My tasks", view: "To-Do", icon: "check" },
    { label: "Activity", view: "Inbox", icon: "inbox", badge: "mentions" },
  ],
  chats: [{ label: "Threads", view: "Chat", icon: "chat", strong: true, badge: "chat" }],
  activity: [
    { label: "All", view: "Inbox", icon: "inbox", strong: true },
    { label: "Mentions", view: "Inbox", icon: "chat", provisional: true, badge: "mentions" },
    { label: "Assigned", view: "Team Tasks", icon: "check" },
    { label: "Reviews", view: "Code Reviews", icon: "review" },
  ],
  tasks: [
    { label: "My tasks", view: "To-Do", icon: "check", strong: true },
    { label: "Team tasks", view: "Team Tasks", icon: "users" },
  ],
  calendar: [
    { label: "Calendar", view: "Calendar", icon: "calendar", strong: true },
    { label: "Meetings", view: "Meetings", icon: "calendar-nav" },
    { label: "People", view: "Members", icon: "org" },
    { label: "Locations", view: "Locations", icon: "org" },
    { label: "Time off", view: "Absences", icon: "clock-nav" },
  ],
  development: [
    { label: "Overview", view: "Development", icon: "target", strong: true },
    { label: "Tickets", view: "Issues", icon: "target" },
    { label: "Boards", view: "Boards", icon: "columns" },
    { label: "Pull requests", view: "Code Reviews", icon: "review" },
    { label: "Repositories", view: "Repos", icon: "repo" },
    { label: "Pipelines", view: "Pipelines", icon: "pipeline" },
    { label: "Releases", view: "Packages", icon: "package" },
    { label: "Dev environments", view: "Dev Environments", icon: "repo" },
  ],
  more: [],
};

const MODE_TITLE: Record<RailMode, string> = {
  home: "Home", chats: "Chats", activity: "Activity",
  tasks: "Tasks", calendar: "Calendar", development: "Development", more: "More",
};

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
  // projects() is lazy (auth must land first); ask once so group headers can resolve names.
  void reloadProjects().catch(() => undefined);

  // Unread CONVERSATIONS for the Chats badge — channels only, still the chat surface's own
  // number. "What needs me" is NOT this: that is attention.attentionCount(), the single
  // definition every surface reads, and it is what the Activity badge shows now. Summing
  // unread_count over all channels there is the defect that started this stage.
  const unreadTotal = () => (channels() ?? []).reduce((sum, channel) => sum + (channel.unread_count || 0), 0);
  createEffect(() => setAttentionProfile(actingProfileId() ?? ""));
  const badgeOf = (kind?: "chat" | "mentions") =>
    kind === "chat" ? unreadTotal() : kind === "mentions" ? attentionCount() : 0;

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

  /** THE derivation: the rail mode is a pure function of the live route, computed on every
   *  render and stored nowhere. Deep links therefore cannot arrive with the wrong sidebar. */
  const mode = createMemo<RailMode>(() => railModeOfRoute(route()));

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

  /** Direct messages: channels WITHOUT a name. They live in the Chats mode only. */
  const directs = createMemo(() => {
    const term = filter().trim().toLowerCase();
    return (channels() ?? [])
      .filter((channel) => !channel.archived && !channel.name)
      .filter((channel) => !term || (channel.content_type ?? "").toLowerCase().includes(term));
  });

  /** Projects, for the Tasks mode's "by project" section. */
  const projectList = () =>
    [...(projects() ?? [])]
      .filter((project) => matches(project.name ?? ""))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  /** "More" is everything else, still built from the LIVE registry — minus whatever a
   *  rail mode already owns, so nothing is offered twice and nothing is lost. */
  const moreViews = () =>
    props.views.filter((view) => railModeOfView(view.name) === "more" && matches(viewLabel(view.name)));

  /** Where a rail mode lands. Chats opens the newest conversation, not a naked sidebar;
   *  with no channels at all it falls back to Chat's own (honest) empty surface. */
  const newestChannel = () =>
    [...(channels() ?? [])].filter((c) => !c.archived).sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0))[0];
  const landingRoute = (entry: (typeof RAIL)[number]): Route => {
    if (entry.mode === "chats") {
      const open = activeChannelId();
      const target = open ? undefined : newestChannel();
      if (target) return { view: "Chat", entityType: "channel", entityId: target.id, tab: "messages" };
    }
    return { view: entry.landing };
  };

  /** The search field belongs to the sidebar's identity, so it keeps working in every
   *  mode: it filters whatever that mode lists. */
  const matches = (label: string) => {
    const term = filter().trim().toLowerCase();
    return !term || label.toLowerCase().includes(term);
  };
  const sideEntries = () =>
    MODE_LINKS[mode()].filter((entry) => isViewAvailable(entry.view) && matches(entry.label));

  const railItem = (entry: (typeof RAIL)[number]) => (
    <a
      class="rail-item"
      title={entry.label}
      aria-label={entry.label}
      aria-current={mode() === entry.mode ? "true" : undefined}
      classList={{ active: mode() === entry.mode }}
      {...linkProps(landingRoute(entry))}
    >
      <span class="rail-icon" aria-hidden="true"><Icon name={entry.icon} size={18} /></span>
      <span class="rail-label">{entry.label}</span>
      <Show when={badgeOf(entry.badge) > 0}><span class="rail-badge">{badgeOf(entry.badge)}</span></Show>
    </a>
  );

  const sideLink = (entry: SideEntry) => (
    <a
      class="side-link"
      aria-current={!entry.provisional && props.active === entry.view ? "page" : undefined}
      classList={{ active: !entry.provisional && props.active === entry.view }}
      {...linkProps({ view: entry.view })}
    >
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
          aria-current={mode() === "more" ? "true" : undefined}
          classList={{ active: moreOpen() || mode() === "more" }}
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

      <aside class="space-sidebar" aria-label={`${MODE_TITLE[mode()]} navigation`}>
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
          placeholder={mode() === "chats" ? "Search conversations" : `Search ${MODE_TITLE[mode()].toLowerCase()}`}
          aria-label={mode() === "chats" ? "Search conversations" : `Search ${MODE_TITLE[mode()].toLowerCase()}`}
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        {/* The sidebar's CONTENT follows the rail mode; its identity (plum, width, type,
            search field above) does not. Keyed on the mode so the swapped list is a new
            subtree and focus never lands on a node that no longer exists. */}
        <div class="side-mode" data-mode={mode()}>
        <For each={sideEntries()}>{sideLink}</For>

        <Show when={mode() === "tasks"}>
          <div class="section">
            <div class="section-head"><span>By project</span></div>
            <For each={projectList()}>
              {(project) => (
                <a
                  class="side-link"
                  classList={{ active: route().view === "Project Tasks" && route().projectId === project.id }}
                  {...linkProps({ view: "Project Tasks", projectId: project.id })}
                >
                  <span class="side-icon" aria-hidden="true"><Icon name="layers" size={15} /></span>
                  {project.name}
                </a>
              )}
            </For>
            <Show when={!projectList().length}>
              <div class="side-empty">No projects yet.</div>
            </Show>
          </div>
        </Show>

        <Show when={mode() === "more"}>
          <div class="section">
            <div class="section-head"><span>All views</span></div>
            <For each={moreViews()}>
              {(view) => (
                <a
                  class="side-link"
                  classList={{ active: props.active === view.name }}
                  {...linkProps({ view: view.name })}
                >
                  <span class="side-icon" aria-hidden="true"><Icon name={view.icon} size={15} /></span>
                  {viewLabel(view.name)}
                </a>
              )}
            </For>
          </div>
        </Show>

        <Show when={mode() === "chats"}>
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
        <Show when={directs().length > 0}>
          <div class="section">
            <div class="section-head"><span>Direct messages</span></div>
            <For each={directs()}>
              {(channel) => (
                <a
                  class="channel"
                  classList={{ active: activeChannelId() === channel.id, unread: channel.unread_count > 0 }}
                  {...linkProps({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" })}
                >
                  <span class="hash" aria-hidden="true">@</span>
                  {channel.name ?? "Direct message"}
                  <Show when={channel.unread_count > 0}><span class="count">{channel.unread_count}</span></Show>
                </a>
              )}
            </For>
          </div>
        </Show>
        <Show when={!groups().length && !directs().length}>
          <div class="section"><div class="side-empty">No conversations yet.</div></div>
        </Show>
        </Show>
        </div>

        <Show when={!isWeb() && actingPeople().length > 1}>
          {/* The value is the label: "Acting as" is a caption above a boxed field,
              the one idiom this shell asks every view to drop. It survives for
              assistive tech only. */}
          <label class="side-acting">
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
