/** ── Taking the data OUT again ────────────────────────────────────────────────
 *  A CRM that cannot be left is a hostage situation. Everything a person typed,
 *  imported or won belongs to them, so the export exists from day one and is a FIRST
 *  CLASS action, not a settings footnote.
 *
 *  Two products, deliberately different:
 *    BACKUP (JSON)  — the whole document, lossless and versioned. It is the same shape
 *                     `normalize` reads back (§crmStore), so an export → import round
 *                     trip is the identity function, including the trash, the lead
 *                     states, the pipeline configuration and the label library.
 *    TABLES (CSV)   — what a human opens in Excel on Monday. German Excel: semicolon
 *                     separated, CRLF, UTF-8 with BOM, dates in German notation and
 *                     decimal commas. Links are RESOLVED (the deal names its
 *                     organization), multi-values are joined, so a row reads alone.
 *
 *  Both are produced in the browser and handed to the download of the machine. Nothing
 *  is uploaded, and this module knows no network by construction.
 *
 *  Scope is a question about MEANING, not about rows: "Leads" is the triage inbox,
 *  "Kunden" are the organizations with a won deal, "Alle Daten" is the raw document
 *  INCLUDING deleted records — because a backup that silently drops the trash is not a
 *  backup. Every other scope exports live records only. */
import {
  activityState, customers, daysInStage, dealProbability, isCustomer, live, LEAD_STATE_LABELS,
  type Activity, type CrmData, type CrmFile, type Deal, type Organization,
} from "./crmStore";

export const EXPORT_SCHEMA = "gaia-crm-export";
export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_APP = "GAIA Space CRM";

export const EXPORT_SCOPES = ["all", "leads", "customers", "deals", "activities"] as const;
export type ExportScope = typeof EXPORT_SCOPES[number];
export const EXPORT_SCOPE_LABELS: Record<ExportScope, string> = {
  all: "Alle Daten", leads: "Leads", customers: "Kunden", deals: "Deals", activities: "Aktivitäten",
};
export const EXPORT_SCOPE_HINTS: Record<ExportScope, string> = {
  all: "Vollständige Sicherung inklusive Papierkorb, Labels und Pipeline-Konfiguration.",
  customers: "Organisationen mit mindestens einem gewonnenen Deal – samt ihrer Deals.",
  leads: "Organisationen im Posteingang und im Archiv, die noch keinen Deal haben.",
  deals: "Alle aktiven Deals (offen, gewonnen, verloren) mit ihren Organisationen.",
  activities: "Geplante und erledigte Arbeit aus Deals und Posteingang, mit ihrem Bezug.",
};

/** ── What a scope selects ───────────────────────────────────────────────────
 *  One function decides it, so the counts in the dialog, the JSON and every CSV can
 *  never describe three different sets of records. */
export type ExportSelection = {
  scope: ExportScope;
  organizations: Organization[];
  deals: Deal[];
  /** Activities with no opportunity — the inbox half of the worklist (§crmStore). */
  inboxActivities: Activity[];
};
/** A deal without its deleted activities: every scope except the full backup exports
 *  what is CURRENTLY true, and a deleted activity is not currently true. */
const liveDeal = (deal: Deal): Deal => ({ ...deal, activities: live(deal.activities) });
const orgsOf = (data: CrmData, deals: Deal[]) => {
  const wanted = new Set(deals.map(deal => deal.organizationId));
  return live(data.organizations).filter(org => wanted.has(org.id));
};

export const selectScope = (data: CrmData, scope: ExportScope): ExportSelection => {
  if (scope === "all") {
    // Raw and untouched: the backup is the document, not a view of it.
    return { scope, organizations: data.organizations, deals: data.deals, inboxActivities: data.activities ?? [] };
  }
  if (scope === "leads") {
    return { scope, organizations: live(data.organizations).filter(org => org.leadState !== "converted"), deals: [], inboxActivities: [] };
  }
  if (scope === "customers") {
    const orgs = customers(data);
    const ids = new Set(orgs.map(org => org.id));
    return { scope, organizations: orgs, deals: live(data.deals).filter(deal => ids.has(deal.organizationId)).map(liveDeal), inboxActivities: [] };
  }
  if (scope === "deals") {
    const deals = live(data.deals).map(liveDeal);
    return { scope, organizations: orgsOf(data, deals), deals, inboxActivities: [] };
  }
  // activities — the work, plus exactly the records it points at.
  const deals = live(data.deals).map(liveDeal).filter(deal => deal.activities.length);
  return { scope, organizations: orgsOf(data, deals), deals, inboxActivities: live(data.activities ?? []) };
};

