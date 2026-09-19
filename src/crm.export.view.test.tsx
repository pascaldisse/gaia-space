import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "./router";
import { CSV_BOM, EXPORT_SCHEMA } from "./crmExport";
import { addActivity, closeDeal, convertToDeal, createOrganization, defaultPipelineStages, normalize, type CrmData } from "./crmStore";

// Rendered-DOM proof for the export: the action exists on EVERY CRM tab, the dialog
// counts what it will write, and pressing it hands real files to the machine's download
// — the blob contents are read back here. Nothing is uploaded; there is no network in
// this test and none in the code path it drives.

let dispose: (() => void) | undefined;
const settle = (ms = 25) => new Promise(done => setTimeout(done, ms));

/** Captured downloads: the anchor's file name and the blob it was handed. */
type Saved = { name: string; blob: Blob };
let captured: Saved[] = [];
let saved: Array<{ name: string; content: string }> = [];
/** The files as the machine received them — names from the anchor, bytes from the blob. */
const collect = async () => {
  saved = await Promise.all(captured.map(async item => ({ name: item.name, content: await item.blob.text() })));
  return saved;
};
let realCreate: typeof URL.createObjectURL;
let clicks: (event: Event) => void;

function seedDocument() {
  const data: CrmData = { version: 2, organizations: [], deals: [], labels: [], pipelineStages: defaultPipelineStages(), activities: [] };
  const customer = createOrganization(data, {
    name: 'Optik "Sonne"; Nord GmbH', source: "Messe", owner: "Jannes",
    address: "Hauptstr. 1\n20095 Hamburg", email: "info@sonne-nord.de", contactName: "Ida Nord", contactRole: "Inhaberin",
  });
  const deal = convertToDeal(data, customer.id, "Angebot erstellt", { title: "Filialausstattung", value: "12500" })!;
  addActivity(data, deal.id, { kind: "Anruf", title: "Rückruf; dringend", dueDate: "2026-03-04" });
  closeDeal(data, deal.id, "Gewonnen");
  createOrganization(data, { name: "Sehzentrum Süd", source: "Website" });
  localStorage.setItem("gaia.crm.prototype.v2", JSON.stringify(normalize(data)));
}

beforeEach(() => {
  localStorage.clear();
  seedDocument();
  captured = []; saved = [];
  realCreate = URL.createObjectURL;
  // The blob never reaches a disk here, so it is intercepted where it is made and
  // matched to the anchor that carries the file name.
  const pending: Blob[] = [];
  (URL as any).createObjectURL = (blob: Blob) => { pending.push(blob); return `blob:crm/${pending.length}`; };
  (URL as any).revokeObjectURL = () => {};
  clicks = (event: Event) => {
    const anchor = (event.target as HTMLElement)?.closest?.("a[download]") as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    const index = Number(anchor.href.split("/").pop()) - 1;
    captured.push({ name: anchor.download, blob: pending[index] });
  };
  document.addEventListener("click", clicks, true);
  registerViews(["Dashboard", "CRM"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("crm/pipeline"));
});
afterEach(() => {
  document.removeEventListener("click", clicks, true);
  URL.createObjectURL = realCreate;
  dispose?.(); dispose = undefined; document.body.innerHTML = ""; localStorage.clear();
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}
const trigger = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".crm-toolbar button")].find(node => node.textContent?.includes("Exportieren"));
const openExport = async (host: HTMLElement) => { trigger(host)!.click(); await settle(); };
const dialog = () => document.querySelector<HTMLElement>(".crm-export")!;
const scopeRow = (name: string) => dialog().querySelector<HTMLElement>(`[data-export-scope="${name}"]`)!;
const formatRow = (name: string) => dialog().querySelector<HTMLElement>(`[data-export-format="${name}"]`)!;
const checkbox = (element: HTMLElement) => element.querySelector<HTMLInputElement>("input")!;
const setChecked = async (input: HTMLInputElement, on: boolean) => { input.checked = on; input.dispatchEvent(new Event("change", { bubbles: true })); await settle(); };
const exportButton = () => [...dialog().querySelectorAll<HTMLButtonElement>("footer button")].find(node => node.textContent?.includes("exportieren"))!;

test("Exportieren is offered on every CRM tab, not only where records are listed", async () => {
  const host = mount();
  await settle();
  for (const tab of ["pipeline", "leads", "customers", "activities", "insights", "trash"]) {
    navigate({ view: "CRM", tab });
    await settle();
    expect(trigger(host), `Exportieren fehlt auf #/crm/${tab}`).toBeTruthy();
  }
});

