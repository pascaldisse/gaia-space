import { For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js";
import "./SpaceShell.css";
// Light chat surface. Scoped under `.theme-space-light`, which only this shell sets:
// loading it here (not lazily from the workspace) keeps the rules deterministic.
import "../views/ChatSpaceLight.css";
import { Icon, type IconName } from "./Icon";
import NewChannelDialog from "./NewChannelDialog";
import RecipientPicker from "./RecipientPicker";
import ConfirmDialog from "./ConfirmDialog";
import PromptDialog from "./PromptDialog";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { actingProfileId as chatActingProfileId, bumpChannels, channelsVersion, setActingProfileId } from "../chatIdentity";
import { dmLabel, partitionChannels } from "../chatPartition";
import { chatApi, newId as newMessageId, type ChannelSummary } from "../api/chat";
import { setSelectedChannel } from "../chatChannelSelection";
import { documentsApi, ORGANIZATION_LIBRARY_ID } from "../api/documents";
import { platformApi } from "../api/platform";
import { currentUser, isWeb, profileId, profiles, reloadProfiles, projects, reloadProjects, workspaceId, workspaces } from "../session";
import { attentionCount, attentionFilterCount, asActivityFilter, setAttentionProfile, unreadChannelTotal, type ActivityFilter } from "../attention";
import { isViewAvailable, linkEntity, linkProps, navigate, route, type Route } from "../router";
import { MOBILE_RAIL_MODES, NAV_GROUPS, hiddenGroups, mobileNavPlacement, navPlacement, railModeOfRoute, railModeOfView, showDevelopment, viewLabel, type RailMode } from "../nav";

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
const RAIL: { mode: Exclude<RailMode, "more">; label: string; landing: string; icon: IconName; badge?: "chat" | "mentions" }[] = [
  { mode: "home", label: "Home", landing: "Home", icon: "home" },
  { mode: "chats", label: "Chats", landing: "Chat", icon: "chat", badge: "chat" },
  { mode: "projects", label: "Projects", landing: "Projects", icon: "layers" },
  { mode: "library", label: "Library", landing: "Documents", icon: "book-nav" },
  { mode: "development", label: "Development", landing: "Development", icon: "target" },
];
const mobileRail = () => RAIL.filter((entry) => MOBILE_RAIL_MODES.includes(entry.mode));
const desktopRail = () => RAIL.filter((entry) => entry.mode !== "development" || showDevelopment());
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
  // Projects lists the PROJECTS, the way Chats lists the channels — they are this
  // mode's objects. "All projects" is the only fixed entry; everything else is data.
  projects: [{ label: "All projects", view: "Projects", icon: "layers", strong: true }],
  // Knowledge's objects are the LIBRARIES, and every one of them is DATA (the personal
  // container, the organization's books, each project's library), so none of them can be
  // written here: the mode's column is built below, from what exists.
  library: [],
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
  home: "Home", chats: "Chats", projects: "Projects", library: "Library", development: "Development", more: "More",
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
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  /** `undefined` = closed; a string (possibly "") = open, bound to that project.
   *  Scoped to the sidebar's own per-project/per-section "+" only — the global
   *  "New message" action below opens the picker instead (ONE ACTION, ONE PLACE:
   *  a project-bound `+` still needs the project preset NewChannelDialog carries,
   *  the person-first global action does not). */
  const [newChannelFor, setNewChannelFor] = createSignal<string | undefined>();
  const [recipientPickerOpen, setRecipientPickerOpen] = createSignal(false);

  // Identity: web is bound to the authenticated profile, desktop to the acting one.
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();
  // Chat's "Acting as" picker moved here when Chat's own sidebar stopped rendering.
  // Desktop only: on web the chat identity is the signed-in account and is not a choice.
  void reloadProfiles().catch(() => undefined);
  const actingPeople = () => (profiles() ?? []).filter((person) => !person.archived);
  const chatActing = () => chatActingProfileId() ?? actingProfileId() ?? "";

  /* Keyed on the version too: a channel deleted or renamed on ANOTHER surface bumps
     it, and this list re-reads instead of showing a conversation that is gone. */
  const [channels, { refetch: refetchChannels }] = createResource(
    () => [actingProfileId(), channelsVersion()] as const,
    ([id]) => (id ? chatApi.listChannelsWithMeta(id) : Promise.resolve<ChannelSummary[]>([])),
  );
  // projects() is lazy (auth must land first); ask once so group headers can resolve names.
  void reloadProjects().catch(() => undefined);

  // Unread CONVERSATIONS for the Chats badge — channels only, still the chat surface's own
  // number. "What needs me" is NOT this: that is attention.attentionCount(), the single
  // definition every surface reads, and it is what the Activity badge shows now. Summing
  // unread_count over all channels there is the defect that started this stage.
  // The sum itself lives in attention.ts (`unreadChannelTotal`) so it is one
  // definition and testable without a shell: an inline reduce here is how the
  // badge kept its own stale arithmetic.
  const unreadTotal = () => unreadChannelTotal(channels() ?? []);
  createEffect(() => setAttentionProfile(actingProfileId() ?? ""));
  const badgeOf = (kind?: "chat" | "mentions") =>
    kind === "chat" ? unreadTotal() : kind === "mentions" ? attentionCount() : 0;

  // The header names the real organization. Order of truth: the organization record,
  // then the connected workspace, and only then the product name as a last resort — a
  // failing/absent org read must not rename somebody's workspace.
  /* ── ACTS ON A CONVERSATION, WHERE THE CONVERSATION IS LISTED ────────────────
     Deleting was only offered inside the channel; the list is where people point at
     a channel, so the same act is on its right-click menu — and it still asks. */
  const [channelMenu, setChannelMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [pendingChannel, setPendingChannel] = createSignal<ChannelSummary | null>(null);
  const [deletingChannel, setDeletingChannel] = createSignal(false);
  const [channelError, setChannelError] = createSignal("");
  /* RENAMING A CONVERSATION. A channel's name is the only thing most people ever
     see of it, and until now it could be set once (at creation) and never corrected.
     It is asked in the same dialog a folder rename uses — the tile/row itself never
     turns into a bare input. Only NAMED channels: a direct message has no name of
     its own, it is the people in it. */
  const [renamingChannel, setRenamingChannel] = createSignal<ChannelSummary | null>(null);
  const [channelName, setChannelName] = createSignal("");
  const [renamingBusy, setRenamingBusy] = createSignal(false);
  const startRenameChannel = (channel: ChannelSummary) => {
    setChannelName(channel.name ?? "");
    setRenamingChannel(channel);
  };
  const saveChannelName = async () => {
    const summary = renamingChannel();
    const name = channelName().trim();
    if (!summary || !name || name === summary.name) {
      setRenamingChannel(null);
      return;
    }
    setRenamingBusy(true);
    setChannelError("");
    try {
      const channel = await chatApi.getChannel(summary.id);
      if (!channel) throw new Error("Channel not found");
      await chatApi.updateChannel({ ...channel, name });
      bumpChannels();
      setRenamingChannel(null);
    } catch (reason) {
      // A refusal (no right to manage this channel) is shown, never swallowed.
      setChannelError(String(reason));
      setRenamingChannel(null);
    } finally {
      setRenamingBusy(false);
    }
  };

  const channelItems = (channel: ChannelSummary): ContextMenuItem[] => [
    { label: "Open", onSelect: () => navigate({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" }) },
    ...(channel.name ? [{ label: "Rename…", onSelect: () => startRenameChannel(channel) }] : []),
    { label: "Delete conversation…", danger: true, onSelect: () => setPendingChannel(channel) },
  ];
  const openChannelMenu = (event: MouseEvent, channel: ChannelSummary) => {
    event.preventDefault();
    event.stopPropagation();
    setChannelMenu({ x: event.clientX, y: event.clientY, items: channelItems(channel) });
  };
  const deleteChannel = async () => {
    const channel = pendingChannel();
    if (!channel) return;
    setDeletingChannel(true);
    setChannelError("");
    try {
      await chatApi.deleteChannel(channel.id, actingProfileId() ?? "");
      setPendingChannel(null);
      // The list must forget it too, or the delete only looks broken.
      bumpChannels();
      // Standing in a channel that no longer exists is not a place: leave it.
      if (activeChannelId() === channel.id) navigate({ view: "Chat" });
    } catch (reason) {
      setChannelError(String(reason));
      setPendingChannel(null);
    } finally {
      setDeletingChannel(false);
    }
  };

  /* ── DROPPING THINGS WHERE THEY BELONG ────────────────────────────────────
     Knowledge proved the gesture: you carry a thing to the place that should hold
     it. The sidebar is the one list that is always on screen, so it is where the
     two cross-surface moves live.

       · a DOCUMENT dropped on a conversation is shared into it — one message,
         written by you, carrying the title and the way back to the document;
       · a CHANNEL dropped on a project's section head joins that project, which
         is the same act the channel page offers as "Attach to project".

     Payload types decide, never guesswork: a document carries
     `application/x-gaia-document`, a channel `application/x-gaia-channel`. A file
     dragged in from the desktop carries `Files` and is ignored here. */
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  const [dropNote, setDropNote] = createSignal("");
  const readPayload = <T,>(event: DragEvent, kind: string): T | null => {
    const raw = event.dataTransfer?.getData(kind);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  };
  const carries = (event: DragEvent, kind: string) => !!event.dataTransfer?.types.includes(kind);

  const shareDocumentInto = async (channel: ChannelSummary, document: { id: string; title: string; path: string }) => {
    const author = actingProfileId();
    if (!author) return;
    try {
      await chatApi.createMessage({
        id: newMessageId("msg"),
        channel_id: channel.id,
        author_id: author,
        // Plain text is what a message is; the path is a real in-app link once the
        // conversation renders it, and remains readable if it does not.
        text: `Shared a document: ${document.title} ${document.path}`,
        created_at: Math.floor(Date.now() / 1000),
        edited_at: null,
        thread_of: null,
        archived: false,
      });
      setDropNote(`Shared “${document.title}” in ${channel.name ?? "the conversation"}`);
      setTimeout(() => setDropNote(""), 4000);
    } catch (reason) {
      setChannelError(String(reason));
    }
  };

  const attachChannelToProject = async (channelId: string, projectId: string) => {
    try {
      const channel = await chatApi.getChannel(channelId);
      if (!channel || channel.project_id === projectId) return;
      await chatApi.updateChannel({ ...channel, project_id: projectId });
      await refetchChannels();
      setDropNote(`${channel.name ? "#" + channel.name : "The conversation"} now belongs to this project`);
      setTimeout(() => setDropNote(""), 4000);
    } catch (reason) {
      setChannelError(String(reason));
    }
  };

  const [organization] = createResource(() => platformApi.organization().catch(() => undefined));

  /** Knowledge's objects: the organization's books (kb container roots) and, beside them,
   *  one library per project. Read once here so the sidebar can list them; the Documents
   *  view keeps its own reads for the tree it draws. */
  const [organizationLibrary] = createResource(() => documentsApi.ensureOrganizationLibraryRoot().catch(() => undefined));
  const [documentFolders] = createResource(organizationLibrary, () => documentsApi.listDocumentFolders().catch(() => []));
  const orgLibraries = () =>
    (documentFolders() ?? [])
      .filter((folder) => folder.container_type === "kb" && folder.parent_id === null && !folder.archived && folder.id !== ORGANIZATION_LIBRARY_ID)
      .filter((folder) => matches(folder.name ?? ""))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
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
  // Knowledge lists libraries, all of them data, so it keeps its column too — before
  // this it was the one mode where the second bar disappeared mid-navigation.
  const hasSidebar = createMemo(() => MODE_LINKS[mode()].length > 0 || showsChannels() || mode() === "library");

  /** A profile's display name, for labelling a direct message with the OTHER person. */
  const displayNameOf = (id: string) => (profiles() ?? []).find((person) => person.id === id)?.display_name;

  /** The two sections the sidebar draws, split by kind and head count — never by whether
   *  a row happens to carry a name. Chat names a DM after both people, so the old
   *  name-based split filed every DM under the channels. */
  const split = createMemo(() => partitionChannels((channels() ?? []).filter((channel) => !channel.archived)));

  /** What a direct message is called HERE: the other person, with me removed. */
  const labelOfDirect = (channel: ChannelSummary) => dmLabel(channel, actingProfileId(), { nameOf: displayNameOf });

  /** Real channels grouped by owning project; project-less channels land in a final section. */
  const groups = createMemo(() => {
    const term = filter().trim().toLowerCase();
    const named = split()
      .channels.filter((channel) => !!channel.name)
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
    /* "Channels" when it is the only heading, "Other channels" when project sections
       stand above it — the word says what the section is relative to what is shown. */
    if (loose.length) sections.push({ id: "", label: sections.length ? "Other channels" : "Channels", channels: loose });
    return sections;
  });

  /** Direct messages: 1:1 conversations. They live in the Chats mode only, and the
   *  search matches what the row SHOWS — the other person's name. */
  const directs = createMemo(() => {
    const term = filter().trim().toLowerCase();
    return split().dms.filter((channel) => !term || labelOfDirect(channel).toLowerCase().includes(term));
  });

  /** Projects, for the Tasks mode's "by project" section. */
  const projectList = () =>
    [...(projects() ?? [])]
      .filter((project) => matches(project.name ?? ""))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  /** "More" is everything else, still built from the LIVE registry — minus whatever a
   *  rail mode already owns, so nothing is offered twice and nothing is lost.
   *
   *  AND minus what the person hid. `Settings -> Visible destinations` writes
   *  `hiddenGroups`, which until now only the older grouped/flat layouts read: in the
   *  shipped chat-first shell all eight checkboxes did nothing at all. A preference
   *  that cannot be observed is worse than a missing one. As Settings promises, a
   *  hidden destination stays reachable by URL and from Go to — only this list drops it. */
  const hiddenViewNames = () => {
    const hidden = new Set(hiddenGroups());
    return new Set(NAV_GROUPS.filter((group) => hidden.has(group.id)).flatMap((group) => group.views));
  };
  const moreViews = () =>
    props.views.filter(
      (view) =>
        railModeOfView(view.name) === "more" &&
        !hiddenViewNames().has(view.name) &&
        matches(viewLabel(view.name)),
    );

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
    <div class="space-chat-shell theme-space-light" data-nav-placement={navPlacement()} data-mobile-nav-placement={mobileNavPlacement()} classList={{ "no-sidebar": !hasSidebar(), "sidebar-collapsed": sidebarCollapsed(), "mobile-sidebar-open": mobileSidebarOpen() }}>
      <Show when={channelMenu()}>
        {(menu) => <ContextMenu x={menu().x} y={menu().y} items={menu().items} onClose={() => setChannelMenu(null)} />}
      </Show>
      <PromptDialog
        open={!!renamingChannel()}
        title="Rename conversation"
        label="Channel name"
        value={channelName()}
        setValue={setChannelName}
        confirmLabel="Save name"
        busy={renamingBusy()}
        onConfirm={() => void saveChannelName()}
        onCancel={() => setRenamingChannel(null)}
      />

      <ConfirmDialog
        open={!!pendingChannel()}
        title="Delete conversation?"
        body={
          <>
            <strong>#{pendingChannel()?.name ?? "this channel"}</strong> is deleted for everyone, with every
            message, file and note in it. This cannot be undone.
          </>
        }
        confirmLabel="Delete conversation"
        busy={deletingChannel()}
        onConfirm={() => void deleteChannel()}
        onCancel={() => setPendingChannel(null)}
      />
      <Show when={dropNote()}>
        <p class="space-shell-note" role="status">{dropNote()}</p>
      </Show>
      <Show when={channelError()}>
        <p class="space-shell-error" role="alert">{channelError()}</p>
      </Show>
      <aside class="rail mobile-rail" aria-label="Mobile navigation">
        <For each={mobileRail()}>{entry => <a class="rail-item" aria-label={entry.label} classList={{ active: mode() === entry.mode }} onPointerDown={() => entry.mode === "chats" && setMobileSidebarOpen(true)} {...navLink(() => landingRoute(entry))}><span class="rail-icon"><Icon name={entry.icon} size={18} /></span><span class="rail-label">{entry.label}</span></a>}</For>
        <button class="rail-item" aria-label="More" classList={{ active: moreOpen() || mode() === "more" }} onClick={() => setMoreOpen(open => !open)}><span class="rail-icon"><Icon name="menu" size={18} /></span><span class="rail-label">More</span></button>
      </aside>
      <aside class="rail desktop-rail" aria-label="Main navigation">
        <div class="mark" aria-hidden="true">G</div>
        <For each={desktopRail()}>{railItem}</For>
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
        <button class="rail-item sidebar-toggle" aria-label="Toggle sidebar" title="Toggle sidebar" aria-pressed={sidebarCollapsed()} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
          <span class="rail-icon" aria-hidden="true">◀</span><span class="rail-label">Sidebar</span>
        </button>
        <div class="rail-spacer" />
        {/* A PLUS MUST CREATE. This button said "Create new", drew a plus, and opened
            the search — the one thing a plus never means. It now opens the same
            composer the sidebar's section `+` and the global `New message` open,
            organisation-scoped. Search keeps its own two addresses (the command bar
            and the sidebar's magnifier), both of which say "search". */}
        <button class="round-action" aria-label="New message" title="New message" onClick={() => setRecipientPickerOpen(true)}>
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
        <button class="mobile-sidebar-back" type="button" onClick={() => setMobileSidebarOpen(false)}>Back to chat</button>
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

        {/* One library per row, the organization's above the projects' — the same shape
            Chats uses for channels. Choosing a source happens HERE now, so the Documents
            page no longer carries a second picker of its own (one act, one place). */}
        <Show when={mode() === "library"}>
          {/* The personal container is the anchor and carries its OWN container in the
              link: arriving from a project library must actually switch the source. */}
          <a
            class="side-link strong"
            classList={{ active: route().containerType === "kb" && route().containerId === ORGANIZATION_LIBRARY_ID }}
            {...navLink(() => ({ view: "Documents", containerType: "kb", containerId: ORGANIZATION_LIBRARY_ID }))}
          >
            <span class="side-icon" aria-hidden="true"><Icon name="book-nav" size={15} /></span>
            Library
          </a>
          <div class="section">
            <div class="section-head"><span>Other organization libraries</span></div>
            <For each={orgLibraries()}>
              {(book) => (
                <a
                  class="side-link"
                  classList={{ active: route().containerType === "kb" && route().containerId === book.id }}
                  {...navLink(() => ({ view: "Documents", containerType: "kb", containerId: book.id }))}
                >
                  <span class="side-icon" aria-hidden="true"><Icon name="book-nav" size={15} /></span>
                  {book.name}
                </a>
              )}
            </For>
            <Show when={!orgLibraries().length}>
              <div class="side-empty">No organization library yet.</div>
            </Show>
          </div>
          <div class="section">
            <div class="section-head"><span>Project libraries</span></div>
            <For each={projectList()}>
              {(project) => (
                <a
                  class="side-link"
                  classList={{ active: route().containerType === "project" && route().containerId === project.id }}
                  {...navLink(() => ({ view: "Documents", containerType: "project", containerId: project.id }))}
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
              <div
                class="section-head"
                classList={{ "drop-into": dropTarget() === `project:${group.id}` }}
                onDragOver={(event) => {
                  // Only a real project takes a conversation; "Other channels" is the
                  // absence of one, so it is not a destination.
                  if (!group.id || !carries(event, "application/x-gaia-channel")) return;
                  event.preventDefault();
                  setDropTarget(`project:${group.id}`);
                }}
                onDragLeave={() => setDropTarget((current) => (current === `project:${group.id}` ? null : current))}
                onDrop={(event) => {
                  const channelId = event.dataTransfer?.getData("application/x-gaia-channel");
                  setDropTarget(null);
                  if (!channelId || !group.id) return;
                  event.preventDefault();
                  void attachChannelToProject(channelId, group.id);
                }}
              >
                <span>{group.label}</span>
                {/* The `+` is where "new conversation" lives now (it left Chat's sidebar). */}
                <button class="section-add" aria-label={`New channel in ${group.label}`} title="New channel" onClick={() => setNewChannelFor(group.id)}>+</button>
              </div>
              <For each={group.channels}>
                {(channel) => (
                  <a
                    class="channel"
                    classList={{
                      active: activeChannelId() === channel.id,
                      unread: channel.unread_count > 0,
                      "drop-into": dropTarget() === `channel:${channel.id}`,
                    }}
                    draggable={true}
                    onDragStart={(event) => event.dataTransfer?.setData("application/x-gaia-channel", channel.id)}
                    onDragOver={(event) => {
                      if (!carries(event, "application/x-gaia-document")) return;
                      event.preventDefault();
                      setDropTarget(`channel:${channel.id}`);
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === `channel:${channel.id}` ? null : current))}
                    onDrop={(event) => {
                      const payload = readPayload<{ id: string; title: string; path: string }>(event, "application/x-gaia-document");
                      setDropTarget(null);
                      if (!payload) return;
                      event.preventDefault();
                      void shareDocumentInto(channel, payload);
                    }}
                    onContextMenu={(event) => openChannelMenu(event, channel)}
                    onPointerDown={() => setSelectedChannel(channel)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedChannel(channel); }}
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
                  onContextMenu={(event) => openChannelMenu(event, channel)}
                  onPointerDown={() => setSelectedChannel({ ...channel, headerLabel: labelOfDirect(channel), avatarUrl: profiles()?.find((person) => person.display_name === labelOfDirect(channel))?.avatar_url })}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedChannel({ ...channel, headerLabel: labelOfDirect(channel), avatarUrl: profiles()?.find((person) => person.display_name === labelOfDirect(channel))?.avatar_url }); }}
                  {...navLink(() => ({ view: "Chat", entityType: "channel", entityId: channel.id, tab: "messages" }))}
                >
                  <span class="hash" aria-hidden="true">@</span>
                  {labelOfDirect(channel)}
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

      <Show when={recipientPickerOpen()}>
        <RecipientPicker onClose={() => setRecipientPickerOpen(false)} />
      </Show>

      <Show when={newChannelFor() !== undefined}>
        <NewChannelDialog
          projectId={newChannelFor() || undefined}
          projectLabel={groups().find((group) => group.id === newChannelFor())?.label}
          onClose={() => setNewChannelFor(undefined)}
          onCreated={(id) => {
            // The list is this shell's own read: a conversation created in the dialog
            // is invisible here until that read happens again.
            bumpChannels();
            linkEntity("channel", id);
          }}
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
              (`""` = no project pre-bound), so nothing became unreachable.

              Stage feat/new-message-picker: `New message` now opens RecipientPicker
              (a Telegram-style person/channel picker) instead of NewChannelDialog's
              content-type form. NewChannelDialog itself is untouched — the sidebar's
              per-project `+` (`setNewChannelFor`) still opens it, since that button
              needs the project preset a person-first picker has no reason to carry. */}
          <div class="top-actions">
            <button class="btn primary" onClick={() => setRecipientPickerOpen(true)}>New message</button>
          </div>
        </header>
        <section class="space-content">{props.children}</section>
      </main>
    </div>
  );
}
