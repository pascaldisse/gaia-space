import { expect, test } from "bun:test";
import * as XLSX from "xlsx";
import {
  IMPORT_SOURCE_FALLBACK, autoMap, buildRows, detectHeaderRow, headersOf, importLeads, isCsvName, isSpreadsheetName,
  markDuplicates, normalizeAddress, normalizeCompany, organizationFrom, planOf, readImportFile, type SheetTable,
} from "./crmImport";
import { leadInbox, leadInvariantViolations, normalize, seed, type CrmData } from "./crmStore";

// The import path, proven on real workbook bytes: the file is parsed in-process by
// `xlsx`, mapped by header NAME, checked against the stored document, and written as
// lead organizations. Nothing here touches the network or the DOM.

const SHEET = [
  ["Kundenliste Export 2026", "", "", ""],
  [],
  ["Firma", "Webseite", "Straße / PLZ Ort", "E-Mail", "Telefon", "Ansprechpartner", "Position", "Mitarbeiter", "Quelle", "Labels"],
  ["Optik Nord GmbH", "optik-nord.de", "Hauptstr. 1, 20095 Hamburg", "info@optik-nord.de", "040 1234", "Ida Nord", "Inhaberin", "9", "Messe", "Heißer Lead, Messe"],
  ["Sehzentrum Süd", "sehzentrum-sued.de", "Marktweg 4, 80331 München", "hallo@sehzentrum-sued.de", "089 5555", "Ben Süd", "Filialleiter", "4", "", ""],
  ["", "", "irgendwo", "", "", "", "", "", "", ""],
  ["Optik Nord GmbH & Co. KG", "", "Hauptstr. 1, 20095 Hamburg", "", "", "", "", "", "", ""],
];

const workbookBytes = (rows: unknown[][], sheetName = "Kunden") => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
const emptyDoc = (): CrmData => normalize({ version: 2, organizations: [], deals: [], labels: [], activities: [], pipelineStages: [] });
const table = (rows: string[][]): SheetTable => ({ name: "Kunden", rows });

test("accepted file names are exactly xlsx, xls and csv", () => {
  expect(isSpreadsheetName("kunden.xlsx")).toBe(true);
  expect(isSpreadsheetName("KUNDEN.XLS")).toBe(true);
  expect(isSpreadsheetName("kunden.csv")).toBe(true);
  expect(isSpreadsheetName("kunden.pdf")).toBe(false);
  expect(isCsvName("kunden.csv")).toBe(true);
  expect(isCsvName("kunden.xlsx")).toBe(false);
});

test("a real xlsx workbook is read into one string table per sheet", async () => {
  const parsed = await readImportFile("kunden.xlsx", workbookBytes(SHEET));
  expect(parsed.sheets).toHaveLength(1);
  expect(parsed.sheets[0].name).toBe("Kunden");
  // Cells arrive as text: a postcode keeps its shape, a number is not re-formatted.
  expect(parsed.sheets[0].rows[3][0]).toBe("Optik Nord GmbH");
  expect(parsed.sheets[0].rows[3][7]).toBe("9");
});

test("CSV is parsed by the same reader, from text", async () => {
  const csv = "Firma;E-Mail\nOptik West;west@example.de";
  const parsed = await readImportFile("kunden.csv", csv);
  expect(parsed.sheets[0].rows[0]).toEqual(["Firma", "E-Mail"]);
  expect(parsed.sheets[0].rows[1]).toEqual(["Optik West", "west@example.de"]);
});

test("the header row is found below a title and a blank line", async () => {
  const rows = (await readImportFile("kunden.xlsx", workbookBytes(SHEET))).sheets[0].rows;
  const header = detectHeaderRow(rows);
  expect(rows[header][0]).toBe("Firma");
});

