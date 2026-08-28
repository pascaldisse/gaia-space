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
import { attentionCount, attentionFilterCount, asActivityFilter, setAttentionProfile, type ActivityFilter } from "../attention";
import { isViewAvailable, linkEntity, linkProps, navigate, route, type Route } from "../router";
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
  { mode: "projects", label: "Projects", landing: "Projects", icon: "layers" },
  { mode: "calendar", label: "Calendar", landing: "Calendar", icon: "calendar" },
  { mode: "development", label: "Development", landing: "Development", icon: "target" },
];

/** A sidebar entry names an OBJECT of the current mode. `filter` marks the entries that
 *  NARROW the current pane instead of moving: Activity's worklist filters, which live in
 *  the route (`/inbox/<filter>`) so exactly one of them can read as active, a deep link
 *  arrives filtered, and back/forward tell the truth.
 *  They used to be destinations wearing the costume of filters — Assigned went to Team
 *  Tasks, Reviews to Code Reviews, Mentions was `provisional` and went nowhere. */
type SideEntry = { label: string; view: string; icon: IconName; strong?: boolean; filter?: ActivityFilter; badge?: "chat" | "mentions" };

/** Per-mode sidebar links. Threads and Mentions are no longer permanent global entries:
 *  Threads lives in Chats (a thread IS a conversation), Mentions in Activity (it is one
 *  of that mode's filters). Nothing lost — both are one click from their own mode. */
const MODE_LINKS: Record<RailMode, SideEntry[]> = {
  // Home has NO sidebar. The rule for this shell is that the sidebar lists the
  // OBJECTS of the current mode — channels under Chats, projects under Tasks. Home
  // is one page and owns no objects, so its sidebar could only list DESTINATIONS,
  // and every one of them (Dashboard, Calendar, Meetings, To-Do, Inbox) is another
  // rail mode's landing. That is the rail printed twice, one column to the right.
  // An empty list here is not a gap: it is the honest answer, and Home gets the
  // width back.
  home: [],
  // THREADS IS NOT A DESTINATION. It never was: no command listed threads, so this
  // entry only ever opened Chat — a label with nothing behind it. A thread with unread
  // replies is WORK, so it now appears in the one worklist (`src/attention.ts`, source 0,
  // backed by `list_unread_threads`) and therefore in Activity, the rail badge and Home.
  // Do not restore a destination here; add to the worklist rule instead.
  chats: [],
  // Activity's objects are the things waiting for you, so its sidebar lists FILTERS over
  // the one worklist — each one a group of `AttentionKind` (see ACTIVITY_FILTERS in
  // attention.ts). No entry leaves the mode, and no entry exists without kinds behind it.
  activity: [
    { label: "All", view: "Inbox", icon: "inbox", strong: true, filter: "all" },
    { label: "Mentions", view: "Inbox", icon: "chat", filter: "mentions" },
    { label: "Messages", view: "Inbox", icon: "chat", filter: "messages" },
    { label: "Assigned", view: "Inbox", icon: "check", filter: "assigned" },
    { label: "Reviews", view: "Inbox", icon: "review", filter: "reviews" },
    { label: "Updates", view: "Inbox", icon: "inbox", filter: "updates" },
  ],
  tasks: [
    { label: "My tasks", view: "To-Do", icon: "check", strong: true },
    { label: "Team tasks", view: "Team Tasks", icon: "users" },
  ],
  // Projects lists the PROJECTS, the way Chats lists the channels — they are this
  // mode's objects. "All projects" is the only fixed entry; everything else is data.
  projects: [{ label: "All projects", view: "Projects", icon: "layers", strong: true }],
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
    /* ONE THING, ONE NAME: this entry opens the Packages view, whose h1 is
       "Packages" and whose content is package repositories and their versions.
       Calling it "Releases" in the rail put a second name on the same surface
       AND collided with Development's own Releases section, which honestly
       reports that nothing in the workspace records a release. */
    { label: "Packages", view: "Packages", icon: "package" },
    { label: "Dev environments", view: "Dev Environments", icon: "repo" },
  ],
  more: [],
};

