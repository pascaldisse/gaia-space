import { expect, test } from "bun:test";
import {
  ACTIVITY_COLUMNS, CONTACT_COLUMNS, CSV_BOM, DEAL_COLUMNS, EXPORT_SCHEMA, EXPORT_SCHEMA_VERSION, ORGANIZATION_COLUMNS,
  activityRows, buildBackup, buildExportFiles, contactRows, countsForScope, csvCell, csvTable, dealRows, deDate, deNumber,
  deStamp, exportFileName, fileStats, formatRowCount, organizationRows, selectScope,
} from "./crmExport";
import {
  addActivity, convertToDeal, closeDeal, createOrganization, ensureLabel, id, normalize, softDeleteDeal,
  defaultPipelineStages, type CrmData,
} from "./crmStore";

// The export is the promise that the data can LEAVE. These tests hold it to that:
// the JSON reads back through `normalize` unchanged, the CSV survives semicolons,
// quotes and line breaks, and a scope exports what its name says — no more, no less.

const AT = new Date("2026-03-04T09:07:00");

/** A document with every awkward shape the exporter must survive: a semicolon in a
 *  name, a quote, a multi-line address, a deleted deal, an inbox activity, a file. */
function fixture(): CrmData {
  const data: CrmData = { version: 2, organizations: [], deals: [], labels: [], pipelineStages: defaultPipelineStages(), activities: [] };
  const hot = ensureLabel(data, "Heiß");
  const kunde = createOrganization(data, {
    name: 'Optik "Sonne"; Nord GmbH', website: "sonne-nord.de", employees: "12", source: "Messe", owner: "Jannes",
    address: "Hauptstr. 1\n20095 Hamburg", email: "info@sonne-nord.de", phone: "040 1234",
    contactName: "Ida Nord", contactRole: "Inhaberin",
  });
  kunde.labels = [hot];
  const deal = convertToDeal(data, kunde.id, "Angebot erstellt", { title: "Filialausstattung", value: "12500,50", owner: "Jannes" })!;
  deal.notes.push({ id: id("note"), title: "Erstgespräch", body: "Zeile 1\nZeile 2", author: "Jannes", createdAt: "2026-02-01T10:00:00.000Z" });
  deal.files.push({ id: id("file"), name: "Angebot.pdf", type: "application/pdf", data: "data:application/pdf;base64,QUJDRA==", createdAt: "2026-02-02T10:00:00.000Z" });
  addActivity(data, deal.id, { kind: "Anruf", title: "Rückruf; dringend", dueDate: "2026-03-04", dueTime: "10:30", duration: 30, owner: "Jannes" });
  closeDeal(data, deal.id, "Gewonnen");

  const lead = createOrganization(data, { name: "Sehzentrum Süd", source: "Website", owner: "Bjarne" });
  const lost = convertToDeal(data, createOrganization(data, { name: "Brillen Ost" }).id, "Qualified", { title: "Ost-Deal", value: "800" })!;
  closeDeal(data, lost.id, "Verloren");
  const trashed = convertToDeal(data, createOrganization(data, { name: "Papierkorb AG" }).id, "Qualified", { title: "Weg" })!;
  softDeleteDeal(data, trashed.id);
  addActivity(data, null, { kind: "Aufgabe", title: "Liste recherchieren", dueDate: "2026-03-10" });
  void lead;
  return data;
}

/* ── CSV serialization ─────────────────────────────────────────────────── */

test("a cell is quoted exactly when it must be, and a quote doubles", () => {
  expect(csvCell("Optik Nord")).toBe("Optik Nord");
  expect(csvCell("Nord; Süd")).toBe('"Nord; Süd"');
  expect(csvCell('Optik "Sonne"')).toBe('"Optik ""Sonne"""');
  expect(csvCell("Zeile 1\nZeile 2")).toBe('"Zeile 1\nZeile 2"');
  // A Windows line break becomes one line break inside the quotes, never two.
  expect(csvCell("Zeile 1\r\nZeile 2")).toBe('"Zeile 1\nZeile 2"');
  expect(csvCell(null)).toBe("");
  expect(csvCell(undefined)).toBe("");
  expect(csvCell(0)).toBe("0");
});

