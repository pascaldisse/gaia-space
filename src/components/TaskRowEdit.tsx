import { Show, createResource, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { TODO_CATEGORIES, personalApi, type Todo, type TodoContentKind } from "../api/personal";
import { AssigneeControl, CategoryControl, DueDateControl, ProjectControl } from "./TaskMeta";
import { Icon } from "./Icon";
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

/**
 * ── ONE FORM FOR BOTH ACTS (product owner, 2026-08-29) ──────────────────────
 *
 *   *"Warum öffnet sich nicht eine Ansicht wie wenn ich einen Task BEARBEITE?"*
 *
 * WHY THIS COMPONENT IS THE SHARED CORE, and not a third "TaskForm" beside it:
 * creating and editing a task ask for THE SAME FACTS. The drawer had its own field
 * list — fewer fields, another order, another look — and the two lists drifted apart
 * exactly as two lists do. So the editor that already carried the full list became the
 * ONE list, and the drawer became what it really is: a shell (backdrop, panel, header)
 * around it. Reuse rather than extraction, because extraction would have left two
 * callers of a core plus two host components — one more place for a field to be
 * forgotten. There is now exactly ONE JSX field list for tasks in this codebase.
 *
 * WHAT THE MODE MAY CHANGE — only what the acts themselves differ in:
 *   create → no Done toggle, no Delete, no source anchor to keep; primary "Create task"
 *   edit   → Done, Delete (handed in by the host), read-only form for non-owners; "Save"
 * Everything else — fields, their order, their controls, their stylesheet — is shared
 * by construction, because it is literally the same markup.
 */
export default function TaskRowEdit(props: {
  /** "edit" changes a task that exists (update_todo); "create" writes a new one
   *  (create_todo) from a blank draft (see `blankTask`). Default: edit. */
  mode?: "edit" | "create";
  task: Todo;
  /** Extra class on the form root, so a host (the drawer) can address it. */
  formClass?: string;
  /** Rendered just above the row of buttons — the host's error line. */
  errorSlot?: JSX.Element;
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
  /** THE ONE ACT THAT REMOVES THE TASK, handed in by the surface that owns deletion.
   *  It is a slot rather than a flag because only the host knows who may delete and
   *  what the confirmation is — but it belongs in THIS row of buttons, not floating
   *  under the card in a strip of its own. */
  danger?: JSX.Element;
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
    category: props.task.category ?? "",
    source_entity_type: props.task.source_entity_type ?? "",
    source_entity_id: props.task.source_entity_id ?? "",
    done: props.task.done,
  });
  const [busy, setBusy] = createSignal(false);
  const creating = () => props.mode === "create";
  let firstField!: HTMLInputElement;
  let notesField!: HTMLTextAreaElement;
  let root!: HTMLFormElement;

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
    .map(person => ({ id: person.id, label: person.display_name || person.username, sub: person.username, avatarUrl: person.avatar_url }));
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
    // An open meta popover owns Escape first: closing the whole form under a person who
    // only wanted to dismiss the date picker loses everything they typed.
    if (event.key === "Escape" && !root?.querySelector(".tm-menu")) {
      event.preventDefault(); event.stopPropagation(); if (!busy()) props.onCancel();
    }
  };

  const save = async () => {
    const values = form();
    if (busy()) return;
    if (!values.content.trim()) { props.onError("Task content cannot be empty."); return; }
    if (creating() && !props.task.profile_id) { props.onError("Your account profile is still loading."); return; }
    if (Boolean(values.source_entity_type) !== Boolean(values.source_entity_id)) {
      props.onError("Source type and source ID must be supplied together."); return;
    }
    setBusy(true);
    try {
      const written = {
        content: values.content.trim(),
        notes: values.notes.trim() || null,
        due_date: values.due_date || null,
        project_id: values.project_id || null,
        assignee_ids: values.assignee_ids,
        content_kind: values.content_kind,
        category: values.category || null,
      };
      if (creating()) {
        // `props.task` is the blank draft: it carries who the author is and any project
        // the surface already decided. Identity is the server's to mint, so no id goes out.
        const { id: _drop, ...draft } = props.task;
        props.onSaved(await personalApi.createTodo({ ...draft, ...written, done: false }));
        return;
      }
      // The original is spread FIRST: identity and every field this form does not show
      // (id, profile_id, and the source anchor where it is not offered) survive intact.
      const saved = await personalApi.updateTodo({
        ...props.task,
        ...written,
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

  return <form class="task-edit" classList={{ [props.formClass ?? ""]: Boolean(props.formClass) }}
    ref={root} onKeyDown={onKeyDown}
    onSubmit={event => { event.preventDefault(); if (props.canEdit) void save(); }}>
    <input class="composer-title" ref={firstField} aria-label="Task title"
      placeholder={creating() ? "What needs doing?" : undefined} value={form().content}
      readOnly={!props.canEdit} disabled={!props.canEdit}
      onInput={event => patch({ content: event.currentTarget.value })}
      /* ENTER ON THE TITLE SAVES: the one-key exit for the change people actually
         make most often. Shift+Enter is left alone for nothing here, and the notes
         field keeps its own newlines. */
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && props.canEdit) { event.preventDefault(); void save(); } }} />
    <Show when={props.canEdit} fallback={
      <p class="task-edit-readonly" role="note">Only {props.ownerName} can change this task{props.canComplete ? " — you can still tick it done." : "."}</p>
    }>
      {/* FIELD ORDER IS THE ORDER A PERSON DECIDES IN (product owner, 2026-08-29):
          title · description · due date · project · assignees · category. What the work
          IS comes first, WHEN it is due next, WHERE it lives and WHO carries it after,
          and the optional kind last. The description was below the meta row before,
          which put three choosers between a task's name and what it is about. */}
      <div class="todo-field todo-field-notes">
        <div class="task-edit-field-head">
          <span class="field-label">Description</span>
        </div>
        <textarea class="composer-notes" ref={notesField} rows="3" aria-label="Task description" placeholder="A line on what this is about"
          value={form().notes} onInput={event => patch({ notes: event.currentTarget.value })} />
      </div>
      <div class="composer-meta tm-row">
        <DueDateControl value={form().due_date} onChange={iso => patch({ due_date: iso })} />
        {/* THE CONTEXT IS INHERITED, NEVER ASKED: on a project surface the project is a
            fact (`fixedProject`), so no chooser is drawn — in either mode. */}
        <Show when={!props.fixedProject}>
          <ProjectControl value={form().project_id} projects={selectableProjects()} onChange={selectProject} />
        </Show>
        <AssigneeControl value={form().assignee_ids} people={assignable()} onToggle={toggleAssignee} nameOf={nameOf}
          disabled={!form().project_id} disabledReason="Select a project before assigning members"
          emptyNote={membersFailed() ? `The project's members could not be loaded: ${membersFailed()}` : "This project has no members available for assignment."} />
        {/* WHAT KIND OF ACT THIS IS — optional, and last, because it is the only one of
            the four that changes nothing about who sees the task or when it is due. */}
        <CategoryControl value={form().category} options={TODO_CATEGORIES}
          onChange={value => patch({ category: value })} />
      </div>
      <Show when={membersFailed()}>{reason => <p class="personal-error" role="alert">The project's members could not be loaded: {reason()}</p>}</Show>
      {/* THE CHIP ROW IS GONE. It listed exactly what the Assignee control above it
          already summarises — one fact stated twice, in two different widths, and
          (while the name lookup was broken) with two different answers. Removing an
          assignee is where adding one is: inside the control, by untick. */}
      {/* Called DESCRIPTION, because that is what the row invites you to add. It was
          labelled "Notes" while the affordance said "add a short description" — one
          thing under two names, so the field was looked straight at and not
          recognised. The wire name stays `notes`; only the word a person reads
          changed. */}
      {/* THE MARKDOWN SWITCH IS GONE (product owner, 2026-08-29). It asked a person to
          declare a STORAGE FORMAT for a task's title — a question about the machine,
          not about the work, and one nobody could answer without knowing what
          `content_kind` is. A task name is one line; bold and bullets in it buy
          nothing.

          THE DATA IS UNTOUCHED. `content_kind` still travels through `form()` and is
          still saved, and the tile still renders a title stored as markdown as
          markdown — so tasks written before today keep reading exactly as they did.
          Only the way to CHANGE it has been withdrawn. */}
      {/* The source anchor is NOT hand-editable, and it never should have been.
            It is set by the act that creates the work — "Create task" on a message
            writes it — and it is READ back as a link on the row (SourceLink). Two raw
            fields asking a person to type an entity type and a UUID could only ever
            produce a broken link, and they were the most confusing thing on this
            surface. The value still travels through `form()` untouched, so editing a
            task that HAS a source no longer risks erasing it by hand. */}
    </Show>
    {/* ONE ROW CARRIES EVERY WAY OUT of this editor, in the order they are weighed:
        the state of the work, the act that destroys it, then leave-or-keep. Done was a
        loose checkbox floating above the buttons and Delete hung in a strip BELOW the
        card, outside its border — three decisions in three unrelated places. */}
    {props.errorSlot}
    <div class="composer-actions task-edit-actions">
      {/* A BARE CHECKBOX IS NOT A PEER OF Save AND Delete. Ticking a task off is one of
          the two things anybody comes to this editor to do, and it sat here as the
          smallest, lightest thing in a row of proper buttons — read as a setting rather
          than an act. It is now the same shape, height and weight as its neighbours and
          says which way it goes: "Mark done" while open, "Done" once it is.

          It is a TOGGLE, not a form field, so it states its own pressed state
          (`aria-pressed`) instead of hiding it in a checkbox a screen reader must
          hunt for. */}
      <Show when={props.canComplete}>
        <button type="button" class="task-edit-done" classList={{ on: form().done }}
          aria-pressed={form().done} disabled={busy()}
          title={form().done ? "Mark this task not done" : "Mark this task done"}
          onClick={() => { const next = !form().done; props.canEdit ? patch({ done: next }) : void completeOnly(next); }}>
          <span class="task-edit-done-mark" aria-hidden="true"><Show when={form().done}><Icon name="check" size={13} /></Show></span>
          {form().done ? "Done" : "Mark done"}
        </button>
      </Show>
      <Show when={props.danger}><span class="task-edit-danger">{props.danger}</span></Show>
      <span class="task-edit-spacer" />
      <button type="button" class="ghost" onClick={() => props.onCancel()} disabled={busy()}>Cancel</button>
      <Show when={props.canEdit}>
        {/* type=submit, so the host's <form> gesture and this button are one act. */}
        <button type="submit" class="primary composer-submit" disabled={busy() || !form().content.trim()}>
          {creating() ? (busy() ? "Creating…" : "Create task") : "Save"}
        </button>
      </Show>
    </div>
  </form>;
}

/** The blank a create opens on: everything the form does not ask for, decided by the
 *  surface. It is a `Todo` so the ONE form can read it without a second shape. */
export const blankTask = (authorId: string, projectId?: string, category?: string | null): Todo => ({
  id: "", profile_id: authorId, content: "", notes: "", due_date: null,
  project_id: projectId || null, done: false,
  source_entity_type: null, source_entity_id: null,
  assignee_ids: [], content_kind: "text", category: category ?? null, links: [],
});
