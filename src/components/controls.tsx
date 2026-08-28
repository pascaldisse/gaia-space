import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
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

/* ── PillMenu ───────────────────────────────────────────────────────────────
 *
 *  WHY A SECOND PICKER EXISTS. `PillSelect` above is a real `<select>`, and its
 *  RESTING state is ours. Its OPEN state is not: macOS draws that popup in its
 *  own layer, with the system font and the system chrome, and no CSS reaches
 *  it. So the control the product owner clicks — Priority — looks redesigned
 *  until the moment it matters.
 *
 *  PillMenu keeps the resting pill byte-identical (same `--pillctl-h`, same
 *  `--pillctl-r`, the value is the label) and draws the OPEN state itself, in
 *  the app's language, borrowing the popover behaviour that `TaskMeta.tsx`
 *  already proved in-house: a listbox, a check on the selected row, Escape
 *  returning focus to the trigger, a click outside closing.
 *
 *  THE PRICE, AND WHY IT IS PAID IN FULL. A hand-built menu that is worse for
 *  the keyboard than the native one is a regression however pretty it is, so
 *  everything the native control gave away for free is re-implemented here and
 *  covered by tests (controls.pillmenu.test.tsx):
 *    · Enter / Space / ArrowUp / ArrowDown / Home / End on the trigger open it
 *      and put real DOM FOCUS on the active option (roving tabindex — no
 *      aria-activedescendant fiction, the focused element IS the option);
 *    · arrows move, Home / End jump, and every one of them preventDefault()s so
 *      the PAGE does not scroll under the open menu;
 *    · type-ahead: "hi" lands on "High", repeating one letter cycles the
 *      options starting with it, and the buffer expires after 700ms — exactly
 *      what a native select does;
 *    · Escape closes and hands focus BACK to the trigger; a mousedown outside
 *      closes;
 *    · Enter / Space commit; Tab commits and moves to the next control, which
 *      is what a select does and what a naive popover breaks;
 *    · roles and state: `role="listbox"` / `role="option"`, `aria-selected`,
 *      `aria-expanded`, `aria-haspopup`, and the trigger keeps its accessible
 *      name (`aria-label`) even though the value is the visible text.
 *
 *  It is positioned `fixed` against the trigger's rect, NOT absolutely inside
 *  it: filter rows, drawers and cards all clip their overflow, and an absolute
 *  popover would be sliced off by whichever ancestor got there first. Near the
 *  bottom of the viewport it flips upward.
 *
 *  WHEN NOT TO USE IT: a long, data-driven list (every profile, every project,
 *  every tag). There the native popup is genuinely better — it is virtualised,
 *  it scrolls with the platform's own physics and it is what a screen-reader
 *  user has drilled. Those call sites keep `PillSelect` on purpose.
 */

export type PillMenuOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional second line, e.g. "Personal task". */
  sub?: string;
};

export type PillMenuProps = {
  /** Accessible name. NOT rendered as visible text — the current value is the label. */
  label: string;
  value: string;
  options: PillMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  class?: string;
  /** Shown when `value` matches no option (a not-yet-loaded id, say). */
  placeholder?: string;
};

const TYPEAHEAD_MS = 700;

/** Every element the Tab key could legitimately land on, in document order. */
function focusables(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
  return all.filter(element => element.tabIndex !== -1);
}

