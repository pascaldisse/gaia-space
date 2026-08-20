import { expect, test } from "bun:test";
import { dateKey, dateOnlyLocal } from "./calendarDate";

test("date-only values stay on their named local calendar day", () => {
  // Run with TZ=America/Los_Angeles: parsing as a UTC instant would show 2026-01-14.
  expect(dateKey(dateOnlyLocal("2026-01-15"))).toBe("2026-01-15");
});
