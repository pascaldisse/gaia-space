import { expect, test, describe } from "bun:test";
import { dateKey, dayRange, scheduleDays, scheduleRange, startOfLocalDay, SCHEDULE_DAYS } from "./calendar";
import type { CalendarItem } from "./api/personal";

const item = (over: Partial<CalendarItem>): CalendarItem => ({ id: "i", source_id: over.id ?? "i", kind: "task", title: "T", starts_at: 0, ends_at: null, project_id: null, calendar_id: null, date: null, ...over });
const at = (day: number, hour = 0) => Math.floor(new Date(2026, 2, day, hour).getTime() / 1000);

describe("Day range", () => {
  test("spans exactly the local day it was asked for", () => {
    const [start, end] = dayRange(new Date(2026, 2, 3, 17, 40));
    expect(dateKey(start)).toBe("2026-03-03");
    expect(start.getHours()).toBe(0);
    expect(dateKey(end)).toBe("2026-03-04");
    expect((end.getTime() - start.getTime()) / 36e5).toBe(24);
  });

  test("starts the day locally, never at a UTC instant", () =>
    expect(dateKey(startOfLocalDay(new Date(2026, 2, 3, 23, 59)))).toBe("2026-03-03"));
});

describe("Schedule range and rows", () => {
  test("the window runs forward from the cursor day", () => {
    const [start, end] = scheduleRange(new Date(2026, 2, 3, 9));
    expect(dateKey(start)).toBe("2026-03-03");
    expect(Math.round((end.getTime() - start.getTime()) / 864e5)).toBe(SCHEDULE_DAYS);
  });

  test("a shorter span is honoured", () => {
    const [start, end] = scheduleRange(new Date(2026, 2, 3), 7);
    expect(Math.round((end.getTime() - start.getTime()) / 864e5)).toBe(7);
  });

  test("only days that carry something become rows, in forward order", () => {
    const rows = scheduleDays([
      item({ id: "c", date: "2026-03-05" }),
      item({ id: "a", kind: "meeting", starts_at: at(3, 9), ends_at: at(3, 10) }),
    ], new Date(2026, 2, 3), 7);
    expect(rows.map((row) => row.key)).toEqual(["2026-03-03", "2026-03-05"]);
    expect(rows[0].items.map((x) => x.id)).toEqual(["a"]);
  });

  test("items before the window or past its end are not listed", () => {
    const rows = scheduleDays([
      item({ id: "past", date: "2026-03-02" }),
      item({ id: "later", date: "2026-03-20" }),
    ], new Date(2026, 2, 3), 7);
    expect(rows).toEqual([]);
  });

  test("a date-only item lands on its written day regardless of zone offset", () => {
    const rows = scheduleDays([item({ id: "d", date: "2026-03-04" })], new Date(2026, 2, 3), 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("2026-03-04");
  });
});
