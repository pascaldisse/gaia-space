import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { personalApi, type Todo, type TodoContentKind } from "../api/personal";
import { PillSelect } from "./controls";
import { humanError, profiles, projects } from "../session";
import "./WorkItemDrawer.css";

/**
 * THE ONE TASK DRAWER (stage 20).
 *
 * WHY IT EXISTS: a task surface is a list and a button. Before this, each of the three
 * task surfaces created a task in a shape of its own — ProjectTasks in a form inside a
 * detail pane, My tasks in an always-open inline composer, Team tasks not at all (it
 * sent you to another page). Three doors for one act.
 *
 * WHY A DRAWER AND NOT A DIALOG: tickets (IssueCreateDrawer), meetings, documents and
 * channels already create in this drawer; the shape and its stylesheet (WorkItemDrawer.css)
 * are shipped. A task is not a different kind of act.
 *
 * IT ONLY CREATES. Changing a task that already exists happens IN ITS ROW
 * (components/TaskRowEdit.tsx) — the product owner's decision, and the right one: the
 * drawer is for a task that does not exist yet, the row is for the thing that is
 * already there, in the place where it already is.
 */

const blank = () => ({
  content: "", notes: "", due_date: "", project_id: "",
  assignee_ids: [] as string[],
  content_kind: "text" as TodoContentKind,
  source_entity_type: "", source_entity_id: "",
});

export default function TaskDrawer(props: {
  /** The project is decided by the surface (project Tasks tab): no chooser is drawn. */
  projectId?: string;
  /** Whose task this is on create. */
  authorId: string;
  /** Offer the two fields only My tasks ever had: the markdown switch and the source
   *  bookmark. Not shown where they never existed — a drawer is not a place to grow
   *  fields a surface never offered. */
  advanced?: boolean;
  onClose: () => void;
  onSaved: (task: Todo) => void;
}) {
  const [form, setForm] = createSignal({ ...blank(), project_id: props.projectId ?? "" });
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let firstField!: HTMLInputElement;

  /* A REFUSED MEMBER READ IS NOT AN EMPTY PROJECT (the rule Todo.tsx already carries):
     the failure is carried as a value and said out loud, never shown as "nobody". */
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
  // Assignable people are the PROJECT'S members: the project decides who may carry its
  // work, and the server refuses anybody else.
  const assignable = () => (profiles() ?? []).filter(person => !person.archived && memberIds().includes(person.id));
  const selectableProjects = () => (projects() ?? []).filter(project => !project.archived);
  const nameOf = (person: { display_name: string | null; username: string }) => person.display_name || person.username;

  const close = () => { if (!busy()) props.onClose(); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    firstField?.focus();
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  const patch = (values: Partial<ReturnType<typeof blank>>) => setForm({ ...form(), ...values });
  const selectProject = (id: string) => patch({ project_id: id, assignee_ids: id ? form().assignee_ids : [] });
  const togglePerson = (id: string) => {
    const current = form().assignee_ids;
    patch({ assignee_ids: current.includes(id) ? current.filter(value => value !== id) : [...current, id] });
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const values = form();
    const heading = values.content.trim();
    if (!heading) { setError("Enter a task title."); return; }
    if (!props.authorId) { setError("Your account profile is still loading."); return; }
    if (Boolean(values.source_entity_type) !== Boolean(values.source_entity_id)) {
      setError("Source type and source ID must be supplied together."); return;
    }
    setError(""); setBusy(true);
    try {
      const written = {
        content: heading,
        notes: values.notes.trim() || null,
        due_date: values.due_date || null,
        project_id: values.project_id || null,
        assignee_ids: values.assignee_ids,
        content_kind: values.content_kind,
        ...(props.advanced
          ? { source_entity_type: values.source_entity_type || null, source_entity_id: values.source_entity_id || null }
          : {}),
      };
      const saved = await personalApi.createTodo({
        profile_id: props.authorId, done: false,
        source_entity_type: null, source_entity_id: null,
        ...written,
      });
      props.onSaved(saved);
      props.onClose();
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div class="wid-root">
    <div class="wid-backdrop" onClick={close} aria-hidden="true" />
    <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="tdw-heading">
      <header class="wid-head">
        <h2 id="tdw-heading">New task</h2>
        <p>A running to-do — not a tracked ticket.</p>
      </header>
      <form class="wid-form task-drawer-form" onSubmit={submit}>
        <label class="wid-field"><span>Title</span>
          <input class="wid-input" ref={firstField} aria-label="Task title" value={form().content}
            placeholder="What needs doing?" onInput={event => patch({ content: event.currentTarget.value })} />
        </label>
        <label class="wid-field"><span>Notes</span>
          <textarea class="wid-input" aria-label="Task notes" value={form().notes}
            placeholder="Context, links, hand-over notes" onInput={event => patch({ notes: event.currentTarget.value })} />
        </label>
        {/* The project is a fact on a project surface, a question everywhere else. */}
        <Show when={!props.projectId}>
          <div class="wid-field"><span>Project</span>
            <PillSelect label="Task project" value={form().project_id} onChange={selectProject}>
              <option value="">No project — personal</option>
              <For each={selectableProjects()}>{project => <option value={project.id}>{project.name}</option>}</For>
            </PillSelect>
          </div>
        </Show>
        <label class="wid-field"><span>Due date</span>
          <input class="wid-input" type="date" aria-label="Task due date" value={form().due_date}
            onInput={event => patch({ due_date: event.currentTarget.value })} />
        </label>
        <fieldset class="wid-field task-drawer-people"><legend>Assignees</legend>
          <Show when={form().project_id} fallback={<p class="wid-hint">Give the task a project before assigning people to it.</p>}>
            <Show when={!membersFailed()} fallback={<p class="wid-error" role="alert">The project's members could not be loaded: {membersFailed()}</p>}>
              <Show when={assignable().length} fallback={<p class="wid-hint">This project has no members available for assignment.</p>}>
                <div class="wid-people">
                  <For each={assignable()}>{person => <label class="wid-person">
                    <input type="checkbox" checked={form().assignee_ids.includes(person.id)} onChange={() => togglePerson(person.id)} />
                    {nameOf(person)}
                  </label>}</For>
                </div>
              </Show>
            </Show>
          </Show>
        </fieldset>
        <Show when={props.advanced}>
          <label class="wid-person"><input type="checkbox" checked={form().content_kind === "markdown"}
            onChange={event => patch({ content_kind: event.currentTarget.checked ? "markdown" : "text" })} /> Markdown body</label>
          {/* No hand-typed source anchor. A task created here has no origin message;
              the anchor is written by the act that HAS one ("Create task" on a
              message), and read back as a link on the row. Asking a person for an
              entity type and a UUID could only produce a link to nothing. */}
        </Show>
        <Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={busy()}>Cancel</button>
          <button type="submit" class="wid-btn wid-primary" disabled={busy() || !form().content.trim()}>{busy() ? "Creating…" : "Create task"}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
