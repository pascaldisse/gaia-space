import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "./router";
import { dayKey } from "./crmStore";

// Rendered proof for `#/crm/activities`: one worklist with filters, a month calendar
// drawn by the product (never a native date surface), a composer that can plan work
// with or without a deal, and a completion that is the SAME write the deal panel makes.

const at = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return dayKey(date); };
const ORG = { id: "org-1", name: "Optik Nord", website: "", employees: "9", decisionMaker: "", software: "", source: "", owner: "Jannes", labels: [], locations: [], createdAt: "2026-09-01T10:00:00.000Z", deletedAt: null };
const DEAL = {
  id: "deal-1", organizationId: "org-1", locationId: null, title: "Optik Nord · Ausstattung", stage: "Qualified", status: "Offen",
  owner: "Jannes", source: "", value: "12000", currency: "EUR", expectedClose: "", labels: [], nextStep: "", nextStepDate: "",
  notes: [], files: [], createdAt: "2026-09-01T10:00:00.000Z", stageEnteredAt: "2026-09-01T10:00:00.000Z", closedAt: null, deletedAt: null,
  activities: [
    { id: "act-late", kind: "Anruf", title: "Rückruf Inhaber", dueDate: at(-3), duration: 30, priority: "Hoch", owner: "Jannes", done: false },
    { id: "act-today", kind: "E-Mail", title: "Angebot senden", dueDate: at(0), dueTime: "10:30", duration: 15, priority: "Normal", owner: "Bjarne", done: false },
    { id: "act-done", kind: "Besuch", title: "Filiale besichtigt", dueDate: at(-10), done: true, doneAt: "2026-09-05T09:00:00.000Z" },
  ],
};
const V2 = { version: 2, organizations: [ORG], deals: [DEAL], labels: [], pipelineStages: [], activities: [] };

let dispose: (() => void) | undefined;
const settle = () => new Promise(done => setTimeout(done, 10));
const stored = () => JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("gaia.crm.prototype.v2", JSON.stringify(V2));
  registerViews(["Dashboard", "CRM"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("crm/activities"));
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; localStorage.clear(); });

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}

const rows = (host: HTMLElement) => [...host.querySelectorAll(".crm-activity-row")];
/** The kind filter and the deal link are PillMenus (the product's own list, never the
 *  system popup), so a test drives them the way a person does: open, then choose. */
const pick = async (trigger: Element, label: string) => {
  (trigger.querySelector(".pill-menu-trigger") ?? trigger).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
  const option = [...document.querySelectorAll(".pill-menu-option")].find(node => node.textContent?.includes(label));
  // The menu commits on mousedown (it keeps the focus story its own), not on click.
  option?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
};
const chip = (host: HTMLElement, filter: string) => host.querySelector(`.crm-filter-chip[data-filter="${filter}"]`) as HTMLElement;

test("the list is the default view and states deal, organization, owner, due date, duration and priority", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  expect(host.querySelector(".crm-mode-toggle button.active")?.textContent).toContain("Liste");
  expect(host.querySelector(".crm-activity-table")).not.toBeNull();
  // To-do is the resting filter: the two open activities, not the completed one.
  expect(rows(host)).toHaveLength(2);
  const first = rows(host)[0];                      // sorted by due day, the late call leads
  expect(first.querySelector(".crm-activity-subject strong")?.textContent).toBe("Rückruf Inhaber");
  expect(first.getAttribute("data-state")).toBe("overdue");
  expect(first.textContent).toContain("Anruf");
  expect(first.textContent).toContain("Optik Nord · Ausstattung");   // the linked deal
  expect(first.textContent).toContain("Optik Nord");                 // the organization
  expect(first.textContent).toContain("Jannes");                     // responsible person
  expect(first.textContent).toContain("30 Min.");                    // duration
  expect(first.querySelector(".crm-priority")?.textContent).toBe("Hoch");
  expect(rows(host)[1].textContent).toContain("10:30");
});

test("the filters narrow the one list and each carries its own count", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  expect(chip(host, "todo").textContent).toContain("2");
  expect(chip(host, "overdue").textContent).toContain("1");
  expect(chip(host, "today").textContent).toContain("1");
  expect(chip(host, "done").textContent).toContain("1");

  chip(host, "overdue").click();
  await settle();
  expect(rows(host).map(row => row.querySelector("strong")?.textContent)).toEqual(["Rückruf Inhaber"]);

  chip(host, "all").click();
  await settle();
  expect(rows(host)).toHaveLength(3);

  // The type filter cuts across every state filter.
  await pick(host.querySelector(".crm-kind-filter")!, "E-Mail");
  expect(rows(host).map(row => row.querySelector("strong")?.textContent)).toEqual(["Angebot senden"]);
});

