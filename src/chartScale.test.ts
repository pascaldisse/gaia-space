import { expect, test, describe } from "bun:test";
import { axisShare, axisTicks, axisTop, niceStep } from "./chartScale";

describe("chart scales", () => {
  test("a step is rounded up to something a person reads", () => {
    expect(niceStep(0.8)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7500)).toBe(10000);
    expect(niceStep(0)).toBe(0);
  });
  test("ticks run from zero to a rounded top", () => {
    expect(axisTicks(3, 4)).toEqual([0, 1, 2, 3]);
    expect(axisTicks(30000, 4)).toEqual([0, 10000, 20000, 30000]);
    expect(axisTop(13200, 4)).toBe(15000);
    expect(axisTicks(13200, 4)).toEqual([0, 5000, 10000, 15000]);
  });
  test("an axis over countable things never ticks in halves", () => {
    expect(axisTicks(1, 4, 1)).toEqual([0, 1]);
    expect(axisTicks(3, 4, 1)).toEqual([0, 1, 2, 3]);
    expect(axisTop(7, 4, 1)).toBe(8);
  });
  test("an empty report has no axis and no bar", () => {
    expect(axisTicks(0)).toEqual([0]);
    expect(axisTop(0)).toBe(0);
    expect(axisShare(5, 0)).toBe(0);
    expect(axisShare(0, 10)).toBe(0);
  });
  test("a share is measured against the axis, never against the neighbour", () => {
    expect(axisShare(5, 20)).toBe(0.25);
    expect(axisShare(25, 20)).toBe(1);   // clipped, never drawn past the axis
  });
});
