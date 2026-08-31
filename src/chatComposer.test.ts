import { describe, expect, it } from "bun:test";
import { composerRows, composerRowsForHeight } from "./chatComposer";

describe("composerRows", () => {
  it("uses the minimum for a one-line draft", () => {
    expect(composerRows("hello", 1, 5)).toBe(1);
  });

  it("grows with explicit draft lines", () => {
    expect(composerRows("one\ntwo\nthree", 1, 5)).toBe(3);
  });

  it("clamps empty and overlong drafts to the configured bounds", () => {
    expect(composerRows("", 2, 5)).toBe(2);
    expect(composerRows("1\n2\n3\n4\n5\n6", 1, 5)).toBe(5);
  });
});
it("grows for visual wraps measured from textarea height", () => {
expect(composerRowsForHeight("one long visual line", 1, 5, 72, 18)).toBe(4);
expect(composerRowsForHeight("one", 1, 3, 90, 18)).toBe(3);
});
