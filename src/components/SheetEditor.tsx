import { createResource, createSignal, For, Show, onCleanup, type JSX } from "solid-js";
import {
  newColumnId,
  newRowId,
  type SheetColumn,
  type SheetColumnType,
  type SheetDoc,
  type SheetRow,
documentsApi,
} from "../api/documents";
import { evaluateSheet } from "../sheetFormula";
import "./SheetEditor.css";

/** ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 *  A `sheet` document is a document first and a grid second: it lives in the same
 *  folders, obeys the same permissions, keeps the same versions and is found by the
 *  same search as every other page. So this component owns NO save path of its own —
 *  it edits a value and reports the new value upward. The page's existing
 *  "Save version" button is still the one and only way content reaches the database.
 *
 *  Keyboard: Enter moves down the column (and grows the sheet at the bottom edge),
 *  Tab moves to the next cell and wraps into the next row, Escape abandons the cell.
 *
 *  A COLUMN HEAD SAYS ITS NAME AND NOTHING ELSE. Renaming, the value type and dropping
 *  the column are one decision about one column, so they live in ONE place that opens
 *  on the head itself — no permanent row of selects shouting "Text ⌄" over every
 *  column. The head is a button: it is reachable by keyboard, and Escape closes it.
 */

export type SheetEditorProps = {
  sheet: SheetDoc;
  onChange: (sheet: SheetDoc) => void;
  disabled?: boolean;
lockedColumnIds?: string[];
};

export const cellLabel = (column: SheetColumn, rowIndex: number) => `${column.label || "Column"} row ${rowIndex + 1}`;
const cellKey = (rowId: string, columnId: string) => `${rowId}:${columnId}`;

const COLUMN_TYPES: { value: SheetColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
{ value: "person", label: "Person" },
{ value: "formula", label: "Formula" },
];
const AGGREGATES = ["none", "sum", "avg", "min", "max", "count"] as const;

export function emptyRow(): SheetRow {
  return { id: newRowId(), cells: {} };
}

export function emptyColumn(index: number): SheetColumn {
  return { id: newColumnId(), label: `Column ${index + 1}`, type: "text" };
}

