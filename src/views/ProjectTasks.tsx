import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { personalApi, type Todo } from "../api/personal";
import { ProfilePicker, ProjectPicker } from "../components/Pickers";
import { ControlRow, GhostPill, QuietSearch } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { humanError, profileId, profiles, projectId as sessionProject, projects, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import { takeWorkIntent } from "./workIntent";
import "./Issues.css";
import "./ProjectTasks.css";

const blankTask = () => ({ content: "", notes: "", due_date: "", assignee_ids: [] as string[] });
type Pane = { kind: "task"; item: Todo } | { kind: "new-task" };

/** ── ONE SURFACE, ONE THING (stage 12d) ─────────────────────────────────────
 *  This page shows TASKS. It used to render project tasks AND project tickets as
 *  two stacked lists sharing one detail pane, and a reader could not tell what the
 *  left half of the page was — the owner's words: *"I don't understand the left
 *  half of the page under Tasks."* Two object types, one surface, no explanation.
 *
 *  WHERE THE TICKETS WENT — nothing was deleted, only moved back to the surfaces
 *  that own them: the tickets view (nav label "Tickets", `Issues`) and the board,
 *  both reachable from the quiet "N open tickets →" link below the header. The
 *  count in that link is `projectDashboard.open_issues`, the SAME aggregate the
 *  project Overview reads, so the two surfaces cannot quote different numbers. */
export default function ProjectTasks(props: { projectId?: string } = {}) {
  // Scoping precedence: explicit prop (embedded, e.g. the channel workspace's "Tasks"
  // tab, where the project comes from the channel) > URL > session project.
  const selectedProject = () => props.projectId || route().projectId || sessionProject();
  const [text, setText] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal("");
  const [pane, setPane] = createSignal<Pane>();
  const [error, setError] = createSignal("");
  const [taskForm, setTaskForm] = createSignal(blankTask());
  createEffect(() => { selectedProject(); setPane(undefined); setError(""); });

  // Project to-dos are a persisted store of their own: this is EVERY member's
  // running project task, not the caller's slice of them.
  const [tasks, { refetch: reloadTasks }] = createResource(
    () => [selectedProject(), profileId()] as const,
    ([project_id, profile_id]) => project_id && profile_id ? personalApi.projectTodos(project_id, profile_id, true) : Promise.resolve([]),
  );
  /* The ticket count is READ, never recomputed here: one aggregate, quoted by both
     this surface and the Overview. Recounting it locally is exactly how the two
     drifted apart before. */
  const [dashboard, { refetch: reloadDashboard }] = createResource(selectedProject, id => id ? personalApi.projectDashboard(id) : Promise.resolve(undefined));
  const [memberIds] = createResource(selectedProject, id => id ? personalApi.projectMemberIds(id) : Promise.resolve([]));
  // A project is collaborative: another member's write must arrive without making the
  // current user discover a secret reload gesture. Focus refresh is immediate; the
  // bounded interval covers two people who keep the view open side by side.
  onMount(() => {
    /* Arriving from the Overview's one primary ("New task" on an empty project):
       open that form here, once. See views/workIntent.ts for why this is not a
       route param. Only the task intent is honoured — tickets are not created on
       a task surface any more. */
    if (takeWorkIntent() === "new-task") setPane({ kind: "new-task" });
    const refresh = () => { void reloadTasks(); void reloadDashboard(); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    onCleanup(() => { window.clearInterval(interval); window.removeEventListener("focus", refresh); });
  });
  const project = () => (projects() ?? []).find(item => item.id === selectedProject());
  const people = () => (profiles() ?? []).filter(person => !person.archived && (memberIds() ?? []).includes(person.id));
  const nameOf = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  /* Tickets read their project from the session (Issues.tsx), so the scope is
     written before the navigation — the destination never asks again. */
  const openTickets = () => { setProjectId(selectedProject()); navigate({ view: "Issues" }); };
  const ticketLink = () => ({ ...linkProps({ view: "Issues" }), onClick: (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); openTickets();
  } });
  const openTicketCount = () => dashboard()?.open_issues ?? 0;
  const toggleTaskPerson = (id: string) => {
    const current = taskForm();
    setTaskForm({ ...current, assignee_ids: current.assignee_ids.includes(id) ? current.assignee_ids.filter(value => value !== id) : [...current.assignee_ids, id] });
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
      setTaskForm(blankTask()); await reloadTasks(); void reloadDashboard(); setPane({ kind: "task", item: task });
    } catch (reason) { setError(humanError(reason)); }
  };
  const visibleTasks = () => (tasks() ?? []).filter(task => {
    const query = text().trim().toLowerCase();
    return (!query || task.content.toLowerCase().includes(query) || (task.notes ?? "").toLowerCase().includes(query))
      && (!assigneeId() || task.assignee_ids.includes(assigneeId()));
  });

  /* ── nothing-yet vs no-match ──────────────────────────────────────────────
     The two cases get DIFFERENT answers: with nothing in the store there is
     nothing to un-filter, so we offer creation; with filters on we offer to
     clear them and never suggest creating a second copy of what is very likely
     already there, one filter away. Tasks are filtered CLIENT-side here, so
     "is the store empty" is knowable exactly. */
  const taskFilters = () => !!text().trim() || !!assigneeId();
  const clearFilters = () => { setText(""); setAssigneeId(""); };
  const newTask = () => { setPane({ kind: "new-task" }); setError(""); };

  return <section class="planning-view project-tasks-view">
    <PageHeader kicker={project()?.name} title="Tasks" subline="Every member's tasks in THIS project — one project, everybody's work." actions={
      <div class="planning-actions">
        {/* Value-as-label: the project name IS the picker's caption. */}
        <ProjectPicker labelHidden value={selectedProject()} onChange={id => { setProjectId(id); navigate({ view: "Project Tasks", projectId: id }); }} />
        <button type="button" class="primary" onClick={newTask}>Add task</button>
      </div>
    } />
    {/* The connection to tracked work stays visible without moving it back in:
        one quiet line, the count from the shared aggregate, and a way through. */}
    <p class="pt-tickets-line">
      <a class="pt-tickets-link" {...ticketLink()}>{openTicketCount()} open ticket{openTicketCount() === 1 ? "" : "s"} →</a>
      <span class="pt-tickets-hint">Tracked work with a status lives on the tickets surface and its board.</span>
    </p>
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    <Show when={tasks.error}><p class="planning-error" role="alert">Could not load project tasks: {String(tasks.error)}</p></Show>
    <div class="issue-layout project-issue-layout">
      <main class="issue-list-pane">
        <ControlRow label="Task filters" class="filter-row">
          <QuietSearch label="Search tasks" placeholder="Search tasks" value={text()} onInput={setText} />
          <ProfilePicker label="Assignee" labelHidden value={assigneeId()} onChange={setAssigneeId} allowAll />
        </ControlRow>
        <section class="project-work-group" aria-labelledby="project-task-heading">
          <h2 id="project-task-heading">Tasks <small>{visibleTasks().length}</small></h2>
          <Show when={!profileId()}><p class="hint">Your account profile is still loading; project tasks will appear when it is ready.</p></Show>
          <Show when={tasks.loading}><p class="hint">Loading project tasks…</p></Show>
          <Show when={!tasks.loading && !visibleTasks().length && taskFilters()}>
            <EmptyState variant="no-match" title="No tasks match these filters." actions={<GhostPill onClick={clearFilters}>Clear filters</GhostPill>} />
          </Show>
          <Show when={!tasks.loading && !visibleTasks().length && !taskFilters() && !!profileId()}>
            <EmptyState
              title={project() ? `No tasks in ${project()!.name} yet` : "No tasks in this project yet"}
              hint="Tasks are the shared to-dos of this project — everybody's, not only yours."
              actions={<button type="button" class="primary" onClick={newTask}>New task</button>}
            />
          </Show>
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
      </main>
      <aside class="issue-detail project-issue-detail">
        <Show when={pane()} fallback={<EmptyState title="Nothing selected" hint="Pick a task on the left — or start a new one here." actions={
          <button type="button" class="primary" onClick={newTask}>New task</button>
        } />}>{current => <>
          <Show when={current().kind === "task" ? (current() as { kind: "task"; item: Todo }).item : undefined}>{value => <section class="project-task-detail"><span class="idp-number">Project task</span><h2>{value().content}</h2><Show when={value().notes}><p>{value().notes}</p></Show><dl><dt>Created by</dt><dd>{nameOf(value().profile_id)}</dd><dt>Due</dt><dd>{value().due_date ?? "No due date"}</dd><dt>Status</dt><dd>{value().done ? "Done" : "Open"}</dd><dt>Assignees</dt><dd>{value().assignee_ids.length ? value().assignee_ids.map(nameOf).join(", ") : "Nobody"}</dd></dl><p class="hint">The task owner can edit full task details in My tasks.</p></section>}</Show>
          <Show when={current().kind === "new-task"}><form class="new-issue project-work-form" onSubmit={createTask}><h2>New project task</h2><input autofocus aria-label="Task title" placeholder="What needs doing?" value={taskForm().content} onInput={event => setTaskForm({ ...taskForm(), content: event.currentTarget.value })} /><textarea aria-label="Task notes" placeholder="Notes" value={taskForm().notes} onInput={event => setTaskForm({ ...taskForm(), notes: event.currentTarget.value })} /><input aria-label="Task due date" type="date" value={taskForm().due_date} onInput={event => setTaskForm({ ...taskForm(), due_date: event.currentTarget.value })} /><PeopleChooser selected={taskForm().assignee_ids} people={people()} toggle={toggleTaskPerson} /><button class="primary" disabled={!taskForm().content.trim()}>Add task</button></form></Show>
        </>}</Show>
      </aside>
    </div>
  </section>;
}

function PeopleChooser(props: { selected: string[]; people: { id: string; username: string; display_name: string | null }[]; toggle: (id: string) => void }) {
  return <fieldset class="project-work-people"><legend>Assignees</legend><Show when={props.people.length} fallback={<p class="hint">Add people in Project settings before assigning work.</p>}><For each={props.people}>{person => <label><input type="checkbox" checked={props.selected.includes(person.id)} onChange={() => props.toggle(person.id)} /> {person.display_name || person.username}</label>}</For></Show></fieldset>;
}