test("a table is BOM-prefixed, semicolon-separated and CRLF-terminated", () => {
  const table = csvTable(["A", "B"], [["1;2", 'x"y']]);
  expect(table.startsWith(CSV_BOM)).toBe(true);
  expect(table).toBe(`${CSV_BOM}A;B\r\n"1;2";"x""y"\r\n`);
  // The record separator is CRLF; the break INSIDE a quoted cell stays a bare \n.
  expect(csvTable(["A"], [["a\nb"]]).split("\r\n")).toHaveLength(3);
});

test("German notation: dates, timestamps and decimal commas", () => {
  expect(deDate("2026-03-04")).toBe("04.03.2026");
  expect(deDate("")).toBe("");
  expect(deDate("kein Datum")).toBe("");
  expect(deStamp("2026-03-04T09:07:00")).toBe("04.03.2026 09:07");
  expect(deStamp(null)).toBe("");
  expect(deNumber(12500.5)).toBe("12500,5");
});

/* ── Scopes ────────────────────────────────────────────────────────────── */

test("a scope exports what its name says", () => {
  const data = fixture();
  // All: the raw document, INCLUDING the trash — a backup that drops it is not one.
  const all = selectScope(data, "all");
  expect(all.deals).toHaveLength(3);
  expect(all.deals.some(deal => deal.deletedAt)).toBe(true);
  expect(all.inboxActivities).toHaveLength(1);

  // Leads: untriaged organizations, never a record that already produced a deal.
  const leads = selectScope(data, "leads");
  expect(leads.organizations.map(org => org.name)).toEqual(["Sehzentrum Süd"]);
  expect(leads.deals).toHaveLength(0);

  // Customers: won, and only won — with their deals.
  const custom = selectScope(data, "customers");
  expect(custom.organizations.map(org => org.name)).toEqual(['Optik "Sonne"; Nord GmbH']);
  expect(custom.deals.map(deal => deal.title)).toEqual(["Filialausstattung"]);

  // Deals: every live deal regardless of outcome; the deleted one stays in the trash.
  const deals = selectScope(data, "deals");
  expect(deals.deals.map(deal => deal.title).sort()).toEqual(["Filialausstattung", "Ost-Deal"]);
  expect(deals.organizations).toHaveLength(2);

  // Activities: the work plus exactly the records it points at.
  const activities = selectScope(data, "activities");
  expect(activities.deals.map(deal => deal.title)).toEqual(["Filialausstattung"]);
  expect(activities.inboxActivities).toHaveLength(1);
});

test("the counts the dialog shows are the rows the files contain", () => {
  const data = fixture();
  const counts = countsForScope(data, "all");
  expect(counts.organizations).toBe(4);
  expect(counts.deals).toBe(3);
  expect(counts.activities).toBe(2);
  expect(counts.contacts).toBe(1);
  expect(counts.notes).toBe(1);
  expect(counts.files).toBe(1);

  const selection = selectScope(data, "all");
  expect(organizationRows(data, selection)).toHaveLength(counts.organizations);
  expect(dealRows(data, selection, AT)).toHaveLength(counts.deals);
  expect(activityRows(data, selection, AT)).toHaveLength(counts.activities);
  expect(contactRows(data, selection)).toHaveLength(counts.contacts);
  // A scope with nothing to say says zero, so the checkbox can disable itself.
  expect(formatRowCount(data, selectScope(data, "leads"), "deals")).toBe(0);
});

/* ── Rows ──────────────────────────────────────────────────────────────── */

