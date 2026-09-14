import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "./router";
import { normalize, restoreActivity, softDeleteActivity, activityEntries, trash } from "./crmStore";

// ── SAVING AND DELETING ARE ACTS, NOT SIDE EFFECTS ──────────────────────────────
//
// The CRM used to write every keystroke straight into the document: no record of
// what was changed, no way back, and a panel that looked identical whether it was
// stored or not. This file pins the opposite behaviour:
//
//   · a record's fields are a LOCAL DRAFT — typing changes nothing on disk;
//   · the panel states, permanently, whether what is on screen is stored;
//   · `Speichern` commits everything in one write, `Änderungen verwerfen` puts the
//     stored values back, `In Papierkorb` asks first and stays recoverable;
//   · an activity can be edited and deleted from the row it is read on, and its
//     deletion is recoverable too (the CRM trash, not oblivion).

const ORG = {
  id: "org-1", name: "Optik Nord", website: "optik-nord.de", employees: "9", decisionMaker: "", software: "",
  source: "Messe", owner: "Jannes", labels: [], createdAt: "2026-09-01T10:00:00.000Z", deletedAt: null,
  leadState: "converted", nextStep: "",
  locations: [{ id: "loc-1", name: "Optik Nord · Zentrale", address: "Hauptstr. 1", employees: "9", emails: [], phones: [], contacts: [] }],
};
const DEAL = {
  id: "deal-1", organizationId: "org-1", locationId: null, title: "Optik Nord · Ausstattung", stage: "Qualified", status: "Offen",
  owner: "Jannes", source: "Messe", value: "12000", currency: "EUR", expectedClose: "", labels: [], nextStep: "", nextStepDate: "",
  notes: [], files: [], createdAt: "2026-09-01T10:00:00.000Z", stageEnteredAt: "2026-09-01T10:00:00.000Z", closedAt: null, deletedAt: null,
  activities: [{ id: "act-1", kind: "Anruf", title: "Rückruf Inhaber", dueDate: "2026-09-20", dueTime: "", duration: 30, priority: "Hoch", owner: "Jannes", outcome: "", done: false, doneAt: null, createdAt: "2026-09-01T10:00:00.000Z", deletedAt: null }],
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
  initRouter(createMemoryAdapter("crm/pipeline"));
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; localStorage.clear(); });

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}

const bar = (host: HTMLElement) => host.querySelector(".crm-save-bar")!;
const saveButton = (host: HTMLElement) => host.querySelector(".crm-save-actions .primary") as HTMLButtonElement;
const discardButton = (host: HTMLElement) => host.querySelector(".crm-save-actions .ghost") as HTMLButtonElement;
const field = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll(".crm-detail label")].find(node => node.textContent?.startsWith(label))!.querySelector("input") as HTMLInputElement;
const type = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
const openDeal = async (host: HTMLElement) => { (host.querySelector(".crm-board .crm-card") as HTMLElement).click(); await settle(); };

test("a deal's fields are a draft: nothing is written until Speichern, and the bar says so", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  await openDeal(host);

  // At rest the panel states the stored truth and offers nothing to commit.
  expect(bar(host).getAttribute("data-state")).toBe("saved");
  expect(bar(host).textContent).toContain("Gespeichert");
  expect(saveButton(host).disabled).toBe(true);
  expect(discardButton(host).disabled).toBe(true);

  type(field(host, "Titel"), "Optik Nord · Filialausstattung");
  await settle();
  // Typed, not stored: the document is untouched and the bar names the difference.
  expect(bar(host).getAttribute("data-state")).toBe("dirty");
  expect(bar(host).textContent).toContain("Nicht gespeicherte Änderungen");
  expect(stored().deals[0].title).toBe("Optik Nord · Ausstattung");
  expect(saveButton(host).disabled).toBe(false);

  saveButton(host).click();
  await settle();
  expect(stored().deals[0].title).toBe("Optik Nord · Filialausstattung");
  expect(bar(host).getAttribute("data-state")).toBe("saved");
  expect(bar(host).textContent).toContain("Änderungen gespeichert");
  // The board reads the same document, so the saved title is on the card.
  expect(host.querySelector(".crm-board .crm-card strong")?.textContent).toBe("Optik Nord · Filialausstattung");
});

