import { Show, type JSX } from "solid-js";
import { orgName } from "../orgScope";
import "./PageHeader.css";

/** THE page header idiom of the redesign, taken from
 *  FINAL_GAIA_SPACE_PROTOTYP.html `.page-header` and already shipped by
 *  ChannelWorkspace/HomeCalendar:
 *
 *      KICKER            ← the scope (organisation, or project name)
 *      Title             ← h1, the thing itself
 *      one short subline ← optional, ONE line, never a paragraph
 *                                       chips + actions, right, same baseline
 *
 *  What it deliberately does NOT have: the old teal icon lozenge, and the
 *  two-line explanatory paragraph under the title. Explanations belong next
 *  to the control they explain, not at the top of the page.
 *
 *  `kicker` defaults to the organisation name — global views should simply
 *  omit it; project-scoped views pass the project. */
export default function PageHeader(props: {
  kicker?: string;
  title: string;
  subline?: JSX.Element;
  chips?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
}) {
  // Non-breaking space keeps the kicker line's height while the org loads, so
  // the h1 does not jump one line up and back down on every navigation.
  const kicker = () => (props.kicker !== undefined ? props.kicker : orgName()) || "\u00a0";
  return (
    <header class="page-header" classList={props.class ? { [props.class]: true } : undefined}>
      <div class="pgh-row">
        <div class="pgh-title">
          <div class="kicker">{kicker()}</div>
          <h1>{props.title}</h1>
          <Show when={props.subline}>
            <div class="subtitle">{props.subline}</div>
          </Show>
        </div>
        <Show when={props.chips || props.actions}>
          <div class="pgh-edge">
            <Show when={props.chips}>
              <div class="header-metrics">{props.chips}</div>
            </Show>
            <Show when={props.actions}>
              <div class="pgh-actions">{props.actions}</div>
            </Show>
          </div>
        </Show>
      </div>
    </header>
  );
}

/** A metric chip for `chips`. Prototype `.metric-pill`: value in ink, label muted. */
export function Chip(props: { value?: JSX.Element; label?: JSX.Element; children?: JSX.Element }) {
  return (
    <span class="metric-pill">
      <Show when={props.value !== undefined}>
        <strong>{props.value}</strong>
      </Show>
      {props.label}
      {props.children}
    </span>
  );
}