test("an organization row resolves labels, addresses and its deal tally", () => {
  const data = fixture();
  const selection = selectScope(data, "customers");
  const row = organizationRows(data, selection)[0];
  const cell = (name: string) => row[ORGANIZATION_COLUMNS.indexOf(name)];
  expect(cell("Name")).toBe('Optik "Sonne"; Nord GmbH');
  expect(cell("Status")).toBe("Kunde");
  expect(cell("Labels")).toBe("Heiß");
  // The multi-line address is flattened for the cell, the mails are joined once each.
  expect(cell("Adressen")).toBe("Hauptstr. 1, 20095 Hamburg");
  expect(cell("E-Mails")).toBe("info@sonne-nord.de | info@sonne-nord.de");
  expect(cell("Deals")).toBe(1);
  expect(cell("Gewonnene Deals")).toBe(1);
  // …and it survives the trip through the serializer intact.
  const line = csvTable(ORGANIZATION_COLUMNS, [row]).trim().split("\r\n")[1];
  expect(line).toContain('"Optik ""Sonne""; Nord GmbH"');
});

test("a deal row names its organization and weighs itself by the stage", () => {
  const data = fixture();
  const row = dealRows(data, selectScope(data, "customers"), AT)[0];
  const cell = (name: string) => row[DEAL_COLUMNS.indexOf(name)];
  expect(cell("Titel")).toBe("Filialausstattung");
  expect(cell("Organisation")).toBe('Optik "Sonne"; Nord GmbH');
  expect(cell("Status")).toBe("Gewonnen");
  // A won deal counts fully — the probability comes from the status, then the stage.
  expect(cell("Wahrscheinlichkeit %")).toBe(100);
  expect(cell("Wert")).toBe("12500,5");
  expect(cell("Gewichteter Wert")).toBe("12500,5");
  expect(cell("Notizen")).toBe(1);
  expect(cell("Dateien")).toBe(1);
});

test("an activity row states its home, deal or inbox", () => {
  const data = fixture();
  const rows = activityRows(data, selectScope(data, "activities"), AT);
  const cell = (row: unknown[], name: string) => row[ACTIVITY_COLUMNS.indexOf(name)];
  const call = rows.find(row => String(cell(row, "Titel")).startsWith("Rückruf"))!;
  expect(cell(call, "Deal")).toBe("Filialausstattung");
  expect(cell(call, "Organisation")).toBe('Optik "Sonne"; Nord GmbH');
  expect(cell(call, "Fällig am")).toBe("04.03.2026");
  expect(cell(call, "Status")).toBe("Heute fällig");
  expect(cell(call, "Dauer (Min.)")).toBe(30);

  const inbox = rows.find(row => cell(row, "Titel") === "Liste recherchieren")!;
  expect(cell(inbox, "Deal")).toBe("");
  expect(cell(inbox, "Deal-ID")).toBe("");
  expect(cell(inbox, "Status")).toBe("Geplant");
});

test("a contact row carries its location and its organization", () => {
  const data = fixture();
  const row = contactRows(data, selectScope(data, "all"))[0];
  const cell = (name: string) => row[CONTACT_COLUMNS.indexOf(name)];
  expect(cell("Name")).toBe("Ida Nord");
  expect(cell("Position")).toBe("Inhaberin");
  expect(cell("E-Mails")).toBe("info@sonne-nord.de");
  expect(cell("Adresse")).toBe("Hauptstr. 1, 20095 Hamburg");
  expect(cell("Organisation")).toBe('Optik "Sonne"; Nord GmbH');
});

/* ── The backup ────────────────────────────────────────────────────────── */

