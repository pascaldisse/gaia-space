import { Show, createEffect, onCleanup, type JSX } from "solid-js";
import "./ConfirmDialog.css";

/** Renaming used to happen IN the card: the name turned into a bare input with a ✓
 *  beside it, which is how a tidy shelf became "the ugly old text field" mid-click.
 *  A rename is a question like any other, so it is asked the same way the delete
 *  question is asked — same panel, same manners, Escape cancels, Enter commits. */

export type PromptDialogProps = {
  open: boolean;
  title: string;
  label: string;
  value: string;
  setValue: (value: string) => void;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function PromptDialog(props: PromptDialogProps): JSX.Element {
  let input: HTMLInputElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    input?.focus();
    input?.select();
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={props.open}>
      <div class="confirm-root" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="confirm-backdrop" onClick={() => props.onCancel()} />
        <form
          class="confirm-panel"
          onSubmit={(event) => {
            event.preventDefault();
            props.onConfirm();
          }}
        >
          <h2 class="confirm-title">{props.title}</h2>
          <label class="confirm-field">
            <span>{props.label}</span>
            <input
              ref={input}
              class="confirm-input"
              aria-label={props.label}
              value={props.value}
              onInput={(event) => props.setValue(event.currentTarget.value)}
            />
          </label>
          <div class="confirm-actions">
            <button type="button" class="confirm-cancel" onClick={() => props.onCancel()}>Cancel</button>
            <button type="submit" class="confirm-primary" disabled={props.busy || !props.value.trim()}>
              {props.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
