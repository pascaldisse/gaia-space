import { expect, test, describe, afterEach } from "bun:test";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import DateField from "./DateField";

// A DATE IS CHOSEN IN THE PRODUCT, NOT IN THE OPERATING SYSTEM. `<input type="date">`
// looked like ours until it was clicked; then the OS drew its own grid in a layer no
// CSS reaches. This is that grid, in the product's voice — and everything the native
// control gave for free had to come with it: the same `YYYY-MM-DD` value, the keyboard,
// and the two answers people actually give a date field (today, and none).

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
  dispose = render(
    () => <DateField label="Due date" value={value()} onChange={setValue} placeholder="No date" />,
    host,
  );
  const trigger = () => host.querySelector("button.date-trigger") as HTMLButtonElement;
  return { host, value, trigger };
};

const mouseDown = (element: Element) =>
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

describe("choosing a date", () => {
  test("the trigger reads the value, not the storage form, and says so when empty", async () => {
    const { trigger, value } = mount("");
    expect(trigger().textContent).toContain("No date");
    expect(trigger().getAttribute("aria-label")).toBe("Due date");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    dispose?.(); dispose = undefined; document.body.innerHTML = "";
    const filled = mount("2026-03-09");
    // A person reads a date; the caller keeps the ISO string.
    expect(filled.trigger().textContent).toContain("Mar");
    expect(filled.trigger().textContent).toContain("2026");
    expect(filled.value()).toBe("2026-03-09");
    void value;
  });

  test("picking a day returns YYYY-MM-DD and closes the popover", async () => {
    const { trigger, value } = mount("2026-03-09");
    trigger().click();
    await settle();

    const popover = document.querySelector('[role="dialog"][aria-label="Due date"]') as HTMLElement;
    expect(popover).not.toBeNull();
    // The chosen day is marked as chosen, not merely hovered.
    expect(popover.querySelector(".date-day.selected")?.textContent).toBe("9");

    const eleventh = [...popover.querySelectorAll(".date-day:not(.muted)")].find((d) => d.textContent === "11")!;
    mouseDown(eleventh);
    await settle();

    expect(value()).toBe("2026-03-11");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("the keyboard moves by day and by month, Enter picks, Escape closes without writing", async () => {
    const { trigger, value } = mount("2026-03-09");
    trigger().click();
    await settle();
    const grid = document.querySelector(".date-grid") as HTMLElement;

    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle();
    // 9th → +1 day → +7 days = the 17th, and nothing is written until Enter.
    expect(value()).toBe("2026-03-09");
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(value()).toBe("2026-03-17");

    trigger().click();
    await settle();
    const again = document.querySelector(".date-grid") as HTMLElement;
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(value()).toBe("2026-03-17");
  });

  test("Today and Clear are offered, because they are the two answers people give", async () => {
    const { trigger, value } = mount("2026-03-09");
    trigger().click();
    await settle();
    mouseDown(document.querySelector("button.date-clear")!);
    await settle();
    expect(value()).toBe("");

    trigger().click();
    await settle();
    // With no date there is nothing to clear, so the act is not offered.
    expect(document.querySelector("button.date-clear")).toBeNull();
    mouseDown([...document.querySelectorAll("button.date-quick")].find((b) => b.textContent === "Today")!);
    await settle();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(value()).toBe(iso);
  });
});