export function PillMenu(props: PillMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [place, setPlace] = createSignal<{ left: number; top: number; width: number; maxHeight: number; up: boolean }>(
    { left: 0, top: 0, width: 0, maxHeight: 320, up: false },
  );
  const id = createUniqueId();
  let root!: HTMLSpanElement;
  let trigger!: HTMLButtonElement;
  let list: HTMLUListElement | undefined;
  const [themed, setThemed] = createSignal(false);
  let typed = "";
  let typedAt = 0;

  const options = () => props.options;
  const selectedIndex = () => options().findIndex(option => option.value === props.value);
  const current = createMemo(() => options().find(option => option.value === props.value));
  const optionId = (index: number) => `${id}-opt-${index}`;

  /* Fixed placement, measured from the trigger. Flips up when the list would
     otherwise run off the bottom of the window. */
  const measure = () => {
    const rect = trigger.getBoundingClientRect();
    const viewport = window.innerHeight || 800;
    const below = viewport - rect.bottom - 12;
    const above = rect.top - 12;
    const wanted = Math.min(320, options().length * 36 + 16);
    const up = below < Math.min(wanted, 180) && above > below;
    setPlace({
      left: rect.left,
      top: up ? Math.max(8, rect.top - 6 - Math.min(wanted, above)) : rect.bottom + 6,
      width: Math.max(rect.width, 180),
      maxHeight: Math.max(120, Math.min(320, up ? above : below)),
      up,
    });
  };

  const openAt = (index: number) => {
    if (props.disabled) return;
    setActive(Math.max(0, index));
    measure();
    /* The popover leaves the tree (Portal), and `.theme-space-light` sits on a
       div INSIDE the tree, not on <body> — so the theme has to travel with it or
       the light app would open a dark menu. */
    setThemed(Boolean(trigger.closest(".theme-space-light")));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const closeToTrigger = () => { close(); trigger.focus(); };
  const commit = (index: number) => {
    const option = options()[index];
    if (!option || option.disabled) return;
    if (option.value !== props.value) props.onChange(option.value);
  };

  /* Roving tabindex: the ACTIVE OPTION holds the focus, so `document.activeElement`
     is the row the user is on — nothing has to be inferred from an aria attribute. */
  createEffect(() => {
    if (!open()) return;
    const index = active();
    queueMicrotask(() => (list?.children[index] as HTMLElement | undefined)?.focus());
  });

  onMount(() => {
    const away = (event: MouseEvent) => {
      if (!open()) return;
      const target = event.target as Node;
      if (!root.contains(target) && !(list && list.contains(target))) close();
    };
    const reflow = () => { if (open()) measure(); };
    window.addEventListener("mousedown", away);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    onCleanup(() => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    });
  });

  /** Native type-ahead, re-implemented: prefix match, single-letter cycling,
   *  buffer expiry. Returns the index to land on, or -1. */
  const typeahead = (key: string, from: number): number => {
    const now = Date.now();
    typed = now - typedAt > TYPEAHEAD_MS ? key : typed + key;
    typedAt = now;
    const list_ = options();
    /* One repeated letter cycles; a longer buffer re-searches from the top so
       "hi" still finds "High" after "h" landed on "Highest". The buffer is
       collapsed back to that one letter BEFORE the needle is taken, or "hh"
       would be searched for and nothing would ever match. */
    const repeat = typed.length > 1 && typed.split("").every(character => character === typed[0]);
    const start = repeat ? from + 1 : 0;
    if (repeat) typed = typed[0];
    const needle = typed.toLowerCase();
    const match = (index: number) => {
      const option = list_[index];
      return !option.disabled && option.label.toLowerCase().startsWith(needle);
    };
    for (let step = 0; step < list_.length; step += 1) {
      const index = (start + step + list_.length) % list_.length;
      if (match(index)) return index;
    }
    return -1;
  };

  const move = (index: number) => setActive((index + options().length) % options().length);
  const nextEnabled = (from: number, direction: 1 | -1) => {
    const total = options().length;
    for (let step = 1; step <= total; step += 1) {
      const index = (from + direction * step + total * total) % total;
      if (!options()[index]?.disabled) return index;
    }
    return from;
  };
  const edge = (direction: 1 | -1) => (direction === 1 ? nextEnabled(-1, 1) : nextEnabled(0, -1));

  const onTriggerKey = (event: KeyboardEvent) => {
    if (props.disabled) return;
    const key = event.key;
    if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      const start = selectedIndex() >= 0 ? selectedIndex() : 0;
      openAt(key === "Home" ? edge(1) : key === "End" ? edge(-1) : start);
      return;
    }
    /* Closed type-ahead commits directly, exactly like a closed <select>. */
    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const found = typeahead(key, selectedIndex());
      if (found >= 0) { event.preventDefault(); commit(found); }
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();          // the page must not scroll under an open menu
      move(nextEnabled(active(), key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      move(edge(key === "Home" ? 1 : -1));
      return;
    }
    if (key === "Escape") { event.preventDefault(); event.stopPropagation(); closeToTrigger(); return; }
    if (key === "Enter" || key === " ") { event.preventDefault(); commit(active()); closeToTrigger(); return; }
    if (key === "Tab") {
      /* A select commits on Tab and lets focus travel on. The focused option is
         about to be removed from the DOM, so the next stop is chosen here. */
      event.preventDefault();
      commit(active());
      close();
      trigger.focus();
      const order = focusables();
      const at = order.indexOf(trigger);
      const next = order[at + (event.shiftKey ? -1 : 1)];
      next?.focus();
      return;
    }
    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const found = typeahead(key, active());
      if (found >= 0) { event.preventDefault(); move(found); }
    }
  };

  return (
    <span
      class="pill-menu"
      classList={{ open: open(), ...(props.class ? { [props.class]: true } : {}) }}
      ref={root}
    >
      <button
        type="button"
        class="pill-menu-trigger"
        ref={trigger}
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? id : undefined}
        disabled={props.disabled}
        title={props.title}
        onClick={() => (open() ? closeToTrigger() : openAt(selectedIndex() >= 0 ? selectedIndex() : 0))}
        onKeyDown={onTriggerKey}
      >
        <span class="pill-menu-value" classList={{ placeholder: !current() }}>
          {current()?.label ?? props.placeholder ?? ""}
        </span>
        <svg class="pill-select-chevron pill-menu-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {/* PORTALLED ON PURPOSE: filter rows, cards and drawers all clip their
          overflow, and a popover parented inside one of them would be sliced
          off by whichever ancestor got there first. It is positioned from the
          trigger's measured rect instead. */}
      <Show when={open()}>
        <Portal>
        <div class="pill-menu-layer" classList={{ "theme-space-light": themed() }}>
        <ul
          id={id}
          class="pill-menu-list"
          classList={{ up: place().up }}
          role="listbox"
          aria-label={props.label}
          ref={list}
          style={{
            left: `${place().left}px`,
            top: `${place().top}px`,
            "min-width": `${place().width}px`,
            "max-height": `${place().maxHeight}px`,
          }}
          onKeyDown={onListKey}
        >
          <For each={options()}>{(option, index) => (
            <li
              id={optionId(index())}
              class="pill-menu-option"
              classList={{ active: active() === index(), selected: option.value === props.value }}
              role="option"
              aria-selected={option.value === props.value}
              aria-disabled={option.disabled ? true : undefined}
              tabindex={active() === index() ? 0 : -1}
              onMouseEnter={() => { if (!option.disabled) setActive(index()); }}
              onMouseDown={(event) => {
                event.preventDefault();       // keep the focus story ours, not the browser's
                if (option.disabled) return;
                commit(index());
                closeToTrigger();
              }}
            >
              <span class="pill-menu-option-text">
                <span class="pill-menu-option-label">{option.label}</span>
                <Show when={option.sub}>{sub => <span class="pill-menu-option-sub">{sub()}</span>}</Show>
              </span>
              <Show when={option.value === props.value}>
                <svg class="pill-menu-check" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 6.4 4.9 8.8 9.5 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </Show>
            </li>
          )}</For>
        </ul>
        </div>
        </Portal>
      </Show>
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
