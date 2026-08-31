import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import IssueCreateDrawer from "../components/IssueCreateDrawer";
import { setProfileId, setProjectId } from "../session";

// issue #10: the drawer created into the AMBIENT project — nothing on screen said
// where the ticket would land, and nothing could redirect it. A ticket's project is
// a decision, so the decision must be VISIBLE and CHANGEABLE before saving.
const PROJECTS = [
  { id: "p-1", name: "Alpha", key: "ALP", archived: false },
  { id: "p-2", name: "Beta", key: "BET", archived: false },
];
const calls: { cmd: string; args: any }[] = [];
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 30));
const mountTauri = () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => {
      calls.push({ cmd, args });
      if (cmd === "create_issue") return Promise.resolve({ ...args.input, id: "i-1", number: 1, assignee_ids: [] });
      if (cmd === "list_projects") return Promise.resolve(PROJECTS);
      return Promise.resolve([]);
    },
  };
};
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  delete (window as any).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
});

describe("new ticket drawer: project selector", () => {
  test("the target project is visible in the drawer before saving", async () => {
    mountTauri();
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueCreateDrawer projectId="p-1" statuses={[]} onClose={() => {}} onCreated={() => {}} /> as any, host);
    await settle();
    const picker = host.querySelector<HTMLElement>('[aria-label="Ticket project"]')!;
    expect(picker).toBeTruthy();
    expect(picker.textContent).toContain("Alpha");
    expect(calls.find((c) => c.cmd === "create_issue")).toBeFalsy();
  });

  test("choosing another project sends THAT project to create_issue", async () => {
    mountTauri();
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueCreateDrawer projectId="p-1" statuses={[]} onClose={() => {}} onCreated={() => {}} /> as any, host);
    await settle();
    const title = host.querySelector<HTMLInputElement>('input[aria-label="Ticket title"]')!;
    title.value = "Route me to Beta";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Ticket project"]')!;
    picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    const beta = Array.from(document.querySelectorAll<HTMLElement>(".pill-menu-option")).find((o) => o.textContent?.includes("Beta"))!;
    expect(beta).toBeTruthy();
    beta.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settle();
    expect(picker.textContent).toContain("Beta");
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find((c) => c.cmd === "create_issue")!.args.input.project_id).toBe("p-2");
  });

  test("project is mandatory: no project, no create_issue", async () => {
    mountTauri();
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueCreateDrawer projectId="" statuses={[]} onClose={() => {}} onCreated={() => {}} /> as any, host);
    await settle();
    const title = host.querySelector<HTMLInputElement>('input[aria-label="Ticket title"]')!;
    title.value = "Nowhere ticket";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find((c) => c.cmd === "create_issue")).toBeFalsy();
    expect(host.querySelector(".wid-error")!.textContent).toContain("project");
  });
});
