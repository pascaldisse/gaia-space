import { Show, createEffect, onCleanup, type JSX } from "solid-js";
import "./ConfirmDialog.css";

/** ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 *  Deleting is the one act that cannot be undone by clicking again, so it is the
 *  one act that must be asked twice. Until now the few places that deleted at all
 *  used the browser's own `confirm()`: a system box in a system font, outside the
 *  product's language, and — in the desktop shell — one more OS dialog on top of
 *  a native window.
 *
 *  This is that question, in the product's own voice: it NAMES the thing, states
 *  what will be lost, and makes cancelling the easy path (Escape, the backdrop,
 *  and the button that already has focus). The destructive button is never the
 *  default focus, and it says what it does — "Delete document", not "OK".
 */

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** What exactly is at stake. One sentence, no euphemism. */
  body: JSX.Element;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  let cancelButton: HTMLButtonElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    // Escape cancels: the safe answer is always one key away.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    // Focus lands on Cancel, never on the destructive button.
    cancelButton?.focus();
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={props.open}>
      <div class="confirm-root" role="alertdialog" aria-modal="true" aria-label={props.title}>
        <div class="confirm-backdrop" onClick={() => props.onCancel()} />
        <div class="confirm-panel">
          <h2 class="confirm-title">{props.title}</h2>
          <p class="confirm-body">{props.body}</p>
          <div class="confirm-actions">
            <button ref={cancelButton} type="button" class="confirm-cancel" onClick={() => props.onCancel()}>
              {props.cancelLabel ?? "Cancel"}
            </button>
            <button type="button" class="confirm-danger" disabled={props.busy} onClick={() => props.onConfirm()}>
              {props.busy ? "Deleting…" : props.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
