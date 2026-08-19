import { expect, test } from "bun:test";
import { itemsOnDay, monthGrid, normalizeCalendarItem } from "./calendar";

test("normalizes authoritative calendar items for local calendar display", () => {
  const meeting = normalizeCalendarItem({ id: "m1", kind: "meeting", title: "Standup", starts_at: new Date(2026, 8, 1, 10).getTime() / 1000, ends_at: new Date(2026, 8, 1, 11).getTime() / 1000, project_id: null });
  const task = normalizeCalendarItem({ id: "t1", kind: "task", title: "Ship", starts_at: new Date(2026, 8, 1).getTime() / 1000, ends_at: null, project_id: "p1" });

  expect(meeting.date).toBe("2026-09-01");
  expect(meeting.allDay).toBeFalse();
  expect(task.allDay).toBeTrue();
  expect(task.project_id).toBe("p1");
});

test("orders all-day items before timed items within a day", () => {
  const day = "2026-09-01";
  const items = itemsOnDay([
    { id: "late", kind: "meeting", title: "Late", date: day, starts_at: 20, ends_at: 21, allDay: false, done: false, project_id: null },
    { id: "task", kind: "task", title: "Task", date: day, starts_at: 0, ends_at: null, allDay: true, done: false, project_id: null },
    { id: "early", kind: "meeting", title: "Early", date: day, starts_at: 10, ends_at: 11, allDay: false, done: false, project_id: null },
  ], day);
  expect(items.map(item => item.title)).toEqual(["Task", "Early", "Late"]);
});

test("month grid always supplies six complete weeks", () => {
  const grid = monthGrid(new Date(2026, 8, 1));
  expect(grid).toHaveLength(42);
  expect(grid[0].getDay()).toBe(0);
});
