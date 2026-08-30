import { Show, type JSX } from "solid-js";
import "./DeleteButton.css";

/** ── ONE DELETE, ONE LOOK, EVERYWHERE ───────────────────────────────────────
 *
 *  Deleting is the one irreversible act, so it is the one act the palette gives
 *  red to — and it wears that red at rest, not only on hover: a control you must
 *  touch to identify is a control you identify by accident. Every surface that can
 *  delete something uses this button, in the same place (top right, beside the
 *  thing's own facts), so the act is recognised before it is read.
 *
 *  It NEVER deletes on click. It opens the question (ConfirmDialog); that split is
 *  what makes a red button safe to put in plain sight.
 *
 *  `canDelete = false` means the viewer is not the owner. Then it is not rendered
 *  at all: a disabled red button teases an act somebody cannot have, and an owner
 *  rule that only shows up as a failed click is a rule nobody can read.
 */
export type DeleteButtonProps = {
  /** What is being deleted — used for the accessible name ("Delete project"). */
  label: string;
  /** Ownership gate. Absent owner rights → no button. */
  canDelete?: boolean;
  /** Why the act is unavailable, when it is worth saying (shown as a quiet note). */
  deniedReason?: string;
  onRequest: () => void;
};

export default function DeleteButton(props: DeleteButtonProps): JSX.Element {
  return (
    <Show
      when={props.canDelete !== false}
      fallback={
        <Show when={props.deniedReason}>
          <span class="delete-denied">{props.deniedReason}</span>
        </Show>
      }
    >
      <button
        type="button"
        class="delete-button"
        aria-label={props.label}
        title={props.label}
        onClick={() => props.onRequest()}
      >
        Delete
      </button>
    </Show>
  );
}
