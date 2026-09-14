import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "./router";

// Rendered-DOM proof for the v2 CRM: the pipeline is a board of DEALS, leads and
// customers are ORGANIZATIONS, and a deleted record stays discoverable in trash.
// Nothing is stubbed except the address bar; the view reads and writes the real
// localStorage document through crmStore.

const V1 = [{
  id: "account-1", name: "Optik Nord", website: "", locationCount: 1, employees: "9", labels: ["Messe"], software: "",
  source: "Messe", owner: "Jannes", stage: "Qualified", status: "Aktiv", dealScope: "Betrieb",
  locations: [{
    id: "location-1", name: "Optik Nord · Zentrale", stage: "Qualified", status: "Aktiv", address: "Hauptstr. 1\n20095 Hamburg",
    employees: "9", emails: [], phones: [], nextStep: "Angebot senden", nextStepDate: "2026-10-01", contacts: [],
    notes: [{ id: "n1", title: "Erstkontakt", body: "Interesse", author: "Jannes", createdAt: "2026-09-01T10:00:00.000Z" }],
    activities: [{ id: "a1", kind: "Anruf", title: "Rückruf", dueDate: "2026-09-20", outcome: "", done: false }], files: [],
  }],
}];

let dispose: (() => void) | undefined;
const settle = () => new Promise(done => setTimeout(done, 10));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("gaia.crm.prototype.v1", JSON.stringify(V1));
  registerViews(["Dashboard", "CRM"]);
  // Availability is module-global; another suite narrowing it would silently block
  // navigate() and leave every CRM view showing the board.
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

test("the pipeline renders deals, with the organization named as context", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  const card = host.querySelector(".crm-board .crm-card")!;
  expect(card.querySelector("strong")?.textContent).toBe("Optik Nord");
  expect(card.querySelector(".crm-card-account")?.textContent).toBe("Optik Nord");
  // The v1 board had a "Gewonnen" column; won is a status now, so the board shows
  // open stages only and nothing outside CRM_STAGES.
  const columns = [...host.querySelectorAll(".crm-column > header strong")].map(node => node.textContent);
  expect(columns).toEqual(["Non-Qualified", "Qualified", "Kontakt hergestellt", "Gespräch vereinbart", "Angebot erstellt", "Abgeschlossen"]);
  // Migration ran on read and was written back as a v2 document.
  const stored = JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!);
  expect(stored.version).toBe(2);
  expect(stored.organizations).toHaveLength(1);
  expect(stored.deals).toHaveLength(1);
});

test("the deal panel owns the conversation and the organization panel only summarizes it", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  (host.querySelector(".crm-board .crm-card") as HTMLElement).click();
  await settle();
  const panel = host.querySelector(".crm-detail")!;
  expect(panel.getAttribute("aria-label")).toBe("Deal Optik Nord");
  expect(panel.querySelector(".crm-record-kind")?.textContent).toBe("Deal");
  expect(panel.textContent).toContain("Erstkontakt");      // note migrated onto the deal
  // Next step is deal state, held in a field rather than printed as text.
  expect([...panel.querySelectorAll("input")].map(node => (node as HTMLInputElement).value)).toContain("Angebot senden");
  // The organization behind the deal is one click away and is a DIFFERENT panel.
  (panel.querySelector(".crm-detail-head .crm-link") as HTMLElement).click();
  await settle();
  const orgPanel = host.querySelector(".crm-detail")!;
  expect(orgPanel.getAttribute("aria-label")).toBe("Organisation Optik Nord");
  expect(orgPanel.querySelector(".crm-record-kind")?.textContent).toBe("Organisation");
  expect((orgPanel.querySelector("textarea") as HTMLTextAreaElement).value).toContain("Hauptstr. 1");
});

test("an organization without a win is a lead and can be converted without losing the record", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  expect(host.querySelector(".crm-lead-card strong")?.textContent).toBe("Optik Nord");
  (host.querySelector(".crm-lead-card footer button") as HTMLElement).click();
  await settle();
  const stored = JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!);
  expect(stored.organizations).toHaveLength(1);
  expect(stored.deals).toHaveLength(2);
  expect(stored.deals.filter((deal: any) => deal.organizationId === stored.organizations[0].id)).toHaveLength(2);
});

test("deleting a deal moves it to trash, where it is restorable", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  (host.querySelector(".crm-board .crm-card") as HTMLElement).click();
  await settle();
  const trashButton = host.querySelector("[aria-label='Deal in den Papierkorb']") as HTMLElement;
  trashButton.click();
  await settle();
  expect(host.querySelectorAll(".crm-board .crm-card")).toHaveLength(0);
  navigate({ view: "CRM", tab: "trash" });
  await settle();
  const row = host.querySelector(".crm-trash-row")!;
  expect(row.textContent).toContain("Optik Nord");
  expect(row.textContent).toContain("Deal");
  (row.querySelector("button") as HTMLElement).click();   // Wiederherstellen
  await settle();
  navigate({ view: "CRM", tab: "pipeline" });
  await settle();
  expect(host.querySelectorAll(".crm-board .crm-card")).toHaveLength(1);
});

