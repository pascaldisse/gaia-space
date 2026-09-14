import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "../components/Icon";
import {
  IMPORT_FIELDS, IMPORT_SOURCE_FALLBACK, autoMap, buildRows, detectHeaderRow, headersOf, isCsvName, isSpreadsheetName,
  markDuplicates, planOf, readImportFile, type ImportField, type ImportFile, type ImportResult, type ImportRow, type Mapping, type SheetTable,
} from "../crmImport";
import type { CrmData } from "../crmStore";

/** ── Importing a customer list ───────────────────────────────────────────────
 *  Three states in ONE dialog, never three screens: choose a file, LOOK at what will
 *  happen, import. The middle state is the point — a spreadsheet nobody read is how a
 *  CRM fills up with rubbish, so the rows are shown with their verdict (importable,
 *  already known, unusable) before a single record is written.
 *
 *  The column mapping is guessed and then HIDDEN behind "Zuordnung anpassen": a mapping
 *  table dumped on arrival is a technical apology to a user who usually has nothing to
 *  correct. It is one click away, and its state is visible in words above it.
 *
 *  The file never leaves the browser; the finished records are written to the same
 *  localStorage document as everything else. The dialog says so, because "where did my
 *  customer list just go" is a fair question to ask a file picker. */
const PREVIEW_LIMIT = 60;

