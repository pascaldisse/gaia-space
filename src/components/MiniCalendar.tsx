import { For, Show, createMemo } from "solid-js";
import { dayKeyOf, kindsOnDay, itemsOnDay, monthGrid, startOfDay, type CalendarItem } from "../calendar";
import { Icon } from "./Icon";
import "./MiniCalendar.css";

// Compact month calendar for the Overview. Purely presentational over a typed
// CalendarItem[] (meetings + task due dates + project deadlines): it renders a
// 6×7 grid, marks days that carry items with per-kind dots, and reports the
// clicked day upward. Month navigation is controlled by the parent so the same
// cursor can drive an adjacent agenda list.
export default function MiniCalendar(props: {
  cursor: Date;
  items: CalendarItem[];
  selected?: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (dayKey: string) => void;
}) {
  const todayKey = dayKeyOf(startOfDay(new Date()));
  const grid = createMemo(() => monthGrid(props.cursor));
  // Solid's <For> mapper is untracked: derive item data in a memo so asynchronously
  // loaded calendar entries re-render in their actual day cells, not only the agenda.
  const days = createMemo(() => grid().map((day) => {
    const key = dayKeyOf(day);
    return { day, key, kinds: kindsOnDay(props.items, key), items: itemsOnDay(props.items, key) };
  }));
  const inMonth = (d: Date) => d.getMonth() === props.cursor.getMonth();
  return (
    <div class="mini-cal">
      <div class="mini-cal-head">
        <button class="mini-nav" title="Previous month" aria-label="Previous month" onClick={props.onPrev}><Icon name="chevron-left" size={16} /></button>
        <strong>{props.cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
        <div class="mini-cal-headbtns">
          <button class="mini-today" title="Jump to today" onClick={props.onToday}>Today</button>
          <button class="mini-nav" title="Next month" aria-label="Next month" onClick={props.onNext}><Icon name="chevron-right" size={16} /></button>
        </div>
      </div>
      <div class="mini-grid">
        <For each={["S", "M", "T", "W", "T", "F", "S"]}>{(d) => <span class="mini-wd">{d}</span>}</For>
        <For each={days()}>{({ day, key, kinds, items }) =>
          <button
            class="mini-day"
            classList={{ muted: !inMonth(day), today: key === todayKey, selected: key === props.selected, has: kinds.length > 0 }}
            onClick={() => props.onPick(key)}
            title={kinds.length ? `${kinds.length} item kind${kinds.length > 1 ? "s" : ""}` : undefined}
          >
            <span class="mini-num">{day.getDate()}</span>
            <Show when={items.length}>
              <span class="mini-event" classList={{ [items[0].kind]: true }}>{items[0].title}</span>
              <Show when={items.length > 1}><span class="mini-more">+{items.length - 1}</span></Show>
            </Show>
          </button>
        }</For>
      </div>
    </div>
  );
}
