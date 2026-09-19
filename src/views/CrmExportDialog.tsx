import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "../components/Icon";
import {
  EXPORT_FORMATS, EXPORT_FORMAT_LABELS, EXPORT_SCOPES, EXPORT_SCOPE_HINTS, EXPORT_SCOPE_LABELS,
  buildExportFiles, countSelection, fileStats, formatBytes, formatRowCount, saveExportFile, selectScope,
  type ExportFile, type ExportFormat, type ExportScope,
} from "../crmExport";
import type { CrmData } from "../crmStore";

/** ── Taking the data out ─────────────────────────────────────────────────────
 *  The dialog answers three questions in the order a person asks them: WHAT (scope),
 *  IN WHICH FORM (backup and/or tables), and WHAT WILL I GET (counts, file names).
 *  Nothing is described in the abstract — every choice carries the number of records it
 *  will actually write, so an empty table cannot be downloaded by accident.
 *
 *  The backup is checked by default because portability is the point: a JSON that reads
 *  back losslessly is the file that outlives this app. CSV is for working, not for
 *  migrating, and the dialog says which is which.
 *
 *  Attached files are stated, never guessed at: the count and the size of the embedded
 *  data URLs stand in the UI, together with the switch that leaves them out. */
export default function CrmExportDialog(props: { data: () => CrmData; onClose: () => void; onSave?: (file: ExportFile) => void }) {
  const [scope, setScope] = createSignal<ExportScope>("all");
  const [formats, setFormats] = createSignal<ExportFormat[]>(["json"]);
  const [includeFiles, setIncludeFiles] = createSignal(true);
  const [done, setDone] = createSignal<ExportFile[] | null>(null);

  const selection = createMemo(() => selectScope(props.data(), scope()));
  const counts = createMemo(() => countSelection(props.data(), selection()));
  const files = createMemo(() => fileStats(selection()));
  const rowsOf = (format: ExportFormat) => formatRowCount(props.data(), selection(), format);
  const chosen = () => formats().filter(format => rowsOf(format) > 0);

  const pickScope = (next: ExportScope) => { setScope(next); setDone(null); };
  const toggleFormat = (format: ExportFormat, on: boolean) => {
    setDone(null);
    setFormats(current => on ? [...EXPORT_FORMATS.filter(item => item === format || current.includes(item))] : current.filter(item => item !== format));
  };

  const run = () => {
    const produced = buildExportFiles(props.data(), { scope: scope(), formats: chosen(), includeFileContents: includeFiles() });
    produced.forEach(file => (props.onSave ?? saveExportFile)(file));
    setDone(produced);
  };

  const countLine = () => {
    const c = counts();
    return [
      `${c.organizations} ${c.organizations === 1 ? "Organisation" : "Organisationen"}`,
      `${c.contacts} ${c.contacts === 1 ? "Kontakt" : "Kontakte"}`,
      `${c.deals} ${c.deals === 1 ? "Deal" : "Deals"}`,
      `${c.activities} ${c.activities === 1 ? "Aktivität" : "Aktivitäten"}`,
      `${c.notes} ${c.notes === 1 ? "Notiz" : "Notizen"}`,
    ].join(" · ");
  };

  return <div class="crm-overlay" role="presentation">
    <div class="crm-modal crm-export" role="dialog" aria-modal="true" aria-label="CRM-Daten exportieren">
      <header><h2>Daten exportieren</h2><button type="button" class="icon-button" onClick={props.onClose} aria-label="Export schließen"><Icon name="close" /></button></header>

      <p>Alle Daten gehören dir. Der Export wird <strong>lokal in diesem Fenster</strong> erzeugt und als Datei heruntergeladen – nichts wird hochgeladen.</p>

      <fieldset class="crm-export-scopes">
        <legend>Umfang</legend>
        <For each={EXPORT_SCOPES}>{item => {
          const rows = () => { const c = countSelection(props.data(), selectScope(props.data(), item)); return c.organizations + c.deals + c.activities; };
          return <label class="crm-export-scope" data-export-scope={item} data-active={scope() === item}>
            <input type="radio" name="crm-export-scope" checked={scope() === item} onChange={() => pickScope(item)} aria-label={EXPORT_SCOPE_LABELS[item]} />
            <span>
              <strong>{EXPORT_SCOPE_LABELS[item]}</strong>
              <small>{EXPORT_SCOPE_HINTS[item]}</small>
            </span>
            <em class="crm-export-count">{rows()} {rows() === 1 ? "Datensatz" : "Datensätze"}</em>
          </label>;
        }}</For>
      </fieldset>

      <p class="crm-export-summary" role="status">Ausgewählt: <strong>{EXPORT_SCOPE_LABELS[scope()]}</strong> · {countLine()}</p>

      <fieldset class="crm-export-formats">
        <legend>Format</legend>
        <For each={EXPORT_FORMATS}>{format => {
          const rows = () => rowsOf(format);
          return <label class="crm-export-format" data-export-format={format} data-empty={rows() === 0}>
            <input type="checkbox" checked={formats().includes(format)} disabled={rows() === 0}
              aria-label={EXPORT_FORMAT_LABELS[format]}
              onChange={event => toggleFormat(format, event.currentTarget.checked)} />
            <span>
              <strong>{EXPORT_FORMAT_LABELS[format]}</strong>
              <small>{format === "json"
                ? "Verlustfrei und versioniert – die Datei für einen Umzug oder eine Wiederherstellung."
                : "Semikolon-getrennt, UTF-8 mit BOM – öffnet direkt in deutschem Excel."}</small>
            </span>
            <em class="crm-export-count">{rows() === 0 ? "nichts vorhanden" : `${rows()} ${format === "json" ? "Datensätze" : rows() === 1 ? "Zeile" : "Zeilen"}`}</em>
          </label>;
        }}</For>
      </fieldset>

      {/* The one honest sentence about attachments. */}
      <div class="crm-export-files">
        <Show when={files().withData > 0} fallback={
          <p class="crm-muted">An Deals hängen derzeit {files().files === 0 ? "keine Dateien" : `${files().files} Datei-Verweise ohne gespeicherten Inhalt`}. Die Sicherung enthält deshalb nur Datei-Metadaten (Name, Typ, Datum).</p>
        }>
          <label class="crm-export-toggle">
            <input type="checkbox" checked={includeFiles()} onChange={event => { setIncludeFiles(event.currentTarget.checked); setDone(null); }} aria-label="Dateiinhalte einbetten" />
            <span><strong>Dateiinhalte einbetten</strong>
              <small>{files().withData} von {files().files} Dateien liegen als Daten-URL im Browser-Speicher (≈ {formatBytes(files().bytes)}) und wandern mit in die JSON-Sicherung. Ohne Haken werden nur Name, Typ und Datum exportiert.</small></span>
          </label>
        </Show>
      </div>

      <Show when={done()}>{produced => <div class="crm-export-result" role="status">
        <strong>{produced().length} {produced().length === 1 ? "Datei erzeugt" : "Dateien erzeugt"}</strong>
        <ul><For each={produced()}>{file => <li>{file.name} · {file.rows} {file.rows === 1 ? "Datensatz" : "Datensätze"}</li>}</For></ul>
        <span class="crm-muted">Die Dateien liegen im Download-Ordner dieses Geräts.</span>
      </div>}</Show>

      <footer>
        <button type="button" class="ghost" onClick={props.onClose}>{done() ? "Fertig" : "Abbrechen"}</button>
        <button type="button" class="primary" disabled={!chosen().length} onClick={run}>
          <Icon name="download" size={16} /> {chosen().length || ""} {chosen().length === 1 ? "Datei exportieren" : "Dateien exportieren"}
        </button>
      </footer>
    </div>
  </div>;
}
