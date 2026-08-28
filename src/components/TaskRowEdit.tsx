import { For, Show, createResource, createSignal, onMount } from "solid-js";
import { personalApi, type Todo, type TodoContentKind } from "../api/personal";
import { AssigneeControl, DueDateControl, ProjectControl } from "./TaskMeta";
import { humanError, profiles, projects } from "../session";
/* The editor's control language IS My tasks' composer language — the same
   `.composer-title`, `.composer-meta`, `.composer-actions`, chips and folds that
   shipped there. It is imported rather than copied: two stylesheets describing one
   editor is how two editors start. */
import "../views/Todo.css";
import "./TaskRowEdit.css";

/**
 * ── EDITING HAPPENS IN THE ROW (stage 20, product owner) ────────────────────
 *
 *   *"The task should simply be clickable, so that you edit the task IN ITSELF."*
 *
 * Two acts, two places: the DRAWER creates a task that does not exist yet, the ROW
 * changes one that does. This component is the row's second face. It is lifted out
 * of Todo.tsx's existing in-row editor rather than invented beside it, so all three
 * task surfaces open the same thing with the same gesture.
 *
 * WHO MAY EDIT — not a guess. `update_todo` is `CommandPolicy::TodoOwnerWrite` on the
 * server (space-server.rs): only the todo's OWNER (its `profile_id`) or a GlobalAdmin
 * may change it. `set_todo_completion` is `TodoCompletionWrite`: owner OR assignee.
 * So a non-owner still opens the row and reads every field, and still ticks it done if
 * it is assigned to them — the two writes are offered exactly where the server grants
 * them, and nowhere else. Showing a live form that the server would refuse is a lie
 * the old surfaces told ("The task owner can edit full task details in My tasks").
 */
/**
 * FOCUS COMES BACK TO THE ROW when the editor closes — and it cannot simply be the
 * element that opened it: closing follows a re-read, which replaces that button with a
 * new one. So the row is found again BY TASK ID, and looked for a few times, because
 * the list may still be re-rendering when the editor closes.
 *
 * setTimeout, NOT requestAnimationFrame: measured in the running app, rAF never fires
 * while the window is not the foreground one (`document.hasFocus()` false), so a
 * rAF-scheduled restore silently never happens. A timer runs either way.
 */
export function focusTaskRow(id: string, tries = 12): void {
  const attempt = () => {
    const row = document.querySelector<HTMLElement>(`[data-task-row="${id}"]`);
    if (row) { row.focus(); return; }
    if (tries-- > 0) setTimeout(attempt, 25);
  };
  queueMicrotask(attempt);
}

