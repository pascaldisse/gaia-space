import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { AssigneeControl, DueDateControl, ProjectControl, isoInDays, readableDate } from "./TaskMeta";

// The composer controls are one shell: a real button that says what it owns, a
// popover that closes on Escape and on a click outside, and an assignee list that
// carries several people because a task does.

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });
const settle = () => new Promise((done) => setTimeout(done, 20));
const mount = async (node: () => any) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(node, host);
  await settle();
  return host;
};
const trigger = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".tm-trigger")!;
const click = async (el: Element) => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); await settle(); };

describe("task composer metadata controls", () => {
  test("a due date stays a local YYYY-MM-DD string, never a shifted timestamp", () => {
    const base = new Date(2030, 0, 31, 23, 30);
    expect(isoInDays(0, base)).toBe("2030-01-31");
    expect(isoInDays(1, base)).toBe("2030-02-01");
    expect(readableDate("")).toBe("");
    expect(readableDate("not-a-date")).toBe("not-a-date");
  });

  test("the trigger states what it owns and the popover closes on Escape, focus returned", async () => {
    const [value, setValue] = createSignal("");
    const host = await mount(() => <ProjectControl value={value()} projects={[{ id: "p1", name: "Atlas", key: "ATL" }]} onChange={setValue} /> as any);
    const button = trigger(host);
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const menuId = button.getAttribute("aria-controls")!;
    expect(menuId).toBeTruthy();

    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(`#${menuId}`)?.getAttribute("role")).toBe("dialog");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  test("a mousedown outside closes the popover", async () => {
    const host = await mount(() => <DueDateControl value="" onChange={() => {}} /> as any);
    await click(trigger(host));
    expect(host.querySelector(".tm-menu")).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(host.querySelector(".tm-menu")).toBeNull();
  });

  test("picking a project reports the choice and closes; the value is shown at rest", async () => {
    const [value, setValue] = createSignal("");
    const host = await mount(() => <ProjectControl value={value()} projects={[{ id: "p1", name: "Atlas", key: "ATL" }]} onChange={setValue} /> as any);
    await click(trigger(host));
    const option = [...host.querySelectorAll(".tm-opt")].find((n) => n.textContent?.includes("Atlas"))!;
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(value()).toBe("p1");
    expect(host.querySelector(".tm-value")?.textContent).toBe("Atlas");
    expect(host.querySelector(".tm-menu")).toBeNull();
  });

  test("several assignees can be carried, and the popover stays open while picking", async () => {
    const [value, setValue] = createSignal<string[]>([]);
    const toggle = (id: string) => setValue((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
    const people = [{ id: "a", label: "Ada" }, { id: "b", label: "Bo" }, { id: "c", label: "Cy" }];
    const host = await mount(() => <AssigneeControl value={value()} people={people} onToggle={toggle} /> as any);
    await click(trigger(host));
    const options = [...host.querySelectorAll(".tm-opt")];
    options[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    options[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(value()).toEqual(["a", "b"]);
    expect(host.querySelector(".tm-menu")).not.toBeNull();
    expect(host.querySelector(".tm-value")?.textContent).toBe("Ada, Bo");
    options[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(host.querySelector(".tm-value")?.textContent).toBe("Ada, Bo +1");
  });

  test("with no project chosen the assignee control refuses to open and says why", async () => {
    const host = await mount(() => <AssigneeControl value={[]} people={[]} onToggle={() => {}} disabled disabledReason="Select a project before assigning members" /> as any);
    const button = trigger(host);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Select a project before assigning members");
  });
});
