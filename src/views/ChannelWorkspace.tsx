import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type JSX } from "solid-js";
import { chatApi, type Channel } from "../api/chat";
import { selectedChannel } from "../chatChannelSelection";
import { isDirectMessage, dmLabel } from "../chatPartition";
import { Avatar } from "../components/Avatar";
import { bumpChannels } from "../chatIdentity";
import { meetingsApi, type Meeting } from "../api/meetings";
import { buildChannelCallMeeting, CALL_RING_SECONDS, channelCallLabel, findLiveChannelMeeting, resolveChannelCall } from "./channelCall";
import { consumeChannelCallJoin, pendingChannelCallJoin } from "./channelCallJoin";
import CallPanel from "./CallPanel";
import { personalApi } from "../api/personal";
import { currentUser, humanError, isWeb, profileId, profiles, projects, reloadProfiles, reloadProjects } from "../session";
import { channelTabs, linkProps, navigate, route } from "../router";
import { GhostPill, PillMenu } from "../components/controls";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu from "../components/ContextMenu";
import EmptyState from "../components/EmptyState";
import Chat from "./Chat";
import "./ChannelWorkspace.css";
import "./Meetings.css";
import { UI_LOCALE } from "../calendar";

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

const CHANNEL_CALL_REFRESH_MS = Number(import.meta.env.VITE_CHANNEL_CALL_REFRESH_MS) || 5_000;
const hhmm = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(UI_LOCALE, { hour: "2-digit", minute: "2-digit" });

const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

