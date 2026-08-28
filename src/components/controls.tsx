import { Show, splitProps, type JSX } from "solid-js";
import "./controls.css";

/** ── THE CONTROL LANGUAGE ───────────────────────────────────────────────────
 *
 *  Why its own file and not `paper.css`: paper.css is a SURFACE kit — cards,
 *  rows, pills, empty states. It has no TSX beside it because a card is a
 *  `<div class="paper-card">` and nothing more. These four are CONTROLS: they
 *  own markup (a chevron next to a select, a magnifier inside a field) and
 *  behaviour (accessible names, focus). A control that needs markup needs a
 *  component, so `controls.tsx` + `controls.css` sit together and paper.css
 *  stays what it is.
 *
 *  The law they encode, read off FINAL_GAIA_SPACE_PROTOTYP.html and off the
 *  parts of the app that already speak it (the rail `+`, the "Search
 *  conversations" field, the `New ticket` pill, the section pills):
 *
 *    - a control at rest is a SOFT SHAPE, not a box. Fill `--wash-2`, no
 *      border. The hairline appears on hover/focus, where it means "you are
 *      touching this", not "here is an edge".
 *    - the VALUE is the label. No word floats above a picker.
 *    - one height (`--pillctl-h`) and one radius (`--pillctl-r`) for all four,
 *      so a filter row reads as ONE LINE, not a stack of boxes.
 *    - the teal `.primary` pill stays the primary action and is not touched.
 *
 *  Accessibility is load-bearing here, not decoration: PillSelect is a REAL
 *  `<select>` with `appearance: none` — every native keyboard behaviour
 *  (type-ahead, arrows, Home/End, Escape, the platform popup) is retained,
 *  because a div with a chevron would have thrown all of it away.
 */

/* One height / one radius for everything below; see controls.css. */

export type PillSelectProps = {
  /** Accessible name. NOT rendered as visible text — the current value is the label. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  class?: string;
  /** `ref` to the underlying <select>, for views that re-apply a controlled value. */
  ref?: (element: HTMLSelectElement) => void;
  children: JSX.Element;
};

/** A `<select>` that looks like a pill. The selected option's own text is the
 *  resting label ("All statuses", "Demo Project (DEMO)"), so nothing has to be
 *  written above it. Underneath it is still the native control. */
export function PillSelect(props: PillSelectProps): JSX.Element {
  const [own, rest] = splitProps(props, ["label", "value", "onChange", "class", "children", "ref"]);
  return (
    <span class="pill-select" classList={own.class ? { [own.class]: true } : undefined}>
      <select
        {...rest}
        ref={own.ref}
        aria-label={own.label}
        value={own.value}
        onChange={(event) => own.onChange(event.currentTarget.value)}
      >
        {own.children}
      </select>
      {/* Chevron is decoration only — the select owns the interaction. */}
      <svg class="pill-select-chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  );
}

export type QuietSearchProps = {
  /** Accessible name. The placeholder is a hint, never the name. */
  label: string;
  placeholder?: string;
  value: string;
  onInput: (value: string) => void;
  disabled?: boolean;
  class?: string;
  /** `true` lets the field take the free width of a filter row. */
  grow?: boolean;
};

/** The shell's "Search conversations" idiom, made reusable: magnifier inside,
 *  soft fill, no resting border. */
export function QuietSearch(props: QuietSearchProps): JSX.Element {
  return (
    <span
      class="quiet-search"
      classList={{ grow: props.grow !== false, ...(props.class ? { [props.class]: true } : {}) }}
    >
      <svg class="quiet-search-icon" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M9.2 9.2 12.2 12.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <input
        type="search"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        disabled={props.disabled}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </span>
  );
}

/* `onClick` is intentionally NOT declared: this renders either a <button> or an
   <a>, whose handlers have different `currentTarget` types, and spreading
   `linkProps()` must keep working. It flows through the index signature onto
   whichever element is actually rendered, which is where it belongs. */
export type GhostPillProps = {
  children: JSX.Element;
  disabled?: boolean;
  class?: string;
  title?: string;
  /** Rendered as an <a> when href-ish link props are spread in. */
  href?: string;
  "aria-expanded"?: boolean;
  "aria-label"?: string;
} & Record<string, unknown>;

/** Secondary action: pill shape, NO fill at rest, soft wash on hover. This is
 *  what `Statuses` / `Export CSV` / `Open board` become — they were reading as
 *  bare text links, which is not a button and not clickable-looking. */
export function GhostPill(props: GhostPillProps): JSX.Element {
  const [own, rest] = splitProps(props, ["children", "class", "href"]);
  /* `ghost` STAYS in the class list. These call sites were `class="ghost"`
     before, and `.ghost` is an App.css rule that the DARK grouped/flat layouts
     still depend on. Dropping it would have left a bare unstyled word in dark
     while light looked finished. `.theme-space-light .ghost-pill` outranks it
     in the light theme, so the pill wins there and nothing is lost here. */
  const cls = () => "ghost ghost-pill" + (own.class ? ` ${own.class}` : "");
  return (
    <Show
      when={own.href !== undefined}
      fallback={<button type="button" class={cls()} {...rest}>{own.children}</button>}
    >
      <a class={cls()} href={own.href} {...rest}>{own.children}</a>
    </Show>
  );
}

export type IconButtonProps = {
  /** REQUIRED: a round button with a glyph has no readable name without it. */
  label: string;
  children: JSX.Element;
  disabled?: boolean;
  class?: string;
  "aria-expanded"?: boolean;
} & Record<string, unknown>;

/** The sidebar `+`, generalised: round, soft, with an accessible name. */
export function IconButton(props: IconButtonProps): JSX.Element {
  const [own, rest] = splitProps(props, ["label", "children", "class"]);
  return (
    <button
      type="button"
      class={"icon-button" + (own.class ? ` ${own.class}` : "")}
      aria-label={own.label}
      title={own.label}
      {...rest}
    >
      <span aria-hidden="true">{own.children}</span>
    </button>
  );
}

/** The container that makes the four read as one calm line inside a paper card. */
export function ControlRow(props: { label: string; class?: string; children: JSX.Element }): JSX.Element {
  return (
    <div
      class="control-row"
      classList={props.class ? { [props.class]: true } : undefined}
      role="group"
      aria-label={props.label}
    >
      {props.children}
    </div>
  );
}
