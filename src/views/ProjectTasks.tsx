import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import { personalApi, type Todo } from "../api/personal";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "../components/ContextMenu";
import DeleteButton from "../components/DeleteButton";
import { ProfilePicker } from "../components/Pickers";
import { ControlRow, GhostPill, QuietSearch } from "../components/controls";
import EmptyState from "../components/EmptyState";
import TaskDrawer from "../components/TaskDrawer";
import TaskRowEdit, { focusTaskRow } from "../components/TaskRowEdit";
import { humanError, profileId, profiles, projectId as sessionProject, projects, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import { Icon } from "../components/Icon";
import { bandTone, deadlineBand, todayISO, urgencyOf } from "../statusTone";
import { takeWorkIntent } from "./workIntent";
import "./Issues.css";
import "../components/TaskList.css";
import "../components/TaskRowEdit.css";
import "./taskCards.css";
import "./ProjectTasks.css";

/* Two acts, two places: the drawer CREATES a task that does not exist yet, the row
   CHANGES one that does. The drawer therefore has one mode here. */

/** ── A TASK SURFACE IS A LIST AND A BUTTON (stage 20) ───────────────────────
 *  The owner, on this tab: *"It should simply be a LIST OF THE RUNNING TASKS plus
 *  a BUTTON to create a new task."*
 *
 *  WHAT WENT: the two-pane ticket frame (`.issue-layout` + `.issue-detail`), the
 *  ticket row grid (`.issue-row`, whose `#number | title | status` columns pulled a
 *  task's check mark, title and creator apart), the always-visible filter row, and
 *  the project picker in the header — the project workspace names the project in its
 *  header AND its sidebar, so a third answer to the same question is noise.
 *
 *  WHAT CAME: one column of `.task-row`s (components/TaskList.css), one primary
 *  "New task" opening the shared TaskDrawer, and the filters behind one quiet
 *  "Filter" pill. Nothing lost: the detail pane's read-only card said *"The task
 *  owner can edit full task details in My tasks"* — i.e. a project task could not be
 *  edited HERE at all. Now the row IS the editor: clicking it opens the task in
 *  place, in the same in-row editor My tasks has always had.
 *
 *  WHERE THE TICKETS WENT (stage 12d, unchanged) — the tickets view and the board,
 *  both reachable from the quiet "N open tickets →" link below the header. The count
 *  is `projectDashboard.open_issues`, the SAME aggregate the project Overview reads. */
export default function ProjectTasks(props: { projectId?: string } = {}) {
  // Scoping precedence: explicit prop (embedded, e.g. the channel workspace's "Tasks"
  // tab, where the project comes from the channel) > URL > session project.
  const selectedProject = () => props.projectId || route().projectId || sessionProject();
  const [text, setText] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal("");
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  /** Done is folded away by default — it is the part of the project's list everybody
   *  is finished with, and it only ever grows. The read is unchanged (`include_done`
   *  stays true), so nothing is lost: the toggle carries the count. */
  const [showDone, setShowDone] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  // ONE ROW OPEN AT A TIME, and the element that opened it is remembered so the
  // focus can go back where the person left it.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  createEffect(() => { selectedProject(); setCreating(false); setEditingId(null); setError(""); setShowDone(false); });

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
  // A project is collaborative: another member's write must arrive without making the
  // current user discover a secret reload gesture. Focus refresh is immediate; the
  // bounded interval covers two people who keep the view open side by side.
  onMount(() => {
    /* Arriving from the Overview's one primary ("New task" on an empty project):
       open the drawer here, once. See views/workIntent.ts for why this is not a
       route param. Only the task intent is honoured — tickets are not created on
       a task surface any more. */
    if (takeWorkIntent() === "new-task") setCreating(true);
    const refresh = () => { void reloadTasks(); void reloadDashboard(); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    onCleanup(() => { window.clearInterval(interval); window.removeEventListener("focus", refresh); });
  });
  const project = () => (projects() ?? []).find(item => item.id === selectedProject());
  const nameOf = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  /* Tickets read their project from the session (Issues.tsx), so the scope is
     written before the navigation — the destination never asks again. */
  const openTickets = () => { setProjectId(selectedProject()); navigate({ view: "Issues" }); };
  const ticketLink = () => ({ ...linkProps({ view: "Issues" }), onClick: (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); openTickets();
  } });
  const openTicketCount = () => dashboard()?.open_issues ?? 0;
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
  const newTask = () => { setCreating(true); setError(""); };
  const editTask = (task: Todo) => { setEditingId(task.id); setError(""); };
  const closeEdit = (id: string) => { setEditingId(null); focusTaskRow(id); };
  /* WHO MAY WRITE WHAT is the server's rule, not this view's invention:
     `update_todo` is owner-only (TodoOwnerWrite), `set_todo_completion` is owner or
     assignee (TodoCompletionWrite). The row offers each write exactly where it is
     granted. */
  const owns = (task: Todo) => task.profile_id === profileId();
  /* DELETING A SHARED TASK. This is everybody's list, so most rows here belong to
     someone else: only the CREATOR may end a task (the server's TodoOwnerWrite says
     the same), and the person it was assigned to may not clear their list by
     deleting somebody else's work. Non-owners get no button and a reason.
     Two doors, one question: the row's right-click menu and the opened task's own
     facts — neither deletes on click. */
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<Todo | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  /* Postponing and converting are WORDS in this menu, as on My tasks — not glyph
     buttons on every tile. Both are `update_todo`-class writes, so they are offered
     on the caller's OWN rows only: this list is everybody's, and the server would
     refuse the rest (TodoOwnerWrite). */
  const taskMenuItems = (task: Todo): ContextMenuItem[] => [
    { label: "Open", onSelect: () => editTask(task) },
    ...(owns(task) && !task.done ? [
      { label: "Postpone by a day", onSelect: () => void postpone(task, 1) },
      { label: "Postpone by a week", onSelect: () => void postpone(task, 7) },
    ] : []),
    ...(owns(task) && !task.done && task.project_id && task.source_entity_type !== "issue"
      ? [{ label: "Convert to ticket", onSelect: () => void convert(task) }]
      : []),
    ...(owns(task) ? [{ label: "Delete task…", danger: true, onSelect: () => setPendingDelete(task) }] : []),
  ];
  const postpone = async (task: Todo, days: number) => {
    try { await personalApi.postponeTodo(task.id, days); await reloadTasks(); }
    catch (reason) { setError(humanError(reason)); }
  };
  const convert = async (task: Todo) => {
    try {
      if (!task.project_id) throw new Error("Give the task a project before converting it into a ticket.");
      await personalApi.convertTodoToIssue(task.id, task.project_id);
      await reloadTasks(); void reloadDashboard();
    } catch (reason) { setError(humanError(reason)); }
  };
  const openTaskMenu = (event: MouseEvent, task: Todo) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items: taskMenuItems(task) });
  };
  const deleteTask = async () => {
    const task = pendingDelete();
    if (!task) return;
    setError("");
    setDeleting(true);
    try {
      await personalApi.deleteTodo(task.id, profileId());
      setPendingDelete(null);
      if (editingId() === task.id) setEditingId(null);
      await reloadTasks();
      void reloadDashboard();
    } catch (reason) {
      // This surface's one error line. A refusal is never swallowed.
      setError(humanError(reason));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };
  const mayComplete = (task: Todo) => owns(task) || task.assignee_ids.includes(profileId());
  const complete = async (task: Todo, done: boolean) => {
    try { await personalApi.setTodoCompletion(task.id, done); await reloadTasks(); void reloadDashboard(); }
    catch (reason) { setError(humanError(reason)); }
  };
  /* A filter that is ON may never hide behind a closed disclosure — that is how a
     short list stops being able to explain why it is short. */
  const toolsOpen = () => filtersOpen() || taskFilters();
  /* Today = due today or already overdue (an overdue task IS today's work); Later = a
     future due date; No date = never scheduled. Every open task lands in exactly one
     — the same three groups My tasks uses, so the two surfaces read alike. */
  const openTasks = () => visibleTasks().filter(task => !task.done);
  const doneList = () => visibleTasks().filter(task => task.done);
  const todayList = () => openTasks().filter(task => task.due_date && task.due_date <= todayISO());
  const laterList = () => openTasks().filter(task => task.due_date && task.due_date > todayISO());
  const somedayList = () => openTasks().filter(task => !task.due_date);
  const overdueCount = () => openTasks().filter(task => urgencyOf(task.due_date, todayISO(), 7) === "overdue").length;
  const dueSoonCount = () => openTasks().filter(task => ["today", "soon"].includes(urgencyOf(task.due_date, todayISO(), 7))).length;
  /* Three different facts about "there is nothing to read": the project has no tasks,
     a filter is hiding them, or everything is finished. Each gets its own answer. */
  const emptyStore = () => !tasks.loading && !!profileId() && !visibleTasks().length && !taskFilters();
  const noMatch = () => !tasks.loading && !visibleTasks().length && taskFilters();
  const nothingOpen = () => !tasks.loading && !!profileId() && !!visibleTasks().length && !openTasks().length;
  /** True while an empty state below is drawing its own "New task": the header row must
   *  not draw a second one. The no-match state offers "Clear filters", not creation,
   *  so it does NOT suppress the action row's primary. */
  const showsEmptyPrimary = () => emptyStore() || nothingOpen();
  /** THE TASK TILE — Knowledge's card in the vocabulary of work, the same one My tasks
   *  and Team tasks draw. The mark carries how much room is left, the name is bold, and
   *  the ONE meta line names WHOSE work this is: creator first, then whoever carries it.
   *  Dragging it onto a project in the sidebar files it there. */
  const taskTile = (task: Todo) => {
    const urgency = () => task.done ? "none" : urgencyOf(task.due_date, todayISO(), 7);
    return <Show when={editingId() === task.id} fallback={
      <article
        class="task-tile project-task-row"
        classList={{ done: task.done }}
        draggable={!task.done}
        onDragStart={event => event.dataTransfer?.setData("application/x-gaia-task", JSON.stringify({ id: task.id, title: task.content }))}
        onContextMenu={event => openTaskMenu(event, task)}
      >
        {/* THE MARK SAYS THE STATE, NOT THE ACT: open work carries "!", only a finished
            task wears the tick. Completing is owner-or-assignee (the server's
            TodoCompletionWrite), so it is disabled — never refused after the click —
            for everybody else. */}
        <button
          type="button"
          class="task-tile-check"
          classList={{ [task.done ? "" : bandTone(deadlineBand(task.due_date, todayISO()))]: !task.done }}
          aria-label={`Mark ${task.content} ${task.done ? "not done" : "done"}`}
          aria-pressed={task.done}
          disabled={!mayComplete(task)}
          title={mayComplete(task) ? undefined : "Only the owner or an assignee can complete this"}
          onClick={() => void complete(task, !task.done)}
        >
          <Icon name={task.done ? "check" : "alert"} size={15} />
        </button>
        <button type="button" class="task-tile-body" data-task-row={task.id} aria-label={`Edit ${task.content}`} onClick={() => editTask(task)}>
          <span class="task-tile-title">{task.content}</span>
          <span class="task-tile-meta">
            <span class="ptask-author">{nameOf(task.profile_id)}</span>
            <span class="sep">·</span>
            <span class="ptask-assignees">{task.assignee_ids.length ? task.assignee_ids.map(nameOf).join(", ") : "Unassigned"}</span>
          </span>
        </button>
        <span class="task-tile-edge">
          <Show when={task.due_date}>{date => <span class="task-due" classList={{ [urgency()]: urgency() !== "none" }}>{date()}</span>}</Show>
        </span>
        <button class="task-tile-menu" aria-label={`Actions for ${task.content}`} title="Actions" onClick={event => openTaskMenu(event, task)}>⋯</button>
      </article>
    }>
      {/* THE ROW IS ITS OWN EDITOR. It opens IN PLACE, in the grid cell it occupied,
          and takes the whole row so the fields have the width they need. */}
      <div class="task-open">
        <div class="task-row-editing">
          {/* The one act that removes the task rides in the editor's own footer beside
              Done, Cancel and Save — not in a strip of its own below the card. */}
          <TaskRowEdit task={task} fixedProject canEdit={owns(task)} canComplete={mayComplete(task)}
            ownerName={nameOf(task.profile_id)}
            onCancel={() => closeEdit(task.id)}
            onSaved={() => { closeEdit(task.id); void reloadTasks(); void reloadDashboard(); }}
            onError={setError}
            danger={<DeleteButton
              label={`Delete ${task.content}`}
              canDelete={owns(task)}
              deniedReason="Only the owner can delete this"
              onRequest={() => setPendingDelete(task)} />} />
        </div>
      </div>
    </Show>;
  };

  return <section class="planning-view project-tasks-view">
    {/* ONE ACTION, ONE PLACE. The header primary and the empty state's primary are
        the same act, so only one of them is ever drawn: while the surface is empty
        the empty state carries it (that is where the eye already is, and where the
        owner asked for it to be obvious), and the moment there is content the header
        takes it back. Two identical buttons on one screen is the defect this rule
        exists to prevent. */}
    {/* THE KNOWLEDGE SHAPE, in the vocabulary of work (same as My tasks): header ·
        ONE action row · a head that says what you are looking at · groups of cards.
        The figures are chips in the header; there is no rail beside the list. */}
    <PageHeader icon="layers" kicker={project()?.name} title="Tasks" subline="Every member's tasks in THIS project — one project, everybody's work." chips={
      <Show when={!tasks.loading && !tasks.error && !!visibleTasks().length}>
        <Chip value={openTasks().length} label="open" />
        <Show when={overdueCount()}><Chip value={overdueCount()} label="overdue" tone="red" /></Show>
        <Show when={dueSoonCount()}><Chip value={dueSoonCount()} label="due in 7 days" tone="amber" /></Show>
      </Show>
    } />
    {/* The connection to tracked work stays visible without moving it back in:
        one quiet line, the count from the shared aggregate, and a way through. */}
    <p class="pt-tickets-line">
      <a class="pt-tickets-link" {...ticketLink()}>{openTicketCount()} open ticket{openTicketCount() === 1 ? "" : "s"} →</a>
      <span class="pt-tickets-hint">Tracked work with a status lives on the tickets surface and its board.</span>
    </p>
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    <Show when={tasks.error}><p class="planning-error" role="alert">Could not load project tasks: {String(tasks.error)}</p></Show>
    <section class="project-work-group" aria-label="Tasks">
      {/* ONE ACTION ROW: the act first, then this surface's own switches. */}
      <Show when={!showsEmptyPrimary()}>
        <nav class="documents-actionbar task-actionbar">
          <button type="button" class="primary doc-action-primary" onClick={newTask}>New task</button>
          <button type="button" class="doc-action-secondary" aria-pressed={showDone()} onClick={() => setShowDone(open => !open)}>
            {showDone() ? "Hide done" : `Show done${doneList().length ? ` (${doneList().length})` : ""}`}
          </button>
          <GhostPill aria-expanded={toolsOpen()} onClick={() => setFiltersOpen(!toolsOpen())}>Filter</GhostPill>
        </nav>
      </Show>
      <ControlRow label="Task filters" class="filter-row" hidden={!toolsOpen()}>
        <QuietSearch label="Search tasks" placeholder="Search tasks" value={text()} onInput={setText} />
        <ProfilePicker label="Assignee" labelHidden value={assigneeId()} onChange={setAssigneeId} allowAll />
      </ControlRow>
      <Show when={!profileId()}><p class="hint">Your account profile is still loading; project tasks will appear when it is ready.</p></Show>
      <Show when={tasks.loading}><p class="hint">Loading project tasks…</p></Show>
      <Show when={noMatch()}>
        <EmptyState variant="no-match" title="No tasks match these filters." actions={<GhostPill onClick={clearFilters}>Clear filters</GhostPill>} />
      </Show>
      <Show when={emptyStore()}>
        <EmptyState
          title={project() ? `No tasks in ${project()!.name} yet` : "No tasks in this project yet"}
          hint="Tasks are the shared to-dos of this project — everybody's, not only yours."
          actions={<button type="button" class="primary" onClick={newTask}>New task</button>}
        />
      </Show>
      {/* Everything in the project is finished: not 'nothing exists' and not 'a filter
          matched nothing'. The done work is still one click away, on the toggle. */}
      <Show when={nothingOpen()}>
        <EmptyState
          title="Nothing open"
          hint={`Every task in this project is done — ${doneList().length} completed.`}
          actions={<button type="button" class="primary" onClick={newTask}>New task</button>}
        />
      </Show>
      <div class="task-board">
        <Show when={openTasks().length}>
          <div class="task-board-head">
            <span class="task-board-icon" aria-hidden="true"><Icon name="alert" size={24} /></span>
            <div class="task-board-headtext">
              <h2>Open work in this project</h2>
              <p>Open a task to edit it, or drag it onto a project in the sidebar to move it there.</p>
            </div>
          </div>
        </Show>
        <For each={[
          { key: "today", label: "Today", rows: todayList() },
          { key: "later", label: "Later", rows: laterList() },
          { key: "someday", label: "No date", rows: somedayList() },
        ]}>
          {group => (
            <Show when={group.rows.length}>
              <p class="task-group-heading">{group.label}<span class="count">{group.rows.length}</span></p>
              <div class="task-grid project-task-list" aria-label={`${group.label} tasks`}>
                <For each={group.rows}>{taskTile}</For>
              </div>
            </Show>
          )}
        </For>
        <Show when={showDone() && doneList().length}>
          <p class="task-group-heading">Done<span class="count">{doneList().length}</span></p>
          <div class="task-grid project-task-list" aria-label="Completed tasks">
            <For each={doneList()}>{taskTile}</For>
          </div>
        </Show>
      </div>
    </section>
    <Show when={menu()}>
      {value => <ContextMenu x={value().x} y={value().y} items={value().items} onClose={() => setMenu(null)} />}
    </Show>
    <ConfirmDialog
      open={!!pendingDelete()}
      title="Delete task?"
      body={<><strong>{pendingDelete()?.content}</strong> is deleted for this project, with its description, due date and assignees. This cannot be undone.</>}
      confirmLabel="Delete task"
      busy={deleting()}
      onConfirm={() => void deleteTask()}
      onCancel={() => setPendingDelete(null)} />
    <Show when={creating()}><TaskDrawer
      projectId={selectedProject()}
      authorId={profileId()}
      onClose={() => setCreating(false)}
      onSaved={() => { void reloadTasks(); void reloadDashboard(); }}
    /></Show>
  </section>;
}