export default function ChannelWorkspace(): JSX.Element {
  const channelId = () => (route().entityType === "channel" ? route().entityId ?? "" : "");
  const tab = (): TabKey => (route().tab as TabKey) || "messages";
  // Identity: web is bound to the authenticated profile, desktop to the acting one.
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();

  const [loadedChannel, { refetch: refetchChannel }] = createResource(channelId, (id) =>
    id ? chatApi.getChannel(id) : Promise.resolve<Channel | null>(null),
  );
  const channel = () => loadedChannel()?.id === channelId()
    ? loadedChannel()
    : selectedChannel()?.id === channelId() ? selectedChannel() : null;
  const channelProjectId = () => channel()?.project_id ?? "";
  const seededHeader = () => selectedChannel()?.id === channelId() ? selectedChannel()?.headerLabel : undefined;
  const channelTitle = () => {
    const current = channel();
    if (!current) return "";
    return seededHeader() ?? (isDirectMessage(current) ? dmLabel(current, actingProfileId()) : current.name ?? current.content_type);
  };
  void reloadProjects().catch(() => undefined);
  void reloadProfiles().catch(() => undefined);

  const project = createMemo(() => {
    const projectIdOfChannel = channelProjectId();
    return projectIdOfChannel ? projects()?.find((item) => item.id === projectIdOfChannel) : undefined;
  });
  const projectIdOf = () => project()?.id ?? "";

  // --- real sources only. A chip without a source is omitted, never faked. -------------
  const [members, { refetch: refetchMembers }] = createResource(channelId, (id) =>
    id ? chatApi.listChannelMembers(id) : Promise.resolve([]),
  );
  const [mentions] = createResource(actingProfileId, (id) =>
    id ? chatApi.listMentionsForProfile(id, true) : Promise.resolve([]),
  );
  const [dashboard] = createResource(projectIdOf, (id) =>
    id ? personalApi.projectDashboard(id) : Promise.resolve(undefined),
  );
  const [memberIds] = createResource(projectIdOf, (id) =>
    id ? personalApi.projectMemberIds(id) : Promise.resolve([] as string[]),
  );
  // Project-bound chat starts focused on the conversation. The project rail reveals
  // its two independent sections only when explicitly requested.
  const [statusOpen, setStatusOpen] = createSignal(false);
  const [teamOpen, setTeamOpen] = createSignal(false);
  // Meetings carry `channel_id`, so "next meeting" is genuinely channel-scoped here.
  const [meetings, { refetch: refetchMeetings }] = createResource(actingProfileId, (id) =>
 id ? meetingsApi.list(id) : Promise.resolve<Meeting[]>([]),
);
createEffect(() => {
 if (!actingProfileId()) return;
 const timer = window.setInterval(() => { void refetchMeetings(); }, CHANNEL_CALL_REFRESH_MS);
 onCleanup(() => window.clearInterval(timer));
});
const [openCall, setOpenCall] = createSignal<{ meeting: Meeting; audioOnly: boolean; autoJoin?: boolean }>();
const openExistingCall = (meeting: Meeting, audioOnly = false) => setOpenCall({ meeting, audioOnly, autoJoin: true });
createEffect(() => {
  // Global shell accepts on every route. Once its navigation lands here, this is the
  // one existing CallPanel join path (and no duplicate LiveKit join implementation).
  if (!pendingChannelCallJoin() || !channelId()) return;
  const request = consumeChannelCallJoin(channelId());
  if (request) openExistingCall(request.meeting, request.audioOnly);
});
const startCall = async (audioOnly: boolean) => {
 const current = channel(); const organizer = actingProfileId();
 setMemberError("");
 if (!organizer) { setMemberError("Sign-in still loading"); return; }
 if (!current) { setMemberError("Conversation still loading"); return; }
 const existing = resolveChannelCall(meetings(), current.id);
 if (existing) { openExistingCall(existing, audioOnly); return; }
 const meeting = buildChannelCallMeeting(current, organizer);
 try { const created = await meetingsApi.createChannelCall(meeting); setOpenCall({ meeting: created, audioOnly, autoJoin: true }); await refetchMeetings(); }
 catch (reason) { setMemberError(humanError(reason)); }
};
const callUnavailable = () => !channel() || !actingProfileId();
const callTitle = (label: "Call" | "Video") =>
 callUnavailable() ? (!actingProfileId() ? "Sign-in still loading" : "Conversation still loading") : label;
const liveMeeting = () => findLiveChannelMeeting(meetings(), channelId(), actingProfileId());
const channelCall = () => resolveChannelCall(meetings(), channelId());
const [callParticipants] = createResource(
  () => [channelCall()?.id, actingProfileId()] as const,
  ([meetingId, identity]) => meetingId && identity ? meetingsApi.participants(meetingId, identity) : Promise.resolve([]),
);
const callerCall = () => {
  const meeting = channelCall();
  return meeting?.organizer_id === actingProfileId() ? meeting : undefined;
};
const callerCallState = () => {
  const meeting = callerCall();
  if (!meeting) return "";
  const started = meeting.video_started_at ?? meeting.starts_at;
  return (callParticipants()?.length ?? 0) <= 1 && Math.floor(Date.now() / 1_000) - started <= CALL_RING_SECONDS ? "Ringing…" : "No answer";
};

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

  /* ── WHO IS IN A PROJECT-LESS CONVERSATION ────────────────────────────────
     A channel with a project inherits its people and the backend REFUSES edits to
     that roster (chat::guard_inherited_membership), so this surface only ever offers
     the controls where they can succeed: a free channel, which owns its own roster.
     The affordance is the members chip itself — it opens the Team panel in the rail,
     the same rail a project channel already has. One place, two sources of truth
     never. DMs are excluded: their two people ARE the conversation's identity. */
  const ownsMembership = () => !!channel() && !project() && channel()?.content_type !== "dm";
  const [memberBusy, setMemberBusy] = createSignal(false);
  const [memberError, setMemberError] = createSignal("");
  const memberIdSet = () => new Set((members() ?? []).map((entry) => entry.profile_id));
  /** Candidates are real profiles only, minus the people already in — a name can
      never be offered twice, and nobody outside the profile list can be added. */
  const addable = () =>
    (profiles() ?? []).filter((person) => !person.archived && !memberIdSet().has(person.id));

  const runMemberAction = async (action: () => Promise<void>) => {
    setMemberError("");
    setMemberBusy(true);
    try {
      await action();
      await refetchMembers();
    } catch (reason) {
      setMemberError(humanError(reason));
    } finally {
      setMemberBusy(false);
    }
  };
  const addMember = (personId: string) => {
    const id = channelId();
    if (!id || !personId || !ownsMembership()) return;
    void runMemberAction(() => chatApi.addChannelMember(id, personId, false));
  };
  const removeMember = (personId: string) => {
    const id = channelId();
    if (!id || !personId || !ownsMembership()) return;
    void runMemberAction(() => chatApi.removeChannelMember(id, personId));
  };

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
  // Revealed only from the `⋯` menu's "Attach to project…" item — the picker used to
  // sit permanently in the header for every project-less channel, whether or not
  // anyone had asked for it.
  const [showAttach, setShowAttach] = createSignal(false);
  const attachToProject = async (projectId: string) => {
    const current = channel();
    if (!current || !projectId) return;
    setBindError(""); setBinding(true);
    try {
      await chatApi.updateChannel({ ...current, project_id: projectId });
      await refetchChannel();
      setShowAttach(false);
    } catch (reason) {
      setBindError(humanError(reason));
    } finally {
      setBinding(false);
    }
  };
  const canAttach = () => !project() && channel()?.content_type !== "dm";
  // The header's one overflow menu (same component and pattern as views/Chat.tsx's
  // `channelMenu`) — Call and Video stay as their own buttons (frequent, one click),
  // everything else moves behind `⋯`.
  const [channelMenu, setChannelMenu] = createSignal<{ x: number; y: number }>();


  /* ── DELETING A CONVERSATION ──────────────────────────────────────────────
     A channel could be left, renamed and detached, but never ended: the only way
     out was to stop looking at it. Deleting is offered here, where the channel is
     the page's subject, and it always asks first — a conversation takes everyone's
     messages with it. */
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  /* Its own error line: `bindError` is only drawn for project-less channels, so a
     refused delete would have failed in silence everywhere else. */
  const [deleteError, setDeleteError] = createSignal("");
  const deleteChannel = async () => {
    const id = channelId();
    if (!id) return;
    setDeleteError("");
    setDeleting(true);
    try {
      await chatApi.deleteChannel(id, actingProfileId());
      setConfirmDelete(false);
      // The shell's sidebar reads its own copy of the list: tell it to re-read.
      bumpChannels();
      // Nothing to return to inside a channel that no longer exists.
      navigate({ view: "Chat" });
    } catch (reason) {
      setDeleteError(humanError(reason));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="channel-workspace">
      <ConfirmDialog
        open={confirmDelete()}
        title="Delete conversation?"
        body={
          <>
            <strong>#{channel()?.name ?? "this channel"}</strong> is deleted for everyone, with every
            message, file and note in it. This cannot be undone.
          </>
        }
        confirmLabel="Delete conversation"
        busy={deleting()}
        onConfirm={() => void deleteChannel()}
        onCancel={() => setConfirmDelete(false)}
      />
      <header class="cw-header">
        <div class="cw-title-row">
          <div class="cw-title">
            <Show when={project()}>{(value) => <div class="cw-kicker">{value().name}</div>}</Show>
            <div class="cw-title-line">
              <Show when={channel()?.content_type === "dm"} fallback={<h1># {channelTitle()}</h1>}>
                <div class="cw-dm-title"><Avatar name={channelTitle()} avatarUrl={selectedChannel()?.avatarUrl} size={30} /><h1>{channelTitle()}</h1><span class="cw-presence" aria-label="Available" /></div>
              </Show>
              {/* THE CHANNEL'S KIND, in one word, where the title already is — a fact,
                  not a control. DMs already say who they are with a face and a name. */}
              <Show when={channel() && channel()?.content_type !== "dm"}>
                <span class="cw-type-chip">{channel()?.content_type}</span>
              </Show>
            </div>
          </div>
          <div class="cw-metrics">
            {/* THE COUNT AND THE TEAM RAIL ARE NOW THE SAME PEOPLE. `list_channel_members`
                returns the effective membership — a project channel inherits the project's
                people — so the header can no longer say "1 members" over a rail of four.
                And the number is an ACT: it leads to the place membership is decided,
                which for a project channel is the project's settings, never here. */}
            <Show when={memberCount() > 0}>
              <Show
                when={project()}
                fallback={
                  <Show
                    when={ownsMembership()}
                    fallback={<span class="cw-pill"><strong>{memberCount()}</strong> members</span>}
                  >
                    {/* THE CHIP IS THE DOOR. A free channel's roster is editable, so its
                        count is a control, not a caption: it opens the Team panel where
                        people are added and removed. */}
                    <button
                      type="button"
                      class="cw-pill cw-pill-button"
                      aria-expanded={teamOpen()}
                      title="Add or remove people in this conversation"
                      onClick={() => setTeamOpen((open) => !open)}
                    >
                      <strong>{memberCount()}</strong> members · manage
                    </button>
                  </Show>
                }
              >
                {(owner) => (
                  <a
                    class="cw-pill cw-pill-link"
                    title={`Members come from ${owner().name}. Manage them in the project's settings.`}
                    {...linkProps({ view: "Project Settings", projectId: owner().id })}
                  >
                    <strong>{memberCount()}</strong> members · from {owner().name}
                  </a>
                )}
              </Show>
            </Show>
            {/* Call and Video stay direct buttons — the two acts reached from here most
                often. Everything else (attach, delete) now lives behind `⋯`. */}
            <button type="button" class="ghost small" aria-label="Call" title={callTitle("Call")} disabled={callUnavailable()} onClick={() => void startCall(true)}>Call</button>
<button type="button" class="ghost small" aria-label="Video" title={callTitle("Video")} disabled={callUnavailable()} onClick={() => void startCall(false)}>Video</button>
<button type="button" class="ghost small" aria-label="Channel actions" onClick={(event) => setChannelMenu({ x: event.clientX, y: event.clientY })}>⋯</button>
          </div>
        </div>
        <Show when={channelMenu()}>{(menu) => <ContextMenu x={menu().x} y={menu().y} onClose={() => setChannelMenu(undefined)} items={[
          ...(canAttach() ? [{ label: "Attach to project…", onSelect: () => setShowAttach(true) }] : []),
          { label: "Delete conversation", danger: true, onSelect: () => setConfirmDelete(true) },
        ]} />}</Show>

        {/* A fact, not a control: shown only when the channel actually has one, and
            never the placeholder "Not part of a project yet" that used to sit here
            whether or not there was anything to say. */}
        <Show when={channel()?.description}>{(text) => <p class="cw-subtitle">{text()}</p>}</Show>
        <Show when={memberError()}>
          <p class="cw-error" role="alert">{memberError()}</p>
        </Show>

        <Show when={deleteError()}>
          <p class="cw-error" role="alert">{deleteError()}</p>
        </Show>

        {/* The attach flow: revealed on request from the `⋯` menu, not permanently
            rendered under every project-less channel's header. */}
        <Show when={canAttach() && showAttach()}>
          <nav class="page-actionbar cw-actionbar">
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
          </nav>
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
        <Show when={liveMeeting()}>{(meeting) => <div class="cw-live-call" role="status">{channelCallLabel(meeting())} <span aria-hidden="true">·</span> <button type="button" class="ghost small" onClick={() => openExistingCall(meeting())}>Join</button></div>}</Show>
        <Show when={callerCall()}>{(meeting) => <div class="cw-live-call cw-caller-call" role="status"><strong>{callerCallState()}</strong><span aria-hidden="true">·</span><span>{meeting().title}</span></div>}</Show>
      </header>

      <div class="cw-body" classList={{ "with-rail": !!channelProjectId() || teamOpen() }}>
        <section class="cw-panel cw-chat">
          <Show when={openCall()}>{(call) => <div class="cw-call-panel"><CallPanel meeting={call().meeting} audioOnly={call().audioOnly} autoJoin={call().autoJoin} identity={isWeb() ? currentUser()?.profile_id ?? "" : actingProfileId() ?? ""} displayName={isWeb() ? currentUser()?.display_name ?? "" : nameOf(actingProfileId())}/></div>}</Show>
          {/* THE ONLY BODY THIS SURFACE HAS NOW: the messages. The five guest views
              that used to be mounted here are mounted by views/ProjectWorkspace.tsx
              instead, under the project's single tab row — one home each, not two.
              The scope provider goes with them; nothing here is a guest any more. */}
          <Chat embedded />
        </section>

        {/* THE FREE CHANNEL'S TEAM PANEL. Same rail, same card language as the project
            channel's — it just holds the controls the project channel is refused. */}
        <Show when={ownsMembership() && teamOpen()}>
          <aside class="cw-rail" aria-label="Channel members">
            <section class="cw-card cw-team">
              <div class="cw-card-head">
                <h2>Team</h2>
                <button type="button" class="cw-card-close" aria-label="Close members" onClick={() => setTeamOpen(false)}>×</button>
              </div>
              <p class="cw-quiet">Everyone here can read and write in #{channel()?.name}.</p>
              <For each={members()}>
                {(entry) => (
                  <div class="cw-person cw-person-row">
                    <span class="cw-mini" aria-hidden="true">{initials(nameOf(entry.profile_id))}</span>
                    <span class="cw-person-name">{nameOf(entry.profile_id)}</span>
                    <button
                      type="button"
                      class="cw-person-remove"
                      disabled={memberBusy()}
                      aria-label={`Remove ${nameOf(entry.profile_id)}`}
                      onClick={() => removeMember(entry.profile_id)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
              <div class="cw-team-add">
                <PillMenu
                  label="Add member"
                  value=""
                  placeholder="Add person…"
                  disabled={memberBusy() || !addable().length}
                  onChange={(id) => addMember(id)}
                  options={[
                    { value: "", label: "Add person…", disabled: true },
                    ...addable().map((person) => ({
                      value: person.id,
                      label: person.display_name || person.username,
                    })),
                  ]}
                />
              </div>
              <Show when={!addable().length}>
                <p class="cw-quiet">Everyone with a profile is already in this conversation.</p>
              </Show>
              <Show when={memberError()}>
                <p class="cw-error" role="alert">{memberError()}</p>
              </Show>
            </section>
          </aside>
        </Show>

        <Show when={channelProjectId()}>
            <aside class="cw-rail" aria-label="Project details">
              <div class="cw-rail-tabs" role="group" aria-label="Project details">
                <button type="button" class="cw-rail-toggle" classList={{ active: statusOpen() }} aria-controls="cw-project-status" aria-expanded={statusOpen()} onClick={() => setStatusOpen((open) => !open)}>
                  Project status
                </button>
                <button type="button" class="cw-rail-toggle" classList={{ active: teamOpen() }} aria-controls="cw-project-team" aria-expanded={teamOpen()} onClick={() => setTeamOpen((open) => !open)}>
                  Team
                </button>
              </div>
              <Show when={statusOpen()}>
                <section id="cw-project-status" class="cw-card">
                  <h2>{project()?.name ?? "Project"} · Project status</h2>
                  <div class="cw-stat"><span>Open tasks</span><strong>{dashboard()?.open_todos ?? "—"}</strong></div>
                  <div class="cw-stat"><span>Tasks</span><strong>{dashboard()?.open_issues ?? "—"}</strong></div>
                  <div class="cw-stat"><span>Next meeting</span><strong>{nextMeeting() ? hhmm(nextMeeting()!.starts_at) : "—"}</strong></div>
                  <div class="cw-stat"><span>Replies needed</span><strong>{repliesNeeded()}</strong></div>
                </section>
              </Show>
              <Show when={teamOpen()}>
                <section id="cw-project-team" class="cw-card">
                  <h2>Team</h2>
                  <Show when={(memberIds() ?? []).length} fallback={<EmptyState title="Nobody is in this project yet" actions={<GhostPill {...linkProps({ view: "Project Settings", projectId: project()?.id ?? "" })}>Add people</GhostPill>} />}>
                    <For each={memberIds()}>
                      {(id) => <div class="cw-person"><span class="cw-mini" aria-hidden="true">{initials(nameOf(id))}</span><span>{nameOf(id)} · {roleOf(id)}</span></div>}
                    </For>
                  </Show>
                </section>
              </Show>
            </aside>
        </Show>
      </div>
    </div>
  );
}
