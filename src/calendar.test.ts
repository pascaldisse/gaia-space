import { expect, test, describe } from "bun:test";
import {
  buildCalendarItems, dateKey, deadlineItem, itemsOnDay, localDateKey, taskItem,
  type ProjectLike, type TodoLike,
} from "./calendar";

// Fixed local noon avoids any day-boundary ambiguity when deriving the bucket key.
const noon = (y: number, m: number, d: number) => Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000);

describe("dateKey", () => {
  test("keeps a valid ISO date, trims time and whitespace", () => {
    expect(dateKey("2026-09-01")).toBe("2026-09-01");
    expect(dateKey("  2026-09-01T09:00 ")).toBe("2026-09-01");
  });
  test("rejects empty / malformed values", () => {
    expect(dateKey(null)).toBeNull();
    expect(dateKey("")).toBeNull();
    expect(dateKey("soon")).toBeNull();
  });
});

test("localDateKey buckets a timed instant on its local day", () => {
  expect(localDateKey(noon(2026, 9, 1))).toBe("2026-09-01");
});

describe("typed item construction", () => {
  test("a task only becomes an item when it has a due date, carrying done state", () => {
    const withDue: TodoLike = { id: "t1", content: "Ship", due_date: "2026-09-01", done: false };
    const noDue: TodoLike = { id: "t2", content: "Someday", due_date: null, done: false };
    const item = taskItem(withDue)!;
    expect(item.kind).toBe("task");
    expect(item.allDay).toBe(true);
    expect(item.date).toBe("2026-09-01");
    expect(item.done).toBe(false);
    expect(item.entityId).toBe("t1");
    expect(taskItem(noDue)).toBeNull();
  });
  test("a project deadline becomes an item only when set and not archived", () => {
    const dated: ProjectLike = { id: "p1", name: "Launch", key: "PLT", deadline: "2026-09-10", archived: false };
    const item = deadlineItem(dated)!;
    expect(item.kind).toBe("deadline");
    expect(item.label).toBe("PLT");
    expect(item.date).toBe("2026-09-10");
    expect(deadlineItem({ ...dated, deadline: null })).toBeNull();
    expect(deadlineItem({ ...dated, archived: true })).toBeNull();
  });
});

test("meetings retain timed behaviour alongside all-day tasks/deadlines", () => {
  const items = buildCalendarItems({
    occurrences: [{ id: "m1:100", meeting_id: "m1", title: "Standup", starts_at: noon(2026, 9, 1), ends_at: noon(2026, 9, 1) + 1800, location: "Room A" }],
    todos: [{ id: "t1", content: "Ship", due_date: "2026-09-01", done: false }],
    projects: [{ id: "p1", name: "Launch", key: "PLT", deadline: "2026-09-01", archived: false }],
  });
  const meeting = items.find((i) => i.kind === "meeting")!;
  expect(meeting.allDay).toBe(false);
  expect(meeting.location).toBe("Room A");
  // All three land on the same day and are typed distinctly.
  const kinds = itemsOnDay(items, "2026-09-01").map((i) => i.kind);
  expect(kinds.sort()).toEqual(["deadline", "meeting", "task"]);
});

test("itemsOnDay puts all-day items first, then timed by start, and filters by day", () => {
  const items = buildCalendarItems({
    occurrences: [
      { id: "late", meeting_id: "late", title: "Late", starts_at: noon(2026, 9, 1) + 3600, ends_at: noon(2026, 9, 1) + 5400, location: null },
      { id: "early", meeting_id: "early", title: "Early", starts_at: noon(2026, 9, 1), ends_at: noon(2026, 9, 1) + 1800, location: null },
      { id: "other", meeting_id: "other", title: "Other day", starts_at: noon(2026, 9, 2), ends_at: noon(2026, 9, 2) + 1800, location: null },
    ],
    todos: [{ id: "t1", content: "Due", due_date: "2026-09-01", done: false }],
  });
  const day = itemsOnDay(items, "2026-09-01");
  expect(day.map((i) => i.title)).toEqual(["Due", "Early", "Late"]);
});
