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
const deadlineInput = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>('.project-deadline input[type="date"]');
const setDate = async (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
};

describe("project deadline editing", () => {
  test("the owner edits an existing deadline through the narrow compare-and-set command", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : project({ deadline: "2030-06-01" }));
    const host = await mount();

    const input = deadlineInput(host)!;
    expect(input).toBeTruthy();
    expect(input.value).toBe("2030-03-10");
    await setDate(input, "2030-06-01");

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

    const input = deadlineInput(host)!;
    input.value = "2030-06-01";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    expect(calls.filter((c) => c.cmd === "update_project_deadline").length).toBe(1);
    expect(host.querySelector('.project-deadline [role="alert"]')).toBeNull();
  });

  test("an empty deadline still takes the first-write door", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project({ deadline: null })] : project());
    const host = await mount();

    await setDate(deadlineInput(host)!, "2030-03-10");
    expect(calls.some((c) => c.cmd === "set_project_deadline")).toBe(true);
    expect(calls.some((c) => c.cmd === "update_project_deadline")).toBe(false);
  });

  test("clearing sends an explicit null through the edit door", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : project({ deadline: null }));
    const host = await mount();

    const clear = host.querySelector<HTMLButtonElement>('.project-deadline button')!;
    expect(clear.getAttribute("aria-label")).toBe("Clear deadline for Atlas");
    clear.click();
    await settle();
    const write = calls.find((c) => c.cmd === "update_project_deadline")!;
    expect(write.args).toMatchObject({ projectId: "p1", expectedDeadline: "2030-03-10", deadline: null });
  });

  test("a non-owner is shown the date as text, with no control to be refused", async () => {
    stubTauriIpc();
    setProfileId("p-member");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : []);
    const host = await mount();

    expect(deadlineInput(host)).toBeNull();
    expect(host.querySelector(".project-deadline button")).toBeNull();
    expect(host.querySelector(".deadline-readonly")?.textContent).toContain("2030-03-10");
  });

  test("a refused write is reported in place and the stored value is restored", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => (cmd === "list_projects" ? [project()] : new Error("That deadline changed since you loaded it; reload and try again"));
    const host = await mount();

    await setDate(deadlineInput(host)!, "2031-01-01");
    const alert = host.querySelector('.project-deadline [role="alert"]');
    expect(alert?.textContent).toContain("changed since you loaded it");
    // The refused date never sticks: the list is re-read and the input shows the truth.
    expect(calls.filter((c) => c.cmd === "list_projects").length).toBeGreaterThan(1);
    expect(deadlineInput(host)!.value).toBe("2030-03-10");
  });
});