test("the label filter is one searchable multiselect over the central library", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  (host.querySelector(".crm-labelpicker-trigger") as HTMLElement).click();
  await settle();
  const options = () => [...host.querySelectorAll(".crm-labelpicker-option")].map(node => node.textContent?.trim());
  expect(options()).toEqual(expect.arrayContaining(["Messe", "Heißer Lead", "Warmer Lead", "Kalter Lead"]));
  const search = host.querySelector(".crm-labelpicker-menu input") as HTMLInputElement;
  search.value = "zzz"; search.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  expect(options()).toEqual([]);
  search.value = "mes"; search.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  const checkbox = host.querySelector(".crm-labelpicker-option input") as HTMLInputElement;
  checkbox.click();
  await settle();
  // Filtering by a label the deal carries keeps the card; the trigger reports the count.
  expect(host.querySelector(".crm-labelpicker-trigger")?.textContent).toContain("(1)");
  expect(host.querySelectorAll(".crm-board .crm-card")).toHaveLength(1);
});

test("activities stay deal-owned and appear in one dated feed", async () => {
  navigate({ view: "CRM", tab: "activities" });
  const host = mount();
  await settle();
  const row = host.querySelector(".crm-calendar-row")!;
  expect(row.textContent).toContain("Anruf · Rückruf");
  expect(row.textContent).toContain("Optik Nord");
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
  expect(host.querySelector(".crm-detail")?.getAttribute("aria-label")).toBe("Deal Optik Nord");
});

// The pipeline settings are the ONLY place a win probability is typed: the board
// headings follow the display name, the stored document keeps the stable keys.
test("pipeline settings rename a stage and set its probability; the deal panel only reads it", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  (host.querySelector(".crm-stage-settings-button") as HTMLElement).click();
  await settle();
  const form = host.querySelector(".crm-stage-settings") as HTMLFormElement;
  const name = form.querySelector('input[aria-label="Name der Phase Qualified"]') as HTMLInputElement;
  const percent = form.querySelector('input[aria-label="Wahrscheinlichkeit der Phase Qualified"]') as HTMLInputElement;
  expect(percent.value).toBe("20");
  name.value = "Erstkontakt geprüft"; name.dispatchEvent(new Event("input", { bubbles: true }));
  percent.value = "35"; percent.dispatchEvent(new Event("input", { bubbles: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  const columns = [...host.querySelectorAll(".crm-column > header strong")].map(node => node.textContent);
  expect(columns[1]).toBe("Erstkontakt geprüft");
  expect(host.querySelectorAll(".crm-column > header span")[1]?.textContent).toContain("35%");
  const stored = JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!);
  expect(stored.pipelineStages[1]).toMatchObject({ id: "Qualified", name: "Erstkontakt geprüft", probability: 35 });
  expect(stored.deals[0].stage).toBe("Qualified");   // drag keys untouched by a rename
  expect(stored.deals[0].probability).toBeUndefined(); // no manual per-deal probability
  // The panel states the inherited percentage and offers no editor for it.
  (host.querySelector(".crm-board .crm-card") as HTMLElement).click();
  await settle();
  const panel = host.querySelector(".crm-detail")!;
  expect(panel.querySelector(".crm-readonly-field")?.textContent).toContain("35%");
  expect(panel.querySelector('input[type="number"]')).toBeNull();
});

// ── Aging is visible on the board and spelled out in the deal panel ──────────
const stampDealStage = (daysAgo: number) => {
  const stored = JSON.parse(localStorage.getItem("gaia.crm.prototype.v2") ?? "null");
  stored.deals[0].stageEnteredAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  localStorage.setItem("gaia.crm.prototype.v2", JSON.stringify(stored));
};

test("a pipeline card carries its stage age as a tone and as words", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  mount();
  await settle();          // migration writes the v2 document
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  stampDealStage(19);
  const host = mount();
  await settle();
  const card = host.querySelector(".crm-board .crm-card") as HTMLElement;
  expect(card.dataset.stageAge).toBe("warn");           // subtle accent, no green for fresh
  const age = card.querySelector(".crm-card-age") as HTMLElement;
  expect(age.textContent).toContain("19 Tage in dieser Phase");
  expect(age.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain("19");
});

test("the deal panel shows a read-only stepper with the current phase and its age", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  mount();
  await settle();
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  stampDealStage(44);
  const host = mount();
  await settle();
  (host.querySelector(".crm-board .crm-card") as HTMLElement).click();
  await settle();
  const panel = host.querySelector(".crm-detail")!;
  const steps = [...panel.querySelectorAll(".crm-step")];
  // Display names from the pipeline configuration, one marked current, none clickable.
  expect(steps.map(step => step.querySelector("span")?.textContent)).toEqual([
    "Non-Qualified", "Qualified", "Kontakt hergestellt", "Gespräch vereinbart", "Angebot erstellt", "Abgeschlossen"]);
  expect(steps.map(step => (step as HTMLElement).dataset.state)).toEqual(["done", "current", "todo", "todo", "todo", "todo"]);
  expect(steps.find(step => step.getAttribute("aria-current") === "step")?.textContent).toContain("Qualified");
  expect(panel.querySelector(".crm-stage-progress button, .crm-stepper button, .crm-stepper a")).toBeNull();
  const line = panel.querySelector(".crm-stage-age") as HTMLElement;
  expect(line.textContent).toContain("seit 44 Tagen in dieser Phase");
  expect(line.dataset.stageAge).toBe("stale");
  // Changing the phase stays the PillMenu's job, and it restarts the clock.
  (panel.querySelector(".crm-stage-menu button") as HTMLElement).click();
  await settle();
  const option = [...document.querySelectorAll(".pill-menu-list [role='option']")]
    .find(node => node.textContent?.startsWith("Angebot erstellt")) as HTMLElement;
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
  expect((host.querySelector(".crm-detail .crm-stage-age") as HTMLElement).textContent).toContain("seit 0 Tagen");
  expect(JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!).deals[0].stage).toBe("Angebot erstellt");
});