export default function SheetEditor(props: SheetEditorProps): JSX.Element {
  let grid: HTMLDivElement | undefined;
  const [openColumn, setOpenColumn] = createSignal<string | null>(null);
const [profiles] = createResource(
() => props.sheet.columns.some((column) => column.type === "person") ? "profiles" : null,
() => documentsApi.listProfiles(),
);
const computed = () => evaluateSheet(props.sheet);
const isLocked = (columnId: string) => props.lockedColumnIds?.includes(columnId) ?? false;

  /** Clicking anywhere else is an answer too: the menu closes without a verdict. */
  const onDocumentPointerDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".sheet-column-head")) return;
    setOpenColumn(null);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("mousedown", onDocumentPointerDown);
    onCleanup(() => document.removeEventListener("mousedown", onDocumentPointerDown));
  }

  function toggleColumnMenu(columnId: string) {
    setOpenColumn((current) => (current === columnId ? null : columnId));
  }

  function closeColumnMenu(columnId: string) {
    if (openColumn() !== columnId) return;
    setOpenColumn(null);
    grid?.querySelector<HTMLButtonElement>(`[data-column-trigger="${columnId}"]`)?.focus();
  }

  const columns = () => props.sheet.columns;
  const rows = () => props.sheet.rows;
  const emit = (sheet: SheetDoc) => props.onChange(sheet);

  function focusCell(rowId: string, columnId: string) {
    const target = grid?.querySelector<HTMLElement>(`[data-cell="${cellKey(rowId, columnId)}"]`);
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
  }

  function setCell(rowId: string, columnId: string, value: string) {
    emit({
      ...props.sheet,
      rows: rows().map((row) => (row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row)),
    });
  }

  function renameColumn(columnId: string, label: string) {
    emit({ ...props.sheet, columns: columns().map((c) => (c.id === columnId ? { ...c, label } : c)) });
  }

  function retypeColumn(columnId: string, type: SheetColumnType) {
    if (isLocked(columnId)) return;
    emit({ ...props.sheet, columns: columns().map((c) => (c.id === columnId ? { ...c, type } : c)) });
  }
  function setFormula(columnId: string, formula: string) {
    emit({ ...props.sheet, columns: columns().map((c) => (c.id === columnId ? { ...c, formula } : c)) });
  }
  function setAggregate(columnId: string, aggregate: SheetColumn["aggregate"]) {
    emit({ ...props.sheet, columns: columns().map((c) => (c.id === columnId ? { ...c, aggregate } : c)) });
  }

  function addColumn() {
    emit({ ...props.sheet, columns: [...columns(), emptyColumn(columns().length)] });
  }

  /** Deleting a column deletes its values with it — nothing is left addressing a
   *  column that no longer exists, which the server would refuse anyway. */
  function removeColumn(columnId: string) {
    if (isLocked(columnId)) return;
    const remaining = columns().filter((c) => c.id !== columnId);
    emit({
      columns: remaining,
      rows: rows().map((row) => {
        const cells = { ...row.cells };
        delete cells[columnId];
        return { ...row, cells };
      }),
    });
  }

  function addRow(): SheetRow {
    const row = emptyRow();
    emit({ ...props.sheet, rows: [...rows(), row] });
    return row;
  }

  function removeRow(rowId: string) {
    emit({ ...props.sheet, rows: rows().filter((row) => row.id !== rowId) });
  }

  function moveDown(rowIndex: number, column: SheetColumn) {
    const next = rows()[rowIndex + 1];
    if (next) {
      focusCell(next.id, column.id);
      return;
    }
    const created = addRow();
    // The row is added through the parent's signal; the input exists one frame later.
    setTimeout(() => focusCell(created.id, column.id), 0);
  }

  function moveNext(rowIndex: number, columnIndex: number) {
    const nextColumn = columns()[columnIndex + 1];
    const row = rows()[rowIndex];
    if (nextColumn && row) {
      focusCell(row.id, nextColumn.id);
      return true;
    }
    const first = columns()[0];
    if (!first) return false;
    const nextRow = rows()[rowIndex + 1];
    if (nextRow) {
      focusCell(nextRow.id, first.id);
      return true;
    }
    const created = addRow();
    setTimeout(() => focusCell(created.id, first.id), 0);
    return true;
  }

  function onCellKeyDown(event: KeyboardEvent, rowIndex: number, columnIndex: number) {
    const column = columns()[columnIndex];
    if (!column) return;
    if (event.key === "Enter") {
      event.preventDefault();
      moveDown(rowIndex, column);
    } else if (event.key === "Tab" && !event.shiftKey) {
      if (moveNext(rowIndex, columnIndex)) event.preventDefault();
    } else if (event.key === "Escape") {
      const input = event.currentTarget as HTMLInputElement;
      const row = rows()[rowIndex];
      input.value = row?.cells[column.id] ?? "";
      input.blur();
    }
  }

  return (
    <div class="sheet-editor" ref={(el) => (grid = el)}>
      <div class="sheet-scroll">
        <table class="sheet-grid">
          <thead>
            <tr>
              <th class="sheet-gutter" scope="col"><span class="sheet-gutter-head">#</span></th>
              <For each={columns()}>
                {(column, columnIndex) => (
                  <th scope="col">
                    <div
                      class="sheet-column-head"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          closeColumnMenu(column.id);
                        }
                      }}
                    >
                      <button
                        type="button"
                        class="sheet-column-trigger"
                        data-column-trigger={column.id}
                        aria-label={`Column ${columnIndex() + 1} options`}
                        aria-haspopup="dialog"
                        aria-expanded={openColumn() === column.id}
                        disabled={props.disabled}
                        onClick={() => toggleColumnMenu(column.id)}
                      >
                        <span class="sheet-column-name">{column.label || `Column ${columnIndex() + 1}`}</span>
                        <span class="sheet-column-caret" aria-hidden="true">⌄</span>
                      </button>
                      <Show when={openColumn() === column.id}>
                        <div class="sheet-column-menu" role="dialog" aria-label={`Column ${columnIndex() + 1}`}>
                          <input
                            class="sheet-column-label"
                            aria-label={`Column ${columnIndex() + 1} name`}
                            value={column.label}
                            ref={(el) => setTimeout(() => { el.focus(); el.select(); }, 0)}
                            onInput={(event) => renameColumn(column.id, event.currentTarget.value)}
                          />
                          <Show when={!isLocked(column.id)}>
                            <select class="sheet-column-type" aria-label={`Column ${columnIndex() + 1} type`} value={column.type} onChange={(event) => retypeColumn(column.id, event.currentTarget.value as SheetColumnType)}>
                              <For each={COLUMN_TYPES}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                            </select>
                          </Show>
                          <Show when={column.type === "formula"}>
                            <textarea class="sheet-column-formula" aria-label={`Column ${columnIndex() + 1} formula`} value={column.formula ?? ""} onInput={(event) => setFormula(column.id, event.currentTarget.value)} />
                          </Show>
                          <select class="sheet-column-aggregate" aria-label={`Column ${columnIndex() + 1} aggregate`} value={column.aggregate ?? "none"} onChange={(event) => setAggregate(column.id, event.currentTarget.value as SheetColumn["aggregate"])}>
                            <For each={AGGREGATES}>{(aggregate) => <option value={aggregate}>{aggregate}</option>}</For>
                          </select>
                          <Show when={!isLocked(column.id)}>
                            <button type="button" class="ghost small sheet-column-delete" aria-label={`Delete column ${columnIndex() + 1}`} disabled={columns().length <= 1} onClick={() => { removeColumn(column.id); setOpenColumn(null); }}>
                              Delete column
                            </button>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </th>
                )}
              </For>
              <th class="sheet-add-column" scope="col">
                <button type="button" class="ghost small" aria-label="Add column" disabled={props.disabled} onClick={addColumn}>
                  + Column
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row, rowIndex) => (
                <tr>
                  <th class="sheet-gutter" scope="row">{rowIndex() + 1}</th>
                  <For each={columns()}>
                    {(column, columnIndex) => (
                      <td>
                        <Show when={column.type === "formula"} fallback={<Show when={column.type === "person"} fallback={<input class="sheet-cell" data-cell={cellKey(row.id, column.id)} aria-label={cellLabel(column, rowIndex())} type={column.type === "date" ? "date" : column.type === "number" ? "number" : "text"} value={row.cells[column.id] ?? ""} disabled={props.disabled} onInput={(event) => setCell(row.id, column.id, event.currentTarget.value)} onKeyDown={(event) => onCellKeyDown(event, rowIndex(), columnIndex())} />}>
                          <select class="sheet-cell" data-cell={cellKey(row.id, column.id)} aria-label={cellLabel(column, rowIndex())} value={row.cells[column.id] ?? ""} disabled={props.disabled} onChange={(event) => setCell(row.id, column.id, event.currentTarget.value)} onKeyDown={(event) => onCellKeyDown(event, rowIndex(), columnIndex())}><option value="">—</option><For each={profiles() ?? []}>{(profile) => <option value={profile.id}>{profile.display_name || profile.username}</option>}</For></select>
                        </Show>}>
                          <span class="sheet-formula-cell" data-cell={cellKey(row.id, column.id)} aria-label={cellLabel(column, rowIndex())} tabindex="0" onKeyDown={(event) => onCellKeyDown(event, rowIndex(), columnIndex())}>{computed().cells[row.id]?.[column.id] ?? "#ERR"}</span>
                        </Show>
                      </td>
                    )}
                  </For>
                  <td class="sheet-row-actions">
                    <button
                      type="button"
                      class="ghost small sheet-drop"
                      aria-label={`Delete row ${rowIndex() + 1}`}
                      disabled={props.disabled || rows().length <= 1}
                      onClick={() => removeRow(row.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
          <Show when={columns().some((column) => (column.aggregate ?? "none") !== "none")}>
            <tfoot><tr><th class="sheet-gutter" scope="row">Σ</th><For each={columns()}>{(column) => <td class="sheet-aggregate-cell">{computed().aggregates[column.id] ?? ""}</td>}</For><td /></tr></tfoot>
          </Show>
        </table>
      </div>
      <div class="sheet-foot">
        <button type="button" class="ghost small" aria-label="Add row" disabled={props.disabled} onClick={() => addRow()}>
          + Row
        </button>
        <Show when={!props.disabled}>
          <span class="sheet-hint">Enter — next row · Tab — next cell</span>
        </Show>
      </div>
    </div>
  );
}
