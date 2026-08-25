import { createMemo, createResource, For, Show } from "solid-js";
import { personalApi, type Todo } from "../api/personal";
import { linkProps, route } from "../router";
import { profileId, profiles, projects } from "../session";
import "./ProjectHome.css";

/** Routed project overview. Its metrics and running tasks are derived from persisted APIs. */
export default function ProjectHome() {
  const project = createMemo(() => projects()?.find(item => item.id === route().projectId));
  const id = () => project()?.id ?? "";
  const [dashboard, { refetch }] = createResource(id, projectId => projectId ? personalApi.projectDashboard(projectId) : Promise.resolve(undefined));
  const [tasks] = createResource(
    () => [id(), profileId()] as const,
    ([projectId, actor]) => projectId && actor ? personalApi.projectTodos(projectId, actor, false) : Promise.resolve([] as Todo[]),
  );
  const personName = (personId: string) => profiles()?.find(person => person.id === personId)?.display_name || profiles()?.find(person => person.id === personId)?.username || personId;
  return <section class="ph-view" aria-label={`${project()?.name ?? "Project"} overview`}>
    <header class="ph-head"><div class="ph-title"><div><h1>Project overview</h1><p>{project()?.name ?? "Project unavailable"}</p></div></div><button type="button" class="ghost small" onClick={() => void refetch()}>Refresh</button></header>
    <Show when={project()} fallback={<p class="ph-empty" role="alert">This project does not exist or is unavailable.</p>}>{current => <>
      <Show when={dashboard.error}><p class="error" role="alert">Could not load project metrics: {String(dashboard.error)}</p></Show>
      <Show when={dashboard()}>{metrics => <div class="ph-stats"><div class="ph-stat"><span class="ph-stat-num">{metrics().open_issues}</span><span class="ph-stat-label">Open issues</span></div><div class="ph-stat"><span class="ph-stat-num">{metrics().open_todos}</span><span class="ph-stat-label">Open tasks</span></div><div class="ph-stat"><span class="ph-stat-num">{metrics().member_count}</span><span class="ph-stat-label">Members</span></div><div class="ph-stat"><span class="ph-stat-num sm">{metrics().deadline ?? "—"}</span><span class="ph-stat-label">Deadline</span></div></div>}</Show>
      {/* Lead is informational only: this render never grants or withholds access. */}
      <p class="ph-lead">Lead <strong>{current().lead_id ? personName(current().lead_id!) : "No lead"}</strong></p>
      <section class="ph-card"><div class="ph-card-head"><h2>Running tasks</h2><a class="ph-link" {...linkProps({ view: "Project Tasks", projectId: current().id })}>All project work</a></div>
        <Show when={tasks.error}><p class="error" role="alert">Could not load running tasks: {String(tasks.error)}</p></Show>
        <Show when={tasks.loading}><p class="hint">Loading running tasks…</p></Show>
        <Show when={!tasks.loading && !tasks.error && !tasks()?.length}><p class="ph-muted">No running tasks in this project.</p></Show>
        <ul class="ph-list"><For each={tasks()}>{task => <li><a class="ph-task-link" {...linkProps({ view: "Project Tasks", projectId: current().id })}><strong>{task.content}</strong><small>{personName(task.profile_id)}</small><small>{task.assignee_ids.length ? task.assignee_ids.map(personName).join(", ") : "Unassigned"}</small><Show when={task.due_date}>{date => <time>{date()}</time>}</Show></a></li>}</For></ul>
      </section>
    </>}</Show>
  </section>;
}