test("common German and English headers map themselves", () => {
  const mapping = autoMap(["Firma", "Webseite", "Straße / PLZ Ort", "E-Mail", "Telefon", "Ansprechpartner", "Position", "Mitarbeiter", "Quelle", "Labels"]);
  expect(mapping.name).toBe(0);
  expect(mapping.website).toBe(1);
  expect(mapping.address).toBe(2);
  expect(mapping.email).toBe(3);
  expect(mapping.phone).toBe(4);
  expect(mapping.contactName).toBe(5);
  expect(mapping.role).toBe(6);
  expect(mapping.employees).toBe(7);
  expect(mapping.source).toBe(8);
  expect(mapping.labels).toBe(9);
  const english = autoMap(["Company Name", "Website", "Email", "Phone", "Contact", "Next Step", "Sales Rep"]);
  expect(english.name).toBe(0);
  expect(english.email).toBe(2);
  expect(english.nextStep).toBe(5);
  expect(english.owner).toBe(6);
  // An unknown column stays unmapped rather than being guessed into a field.
  expect(autoMap(["Bemerkung intern"]).name).toBeUndefined();
});

test("a first column wins its field, a second spelling does not overwrite it", () => {
  const mapping = autoMap(["Telefon", "Telefon 2"]);
  expect(mapping.phone).toBe(0);
});

test("rows are built from the mapping; empty lines vanish, nameless ones are errors", async () => {
  const rows = (await readImportFile("kunden.xlsx", workbookBytes(SHEET))).sheets[0].rows;
  const header = detectHeaderRow(rows);
  const built = buildRows(table(rows), header, autoMap(headersOf(table(rows), header)));
  expect(built).toHaveLength(4);
  expect(built[0].values.name).toBe("Optik Nord GmbH");
  expect(built[0].values.contactName).toBe("Ida Nord");
  // Line numbers are the FILE's, so an error can be looked up in Excel.
  expect(built[0].line).toBe(4);
  const nameless = built.find(row => !row.values.name)!;
  expect(nameless.error).toBe("Kein Firmenname in dieser Zeile");
  expect(nameless.skip).toBe(true);
});

test("changing the mapping changes the rows, nothing else", () => {
  const rows = [["A", "B"], ["Optik West", "west@example.de"]];
  const built = buildRows(table(rows), 0, { name: 0 });
  expect(built[0].values.email).toBe("");
  const remapped = buildRows(table(rows), 0, { name: 0, email: 1 });
  expect(remapped[0].values.email).toBe("west@example.de");
});

test("legal form, punctuation and case do not make a second company", () => {
  expect(normalizeCompany("Optik Nord GmbH")).toBe(normalizeCompany("optik-nord"));
  expect(normalizeCompany("Optik Nord GmbH & Co. KG")).toBe(normalizeCompany("Optik Nord"));
  expect(normalizeCompany("Optik Süd")).not.toBe(normalizeCompany("Optik Nord"));
  expect(normalizeAddress("Hauptstraße 1, 20095 Hamburg")).toBe(normalizeAddress("Hauptstr. 1 / 20095 Hamburg"));
});

test("duplicates are found against the document and inside the file, and default to skip", () => {
  const data = emptyDoc();
  data.organizations.push({ ...organizationFrom(data, { ...blank(), name: "Optik Nord GmbH", address: "Hauptstr. 1, 20095 Hamburg" }) });
  const rows = markDuplicates(data, buildRows(table([
    ["Firma", "Adresse"],
    ["optik nord", "Hauptstraße 1, 20095 Hamburg"],
    ["Sehzentrum Süd", "Marktweg 4"],
    ["Sehzentrum Sued GmbH", "Marktweg 4"],
  ]), 0, { name: 0, address: 1 }));
  expect(rows[0].duplicate).toEqual({ kind: "existing", name: "Optik Nord GmbH" });
  expect(rows[0].skip).toBe(true);
  expect(rows[1].duplicate).toBeNull();
  expect(rows[1].skip).toBe(false);
  expect(rows[2].duplicate).toEqual({ kind: "file", name: "Sehzentrum Süd" });
  const plan = planOf(rows);
  expect(plan).toEqual({ total: 3, ready: 1, skipped: 2, duplicates: 2, errors: 0 });
});

