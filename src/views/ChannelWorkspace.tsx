import { For, Show, createMemo, createResource, type JSX } from "solid-js";
import { chatApi, type Channel } from "../api/chat";
import { meetingsApi } from "../api/meetings";
import { personalApi } from "../api/personal";
import { currentUser, profileId, profiles, projects, reloadProfiles, reloadProjects } from "../session";
import { channelTabs, linkProps, route } from "../router";
import Chat from "./Chat";
import ProjectHome from "./ProjectHome";
import ProjectTasks from "./ProjectTasks";
import Calendar from "./Calendar";
import Documents from "./Documents";
import "./ChannelWorkspace.css";

/**
 * The channel as a workspace (GAIA Space redesign, stage 2).
 *
 * WRAPPER, not a fork: the message surface is the existing views/Chat.tsx, mounted
 * unchanged. Everything added here is chrome around it — a header, the tab row from the
 * router's `channelTabs` grammar, and the right rail — plus the EXISTING project views
 * mounted scoped to the channel's project.
 *
 * Product law (binding, stage 2 briefing):
 *  - Tasks belong to the PROJECT (`todos.project_id`). A channel has no task store.
 *  - A project-bound channel inherits project membership and shows the work tabs; a
 *    channel WITHOUT a project shows no tab row at all (hidden, never an empty tab).
 *  - The right rail's numbers are PROJECT numbers. The card is therefore labelled with
 *    the project name, so no figure can pretend to be about this channel alone.
 */

type TabKey = (typeof channelTabs)[number];
const TABS: { key: TabKey; label: string; needsProject: boolean }[] = [
  { key: "messages", label: "Nachrichten", needsProject: false },
  { key: "overview", label: "Projektübersicht", needsProject: true },
  { key: "tasks", label: "Aufgaben", needsProject: true },
  { key: "calendar", label: "Kalender", needsProject: true },
  { key: "files", label: "Dateien und Links", needsProject: true },
  { key: "notes", label: "Notizen & Entscheidungen", needsProject: true },
];

const hhmm = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

