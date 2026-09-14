import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import * as XLSX from "xlsx";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "./router";

// Rendered-DOM proof for the lead import: the action exists where leads are triaged, a
// real .xlsx file is parsed IN THE VIEW, the preview states what will happen, and the
// import writes lead organizations into the same localStorage document. No network, no
// stub for xlsx — only the address bar is in-memory.

const SHEET = [
  ["Kundenliste"],
  [],
  ["Firma", "Webseite", "Adresse", "E-Mail", "Telefon", "Ansprechpartner", "Quelle"],
  ["Optik Nord GmbH", "optik-nord.de", "Hauptstr. 1, 20095 Hamburg", "info@optik-nord.de", "040 1234", "Ida Nord", "Messe"],
  ["Sehzentrum Süd", "", "Marktweg 4, 80331 München", "", "089 5555", "", ""],
  ["", "", "ohne Namen", "", "", "", ""],
];

const xlsxFile = (rows: unknown[][], name = "kunden.xlsx") => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Kunden");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([new Uint8Array(bytes)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

let dispose: (() => void) | undefined;
const settle = (ms = 25) => new Promise(done => setTimeout(done, ms));
const stored = () => JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!);

beforeEach(() => {
  localStorage.clear();
  registerViews(["Dashboard", "CRM"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("crm/leads"));
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; localStorage.clear(); });

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}
/** happy-dom has no file picker: the chosen file is attached, then `change` fires — the
 *  same two facts the browser hands the view. */
async function choose(host: HTMLElement, file: File) {
  const input = host.querySelector<HTMLInputElement>(".crm-import input[type=file]")!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(60);
}
const openImport = async (host: HTMLElement) => {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent?.includes("Importieren"))!;
  button.click();
  await settle();
};
const rowsOf = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".crm-import-row")];

test("the Lead Inbox offers Importieren, and only there", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  const action = [...host.querySelectorAll(".crm-toolbar button")].find(node => node.textContent?.includes("Importieren"));
  expect(action).toBeTruthy();
  // The pipeline is about deals; an import belongs to triage, so it is not offered there.
  navigate({ view: "CRM", tab: "pipeline" });
  await settle();
  expect([...host.querySelectorAll(".crm-toolbar button")].some(node => node.textContent?.includes("Importieren"))).toBe(false);
});

test("a chosen workbook is previewed before anything is written", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  await openImport(host);
  const before = stored().organizations.length;
  await choose(host, xlsxFile(SHEET));

  const rows = rowsOf(host);
  expect(rows).toHaveLength(3);
  expect(rows[0].querySelector("strong")?.textContent).toBe("Optik Nord GmbH");
  // The nameless line is shown as unusable and cannot be selected.
  expect(rows[2].dataset.importState).toBe("error");
  expect(rows[2].querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled).toBe(true);
  // The summary counts in words; the mapping table stays folded away until asked for.
  expect(host.querySelector(".crm-import-summary")!.textContent).toContain("2");
  expect(host.querySelector(".crm-import-map-grid")).toBeNull();
  // Nothing has been written yet: a preview is a preview.
  expect(stored().organizations.length).toBe(before);
});

test("importing writes leads into the inbox and reports what it did", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  await openImport(host);
  await choose(host, xlsxFile(SHEET));

  const importButton = [...host.querySelectorAll<HTMLButtonElement>(".crm-import footer button")].find(node => node.textContent?.includes("importieren"))!;
  expect(importButton.textContent).toContain("2");
  importButton.click();
  await settle();

  expect(host.querySelector(".crm-import-result")!.textContent).toContain("2 Leads importiert");
  const document_ = stored();
  const names = document_.organizations.map((org: any) => org.name);
  expect(names).toContain("Optik Nord GmbH");
  expect(names).toContain("Sehzentrum Süd");
  const nord = document_.organizations.find((org: any) => org.name === "Optik Nord GmbH");
  expect(nord.leadState).toBe("active");
  expect(nord.source).toBe("Messe");
  expect(nord.locations[0].address).toBe("Hauptstr. 1, 20095 Hamburg");
  expect(nord.locations[0].contacts[0].name).toBe("Ida Nord");
  // A source nobody stated is named after the import, never left blank.
  expect(document_.organizations.find((org: any) => org.name === "Sehzentrum Süd").source).toBe("Excel-Import");
  // Leads, not deals: an imported record owns no opportunity, so the board is untouched.
  expect(document_.deals.some((deal: any) => deal.organizationId === nord.id)).toBe(false);

  // Closing the dialog leaves the imported records visible in the inbox list.
  [...host.querySelectorAll<HTMLButtonElement>(".crm-import footer button")].find(node => node.textContent === "Fertig")!.click();
  await settle();
  const listed = [...host.querySelectorAll(".crm-lead-row > strong")].map(node => node.textContent);
  expect(listed).toContain("Optik Nord GmbH");
  expect(listed).toContain("Sehzentrum Süd");
});

test("a second import of the same file is recognised as duplicates and skipped by default", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  await openImport(host);
  await choose(host, xlsxFile(SHEET));
  [...host.querySelectorAll<HTMLButtonElement>(".crm-import footer button")].find(node => node.textContent?.includes("importieren"))!.click();
  await settle();
  const afterFirst = stored().organizations.length;

  [...host.querySelectorAll<HTMLButtonElement>(".crm-import-result button")].find(node => node.textContent?.includes("Weitere Datei"))!.click();
  await settle();
  await choose(host, xlsxFile(SHEET));
  const rows = rowsOf(host);
  expect(rows.filter(row => row.dataset.importState === "duplicate")).toHaveLength(2);
  expect(rows.every(row => !row.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked)).toBe(true);
  expect(host.querySelector(".crm-import-duplicates")!.textContent).toContain("2");
  // Nothing importable is left, so the dialog cannot double the customer list.
  const importButton = [...host.querySelectorAll<HTMLButtonElement>(".crm-import footer button")].find(node => node.textContent?.includes("importieren"))!;
  expect(importButton.disabled).toBe(true);

  // …unless the user says so: the decision is offered, not taken away.
  [...host.querySelectorAll<HTMLButtonElement>(".crm-import-duplicates button")].find(node => node.textContent?.includes("Trotzdem"))!.click();
  await settle();
  expect([...host.querySelectorAll<HTMLButtonElement>(".crm-import footer button")].find(node => node.textContent?.includes("importieren"))!.disabled).toBe(false);
  expect(stored().organizations.length).toBe(afterFirst);
});

test("the mapping can be corrected, and the preview follows", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  await openImport(host);
  // A file whose company column is not named like one: the guess fails, the user fixes it.
  await choose(host, xlsxFile([["Spalte A", "Notiz"], ["Optik West", "egal"]], "liste.xlsx"));
  expect(rowsOf(host)[0].dataset.importState).toBe("error");

  [...host.querySelectorAll<HTMLButtonElement>(".crm-import-mapping button")].find(node => node.textContent?.includes("Zuordnung anpassen"))!.click();
  await settle();
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Spalte für Firma"]')!;
  select.value = "0";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();

  const rows = rowsOf(host);
  expect(rows[0].dataset.importState).toBe("ready");
  expect(rows[0].querySelector("strong")?.textContent).toBe("Optik West");
});

test("a file that is not a spreadsheet is refused by name, not by upload", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  await openImport(host);
  await choose(host, new File(["nope"], "kunden.pdf", { type: "application/pdf" }));
  expect(host.querySelector(".crm-import-error")!.textContent).toContain("Excel");
  expect(host.querySelector(".crm-import-preview")).toBeNull();
});
