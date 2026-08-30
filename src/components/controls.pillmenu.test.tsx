import { expect, test, describe, afterEach } from "bun:test";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { PillMenu, type PillMenuOption } from "./controls";

/**
 * THE KEYBOARD CONTRACT OF THE HAND-BUILT MENU.
 *
 * `PillMenu` exists because macOS draws a `<select>`'s open list itself and no
 * CSS reaches it. The moment we draw our own list we OWE the user everything
 * the native control gave away for free — arrows, Home/End, type-ahead,
 * Escape-returns-focus, Enter/Tab commit, listbox roles. That behaviour is
 * invisible in a screenshot and therefore exactly the kind that rots silently,
 * so it is pinned here: each test below is one clause of the contract.
 */

const OPTIONS: PillMenuOption[] = [
  { value: "", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "highest", label: "Highest" },
];

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

const settle = () => new Promise((done) => setTimeout(done, 20));

async function mount(initial = "medium", options: PillMenuOption[] = OPTIONS) {
  const [value, setValue] = createSignal(initial);
  const host = document.createElement("div");
  host.className = "theme-space-light";
  document.body.appendChild(host);
  dispose = render(() => <PillMenu label="Priority" value={value()} options={options} onChange={setValue} /> as any, host);
  await settle();
  const trigger = host.querySelector<HTMLButtonElement>(".pill-menu-trigger")!;
  return {
    host, trigger, value,
    list: () => document.querySelector<HTMLElement>(".pill-menu-list"),
    options: () => Array.from(document.querySelectorAll<HTMLElement>(".pill-menu-option")),
    active: () => document.querySelector<HTMLElement>(".pill-menu-option.active"),
  };
}

const key = async (target: Element, init: KeyboardEventInit) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  await settle();
};

