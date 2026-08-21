import { expect, test, describe, afterEach, mock } from "bun:test";
// Same redirect the web build applies through a Vite alias: `@tauri-apps/api/core`
// resolves to the HTTP command bridge, so this test drives the real web path.
import { invoke } from "./api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Calendar from "./views/Calendar";
import { setProfileId } from "./session";
import { dateKey } from "./calendar";

// Rendered-DOM proof for the calendar day agenda. Nothing in the app is mocked:
// the view calls the real personalApi -> invoke path, and only the HTTP transport
// at the very edge is replaced, so the command names and argument shape asserted
// here are the ones the server actually receives.

type Reply = { ok: boolean; value?: unknown; error?: string; hang?: boolean };
const calls: { cmd: string; args: any }[] = [];
let replies: Record<string, Reply> = {};
const realFetch = globalThis.fetch;

const stubFetch = () => {
  globalThis.fetch = (async (url: any, init: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    const args = init?.body ? JSON.parse(init.body) : {};
    calls.push({ cmd, args });
    const reply = replies[cmd] ?? { ok: true, value: [] };
    if (reply.hang) return await new Promise(() => {});
    return new Response(JSON.stringify(reply.ok ? { ok: true, value: reply.value } : { ok: false, error: reply.error }), { status: reply.ok ? 200 : 500, headers: { "content-type": "application/json" } });
  }) as any;
};

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; replies = {}; globalThis.fetch = realFetch; });

const mount = () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Calendar /> as any, host);
  return host;
};
const unmount = (host: HTMLElement) => { const off = dispose; dispose = undefined; off?.(); host.remove(); };
const settle = () => new Promise((done) => setTimeout(done, 30));

