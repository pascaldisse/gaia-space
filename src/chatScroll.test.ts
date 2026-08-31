import { describe, expect, test } from "bun:test";
import {
  captureScroll,
  isNearBottom,
  restorePrependedScroll,
  scrollTargetFor,
  shouldAutoScroll,
} from "./chatScroll";

describe("chat scroll", () => {
  test("opens a conversation at the newest message", () => {
    expect(shouldAutoScroll({ opening: true, wasNearBottom: false })).toBe(true);
  });

  test("only follows live updates while the reader is at the bottom", () => {
    expect(shouldAutoScroll({ opening: false, wasNearBottom: true })).toBe(true);
    expect(shouldAutoScroll({ opening: false, wasNearBottom: false })).toBe(false);
  });

  test("recognises the bottom and its small tolerance", () => {
    const metrics = { scrollTop: 605, scrollHeight: 1200, clientHeight: 555 };
    expect(isNearBottom(metrics)).toBe(false);
    expect(isNearBottom({ ...metrics, scrollTop: 621 })).toBe(true);
    expect(isNearBottom({ ...metrics, scrollTop: 620 })).toBe(false);
  });

  test("targets scrollHeight so the browser clamps to the current bottom", () => {
    expect(scrollTargetFor({ scrollTop: 0, scrollHeight: 1184, clientHeight: 555 })).toBe(1184);
  });

  test("preserves the visible history row when an older page is prepended", () => {
    const anchor = captureScroll({ scrollTop: 120, scrollHeight: 800, clientHeight: 400 });
    expect(restorePrependedScroll(anchor, { scrollTop: 120, scrollHeight: 1040, clientHeight: 400 })).toBe(360);
  });
});
