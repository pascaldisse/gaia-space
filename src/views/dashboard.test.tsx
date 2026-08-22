import { afterEach, describe, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import { invoke } from "../api/invoke";
import { dateKey } from "../calendar";
import { setProfileId } from "../session";

mock.module("@tauri-apps/api/core", () => ({ invoke }));
import Dashboard from "./Dashboard";

const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
let reply: (command: string) => unknown = () => [];
let dispose: (() => void) | undefined;

const stubTauriIpc = () => {
  window.__TAURI_INTERNALS__ = {
    invoke: (command, args) => {
      calls.push({ command, args });
      const result = reply(command);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
};
const settle = () => new Promise((done) => setTimeout(done, 40));
const today = () => dateKey(new Date());
const dashboard = (over: Record<string, unknown> = {}) => ({
  open_todos: [], assigned_issues: [], meeting_occurrences: [],
  unread_notifications: [], current_absences: [], ...over,
});
const calendarItem = (over: Record<string, unknown> = {}) => ({
  id: "task-1", source_id: "task-1", kind: "task", title: "Ship overview",
  starts_at: Math.floor(new Date(`${today()}T00:00:00`).getTime() / 1000),
  ends_at: null, project_id: null, date: today(), ...over,
});

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Dashboard /> as any, host);
  await settle();
  return host;
}

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  calls.length = 0;
  reply = () => [];
  delete window.__TAURI_INTERNALS__;
  setProfileId("");
});

describe("dashboard", () => {
  test("shows empty widget states rather than blank cards", async () => {
    stubTauriIpc();
    setProfileId("me");
    reply = (command) => {
      if (command === "dashboard_aggregate") return dashboard();
      if (command === "calendar_aggregate") return [];
      if (command === "list_profiles") return [{ id: "me", username: "me", display_name: "Me", archived: false }];
      return [];
    };
    const host = await mount();
    expect(host.textContent).toContain("No open tasks.");
    expect(host.textContent).toContain("No upcoming deadlines.");
    expect(host.textContent).toContain("No upcoming meetings.");
    expect(host.textContent).toContain("No issues assigned to you yet.");
    expect(host.textContent).toContain("Your inbox is clear.");
    expect(host.textContent).toContain("Nobody is away right now.");
  });

  test("completion refreshes both dashboard sources and reports a failed write", async () => {
    stubTauriIpc();
    setProfileId("me");
    let rejectCompletion = true;
    reply = (command) => {
      if (command === "dashboard_aggregate") return dashboard({ open_todos: [{ id: "todo-1", profile_id: "me", content: "Close release", due_date: null, project_id: null, done: false, source_entity_type: null, source_entity_id: null, notes: null, assignee_ids: [] }] });
      if (command === "calendar_aggregate") return [calendarItem()];
      if (command === "list_profiles") return [{ id: "me", username: "me", display_name: "Me", archived: false }];
      if (command === "set_todo_completion") return rejectCompletion ? new Error("write denied") : {};
      return [];
    };
    const host = await mount();
    const check = host.querySelector<HTMLInputElement>(".tn-check-box")!;
    check.click();
    await settle();
    expect(calls.some((call) => call.command === "set_todo_completion")).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("write denied");

    rejectCompletion = false;
    check.click();
    await settle();
    expect(calls.filter((call) => call.command === "dashboard_aggregate").length).toBeGreaterThan(1);
    expect(calls.filter((call) => call.command === "calendar_aggregate").length).toBeGreaterThan(1);
  });

  test("picking a mini-calendar day turns the side panel into that day agenda", async () => {
    stubTauriIpc();
    setProfileId("me");
    reply = (command) => {
      if (command === "dashboard_aggregate") return dashboard();
      if (command === "calendar_aggregate") return [calendarItem()];
      if (command === "list_profiles") return [{ id: "me", username: "me", display_name: "Me", archived: false }];
      return [];
    };
    const host = await mount();
    const day = [...host.querySelectorAll<HTMLButtonElement>(".mini-days button")]
      .find((button) => button.textContent?.includes("Ship overview"));
    expect(day).toBeDefined();
    day!.click();
    await settle();
    expect(host.querySelector(".co-agenda")?.textContent).toContain("Selected day");
    expect(host.querySelector(".co-agenda")?.textContent).toContain("Ship overview");
  });
});
