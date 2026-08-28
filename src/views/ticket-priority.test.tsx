import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import IssueCreateDrawer from "../components/IssueCreateDrawer";
import { setProfileId, setProjectId } from "../session";

// A ticket carries a priority. The field has always existed on `issues`, and the list
// already paints a pill for it — but the creation surface hardcoded null, so no ticket
// could ever be born with one. This pins the door open.
const calls: { cmd: string; args: any }[] = [];
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 30));

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  delete (window as any).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
});

describe("ticket priority", () => {
  test("the chosen priority reaches create_issue on the wire", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === "create_issue") return Promise.resolve({ ...args.input, id: "i-1", number: 1, assignee_ids: [] });
        return Promise.resolve([]);
      },
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueCreateDrawer projectId="p-1" statuses={[]} onClose={() => {}} onCreated={() => {}} /> as any, host);
    await settle();

    const title = host.querySelector<HTMLInputElement>('input[aria-label="Ticket title"]')!;
    title.value = "Safari login hangs";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    const priority = host.querySelector<HTMLSelectElement>('select[aria-label="Ticket priority"]')!;
    expect(priority).toBeTruthy();
    expect([...priority.options].map((o) => o.value)).toEqual(["", "LOW", "MEDIUM", "HIGH", "URGENT"]);
    priority.value = "HIGH";
    priority.dispatchEvent(new Event("change", { bubbles: true }));

    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const created = calls.find((c) => c.cmd === "create_issue");
    expect(created).toBeTruthy();
    expect(created!.args.input.priority).toBe("HIGH");
  });

  test("no choice stays null, never an empty string", async () => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === "create_issue") return Promise.resolve({ ...args.input, id: "i-2", number: 2, assignee_ids: [] });
        return Promise.resolve([]);
      },
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <IssueCreateDrawer projectId="p-1" statuses={[]} onClose={() => {}} onCreated={() => {}} /> as any, host);
    await settle();
    const title = host.querySelector<HTMLInputElement>('input[aria-label="Ticket title"]')!;
    title.value = "No priority set";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find((c) => c.cmd === "create_issue")!.args.input.priority).toBeNull();
  });
});