describe("PillMenu — the keyboard contract", () => {
  test("the closed pill is a named, collapsed listbox trigger whose value is its label", async () => {
    const menu = await mount();
    expect(menu.trigger.getAttribute("aria-label")).toBe("Priority");
    expect(menu.trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(menu.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.trigger.textContent).toContain("Medium");
    expect(menu.list()).toBeNull();
  });

  test("Enter, Space and ArrowDown all open and put focus on the ACTIVE option", async () => {
    for (const pressed of ["Enter", " ", "ArrowDown"]) {
      const menu = await mount();
      await key(menu.trigger, { key: pressed });
      expect(menu.trigger.getAttribute("aria-expanded")).toBe("true");
      const list = menu.list()!;
      expect(list.getAttribute("role")).toBe("listbox");
      expect(list.getAttribute("aria-label")).toBe("Priority");
      // Opens ON the current value, not at the top: "Medium" is index 2.
      expect(menu.active()?.textContent).toContain("Medium");
      expect(document.activeElement).toBe(menu.active());
      dispose?.(); dispose = undefined; document.body.innerHTML = "";
    }
  });

  test("every option is a role=option and only the current one is aria-selected", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "Enter" });
    const options = menu.options();
    expect(options.length).toBe(OPTIONS.length);
    expect(options.every(option => option.getAttribute("role") === "option")).toBe(true);
    expect(options.filter(option => option.getAttribute("aria-selected") === "true").map(o => o.textContent))
      .toEqual(["Medium"]);
  });

  test("arrows move, Home/End jump, and none of them lets the page scroll", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "Enter" });

    const press = async (name: string) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      await settle();
      return event.defaultPrevented;
    };
    expect(await press("ArrowDown")).toBe(true);
    expect(menu.active()?.textContent).toContain("High");
    expect(await press("ArrowUp")).toBe(true);
    expect(menu.active()?.textContent).toContain("Medium");
    expect(await press("Home")).toBe(true);
    expect(menu.active()?.textContent).toContain("No priority");
    expect(await press("End")).toBe(true);
    expect(menu.active()?.textContent).toContain("Highest");
    // Focus follows the active row, always.
    expect(document.activeElement).toBe(menu.active());
  });

  test("type-ahead: 'hi' lands on High, and repeating a letter cycles", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "Enter" });
    await key(document.activeElement!, { key: "h" });
    expect(menu.active()?.textContent).toContain("High");
    await key(document.activeElement!, { key: "i" });
    expect(menu.active()?.textContent).toContain("High");
    expect(menu.active()?.textContent).not.toContain("Highest");

    // A repeated single letter cycles through everything starting with it.
    await new Promise(done => setTimeout(done, 750));   // buffer expires, like a native select
    await key(document.activeElement!, { key: "h" });
    expect(menu.active()?.textContent).toContain("High");
    await key(document.activeElement!, { key: "h" });
    expect(menu.active()?.textContent).toContain("Highest");
  });

  test("Enter commits the active option, closes, and returns focus to the trigger", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "ArrowDown" });
    await key(document.activeElement!, { key: "ArrowDown" });    // Medium -> High
    await key(document.activeElement!, { key: "Enter" });
    expect(menu.value()).toBe("high");
    expect(menu.list()).toBeNull();
    expect(document.activeElement).toBe(menu.trigger);
    expect(menu.trigger.textContent).toContain("High");
  });

  test("Space commits too", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "ArrowDown" });
    await key(document.activeElement!, { key: "ArrowUp" });      // Medium -> Low
    await key(document.activeElement!, { key: " " });
    expect(menu.value()).toBe("low");
    expect(menu.list()).toBeNull();
  });

  test("Escape closes WITHOUT committing and hands focus back to the trigger", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "Enter" });
    await key(document.activeElement!, { key: "End" });
    await key(document.activeElement!, { key: "Escape" });
    expect(menu.value()).toBe("medium");                          // End moved, Escape discarded
    expect(menu.list()).toBeNull();
    expect(menu.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu.trigger);
  });

  test("Tab commits and moves on to the next control", async () => {
    const menu = await mount();
    const after = document.createElement("button");
    after.textContent = "Next";
    document.body.appendChild(after);
    await key(menu.trigger, { key: "ArrowDown" });
    await key(document.activeElement!, { key: "ArrowDown" });     // Medium -> High
    await key(document.activeElement!, { key: "Tab" });
    expect(menu.value()).toBe("high");
    expect(menu.list()).toBeNull();
    expect(document.activeElement).toBe(after);
  });

  test("a mousedown outside closes it; a click on a row commits it", async () => {
    const menu = await mount();
    menu.trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(menu.list()).not.toBeNull();
    window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(menu.list()).toBeNull();
    expect(menu.value()).toBe("medium");

    menu.trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    menu.options()[4].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await settle();
    expect(menu.value()).toBe("highest");
    expect(menu.list()).toBeNull();
  });

  test("a disabled option can be neither landed on nor committed", async () => {
    const menu = await mount("low", [
      { value: "low", label: "Low" },
      { value: "blocked", label: "Blocked", disabled: true },
      { value: "high", label: "High" },
    ]);
    await key(menu.trigger, { key: "ArrowDown" });                // opens on Low
    await key(document.activeElement!, { key: "ArrowDown" });     // skips Blocked
    expect(menu.active()?.textContent).toContain("High");
    expect(menu.options()[1].getAttribute("aria-disabled")).toBe("true");
  });

  test("the popover leaves the clipping tree and is positioned, not nested", async () => {
    const menu = await mount();
    await key(menu.trigger, { key: "Enter" });
    const list = menu.list()!;
    // Portalled: it is NOT inside the (overflow-clipping) host the pill sits in.
    expect(menu.host.contains(list)).toBe(false);
    // Positioned from the trigger's measured rect (the stylesheet, which is not
    // loaded in this DOM, pins `position: fixed`; the coordinates are inline).
    expect(list.getAttribute("style")).toContain("left:");
    expect(list.getAttribute("style")).toContain("top:");
    expect(list.getAttribute("style")).toContain("max-height:");
    // The theme travels with it, or the light app would open a dark menu.
    expect(list.closest(".theme-space-light")).not.toBeNull();
  });
});
