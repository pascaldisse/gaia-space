import { For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js";
import { chatApi, type Channel } from "../api/chat";
import { meetingsApi } from "../api/meetings";
import { personalApi } from "../api/personal";
import { currentUser, humanError, profileId, profiles, projects, reloadProfiles, reloadProjects } from "../session";
import { channelTabs, linkProps, navigate, route } from "../router";
import { GhostPill, PillMenu } from "../components/controls";
import EmptyState from "../components/EmptyState";
import Chat from "./Chat";
import "./ChannelWorkspace.css";
import { UI_LOCALE } from "../calendar";
import { metricTone } from "../statusTone";

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
 *  - THE SCOPE IS DECIDED HERE (audit §3.5). This header writes the project and the
 *    channel; every view mounted below is wrapped in `EmbeddedScopeProvider`, so no
 *    guest repeats that title and none of them asks for a project, a container or an
 *    identity that this surface has already fixed.
 */

type TabKey = (typeof channelTabs)[number];

/** ── THE CHANNEL NO LONGER OWNS A TAB ROW (stage 19) ─────────────────────────
 *
 *  THE PRINCIPLE, decided in views/ProjectWorkspace.tsx: the tab row belongs to the
 *  PROJECT, and which channel you are reading is a selection INSIDE the Chats tab.
 *
 *  This surface is what the principle was decided against. It drew
 *      Messages · Overview · Tasks · Calendar · Files & Links · Notes & Decisions
 *  and FIVE of those six showed the PROJECT while hanging off the CHANNEL. So the
 *  same five surfaces were reachable two ways, with two different rows of tabs, and
 *  neither could be the canonical one.
 *
 *  The row is gone. What each tab held is not:
 *      overview -> the project workspace's landing   (/projects/<id>)
 *      tasks    -> its Tasks tab                     (/projects/<id>/tasks)
 *      calendar -> its Calendar tab                  (/projects/<id>/calendar)
 *      files    -> its Knowledge tab                 (/projects/<id>/knowledge)
 *      notes    -> the channel's own pane inside the Chats tab (notes are CHANNEL
 *                  scoped, so they stay with the channel object, not the project)
 *
 *  The legacy addresses stay alive rather than 404-ing: `WORK_TABS` below is the
 *  redirect table, applied once the channel's project is known (it cannot be known
 *  from the URL alone, which is why this is a runtime redirect and not a route rule). */
const WORK_TABS: Partial<Record<TabKey, string | undefined>> = {
  overview: undefined,      // the workspace landing
  tasks: "tasks",
  calendar: "calendar",
  files: "knowledge",
  notes: "chats",
};

const hhmm = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(UI_LOCALE, { hour: "2-digit", minute: "2-digit" });

const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

export default function ChannelWorkspace(): JSX.Element {
  const channelId = () => (route().entityType === "channel" ? route().entityId ?? "" : "");
  const tab = (): TabKey => (route().tab as TabKey) || "messages";
  // Identity: web is bound to the authenticated profile, desktop to the acting one.
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();

  const [channel, { refetch: refetchChannel }] = createResource(channelId, (id) =>
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
  /** "Replies needed" = unread mentions of me IN THIS CHANNEL. */
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
  const roleOf = (id: string) => (project()?.lead_id === id ? "Responsible" : "Member");

  /* THE REDIRECT. A shipped `/channel/<id>/tasks` link must still land on the tasks
     of that channel's project — it just lands there in the ONE place those tasks
     live now. `replace`, so the dead address does not sit in the back history. */
  createEffect(() => {
    const current = tab();
    const owner = project()?.id;
    if (!owner || current === "messages" || !(current in WORK_TABS)) return;
    const target = WORK_TABS[current];
    navigate(
      target === "chats"
        ? { view: "Project Workspace", projectId: owner, tab: "chats", entityType: "channel", entityId: channelId() }
        : { view: "Project Workspace", projectId: owner, ...(target ? { tab: target } : {}) },
      undefined, undefined, true,
    );
  });

  // A channel without a project shows no work tabs, because there would be nothing
  // behind them. That is not a dead end though: binding it to a project is a real,
  // reversible act, and it is the moment a conversation becomes a workspace.
  // `update_channel` writes the whole row, so the CURRENT channel is patched — never
  // a stale copy, or the name and description would travel back in time with it.
  const [binding, setBinding] = createSignal(false);
  const [bindError, setBindError] = createSignal("");
  const attachToProject = async (projectId: string) => {
    const current = channel();
    if (!current || !projectId) return;
    setBindError(""); setBinding(true);
    try {
      await chatApi.updateChannel({ ...current, project_id: projectId });
      await refetchChannel();
    } catch (reason) {
      setBindError(humanError(reason));
    } finally {
      setBinding(false);
    }
  };


  return (
    <div class="channel-workspace">
      <header class="cw-header">
        <div class="cw-title-row">
          <div class="cw-title">
            <Show when={project()}>{(value) => <div class="cw-kicker">{value().name}</div>}</Show>
            <h1># {channel()?.name ?? "Channel"}</h1>
            <Show when={channel()?.description}>{(text) => <p class="cw-subtitle">{text()}</p>}</Show>
          </div>
          <div class="cw-metrics">
            <Show when={memberCount() > 0}>
              <span class="cw-pill"><strong>{memberCount()}</strong> members</span>
            </Show>
            {/* Waiting on me -> amber, but ONLY when there is something to wait for:
                `metricTone` refuses a tone to zero, so this chip can never become a
                coloured warning about nothing (audit §3.7). */}
            <Show when={repliesNeeded() > 0}>
              <span class="cw-pill" classList={{ [metricTone(repliesNeeded(), "amber") || "untoned"]: true }}>
                <strong>{repliesNeeded()}</strong> replies needed
              </span>
            </Show>
            {/* No channel-bound meeting -> no chip. The prototype's "14:30 Meeting" has no
                other honest source: meetings bind to a channel, never to a project. */}
            <Show when={nextMeeting()}>
              {(meeting) => <span class="cw-pill"><strong>{hhmm(meeting().starts_at)}</strong> Meeting</span>}
            </Show>
          </div>
        </div>

        {/* A channel without a project has no work surfaces: the row is not drawn.
            In its place, the one act that would create them. */}
        <Show when={!project() && channel()?.content_type !== "dm"}>
          <div class="cw-attach">
            <span class="cw-attach-lead">Not part of a project yet</span>
            <PillMenu
              label="Attach to project"
              value=""
              placeholder="Attach to project…"
              disabled={binding() || !(projects() ?? []).length}
              onChange={(id) => void attachToProject(id)}
              options={[
                { value: "", label: "Attach to project…", disabled: true },
                ...(projects() ?? []).filter((item) => !item.archived).map((item) => ({
                  value: item.id, label: item.name, sub: "Adds Overview, Tasks, Calendar, Files, Notes",
                })),
              ]}
            />
            <Show when={bindError()}><span class="cw-attach-error" role="alert">{bindError()}</span></Show>
          </div>
        </Show>
        {/* NO TAB ROW. The one link out is to the project this conversation belongs
            to — where its tasks, calendar, knowledge and overview all live, under the
            project's own single row of tabs. */}
        <Show when={project()}>
          {(value) => (
            <div class="cw-owner">
              <span class="cw-owner-lead">Part of</span>
              <GhostPill {...linkProps({ view: "Project Workspace", projectId: value().id })}>
                {value().name} workspace →
              </GhostPill>
            </div>
          )}
        </Show>
      </header>

      <div class="cw-body" classList={{ "with-rail": !!project() }}>
        <section class="cw-panel cw-chat">
          {/* THE ONLY BODY THIS SURFACE HAS NOW: the messages. The five guest views
              that used to be mounted here are mounted by views/ProjectWorkspace.tsx
              instead, under the project's single tab row — one home each, not two.
              The scope provider goes with them; nothing here is a guest any more. */}
          <Chat embedded />
        </section>

        <Show when={project()}>
          {(value) => (
            <aside class="cw-rail" aria-label="Channel status">
              <section class="cw-card">
                {/* HONESTY: these are PROJECT figures, so the project owns the title. */}
                <h2>{value().name} · Project status</h2>
                <div class="cw-stat"><span>Open tasks</span><strong>{dashboard()?.open_todos ?? "—"}</strong></div>
                <div class="cw-stat"><span>Tickets</span><strong>{dashboard()?.open_issues ?? "—"}</strong></div>
                <div class="cw-stat">
                  <span>Next meeting</span>
                  <strong>{nextMeeting() ? hhmm(nextMeeting()!.starts_at) : "—"}</strong>
                </div>
                <div class="cw-stat"><span>Replies needed</span><strong>{repliesNeeded()}</strong></div>
              </section>

              <section class="cw-card">
                <h2>Create from message</h2>
                {/* SEAM: explanatory in stage 2. `onCreateWorkItem` is wired to the
                    WorkItemDrawer (parallel lane) without touching this markup — the drawer
                    opens from a message's action row, these rows only teach the mapping. */}
                <div class="cw-stat"><span>Regular work</span><span class="cw-tag teal">Task</span></div>
                <div class="cw-stat"><span>Bug or feature</span><span class="cw-tag">Ticket</span></div>
                <div class="cw-stat"><span>Date</span><span class="cw-tag amber">Calendar</span></div>
              </section>

              <section class="cw-card">
                <h2>Team</h2>
                {/* NOTHING YET. The action is real: Organization is where people
                    are added, and it is the only place this can be fixed. */}
                <Show when={(memberIds() ?? []).length} fallback={<EmptyState
                  title="Nobody is in this project yet"
                  actions={<GhostPill {...linkProps({ view: "Members" })}>Add people</GhostPill>}
                />}>
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
