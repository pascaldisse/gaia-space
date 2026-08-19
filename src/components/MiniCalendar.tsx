import { createMemo, For, Show } from "solid-js";
import { dayKeyOf, itemsOnDay, kindsOnDay, monthGrid, startOfDay, type CalendarItem } from "../calendar";
import { Icon } from "./Icon";
import "./MiniCalendar.css";

/** Compact controlled month view for the Overview calendar surface. */
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
  const days = createMemo(() => monthGrid(props.cursor).map(day => {
    const key = dayKeyOf(day);
    return { day, key, kinds: kindsOnDay(props.items, key), items: itemsOnDay(props.items, key) };
  }));
  const inMonth = (day: Date) => day.getMonth() === props.cursor.getMonth();

  return <div class="mini-cal">
    <div class="mini-cal-head">
      <button class="mini-nav" title="Previous month" aria-label="Previous month" onClick={props.onPrev}><Icon name="chevron-left" size={16}/></button>
      <strong>{props.cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
      <div class="mini-cal-headbtns"><button class="mini-today" onClick={props.onToday}>Today</button><button class="mini-nav" title="Next month" aria-label="Next month" onClick={props.onNext}><Icon name="chevron-right" size={16}/></button></div>
    </div>
    <div class="mini-grid">
      <For each={["S", "M", "T", "W", "T", "F", "S"]}>{day => <span class="mini-wd">{day}</span>}</For>
      <For each={days()}>{({ day, key, kinds, items }) => <button class="mini-day" classList={{ muted: !inMonth(day), today: key === todayKey, selected: key === props.selected, has: kinds.length > 0 }} onClick={() => props.onPick(key)} title={kinds.length ? `${kinds.length} item kind${kinds.length === 1 ? "" : "s"}` : undefined}>
        <span class="mini-num">{day.getDate()}</span>
        <Show when={items.length}><span class="mini-event" classList={{ [items[0].kind]: true }}>{items[0].title}</span><Show when={items.length > 1}><span class="mini-more">+{items.length - 1}</span></Show></Show>
      </button>}</For>
    </div>
  </div>;
}