test("the dialog states the scope, its record counts and what will be written", async () => {
  const host = mount();
  await settle();
  await openExport(host);

  // "Alle Daten" is the resting choice: portability first.
  expect(scopeRow("all").dataset.active).toBe("true");
  expect(dialog().querySelector(".crm-export-summary")!.textContent).toContain("2 Organisationen");
  expect(dialog().querySelector(".crm-export-summary")!.textContent).toContain("1 Deal ");
  expect(dialog().querySelector(".crm-export-summary")!.textContent).toContain("1 Aktivität");
  // Nothing is uploaded, and the dialog says so before anything is clicked.
  expect(dialog().textContent).toContain("lokal in diesem Fenster");

  // A scope with no deals cannot download an empty deal table.
  await setChecked(checkbox(scopeRow("leads")), true);
  expect(formatRow("deals").dataset.empty).toBe("true");
  expect(checkbox(formatRow("deals")).disabled).toBe(true);
  expect(formatRow("organizations").querySelector(".crm-export-count")!.textContent).toContain("1 Zeile");
});

test("the backup downloads as versioned JSON that reads back as the CRM document", async () => {
  const host = mount();
  await settle();
  await openExport(host);
  expect(exportButton().textContent).toContain("1 Datei exportieren");
  exportButton().click();
  await settle();
  await collect();

  expect(saved).toHaveLength(1);
  expect(saved[0].name).toMatch(/^crm-sicherung-alle-daten-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const backup = JSON.parse(saved[0].content);
  expect(backup.schema).toBe(EXPORT_SCHEMA);
  expect(backup.schemaVersion).toBe(1);
  expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(backup.counts.organizations).toBe(2);
  // Lossless: the exported payload normalizes to the very document on disk.
  expect(normalize(backup.data)).toEqual(normalize(JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!)));
  expect(dialog().querySelector(".crm-export-result")!.textContent).toContain("1 Datei erzeugt");
});

test("the CSV tables download separately and open in German Excel", async () => {
  const host = mount();
  await settle();
  await openExport(host);
  await setChecked(checkbox(formatRow("json")), false);
  for (const format of ["organizations", "contacts", "deals", "activities"]) await setChecked(checkbox(formatRow(format)), true);
  expect(exportButton().textContent).toContain("4 Dateien exportieren");
  exportButton().click();
  await settle();
  await collect();

  expect(saved.map(file => file.name.split("-")[1])).toEqual(["organisationen", "kontakte", "deals", "aktivitaeten"]);
  expect(saved.every(file => file.name.endsWith(".csv"))).toBe(true);
  for (const file of saved) expect(file.content.startsWith(CSV_BOM)).toBe(true);

  const orgs = saved[0].content.slice(1).trim().split("\r\n");
  expect(orgs[0].split(";")[1]).toBe("Name");
  expect(orgs).toHaveLength(3);
  // The semicolon and the quotes inside the company name survive the separator: the
  // name is ONE cell, quoted and doubled, not two columns.
  expect(orgs.some(row => row.includes('"Optik ""Sonne""; Nord GmbH"'))).toBe(true);
  const deals = saved[2].content.slice(1).split("\r\n")[1].split(";");
  expect(deals).toContain("Gewonnen");
  const activities = saved[3].content;
  expect(activities).toContain('"Rückruf; dringend"');
  expect(activities).toContain("Filialausstattung");
});

test("a scope exports only its own records", async () => {
  const host = mount();
  await settle();
  await openExport(host);
  await setChecked(checkbox(scopeRow("leads")), true);
  await setChecked(checkbox(formatRow("json")), false);
  await setChecked(checkbox(formatRow("organizations")), true);
  exportButton().click();
  await settle();
  await collect();

  expect(saved).toHaveLength(1);
  expect(saved[0].name).toContain("-leads-");
  const rows = saved[0].content.slice(1).trim().split("\r\n");
  expect(rows).toHaveLength(2);
  expect(rows[1]).toContain("Sehzentrum Süd");
  // The won customer is a customer, not a lead: it stays out of this file.
  expect(saved[0].content).not.toContain("Sonne");
});

test("attached files are stated honestly, and nothing is invented", async () => {
  const host = mount();
  await settle();
  await openExport(host);
  // This document has no stored data URLs, so the dialog says metadata only rather than
  // promising a backup of bytes that do not exist.
  expect(dialog().querySelector(".crm-export-files")!.textContent).toContain("keine Dateien");
  expect(dialog().querySelector<HTMLInputElement>('input[aria-label="Dateiinhalte einbetten"]')).toBeNull();
  exportButton().click();
  await settle();
  await collect();
  expect(JSON.parse(saved[0].content).fileContents).toBe("none");
});
