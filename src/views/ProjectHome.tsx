import { createMemo, createResource, For, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { personalApi, type Todo } from "../api/personal";
import type { Project } from "../api/platform";
import { profileId, profiles, projects, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { requestWorkIntent } from "./workIntent";
import "./ProjectHome.css";
import { MetricGrid, MetricTile } from "../components/blocks";

/** ── OVERVIEW IS A GLANCE (stage 12d) ───────────────────────────────────────
 *  It summarises and LINKS; it does not create. Overview and Tasks used to offer
 *  the same two composers, so neither could be "the" place to start work — the
 *  owner's words: *"the Overview already lets me create a task or a ticket. Right
 *  next to it there's Tasks, where the same possibility exists again."*
 *
 *  THE ONE EXCEPTION: a project with no tickets and no tasks at all. A glance over
 *  nothing, with no way forward, is a dead end — so exactly one primary appears,
 *  and it disappears again the moment the project holds anything.
 *
 *  NO SECOND DERIVATION: every number here is `personalApi.projectDashboard`, the
 *  same aggregate the owning surfaces answer to. The task list below is a preview
 *  of `projectTodos` — the very read the Tasks surface performs — never a source
 *  of counts, so the two surfaces cannot drift apart.
 *
 *  Usable two ways — as the routed "Project Overview" view (project read off the
 *  route) and embedded with an explicit `project` prop. */
export default function ProjectHome(props: { project?: Project }) {
  const project = createMemo(() => props.project ?? projects()?.find(item => item.id === route().projectId));
  const projectIdOf = () => project()?.id ?? "";
  const [dashboard, { refetch }] = createResource(projectIdOf, id => id ? personalApi.projectDashboard(id) : Promise.resolve(undefined));
  // Every member reads the same shared task list: `projectTodos` returns EVERY member's
  // running project tasks, the caller's profile is only the authorization subject.
  const [tasks] = createResource(
    () => [projectIdOf(), profileId()] as const,
    ([id, profile_id]) => id && profile_id ? personalApi.projectTodos(id, profile_id, false) : Promise.resolve([] as Todo[]),
  );
  const nameOf = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  /* Embedded in a channel workspace, "go to the tasks" means THIS channel's
     Tasks tab — leaving the conversation for the standalone view would be a
     loss of place. Same project either way; only the address differs. */
  const inChannel = () => (route().entityType === "channel" ? route().entityId : undefined);
  const tasksRoute = () => {
    const channelId = inChannel();
    return channelId
      ? { view: "Chat", entityType: "channel", entityId: channelId, tab: "tasks" }
      : { view: "Project Tasks", projectId: projectIdOf() };
  };
  const openTasks = () => navigate(tasksRoute());
  /* Tickets live in the tickets surface, which reads its project from the session
     (see Issues.tsx) — so the scope is written before the navigation, never asked
     for again with a picker. */
  const openTickets = () => { setProjectId(projectIdOf()); navigate({ view: "Issues" }); };
  const ticketLink = () => ({ ...linkProps({ view: "Issues" }), onClick: (event: MouseEvent) => { event.preventDefault(); openTickets(); } });
  /* THE one exception, and its exact condition: nothing exists anywhere in this
     project. Not "no running task" — a project with tickets has a way forward. */
  const projectEmpty = () => !!dashboard() && dashboard()!.open_issues === 0 && dashboard()!.open_todos === 0;
  const startFirstTask = () => { requestWorkIntent("new-task"); openTasks(); };
  const PREVIEW = 6;
  const preview = () => (tasks() ?? []).slice(0, PREVIEW);
  const overflow = () => Math.max(0, (tasks() ?? []).length - PREVIEW);

  return <section class="ph-view project-home" aria-label={`${project()?.name ?? "Project"} dashboard`}>
    <PageHeader icon="layers" kicker={project()?.name ?? "Project unavailable"} title="Project overview" subline="What is running, who is on it, and when it is due — each figure opens the surface that owns it." />
    {/* Re-reading changes what you SEE, not what exists: far end of the action row. */}
    <nav class="page-actionbar" aria-label="Project overview actions">
      <span class="actionbar-view-controls"><button type="button" class="ghost small" onClick={() => void refetch()}>Refresh</button></span>
    </nav>
    <Show when={project()} fallback={<p class="ph-empty" role="alert">This project does not exist or is unavailable.</p>}>{value => <>
      {/* ONE TILE (stage 11, defect 2): `.ph-stat` was this view's own shape.
          Each counting tile is now a LINK to the surface that owns the count —
          a glance whose numbers are dead ends is a glance you cannot act on. */}
      {/* A FAILED READ IS NAMED, never rendered as a zero (carried over from master,
          5680579): a glance that shows 0 open tickets because the read failed is a lie. */}
      <Show when={dashboard.error}><p class="planning-error" role="alert">Could not load project metrics: {String(dashboard.error)}</p></Show>
      <Show when={dashboard()} fallback={<Show when={!dashboard.error}><p class="hint">Loading project dashboard…</p></Show>}>{data => <MetricGrid label="Project at a glance" class="ph-stats">
        <MetricTile value={data()!.open_issues} label="Open tickets" tone="teal" aria-label={`${data()!.open_issues} open tickets — open the tickets surface`} {...ticketLink()} />
        <MetricTile value={data()!.open_todos} label="Open tasks" tone="teal" aria-label={`${data()!.open_todos} open tasks — open this project's tasks`} {...linkProps(tasksRoute())} />
        <MetricTile value={data()!.member_count} label="Members" {...linkProps({ view: "Project Settings", projectId: value().id })} />
        <MetricTile small value={data()!.deadline ?? "—"} label="Deadline" />
      </MetricGrid>}</Show>

      {/* LAW: the project lead is PURELY INFORMATIONAL. It names one main responsible
          person and grants NOTHING: no wider read, no exclusive write, no gated control.
          Every project member keeps identical ability to see all tasks and to create
          tasks for themselves AND for others. The only lead-related restriction anywhere
          is WHO MAY EDIT the field (owner-or-admin, in Project settings). */}
      <Show when={value().lead_id}>{id => <p class="ph-lead">Responsible <strong>{nameOf(id())}</strong></p>}</Show>

      <section class="ph-card">
        <div class="ph-card-head"><h2>Running tasks</h2><a class="ph-link" {...linkProps(tasksRoute())}>All project tasks →</a></div>
        <Show when={tasks.error}><p class="planning-error" role="alert">Could not load running tasks: {String(tasks.error)}</p></Show>
        <Show when={tasks.loading}><p class="hint">Loading project tasks…</p></Show>
        {/* NOTHING YET, not a filtered view: this list has no filters, so an
            empty result can only mean the project has no running task. Which of
            the two empty states applies is decided by the project as a whole. */}
        <Show when={!tasks.loading && !tasks.error && !preview().length}>
          <Show when={projectEmpty()} fallback={
            <EmptyState
              title="No running tasks in this project"
              hint="Nothing is in flight here right now. The tracked work is on the tickets surface."
              actions={<GhostPill {...ticketLink()}>Open tickets →</GhostPill>}
            />
          }>
            {/* THE EXCEPTION: an empty project, one primary, and it lands in the
                composer on the surface that owns tasks — never on a second empty page. */}
            <EmptyState
              title="This project is empty"
              hint="No tasks and no tickets yet. Start the shared task list and the glance fills itself."
              actions={<button type="button" class="primary" onClick={startFirstTask}>New task</button>}
            />
          </Show>
        </Show>
        <ul class="ph-list"><For each={preview()}>{task => <li role="button" tabindex="0" onClick={openTasks} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTasks(); } }}>
          <strong>{task.content}</strong>
          <small>{nameOf(task.profile_id)}</small>
          <small>{task.assignee_ids.length ? task.assignee_ids.map(nameOf).join(", ") : "Unassigned"}</small>
          <Show when={task.due_date}>{date => <time>{date()}</time>}</Show>
        </li>}</For></ul>
        {/* The preview is a preview and says so, rather than silently truncating. */}
        <Show when={overflow()}>{count => <p class="ph-more"><a class="ph-link" {...linkProps(tasksRoute())}>{count()} more task{count() === 1 ? "" : "s"} →</a></p>}</Show>
      </section>
    </>}</Show>
  </section>;
}
