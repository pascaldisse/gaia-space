import { Show, type JSX } from "solid-js";
import "./EmptyState.css";

/** ── THE EMPTY STATE ────────────────────────────────────────────────────────
 *
 *  Product law (stage 10a): an empty surface must LEAD TO ACTION. Stating what
 *  is missing and then offering nothing — or offering something irrelevant, the
 *  way Inbox offered "Go to Overview" — is the failure this component removes.
 *
 *  Shape is read off views/HomeCalendar.css and components/paper.css: a paper
 *  card, a dashed hairline, calm muted copy, generous spacing. NOT the old teal
 *  lozenge with a glyph in it; an icon here is quiet or absent.
 *
 *  THE TWO CASES ARE DIFFERENT AND MUST STAY DIFFERENT:
 *    - NOTHING EXISTS YET  → offer creation. The person has nothing to undo.
 *    - FILTERS MATCH NOTHING → offer "Clear filters". Offering "create" here is
 *      worse than saying nothing, because the thing they are looking for very
 *      likely exists, one filter away.
 *  Callers express this by choosing their own actions; `variant="no-match"`
 *  only tightens the frame so the two do not look identical at a glance.
 *
 *  Actions: exactly ONE primary (the teal `.primary` pill) and at most two
 *  secondaries (GhostPill from controls.tsx). An action that has no
 *  implementation is not rendered — a dead button is a worse empty state than
 *  an empty one.
 */
export default function EmptyState(props: {
  /** One short line: what is not here yet. Never a sentence about the feature. */
  title: string;
  /** Optional SINGLE clarifying line. Never a paragraph. */
  hint?: string;
  /** One primary and at most two secondary actions. */
  actions?: JSX.Element;
  /** Optional, quiet. Not a coloured lozenge. */
  icon?: JSX.Element;
  /** `no-match` = filters excluded everything; `empty` = nothing exists yet. */
  variant?: "empty" | "no-match";
  class?: string;
}): JSX.Element {
  return (
    <div
      class="empty-lead"
      classList={{
        "no-match": props.variant === "no-match",
        ...(props.class ? { [props.class]: true } : {}),
      }}
      role="status"
    >
      <Show when={props.icon}>
        <span class="empty-lead-icon" aria-hidden="true">{props.icon}</span>
      </Show>
      <p class="empty-lead-title">{props.title}</p>
      <Show when={props.hint}>
        <p class="empty-lead-hint">{props.hint}</p>
      </Show>
      <Show when={props.actions}>
        <div class="empty-lead-actions">{props.actions}</div>
      </Show>
    </div>
  );
}
