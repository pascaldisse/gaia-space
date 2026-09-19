/** ── Lead import: a spreadsheet becomes organizations ─────────────────────────
 *  A customer list arrives as a file, not as typing. This module is the whole
 *  translation — file bytes → table → mapping → rows → lead organizations — and it is
 *  DELIBERATELY free of DOM and of storage: the view renders what is decided here, and
 *  `importLeads` writes through the same draft mutation every other CRM write uses.
 *
 *  Three rules the rest of the app depends on:
 *    LOCAL ONLY   — the bytes are read in the browser (`xlsx`), never uploaded; the
 *                   result lands in the same localStorage document as everything else.
 *    LEAD, NOT DEAL — an imported record is `leadState: "active"`, so it appears in the
 *                   Lead Inbox and in NO pipeline, customer list or insight (§leadInvariant).
 *    NOTHING IS INVENTED — a value that stood in the file is stored as it stood. Only a
 *                   missing source falls back, and it says which import it came from. */
import type * as XLSXTypes from "xlsx";
import { emptyLocation, emptyOrganization, ensureLabel, id, live, type CrmData, type Contact, type Organization } from "./crmStore";

/** The shared lead fields a spreadsheet can carry. Order is the order of the dialog. */
export const IMPORT_FIELDS = [
  { key: "name", label: "Firma", hint: "Pflichtfeld — ohne Firmenname keine Zeile" },
  { key: "website", label: "Website", hint: "" },
  { key: "address", label: "Adresse", hint: "Straße, PLZ, Ort" },
  { key: "email", label: "E-Mail", hint: "" },
  { key: "phone", label: "Telefon", hint: "" },
  { key: "contactName", label: "Ansprechpartner", hint: "Name der Kontaktperson" },
  { key: "role", label: "Position", hint: "Rolle des Ansprechpartners" },
  { key: "decisionMaker", label: "Entscheider", hint: "" },
  { key: "employees", label: "Mitarbeiter", hint: "" },
  { key: "software", label: "Software", hint: "" },
  { key: "source", label: "Quelle", hint: "Leer = Excel-Import" },
  { key: "owner", label: "Verantwortlich", hint: "" },
  { key: "nextStep", label: "Nächster Schritt", hint: "" },
  { key: "labels", label: "Labels", hint: "Mehrere durch Komma getrennt" },
] as const satisfies ReadonlyArray<{ key: string; label: string; hint: string }>;
export type ImportField = typeof IMPORT_FIELDS[number]["key"];
export const IMPORT_FIELD_LABELS = Object.fromEntries(IMPORT_FIELDS.map(field => [field.key, field.label])) as Record<ImportField, string>;
/** A record whose origin nobody wrote down still has one: this import. */
export const IMPORT_SOURCE_FALLBACK = "Excel-Import";

/** Header spellings seen in the wild, German and English. Matching is done on the
 *  FOLDED form (§fold), so "E-Mail", "e_mail" and "EMAIL " are the same word here. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ["firma", "firmenname", "unternehmen", "organisation", "company", "companyname", "kunde", "kundenname", "betrieb", "name", "account"],
  website: ["website", "webseite", "web", "url", "homepage", "internet", "domain"],
  address: ["adresse", "anschrift", "strasse", "strassehausnummer", "address", "street", "ort", "standort", "plzort"],
  email: ["email", "emailadresse", "mail", "mailadresse", "kontaktemail", "epost"],
  phone: ["telefon", "telefonnummer", "tel", "phone", "festnetz", "mobil", "handy", "telnr", "rufnummer"],
  contactName: ["ansprechpartner", "kontakt", "kontaktperson", "contact", "contactname", "ansprechpartnerin"],
  role: ["position", "rolle", "funktion", "role", "title", "jobtitle", "titel"],
  decisionMaker: ["entscheider", "entscheidungstraeger", "inhaber", "geschaeftsfuehrer", "decisionmaker", "owner"],
  employees: ["mitarbeiter", "mitarbeiterzahl", "mitarbeiteranzahl", "anzahlmitarbeiter", "employees", "headcount", "groesse"],
  software: ["software", "system", "systeme", "tool", "tools", "kassensystem", "warenwirtschaft"],
  source: ["quelle", "herkunft", "source", "kanal", "leadquelle", "channel"],
  owner: ["verantwortlich", "verantwortlicher", "betreuer", "vertrieb", "assignee", "salesrep", "zustaendig"],
  nextStep: ["naechsterschritt", "naechsteschritte", "nextstep", "nextaction", "todo", "massnahme"],
  labels: ["labels", "label", "tags", "tag", "kategorie", "kategorien", "schlagworte"],
};
/** Ambiguity is decided ONCE, here: "owner" is English for the decision maker and
 *  German shorthand for the responsible colleague, so the earlier field in this list
 *  wins a contested header rather than two fields silently fighting over one column. */
