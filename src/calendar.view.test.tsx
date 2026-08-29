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
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; replies = {}; globalThis.fetch = realFetch; setProfileId(""); });

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
    // The typed legend still names all three kinds — it moved out from under the
    // h1 into the View options popover (a lookup table is read once, so it does
    // not hold a permanent line), and it is reachable and complete there.
    expect(host.querySelector(".calendar-legend")).toBeNull();
    const viewOptions = host.querySelector(".cal-viewopts button") as HTMLButtonElement;
    expect(viewOptions.getAttribute("aria-expanded")).toBe("false");
    viewOptions.click();
    await settle();
    expect(viewOptions.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".cal-viewopts-menu")?.getAttribute("role")).toBe("dialog");
    expect(host.querySelector(".calendar-legend")?.textContent).toBe("MeetingTaskDeadline");
  });

  test("the filters are named pills at the far end of the action row, not captioned fields in a card", async () => {
    stubFetch();
    setProfileId("pa");
    const today = new Date();
    replies = { calendar_aggregate: { ok: true, value: [] }, list_meetings: { ok: true, value: [
      { id: "m1", title: "Standup", description: null, starts_at: Math.floor(today.getTime() / 1000), ends_at: Math.floor(today.getTime() / 1000) + 3600, rrule: null, location: "Berlin HQ", organizer_id: "pa", channel_id: null, visibility: "participants", modification_preference: "organizer-only", archived: false, video_provider: null, video_room_id: null, join_url: null, video_status: "scheduled", video_started_at: null, video_ended_at: null, video_ended_by: null, source_entity_type: null, source_entity_id: null },
    ] } };
    const host = mount();
    await settle();
    // The card of captioned fields is gone in every theme, not merely restyled.
    expect(host.querySelector(".calendar-filters")).toBeNull();
    expect(host.querySelector(".calendar-filter")).toBeNull();
    // Both filters CHANGE WHAT YOU SEE, so since the shared action row they live at
    // its far end (`.actionbar-view-controls`), not in the header's top-right corner.
    // They keep an accessible name, with the VALUE as the visible label.
    const actions = host.querySelector(".page-actionbar > .actionbar-view-controls")!;
    expect(actions).toBeTruthy();
    // The creation act is the row's primary, on the left, outside the view controls.
    const create = host.querySelector(".page-actionbar > button.primary") as HTMLButtonElement;
    expect(create?.textContent).toBe("New meeting");
    /* ADDRESS ONLY (picker pass): these filters are PillMenus now, not native
       selects. A `<select>`'s OPEN state belongs to the operating system — grey
       system rows in a layer no CSS reaches — so the product's own filters looked
       redesigned until they were clicked. The control is a named button that opens
       a listbox we draw; the keyboard contract is covered by
       controls.pillmenu.test.tsx. */
    const location = actions.querySelector("button[aria-label='Location calendar']") as HTMLButtonElement;
    expect(actions.querySelector("button[aria-label='Member calendar']")).toBeTruthy();
    expect(location).toBeTruthy();
    location.click();
    await settle();
    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(["All locations", "Berlin HQ"]);
    location.click();
    await settle();
    // A caption above a filter is what was removed; none may come back.
    for (const label of actions.querySelectorAll("label")) expect(label.textContent?.trim()).toBe("");
  });

  test("all four view modes switch, and the pill that is chosen is the pill that is marked", async () => {
    stubFetch();
    setProfileId("pa");
    replies = { calendar_aggregate: { ok: true, value: [] } };
    const host = mount();
    await settle();
    const pill = (label: string) => [...host.querySelectorAll(".cal-viewtoggle button")].find((button) => button.textContent === label) as HTMLButtonElement;
    const marked = () => [...host.querySelectorAll(".cal-viewtoggle button")].filter((button) => button.classList.contains("active")).map((button) => button.textContent);
    expect(marked()).toEqual(["Month"]);
    for (const [label, grid] of [["Week", "week"], ["Day", "day"]] as const) {
      pill(label).click();
      await settle();
      // Exactly one pill is marked, it is the one that was pressed, and the grid
      // actually changed shape with it.
      expect(marked()).toEqual([label]);
      expect(pill(label).getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector(".calendar-grid")?.classList.contains(grid)).toBe(true);
    }
    pill("Schedule").click();
    await settle();
    expect(marked()).toEqual(["Schedule"]);
    expect(host.querySelector(".cal-schedule")).toBeTruthy();
    expect(host.querySelector(".calendar-grid")).toBeNull();
    pill("Month").click();
    await settle();
    expect(marked()).toEqual(["Month"]);
    // The range navigation keeps its names and moves the cursor by the mode's span.
    const heading = () => host.querySelector(".cal-toolbar strong")?.textContent;
    const before = heading();
    (host.querySelector("button[aria-label='Next range']") as HTMLButtonElement).click();
    await settle();
    expect(heading()).not.toBe(before);
    (host.querySelector(".cal-toolbar .ghost-pill") as HTMLButtonElement).click();
    await settle();
    expect(heading()).toBe(before);
  });

  test("calendar filter keeps local items and hides external items from other calendars", async () => {
stubFetch();
setProfileId("pa");
const today = new Date(); const key = dateKey(today);
replies = { calendar_aggregate: { ok: true, value: [
{ id: "local", source_id: "local", kind: "task", title: "Local", starts_at: 0, ends_at: null, project_id: null, calendar_id: null, date: key },
{ id: "work", source_id: "work", kind: "external", title: "Work event", starts_at: 0, ends_at: null, project_id: null, calendar_id: "work", date: key },
{ id: "personal", source_id: "personal", kind: "external", title: "Personal event", starts_at: 0, ends_at: null, project_id: null, calendar_id: "personal", date: key },
] }, list_calendars: { ok: true, value: [{ id: "work", profile_id: "pa", name: "Work", color: "#2563eb", visible: true }, { id: "personal", profile_id: "pa", name: "Personal", color: "#2563eb", visible: true }] } };
const host = mount(); await settle();
/* ADDRESS ONLY (picker pass): a PillMenu is chosen by clicking the option we draw,
   not by writing a value into a native select. What is under test is unchanged —
   choosing "Work" hides the other calendar's events and keeps the local ones. */
const filter = host.querySelector("button[aria-label='Calendar filter']") as HTMLButtonElement;
expect(filter).toBeTruthy();
filter.click(); await settle();
/* A PillMenu commits on MOUSEDOWN, not click: it keeps the focus story its own
   (see controls.tsx), which a bare .click() would skip. */
([...document.querySelectorAll('[role="option"]')].find(option => option.textContent === "Work") as HTMLElement)
  .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
await settle();
expect(host.querySelector(".cal-agenda")?.textContent).toContain("Local");
expect(host.querySelector(".cal-agenda")?.textContent).toContain("Work event");
expect(host.querySelector(".cal-agenda")?.textContent).not.toContain("Personal event");
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
    /* ADDRESS ONLY (date-field pass): an instant is two halves now — the day is chosen in
       the product's own month grid (components/DateField.tsx), the clock stays a time input.
       Both quick-create times sit on the SAME day, so making the end equal the start is done
       where it always was: on the clock. The draft still carries `YYYY-MM-DDTHH:mm`, and
       meetingDraftError is the same judge of it. */
    const clocks = form.querySelectorAll<HTMLInputElement>("input.date-time-clock");
    const [start, end] = [clocks[0], clocks[1]];
    end.value = start.value;
    end.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(host.querySelector(".calendar-error")?.textContent).toContain("end after it starts");
    expect(calls.some((c) => c.cmd === "create_meeting")).toBe(false);
  });
});

