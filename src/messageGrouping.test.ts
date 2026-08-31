import { expect, test } from "bun:test";
import { isGrouped } from "./messageGrouping";

const message = (author_id: string | null, created_at: number) => ({ author_id, created_at });

test("groups consecutive messages from one author inside five minutes", () => {
  expect(isGrouped(message("ada", 100), message("ada", 399))).toBe(true);
});

test("keeps author changes, five-minute gaps, and system messages separate", () => {
  expect(isGrouped(message("ada", 100), message("bea", 101))).toBe(false);
  expect(isGrouped(message("ada", 100), message("ada", 400))).toBe(false);
  expect(isGrouped(message(null, 100), message(null, 101))).toBe(false);
});

test("does not group out-of-order messages", () => {
  expect(isGrouped(message("ada", 101), message("ada", 100))).toBe(false);
});
