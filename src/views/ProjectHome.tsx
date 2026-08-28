import { createMemo, createResource, For, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { personalApi, type Todo } from "../api/personal";
import type { Project } from "../api/platform";
import { profileId, profiles, projects } from "../session";
import { linkProps, navigate, route } from "../router";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { requestWorkIntent } from "./workIntent";
import "./ProjectHome.css";

/** Project overview is deliberately derived: cards and dashboard share the same project id.
 *  Usable two ways — as the routed "Project Overview" view (project read off the route) and
 *  embedded with an explicit `project` prop. */
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
  const openTasks = () => {
    const channelId = inChannel();
    navigate(channelId
      ? { view: "Chat", entityType: "channel", entityId: channelId, tab: "tasks" }
      : { view: "Project Tasks", projectId: projectIdOf() });
  };
  /* The project is already known on this surface, so both actions are
     pre-scoped to it and the destination opens the form itself — no picker,
     and no landing on a second empty page. */
  const startWork = (intent: "new-task" | "new-issue") => { requestWorkIntent(intent); openTasks(); };

  return <section class="ph-view project-home" aria-label={`${project()?.name ?? "Project"} dashboard`}>
    <PageHeader kicker={project()?.name ?? "Project unavailable"} title="Project overview" actions={<button class="ghost small" onClick={() => void refetch()}>Refresh</button>} />
    <Show when={project()} fallback={<p class="ph-empty" role="alert">This project does not exist or is unavailable.</p>}>{value => <>
      <Show when={dashboard()} fallback={<p class="hint">Loading project dashboard…</p>}>{data => <div class="ph-stats">
        <div class="ph-stat"><span class="ph-stat-num">{data()!.open_issues}</span><span class="ph-stat-label">Open tickets</span></div>
        <div class="ph-stat"><span class="ph-stat-num">{data()!.open_todos}</span><span class="ph-stat-label">Open tasks</span></div>
        <div class="ph-stat"><span class="ph-stat-num">{data()!.member_count}</span><span class="ph-stat-label">Members</span></div>
        <div class="ph-stat"><span class="ph-stat-num sm">{data()!.deadline ?? "—"}</span><span class="ph-stat-label">Deadline</span></div>
      </div>}</Show>

      {/* LAW: the project lead is PURELY INFORMATIONAL. It names one main responsible
          person and grants NOTHING: no wider read, no exclusive write, no gated control.
          Every project member keeps identical ability to see all tasks and to create
          tasks for themselves AND for others. The only lead-related restriction anywhere
          is WHO MAY EDIT the field (owner-or-admin, in Project settings). */}
      <p class="ph-lead">Lead <strong>{value().lead_id ? nameOf(value().lead_id!) : "No lead yet"}</strong></p>

      <section class="ph-card">
        <div class="ph-card-head"><h2>Running tasks</h2><a class="ph-link" {...linkProps({ view: "Project Tasks", projectId: value().id })}>All project work</a></div>
        <Show when={tasks.loading}><p class="hint">Loading project tasks…</p></Show>
        {/* NOTHING YET, not a filtered view: this list has no filters, so an
            empty result can only mean the project has no running task. */}
        <Show when={!tasks.loading && !tasks()?.length}>
          <EmptyState
            title="No running tasks in this project yet"
            hint="Start the shared to-do list, or file the first ticket for tracked work."
            actions={<>
              <button type="button" class="primary" onClick={() => startWork("new-task")}>New task</button>
              <GhostPill onClick={() => startWork("new-issue")}>New ticket</GhostPill>
            </>}
          />
        </Show>
        <ul class="ph-list"><For each={tasks()}>{task => <li role="button" tabindex="0" onClick={openTasks} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTasks(); } }}>
          <strong>{task.content}</strong>
          <small>{nameOf(task.profile_id)}</small>
          <small>{task.assignee_ids.length ? task.assignee_ids.map(nameOf).join(", ") : "Unassigned"}</small>
          <Show when={task.due_date}>{date => <time>{date()}</time>}</Show>
        </li>}</For></ul>
      </section>
    </>}</Show>
  </section>;
}
