import type { CalendarItem as ApiCalendarItem } from "./api/personal";

/** Display model for calendar_aggregate: one shape for the Overview month and agenda. */
export type CalendarItem = {
  id: string;
  kind: ApiCalendarItem["kind"];
  title: string;
  date: string;
  starts_at: number;
  ends_at: number | null;
  allDay: boolean;
  done: boolean;
  project_id: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Local YYYY-MM-DD key for a date; calendar cells are local-day buckets. */
export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Normalize the authoritative aggregate response for compact calendar display. */
export function normalizeCalendarItem(item: ApiCalendarItem): CalendarItem {
  return {
    ...item,
    date: dayKeyOf(new Date(item.starts_at * 1000)),
    allDay: item.ends_at === null,
    done: false,
  };
}

/** The Sunday-first 6×7 month grid that includes leading and trailing days. */
export function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function kindsOnDay(items: CalendarItem[], dayKey: string): CalendarItem["kind"][] {
  const order: CalendarItem["kind"][] = ["meeting", "task", "deadline"];
  const present = new Set(items.filter(item => item.date === dayKey).map(item => item.kind));
  return order.filter(kind => present.has(kind));
}

export function itemsOnDay(items: CalendarItem[], dayKey: string): CalendarItem[] {
  return items.filter(item => item.date === dayKey).sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.starts_at - b.starts_at;
  });
}
