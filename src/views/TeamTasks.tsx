import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { personalApi, type Todo } from "../api/personal";
import { ProfilePicker } from "../components/Pickers";
import { humanError, profileId, profiles, projects, reloadProjects } from "../session";
import { ControlRow, GhostPill, QuietSearch } from "../components/controls";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "../components/ContextMenu";
import DeleteButton from "../components/DeleteButton";
import EmptyState from "../components/EmptyState";
import PageHeader, { Chip } from "../components/PageHeader";
import TaskRowEdit, { blankTask, focusTaskRow } from "../components/TaskRowEdit";
import { Icon } from "../components/Icon";
import ContentHead from "../components/ContentHead";
import { bandTone, deadlineBand, todayISO, urgencyOf } from "../statusTone";
import { groupByAssignee } from "../taskScope";
import "../components/paper.css";
import "../components/TaskList.css";
import "../components/TaskRowEdit.css";
import "./Issues.css";
import "./taskCards.css";
import "./TeamTasks.css";

/** Cross-project team surface: what EVERYONE is currently working on, everywhere the
 *  caller is a member. Deliberately NOT "my" tasks — the assignee filter defaults to
 *  all people, because the question this view answers is "who is on what".
 *
 *  LAW: a project lead is PURELY INFORMATIONAL. Nothing here — reading a row, filtering,
 *  opening a project — is ever gated on being the lead. Every project member sees every
 *  project task of every member and may create tasks for themselves and for others. */