describe("calendar day agenda", () => {
  test("loading, failure and empty are three distinct answers", async () => {
    stubFetch();
    setProfileId("pa");
    replies = { calendar_aggregate: { ok: true, hang: true } };
    let host = mount();
    await settle();
    expect(host.querySelector(".cal-loading")?.textContent).toContain("Loading");
    expect(host.querySelector(".cal-side-empty")).toBeNull();
    unmount(host);

    replies = { calendar_aggregate: { ok: false, error: "calendar unavailable" } };
    host = mount();
    await settle();
    const alert = host.querySelector(".calendar-side [role=alert]");
    expect(alert?.textContent).toContain("could not be loaded");
    expect(host.querySelector(".cal-side-empty")).toBeNull();
    unmount(host);

    replies = { calendar_aggregate: { ok: true, value: [] } };
    host = mount();
    await settle();
    expect(host.querySelector(".cal-side-empty")?.textContent).toContain("Nothing scheduled");
    expect(host.querySelector(".calendar-side [role=alert]")).toBeNull();
  });

  test("the day window is requested as local day keys and typed items land on their own day", async () => {
    stubFetch();
    setProfileId("pa");
    const today = new Date();
    const key = dateKey(today);
    replies = { calendar_aggregate: { ok: true, value: [
      { id: "m1", kind: "meeting", title: "Standup", starts_at: Math.floor(today.getTime() / 1000), ends_at: Math.floor(today.getTime() / 1000) + 3600, project_id: null, date: null },
      { id: "t1", kind: "task", title: "Ship it", starts_at: 0, ends_at: null, project_id: null, date: key },
      { id: "deadline-p1", kind: "deadline", title: "Project deadline", starts_at: 0, ends_at: null, project_id: "p1", date: key },
    ] } };
    const host = mount();
    await settle();
    const request = calls.find((c) => c.cmd === "calendar_aggregate");
    expect(request?.args.rangeStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(request?.args.rangeEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const agenda = [...host.querySelectorAll(".cal-agenda li")];
    expect(agenda.map((li) => li.className.split(" ")[0]).sort()).toEqual(["deadline", "meeting", "task"]);
    // Every agenda item leaves through a real anchor, never a click handler on a div.
    for (const li of agenda) expect(li.querySelector("a")?.getAttribute("href")).toBeTruthy();
    // The typed legend names all three kinds.
    expect(host.querySelector(".calendar-legend")?.textContent).toBe("MeetingTaskDeadline");
  });

  test("quick create offers a meeting, a task and a deadline form on the chosen day", async () => {
    stubFetch();
    setProfileId("pa");
    replies = { calendar_aggregate: { ok: true, value: [] }, list_projects: { ok: true, value: [{ id: "p1", name: "Apollo", key: "AP", description: null, created_by: "pa", archived: false, deadline: null }] } };
    const host = mount();
    await settle();
    (host.querySelector(".cal-side-add") as HTMLButtonElement).click();
    await settle();
    const tabs = [...host.querySelectorAll(".calendar-kind-picker button")] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(["Meeting", "Task", "Deadline"]);
    expect(host.querySelector("form[aria-label='New meeting']")).toBeTruthy();
    tabs[1].click();
    await settle();
    expect(host.querySelector("form[aria-label='New task']")).toBeTruthy();
    tabs[2].click();
    await settle();
    const deadlineForm = host.querySelector("form[aria-label='New project deadline']");
    expect(deadlineForm).toBeTruthy();
    // Only projects without a deadline that the session owns are offered.
    expect([...deadlineForm!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Select a project…", "Apollo"]);
  });

  test("a deadline is written with the narrow command, never a whole project payload", async () => {
    stubFetch();
    setProfileId("pa");
    replies = { calendar_aggregate: { ok: true, value: [] }, list_projects: { ok: true, value: [{ id: "p1", name: "Apollo", key: "AP", description: null, created_by: "pa", archived: false, deadline: null }] }, set_project_deadline: { ok: true, value: { id: "p1", name: "Apollo", key: "AP", description: null, created_by: "pa", archived: false, deadline: "2030-03-10" } } };
    const host = mount();
    await settle();
    (host.querySelector(".cal-side-add") as HTMLButtonElement).click();
    await settle();
    ([...host.querySelectorAll(".calendar-kind-picker button")][2] as HTMLButtonElement).click();
    await settle();
    const select = host.querySelector("form[aria-label='New project deadline'] select") as HTMLSelectElement;
    select.value = "p1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    (host.querySelector("form[aria-label='New project deadline']") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    const write = calls.find((c) => c.cmd === "set_project_deadline");
    expect(write, `commands seen: ${calls.map((c) => c.cmd).join(",")}`).toBeTruthy();
    // Narrow payload: id + date only. `actorProfileId` is the desktop identity
    // slot and stays null in web mode, where the session mints the actor.
    expect(Object.keys(write!.args).sort()).toEqual(["actorProfileId", "deadline", "projectId"]);
    expect(write!.args.actorProfileId).toBeNull();
    expect(write!.args.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls.some((c) => c.cmd === "update_project")).toBe(false);
    expect(host.querySelector("[role=status]")?.textContent).toContain("Deadline set");
  });

  test("an invalid meeting time is shown, and no meeting is created", async () => {
    stubFetch();
    setProfileId("pa");
    replies = { calendar_aggregate: { ok: true, value: [] } };
    const host = mount();
    await settle();
    (host.querySelector(".cal-side-add") as HTMLButtonElement).click();
    await settle();
    const form = host.querySelector("form[aria-label='New meeting']") as HTMLFormElement;
    const title = form.querySelector("input") as HTMLInputElement;
    title.value = "Sync";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const end = form.querySelectorAll("input[type=datetime-local]")[1] as HTMLInputElement;
    const start = form.querySelectorAll("input[type=datetime-local]")[0] as HTMLInputElement;
    end.value = start.value;
    end.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(host.querySelector(".calendar-error")?.textContent).toContain("end after it starts");
    expect(calls.some((c) => c.cmd === "create_meeting")).toBe(false);
  });
});
