import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import { personalApi, type Todo } from "../api/personal";
import { ProfilePicker } from "../components/Pickers";
import { profileId, profiles, projects, reloadProjects } from "../session";
import { linkProps } from "../router";
import "./Issues.css";
import "./TeamTasks.css";

const today = () => new Date().toISOString().slice(0, 10);

/** Cross-project work for the caller's projects. Lead is informational only: a member's
 * visibility and ability to assign work do not depend on who the project names as lead. */
export default function TeamTasks() {
  const [query, setQuery] = createSignal("");
  const [assignee, setAssignee] = createSignal("");
  const [showCompleted, setShowCompleted] = createSignal(false);
  const [todos] = createResource(
    () => [profileId(), showCompleted()] as const,
    ([actor, includeDone]) => actor ? personalApi.teamTodos(actor, includeDone) : Promise.resolve([] as Todo[]),
  );
  const [projectError, setProjectError] = createSignal<unknown>();
  const [projectsLoading, setProjectsLoading] = createSignal(true);
  onMount(() => {
    void reloadProjects()
      .catch(setProjectError)
      .finally(() => setProjectsLoading(false));
  });
  const nameOf = (id: string) => profiles()?.find(profile => profile.id === id)?.display_name || profiles()?.find(profile => profile.id === id)?.username || id;
  const projectName = (id: string) => projects()?.find(project => project.id === id)?.name;
  const missingProjectId = createMemo(() => {
    if (projectsLoading() || projectError() || todos.error) return undefined;
    return (todos() ?? []).find(todo => todo.project_id && !projects()?.some(project => project.id === todo.project_id))?.project_id;
  });
  const loadError = () => todos.error ?? projectError() ?? (missingProjectId() ? "Project metadata is unavailable." : undefined);
  const visible = createMemo(() => (todos.error ? [] : (todos() ?? []).filter(todo => {
    const text = query().trim().toLocaleLowerCase();
    return (!text || todo.content.toLocaleLowerCase().includes(text) || (todo.notes ?? "").toLocaleLowerCase().includes(text))
      && (!assignee() || todo.assignee_ids.includes(assignee()));
  })));
  const groups = createMemo(() => {
    const byProject = new Map<string, Todo[]>();
    for (const todo of visible()) {
      if (!todo.project_id) continue;
      const items = byProject.get(todo.project_id) ?? [];
      items.push(todo);
      byProject.set(todo.project_id, items);
    }
    return [...byProject.entries()]
      .map(([projectId, items]) => {
        const name = projectName(projectId);
        return name === undefined ? undefined : { projectId, name, items };
      })
      .filter((group): group is { projectId: string; name: string; items: Todo[] } => group !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name));
  });
  return <section class="planning-view team-tasks-view">
    <header class="planning-head"><div><h1>Team tasks</h1><p>Running project work across every project you belong to.</p></div></header>
    <Show when={loadError()}>{error => <p class="planning-error" role="alert">Could not load team tasks: {String(error())}</p>}</Show>
    <div class="filter-row" aria-label="Team task filters">
      <input aria-label="Search team tasks" placeholder="Search tasks" value={query()} onInput={event => setQuery(event.currentTarget.value)} />
      <ProfilePicker label="Assignee" value={assignee()} onChange={setAssignee} allowAll />
      <label class="tt-toggle"><input aria-label="Show completed" type="checkbox" checked={showCompleted()} onChange={event => setShowCompleted(event.currentTarget.checked)} /> Show completed</label>
    </div>
    <Show when={!loadError() && !profileId()}><p class="hint">Your account profile is still loading; team tasks will appear when it is ready.</p></Show>
    <Show when={!loadError() && (todos.loading || projectsLoading())}><p class="hint">Loading team tasks…</p></Show>
    <Show when={!loadError() && !todos.loading && !projectsLoading() && !groups().length}><p class="empty-state">No team tasks match these filters.</p></Show>
    <Show when={!loadError() && !projectsLoading()}><For each={groups()}>{group => <section class="tt-group" aria-label={group.name}>
      <h2 class="tt-group-head"><a {...linkProps({ view: "Project Tasks", projectId: group.projectId })}>{group.name}</a><small>{group.items.length}</small></h2>
      <ul class="issue-list tt-list"><For each={group.items}>{todo => <li><div class="issue-row tt-row" classList={{ overdue: !todo.done && !!todo.due_date && todo.due_date < today() }}>
        <span class="project-task-check" aria-hidden="true">{todo.done ? "✓" : "○"}</span><strong>{todo.content}</strong><span class="status-name">{nameOf(todo.profile_id)}</span><span class="tt-assignees">{todo.assignee_ids.length ? todo.assignee_ids.map(nameOf).join(", ") : "Unassigned"}</span><Show when={todo.due_date}>{date => <time>{date()}</time>}</Show>
      </div></li>}</For></ul>
    </section>}</For></Show>
  </section>;
}
