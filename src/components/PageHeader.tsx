import { Show, createContext, useContext, type Accessor, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { orgName } from "../orgScope";
import { metricTone, type Tone } from "../statusTone";
import "./PageHeader.css";

/**
 * THE EMBEDDED-SURFACE LAW (redesign, audit §3.5).
 *
 * A view mounted inside another surface's scope must not repeat that scope. The
 * channel workspace already writes `DEMO PROJECT` / `# general` above the guest, so
 * the guest's own kicker + h1 are a second title for the same thing, and its project
 * picker asks a question the host has already answered — the owner's words: *"Why do
 * I have to pick a project? I am already inside this chat. That IS the project."*
 *
 * MECHANISM: a context, not a prop. The HOST knows it is a host; a guest view is
 * mounted from several call sites and would otherwise have to thread `embedded`
 * through every one of them and down into every picker. With a context the host
 * installs the fact once, `PageHeader` reads it without any view's help, and a guest
 * that needs more than the header (a picker, a container toggle) asks with one line.
 */
export type EmbeddedScope = {
  /** How the HOST already names this surface on screen, e.g. `"# general"`. */
  host: string;
  /** The project is decided: render no project picker. */
  projectId?: string;
  /** The document container is decided: render no container toggle / source select. */
  container?: string;
  containerId?: string;
  /** The shell owns identity: render no "Acting as" picker (audit §3.1). */
  identityLocked?: boolean;
};

const EmbeddedScopeCtx = createContext<Accessor<EmbeddedScope | undefined>>(() => undefined);

/** Installed by a HOST surface around the views it mounts. */
export function EmbeddedScopeProvider(props: { scope: EmbeddedScope; children: JSX.Element }): JSX.Element {
  return <EmbeddedScopeCtx.Provider value={() => props.scope}>{props.children}</EmbeddedScopeCtx.Provider>;
}

/** The guest's one line: `const embedded = useEmbedded();` -> `<Show when={!embedded()}>…</Show>`.
 *  Returns `undefined` on a standalone route, so every existing view keeps its full self. */
export const useEmbedded = (): Accessor<EmbeddedScope | undefined> => useContext(EmbeddedScopeCtx);

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
  /** Escape hatch for a host that mounts a guest without a context. The context wins
   *  nothing over it: an explicit `false` keeps the full header even when embedded. */
  embedded?: boolean;
}) {
  // Non-breaking space keeps the kicker line's height while the org loads, so
  // the h1 does not jump one line up and back down on every navigation.
  const kicker = () => (props.kicker !== undefined ? props.kicker : orgName()) || "\u00a0";
  const scope = useEmbedded();
  const embedded = () => (props.embedded !== undefined ? props.embedded : !!scope());
  const classes = () => ({ ...(props.class ? { [props.class]: true } : {}), embedded: embedded() });
  // Embedded and nothing to show but a repeated scope -> draw nothing at all, instead of
  // an empty bar that still costs vertical space above the host's content.
  const silent = () => embedded() && !props.chips && !props.actions && !props.subline;
  return (
    <Show when={!silent()}>
      {/* Assistive tech must still be able to name the surface when the visible title
          is the host's. A <header> nested in <main> is a generic element and would drop
          the label, so the embedded form is a labelled <section> (role=region). */}
      <Dynamic
        component={embedded() ? "section" : "header"}
        class="page-header"
        classList={classes()}
        aria-label={embedded() ? props.title : undefined}
      >
        <div class="pgh-row">
          <Show
            when={!embedded()}
            fallback={
              <Show when={props.subline}>
                <div class="pgh-title"><div class="subtitle">{props.subline}</div></div>
              </Show>
            }
          >
            <div class="pgh-title">
              <div class="kicker">{kicker()}</div>
              <h1>{props.title}</h1>
              <Show when={props.subline}>
                <div class="subtitle">{props.subline}</div>
              </Show>
            </div>
          </Show>
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
      </Dynamic>
    </Show>
  );
}

/** A metric chip for `chips`. Prototype `.metric-pill`: value in ink, label muted.
 *
 *  `tone` runs through `metricTone`, so **a metric whose value is 0 carries no tone** —
 *  `0 Overdue` in red is a warning about nothing. Pass the tone you would use if the
 *  number were non-zero; the chip decides whether it earns colour. */
export function Chip(props: { value?: JSX.Element; label?: JSX.Element; tone?: Tone; children?: JSX.Element }) {
  const tone = () => (props.tone ? metricTone(props.value as number | null | undefined, props.tone) : "");
  return (
    <span class="metric-pill" classList={{ [tone() || "untoned"]: true }}>
      <Show when={props.value !== undefined}>
        <strong>{props.value}</strong>
      </Show>
      {props.label}
      {props.children}
    </span>
  );
}
