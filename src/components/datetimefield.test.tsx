import { expect, test, describe, afterEach } from "bun:test";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import DateTimeField, { joinLocal, splitLocal } from "./DateTimeField";

// AN INSTANT IS A DAY AND A CLOCK. `<input type="datetime-local">` opened the operating
// system's calendar for its day half — the same defect DateField was built to end. The
// day moved into the product's month grid; the clock stayed a `type="time"` input,
// whose system popup is a scroll wheel, not a calendar. What must NOT move is the
// value: callers keep the exact `YYYY-MM-DDTHH:mm` string the native control emitted.

let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 10));

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
});

const mount = (initial = "") => {
  const [value, setValue] = createSignal(initial);
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <DateTimeField label="Start" value={value()} onChange={setValue} />, host);
  return {
    host,
    value,
    trigger: () => host.querySelector("button.date-trigger") as HTMLButtonElement,
    clock: () => host.querySelector("input.date-time-clock") as HTMLInputElement,
  };
};

const mouseDown = (element: Element) =>
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

/** Choose a day the way a person does: open the grid, then press the day. */
const pickDay = async (trigger: HTMLButtonElement, day: number) => {
  trigger.click();
  await settle();
  mouseDown([...document.querySelectorAll(".date-pop .date-day:not(.muted)")].find((cell) => cell.textContent === String(day))!);
  await settle();
};
const type = async (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
};

describe("the two halves of an instant", () => {
  test("splitting and joining preserve the caller's exact format", () => {
    expect(splitLocal("2026-03-09T14:30")).toEqual({ date: "2026-03-09", time: "14:30" });
    // Seconds may ride along from a stored value; the halves are still the day and the clock.
    expect(splitLocal("2026-03-09T14:30:00")).toEqual({ date: "2026-03-09", time: "14:30" });
    expect(splitLocal("")).toEqual({ date: "", time: "" });
    expect(splitLocal("nonsense")).toEqual({ date: "", time: "" });

    expect(joinLocal("2026-03-09", "14:30")).toBe("2026-03-09T14:30");
    // HALF A DATE IS NOT A DATE: an incomplete pair composes to nothing at all.
    expect(joinLocal("2026-03-09", "")).toBe("");
    expect(joinLocal("", "14:30")).toBe("");
    expect(joinLocal("09/03/2026", "14:30")).toBe("");
  });

  test("the field shows both halves of the value it was given", () => {
    const { trigger, clock } = mount("2026-03-09T14:30");
    expect(trigger().textContent).toContain("Mar");
    expect(trigger().textContent).toContain("2026");
    expect(clock().value).toBe("14:30");
    expect(clock().getAttribute("aria-label")).toBe("Start time");
  });

  test("editing one half keeps the other and writes the composed instant", async () => {
    const { trigger, clock, value } = mount("2026-03-09T14:30");
    await type(clock(), "09:15");
    expect(value()).toBe("2026-03-09T09:15");

    await pickDay(trigger(), 11);
    expect(value()).toBe("2026-03-11T09:15");
  });

  test("with one half missing nothing is written, and the pair completes into one value", async () => {
    const { trigger, clock, value } = mount("");
    await pickDay(trigger(), 11);
    // A day without a clock is not an instant, so the caller hears nothing yet.
    expect(value()).toBe("");
    await type(clock(), "08:00");
    expect(value()).toMatch(/^\d{4}-\d{2}-11T08:00$/);
  });

  test("clearing both halves clears the caller's value", async () => {
    const { trigger, clock, value } = mount("2026-03-09T14:30");
    await type(clock(), "");
    // The clock alone is gone: still an incomplete pair, so still no write.
    expect(value()).toBe("2026-03-09T14:30");
    trigger().click();
    await settle();
    mouseDown(document.querySelector("button.date-clear")!);
    await settle();
    expect(value()).toBe("");
  });
});
