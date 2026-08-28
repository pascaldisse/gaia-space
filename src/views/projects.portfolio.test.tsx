import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Projects, { deriveKey } from "./Projects";
import { setProfileId, setProjectId } from "../session";

// The portfolio strip and the per-card open-issue count are read off ONE issue
// read plus ONE status read, whatever the number of projects. A failed count is
// an error on screen, never a silent zero.

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
  created_by: "p-owner", archived: false, deadline: null, ...over,
});
const issue = (over: Record<string, unknown> = {}) => ({
  id: "i1", project_id: "p1", number: 1, title: "Work", description: null,
  status_id: "open", assignee_id: null, created_by: null, due_date: null,
  priority: null, archived: false, assignee_ids: [], ...over,
});
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Projects /> as any, host);
  await settle();
  return host;
};

describe("portfolio summary and open-issue counts", () => {
  test("a key is derived from the name and stops following once typed by hand", () => {
    expect(deriveKey("Marketing site redesign")).toBe("MARKE");
    expect(deriveKey("a-b c!d")).toBe("ABCD");
    expect(deriveKey("")).toBe("");
  });

  test("counts come from one issue read and one status read, not one per card", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => {
      if (cmd === "list_projects") return [project(), project({ id: "p2", name: "Borea", key: "BOR", deadline: "2030-01-02" })];
      if (cmd === "list_issue_statuses") return [{ id: "open", project_id: "p1", name: "Open", resolved: false, color: "#fff", ordering: 0 }, { id: "done", project_id: "p1", name: "Done", resolved: true, color: "#fff", ordering: 1 }];
      if (cmd === "list_issues") return [
        issue(), issue({ id: "i2" }),
        issue({ id: "i3", status_id: "done" }),        // resolved -> not open
        issue({ id: "i4", archived: true }),            // archived -> not open
        issue({ id: "i5", project_id: "p2" }),
      ];
      return [];
    };
    const host = await mount();

    expect(calls.filter((c) => c.cmd === "list_issues")).toHaveLength(1);
    expect(calls.filter((c) => c.cmd === "list_issue_statuses")).toHaveLength(1);

    const cards = [...host.querySelectorAll(".project-card .pf-open")].map((n) => n.textContent);
    expect(cards).toEqual(["2 open tickets", "1 open tickets"]);

    const metrics = [...host.querySelectorAll(".pf-metric")].map((n) => n.textContent);
    expect(metrics[0]).toContain("2Active projects");
    expect(metrics[1]).toContain("3Open tickets");
    expect(metrics[2]).toContain("1Carrying a deadline");
    expect(metrics[3]).toContain("2030-01-02");
    expect(metrics[3]).toContain("Next: Borea");
  });

  test("a refused issue read is an error on screen, never a silent zero", async () => {
    stubTauriIpc();
    setProfileId("p-owner");
    reply = (cmd) => {
      if (cmd === "list_projects") return [project()];
      if (cmd === "list_issues") return new Error("not authorized");
      return [];
    };
    const host = await mount();
    const alert = host.querySelector('.error[role="alert"]');
    expect(alert?.textContent).toContain("Open-ticket counts are unavailable");
    expect(host.querySelector(".project-card .pf-open")).toBeNull();
  });
});