test("a different address at the same company name is not a duplicate", () => {
  const data = emptyDoc();
  data.organizations.push(organizationFrom(data, { ...blank(), name: "Optik Nord", address: "Hauptstr. 1, 20095 Hamburg" }));
  const rows = markDuplicates(data, buildRows(table([["Firma", "Adresse"], ["Optik Nord", "Markt 9, 24103 Kiel"]]), 0, { name: 0, address: 1 }));
  expect(rows[0].duplicate).toBeNull();
});

test("a duplicate can be imported anyway, because the decision is the user's", () => {
  const data = emptyDoc();
  data.organizations.push(organizationFrom(data, { ...blank(), name: "Optik Nord" }));
  const rows = markDuplicates(data, buildRows(table([["Firma"], ["Optik Nord"]]), 0, { name: 0 }))
    .map(row => ({ ...row, skip: false }));
  expect(importLeads(data, rows).imported).toBe(1);
});

test("import creates lead organizations with location, contact, labels and a source fallback", async () => {
  const data = emptyDoc();
  const rows = (await readImportFile("kunden.xlsx", workbookBytes(SHEET))).sheets[0].rows;
  const header = detectHeaderRow(rows);
  const built = markDuplicates(data, buildRows(table(rows), header, autoMap(headersOf(table(rows), header))));
  const result = importLeads(data, built);

  // Two clean rows; one nameless, one duplicate of the first — both skipped.
  expect(result.imported).toBe(2);
  expect(result.skipped).toBe(2);
  expect(leadInbox(data).map(org => org.name).sort()).toEqual(["Optik Nord GmbH", "Sehzentrum Süd"]);

  const nord = data.organizations.find(org => org.name === "Optik Nord GmbH")!;
  expect(nord.leadState).toBe("active");
  expect(nord.website).toBe("optik-nord.de");
  expect(nord.employees).toBe("9");
  expect(nord.source).toBe("Messe");
  expect(nord.decisionMaker).toBe("Ida Nord");
  // Address, mail and phone belong to a LOCATION; the person becomes a contact on it.
  const [location] = nord.locations;
  expect(location.address).toBe("Hauptstr. 1, 20095 Hamburg");
  expect(location.emails).toEqual(["info@optik-nord.de"]);
  expect(location.phones).toEqual(["040 1234"]);
  expect(location.contacts[0]).toMatchObject({ name: "Ida Nord", role: "Inhaberin", preferred: "E-Mail" });
  // Labels are resolved through the central library, not stored as loose strings.
  expect(nord.labels.map(labelId => data.labels.find(label => label.id === labelId)!.name).sort()).toEqual(["Heißer Lead", "Messe"]);

  const sued = data.organizations.find(org => org.name === "Sehzentrum Süd")!;
  expect(sued.source).toBe(IMPORT_SOURCE_FALLBACK);

  // THE INVARIANT: imported leads own no deal, so they cannot reach pipeline or insights.
  expect(data.deals).toHaveLength(0);
  expect(leadInvariantViolations(data)).toEqual([]);
});

test("imported records survive a store round trip unchanged", () => {
  const data = seed();
  const rows = buildRows(table([["Firma", "Nächster Schritt"], ["Optik West", "Rückruf am Montag"]]), 0, { name: 0, nextStep: 1 }, data);
  importLeads(data, rows);
  const reread = normalize(JSON.parse(JSON.stringify(data)));
  const west = reread.organizations.find(org => org.name === "Optik West")!;
  expect(west.leadState).toBe("active");
  expect(west.nextStep).toBe("Rückruf am Montag");
  expect(leadInbox(reread).some(org => org.name === "Optik West")).toBe(true);
});

function blank() {
  return {
    name: "", website: "", address: "", email: "", phone: "", contactName: "", role: "", decisionMaker: "",
    employees: "", software: "", source: "", owner: "", nextStep: "", labels: "",
  };
}
