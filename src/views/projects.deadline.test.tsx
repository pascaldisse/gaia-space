import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Projects from "./Projects";
import { setProfileId, setProjectId } from "../session";

// Editing a deadline that already exists is a different write from the first one: it goes
// through the narrow compare-and-set command, it is offered only to the owner (or an admin),
// and the outcome is rendered where the control lives. The date is carried as `YYYY-MM-DD`
// end to end — no Date object is built on this path, so no timezone can move the day.

const calls: { cmd: string; args: any }[] = [];
let reply: (cmd: string) => unknown = () => [];
let dispose: (() => void) | undefined;

const stubTauriIpc = () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => {
      calls.push({ cmd, args });
      const value = reply(cmd);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
  };
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  reply = () => [];
  delete (window as any).__TAURI_INTERNALS__;
  // Session state is process-global: hand it back the way you found it.
  setProjectId(""); setProfileId("");
});

const settle = () => new Promise((done) => setTimeout(done, 40));
const project = (over: Record<string, unknown> = {}) => ({
  id: "p1", name: "Atlas", key: "ATL", description: null,
  created_by: "p-owner", archived: false, deadline: "2030-03-10", ...over,
});
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Projects /> as any, host);
  await settle();
  return host;
};
/* ADDRESS ONLY (date-field pass): the deadline is picked in the product's own month
   grid now (components/DateField.tsx), not in the operating system's — a native
   `<input type=date>` drew its calendar in a layer no CSS reaches. The write path,
   the compare-and-set command and the owner rule are unchanged; only the way a test
   states "choose this day" moved from `input.value = …` to picking the day. */
const deadlineTrigger = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>(".project-deadline button.date-trigger");
/** THE DEADLINE IS A PILL FIRST. A card carries the date as one fact at its edge; the
 *  date field is an ACT and is only drawn once somebody asks for it — by pressing the
 *  pill (offered only to whoever may move it) or through the card's menu. Every write
 *  test therefore opens the editor the way a person does. */
const duePill = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".project-due");
const openEditor = async (host: HTMLElement) => {
  host.querySelector<HTMLButtonElement>("button.project-due.editable")!.click();
  await settle();
  return deadlineTrigger(host)!;
};
/** Choose a day the way a person does: open the grid, walk to the month, press the
 *  day. The grid opens on the CURRENT value's month, so a date in another month is
 *  reached the same way a person reaches it. */
const setDate = async (trigger: HTMLButtonElement, value: string) => {
  trigger.click();
  await settle();
  const [year, month, day] = value.split("-").map(Number);
  const wanted = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const head = () => document.querySelector(".date-pop-head strong")!.textContent;
  for (let guard = 0; guard < 36 && head() !== wanted; guard += 1) {
    const shown = new Date(`${head()} 1`);
    const step = shown.getTime() < new Date(year, month - 1, 1).getTime() ? "Next month" : "Previous month";
    (document.querySelector(`.date-pop button[aria-label="${step}"]`) as HTMLButtonElement).click();
    await settle();
  }
  const cell = [...document.querySelectorAll(".date-pop .date-day:not(.muted)")]
    .find((element) => element.textContent === String(day))!;
  cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
};
const clearDate = async (trigger: HTMLButtonElement) => {
  trigger.click();
  await settle();
  document.querySelector("button.date-clear")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
};

describe("project deadline editing", () => {
  test("the owner edits an existing deadline through the narrow compare-and-set command", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : project({ deadline: "2030-06-01" }));
    const host = await mount();

    // The pill states the fact and carries the band's colour.
    expect(duePill(host)?.textContent).toBe("Due 2030-03-10");
    const picker = await openEditor(host);
    expect(picker).toBeTruthy();
    // The control reads the date the way a person writes it; the ISO string is what
    // travels to the server, and the card's own pill keeps stating it.
    expect(picker.textContent).toContain("2030");
    expect(picker.textContent).toContain("Mar");
    await setDate(picker, "2030-06-01");

    const write = calls.find((c) => c.cmd === "update_project_deadline");
    expect(write).toBeTruthy();
    // The value the view was showing travels with the write; the whole project does not.
    expect(write!.args).toMatchObject({ projectId: "p1", expectedDeadline: "2030-03-10", deadline: "2030-06-01" });
    expect(Object.keys(write!.args)).not.toContain("project");
    expect(calls.some((c) => c.cmd === "update_project")).toBe(false);
    // Success is announced next to the control, not swallowed.
    expect(host.querySelector('.project-deadline [role="status"]')?.textContent).toContain("Deadline saved");
  });

  // A date field can emit `change` twice for a single edit (programmatic fill plus blur).
  // The second event still carries the pre-edit expectation, so without a guard it comes
  // back as a spurious "changed since you loaded it" on a write that in fact succeeded.
  test("a doubled change event does not turn a successful edit into a stale-write error", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : project({ deadline: "2030-06-01" }));
    const host = await mount();

    /* ADDRESS ONLY: the native field could emit `change` twice for one edit (fill +
       blur). The picker commits once per chosen day, so the double is produced here
       by choosing the same day twice — the guard under test is the same one. */
    const picker = await openEditor(host);
    await setDate(picker, "2030-06-01");
    const again = deadlineTrigger(host);
    if (again) await setDate(again, "2030-06-01");
    await settle();

    expect(calls.filter((c) => c.cmd === "update_project_deadline").length).toBe(1);
    expect(host.querySelector('.project-deadline [role="alert"]')).toBeNull();
  });

  test("an empty deadline still takes the first-write door", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project({ deadline: null })] : project());
    const host = await mount();

    // With no date the pill says so, quietly and with no colour.
    expect(duePill(host)?.textContent).toBe("No deadline");
    expect(duePill(host)?.className).toContain("untoned");
    await setDate(await openEditor(host), "2030-03-10");
    expect(calls.some((c) => c.cmd === "set_project_deadline")).toBe(true);
    expect(calls.some((c) => c.cmd === "update_project_deadline")).toBe(false);
  });

  test("clearing sends an explicit null through the edit door", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : project({ deadline: null }));
    const host = await mount();

    // Clearing lives inside the picker now — one control, not a second button that
    // says the same thing beside it.
    await clearDate(await openEditor(host));
    const write = calls.find((c) => c.cmd === "update_project_deadline")!;
    expect(write.args).toMatchObject({ projectId: "p1", expectedDeadline: "2030-03-10", deadline: null });
  });

  test("a non-owner is shown the date as text, with no control to be refused", async () => {
    stubTauriIpc();
    setProfileId("p-member");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : []);
    const host = await mount();

    expect(deadlineTrigger(host)).toBeNull();
    expect(host.querySelector(".project-deadline button")).toBeNull();
    // The same pill, as a plain fact: no button, nothing to press and be refused.
    expect(host.querySelector("button.project-due")).toBeNull();
    expect(duePill(host)?.textContent).toBe("Due 2030-03-10");
  });

  test("a refused write is reported in place and the stored value is restored", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : new Error("That deadline changed since you loaded it; reload and try again"));
    const host = await mount();

    await setDate(await openEditor(host), "2031-01-01");
    const alert = host.querySelector('.project-deadline [role="alert"]');
    expect(alert?.textContent).toContain("changed since you loaded it");
    // The refused date never sticks: the list is re-read and the control shows the truth.
    expect(calls.filter((c) => c.cmd === "list_projects").length).toBeGreaterThan(1);
    expect(deadlineTrigger(host)!.textContent).toContain("2030");
    expect(deadlineTrigger(host)!.textContent).toContain("Mar");
  });
});