const MATCH_ORDER: ImportField[] = ["name", "website", "address", "email", "phone", "contactName", "role", "decisionMaker", "employees", "software", "source", "owner", "nextStep", "labels"];

const UMLAUTS: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };
/** Case, punctuation, umlauts and spacing removed — what is left is the WORD. */
export const fold = (value: string) =>
  String(value ?? "").toLocaleLowerCase("de").replace(/[äöüß]/g, char => UMLAUTS[char] ?? char).replace(/[^a-z0-9]+/g, "");

/** ── Reading the file ───────────────────────────────────────────────────────
 *  One table per sheet, every cell a STRING (`raw: false`), because a lead field is
 *  text: a postcode must not lose its leading zero and "12,5" must not become 12.5. */
export type SheetTable = { name: string; rows: string[][] };
export type ImportFile = { name: string; sheets: SheetTable[] };

/** `xlsx` is half a megabyte and is needed only when somebody actually imports a file,
 *  so it is loaded ON DEMAND — the reader stays out of the startup bundle. */
const xlsx = async () => await import("xlsx");

const toTable = (XLSX: typeof XLSXTypes, book: XLSXTypes.WorkBook, sheetName: string): SheetTable => {
  const sheet = book.Sheets[sheetName];
  // `blankrows: true` on purpose: an empty line is DROPPED later (§buildRows), but the
  // row index must stay the line number of the file, or an error message points at the
  // wrong row in Excel.
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
  return { name: sheetName, rows: rows.map(row => (row ?? []).map(cell => String(cell ?? "").trim())) };
};
export const isSpreadsheetName = (filename: string) => /\.(xlsx|xls|csv)$/i.test(filename.trim());
export const isCsvName = (filename: string) => /\.csv$/i.test(filename.trim());
/** Bytes for Excel, text for CSV — nothing leaves the machine either way. */
export const readImportFile = async (filename: string, content: ArrayBuffer | Uint8Array | string): Promise<ImportFile> => {
  const XLSX = await xlsx();
  const book = typeof content === "string"
    ? XLSX.read(content, { type: "string", raw: false })
    : XLSX.read(content instanceof Uint8Array ? content : new Uint8Array(content), { type: "array", raw: false });
  return { name: filename, sheets: book.SheetNames.map(sheetName => toTable(XLSX, book, sheetName)) };
};

/** ── Finding the header ─────────────────────────────────────────────────────
 *  Exported lists start with a title line, a logo row or a blank one. The header is the
 *  first row that looks like LABELS: at least two filled cells, and it recognises more
 *  known field names than the row above it. A file we cannot judge keeps row 0, which
 *  the dialog lets the user overrule — a guess is never the final word. */
export const detectHeaderRow = (rows: string[][]): number => {
  let best = 0, bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 20); index++) {
    const filled = rows[index].filter(cell => cell.trim()).length;
    if (filled < 2) continue;
    const known = rows[index].filter(cell => matchField(cell) !== undefined).length;
    const score = known * 10 + filled;
    if (score > bestScore) { bestScore = score; best = index; }
  }
  return best;
};
export const headersOf = (table: SheetTable, headerRow: number): string[] => {
  const header = table.rows[headerRow] ?? [];
  const width = Math.max(header.length, ...table.rows.slice(headerRow + 1).map(row => row.length), 0);
  return Array.from({ length: width }, (_, column) => header[column]?.trim() || `Spalte ${column + 1}`);
};

/** ── Mapping ────────────────────────────────────────────────────────────────
 *  A mapping says which COLUMN feeds which field; a field with no column is simply not
 *  imported. Exact word first, then "contains", so "E-Mail Zentrale" still maps. */