test("Änderungen verwerfen puts the stored values back, in the form and on disk", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  await openDeal(host);

  type(field(host, "Titel"), "Verworfen");
  type(field(host, "Quelle"), "Irrtum");
  await settle();
  expect(bar(host).getAttribute("data-state")).toBe("dirty");

  discardButton(host).click();
  await settle();
  expect(field(host, "Titel").value).toBe("Optik Nord · Ausstattung");
  expect(field(host, "Quelle").value).toBe("Messe");
  expect(bar(host).getAttribute("data-state")).toBe("saved");
  expect(stored().deals[0].title).toBe("Optik Nord · Ausstattung");
  expect(stored().deals[0].source).toBe("Messe");
});

test("closing a panel with unsaved changes asks instead of dropping them", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  await openDeal(host);
  type(field(host, "Titel"), "Halb getippt");
  await settle();

  (host.querySelector(".crm-detail .crm-back") as HTMLElement).click();
  await settle();
  expect(document.querySelector(".confirm-panel")?.textContent).toContain("nicht gespeicherte Änderungen");
  expect(host.querySelector(".crm-detail")).not.toBeNull();       // still open, nothing lost
  (document.querySelector(".confirm-cancel") as HTMLElement).click();
  await settle();
  expect(field(host, "Titel").value).toBe("Halb getippt");

  saveButton(host).click();
  await settle();
  (host.querySelector(".crm-detail .crm-back") as HTMLElement).click();
  await settle();
  expect(host.querySelector(".crm-detail")).toBeNull();           // saved: closing is silent
  expect(stored().deals[0].title).toBe("Halb getippt");
});

test("the organization panel carries the same bar, and In Papierkorb asks in the product's own dialog", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  await openDeal(host);
  (host.querySelector(".crm-detail-head .crm-link") as HTMLElement).click();   // to the organization
  await settle();
  expect(host.querySelector(".crm-detail")?.getAttribute("aria-label")).toContain("Organisation");

  type(field(host, "Name"), "Optik Nord GmbH");
  await settle();
  expect(stored().organizations[0].name).toBe("Optik Nord");     // still a draft
  saveButton(host).click();
  await settle();
  expect(stored().organizations[0].name).toBe("Optik Nord GmbH");

  (host.querySelector(".crm-save-bar .crm-trash-action") as HTMLElement).click();
  await settle();
  // A named question, not a browser box — and cancelling writes nothing.
  expect(document.querySelector(".confirm-panel")?.textContent).toContain("Optik Nord GmbH");
  (document.querySelector(".confirm-cancel") as HTMLElement).click();
  await settle();
  expect(stored().organizations[0].deletedAt).toBeNull();

  (host.querySelector(".crm-save-bar .crm-trash-action") as HTMLElement).click();
  await settle();
  (document.querySelector(".confirm-danger") as HTMLElement).click();
  await settle();
  expect(stored().organizations[0].deletedAt).toBeTruthy();
  navigate({ view: "CRM", tab: "trash" });
  await settle();
  expect(host.querySelector(".crm-trash-row")?.textContent).toContain("Optik Nord GmbH");
});