// A MEETING HAPPENS ON SOMEBODY ELSE'S SERVICE. The calendar's detail pane edits the
// same external link the Meetings list edits, and shows the same way in — one control,
// shared (views/Meetings.tsx `JoinLink`), so the act cannot drift into two behaviours.
// Nothing is drawn without a valid link: a Join that leads nowhere is worse than none.
describe("the calendar's meeting detail carries the way into the meeting", () => {
  const meetingAt = (url: string | null) => {
    const start = Math.floor(Date.now() / 1000) + 3600;
    return {
      id: "m-link", title: "Design review", description: null, starts_at: start, ends_at: start + 1800,
      rrule: null, location: null, organizer_id: "pa", channel_id: null, visibility: "participants",
      modification_preference: "organizer-only", archived: false, video_provider: null, video_room_id: null,
      join_url: null, meeting_url: url, video_status: "scheduled", video_started_at: null, video_ended_at: null,
      video_ended_by: null, source_entity_type: null, source_entity_id: null,
    };
  };

  const openDetail = async (url: string | null) => {
    stubFetch();
    setProfileId("pa");
    const meeting = meetingAt(url);
    replies = {
      list_meetings: { ok: true, value: [meeting] },
      calendar_aggregate: { ok: true, value: [{
        id: meeting.id, source_id: meeting.id, kind: "meeting", title: meeting.title,
        starts_at: meeting.starts_at, ends_at: meeting.ends_at, project_id: null, calendar_id: null,
        date: dateKey(new Date(meeting.starts_at * 1000)),
      }] },
    };
    const host = mount();
    await settle();
    const entry = [...host.querySelectorAll("button, a")].find((element) => element.textContent?.includes("Design review")) as HTMLElement;
    entry?.click();
    await settle();
    return host;
  };

  test("the link is editable, and Join appears only once there is one", async () => {
    let host = await openDetail(null);
    const field = host.querySelector('input[aria-label="Meeting link"]') as HTMLInputElement;
    expect(field).not.toBeNull();
    expect(field.value).toBe("");
    // No link, no way in — and no button pretending there is one.
    expect([...host.querySelectorAll("button, a")].some((element) => element.textContent?.trim() === "Join")).toBe(false);
    unmount(host);

    host = await openDetail("https://meet.google.com/abc-defg-hij");
    expect((host.querySelector('input[aria-label="Meeting link"]') as HTMLInputElement).value)
      .toBe("https://meet.google.com/abc-defg-hij");
    expect([...host.querySelectorAll("button, a")].some((element) => element.textContent?.trim() === "Join")).toBe(true);
  });
});
