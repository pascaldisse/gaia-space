import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Todo } from "../api/personal";
import TaskRowEdit, { blankTask } from "./TaskRowEdit";
import "./WorkItemDrawer.css";
import "./TaskDrawer.css";

/**
 * THE ONE TASK DRAWER (stage 20) — now a SHELL, nothing more (2026-08-29).
 *
 * WHY IT EXISTS: a task surface is a list and a button. Before this, each of the three
 * task surfaces created a task in a shape of its own — ProjectTasks in a form inside a
 * detail pane, My tasks in an always-open inline composer, Team tasks not at all.
 *
 * WHY A DRAWER AND NOT A DIALOG: tasks (IssueCreateDrawer), meetings, documents and
 * channels already create in this drawer; the shape and its stylesheet
 * (WorkItemDrawer.css) are shipped. A task is not a different kind of act.
 *
 * WHY IT NO LONGER HAS FIELDS OF ITS OWN (product owner: *"Warum öffnet sich nicht eine
 * Ansicht wie wenn ich einen Task BEARBEITE?"*): it had its own, thinner field list in
 * its own order and its own look, beside the full one in TaskRowEdit. One thing with
 * two faces, guaranteed to drift. The drawer now renders THE editor — same fields, same
 * order, same controls — over a blank draft, and contributes only what a shell
 * contributes: backdrop, panel, heading, and the way out. The one difference the ACT
 * itself carries (create_todo instead of update_todo, "Create task" instead of "Save",
 * no Done and no Delete on a thing that does not exist yet) lives in the editor's
 * `mode`, not in a second form.
 */
export default function TaskDrawer(props: {
  /** The project is decided by the surface (project Tasks tab): no chooser is drawn. */
  projectId?: string;
  /** Whose task this is on create. */
  authorId: string;
  /** Offer what only My tasks ever had (the source bookmark's lane). Not shown where
   *  it never existed — a drawer is not a place to grow fields a surface never had. */
  advanced?: boolean;
  onClose: () => void;
  onSaved: (task: Todo) => void;
}) {
  const [error, setError] = createSignal("");

  const close = () => props.onClose();
  // The backdrop's Escape. The editor cancels on its own Escape too; this one catches
  // the case where focus has left the form (a click on the backdrop, say).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !document.querySelector(".wid-panel .tm-menu")) { event.preventDefault(); close(); }
  };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  const saved = (task: Todo) => { props.onSaved(task); props.onClose(); };

  return <div class="wid-root">
    <div class="wid-backdrop" onClick={close} aria-hidden="true" />
    <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="tdw-heading">
      <header class="wid-head">
        <h2 id="tdw-heading">New task</h2>
        <p>A running to-do — not a tracked task.</p>
      </header>
      {/* ONE FIELD LIST, RENDERED IN CREATE MODE. `task-drawer-form` stays as the
          address the surfaces' tests submit against; `task-edit-in-drawer` is the only
          styling the shell adds, and it adds no field. */}
      <TaskRowEdit
        mode="create"
        formClass="task-drawer-form wid-form task-edit-in-drawer"
        task={blankTask(props.authorId, props.projectId)}
        fixedProject={Boolean(props.projectId)}
        advanced={props.advanced}
        canEdit
        canComplete={false}
        ownerName=""
        errorSlot={<Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>}
        onCancel={close}
        onSaved={saved}
        onError={setError} />
    </aside>
  </div>;
}