export type Mapping = Partial<Record<ImportField, number>>;
const matchField = (header: string): ImportField | undefined => {
  const word = fold(header);
  if (!word) return undefined;
  const exact = MATCH_ORDER.find(field => SYNONYMS[field].includes(word));
  if (exact) return exact;
  return MATCH_ORDER.find(field => SYNONYMS[field].some(synonym => synonym.length > 3 && word.includes(synonym)));
};
/** First column wins a field, so a duplicated "Telefon 2" cannot overwrite "Telefon". */
export const autoMap = (headers: string[]): Mapping => {
  const mapping: Mapping = {};
  headers.forEach((header, column) => {
    const field = matchField(header);
    if (field && mapping[field] === undefined) mapping[field] = column;
  });
  return mapping;
};
export const mappedFieldCount = (mapping: Mapping) => IMPORT_FIELDS.filter(field => mapping[field.key] !== undefined).length;

/** ── Rows ───────────────────────────────────────────────────────────────────
 *  One entry per data line, carrying its own verdict: `error` (cannot be imported),
 *  `duplicate` (already known — skipped by default, but the user decides), or clean. */
export type DuplicateKind = "existing" | "file";
export type ImportRow = {
  /** 1-based line number IN THE FILE, so a complaint can be looked up in Excel. */
  line: number;
  values: Record<ImportField, string>;
  error: string;
  duplicate: { kind: DuplicateKind; name: string } | null;
  /** The decision that is actually executed. Defaults: errors and duplicates skip. */
  skip: boolean;
};

const LEGAL_FORMS = ["gmbhcokg", "gmbhco", "gmbh", "mbh", "ohg", "gbr", "kgaa", "kg", "ug", "ag", "ek", "eg", "ev", "ltd", "inc", "bv", "sarl", "srl", "gmbhundcokg"];
/** Two spellings of one company must collide: legal form, punctuation, case and spacing
 *  are noise. "Optik Nord GmbH & Co. KG" and "optik-nord" are the same customer. */
export const normalizeCompany = (name: string) => {
  let word = fold(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      if (word.length > form.length && word.endsWith(form)) { word = word.slice(0, -form.length); changed = true; }
    }
    if (word.endsWith("und")) { word = word.slice(0, -3); changed = true; }
  }
  return word;
};
/** Street spellings differ more than street names do. */
export const normalizeAddress = (address: string) =>
  fold(address).replace(/strasse/g, "str");
/** The identity of a lead: the company, plus the address WHEN BOTH SIDES HAVE ONE — a
 *  record without an address must still collide with its twin rather than slip past. */
export const duplicateKeys = (name: string, address: string) => {
  const company = normalizeCompany(name);
  const place = normalizeAddress(address);
  return place ? [company, `${company}|${place}`] : [company];
};
/** A known record is a company plus EVERY address it is reachable at: an organization
 *  with two sites must collide on either of them, so a list that carries the branch
 *  address of an existing customer is a duplicate, not a second company. Joining the
 *  sites into one string compared them as a single fictitious address that matched
 *  nothing — a multi-site customer was silently imported twice. */
type KnownRecord = { name: string; addresses: string[]; label: string };
const collides = (candidate: { name: string; address: string }, known: KnownRecord) => {
  if (!normalizeCompany(candidate.name) || normalizeCompany(candidate.name) !== normalizeCompany(known.name)) return false;
  const left = normalizeAddress(candidate.address);
  const rights = known.addresses.map(normalizeAddress).filter(Boolean);
  return !left || !rights.length || rights.includes(left);
};

const emptyValues = (): Record<ImportField, string> =>
  Object.fromEntries(IMPORT_FIELDS.map(field => [field.key, ""])) as Record<ImportField, string>;

/** Table + header row + mapping → the rows that would be written. Pure: calling it
 *  again after a mapping change is the whole "re-map" feature. */
export const buildRows = (table: SheetTable, headerRow: number, mapping: Mapping, data?: CrmData): ImportRow[] => {
  const rows: ImportRow[] = [];
  for (let index = headerRow + 1; index < table.rows.length; index++) {
    const raw = table.rows[index];
    if (!raw || !raw.some(cell => cell.trim())) continue;
    const values = emptyValues();
    for (const field of MATCH_ORDER) {
      const column = mapping[field];
      if (column !== undefined) values[field] = String(raw[column] ?? "").trim();
    }
    const error = values.name.trim() ? "" : "Kein Firmenname in dieser Zeile";
    rows.push({ line: index + 1, values, error, duplicate: null, skip: !!error });
  }
  return data ? markDuplicates(data, rows) : rows;
};