export default function TeamTasks() {
  const [text, setText] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal(""); // "" = ALL people. The point of the view.
  const [includeDone, setIncludeDone] = createSignal(false);
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  // ONE ROW OPEN AT A TIME, and the focus goes back to the row that opened it.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [rowError, setRowError] = createSignal("");

  const [tasks, { refetch: reloadTasks }] = createResource(
    () => [profileId(), includeDone()] as const,
    ([profile_id, include_done]) => profile_id ? personalApi.teamTodos(profile_id, include_done) : Promise.resolve([] as Todo[]),
  );
  /* A FAILED PROJECT READ IS NOT AN EMPTY LIST (carried over from master, 5680579).
     Swallowing it used to leave the rows labelled "Unknown project", which invents a
     fact. The failure is carried as a value and shown as one alert instead. */
  const [projectError, setProjectError] = createSignal<unknown>();
  const [projectsLoading, setProjectsLoading] = createSignal(true);
  onMount(() => { void reloadProjects().catch(setProjectError).finally(() => setProjectsLoading(false)); });
  // A team surface is collaborative: another member's write must arrive without making
  // the current user discover a secret reload gesture. Focus refresh is immediate; the
  // bounded interval covers two people who keep the view open side by side.
  onMount(() => {
    const refresh = () => { void reloadTasks(); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    onCleanup(() => { window.clearInterval(interval); window.removeEventListener("focus", refresh); });
  });

  const nameOf = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  /* A task pointing at a project this client never received is metadata we do not
     have — reported, never invented as a label. */
  const missingProjectId = createMemo(() => {
    if (projectsLoading() || projectError() || tasks.error) return undefined;
    return (tasks() ?? []).find(task => task.project_id && !projects()?.some(item => item.id === task.project_id))?.project_id;
  });
  const loadError = () => tasks.error ?? projectError() ?? (missingProjectId() ? "Project metadata is unavailable." : undefined);
  /** True while the empty state below draws its own creation primary. The no-match
   *  state offers "Clear filters" instead, so it does not suppress the header. */
  const showsEmptyPrimary = () => !loadError() && !tasks.loading && !projectsLoading() && !groups().length && !filtered() && !!profileId();

  const visible = () => (tasks() ?? []).filter(task => {
    const query = text().trim().toLowerCase();
    return (!query || task.content.toLowerCase().includes(query) || (task.notes ?? "").toLowerCase().includes(query))
      && (!assigneeId() || task.assignee_ids.includes(assigneeId()));
  });
  /* Two different facts about "the list is empty": a filter is hiding the work,
     or there is no work. `includeDone` is NOT a filter for this purpose — it
     only ever ADDS rows, so it can never be the reason nothing is shown. */
  const filtered = () => !!text().trim() || !!assigneeId();
  const clearFilters = () => { setText(""); setAssigneeId(""); };
  /* THE DEFAULT VIEW IS A LIST AND A BUTTON (stage 20). Search and the assignee
     filter rest behind one "Filter" pill; they are worth keeping on a cross-project
     list that can grow long, but they are not what this page IS. A filter that is ON
     forces the row back open — a short list must always be able to explain why it is
     short. "Show done" is NOT one of them any more: it sits in the action row
     beside "New task", because it only ever ADDS rows and can never be the reason a
     list looks short. */
  const toolsOpen = () => filtersOpen() || filtered();
  /* THE TWO FIGURES THAT CARRY A DECISION, in the header where numbers belong: how
     much of the team's work is open, and how much of it is late. The "At a glance"
     box is gone — it restated the list beside the list. */
  const openTasks = () => visible().filter(task => !task.done);
  const overdueCount = () => openTasks().filter(task => urgencyOf(task.due_date, todayISO(), 7) === "overdue").length;
  const dueSoonCount = () => openTasks().filter(task => ["today", "soon"].includes(urgencyOf(task.due_date, todayISO(), 7))).length;
  const editTask = (task: Todo) => { setEditingId(task.id); setRowError(""); };
  const closeEdit = (id: string) => { setEditingId(null); focusTaskRow(id); };
  /* The server's rule, quoted not invented: `update_todo` is owner-only
     (TodoOwnerWrite); `set_todo_completion` is owner or assignee. On a surface whose
     whole point is OTHER people's work, most rows are therefore read-only — and say
     so, instead of offering a form the server would refuse. */
  const owns = (task: Todo) => !!profileId() && task.profile_id === profileId();
  const mayComplete = (task: Todo) => owns(task) || task.assignee_ids.includes(profileId());
  /* The tile's mark is the one write you can make without opening the task, and it is
     offered exactly where the server grants it (owner or assignee) — never as a
     control that would be refused. */
  const complete = async (task: Todo, done: boolean) => {
    try { await personalApi.setTodoCompletion(task.id, done); void reloadTasks(); }
    catch (reason) { setRowError(humanError(reason)); }
  };
  /* Postponing and converting are WORDS in the row menu, as on My tasks. Both are
     `update_todo`-class writes, so they are offered on the caller's OWN rows only:
     this surface is made of other people's work, and the server would refuse the
     rest (TodoOwnerWrite). */
  const postpone = async (task: Todo, days: number) => {
    try { await personalApi.postponeTodo(task.id, days); void reloadTasks(); }
    catch (reason) { setRowError(humanError(reason)); }
  };
  const convert = async (task: Todo) => {
    try {
      if (!task.project_id) throw new Error("Give the task a project before converting it into a ticket.");
      await personalApi.convertTodoToIssue(task.id, task.project_id);
      void reloadTasks();
    } catch (reason) { setRowError(humanError(reason)); }
  };
  /* ── DELETING A TASK, ON A SURFACE MADE OF OTHER PEOPLE'S WORK ──────────────
     Same rule as My tasks, and it bites hardest here: every row on this page is
     PROJECT work, i.e. shared by definition. Only the CREATOR may delete it — being
     assigned a task is not owning it, and clearing your name off somebody's project
     by deleting their row is exactly what this refuses. Non-owners get no button and
     the reason instead; the right-click menu simply has no Delete entry.

     `deleteTodo` sends the acting profile as `actorId`: the SERVER decides, this
     view only stops offering what would be refused. */
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<Todo | null>(null);
  const [deleting, setDeleting] = createSignal(false);
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
  const openTaskMenu = (event: MouseEvent, task: Todo) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items: taskMenuItems(task) });
  };
  const deleteTask = async () => {
    const task = pendingDelete(); if (!task) return;
    setRowError(""); setDeleting(true);
    try {
      await personalApi.deleteTodo(task.id, profileId());
      setPendingDelete(null);
      if (editingId() === task.id) setEditingId(null);
      void reloadTasks();
    } catch (reason) {
      // The surface's existing error line. A refusal is shown, never swallowed.
      setRowError(humanError(reason)); setPendingDelete(null);
    } finally { setDeleting(false); }
  };
  /** Grouped by assignee so the surface directly answers who is carrying each task. */
  const groups = () => groupByAssignee(visible(), profiles() ?? []);
  return <section class="planning-view team-tasks-view">
    <Show when={menu()}>{open => <ContextMenu x={open().x} y={open().y} items={open().items} onClose={() => setMenu(null)} />}</Show>
    <ConfirmDialog
      open={!!pendingDelete()}
      title="Delete task?"
      body={<><strong>{pendingDelete()?.content}</strong> is deleted for everyone in this project, with its description, due date and assignees. This cannot be undone.</>}
      confirmLabel="Delete task"
      busy={deleting()}
      onConfirm={() => void deleteTask()}
      onCancel={() => setPendingDelete(null)} />
    {/* Sibling sentences live in Todo.tsx and ProjectTasks.tsx: whose work, how wide. */}
    {/* ONE ACTION, ONE PLACE. The header primary and the empty state's primary are
        the same act, so only one of them is ever drawn: while the surface is empty
        the empty state carries it (that is where the eye already is, and where the
        owner asked for it to be obvious), and the moment there is content the header
        takes it back. Two identical buttons on one screen is the defect this rule
        exists to prevent. */}
    {/* THE KNOWLEDGE SHAPE, in the vocabulary of work (same as My tasks): header ·
        ONE action row · a head that says what you are looking at · groups of cards.
        The figures live in the header as chips; there is no rail beside the list. */}
    <PageHeader icon="users" title="Team tasks" subline="Everybody's tasks, across every project you are in — not just yours." chips={
      <Show when={!loadError() && !tasks.loading && !projectsLoading() && !!visible().length}>
        <Chip value={openTasks().length} label="open" />
        <Show when={overdueCount()}><Chip value={overdueCount()} label="overdue" tone="red" /></Show>
        <Show when={dueSoonCount()}><Chip value={dueSoonCount()} label="due in 7 days" tone="amber" /></Show>
      </Show>
    } />
    <Show when={loadError()}>{error => <p class="planning-error" role="alert">Could not load team tasks: {String(error())}</p>}</Show>
    <Show when={rowError()}><p class="planning-error" role="alert">{rowError()}</p></Show>
    {/* A FAILED READ HAS NOTHING TO COUNT AND NOTHING TO FILTER. `visible()` reads
        the resource, and reading an errored resource re-throws — so the whole tools
        block is guarded by the same condition that draws the alert. */}
    <Show when={!loadError()}>
    {/* ONE ACTION ROW: the act first, then this surface's own switches. No second
        "New task" is drawn while an empty state carries one. */}
    <Show when={!showsEmptyPrimary()}>
      <nav class="documents-actionbar task-actionbar">
        <button type="button" class="primary doc-action-primary" onClick={() => setCreating(true)}>New task</button>
        <button type="button" class="doc-action-secondary" aria-pressed={includeDone()} onClick={() => setIncludeDone(open => !open)}>
          {includeDone() ? "Hide done" : "Show done"}
        </button>
        <GhostPill aria-expanded={toolsOpen()} onClick={() => setFiltersOpen(!toolsOpen())}>Filter</GhostPill>
      </nav>
    </Show>
    <ControlRow label="Team task filters" class="filter-row" hidden={!toolsOpen()}>
      {/* One control language: a quiet search and a pill whose resting value
          ("All profiles") is its own label — no caption above either. */}
      <QuietSearch label="Search team tasks" placeholder="Search tasks" value={text()} onInput={setText} />
      <ProfilePicker label="Assignee" labelHidden value={assigneeId()} onChange={setAssigneeId} allowAll />
    </ControlRow>
    </Show>
    <Show when={!loadError() && !profileId()}><p class="hint">Your account profile is still loading; team tasks will appear when it is ready.</p></Show>
    <Show when={!loadError() && (tasks.loading || projectsLoading())}><p class="hint">Loading team tasks…</p></Show>
    {/* FILTERS MATCH NOTHING: the store has work, this filter simply hides it,
        so the only right offer is to clear the filter — never "create", which
        would invite a duplicate of the task being searched for. */}
    <Show when={!loadError() && !tasks.loading && !projectsLoading() && !groups().length && filtered()}>
      <EmptyState variant="no-match" title="No team tasks match these filters." actions={<GhostPill onClick={clearFilters}>Clear filters</GhostPill>} />
    </Show>
    {/* NOTHING YET across every project the caller is a member of. Creation used to
        be a navigation to My tasks; it is the same drawer as everywhere else now, so
        the primary does the thing instead of sending the reader somewhere to do it. */}
    <Show when={!loadError() && !tasks.loading && !projectsLoading() && !groups().length && !filtered() && !!profileId()}>
      <EmptyState
        title="Nobody has a running task yet"
        hint="This is everyone's work across your projects — it fills up as people add tasks."
        actions={<button type="button" class="primary" onClick={() => setCreating(true)}>Add the first task</button>}
      />
    </Show>
    <Show when={!loadError() && !projectsLoading() && !!groups().length}>
      <div class="task-board">
        {/* A new task is born where it will live — the same editor the rows open, at
            the top of the list, instead of a panel sliding in from the right. */}
        <Show when={creating()}>
          <div class="task-grid task-create-grid" aria-label="New task">
            <div class="task-open">
              <div class="task-row-editing">
                <TaskRowEdit
                  mode="create"
                  task={blankTask(profileId())}
                  canEdit
                  canComplete={false}
                  ownerName={nameOf(profileId())}
                  onCancel={() => setCreating(false)}
                  onSaved={() => { setCreating(false); void reloadTasks(); }}
                  onError={setRowError} />
              </div>
            </div>
          </div>
        </Show>
        <ContentHead icon="users" title="Who is on what" line="Open a task to edit it, or drag it onto a project in the sidebar to file it there." />
        <For each={groups()}>{group => <section class="tt-group" aria-label={group.name}>
          <p class="task-group-heading tt-group-head">
            {group.name}
            <span class="count">{group.items.length}</span>
          </p>
          <div class="task-grid tt-list" aria-label={`${group.name} tasks`}>
            <For each={group.items}>{task => {
              /* THE TASK TILE, the card My tasks introduced, said for OTHER people's
                 work: the mark carries how much room is left, the name is bold, and the
                 ONE meta line names WHOSE work this is — creator first, then whoever
                 carries it. A card on this surface that did not say that would be
                 worthless. Urgency is painted on the DATE alone (statusTone.ts). */
              const urgency = () => task.done ? "none" : urgencyOf(task.due_date, todayISO(), 7);
              return <Show when={editingId() === task.id} fallback={
                <article
                  class="task-tile tt-row"
                  classList={{ done: task.done }}
                  draggable={!task.done}
                  onDragStart={event => event.dataTransfer?.setData("application/x-gaia-task", JSON.stringify({ id: task.id, title: task.content }))}
                  onContextMenu={event => openTaskMenu(event, task)}
                >
                  {/* THE MARK SAYS THE STATE, NOT THE ACT: open work carries "!", only a
                      finished task wears the tick. Completing is owner-or-assignee
                      (the server's TodoCompletionWrite), so the button is disabled —
                      never refused after the click — for everybody else. */}
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
                  <button type="button" class="task-tile-body" data-task-row={task.id} aria-label={`Open ${task.content}`} onClick={() => editTask(task)}>
                    <span class="task-tile-title">{task.content}</span>
                    <span class="task-tile-meta">
                      {/* TWO NAMES, TWO ROLES, SAID OUT LOUD. The line used to read
                          "Jannes · Unassigned", which reads as a contradiction: the
                          first name is the AUTHOR, not the person carrying it. Each
                          fact now carries the word that makes it readable. */}
                      <span class="tt-author">by {nameOf(task.profile_id)}</span>
                      <span class="sep">·</span>
                      <span class="tt-assignees">{task.assignee_ids.length ? `for ${task.assignee_ids.map(nameOf).join(", ")}` : "nobody assigned"}</span>
                    </span>
                  </button>
                  <span class="task-tile-edge">
                    <Show when={task.due_date}>{date => <span class="task-due" classList={{ [urgency()]: urgency() !== "none" }}>{date()}</span>}</Show>
                  </span>
                  <button class="task-tile-menu" aria-label={`Actions for ${task.content}`} title="Actions" onClick={event => openTaskMenu(event, task)}>⋯</button>
                </article>
              }>
                {/* THE SAME GESTURE AS EVERYWHERE ELSE: the task opens IN PLACE, in the
                    grid cell it occupied, and the editor takes the whole row. */}
                <div class="task-open">
                  <div class="task-row-editing">
                    {/* Delete travels INTO the editor's own footer, the same as on the
                        other two task surfaces — all three open one editor, so all three
                        must end in one row of buttons rather than a floating red strip. */}
                    <TaskRowEdit task={task} canEdit={owns(task)} canComplete={mayComplete(task)}
                      ownerName={nameOf(task.profile_id)}
                      onCancel={() => closeEdit(task.id)}
                      onSaved={() => { closeEdit(task.id); void reloadTasks(); }}
                      onError={setRowError}
                      danger={<DeleteButton
                        label={`Delete ${task.content}`}
                        canDelete={owns(task)}
                        deniedReason="Only the owner can delete this"
                        onRequest={() => setPendingDelete(task)} />} />
                  </div>
                </div>
              </Show>;
            }}</For>
          </div>
        </section>}</For>
      </div>
    </Show>
  </section>;
}
