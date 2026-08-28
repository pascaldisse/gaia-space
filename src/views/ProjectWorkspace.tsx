import { For, Show, createEffect, createMemo, createResource, createSignal, onMount, type JSX } from "solid-js";
import { chatApi, type ChannelSummary } from "../api/chat";
import { personalApi, type Todo } from "../api/personal";
import { planningApi } from "../api/issues";
import { pipelinesApi } from "../api/pipelines";
import { currentUser, humanError, profileId, profiles, projects, reloadProfiles, reloadProjects, setProjectId } from "../session";
import { linkProps, navigate, projectTabs, route, type ProjectTab, type Route } from "../router";
import { EmbeddedScopeProvider, type EmbeddedScope } from "../components/PageHeader";
import { SectionHeading } from "../components/blocks";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { requestWorkIntent } from "./workIntent";
import NotesLog from "../components/NotesLog";
import { deadlineTone, metricTone } from "../statusTone";
import { UI_LOCALE } from "../calendar";
import Chat from "./Chat";
import ProjectTasks from "./ProjectTasks";
import Calendar from "./Calendar";
import Documents from "./Documents";
import Boards from "./Boards";
import "../components/paper.css";
import "./ChatSpaceLight.css";
import "./ProjectWorkspace.css";

/**
 * ── THE PROJECT WORKSPACE ───────────────────────────────────────────────────
 *
 * THE PRINCIPLE, decided and written into the code:
 *
 *      THE TAB ROW BELONGS TO THE PROJECT.
 *      WHICH CHANNEL YOU ARE READING IS A SELECTION INSIDE THE CHATS TAB.
 *
 * Before this file there were THREE tab rows for one project, not two:
 *
 *   1. `ProjectContext` drew   Overview · Steering · Board · Tasks · Calendar · Settings
 *      above every `/projects/<id>/…` route.
 *   2. `ChannelWorkspace` drew Messages · Overview · Tasks · Calendar · Files · Notes
 *      above every `/channel/<id>/<tab>` route — five of those six tabs showed the
 *      PROJECT, hanging off the CHANNEL.
 *   3. `Projects` stacked a portfolio list, a board, a matrix report and an access
 *      panel on one page, which is a tab row with the tabs sawn off.
 *
 * Three spellings of one place is why the same surface could be reached two ways and
 * why neither reading could be "the" one. There is now one frame, one tab row, five
 * tabs, and the channel is an OBJECT inside the first of them — exactly as a channel
 * is an object in the shell's sidebar.
 *
 * WHY THE OVERVIEW IS NOT A SIXTH TAB: the project's own NAME is its home, the way a
 * channel's name is. A tab row whose landing is also one of its entries names the same
 * place twice, and the owner named five tabs. So the header title is the link to the
 * overview and carries `aria-current` there; the five tabs are the five sections.
 *
 * THE FRAME IS ALSO THE FRAME FOR WHAT IS NOT A TAB. Steering, Settings and a single
 * ticket render as `props.children` inside this same header — one tab row on every
 * project address, never a second one, and never a page that forgets where it is.
 */

const TABS: { key: ProjectTab; label: string }[] = [
  { key: "chats", label: "Chats" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "knowledge", label: "Knowledge" },
  { key: "dev", label: "Dev" },
];

const hhmm = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(UI_LOCALE, { hour: "2-digit", minute: "2-digit" });
/** A time for a paper row: today reads as a clock, anything older as a date. */
const whenLabel = (seconds: number | null | undefined) => {
  if (!seconds) return "";
  const at = new Date(seconds * 1000);
  const today = new Date();
  return at.toDateString() === today.toDateString()
    ? hhmm(seconds)
    : at.toLocaleDateString(UI_LOCALE, { day: "2-digit", month: "short" });
};
const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