/** Duplicates against the stored document AND against earlier lines of the same file —
 *  a list exported twice in one sheet is the commonest way to double a customer. */
export const markDuplicates = (data: CrmData, rows: ImportRow[]): ImportRow[] => {
  const existing: KnownRecord[] = live(data.organizations).map(org => ({
    name: org.name, addresses: (org.locations ?? []).map(location => location.address), label: org.name,
  }));
  const seen: KnownRecord[] = [];
  return rows.map(row => {
    if (row.error) return { ...row, duplicate: null, skip: true };
    const candidate = { name: row.values.name, address: row.values.address };
    const known = existing.find(item => collides(candidate, item));
    const earlier = known ? undefined : seen.find(item => collides(candidate, item));
    const duplicate = known ? { kind: "existing" as DuplicateKind, name: known.label }
      : earlier ? { kind: "file" as DuplicateKind, name: earlier.label } : null;
    seen.push({ name: candidate.name, addresses: [candidate.address], label: row.values.name });
    return { ...row, duplicate, skip: !!duplicate };
  });
};

export type ImportPlan = { total: number; ready: number; skipped: number; duplicates: number; errors: number };
export const planOf = (rows: ImportRow[]): ImportPlan => ({
  total: rows.length,
  ready: rows.filter(row => !row.skip && !row.error).length,
  skipped: rows.filter(row => row.skip).length,
  duplicates: rows.filter(row => row.duplicate).length,
  errors: rows.filter(row => row.error).length,
});

/** ── Writing ────────────────────────────────────────────────────────────────
 *  A row becomes ONE organization in the Lead Inbox. Its address, employee count,
 *  e-mail and phone belong to a LOCATION (an organization has no address of its own),
 *  and a named person becomes a CONTACT on that location. Labels are resolved through
 *  the central library, so an imported "Messe" is the same label as a typed one. */
const contactFrom = (values: Record<ImportField, string>): Contact | null => {
  const name = values.contactName.trim() || values.decisionMaker.trim();
  if (!name) return null;
  return {
    id: id("contact"), name, role: values.role.trim(),
    emails: values.email.trim() ? [values.email.trim()] : [], phones: values.phone.trim() ? [values.phone.trim()] : [],
    preferred: values.email.trim() ? "E-Mail" : values.phone.trim() ? "Telefon" : "",
  };
};
export const organizationFrom = (data: CrmData, values: Record<ImportField, string>, fallbackSource = IMPORT_SOURCE_FALLBACK): Organization => {
  const org = emptyOrganization(values.name.trim(), values.owner.trim());
  org.website = values.website.trim();
  org.employees = values.employees.trim();
  org.decisionMaker = values.decisionMaker.trim() || values.contactName.trim();
  org.software = values.software.trim();
  org.source = values.source.trim() || fallbackSource;
  org.nextStep = values.nextStep.trim();
  org.labels = values.labels.split(/[,;\n]/).map(label => label.trim()).filter(Boolean).map(label => ensureLabel(data, label));
  const location = emptyLocation(values.name.trim());
  location.address = values.address.trim();
  location.employees = values.employees.trim();
  location.emails = values.email.trim() ? [values.email.trim()] : [];
  location.phones = values.phone.trim() ? [values.phone.trim()] : [];
  const contact = contactFrom(values);
  location.contacts = contact ? [contact] : [];
  org.locations = [location];
  // An import is triage material, never a qualified opportunity: it lands in the inbox.
  org.leadState = "active";
  return org;
};

export type ImportResult = { imported: number; skipped: number; names: string[] };
/** The single write. Rows the user left skipped are counted, not created. */
export const importLeads = (data: CrmData, rows: ImportRow[], fallbackSource = IMPORT_SOURCE_FALLBACK): ImportResult => {
  const taken = rows.filter(row => !row.skip && !row.error && row.values.name.trim());
  for (const row of taken) data.organizations.unshift(organizationFrom(data, row.values, fallbackSource));
  return { imported: taken.length, skipped: rows.length - taken.length, names: taken.map(row => row.values.name.trim()) };
};