test("completing from the list writes the deal's activity and the deal feed shows it", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  const box = rows(host)[0].querySelector("input[type=checkbox]") as HTMLInputElement;
  box.click();
  await settle();
  const activity = stored().deals[0].activities.find((item: any) => item.id === "act-late");
  expect(activity.done).toBe(true);
  expect(activity.doneAt).toBeTruthy();
  expect(rows(host)).toHaveLength(1);                       // it left the To-do list
  expect(chip(host, "done").textContent).toContain("2");

  // The detail feed is the same state, not a second copy of it.
  (rows(host)[0].querySelector(".crm-link") as HTMLElement).click();
  await settle();
  const panel = host.querySelector(".crm-detail")!;
  [...panel.querySelectorAll(".crm-tabs button")].find(node => node.textContent === "Aktivitäten")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
  const feedRow = [...panel.querySelectorAll(".crm-activity")].find(node => node.textContent?.includes("Rückruf Inhaber"))!;
  expect((feedRow.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
  expect(feedRow.textContent).toContain("Erledigt");
});

test("the calendar is the product's own month grid and puts activities on their day", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  ([...host.querySelectorAll(".crm-mode-toggle button")].find(node => node.textContent?.includes("Kalender")) as HTMLElement).click();
  await settle();
  expect(host.querySelector(".crm-activity-table")).toBeNull();
  expect(host.querySelector(".crm-calendar-month")).not.toBeNull();
  // No native date UI anywhere on this surface.
  expect(host.querySelector("input[type=date]")).toBeNull();
  expect(host.querySelectorAll(".crm-month-cell")).toHaveLength(42);

  const todayCell = host.querySelector(`.crm-month-cell[data-day="${at(0)}"]`)!;
  expect(todayCell.querySelector(".crm-month-entry")?.textContent).toContain("Angebot senden");
  const lateCell = host.querySelector(`.crm-month-cell[data-day="${at(-3)}"]`);
  expect(lateCell?.querySelector(".crm-month-entry")?.getAttribute("data-state")).toBe("overdue");

  // Today is the resting selection, and its agenda can complete the work.
  const agenda = host.querySelector(".crm-month-agenda")!;
  expect(agenda.textContent).toContain("Angebot senden");
  (agenda.querySelector(".crm-agenda-row input[type=checkbox]") as HTMLInputElement).click();
  await settle();
  expect(stored().deals[0].activities.find((item: any) => item.id === "act-today").done).toBe(true);
});

test("the composer plans work with a deal, and without one it lands in the inbox and can be linked", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  (host.querySelector(".crm-new-activity") as HTMLElement).click();
  await settle();
  const form = host.querySelector(".crm-activity-composer") as HTMLFormElement;
  // A type is chosen in the product's own control, a date in the product's own field.
  ([...form.querySelectorAll(".crm-composer-kinds button")].find(node => node.textContent?.includes("Video-Call")) as HTMLElement).click();
  const subject = form.querySelector("input") as HTMLInputElement;
  subject.value = "Demo-Termin"; subject.dispatchEvent(new Event("input", { bubbles: true }));
  const time = form.querySelector('select[aria-label="Uhrzeit"]') as HTMLSelectElement;
  time.value = "09:30"; time.dispatchEvent(new Event("change", { bubbles: true }));
  expect(form.querySelector("input[type=date]")).toBeNull();
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  // No deal chosen: the activity is in the inbox, and the model stays deal-owned.
  expect(stored().activities).toHaveLength(1);
  expect(stored().activities[0]).toMatchObject({ kind: "Video-Call", title: "Demo-Termin", dueTime: "09:30", duration: 30 });
  expect(stored().deals[0].activities).toHaveLength(3);

  const row = rows(host).find(node => node.textContent?.includes("Demo-Termin"))!;
  const link = row.querySelector(".crm-activity-link")!;
  expect(link).not.toBeNull();
  await pick(link, "Optik Nord · Ausstattung");
  expect(stored().activities).toHaveLength(0);                      // moved, not copied
  expect(stored().deals[0].activities.map((item: any) => item.title)).toContain("Demo-Termin");

  // Planning FROM a calendar day carries that day into the composer.
  ([...host.querySelectorAll(".crm-mode-toggle button")].find(node => node.textContent?.includes("Kalender")) as HTMLElement).click();
  await settle();
  const cell = host.querySelector(`.crm-month-cell[data-day="${at(2)}"]`)!;
  (cell.querySelector(".crm-month-add") as HTMLElement).click();
  await settle();
  const second = host.querySelector(".crm-activity-composer") as HTMLFormElement;
  const title = second.querySelector("input") as HTMLInputElement;
  title.value = "Nachfassen"; title.dispatchEvent(new Event("input", { bubbles: true }));
  const deal = second.querySelector('select[aria-label="Verknüpfter Deal"]') as HTMLSelectElement;
  deal.value = "deal-1"; deal.dispatchEvent(new Event("change", { bubbles: true }));
  second.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  const planned = stored().deals[0].activities.find((item: any) => item.title === "Nachfassen");
  expect(planned.dueDate).toBe(at(2));
});