export default function ProjectWorkspace(props: { children?: JSX.Element }): JSX.Element {
  const projectIdOf = () => route().projectId ?? "";
  const tab = (): ProjectTab | undefined => {
    const value = route().tab;
    return projectTabs.includes(value as ProjectTab) ? (value as ProjectTab) : undefined;
  };
  /** This frame owns a tab only on its OWN view. Steering / Settings / a ticket are
   *  guests: the header stays, no tab lights, and the guest renders below it. */
  const ownsBody = () => route().view === "Project Workspace";
  const onOverview = () => ownsBody() && !tab();
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();

  onMount(() => { void reloadProjects().catch(() => undefined); void reloadProfiles().catch(() => undefined); });
  // Desktop has no URL of its own, so the session's project follows the address.
  createEffect(() => { const id = projectIdOf(); if (id) setProjectId(id); });

  const project = createMemo(() => projects()?.find((item) => item.id === projectIdOf()));
  const nameOf = (id: string) => {
    const person = profiles()?.find((item) => item.id === id);
    return person?.display_name || person?.username || id;
  };

  const [dashboard] = createResource(projectIdOf, (id) =>
    id ? personalApi.projectDashboard(id) : Promise.resolve(undefined),
  );
  // Every member reads the SAME shared list: `projectTodos` returns every member's
  // running work; the acting profile is only the authorization subject.
  const [tasks] = createResource(
    () => [projectIdOf(), actingProfileId()] as const,
    ([id, profile]) => (id && profile ? personalApi.projectTodos(id, profile, false) : Promise.resolve([] as Todo[])),
  );
  const [channels] = createResource(actingProfileId, (id) =>
    id ? chatApi.listChannelsWithMeta(id) : Promise.resolve<ChannelSummary[]>([]),
  );

  /** The project's conversations, most recently spoken in first. */
  const projectChannels = createMemo(() =>
    (channels() ?? [])
      .filter((channel) => channel.project_id === projectIdOf() && !channel.archived && !!channel.name)
      .sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0)),
  );
  const runningTasks = createMemo(() => (tasks() ?? []).filter((task) => !task.done));
  const unreadTotal = () => projectChannels().reduce((sum, channel) => sum + (channel.unread_count || 0), 0);

  const deadline = createMemo(() => {
    const value = project()?.deadline;
    return value ? { date: value, ...deadlineTone(value) } : undefined;
  });

  /** The channel selected INSIDE the Chats tab. */
  const selectedChannelId = () => (route().entityType === "channel" ? route().entityId ?? "" : "");
  const chatsRoute = (channelId?: string): Route =>
    channelId
      ? { view: "Project Workspace", projectId: projectIdOf(), tab: "chats", entityType: "channel", entityId: channelId }
      : { view: "Project Workspace", projectId: projectIdOf(), tab: "chats" };
  const tabRoute = (key: ProjectTab): Route => ({ view: "Project Workspace", projectId: projectIdOf(), tab: key });
  const overviewRoute = (): Route => ({ view: "Project Workspace", projectId: projectIdOf() });

  /* THE SCOPE IS DECIDED HERE. Every view mounted below is a GUEST: the project is
     already named by this header, so no guest repeats the title and none of them asks
     for a project, a container or an identity this surface has already fixed. */
  const embeddedScope = createMemo<EmbeddedScope>(() => ({
    host: project()?.name ?? "Project",
    projectId: projectIdOf() || undefined,
    container: "project",
    containerId: projectIdOf() || undefined,
    identityLocked: true,
  }));

  return (
    <div class="project-workspace">
      <header class="pw-header">
        <div class="pw-title-row">
          <div class="pw-title">
            <div class="pw-kicker">Project</div>
            {/* THE TITLE IS THE HOME LINK. A single click, a real href — never a
                double-click target, which is neither discoverable nor reachable
                from the keyboard. */}
            <h1>
              <a
                class="pw-home"
                classList={{ active: onOverview() }}
                aria-current={onOverview() ? "page" : undefined}
                {...linkProps(overviewRoute())}
              >
                {project()?.name ?? "Project unavailable"}
              </a>
              <Show when={project()?.key}>{(value) => <code class="pw-key">{value()}</code>}</Show>
            </h1>
            <p class="pw-lead">
              Lead <strong>{project()?.lead_id ? nameOf(project()!.lead_id!) : "No lead yet"}</strong>
            </p>
          </div>
          <div class="pw-edge">
            {/* A deadline is the one figure that earns colour up here, and only when
                it is actually near or past — `deadlineTone` decides, not this view. */}
            <Show when={deadline()}>
              {(info) => (
                <a class="pw-deadline" classList={{ [info().tone]: true }} {...linkProps(tabRoute("calendar"))}>
                  <span class="pw-deadline-label">Deadline</span>
                  <time>{info().date}</time>
                  <em>{info().note}</em>
                </a>
              )}
            </Show>
            {/* NOT TABS, AND NOT ALL OF THEM UP HERE EITHER. Settings is the one thing
                a person opens FROM a project that is not one of its five sections.
                Steering was the second, and the owner removed it: it is a report, it
                has its own address and it is listed under More — it does not need a
                permanent seat next to the project's name. */}
            <div class="pw-header-actions">
              <GhostPill {...linkProps({ view: "Project Settings", projectId: projectIdOf() })}>Settings</GhostPill>
            </div>
          </div>
        </div>

        {/* THE ONE TAB ROW. It belongs to the project. */}
        <nav class="pw-tabs" aria-label="Project sections">
          <For each={TABS}>
            {(entry) => (
              <a
                class="pw-tab"
                classList={{ active: tab() === entry.key }}
                aria-current={tab() === entry.key ? "page" : undefined}
                {...linkProps(tabRoute(entry.key))}
              >
                {entry.label}
                <Show when={entry.key === "chats" && unreadTotal() > 0}>
                  <span class="pw-tab-count">{unreadTotal()}</span>
                </Show>
                <Show when={entry.key === "tasks" && runningTasks().length > 0}>
                  <span class="pw-tab-count">{runningTasks().length}</span>
                </Show>
              </a>
            )}
          </For>
        </nav>
      </header>

      <div class="pw-body">
        <Show
          when={project()}
          fallback={
            <div class="pw-pad">
              <EmptyState
                title="This project does not exist or is unavailable"
                hint="It may have been archived, or your account may not have access to it."
                actions={<GhostPill {...linkProps({ view: "Projects" })}>All projects →</GhostPill>}
              />
            </div>
          }
        >
          <Show when={ownsBody()} fallback={
            /* Steering, Settings, one ticket. Same frame, same tab row, no second header. */
            <EmbeddedScopeProvider scope={embeddedScope()}>
              <div class="pw-guest">{props.children}</div>
            </EmbeddedScopeProvider>
          }>
            <Show when={onOverview()}>
              <ProjectOverview
                projectName={project()!.name}
                tasks={runningTasks()}
                tasksLoading={tasks.loading}
                tasksError={tasks.error ? humanError(tasks.error) : ""}
                channels={projectChannels()}
                channelsLoading={channels.loading}
                openIssues={dashboard()?.open_issues}
                nameOf={nameOf}
                tasksRoute={tabRoute("tasks")}
                chatsRoute={chatsRoute()}
                channelRoute={chatsRoute}
              />
            </Show>

            <EmbeddedScopeProvider scope={embeddedScope()}>
              <Show when={tab() === "chats"}>
                <ProjectChats
                  channels={projectChannels()}
                  loading={channels.loading}
                  selectedId={selectedChannelId()}
                  channelRoute={chatsRoute}
                  projectId={projectIdOf()}
                  authorId={actingProfileId() ?? ""}
                />
              </Show>
              <Show when={tab() === "tasks"}><div class="pw-pad"><ProjectTasks projectId={projectIdOf()} /></div></Show>
              <Show when={tab() === "calendar"}><div class="pw-pad"><Calendar projectId={projectIdOf()} /></div></Show>
              <Show when={tab() === "knowledge"}>
                <div class="pw-pad"><Documents container="project" containerId={projectIdOf()} /></div>
              </Show>
              <Show when={tab() === "dev"}><div class="pw-pad"><ProjectDev projectId={projectIdOf()} /></div></Show>
            </EmbeddedScopeProvider>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/** ── THE OVERVIEW ─────────────────────────────────────────────────────────────
 *  The two things in the FOREGROUND are RUNNING TASKS and RUNNING CHATS, in the
 *  language of the chat surface itself: quiet paper rows with an avatar, a name and
 *  a time. Not a dense navy table — the owner's whole point was that a project
 *  should read like the conversations it is made of. */
function ProjectOverview(props: {
  projectName: string;
  tasks: Todo[];
  tasksLoading: boolean;
  tasksError: string;
  channels: ChannelSummary[];
  channelsLoading: boolean;
  openIssues: number | undefined;
  nameOf: (id: string) => string;
  tasksRoute: Route;
  chatsRoute: Route;
  channelRoute: (channelId: string) => Route;
}): JSX.Element {
  const PREVIEW = 8;
  const taskPreview = () => props.tasks.slice(0, PREVIEW);
  const taskOverflow = () => Math.max(0, props.tasks.length - PREVIEW);

  return (
    <div class="pw-overview">
      {/* RUNNING TASKS — first, because it is what the owner asked to see first. */}
      <section class="pw-card">
        <SectionHeading
          title="Running tasks"
          meta={props.tasks.length ? `${props.tasks.length} in flight` : undefined}
          actions={<GhostPill {...linkProps(props.tasksRoute)}>All tasks →</GhostPill>}
        />
        <Show when={props.tasksError}><p class="error" role="alert">Could not load running tasks: {props.tasksError}</p></Show>
        <Show when={props.tasksLoading}><p class="paper-loading">Loading running tasks…</p></Show>
        <Show when={!props.tasksLoading && !props.tasksError && !props.tasks.length}>
          {/* The offer must answer the sentence above it. "No task is running" is
              answered by starting one — not by leaving for the Dev tab, which was a
              leftover from the ticket bridge and sent the reader away from the very
              thing the card is about. */}
          <EmptyState
            title="Nothing is running in this project"
            hint="No task is in flight right now."
            actions={<button type="button" class="primary" onClick={() => { requestWorkIntent("new-task"); navigate(props.tasksRoute); }}>New task</button>}
          />
        </Show>
        <ul class="pw-rows">
          <For each={taskPreview()}>
            {(task) => (
              <li class="paper-row pw-row">
                <a class="pw-row-link" {...linkProps(props.tasksRoute)}>
                  <span class="pw-avatar" aria-hidden="true">{initials(props.nameOf(task.profile_id))}</span>
                  <span class="pw-row-main">
                    <span class="paper-row-title">{task.content}</span>
                    <span class="paper-row-meta">
                      {task.assignee_ids.length ? task.assignee_ids.map(props.nameOf).join(", ") : "Unassigned"}
                    </span>
                  </span>
                  <Show when={task.due_date}>{(due) => <time class="pw-row-time">{due()}</time>}</Show>
                </a>
              </li>
            )}
          </For>
        </ul>
        <Show when={taskOverflow()}>
          {(count) => (
            <p class="pw-more">
              <a {...linkProps(props.tasksRoute)}>{count()} more task{count() === 1 ? "" : "s"} →</a>
            </p>
          )}
        </Show>
      </section>

      {/* RUNNING CHATS — the conversations of this project, newest first. */}
      <section class="pw-card">
        <SectionHeading
          title="Running chats"
          meta={props.channels.length ? `${props.channels.length} channel${props.channels.length === 1 ? "" : "s"}` : undefined}
          actions={<GhostPill {...linkProps(props.chatsRoute)}>All chats →</GhostPill>}
        />
        <Show when={props.channelsLoading}><p class="paper-loading">Loading conversations…</p></Show>
        <Show when={!props.channelsLoading && !props.channels.length}>
          <EmptyState
            title="No conversation belongs to this project yet"
            hint="A channel becomes part of a project when it is created in it, or attached to it from the channel itself."
          />
        </Show>
        <ul class="pw-rows">
          <For each={props.channels}>
            {(channel) => (
              <li class="paper-row pw-row" classList={{ unread: channel.unread_count > 0 }}>
                <a class="pw-row-link" {...linkProps(props.channelRoute(channel.id))}>
                  <span class="pw-avatar hash" aria-hidden="true">#</span>
                  <span class="pw-row-main">
                    <span class="paper-row-title">{channel.name}</span>
                    <span class="paper-row-meta">
                      {channel.member_count} member{channel.member_count === 1 ? "" : "s"}
                      <Show when={channel.description}>{(text) => <> · {text()}</>}</Show>
                    </span>
                  </span>
                  {/* ZERO CARRIES NO TONE: `metricTone` refuses a colour to 0, so a
                      quiet channel can never wear a badge about nothing. */}
                  <Show when={channel.unread_count > 0}>
                    <span class="paper-pill" classList={{ [metricTone(channel.unread_count, "teal") || "untoned"]: true }}>
                      {channel.unread_count}
                    </span>
                  </Show>
                  <time class="pw-row-time">{whenLabel(channel.last_message_at)}</time>
                </a>
              </li>
            )}
          </For>
        </ul>
      </section>
    </div>
  );
}

/** ── CHATS ────────────────────────────────────────────────────────────────────
 *  The project's channels beside their messages. The channel is an OBJECT of this
 *  tab, selected in the list on the left; it does not get a tab row of its own.
 *
 *  `Notes & decisions` (the channel-scoped `NotesLog` that used to be the sixth tab
 *  of the channel workspace) lives HERE, as one toggle inside the selected channel's
 *  pane. Deliberately a single control and not a second tab row: notes are scoped to
 *  the CHANNEL, so they belong to the channel object, not to the project's sections. */
function ProjectChats(props: {
  channels: ChannelSummary[];
  loading: boolean;
  selectedId: string;
  channelRoute: (channelId: string) => Route;
  projectId: string;
  authorId: string;
}): JSX.Element {
  /* Local, NOT route state, and that is the judgement: the URL says which project,
     which tab and which channel — the three things you would send somebody. Which of
     a channel's two panes you happen to be looking at is scratch state of this view,
     the same rule `router.ts` already applies to a search term. It also resets when
     the channel changes, which is what you want. */
  const [notesOpen, setNotesOpen] = createSignal(false);
  createEffect(() => { props.selectedId; setNotesOpen(false); });
  const selected = () => props.channels.find((channel) => channel.id === props.selectedId);

  return (
    <div class="pw-chats">
      <aside class="pw-channel-list" aria-label="Project channels">
        <div class="paper-section-label">Channels</div>
        <Show when={props.loading}><p class="paper-loading">Loading…</p></Show>
        <Show when={!props.loading && !props.channels.length}>
          <p class="paper-empty">No channel belongs to this project yet.</p>
        </Show>
        <For each={props.channels}>
          {(channel) => (
            <a
              class="pw-channel"
              classList={{ active: props.selectedId === channel.id, unread: channel.unread_count > 0 }}
              aria-current={props.selectedId === channel.id ? "page" : undefined}
              {...linkProps(props.channelRoute(channel.id))}
            >
              <span class="hash" aria-hidden="true">#</span>
              <span class="pw-channel-name">{channel.name}</span>
              <Show when={channel.unread_count > 0}><span class="pw-channel-count">{channel.unread_count}</span></Show>
            </a>
          )}
        </For>
      </aside>

      <section class="pw-channel-pane">
        <Show
          when={props.selectedId}
          fallback={
            <div class="pw-pad">
              <EmptyState
                title="Pick a conversation"
                hint="The project's channels are listed beside this pane. Selecting one opens its messages here."
              />
            </div>
          }
        >
          {/* ONE control, not a tab row: it swaps what the CHANNEL shows, and the
              channel is an object of this tab. */}
          <div class="pw-channel-tools">
            <strong class="pw-channel-title"># {selected()?.name ?? "Channel"}</strong>
            <GhostPill aria-pressed={notesOpen()} onClick={() => setNotesOpen((open) => !open)}>
              {notesOpen() ? "Messages" : "Notes & decisions"}
            </GhostPill>
          </div>
          <Show when={!notesOpen()} fallback={
            <div class="pw-pad">
              <NotesLog channelId={props.selectedId} projectId={props.projectId} authorId={props.authorId} />
            </div>
          }>
            {/* The EXISTING chat view, mounted unchanged: it reads the channel off
                the same route this list writes. */}
            <Chat embedded />
          </Show>
        </Show>
      </section>
    </div>
  );
}

/** ── DEV ──────────────────────────────────────────────────────────────────────
 *  Tickets and boards for this project — and the honest answer about linking a
 *  repository.
 *
 *  WHAT I FOUND ABOUT "LINK A REPOSITORY" (evidence, not a guess):
 *   - `src-tauri/src/git.rs` registers repo_list / repo_add / repo_remove / repo_info /
 *     repo_log / repo_branches / repo_status / repo_diff / repo_stage / repo_commit.
 *     EVERY ONE of them is keyed by a filesystem `path: String`. Not one takes a
 *     project id.
 *   - The registry those commands read and write is `repos.json` on the local disk
 *     (`store_path()` -> `<data dir>/gaia-space/repos.json`, `load_store`/`save_store`),
 *     a per-machine list of `RepoRef { name, path }`. It is not in the database at all,
 *     so there is no row a project id could be attached to and nothing to share
 *     between two people looking at the same project.
 *   - A PACKAGE repository is a different thing and DOES carry a project:
 *     `PackageRepository.project_id` (src/api/pipelines.ts) — that is what is surfaced
 *     below, because it is real.
 *
 *  So a git repository CANNOT be attached to a project today. This renders that as an
 *  honest empty state rather than a dead control, and says exactly what is missing. */
function ProjectDev(props: { projectId: string }): JSX.Element {
  const [tickets] = createResource(
    () => props.projectId,
    async (id) => {
      if (!id) return { open: 0, total: 0 };
      const [issues, statuses] = await Promise.all([planningApi.issues({ project_id: id }), planningApi.statuses(id)]);
      const resolved = new Set(statuses.filter((status) => status.resolved).map((status) => status.id));
      const live = issues.filter((issue) => !issue.archived);
      return { open: live.filter((issue) => !resolved.has(issue.status_id ?? "")).length, total: live.length };
    },
  );
  // Package repositories genuinely bind to a project, so this list is real data.
  const [packageRepos] = createResource(
    () => props.projectId,
    async (id) => (id ? (await pipelinesApi.listPackageRepositories()).filter((repo) => repo.project_id === id && !repo.archived) : []),
  );

  return (
    <div class="pw-dev">
      <section class="pw-card">
        <SectionHeading
          title="Tickets and boards"
          meta={tickets() ? `${tickets()!.open} open of ${tickets()!.total}` : undefined}
        />
        {/* The board that used to be stacked on the ALL-PROJECTS page. It belongs to
            the project you opened, which is here. */}
        <Boards />
      </section>

      <section class="pw-card">
        <SectionHeading
          title="Repository"
          meta={packageRepos()?.length ? `${packageRepos()!.length} package repositor${packageRepos()!.length === 1 ? "y" : "ies"}` : undefined}
        />
        <Show when={packageRepos()?.length}>
          <ul class="pw-rows">
            <For each={packageRepos()}>
              {(repo) => (
                <li class="paper-row pw-row">
                  <a class="pw-row-link" {...linkProps({ view: "Packages" })}>
                    <span class="pw-avatar hash" aria-hidden="true">P</span>
                    <span class="pw-row-main">
                      <span class="paper-row-title">{repo.name}</span>
                      <span class="paper-row-meta">{repo.format} · {repo.mode} · {repo.access_level.toLowerCase()}</span>
                    </span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
        {/* AN HONEST EMPTY STATE, NOT A DEAD CONTROL. There is no "Link repository"
            button here because pressing it could not do anything: see the evidence in
            this component's doc comment. The offer that IS real is the git client. */}
        <EmptyState
          title="A git repository cannot be linked to a project yet"
          hint="Repositories are registered per machine by their filesystem path (repos.json) and carry no project. Binding one would need a stored project↔repository row and a command to write it; until then this tab shows the project's tickets, boards and package repositories, which are real."
          actions={<GhostPill {...linkProps({ view: "Repos" })}>Open repositories →</GhostPill>}
        />
      </section>
    </div>
  );
}
