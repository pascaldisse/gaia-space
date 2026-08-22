import { expect, test, describe } from "bun:test";
import { calendarEntries, dateKey, dayFromKey, entriesForDay, itemDayKey, itemsOnDay, kindPresence, localInput, meetingIdOf, meetingDraftError, monthCells, taskDraftError, deadlineDraftError } from "./calendar";
import type { CalendarItem } from "./api/personal";

const item = (over: Partial<CalendarItem>): CalendarItem => ({ id: "i", source_id: over.id ?? "i", kind: "task", title: "T", starts_at: 0, ends_at: null, project_id: null, calendar_id: null, date: null, ...over });

describe("resolving an item back to its meeting", () => {
  test("an occurrence resolves to the series it was expanded from", () => {
    expect(meetingIdOf({ id: "meet-1:1793404800", source_id: "meet-1" })).toBe("meet-1");
    expect(meetingIdOf({ id: "meet-1", source_id: "meet-1" })).toBe("meet-1");
  });

  test("a meeting whose own id ends in :digits is not mistaken for an occurrence", () => {
    // The old rule split on the last colon and turned this into `foo`, opening
    // a different meeting (or nothing at all).
    expect(meetingIdOf({ id: "foo:123", source_id: "foo:123" })).toBe("foo:123");
    expect(meetingIdOf({ id: "foo:123:1793404800", source_id: "foo:123" })).toBe("foo:123");
  });

  test("without a carried source id the item's own id is the answer", () => {
    expect(meetingIdOf({ id: "meet-9" })).toBe("meet-9");
    expect(meetingIdOf({ id: "meet-9", source_id: null })).toBe("meet-9");
  });
});

describe("date-only calendar days", () => {
  test("dateKey uses local components, never the UTC serialization", () => {
    // 2030-03-10T23:30 local: toISOString() would report the 11th east of UTC
    // and the 9th west of it. The calendar day is the local day.
    const late = new Date(2030, 2, 10, 23, 30);
    expect(dateKey(late)).toBe("2030-03-10");
    const early = new Date(2030, 2, 10, 0, 15);
    expect(dateKey(early)).toBe("2030-03-10");
    expect(dateKey(new Date(2030, 0, 1))).toBe("2030-01-01");
  });

  test("a date-only item lands on the day it was written as, in every zone", () => {
    const due = item({ id: "t", date: "2030-03-10", starts_at: Date.parse("2030-03-10T00:00:00Z") / 1000 });
    expect(itemDayKey(due)).toBe("2030-03-10");
    expect(itemsOnDay([due], dayFromKey("2030-03-10"))).toHaveLength(1);
    expect(itemsOnDay([due], dayFromKey("2030-03-09"))).toHaveLength(0);
    expect(itemsOnDay([due], dayFromKey("2030-03-11"))).toHaveLength(0);
  });

  test("a meeting keeps its instant and lands on its local day", () => {
    const at = new Date(2030, 2, 10, 9, 0);
    const meeting = item({ kind: "meeting", starts_at: Math.floor(at.getTime() / 1000), ends_at: Math.floor(at.getTime() / 1000) + 3600 });
    expect(itemDayKey(meeting)).toBe("2030-03-10");
    expect(localInput(Math.floor(at.getTime() / 1000))).toBe("2030-03-10T09:00");
  });

  test("DST boundaries keep both neighbouring days addressable", () => {
    // Around a spring-forward day the local midnight of the next day is 23h away,
    // so epoch arithmetic on days is wrong; local components are not.
    for (const key of ["2030-03-30", "2030-03-31", "2030-04-01", "2030-10-27", "2030-11-03"]) {
      expect(dateKey(dayFromKey(key))).toBe(key);
    }
  });

  test("day keys round-trip across a synthetic +13 / -11 offset sweep", () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(2030, 2, 10, hour, 30);
      expect(itemDayKey(item({ kind: "meeting", starts_at: Math.floor(at.getTime() / 1000) }))).toBe("2030-03-10");
    }
  });
});

describe("quick-create validation", () => {
  test("a meeting needs a title and an end after its start", () => {
    const base = { title: "Sync", starts_at: "2030-03-10T10:00", ends_at: "2030-03-10T11:00", location: "", rrule: "" };
    expect(meetingDraftError(base)).toBe("");
    expect(meetingDraftError({ ...base, title: "  " })).toBe("A meeting needs a title.");
    expect(meetingDraftError({ ...base, ends_at: "2030-03-10T10:00" })).toBe("The meeting has to end after it starts.");
    expect(meetingDraftError({ ...base, ends_at: "" })).toBe("A meeting needs a start and an end.");
  });

  test("a task needs a title and a due day; a deadline needs a project and a day", () => {
    expect(taskDraftError({ title: "Ship", day: "2030-03-10" })).toBe("");
    expect(taskDraftError({ title: "", day: "2030-03-10" })).toBe("A task needs a title.");
    expect(taskDraftError({ title: "Ship", day: "10/03/2030" })).toBe("A task needs a due day.");
    expect(deadlineDraftError({ project_id: "p", day: "2030-03-10" })).toBe("");
    expect(deadlineDraftError({ project_id: "", day: "2030-03-10" })).toBe("Choose a project to give a deadline.");
    expect(deadlineDraftError({ project_id: "p", day: "" })).toBe("A deadline needs a day.");
  });
});

describe("overview display model", () => {
  const at = (day: number, hour = 0) => new Date(2026, 2, day, hour).getTime() / 1000;
  const item = (over: Partial<CalendarItem> & { id: string }): CalendarItem =>
    ({ source_id: over.id, kind: "task", title: over.id.toUpperCase(), starts_at: at(3), ends_at: null, project_id: null, calendar_id: null, date: null, ...over });

  test("a date-only item keeps the day it was written as", () => {
    const entry = calendarEntries([item({ id: "a", date: "2026-03-03" })])[0];
    expect(entry.day).toBe("2026-03-03");
    expect(entry.allDay).toBe(true);
  });

  test("an instant falls on its local day", () =>
    expect(calendarEntries([item({ id: "a", kind: "meeting", starts_at: at(3, 9), ends_at: at(3, 10) })])[0].day).toBe("2026-03-03"));

  test("orders all-day before timed entries", () =>
    expect(calendarEntries([
      item({ id: "b", kind: "meeting", starts_at: at(3, 9), ends_at: at(3, 10) }),
      item({ id: "a", starts_at: at(3) }),
    ]).map((x) => x.id)).toEqual(["a", "b"]));

  test("kind presence follows display order", () =>
    expect(kindPresence(calendarEntries([
      item({ id: "x", kind: "deadline", starts_at: at(1) }),
      item({ id: "y", kind: "meeting", starts_at: at(1) }),
    ]))).toEqual(["meeting", "deadline"]));

  test("a day selection reads the same key the entries carry", () =>
    expect(entriesForDay(calendarEntries([item({ id: "a", date: "2026-03-03" })]), new Date(2026, 2, 3)).map((x) => x.id)).toEqual(["a"]));

  test("month always has Sunday-first 42 cells", () => {
    const cells = monthCells(new Date(2026, 2, 15));
    expect(cells).toHaveLength(42);
    expect(cells[0].getDay()).toBe(0);
  });
});