export type ExportCounts = {
  organizations: number; locations: number; contacts: number; deals: number;
  activities: number; notes: number; files: number; labels: number;
};
export const countSelection = (data: CrmData, selection: ExportSelection): ExportCounts => ({
  organizations: selection.organizations.length,
  locations: selection.organizations.reduce((sum, org) => sum + org.locations.length, 0),
  contacts: selection.organizations.reduce((sum, org) => sum + org.locations.reduce((inner, loc) => inner + loc.contacts.length, 0), 0),
  deals: selection.deals.length,
  activities: selection.deals.reduce((sum, deal) => sum + deal.activities.length, 0) + selection.inboxActivities.length,
  notes: selection.deals.reduce((sum, deal) => sum + deal.notes.length, 0),
  files: selection.deals.reduce((sum, deal) => sum + deal.files.length, 0),
  labels: selection.scope === "all" ? data.labels.length : 0,
});
export const countsForScope = (data: CrmData, scope: ExportScope) => countSelection(data, selectScope(data, scope));

/** ── Attached files ─────────────────────────────────────────────────────────
 *  A CRM file lives in the document as a data URL, so the "backup" either carries the
 *  actual bytes or it does not. That is a fact worth stating out loud instead of
 *  letting somebody discover it on a restore, so the UI reads these numbers. */
export type FileStats = { files: number; withData: number; bytes: number };
const dataBytes = (file: CrmFile) => {
  const payload = String(file.data ?? "");
  const base64 = payload.includes(",") ? payload.slice(payload.indexOf(",") + 1) : "";
  return base64 ? Math.floor(base64.length * 3 / 4) : 0;
};
export const fileStats = (selection: ExportSelection): FileStats => {
  const files = selection.deals.flatMap(deal => deal.files);
  return {
    files: files.length,
    withData: files.filter(file => String(file.data ?? "").startsWith("data:")).length,
    bytes: files.reduce((sum, file) => sum + dataBytes(file), 0),
  };
};
export const formatBytes = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

/** ── The backup document ────────────────────────────────────────────────── */
export type CrmBackup = {
  schema: typeof EXPORT_SCHEMA;
  schemaVersion: number;
  app: string;
  /** The version of the CRM DATA, separate from the version of the envelope. */
  crmVersion: 2;
  exportedAt: string;
  scope: ExportScope;
  scopeLabel: string;
  counts: ExportCounts;
  /** `none` = there is nothing to carry, `omitted` = the user chose metadata only. */
  fileContents: "included" | "omitted" | "none";
  data: CrmData;
};
const strippedFiles = (deal: Deal): Deal => ({ ...deal, files: deal.files.map(file => ({ ...file, data: "" })) });

export const buildBackup = (
  data: CrmData, scope: ExportScope,
  options: { at?: Date; includeFileContents?: boolean } = {},
): CrmBackup => {
  const selection = selectScope(data, scope);
  const includeFiles = options.includeFileContents !== false;
  const stats = fileStats(selection);
  const deals = includeFiles ? selection.deals : selection.deals.map(strippedFiles);
  return {
    schema: EXPORT_SCHEMA,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    app: EXPORT_APP,
    crmVersion: 2,
    exportedAt: (options.at ?? new Date()).toISOString(),
    scope,
    scopeLabel: EXPORT_SCOPE_LABELS[scope],
    counts: countSelection(data, selection),
    fileContents: !stats.withData ? "none" : includeFiles ? "included" : "omitted",
    data: {
      version: 2,
      organizations: selection.organizations,
      deals,
      // Labels and stages are CONFIGURATION: a table of deals without them restores to
      // unnamed colours and a default board, so they travel with every scope.
      labels: data.labels,
      pipelineStages: data.pipelineStages,
      activities: selection.inboxActivities,
    },
  };
};
export const backupJson = (backup: CrmBackup) => JSON.stringify(backup, null, 2);

/** ── CSV, the way German Excel reads it ─────────────────────────────────────
 *  Semicolon, CRLF, BOM. A cell is quoted only when it must be; a quote inside doubles;
 *  a line break survives INSIDE the quotes, so a multi-line address stays one cell. */
export const CSV_DELIMITER = ";";
export const CSV_BOM = "\uFEFF";
export const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  const normalized = text.replace(/\r\n/g, "\n");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
};
export const csvTable = (headers: string[], rows: unknown[][]): string =>
  CSV_BOM + [headers, ...rows].map(row => row.map(csvCell).join(CSV_DELIMITER)).join("\r\n") + "\r\n";

/** Multi-values keep their order and are readable in one cell. */
const joined = (values: readonly string[]) => values.filter(Boolean).join(" | ");
const oneLine = (value: string) => String(value ?? "").replace(/\s*\n\s*/g, ", ").trim();
const pad = (value: number) => `${value}`.padStart(2, "0");
/** German date notation, computed rather than localized, so a test reads the same
 *  string on every machine. An unparseable stamp yields "" — never "Invalid Date". */