export default function ChannelWorkspace(): JSX.Element {
  const channelId = () => (route().entityType === "channel" ? route().entityId ?? "" : "");
  const tab = (): TabKey => (route().tab as TabKey) || "messages";
  // Identity: web is bound to the authenticated profile, desktop to the acting one.
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();

  const [channel] = createResource(channelId, (id) =>
    id ? chatApi.getChannel(id) : Promise.resolve<Channel | null>(null),
  );
  void reloadProjects().catch(() => undefined);
  void reloadProfiles().catch(() => undefined);

  const project = createMemo(() => {
    const projectIdOfChannel = channel()?.project_id;
    return projectIdOfChannel ? projects()?.find((item) => item.id === projectIdOfChannel) : undefined;
  });
  const projectIdOf = () => project()?.id ?? "";

  // --- real sources only. A chip without a source is omitted, never faked. -------------
  const [members] = createResource(channelId, (id) => (id ? chatApi.listChannelMembers(id) : Promise.resolve([])));
  const [mentions] = createResource(actingProfileId, (id) =>
    id ? chatApi.listMentionsForProfile(id, true) : Promise.resolve([]),
  );
  const [dashboard] = createResource(projectIdOf, (id) =>
    id ? personalApi.projectDashboard(id) : Promise.resolve(undefined),
  );
  const [memberIds] = createResource(projectIdOf, (id) =>
    id ? personalApi.projectMemberIds(id) : Promise.resolve([] as string[]),
  );
  // Meetings carry `channel_id`, so "next meeting" is genuinely channel-scoped here.
  const [meetings] = createResource(actingProfileId, (id) => (id ? meetingsApi.list(id) : Promise.resolve([])));

  const memberCount = () => members()?.length ?? 0;
  /** "Antworten nötig" = unread mentions of me IN THIS CHANNEL. */
  const repliesNeeded = () =>
    (mentions() ?? []).filter((mention) => mention.channel_id === channelId() && !mention.read).length;
  const nextMeeting = () => {
    const now = Date.now() / 1000;
    return (meetings() ?? [])
      .filter((meeting) => !meeting.archived && meeting.channel_id === channelId() && meeting.starts_at >= now)
      .sort((a, b) => a.starts_at - b.starts_at)[0];
  };

  const nameOf = (id: string) => {
    const person = profiles()?.find((item) => item.id === id);
    return person?.display_name || person?.username || id;
  };
  const roleOf = (id: string) => (project()?.lead_id === id ? "Lead" : "Mitglied");

  const tabs = () => TABS.filter((entry) => !entry.needsProject || !!project());
  const visibleTab = (): TabKey => (tabs().some((entry) => entry.key === tab()) ? tab() : "messages");

  return (
    <div class="channel-workspace">
      <header class="cw-header">
        <div class="cw-title-row">
          <div class="cw-title">
            <Show when={project()}>{(value) => <div class="cw-kicker">{value().name}</div>}</Show>
            <h1># {channel()?.name ?? "Kanal"}</h1>
            <Show when={channel()?.description}>{(text) => <p class="cw-subtitle">{text()}</p>}</Show>
          </div>
          <div class="cw-metrics">
            <Show when={memberCount() > 0}>
              <span class="cw-pill"><strong>{memberCount()}</strong> Mitglieder</span>
            </Show>
            <Show when={repliesNeeded() > 0}>
              <span class="cw-pill"><strong>{repliesNeeded()}</strong> Antworten nötig</span>
            </Show>
            {/* No channel-bound meeting -> no chip. The prototype's "14:30 Meeting" has no
                other honest source: meetings bind to a channel, never to a project. */}
            <Show when={nextMeeting()}>
              {(meeting) => <span class="cw-pill"><strong>{hhmm(meeting().starts_at)}</strong> Meeting</span>}
            </Show>
          </div>
        </div>

        {/* A channel without a project has no work surfaces: the row is not drawn. */}
        <Show when={project()}>
          <nav class="cw-tabs" aria-label="Kanalbereiche">
            <For each={tabs()}>
              {(entry) => (
                <a
                  class="cw-tab"
                  classList={{ active: visibleTab() === entry.key }}
                  aria-current={visibleTab() === entry.key ? "page" : undefined}
                  {...linkProps({ view: "Chat", entityType: "channel", entityId: channelId(), tab: entry.key })}
                >
                  {entry.label}
                </a>
              )}
            </For>
          </nav>
        </Show>
      </header>

      <div class="cw-body" classList={{ "with-rail": visibleTab() === "messages" && !!project() }}>
        <section class="cw-panel" classList={{ "cw-chat": visibleTab() === "messages" }}>
          <Show when={visibleTab() === "messages"}>
            {/* The existing chat view: it reads the channel off the same route. `embedded`
                means "this wrapper already draws the channel list and title" — Chat then
                renders neither, instead of rendering them hidden. */}
            <Chat embedded />
          </Show>
          <Show when={visibleTab() === "overview"}><ProjectHome project={project()} /></Show>
          <Show when={visibleTab() === "tasks"}><ProjectTasks projectId={projectIdOf()} /></Show>
          <Show when={visibleTab() === "calendar"}><Calendar projectId={projectIdOf()} /></Show>
          <Show when={visibleTab() === "files"}><Documents container="project" containerId={projectIdOf()} /></Show>
          <Show when={visibleTab() === "notes"}>
            {/* Honest empty state: there is no notes/decisions store in the data model.
                Documents is the file surface (tab "Dateien und Links"); minutes and
                decisions are not documents and are not silently faked as such. */}
            <div class="cw-empty" role="status">
              <h2>Notizen & Entscheidungen</h2>
              <p>Noch nicht verfügbar. Entscheidungen leben heute in Nachrichten und Dokumenten.</p>
            </div>
          </Show>
        </section>

        <Show when={visibleTab() === "messages" && project()}>
          {(value) => (
            <aside class="cw-rail" aria-label="Kanalstand">
              <section class="cw-card">
                {/* HONESTY: these are PROJECT figures, so the project owns the title. */}
                <h2>{value().name} · Projektstand</h2>
                <div class="cw-stat"><span>Offene Aufgaben</span><strong>{dashboard()?.open_todos ?? "—"}</strong></div>
                <div class="cw-stat"><span>Tickets</span><strong>{dashboard()?.open_issues ?? "—"}</strong></div>
                <div class="cw-stat">
                  <span>Nächstes Meeting</span>
                  <strong>{nextMeeting() ? hhmm(nextMeeting()!.starts_at) : "—"}</strong>
                </div>
                <div class="cw-stat"><span>Antworten nötig</span><strong>{repliesNeeded()}</strong></div>
              </section>

              <section class="cw-card">
                <h2>Aus Nachricht erstellen</h2>
                {/* SEAM: explanatory in stage 2. `onCreateWorkItem` is wired to the
                    WorkItemDrawer (parallel lane) without touching this markup — the drawer
                    opens from a message's action row, these rows only teach the mapping. */}
                <div class="cw-stat"><span>Normale Arbeit</span><span class="cw-tag teal">Aufgabe</span></div>
                <div class="cw-stat"><span>Bug oder Feature</span><span class="cw-tag">Ticket</span></div>
                <div class="cw-stat"><span>Termin</span><span class="cw-tag amber">Kalender</span></div>
              </section>

              <section class="cw-card">
                <h2>Team</h2>
                <Show when={(memberIds() ?? []).length} fallback={<p class="cw-quiet">Keine Projektmitglieder.</p>}>
                  <For each={memberIds()}>
                    {(id) => (
                      <div class="cw-person">
                        <span class="cw-mini" aria-hidden="true">{initials(nameOf(id))}</span>
                        <span>{nameOf(id)} · {roleOf(id)}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </section>
            </aside>
          )}
        </Show>
      </div>
    </div>
  );
}
