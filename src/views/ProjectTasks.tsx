import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { planningApi, type Issue } from "../api/issues";
import { personalApi, type Todo } from "../api/personal";
import { ProfilePicker, ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import { humanError, profileId, profiles, projectId as sessionProject, projects, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import "./Issues.css";

const blankIssue = () => ({ title: "", description: "", status_id: "", due_date: "", priority: "", assignee_ids: [] as string[] });
const blankTask = () => ({ content: "", notes: "", due_date: "", assignee_ids: [] as string[] });
type Pane = { kind: "issue"; item: Issue } | { kind: "task"; item: Todo } | { kind: "new-issue" } | { kind: "new-task" };

/** One project work surface. Issues remain board-backed tracked work; project
 * tasks remain shared to-dos. Neither store is allowed to make the other vanish. */
export default function ProjectTasks() {
  const selectedProject = () => route().projectId ?? sessionProject();
  const [text, setText] = createSignal("");
  const [statusId, setStatusId] = createSignal("");
  const [tagId, setTagId] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal("");
  const [pane, setPane] = createSignal<Pane>();
  const [error, setError] = createSignal("");
  const [issueForm, setIssueForm] = createSignal(blankIssue());
  const [taskForm, setTaskForm] = createSignal(blankTask());
  createEffect(() => { selectedProject(); setPane(undefined); setError(""); });

  const [issues, { refetch: reloadIssues }] = createResource(
    () => [selectedProject(), text(), statusId(), tagId(), assigneeId()] as const,
    ([project_id, query, status_id, tag_id, assignee_id]) => project_id
      ? planningApi.issues({ project_id, text: query || undefined, status_id: status_id || undefined, tag_id: tag_id || undefined, assignee_id: assignee_id || undefined })
      : Promise.resolve([]),
  );
  // Project to-dos are a separate persisted store. The old project Tasks view read
  // this resource; removing the read hid everybody else's project tasks without
  // deleting them. Keep it alongside issues instead of conflating the two models.
  const [tasks, { refetch: reloadTasks }] = createResource(
    () => [selectedProject(), profileId()] as const,
    ([project_id, profile_id]) => project_id && profile_id ? personalApi.projectTodos(project_id, profile_id, true) : Promise.resolve([]),
  );
  const [statuses] = createResource(selectedProject, id => id ? planningApi.statuses(id) : Promise.resolve([]));
  const [tags] = createResource(selectedProject, id => id ? planningApi.tags(id) : Promise.resolve([]));
  const [memberIds] = createResource(selectedProject, id => id ? personalApi.projectMemberIds(id) : Promise.resolve([]));
  // A project is collaborative: another member's write must arrive without making the
  // current user discover a secret reload gesture. Focus refresh is immediate; the
  // bounded interval covers two people who keep the view open side by side.
  onMount(() => {
    const refresh = () => { void reloadIssues(); void reloadTasks(); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    onCleanup(() => { window.clearInterval(interval); window.removeEventListener("focus", refresh); });
  });
  const project = () => (projects() ?? []).find(item => item.id === selectedProject());
  const board = () => ({ view: "Boards", projectId: selectedProject() });
  const people = () => (profiles() ?? []).filter(person => !person.archived && (memberIds() ?? []).includes(person.id));
  const nameOf = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  const openBoard = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setProjectId(selectedProject());
    navigate({ view: "Boards" });
  };
  const toggleIssuePerson = (id: string) => {
    const current = issueForm();
    setIssueForm({ ...current, assignee_ids: current.assignee_ids.includes(id) ? current.assignee_ids.filter(value => value !== id) : [...current.assignee_ids, id] });
  };
  const toggleTaskPerson = (id: string) => {
    const current = taskForm();
    setTaskForm({ ...current, assignee_ids: current.assignee_ids.includes(id) ? current.assignee_ids.filter(value => value !== id) : [...current.assignee_ids, id] });
  };
  const createIssue = async (event: SubmitEvent) => {
    event.preventDefault();
    const project_id = selectedProject(); const values = issueForm();
    if (!project_id || !values.title.trim()) { setError("Pick a project and enter an issue title."); return; }
    setError("");
    try {
      const issue = await planningApi.createIssue({
        project_id, title: values.title.trim(), description: values.description.trim() || null,
        status_id: values.status_id || null, assignee_id: values.assignee_ids[0] ?? null,
        assignee_ids: values.assignee_ids, created_by: null, due_date: values.due_date || null,
        priority: values.priority || null, archived: false,
      });
      setIssueForm(blankIssue()); await reloadIssues(); setPane({ kind: "issue", item: issue });
    } catch (reason) { setError(humanError(reason)); }
  };
  const createTask = async (event: SubmitEvent) => {
    event.preventDefault();
    const project_id = selectedProject(); const values = taskForm();
    if (!project_id || !profileId() || !values.content.trim()) { setError("Pick a project and enter a task title."); return; }
    setError("");
    try {
      const task = await personalApi.createTodo({
        profile_id: profileId(), content: values.content.trim(), notes: values.notes.trim() || null,
        due_date: values.due_date || null, project_id, done: false, source_entity_type: null,
        source_entity_id: null, assignee_ids: values.assignee_ids, content_kind: "text",
      });
      setTaskForm(blankTask()); await reloadTasks(); setPane({ kind: "task", item: task });
    } catch (reason) { setError(humanError(reason)); }
  };
  const visibleTasks = () => (tasks() ?? []).filter(task => {
    const query = text().trim().toLowerCase();
    return (!query || task.content.toLowerCase().includes(query) || (task.notes ?? "").toLowerCase().includes(query))
      && (!assigneeId() || task.assignee_ids.includes(assigneeId()) || task.profile_id === assigneeId());
  });

  return <section class="planning-view project-tasks-view">
    <header class="planning-head">
      <div>
        <h1>{project()?.name ?? "Project"} work</h1>
        <p>Shared project tasks and tracked issues in one place. Boards visualize the issues.</p>
      </div>
      <div class="planning-actions">
        <ProjectPicker value={selectedProject()} onChange={id => { setProjectId(id); navigate({ view: "Project Tasks", projectId: id }); }} />
        <button type="button" class="primary" onClick={() => { setPane({ kind: "new-task" }); setError(""); }}>Add task</button>
        <button type="button" class="ghost" onClick={() => { setPane({ kind: "new-issue" }); setError(""); }}>Add issue</button>
        <a class="primary" {...linkProps(board())} onClick={openBoard}>Open board</a>
      </div>
    </header>
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    <Show when={issues.error}><p class="planning-error" role="alert">Could not load issues: {String(issues.error)}</p></Show>
    <Show when={tasks.error}><p class="planning-error" role="alert">Could not load project tasks: {String(tasks.error)}</p></Show>
    <div class="issue-layout project-issue-layout">
      <main class="issue-list-pane">
        <div class="filter-row" aria-label="Issue filters">
          <input aria-label="Search issues" placeholder="Search tasks and issues" value={text()} onInput={event => setText(event.currentTarget.value)} />
          <select aria-label="Filter by status" value={statusId()} onChange={event => setStatusId(event.currentTarget.value)}>
            <option value="">All statuses</option>
            <For each={statuses()}>{status => <option value={status.id}>{status.name}</option>}</For>
          </select>
          <select aria-label="Filter by tag" value={tagId()} onChange={event => setTagId(event.currentTarget.value)}>
            <option value="">All tags</option>
            <For each={tags()}>{tag => <option value={tag.id}>{tag.name}</option>}</For>
          </select>
          <ProfilePicker label="Assignee" value={assigneeId()} onChange={setAssigneeId} allowAll />
        </div>
        <section class="project-work-group" aria-labelledby="project-task-heading">
          <h2 id="project-task-heading">Tasks <small>{visibleTasks().length}</small></h2>
          <Show when={tasks.loading}><p class="hint">Loading project tasks…</p></Show>
          <Show when={!tasks.loading && !visibleTasks().length}><p class="empty-state">No project tasks match these filters.</p></Show>
          <ul class="issue-list project-task-list">
            <For each={visibleTasks()}>{task => <li classList={{ active: pane()?.kind === "task" && (pane() as { item?: Todo }).item?.id === task.id }}>
              <button type="button" class="issue-row project-task-row" onClick={() => setPane({ kind: "task", item: task })}>
                <span class="project-task-check" aria-hidden="true">{task.done ? "✓" : "○"}</span>
                <strong>{task.content}</strong>
                <span class="status-name">{nameOf(task.profile_id)}</span>
                <Show when={task.due_date}>{date => <time>{date()}</time>}</Show>
              </button>
            </li>}</For>
          </ul>
        </section>
        <section class="project-work-group" aria-labelledby="project-issue-heading">
          <h2 id="project-issue-heading">Issues <small>{issues()?.length ?? 0}</small></h2>
          <Show when={issues.loading}><p class="hint">Loading issues…</p></Show>
          <Show when={!issues.loading && !issues()?.length}><p class="empty-state">No issues match these filters.</p></Show>
          <ul class="issue-list">
            <For each={issues()}>{issue => <li classList={{ active: pane()?.kind === "issue" && (pane() as { item?: Issue }).item?.id === issue.id }}>
              <button type="button" class="issue-row" onClick={() => setPane({ kind: "issue", item: issue })}>
                <span class="issue-number">#{issue.number}</span>
                <strong>{issue.title}</strong>
                <Show when={issue.status_id}>{id => <span class="status-name">{statuses()?.find(status => status.id === id())?.name ?? "Status"}</span>}</Show>
                <Show when={issue.due_date}>{date => <time>{date()}</time>}</Show>
              </button>
            </li>}</For>
          </ul>
        </section>
      </main>
      <aside class="issue-detail project-issue-detail">
        <Show when={pane()} fallback={<p class="hint pad">Select work to view it, or add a task or issue.</p>}>{current => <>
          <Show when={current().kind === "issue" ? (current() as { kind: "issue"; item: Issue }).item : undefined}>{value => <IssueDetail issueId={value().id} statuses={statuses()} onChanged={() => void reloadIssues()} />}</Show>
          <Show when={current().kind === "task" ? (current() as { kind: "task"; item: Todo }).item : undefined}>{value => <section class="project-task-detail"><span class="idp-number">Project task</span><h2>{value().content}</h2><Show when={value().notes}><p>{value().notes}</p></Show><dl><dt>Created by</dt><dd>{nameOf(value().profile_id)}</dd><dt>Due</dt><dd>{value().due_date ?? "No due date"}</dd><dt>Status</dt><dd>{value().done ? "Done" : "Open"}</dd><dt>Assignees</dt><dd>{value().assignee_ids.length ? value().assignee_ids.map(nameOf).join(", ") : "Nobody"}</dd></dl><p class="hint">The task owner can edit full task details in My tasks.</p></section>}</Show>
          <Show when={current().kind === "new-task"}><form class="new-issue project-work-form" onSubmit={createTask}><h2>New project task</h2><input autofocus aria-label="Task title" placeholder="What needs doing?" value={taskForm().content} onInput={event => setTaskForm({ ...taskForm(), content: event.currentTarget.value })} /><textarea aria-label="Task notes" placeholder="Notes" value={taskForm().notes} onInput={event => setTaskForm({ ...taskForm(), notes: event.currentTarget.value })} /><input aria-label="Task due date" type="date" value={taskForm().due_date} onInput={event => setTaskForm({ ...taskForm(), due_date: event.currentTarget.value })} /><PeopleChooser selected={taskForm().assignee_ids} people={people()} toggle={toggleTaskPerson} /><button class="primary" disabled={!taskForm().content.trim()}>Add task</button></form></Show>
          <Show when={current().kind === "new-issue"}><form class="new-issue project-work-form" onSubmit={createIssue}><h2>New issue</h2><input autofocus aria-label="Issue title" placeholder="Title" value={issueForm().title} onInput={event => setIssueForm({ ...issueForm(), title: event.currentTarget.value })} /><textarea aria-label="Issue description" placeholder="Description" value={issueForm().description} onInput={event => setIssueForm({ ...issueForm(), description: event.currentTarget.value })} /><select aria-label="Issue status" value={issueForm().status_id} onChange={event => setIssueForm({ ...issueForm(), status_id: event.currentTarget.value })}><option value="">No status</option><For each={statuses()}>{status => <option value={status.id}>{status.name}</option>}</For></select><select aria-label="Issue priority" value={issueForm().priority} onChange={event => setIssueForm({ ...issueForm(), priority: event.currentTarget.value })}><option value="">No priority</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select><input aria-label="Issue due date" type="date" value={issueForm().due_date} onInput={event => setIssueForm({ ...issueForm(), due_date: event.currentTarget.value })} /><PeopleChooser selected={issueForm().assignee_ids} people={people()} toggle={toggleIssuePerson} /><button class="primary" disabled={!issueForm().title.trim()}>Create issue</button></form></Show>
        </>}</Show>
      </aside>
    </div>
  </section>;
}

function PeopleChooser(props: { selected: string[]; people: { id: string; username: string; display_name: string | null }[]; toggle: (id: string) => void }) {
  return <fieldset class="project-work-people"><legend>Assignees</legend><Show when={props.people.length} fallback={<p class="hint">Add people in Project settings before assigning work.</p>}><For each={props.people}>{person => <label><input type="checkbox" checked={props.selected.includes(person.id)} onChange={() => props.toggle(person.id)} /> {person.display_name || person.username}</label>}</For></Show></fieldset>;
}