const MODE_TITLE: Record<RailMode, string> = {
  home: "Home", chats: "Chats", activity: "Activity",
  tasks: "Tasks", projects: "Projects", calendar: "Calendar", development: "Development", more: "More",
};

/** linkProps() is evaluated ONCE when a node is created, so a plain spread freezes the
 *  href at first render: the rail's links were still `/dashboard` (the fallback, from
 *  before registerViews ran), and the Chats landing could never see channels that load
 *  later. Getters make the spread re-read — Solid's spread runs in a computation — so the
 *  href is always the CURRENT route, and copy/middle-click give a real URL. */
const navLink = (target: () => Route) => {
  const props = createMemo(() => linkProps(target()));
  return {
    get href() { return props().href; },
    onClick: (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => props().onClick(event),
  };
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
  // A mode with no objects of its own gets no column at all. Home is that mode:
  // it is one page, so anything listed beside it could only be another mode's
  // landing — the rail printed twice. Chats keeps its column even when the entry
  // list is short, because the channels below it ARE its objects.
  // Which modes show the conversation list. Home does, and that is the point of a
  // communication-first product: the channels are the objects you steer by, so they
  // stay in view even on the start page. Home still lists no DESTINATIONS — those
  // were the rail printed twice.
  const showsChannels = createMemo(() => mode() === "chats" || mode() === "home");
  const hasSidebar = createMemo(() => MODE_LINKS[mode()].length > 0 || showsChannels());

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
      // Already in a conversation: Chats keeps it (it is the mode's current object).
      // Otherwise open the newest one — a mode must land on something real.
      const id = activeChannelId() ?? newestChannel()?.id;
      if (id) return { view: "Chat", entityType: "channel", entityId: id, tab: "messages" };
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

  /** The active Activity filter, read from the ROUTE (unknown -> All). */
  const activityFilter = (): ActivityFilter => asActivityFilter(route().tab);
  /** A filter entry is active when the route's filter is its own; every other entry is
   *  active when its view is the open one. Exactly one entry lights either way. */
  const entryActive = (entry: SideEntry) =>
    entry.filter ? route().view === "Inbox" && activityFilter() === entry.filter : props.active === entry.view;
  /** A filter's own count, from the same source as the badge. A count of 0 is drawn
   *  without tone (`metricTone`'s rule) rather than hidden — the filter is still real. */
  const entryCount = (entry: SideEntry) =>
    entry.filter ? attentionFilterCount(entry.filter) : badgeOf(entry.badge);

  const railItem = (entry: (typeof RAIL)[number]) => (
    <a
      class="rail-item"
      title={entry.label}
      aria-label={entry.label}
      aria-current={mode() === entry.mode ? "true" : undefined}
      classList={{ active: mode() === entry.mode }}
      {...navLink(() => landingRoute(entry))}
    >
      <span class="rail-icon" aria-hidden="true"><Icon name={entry.icon} size={18} /></span>
      <span class="rail-label">{entry.label}</span>
      <Show when={badgeOf(entry.badge) > 0}><span class="rail-badge">{badgeOf(entry.badge)}</span></Show>
    </a>
  );

  const sideLink = (entry: SideEntry) => (
    <a
      class="side-link"
      data-filter={entry.filter}
      aria-current={entryActive(entry) ? "page" : undefined}
      classList={{ active: entryActive(entry) }}
      {...navLink(() => (entry.filter && entry.filter !== "all"
        ? { view: entry.view, tab: entry.filter }
        : { view: entry.view }))}
    >
      <span class="side-icon" aria-hidden="true"><Icon name={entry.icon} size={15} /></span>
      {entry.strong ? <strong>{entry.label}</strong> : entry.label}
      <Show when={entry.filter || entryCount(entry) > 0}>
        <span class="count" classList={{ zero: entryCount(entry) === 0 }}>{entryCount(entry)}</span>
      </Show>
    </a>
  );

  return (
    <div class="space-chat-shell theme-space-light" classList={{ "no-sidebar": !hasSidebar() }}>
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
        {/* The panel closes on the container's click, not on each item: an item's own
            onClick attribute would SHADOW the spread navigation handler. */}
        <nav class="more-panel" aria-label="All views" onClick={() => setMoreOpen(false)}>
          <h2>All views</h2>
          <For each={moreViews()}>
            {(view) => (
              <a
                class="more-item"
                classList={{ active: props.active === view.name }}
                {...navLink(() => ({ view: view.name }))}
              >
                <span class="side-icon" aria-hidden="true"><Icon name={view.icon} size={16} /></span>
                {viewLabel(view.name)}
              </a>
            )}
          </For>
        </nav>
      </Show>

      <Show when={hasSidebar()}>
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
          placeholder={showsChannels() ? "Search conversations" : `Search ${MODE_TITLE[mode()].toLowerCase()}`}
          aria-label={showsChannels() ? "Search conversations" : `Search ${MODE_TITLE[mode()].toLowerCase()}`}
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        {/* The sidebar's CONTENT follows the rail mode; its identity (plum, width, type,
            search field above) does not. Keyed on the mode so the swapped list is a new
            subtree and focus never lands on a node that no longer exists. */}
        <div class="side-mode" data-mode={mode()}>
        <For each={sideEntries()}>{sideLink}</For>

        {/* The projects are the PROJECTS mode's objects, the way channels are Chats'.
            Tasks no longer repeats them: "Project Tasks" now lives in the projects
            mode, so listing it under Tasks would have switched mode on click — the
            one thing a sidebar entry must never do. */}
        <Show when={mode() === "projects"}>
          <div class="section">
            <div class="section-head">
              <span>Projects</span>
              <button
                type="button"
                class="section-add"
                title="New project"
                aria-label="New project"
                onClick={() => navigate({ view: "Projects" })}
              >+</button>
            </div>
            <For each={projectList()}>
              {(project) => (
                <a
                  class="side-link"
                  classList={{ active: route().projectId === project.id }}
                  {...navLink(() => ({ view: "Project Overview", projectId: project.id }))}
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
                  {...navLink(() => ({ view: view.name }))}
                >
                  <span class="side-icon" aria-hidden="true"><Icon name={view.icon} size={15} /></span>
                  {viewLabel(view.name)}
                </a>
              )}
            </For>
          </div>
        </Show>

        <Show when={showsChannels()}>
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
                    {...navLink(() => ({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" }))}
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
                  {...navLink(() => ({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" }))}
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
      </Show>

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
          {/* ── THE GLOBAL-ACTION RULE ────────────────────────────────────────
              The GLOBAL bar carries SEARCH plus AT MOST ONE global action, and that
              action must really ACT — open a composer or a drawer. It must NEVER
              merely navigate. A nav link in a button's costume promises that
              something will be created and then only moves the person, and it
              duplicates the real primary already sitting in the page header of the
              surface that owns the act. EVERYTHING ELSE BELONGS TO THAT PAGE HEADER.

              What this rule removed here: `Schedule meeting` -> Meetings and
              `New message` -> Chat. Both only navigated, and both were doubled on
              screen — Calendar and Meetings each own a real `New meeting`, so
              `Schedule meeting` was rendered directly above its own duplicate.
              `Schedule meeting` is gone; the two surfaces that own it keep it.
              `New message` stays as the ONE global action and now genuinely opens
              NewChannelDialog — the same act as the sidebar `+`, organisation-scoped
              (`""` = no project pre-bound), so nothing became unreachable. */}
          <div class="top-actions">
            <button class="btn primary" onClick={() => setNewChannelFor("")}>New message</button>
          </div>
        </header>
        <section class="space-content">{props.children}</section>
      </main>
    </div>
  );
}
