import type { CalendarItem } from "./api/personal";

/** Local calendar day key. Never `toISOString()`: that renders the UTC day and
 *  shifts every date-only item for sessions east/west of UTC (H4). */
export const dateKey = (date: Date) => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/** A date-only value (`YYYY-MM-DD`) read back as a local calendar day, so the
 *  day it renders on is the day it was written as. */
export const dayFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/** Day key of a calendar item: date-only kinds carry `date`, meetings are instants. */
export const itemDayKey = (item: CalendarItem) =>
  item.date ?? dateKey(new Date(item.starts_at * 1000));

export const itemsOnDay = (items: readonly CalendarItem[], day: Date) => {
  const key = dateKey(day);
  return items.filter((item) => itemDayKey(item) === key);
};

export const kindLabels: Record<CalendarItem["kind"], string> = { meeting: "Meeting", task: "Task", deadline: "Deadline" };

/** `datetime-local` value for an instant, in the viewer's own zone. */
export const localInput = (seconds: number) => {
  const at = new Date(seconds * 1000);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${dateKey(at)}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

export type QuickKind = "meeting" | "task" | "deadline";
export type MeetingDraft = { title: string; starts_at: string; ends_at: string; location: string; rrule: string };
export type TaskDraft = { title: string; day: string };
export type DeadlineDraft = { project_id: string; day: string };

/** Quick-create validation. Returns the error a person should read, or "" when the
 *  draft may be sent. The same rules gate the submit button and the alert. */
export const meetingDraftError = (draft: MeetingDraft) => {
  if (!draft.title.trim()) return "A meeting needs a title.";
  const starts_at = Date.parse(draft.starts_at), ends_at = Date.parse(draft.ends_at);
  if (!Number.isFinite(starts_at) || !Number.isFinite(ends_at)) return "A meeting needs a start and an end.";
  if (ends_at <= starts_at) return "The meeting has to end after it starts.";
  return "";
};
export const taskDraftError = (draft: TaskDraft) => {
  if (!draft.title.trim()) return "A task needs a title.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.day)) return "A task needs a due day.";
  return "";
};
export const deadlineDraftError = (draft: DeadlineDraft) => {
  if (!draft.project_id) return "Choose a project to give a deadline.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.day)) return "A deadline needs a day.";
  return "";
};

/// A recurring meeting contributes items whose `id` is decorated to keep the
/// occurrences distinct. The way back to the series is *carried*, never parsed:
/// splitting `id` on the last `:` mistook a meeting genuinely called `foo:123`
/// for an occurrence of `foo`, and no string rule can tell those two apart.
export const meetingIdOf = (item: { id: string; source_id?: string | null }) => item.source_id ?? item.id;

/* ── Overview display model (PR#4) ───────────────────────────────────────────
 * The overview groups the same feed by day. It takes its day key from
 * `itemDayKey`, so a date-only task or deadline lands on the day it was
 * written as, exactly like the full calendar. */
export type CalendarEntry = CalendarItem & { day: string; allDay: boolean };
export const calendarEntry = (item: CalendarItem): CalendarEntry => ({ ...item, day: itemDayKey(item), allDay: item.ends_at === null });
export const calendarEntries = (items: CalendarItem[]) => items.map(calendarEntry).sort((a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || a.starts_at - b.starts_at || a.title.localeCompare(b.title));
export const monthCells = (cursor: Date) => { const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1); start.setDate(start.getDate() - start.getDay()); return Array.from({ length: 42 }, (_, i) => { const day = new Date(start); day.setDate(start.getDate() + i); return day }) };
export const entriesForDay = (items: CalendarEntry[], day: Date) => items.filter(item => item.day === dateKey(day));
export const kindPresence = (items: CalendarEntry[]) => ((["meeting", "task", "deadline"] as const).filter(kind => items.some(item => item.kind === kind)));