export default function CrmImportDialog(props: { data: () => CrmData; onImport: (rows: ImportRow[]) => ImportResult; onClose: () => void }) {
  const [file, setFile] = createSignal<ImportFile | null>(null);
  const [sheetName, setSheetName] = createSignal("");
  const [headerRow, setHeaderRow] = createSignal(0);
  const [mapping, setMapping] = createSignal<Mapping>({});
  const [rows, setRows] = createSignal<ImportRow[]>([]);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<ImportResult | null>(null);
  const [showMapping, setShowMapping] = createSignal(false);

  const sheet = (): SheetTable | undefined => file()?.sheets.find(item => item.name === sheetName()) ?? file()?.sheets[0];
  const headers = () => { const table = sheet(); return table ? headersOf(table, headerRow()) : []; };
  const plan = createMemo(() => planOf(rows()));
  /** Re-reading the same table with a new header row or mapping is the whole "adjust"
   *  feature: rows are DERIVED, never patched, so the preview cannot drift from truth.
   *  Per-row decisions the user already made are carried over by line number. */
  const rebuild = (table: SheetTable, row: number, map: Mapping, keepDecisions = false) => {
    // A decision only travels if it WAS a decision: the forced skip of an unusable row
    // must not survive the mapping fix that made the row usable.
    const previous = keepDecisions ? new Map(rows().filter(item => !item.error).map(item => [item.line, item.skip])) : new Map<number, boolean>();
    setRows(buildRows(table, row, map, props.data()).map(item =>
      previous.has(item.line) && !item.error ? { ...item, skip: previous.get(item.line)! } : item));
  };

  const loadFile = async (picked: File) => {
    setError(""); setResult(null); setBusy(true);
    try {
      if (!isSpreadsheetName(picked.name)) throw new Error("Nur Excel- (.xlsx, .xls) oder CSV-Dateien.");
      const content = isCsvName(picked.name) ? await picked.text() : await picked.arrayBuffer();
      const parsed = await readImportFile(picked.name, content);
      const table = parsed.sheets.find(item => item.rows.length > 1) ?? parsed.sheets[0];
      if (!table || !table.rows.length) throw new Error("Die Datei enthält keine Zeilen.");
      const row = detectHeaderRow(table.rows);
      const map = autoMap(headersOf(table, row));
      setFile(parsed); setSheetName(table.name); setHeaderRow(row); setMapping(map);
      rebuild(table, row, map);
    } catch (reason) {
      setFile(null); setRows([]);
      setError(reason instanceof Error ? reason.message : "Die Datei konnte nicht gelesen werden.");
    } finally { setBusy(false); }
  };

  const pickSheet = (name: string) => {
    const table = file()?.sheets.find(item => item.name === name);
    if (!table) return;
    const row = detectHeaderRow(table.rows);
    const map = autoMap(headersOf(table, row));
    setSheetName(name); setHeaderRow(row); setMapping(map);
    rebuild(table, row, map);
  };
  const pickHeaderRow = (row: number) => {
    const table = sheet();
    if (!table) return;
    const map = autoMap(headersOf(table, row));
    setHeaderRow(row); setMapping(map);
    rebuild(table, row, map);
  };
  const remap = (field: ImportField, column: number | undefined) => {
    const table = sheet();
    if (!table) return;
    const next = { ...mapping() };
    if (column === undefined) delete next[field]; else next[field] = column;
    setMapping(next);
    rebuild(table, headerRow(), next, true);
  };
  /** A duplicate is a QUESTION, not a verdict: the default is skip, and the answer can
   *  be changed per row. Re-running the check after a decision would overwrite it, so
   *  the marks stay and only the checkbox moves. */
  const setSkip = (line: number, skip: boolean) =>
    setRows(current => current.map(item => item.line === line ? { ...item, skip: item.error ? true : skip } : item));
  const setAllDuplicates = (skip: boolean) =>
    setRows(current => current.map(item => item.duplicate && !item.error ? { ...item, skip } : item));
  const recheck = () => setRows(current => markDuplicates(props.data(), current));

  const run = () => {
    const outcome = props.onImport(rows());
    setResult(outcome);
    recheck();
  };

  const rowState = (row: ImportRow) => row.error ? "error" : row.duplicate ? "duplicate" : row.skip ? "skipped" : "ready";
  const rowNote = (row: ImportRow) => row.error ? row.error
    : row.duplicate ? (row.duplicate.kind === "existing" ? `Bereits im CRM: ${row.duplicate.name}` : `Doppelt in der Datei: ${row.duplicate.name}`)
      : row.values.source.trim() ? "" : `Quelle: ${IMPORT_SOURCE_FALLBACK}`;

  return <div class="crm-overlay" role="presentation">
    <div class="crm-modal crm-import" role="dialog" aria-modal="true" aria-label="Kundenliste importieren">
      <header><h2>Kundenliste importieren</h2><button type="button" class="icon-button" onClick={props.onClose} aria-label="Import schließen"><Icon name="close" /></button></header>

      <Show when={result()}>{outcome => <div class="crm-import-result" role="status">
        <strong>{outcome().imported} {outcome().imported === 1 ? "Lead importiert" : "Leads importiert"}</strong>
        <span>{outcome().skipped} übersprungen · die neuen Datensätze stehen im Lead-Posteingang.</span>
        {/* A second list is a normal next step, so the picker comes back instead of
            forcing a close-and-reopen. */}
        <button type="button" class="ghost small" onClick={() => { setFile(null); setRows([]); setResult(null); setShowMapping(false); }}>Weitere Datei importieren</button>
      </div>}</Show>

      <Show when={!file()}>
        <p>Excel (.xlsx, .xls) oder CSV. Die Datei wird <strong>lokal in diesem Fenster</strong> gelesen und nirgendwohin hochgeladen; die Datensätze landen im Lead-Posteingang.</p>
        <label class="crm-import-file">Datei wählen
          <input type="file" accept=".xlsx,.xls,.csv" aria-label="Excel- oder CSV-Datei wählen"
            onChange={event => { const picked = event.currentTarget.files?.[0]; if (picked) void loadFile(picked); }} />
        </label>
      </Show>

      <Show when={error()}><p class="crm-import-error" role="alert">{error()}</p></Show>
      <Show when={busy()}><p class="crm-muted" role="status">Datei wird gelesen…</p></Show>

      <Show when={!!file() && !!sheet()}>
        {/* ONE sentence of arithmetic, in words a salesperson uses. */}
        <p class="crm-import-summary" role="status">
          <strong>{file()!.name}</strong> · {plan().total} {plan().total === 1 ? "Zeile" : "Zeilen"} erkannt ·{" "}
          <strong>{plan().ready}</strong> {plan().ready === 1 ? "wird importiert" : "werden importiert"}
          <Show when={plan().duplicates}> · {plan().duplicates} bereits bekannt</Show>
          <Show when={plan().errors}> · {plan().errors} ohne Firmenname</Show>
        </p>

        <div class="crm-import-source">
          <Show when={(file()?.sheets.length ?? 0) > 1}>
            <label>Tabellenblatt<select value={sheetName()} onChange={event => pickSheet(event.currentTarget.value)}>
              <For each={file()!.sheets}>{item => <option value={item.name}>{item.name}</option>}</For></select></label>
          </Show>
          <label>Kopfzeile<select value={String(headerRow())} onChange={event => pickHeaderRow(Number(event.currentTarget.value))}>
            <For each={sheet()!.rows.slice(0, 20)}>{(row, index) =>
              <option value={String(index())}>Zeile {index() + 1}: {row.filter(Boolean).slice(0, 4).join(" · ").slice(0, 60) || "(leer)"}</option>}</For>
          </select></label>
        </div>

        {/* The mapping in one readable line, the table only on request. */}
        <div class="crm-import-mapping">
          <p class="crm-muted">Erkannte Spalten: {IMPORT_FIELDS.filter(field => mapping()[field.key] !== undefined).map(field => field.label).join(", ") || "keine"}.</p>
          <button type="button" class="ghost small" aria-expanded={showMapping()} onClick={() => setShowMapping(!showMapping())}>
            {showMapping() ? "Zuordnung ausblenden" : "Zuordnung anpassen"}
          </button>
          <Show when={showMapping()}>
            <div class="crm-import-map-grid">
              <For each={IMPORT_FIELDS}>{field => <label>{field.label}
                <select aria-label={`Spalte für ${field.label}`} value={mapping()[field.key] === undefined ? "" : String(mapping()[field.key])}
                  onChange={event => remap(field.key, event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value))}>
                  <option value="">— nicht importieren —</option>
                  <For each={headers()}>{(header, column) => <option value={String(column())}>{header}</option>}</For>
                </select>
                <Show when={field.hint}><small>{field.hint}</small></Show>
              </label>}</For>
            </div>
          </Show>
        </div>

        <Show when={plan().duplicates > 0}>
          <div class="crm-import-duplicates">
            <p><strong>{plan().duplicates}</strong> {plan().duplicates === 1 ? "Zeile ist" : "Zeilen sind"} bereits als Organisation vorhanden — standardmäßig übersprungen.</p>
            <span>
              <button type="button" class="ghost small" onClick={() => setAllDuplicates(true)}>Alle überspringen</button>
              <button type="button" class="ghost small" onClick={() => setAllDuplicates(false)}>Trotzdem alle importieren</button>
            </span>
          </div>
        </Show>

        <div class="crm-import-preview">
          <div class="crm-import-head"><span>Import</span><span>Firma</span><span>Ort / Adresse</span><span>Kontakt</span><span>Hinweis</span></div>
          <For each={rows().slice(0, PREVIEW_LIMIT)}>{row => <div class="crm-import-row" data-import-state={rowState(row)}>
            <label class="crm-import-check">
              <input type="checkbox" checked={!row.skip} disabled={!!row.error} aria-label={`Zeile ${row.line} importieren`}
                onChange={event => setSkip(row.line, !event.currentTarget.checked)} />
            </label>
            <strong>{row.values.name || "—"}</strong>
            <span>{row.values.address.replace(/\n/g, ", ") || "—"}</span>
            <span>{[row.values.contactName || row.values.decisionMaker, row.values.email, row.values.phone].filter(Boolean).join(" · ") || "—"}</span>
            <span class="crm-import-note">{rowNote(row)}</span>
          </div>}</For>
          <Show when={rows().length > PREVIEW_LIMIT}>
            <p class="crm-muted crm-import-more">… und {rows().length - PREVIEW_LIMIT} weitere Zeilen. Alle werden importiert, hier stehen die ersten {PREVIEW_LIMIT}.</p>
          </Show>
          <Show when={!rows().length}><p class="crm-empty">In diesem Blatt steht unter der Kopfzeile keine Datenzeile. Andere Kopfzeile oder anderes Blatt wählen.</p></Show>
        </div>
      </Show>

      <footer>
        <button type="button" class="ghost" onClick={props.onClose}>{result() ? "Fertig" : "Abbrechen"}</button>
        <Show when={file()}>
          <button type="button" class="primary" disabled={!plan().ready} onClick={run}>
            {plan().ready} {plan().ready === 1 ? "Lead importieren" : "Leads importieren"}
          </button>
        </Show>
      </footer>
    </div>
  </div>;
}
