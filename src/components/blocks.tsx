import { Show, splitProps, type JSX } from "solid-js";
import { metricTone, type Tone } from "../statusTone";
import "./blocks.css";

/** ── THE COMPOSITION LAYER ──────────────────────────────────────────────────
 *
 *  Why a third file next to `controls.tsx` and `paper.css`:
 *
 *    controls.tsx — things you OPERATE (select, search, ghost pill, icon button).
 *    paper.css    — the light-theme SURFACE skin (card, row, pill, filter bar).
 *    blocks.tsx   — the BLOCKS those two are assembled into: a metric tile, a
 *                   grid of them, a disclosure, a section heading.
 *
 *  The defect this file answers: every view invented its own tile. Home had
 *  `.compact-stat`, Projects `.pf-metric`, Project home `.ph-stat`, the rails
 *  `.rail-metric`, the channel `.cw-stat` — five silhouettes for one idea, so the
 *  same product looked like five products depending on where you were standing.
 *
 *  SCOPING, and why this sheet is NOT behind `.theme-space-light`: every colour
 *  below is read through the `--surface-*` / `--text-*` tokens, which the light
 *  theme re-points at paper/ink in spaceTheme.css. One unscoped rule therefore
 *  renders correctly in BOTH themes, and because these class names are new,
 *  nothing pre-existing can shift under it. Scoping the geometry is what broke
 *  the dark layout three times before (see the note in controls.css).
 *
 *  Colour law: teal = action/open, amber = due soon/waiting, red = critical.
 *  And ZERO CARRIES NO TONE — every tone below runs through `metricTone`, so a
 *  count of 0 is quiet by construction and cannot be handed a colour by a caller.
 */

export type MetricTileProps = {
  /** The figure. A number, or a short string like a date or an em-dash. */
  value: JSX.Element;
  /** What the figure counts. Sentence case, never a shouted kicker. */
  label: JSX.Element;
  /** The tone the figure would carry if it were non-empty. 0 gets none. */
  tone?: Tone;
  /** A date or a name instead of a count: same tile, smaller figure. */
  small?: boolean;
  /** Makes the tile a link. Anything else (onClick, aria-*) flows through. */
  href?: string;
  class?: string;
} & Record<string, unknown>;

/** ONE tile. Home's `.compact-stat` is the reference — a hairline, a big quiet
 *  figure, a muted label, and no colour unless the number earns it. */
export function MetricTile(props: MetricTileProps): JSX.Element {
  /* splitProps, never destructuring: the rest object has to stay a live proxy or
     a tile stops updating the moment its resource settles. */
  const [own, rest] = splitProps(props, ["value", "label", "tone", "small", "href", "class"]);
  const tone = () => (own.tone ? metricTone(own.value as unknown, own.tone) : "");
  const cls = () => "metric-tile" + (tone() ? ` ${tone()}` : "") + (own.class ? ` ${own.class}` : "");
  const body = () => (
    <>
      <span class="metric-tile-num" classList={{ sm: !!own.small }}>{own.value}</span>
      <span class="metric-tile-lbl">{own.label}</span>
    </>
  );
  return (
    <Show when={own.href !== undefined} fallback={<div class={cls()} {...rest}>{body()}</div>}>
      <a class={cls()} href={own.href} {...rest}>{body()}</a>
    </Show>
  );
}

/** The row of tiles. `role=group` + a name, because four numbers side by side are
 *  a summary of something and a screen reader should be told of what. */
export function MetricGrid(props: { label: string; class?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="metric-grid" classList={props.class ? { [props.class]: true } : undefined} role="group" aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** THE disclosure idiom: sentence case, one hairline, one chevron, everywhere.
 *  It replaces three hand-rolled `<details>` skins that differed in case, marker
 *  glyph and padding — `MATRIX REPORT` shouting next to a quiet `Access` row. */
export function Disclosure(props: {
  title: JSX.Element;
  /** The quiet count that lets a reader skip opening it ("0 roles · 0 bindings"). */
  meta?: JSX.Element;
  open?: boolean;
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <details class="disclosure" classList={props.class ? { [props.class]: true } : undefined} open={props.open}>
      <summary>
        <svg class="disclosure-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="disclosure-title">{props.title}</span>
        <Show when={props.meta}><span class="disclosure-meta">{props.meta}</span></Show>
      </summary>
      <div class="disclosure-body">{props.children}</div>
    </details>
  );
}

/** A heading for a SECTION of a page. Deliberately an `h2` at section size: the
 *  band that opens a project mid-page was imitating the page header (kicker +
 *  27px title + action edge) and read as a second page inside the first. */
export function SectionHeading(props: {
  title: JSX.Element;
  meta?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
}): JSX.Element {
  return (
    <div class="section-heading" classList={props.class ? { [props.class]: true } : undefined}>
      <h2>{props.title}</h2>
      <Show when={props.meta}><span class="section-heading-meta">{props.meta}</span></Show>
      <Show when={props.actions}><div class="section-heading-actions">{props.actions}</div></Show>
    </div>
  );
}