test("the full backup is versioned, stamped and LOSSLESS", () => {
  // The document as the app actually holds it — `normalize` is what `loadCrm` runs, so
  // comparing against it is comparing against a REAL stored state, not a hand-built one.
  const data = normalize(fixture());
  const backup = buildBackup(data, "all", { at: AT });
  expect(backup.schema).toBe(EXPORT_SCHEMA);
  expect(backup.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
  expect(backup.crmVersion).toBe(2);
  expect(backup.exportedAt).toBe(AT.toISOString());
  expect(backup.scope).toBe("all");
  expect(backup.counts.deals).toBe(3);

  // The round trip is the whole promise: written, read back, identical — trash, lead
  // states, labels, pipeline configuration and inbox activities included.
  const restored = normalize(JSON.parse(JSON.stringify(backup.data)));
  expect(restored).toEqual(data);
  expect(restored.deals.filter(deal => deal.deletedAt)).toHaveLength(1);
  expect(restored.pipelineStages).toEqual(data.pipelineStages);
  expect(restored.labels.map(label => label.name)).toContain("Heiß");
});

test("file contents travel only if they exist, and the flag says which happened", () => {
  const data = fixture();
  const stats = fileStats(selectScope(data, "all"));
  expect(stats.files).toBe(1);
  expect(stats.withData).toBe(1);
  expect(stats.bytes).toBe(6);

  const withFiles = buildBackup(data, "all", { at: AT });
  expect(withFiles.fileContents).toBe("included");
  expect(withFiles.data.deals.flatMap(deal => deal.files)[0].data).toContain("base64,");

  // Metadata only: the record of the file stays, the bytes do not.
  const without = buildBackup(data, "all", { at: AT, includeFileContents: false });
  expect(without.fileContents).toBe("omitted");
  const file = without.data.deals.flatMap(deal => deal.files)[0];
  expect(file.name).toBe("Angebot.pdf");
  expect(file.data).toBe("");
  // …and the live document is untouched by the export.
  expect(data.deals.flatMap(deal => deal.files)[0].data).toContain("base64,");

  // Nothing attached anywhere: "none", so the UI can say so instead of offering a switch.
  const empty: CrmData = { version: 2, organizations: [], deals: [], labels: [], pipelineStages: defaultPipelineStages(), activities: [] };
  expect(buildBackup(empty, "all", { at: AT }).fileContents).toBe("none");
});

test("a scoped backup carries its subset plus the configuration needed to read it", () => {
  const data = fixture();
  const backup = buildBackup(data, "leads", { at: AT });
  expect(backup.scope).toBe("leads");
  expect(backup.data.organizations.map(org => org.name)).toEqual(["Sehzentrum Süd"]);
  expect(backup.data.deals).toHaveLength(0);
  // Labels and stages are configuration, not records: without them a restore is unnamed.
  expect(backup.data.labels.length).toBeGreaterThan(0);
  expect(backup.data.pipelineStages).toHaveLength(6);
  expect(normalize(JSON.parse(JSON.stringify(backup.data))).organizations[0].leadState).toBe("active");
});

/* ── Produced files ────────────────────────────────────────────────────── */

test("file names state format, scope and moment", () => {
  expect(exportFileName("json", "all", AT)).toBe("crm-sicherung-alle-daten-2026-03-04-0907.json");
  expect(exportFileName("organizations", "customers", AT)).toBe("crm-organisationen-kunden-2026-03-04-0907.csv");
  expect(exportFileName("activities", "activities", AT)).toBe("crm-aktivitaeten-aktivitaeten-2026-03-04-0907.csv");
});

test("one run produces one file per chosen format, each self-contained", () => {
  const data = fixture();
  const files = buildExportFiles(data, { scope: "all", formats: ["json", "organizations", "contacts", "deals", "activities"], at: AT });
  expect(files.map(file => file.name.split("-")[1])).toEqual(["sicherung", "organisationen", "kontakte", "deals", "aktivitaeten"]);
  const csvs = files.filter(file => file.name.endsWith(".csv"));
  expect(csvs.every(file => file.content.startsWith(CSV_BOM))).toBe(true);
  expect(csvs.every(file => file.mime === "text/csv;charset=utf-8")).toBe(true);
  // Each CSV is its own table with its own header; a reader never needs a second file.
  const orgs = files.find(file => file.name.includes("organisationen"))!;
  expect(orgs.content.slice(1).split("\r\n")[0]).toBe(ORGANIZATION_COLUMNS.join(";"));
  expect(orgs.rows).toBe(4);
  const backup = JSON.parse(files[0].content);
  expect(backup.schema).toBe(EXPORT_SCHEMA);
  expect(files[0].mime).toBe("application/json;charset=utf-8");
});
