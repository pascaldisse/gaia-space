import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { dateKey, monthCells, startOfLocalDay, UI_LOCALE } from "../calendar";
import "./DateField.css";

/** ── WHY A DATE IS NOT AN `<input type="date">` HERE ────────────────────────
 *
 *  The resting field was ours; the calendar it opened was the operating system's —
 *  its own grid, its own type, its own chrome, in a layer no CSS reaches. It is the
 *  same defect the pickers had: the product looked designed until the moment it was
 *  used. So the month grid is drawn here, in the product's own voice.
 *
 *  What the native control gave for free is re-implemented, not dropped:
 *    · the value is a real `YYYY-MM-DD` string, unchanged in every caller;
 *    · arrows move by a day, PageUp/PageDown by a month, Home/End to the ends of
 *      the week, Enter picks, Escape closes and returns focus to the trigger;
 *    · a click outside closes; the popover is `fixed` against the trigger's rect,
 *      so no card or drawer can clip it, and it flips up near the bottom edge.
 *
 *  It carries two acts the native picker hides in a context menu: **Today** and
 *  **Clear** — the two answers people actually give a date field.
 */

export type DateFieldProps = {
  /** Accessible name; the VALUE is the visible label. */
  label: string;
  /** `YYYY-MM-DD`, or "" for no date. */
  value: string;
  onChange: (value: string) => void;
  /** What the trigger says when there is no date yet. */
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  class?: string;
  /** Hide the clear action where a date is mandatory. */
  clearable?: boolean;
};

const parse = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The written form a person reads — never the storage form. */
export const formatDate = (value: string): string => {
  const date = parse(value);
  return date ? date.toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "";
};

export default function DateField(props: DateFieldProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [cursor, setCursor] = createSignal(startOfLocalDay(parse(props.value) ?? new Date()));
  const [active, setActive] = createSignal(startOfLocalDay(parse(props.value) ?? new Date()));
  const [place, setPlace] = createSignal({ left: 0, top: 0, up: false });
  let trigger!: HTMLButtonElement;
  let grid: HTMLDivElement | undefined;

  const selected = () => parse(props.value);
  const label = () => formatDate(props.value) || (props.placeholder ?? "No date");

  const measure = () => {
    const rect = trigger.getBoundingClientRect();
    const viewport = window.innerHeight || 800;
    const height = 340;
    const up = viewport - rect.bottom < height && rect.top > height;
    setPlace({
      left: Math.min(rect.left, Math.max(8, (window.innerWidth || 900) - 300)),
      top: up ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
      up,
    });
  };

  const show = () => {
    const start = startOfLocalDay(selected() ?? new Date());
    setCursor(start);
    setActive(start);
    measure();
    setOpen(true);
  };
  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) trigger.focus();
  };
  const pick = (day: Date) => {
    props.onChange(dateKey(day));
    close();
  };

  createEffect(() => {
    if (!open()) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.contains(target) && !grid?.closest(".date-pop")?.contains(target)) close(false);
    };
    const reflow = () => measure();
    window.addEventListener("mousedown", outside);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    // Focus lands in the grid, so arrows move days rather than scrolling the page.
    queueMicrotask(() => grid?.focus());
    onCleanup(() => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    });
  });

  const step = (days: number) => {
    const next = new Date(active());
    next.setDate(next.getDate() + days);
    setActive(next);
    if (next.getMonth() !== cursor().getMonth()) setCursor(startOfLocalDay(new Date(next.getFullYear(), next.getMonth(), 1)));
  };
  const stepMonth = (months: number) => {
    const next = new Date(active());
    next.setMonth(next.getMonth() + months);
    setActive(next);
    setCursor(startOfLocalDay(new Date(next.getFullYear(), next.getMonth(), 1)));
  };

  const onGridKey = (event: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      ArrowUp: () => step(-7),
      ArrowDown: () => step(7),
      PageUp: () => stepMonth(-1),
      PageDown: () => stepMonth(1),
      Home: () => step(-active().getDay()),
      End: () => step(6 - active().getDay()),
    };
    const move = keys[event.key];
    if (move) {
      event.preventDefault();
      move();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active());
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const sameDay = (a: Date, b?: Date | null) => !!b && dateKey(a) === dateKey(b);

  return (
    <span class="date-field" classList={props.class ? { [props.class]: true } : undefined}>
      <button
        ref={trigger}
        type="button"
        class="date-trigger"
        classList={{ empty: !props.value }}
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open()}
        title={props.title}
        disabled={props.disabled}
        onClick={() => (open() ? close() : show())}
      >
        <span class="date-trigger-label">{label()}</span>
        <svg class="date-trigger-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
        </svg>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            class="date-pop"
            role="dialog"
            aria-label={props.label}
            style={{ left: `${place().left}px`, top: `${place().top}px` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header class="date-pop-head">
              <button type="button" class="date-nav" aria-label="Previous month" onClick={() => stepMonth(-1)}>‹</button>
              <strong>{cursor().toLocaleDateString(UI_LOCALE, { month: "long", year: "numeric" })}</strong>
              <button type="button" class="date-nav" aria-label="Next month" onClick={() => stepMonth(1)}>›</button>
            </header>
            <div class="date-weekdays" aria-hidden="true">
              <For each={["S", "M", "T", "W", "T", "F", "S"]}>{(letter) => <span>{letter}</span>}</For>
            </div>
            <div
              ref={grid}
              class="date-grid"
              role="grid"
              tabindex="0"
              aria-label={`${props.label} — month grid`}
              onKeyDown={onGridKey}
            >
              <For each={monthCells(cursor())}>
                {(day) => (
                  <button
                    type="button"
                    class="date-day"
                    classList={{
                      muted: day.getMonth() !== cursor().getMonth(),
                      today: sameDay(day, new Date()),
                      active: sameDay(day, active()),
                      selected: sameDay(day, selected()),
                    }}
                    aria-selected={sameDay(day, selected())}
                    aria-label={day.toLocaleDateString(UI_LOCALE, { day: "numeric", month: "long", year: "numeric" })}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(day);
                    }}
                  >
                    {day.getDate()}
                  </button>
                )}
              </For>
            </div>
            <footer class="date-pop-foot">
              <button type="button" class="date-quick" onMouseDown={(event) => { event.preventDefault(); pick(new Date()); }}>Today</button>
              <Show when={props.clearable !== false && !!props.value}>
                <button
                  type="button"
                  class="date-quick date-clear"
                  onMouseDown={(event) => { event.preventDefault(); props.onChange(""); close(); }}
                >
                  Clear
                </button>
              </Show>
            </footer>
          </div>
        </Portal>
      </Show>
    </span>
  );
}