export default function TaskRowEdit(props: {
  task: Todo;
  /** The surface fixes the project (project Tasks tab): no chooser is drawn. */
  fixedProject?: boolean;
  /** The markdown switch and the source bookmark: My tasks only, where they exist. */
  advanced?: boolean;
  /** Which field the editor opens ON. An affordance that says "add a description"
   *  must land the caret in the description — otherwise it promises one thing and
   *  delivers a form focused on something else, which reads as "it does not work". */
  focusField?: "title" | "notes";
  /** Owner (or admin): may write every field. */
  canEdit: boolean;
  /** Owner or assignee: may tick it done. */
  canComplete: boolean;
  /** Who owns it, for the one line that explains a read-only form. */
  ownerName: string;
  onCancel: () => void;
  onSaved: (task: Todo) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = createSignal({
    content: props.task.content,
    notes: props.task.notes ?? "",
    due_date: props.task.due_date ?? "",
    project_id: props.task.project_id ?? "",
    assignee_ids: [...props.task.assignee_ids],
    content_kind: (props.task.content_kind ?? "text") as TodoContentKind,
    source_entity_type: props.task.source_entity_type ?? "",
    source_entity_id: props.task.source_entity_id ?? "",
    done: props.task.done,
  });
  const [busy, setBusy] = createSignal(false);
  let firstField!: HTMLInputElement;
  let notesField!: HTMLTextAreaElement;

  // A refused member read is carried as a value: the editor must say the list could
  // not be loaded, never quietly offer "nobody" as if the project were empty.
  const [members] = createResource(
    () => form().project_id,
    async (id: string): Promise<{ ids?: string[]; failed?: string }> => {
      if (!id) return { ids: [] };
      try { return { ids: await personalApi.projectMemberIds(id) }; }
      catch (reason) { return { failed: humanError(reason) }; }
    },
  );
  const memberIds = () => members()?.ids ?? [];
  const membersFailed = () => members()?.failed ?? "";
  const active = () => (profiles() ?? []).filter(person => !person.archived);
  const nameOf = (id: string) => { const person = active().find(item => item.id === id); return person ? (person.display_name || person.username) : id; };
  const assignable = () => active().filter(person => memberIds().includes(person.id))
    .map(person => ({ id: person.id, label: person.display_name || person.username, sub: person.username }));
  const selectableProjects = () => (projects() ?? []).filter(project => !project.archived)
    .map(project => ({ id: project.id, name: project.name, key: project.key }));

  const patch = (values: Partial<ReturnType<typeof form>>) => setForm({ ...form(), ...values });
  const toggleAssignee = (id: string) => {
    const current = form().assignee_ids;
    patch({ assignee_ids: current.includes(id) ? current.filter(value => value !== id) : [...current, id] });
  };
  const selectProject = (id: string) => patch({ project_id: id, assignee_ids: id ? form().assignee_ids : [] });

  // FOCUS GOES IN ON OPEN and — the host's half of the bargain — back to the row on
  // close, so a keyboard never loses its place in the list.
  onMount(() => {
    if (props.focusField === "notes" && notesField) { notesField.focus(); return; }
    firstField?.focus(); firstField?.select?.();
  });
  // ESCAPE CLOSES WITHOUT SAVING, from anywhere inside the editor, and is caught here
  // rather than on one field: a person who tabbed to the notes still means "get out".
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy()) props.onCancel(); }
  };

  const save = async () => {
    const values = form();
    if (busy()) return;
    if (!values.content.trim()) { props.onError("Task content cannot be empty."); return; }
    if (Boolean(values.source_entity_type) !== Boolean(values.source_entity_id)) {
      props.onError("Source type and source ID must be supplied together."); return;
    }
    setBusy(true);
    try {
      // The original is spread FIRST: identity and every field this form does not show
      // (id, profile_id, and the source anchor where it is not offered) survive intact.
      const saved = await personalApi.updateTodo({
        ...props.task,
        content: values.content.trim(),
        notes: values.notes.trim() || null,
        due_date: values.due_date || null,
        project_id: values.project_id || null,
        assignee_ids: values.assignee_ids,
        content_kind: values.content_kind,
        done: values.done,
        ...(props.advanced
          ? { source_entity_type: values.source_entity_type || null, source_entity_id: values.source_entity_id || null }
          : {}),
      });
      props.onSaved(saved);
    } catch (reason) {
      props.onError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };
  /** A non-owner may still tick a task assigned to them; that is a different command
   *  with a different policy, so it goes through its own door. */
  const completeOnly = async (done: boolean) => {
    setBusy(true);
    try { props.onSaved(await personalApi.setTodoCompletion(props.task.id, done)); }
    catch (reason) { props.onError(humanError(reason)); }
    finally { setBusy(false); }
  };

  return <div class="task-edit" onKeyDown={onKeyDown}>
    <input class="composer-title" ref={firstField} aria-label="Task title" value={form().content}
      readOnly={!props.canEdit} disabled={!props.canEdit}
      onInput={event => patch({ content: event.currentTarget.value })}
      /* ENTER ON THE TITLE SAVES: the one-key exit for the change people actually
         make most often. Shift+Enter is left alone for nothing here, and the notes
         field keeps its own newlines. */
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && props.canEdit) { event.preventDefault(); void save(); } }} />
    <Show when={props.canEdit} fallback={
      <p class="task-edit-readonly" role="note">Only {props.ownerName} can change this task{props.canComplete ? " — you can still tick it done." : "."}</p>
    }>
      <div class="composer-meta tm-row">
        <Show when={!props.fixedProject}>
          <ProjectControl value={form().project_id} projects={selectableProjects()} onChange={selectProject} />
        </Show>
        <DueDateControl value={form().due_date} onChange={iso => patch({ due_date: iso })} />
        <AssigneeControl value={form().assignee_ids} people={assignable()} onToggle={toggleAssignee}
          disabled={!form().project_id} disabledReason="Select a project before assigning members"
          emptyNote={membersFailed() ? `The project's members could not be loaded: ${membersFailed()}` : "This project has no members available for assignment."} />
      </div>
      <Show when={membersFailed()}>{reason => <p class="personal-error" role="alert">The project's members could not be loaded: {reason()}</p>}</Show>
      <Show when={form().assignee_ids.length}>
        <ul class="assignee-chips"><For each={form().assignee_ids}>{id => <li class="assignee-chip">{nameOf(id)}
          <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => toggleAssignee(id)}>×</button>
        </li>}</For></ul>
      </Show>
      {/* Called DESCRIPTION, because that is what the row invites you to add. It was
          labelled "Notes" while the affordance said "add a short description" — one
          thing under two names, so the field was looked straight at and not
          recognised. The wire name stays `notes`; only the word a person reads
          changed. */}
      <label class="todo-field todo-field-notes"><span class="field-label">Description</span>
        <textarea class="composer-notes" ref={notesField} rows="3" aria-label="Task description" placeholder="A line on what this is about"
          value={form().notes} onInput={event => patch({ notes: event.currentTarget.value })} />
      </label>
      <Show when={props.advanced}>
        <label class="fld-check"><input type="checkbox" checked={form().content_kind === "markdown"}
          onChange={event => patch({ content_kind: event.currentTarget.checked ? "markdown" : "text" })} /> Markdown body</label>
        {/* The source anchor is NOT hand-editable, and it never should have been.
            It is set by the act that creates the work — "Create task" on a message
            writes it — and it is READ back as a link on the row (SourceLink). Two raw
            fields asking a person to type an entity type and a UUID could only ever
            produce a broken link, and they were the most confusing thing on this
            surface. The value still travels through `form()` untouched, so editing a
            task that HAS a source no longer risks erasing it by hand. */}
      </Show>
    </Show>
    <Show when={props.canComplete}>
      <label class="fld-check task-edit-done"><input type="checkbox" aria-label="Task done" checked={form().done}
        onChange={event => props.canEdit ? patch({ done: event.currentTarget.checked }) : void completeOnly(event.currentTarget.checked)} /> Done</label>
    </Show>
    <div class="composer-actions task-edit-actions">
      <button type="button" class="ghost" onClick={() => props.onCancel()} disabled={busy()}>Cancel</button>
      <Show when={props.canEdit}>
        <button type="button" class="primary composer-submit" onClick={() => void save()} disabled={busy() || !form().content.trim()}>Save</button>
      </Show>
    </div>
  </div>;
}
