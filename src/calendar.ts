// Calendar item model — the single typed shape the Calendar renders. It unifies
// three distinct sources so meetings, task due dates, and project deadlines all
// land on the grid side by side while staying visibly distinguished by `kind`:
//   • meeting  — a timed meeting occurrence (unix start/end), keeps existing behaviour.
//   • task     — a personal/assigned task's due_date (all-day).
//   • deadline — a project's optional deadline (all-day).
// Pure, dependency-free, and unit-tested; the view layer only maps + renders.

export type CalendarKind = "meeting" | "task" | "deadline";

export type CalendarItem = {
  id: string;
  kind: CalendarKind;
  title: string;
  /** Local YYYY-MM-DD day this item is bucketed under on the grid. */
  date: string;
  /** Unix seconds for timed items (meetings); null for all-day items. */
  starts_at: number | null;
  ends_at: number | null;
  allDay: boolean;
  location: string | null;
  /** Task completion state (only meaningful for kind === "task"). */
  done: boolean;
  /** Underlying entity id: meeting id, todo id, or project id. */
  entityId: string;
  /** Short project label shown on deadlines (project key). */
  label: string | null;
};

export type MeetingOccurrenceLike = { id: string; meeting_id: string; title: string; starts_at: number; ends_at: number; location: string | null };
export type TodoLike = { id: string; content: string; due_date: string | null; done: boolean };
export type ProjectLike = { id: string; name: string; key: string; deadline?: string | null; archived: boolean };

/** Local YYYY-MM-DD for a unix-seconds instant (calendar buckets by local day). */
export function localDateKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Normalise a stored date to a YYYY-MM-DD key; empty/invalid → null (no bucket). */
export function dateKey(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
}

export function meetingItem(occurrence: MeetingOccurrenceLike): CalendarItem {
  return {
    id: `meeting:${occurrence.id}`, kind: "meeting", title: occurrence.title,
    date: localDateKey(occurrence.starts_at), starts_at: occurrence.starts_at, ends_at: occurrence.ends_at,
    allDay: false, location: occurrence.location, done: false, entityId: occurrence.meeting_id, label: null,
  };
}

export function taskItem(todo: TodoLike): CalendarItem | null {
  const date = dateKey(todo.due_date);
  if (!date) return null;
  return {
    id: `task:${todo.id}`, kind: "task", title: todo.content, date,
    starts_at: null, ends_at: null, allDay: true, location: null,
    done: todo.done, entityId: todo.id, label: null,
  };
}

export function deadlineItem(project: ProjectLike): CalendarItem | null {
  if (project.archived) return null;
  const date = dateKey(project.deadline);
  if (!date) return null;
  return {
    id: `deadline:${project.id}`, kind: "deadline", title: project.name, date,
    starts_at: null, ends_at: null, allDay: true, location: null,
    done: false, entityId: project.id, label: project.key,
  };
}

/** Merge all three sources into one typed, day-bucketable list. */
export function buildCalendarItems(sources: {
  occurrences?: MeetingOccurrenceLike[];
  todos?: TodoLike[];
  projects?: ProjectLike[];
}): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const o of sources.occurrences ?? []) items.push(meetingItem(o));
  for (const t of sources.todos ?? []) { const i = taskItem(t); if (i) items.push(i); }
  for (const p of sources.projects ?? []) { const i = deadlineItem(p); if (i) items.push(i); }
  return items;
}

/** Local YYYY-MM-DD key for a Date (calendar grid days are local). */
export function dayKeyOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight of a date, dependency-free. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The 42-day (6×7) grid covering the month `cursor` falls in, Sunday-first. */
export function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  return days;
}

/** Distinct kinds present on a given day, in a stable order (for dot rendering). */
export function kindsOnDay(items: CalendarItem[], dayKey: string): CalendarKind[] {
  const order: CalendarKind[] = ["meeting", "task", "deadline"];
  const present = new Set(items.filter((i) => i.date === dayKey).map((i) => i.kind));
  return order.filter((k) => present.has(k));
}

/** Every item bucketed on a given local day, all-day first, then timed by start. */
export function itemsOnDay(items: CalendarItem[], dayKey: string): CalendarItem[] {
  return items
    .filter((i) => i.date === dayKey)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.starts_at ?? 0) - (b.starts_at ?? 0);
    });
}