export const deDate = (value: string | null | undefined): string => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) { const [y, m, d] = text.split("-"); return `${d}.${m}.${y}`; }
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? "" : `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}`;
};
export const deStamp = (value: string | null | undefined): string => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? "" : `${deDate(text)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
/** Decimal comma, because a German Excel reads "1200.5" as text and "1200,5" as money. */
export const deNumber = (value: number) => String(value).replace(".", ",");
const amountOf = (deal: Deal) => Number(String(deal.value ?? "").replace(/[^0-9,.-]/g, "").replace(",", ".")) || 0;

const orgStatus = (data: CrmData, org: Organization) =>
  isCustomer(data, org.id) ? "Kunde" : LEAD_STATE_LABELS[org.leadState];

export const ORGANIZATION_COLUMNS = [
  "ID", "Name", "Status", "Website", "Mitarbeiter", "Entscheider", "Software", "Quelle", "Verantwortlich",
  "Labels", "Standorte", "Adressen", "E-Mails", "Telefone", "Nächster Schritt", "Deals", "Gewonnene Deals",
  "Angelegt am", "Gelöscht am",
];
export const organizationRows = (data: CrmData, selection: ExportSelection): unknown[][] => {
  const labelName = (id: string) => data.labels.find(label => label.id === id)?.name ?? "";
  return selection.organizations.map(org => {
    const dealsOfOrg = selection.deals.filter(deal => deal.organizationId === org.id);
    return [
      org.id, org.name, orgStatus(data, org), org.website, org.employees, org.decisionMaker, org.software,
      org.source, org.owner, joined(org.labels.map(labelName)),
      org.locations.length,
      joined(org.locations.map(loc => oneLine(loc.address))),
      joined(org.locations.flatMap(loc => [...loc.emails, ...loc.contacts.flatMap(contact => contact.emails)])),
      joined(org.locations.flatMap(loc => [...loc.phones, ...loc.contacts.flatMap(contact => contact.phones)])),
      org.nextStep,
      dealsOfOrg.length,
      dealsOfOrg.filter(deal => deal.status === "Gewonnen").length,
      deStamp(org.createdAt), deStamp(org.deletedAt),
    ];
  });
};

export const CONTACT_COLUMNS = [
  "ID", "Name", "Position", "E-Mails", "Telefone", "Bevorzugt", "Standort", "Adresse",
  "Organisation", "Organisations-ID", "Organisationsstatus",
];
export const contactRows = (data: CrmData, selection: ExportSelection): unknown[][] =>
  selection.organizations.flatMap(org => org.locations.flatMap(location => location.contacts.map(contact => [
    contact.id, contact.name, contact.role, joined(contact.emails), joined(contact.phones), contact.preferred,
    location.name, oneLine(location.address), org.name, org.id, orgStatus(data, org),
  ])));

export const DEAL_COLUMNS = [
  "ID", "Titel", "Organisation", "Organisations-ID", "Standort", "Phase", "Status", "Wahrscheinlichkeit %",
  "Wert", "Währung", "Gewichteter Wert", "Verantwortlich", "Quelle", "Erwarteter Abschluss", "Labels",
  "Nächster Schritt", "Termin nächster Schritt", "Tage in Phase", "Notizen", "Aktivitäten", "Dateien",
  "Angelegt am", "Phase seit", "Abgeschlossen am", "Gelöscht am",
];
export const dealRows = (data: CrmData, selection: ExportSelection, at: Date = new Date()): unknown[][] => {
  const labelName = (id: string) => data.labels.find(label => label.id === id)?.name ?? "";
  const orgName = (id: string) => data.organizations.find(org => org.id === id)?.name ?? "";
  return selection.deals.map(deal => {
    const amount = amountOf(deal);
    const probability = dealProbability(data, deal);
    const location = data.organizations.find(org => org.id === deal.organizationId)?.locations.find(loc => loc.id === deal.locationId);
    return [
      deal.id, deal.title, orgName(deal.organizationId), deal.organizationId, location?.name ?? "",
      deal.stage, deal.status, probability,
      deNumber(amount), deal.currency, deNumber(Math.round(amount * probability) / 100),
      deal.owner, deal.source, deDate(deal.expectedClose), joined(deal.labels.map(labelName)),
      deal.nextStep, deDate(deal.nextStepDate), daysInStage(deal, at),
      deal.notes.length, deal.activities.length, deal.files.length,
      deStamp(deal.createdAt), deStamp(deal.stageEnteredAt), deStamp(deal.closedAt), deStamp(deal.deletedAt),
    ];
  });
};

export const ACTIVITY_COLUMNS = [
  "ID", "Art", "Titel", "Status", "Fällig am", "Uhrzeit", "Dauer (Min.)", "Priorität", "Verantwortlich",
  "Ergebnis", "Deal", "Deal-ID", "Organisation", "Organisations-ID", "Angelegt am", "Erledigt am", "Gelöscht am",
];
const ACTIVITY_STATE_LABELS: Record<string, string> = {
  done: "Erledigt", overdue: "Überfällig", today: "Heute fällig", planned: "Geplant", unscheduled: "Ohne Termin",
};
/** Every activity with the home it belongs to; an inbox item names no deal, which is
 *  the truth about it rather than a blank nobody can interpret. */
export const activityRows = (data: CrmData, selection: ExportSelection, at: Date = new Date()): unknown[][] => {
  const orgName = (id: string) => data.organizations.find(org => org.id === id)?.name ?? "";
  const row = (activity: Activity, deal: Deal | null): unknown[] => [
    activity.id, activity.kind, activity.title,
    activity.deletedAt ? "Gelöscht" : ACTIVITY_STATE_LABELS[activityState(activity, at)] ?? "",
    deDate(activity.dueDate), activity.dueTime, activity.duration || "", activity.priority, activity.owner,
    activity.outcome, deal?.title ?? "", deal?.id ?? "",
    deal ? orgName(deal.organizationId) : "", deal?.organizationId ?? "",
    deStamp(activity.createdAt), deStamp(activity.doneAt), deStamp(activity.deletedAt),
  ];
  return [
    ...selection.deals.flatMap(deal => deal.activities.map(activity => row(activity, deal))),
    ...selection.inboxActivities.map(activity => row(activity, null)),
  ];
};

/** ── The produced files ────────────────────────────────────────────────── */
export const EXPORT_FORMATS = ["json", "organizations", "contacts", "deals", "activities"] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  json: "Vollständige Sicherung (JSON)", organizations: "Organisationen (CSV)", contacts: "Kontakte (CSV)",
  deals: "Deals (CSV)", activities: "Aktivitäten (CSV)",
};
export type ExportFile = { name: string; mime: string; content: string; rows: number };

const fileStamp = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
const SCOPE_SLUGS: Record<ExportScope, string> = {
  all: "alle-daten", leads: "leads", customers: "kunden", deals: "deals", activities: "aktivitaeten",
};
export const exportFileName = (format: ExportFormat, scope: ExportScope, at: Date) =>
  format === "json"
    ? `crm-sicherung-${SCOPE_SLUGS[scope]}-${fileStamp(at)}.json`
    : `crm-${{ organizations: "organisationen", contacts: "kontakte", deals: "deals", activities: "aktivitaeten" }[format]}-${SCOPE_SLUGS[scope]}-${fileStamp(at)}.csv`;

/** How many rows a format would produce for a scope — the number the dialog shows on
 *  the checkbox, so nobody downloads an empty table by accident. */
export const formatRowCount = (data: CrmData, selection: ExportSelection, format: ExportFormat): number => {
  const counts = countSelection(data, selection);
  return format === "json" ? counts.organizations + counts.deals + counts.activities
    : format === "organizations" ? counts.organizations
      : format === "contacts" ? counts.contacts
        : format === "deals" ? counts.deals : counts.activities;
};

export type ExportOptions = { scope: ExportScope; formats: ExportFormat[]; includeFileContents?: boolean; at?: Date };
export const buildExportFiles = (data: CrmData, options: ExportOptions): ExportFile[] => {
  const at = options.at ?? new Date();
  const selection = selectScope(data, options.scope);
  const csv = (format: ExportFormat, headers: string[], rows: unknown[][]): ExportFile =>
    ({ name: exportFileName(format, options.scope, at), mime: "text/csv;charset=utf-8", content: csvTable(headers, rows), rows: rows.length });
  return options.formats.map(format => {
    if (format === "json") {
      const backup = buildBackup(data, options.scope, { at, includeFileContents: options.includeFileContents });
      return { name: exportFileName("json", options.scope, at), mime: "application/json;charset=utf-8", content: backupJson(backup), rows: formatRowCount(data, selection, "json") };
    }
    if (format === "organizations") return csv(format, ORGANIZATION_COLUMNS, organizationRows(data, selection));
    if (format === "contacts") return csv(format, CONTACT_COLUMNS, contactRows(data, selection));
    if (format === "deals") return csv(format, DEAL_COLUMNS, dealRows(data, selection, at));
    return csv(format, ACTIVITY_COLUMNS, activityRows(data, selection, at));
  });
};

/** The only side effect in this module: handing a produced file to the machine. The
 *  bytes go to the download folder of the browser (or of the desktop shell); no
 *  request is made, and there is nothing to make one to. */
export const saveExportFile = (file: ExportFile) => {
  const blob = new Blob([file.content], { type: file.mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = file.name;
  anchor.rel = "noopener";
  // Appended on purpose: a detached anchor is not clickable in every engine.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
};