test("an activity is edited from its row, saved explicitly, and its delete is recoverable", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  const row = host.querySelector(".crm-activity-row")!;
  (row.querySelector(".crm-activity-actions .crm-row-action") as HTMLElement).click();
  await settle();

  const form = host.querySelector(".crm-activity-composer") as HTMLFormElement;
  expect(form.querySelector("h2")?.textContent).toBe("Aktivität bearbeiten");
  const title = form.querySelector("input") as HTMLInputElement;
  expect(title.value).toBe("Rückruf Inhaber");                   // opened ON this activity
  type(title, "Rückruf Inhaberin");
  const priority = form.querySelector('select[aria-label="Priorität"]') as HTMLSelectElement;
  priority.value = "Niedrig"; priority.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  expect(stored().deals[0].activities[0].title).toBe("Rückruf Inhaber");   // draft only

  expect([...form.querySelectorAll("button")].some(node => node.textContent?.trim() === "Speichern")).toBe(true);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  expect(stored().deals[0].activities[0]).toMatchObject({ id: "act-1", title: "Rückruf Inhaberin", priority: "Niedrig" });
  expect(host.querySelector(".crm-activity-row")?.textContent).toContain("Rückruf Inhaberin");

  // Deleting asks first, then moves the activity to the trash — never destroys it.
  const actions = host.querySelectorAll(".crm-activity-row .crm-activity-actions .crm-row-action");
  (actions[1] as HTMLElement).click();
  await settle();
  expect(document.querySelector(".confirm-panel")?.textContent).toContain("Rückruf Inhaberin");
  (document.querySelector(".confirm-danger") as HTMLElement).click();
  await settle();
  expect(host.querySelectorAll(".crm-activity-row")).toHaveLength(0);
  expect(stored().deals[0].activities[0].deletedAt).toBeTruthy();

  navigate({ view: "CRM", tab: "trash" });
  await settle();
  const trashRow = host.querySelector(".crm-trash-activity")!;
  expect(trashRow.textContent).toContain("Rückruf Inhaberin");
  expect(trashRow.textContent).toContain("Optik Nord · Ausstattung");     // where it goes back to
  (trashRow.querySelector("button") as HTMLElement).click();              // Wiederherstellen
  await settle();
  expect(stored().deals[0].activities[0].deletedAt).toBeNull();
  navigate({ view: "CRM", tab: "activities" });
  await settle();
  expect(host.querySelector(".crm-activity-row")?.textContent).toContain("Rückruf Inhaberin");
});

test("the deal feed edits the same activity with the same editor", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  await openDeal(host);
  const panel = host.querySelector(".crm-detail")!;
  [...panel.querySelectorAll(".crm-tabs button")].find(node => node.textContent === "Aktivitäten")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();

  (panel.querySelector(".crm-activity-edit") as HTMLElement).click();
  await settle();
  const form = host.querySelector(".crm-activity-composer") as HTMLFormElement;
  expect(form.querySelector("h2")?.textContent).toBe("Aktivität bearbeiten");
  type(form.querySelector("input") as HTMLInputElement, "Rückruf nach Messe");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  expect(stored().deals[0].activities[0].title).toBe("Rückruf nach Messe");
  expect(panel.textContent).toContain("Rückruf nach Messe");
});

test("the store deletes an activity recoverably: it leaves every worklist and keeps its home", () => {
  const data = normalize(structuredClone(V2));
  expect(activityEntries(data)).toHaveLength(1);

  softDeleteActivity(data, "act-1");
  expect(activityEntries(data)).toHaveLength(0);              // gone from list, calendar, rollup
  expect(data.deals[0].activities).toHaveLength(1);           // still on its deal
  expect(trash(data).activities[0].deal?.id).toBe("deal-1");  // the trash knows where it returns

  restoreActivity(data, "act-1");
  expect(activityEntries(data)).toHaveLength(1);
  expect(trash(data).activities).toHaveLength(0);
});

test("a document written before the activity trash existed reads back as live work", () => {
  const legacy = structuredClone(V2) as any;
  delete legacy.deals[0].activities[0].deletedAt;
  const data = normalize(legacy);
  expect(data.deals[0].activities[0].deletedAt).toBeNull();
  expect(activityEntries(data)).toHaveLength(1);
});
