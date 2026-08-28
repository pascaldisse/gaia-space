import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { personalApi, type Todo } from "../api/personal";
import { ProfilePicker } from "../components/Pickers";
import { humanError, profileId, profiles, projects, reloadProjects } from "../session";
import { linkProps } from "../router";
import { ControlRow, GhostPill, QuietSearch } from "../components/controls";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "../components/ContextMenu";
import DeleteButton from "../components/DeleteButton";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import TaskDrawer from "../components/TaskDrawer";
import TaskRowEdit, { focusTaskRow } from "../components/TaskRowEdit";
import { todayISO, urgencyOf } from "../statusTone";
import "../components/paper.css";
import "../components/TaskList.css";
import "../components/TaskRowEdit.css";
import "./Issues.css";
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
  const projectName = (id: string) => projects()?.find(item => item.id === id)?.name;
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
  /* THE DEFAULT VIEW IS A LIST AND A BUTTON (stage 20). Search, the assignee filter
     and "Show completed" rest behind one "Filter" pill; they are worth keeping on a
     cross-project list that can grow long, but they are not what this page IS.
     A filter that is ON forces the row back open — a short list must always be able
     to explain why it is short. */
  const toolsOpen = () => filtersOpen() || filtered() || includeDone();
  const editTask = (task: Todo) => { setEditingId(task.id); setRowError(""); };
  const closeEdit = (id: string) => { setEditingId(null); focusTaskRow(id); };
  /* The server's rule, quoted not invented: `update_todo` is owner-only
     (TodoOwnerWrite); `set_todo_completion` is owner or assignee. On a surface whose
     whole point is OTHER people's work, most rows are therefore read-only — and say
     so, instead of offering a form the server would refuse. */
  const owns = (task: Todo) => !!profileId() && task.profile_id === profileId();
  const mayComplete = (task: Todo) => owns(task) || task.assignee_ids.includes(profileId());
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
  /** Grouped by project, project names ordered alphabetically so the list is stable. */
  const groups = () => {
    const by = new Map<string, Todo[]>();
    for (const task of visible()) {
      const key = task.project_id ?? "";
      const bucket = by.get(key); bucket ? bucket.push(task) : by.set(key, [task]);
    }
    return [...by.entries()]
      .map(([project_id, items]) => { const name = projectName(project_id); return name === undefined ? undefined : { project_id, name, items }; })
      .filter((group): group is { project_id: string; name: string; items: Todo[] } => group !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

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
    <PageHeader title="Team tasks" subline="Everybody's tasks, across every project you are in — not just yours." actions={
      <Show when={!showsEmptyPrimary()}>
        <div class="planning-actions">
          <button type="button" class="primary" onClick={() => setCreating(true)}>New task</button>
        </div>
      </Show>
    } />
    <Show when={loadError()}>{error => <p class="planning-error" role="alert">Could not load team tasks: {String(error())}</p>}</Show>
    <Show when={rowError()}><p class="planning-error" role="alert">{rowError()}</p></Show>
    {/* A FAILED READ HAS NOTHING TO COUNT AND NOTHING TO FILTER. `visible()` reads
        the resource, and reading an errored resource re-throws — so the whole tools
        block is guarded by the same condition that draws the alert. */}
    <Show when={!loadError()}>
    <div class="task-tools">
      <h2>Running tasks <small>{visible().length}</small></h2>
      <GhostPill aria-expanded={toolsOpen()} onClick={() => setFiltersOpen(!toolsOpen())}>Filter</GhostPill>
    </div>
    <ControlRow label="Team task filters" class="filter-row" hidden={!toolsOpen()}>
      {/* One control language: a quiet search and a pill whose resting value
          ("All profiles") is its own label — no caption above either. */}
      <QuietSearch label="Search team tasks" placeholder="Search tasks" value={text()} onInput={setText} />
      <ProfilePicker label="Assignee" labelHidden value={assigneeId()} onChange={setAssigneeId} allowAll />
      <label class="tt-toggle"><input type="checkbox" aria-label="Show completed" checked={includeDone()} onChange={event => setIncludeDone(event.currentTarget.checked)} /> Show completed</label>
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
    <Show when={!loadError() && !projectsLoading()}><For each={groups()}>{group => <section class="tt-group" aria-label={group.name}>
      <h2 class="tt-group-head"><a {...linkProps({ view: "Project Tasks", projectId: group.project_id })}>{group.name}</a> <small>{group.items.length}</small></h2>
      <ul class="task-list-plain tt-list">
        <For each={group.items}>{task => {
          /* THE TASK ROW, not the ticket row (stage 20): a done marker, the title,
             and ONE quiet meta line. Urgency is painted on the DATE alone, by the
             shared rule in statusTone.ts — never on the title. */
          const urgency = () => task.done ? "none" : urgencyOf(task.due_date, todayISO());
          return <li>
            {/* THE SAME GESTURE AS EVERYWHERE ELSE: the row opens itself, in place. */}
            <Show when={editingId() === task.id} fallback={
            <div class="task-row tt-row" classList={{ done: task.done, overdue: urgency() === "overdue" }} onContextMenu={event => openTaskMenu(event, task)}>
              <span class="task-row-marker" aria-hidden="true">{task.done ? "✓" : "○"}</span>
              <button type="button" class="task-row-main" data-task-row={task.id} aria-label={`Open ${task.content}`} onClick={() => editTask(task)}>
                <strong class="task-row-title">{task.content}</strong>
                <span class="task-row-meta">
                  <span class="tt-author">{nameOf(task.profile_id)}</span>
                  <span class="tt-assignees">{task.assignee_ids.length ? task.assignee_ids.map(nameOf).join(", ") : "Unassigned"}</span>
                  <Show when={task.due_date}>{date => <time classList={{ [urgency()]: urgency() !== "none" }}>{date()}</time>}</Show>
                </span>
              </button>
            </div>}>
              <div class="task-row-editing">
                <TaskRowEdit task={task} canEdit={owns(task)} canComplete={mayComplete(task)}
                  ownerName={nameOf(task.profile_id)}
                  onCancel={() => closeEdit(task.id)}
                  onSaved={() => { closeEdit(task.id); void reloadTasks(); }}
                  onError={setRowError} />
                {/* The opened task's facts, and beside them the act that removes them. */}
                <div class="task-danger-row">
                  <DeleteButton
                    label={`Delete ${task.content}`}
                    canDelete={owns(task)}
                    deniedReason="Only the owner can delete this"
                    onRequest={() => setPendingDelete(task)} />
                </div>
              </div>
            </Show>
          </li>;
        }}</For>
      </ul>
    </section>}</For></Show>
    {/* One creation act, one shape, on every task surface. Cross-project, so the
        drawer draws its project chooser and reads that project's members. */}
    <Show when={creating()}><TaskDrawer authorId={profileId()} onClose={() => setCreating(false)} onSaved={() => void reloadTasks()} /></Show>
  </section>;
}
