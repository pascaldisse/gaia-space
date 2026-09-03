import { expect, test, describe, afterEach } from "bun:test";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import SheetEditor from "./SheetEditor";
import { emptySheet, parseSheet, serializeSheet, versionSnippet, type SheetDoc } from "../api/documents";

// A SHEET IS A DOCUMENT. The editor owns no save path: it edits a value and hands the
// new value back. Everything below therefore asserts on the reported value, plus the
// two keys people actually use to fill a table (Enter down, Tab across).

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
});

const grid = (): SheetDoc => ({
  columns: [
    { id: "c1", label: "Vendor", type: "text" },
    { id: "c2", label: "Amount", type: "number" },
  ],
  rows: [
    { id: "r1", cells: { c1: "Contoso", c2: "120" } },
    { id: "r2", cells: {} },
  ],
});

const mount = (initial: SheetDoc = grid(), lockedColumnIds?: string[]) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const [sheet, setSheet] = createSignal<SheetDoc>(initial);
  dispose = render(() => <SheetEditor sheet={sheet()} onChange={setSheet} lockedColumnIds={lockedColumnIds} />, host);
  return { host, sheet };
};

const cell = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

/** A column head is only its name at rest; rename / type / delete live behind it. */
const openColumnMenu = (host: HTMLElement, index: number) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Column ${index} options"]`)!.click();

describe("the sheet body format", () => {
  test("survives a round trip and repairs a body it cannot read", () => {
    const original = grid();
    expect(parseSheet(serializeSheet(original))).toEqual({
      columns: original.columns,
      rows: [{ id: "r1", cells: { c1: "Contoso", c2: "120" } }, { id: "r2", cells: {} }],
    });
    expect(parseSheet("{not json").columns.length).toBe(3);
    expect(parseSheet(null).rows.length).toBe(emptySheet().rows.length);
    const v2 = parseSheet('{"columns":[{"id":"p","label":"Owner","type":"person"},{"id":"f","label":"Total","type":"formula","formula":"[Amount] * 2","aggregate":"sum"}],"rows":[{"id":"r","cells":{"p":"ada","f":"999"}}]}');
    expect(v2).toEqual({ columns: [{ id: "p", label: "Owner", type: "person" }, { id: "f", label: "Total", type: "formula", formula: "[Amount] * 2", aggregate: "sum" }], rows: [{ id: "r", cells: { p: "ada" } }] });
    expect(serializeSheet(v2)).not.toContain('"f":"999"');
    // A cell addressed to a column that does not exist is dropped, never handed on:
    // the server would refuse the whole grid for it.
    expect(parseSheet('{"columns":[{"id":"c1","label":"A","type":"text"}],"rows":[{"id":"r1","cells":{"ghost":"x"}}]}').rows)
      .toEqual([{ id: "r1", cells: {} }]);
  });

  test("a version of a table is described in words, never as its JSON", () => {
    const body = serializeSheet({ ...grid(), columns: [...grid().columns, { id: "c3", label: "Column 3", type: "text" }] });
    expect(versionSnippet("sheet", body)).toBe("3 columns × 2 rows · Vendor, Amount, Column 3");
    expect(versionSnippet("sheet", body)).not.toContain("{");
    // A body nobody can read stays a table, and takes nothing down with it.
    expect(versionSnippet("sheet", '{"columns":[{"id"')).toBe("Table");
    expect(versionSnippet("sheet", "")).toBe("Table");
    expect(versionSnippet("sheet", '{"columns":[]}')).toBe("Table");
    expect(versionSnippet("sheet", '{"columns":[{"id":"c1","label":"Only","type":"text"}]}')).toBe("1 column × 0 rows · Only");
    // Prose is untouched: the old text preview, verbatim.
    expect(versionSnippet("doc", "# Heading\nbody")).toBe("# Heading\nbody");
    expect(versionSnippet("doc", "")).toBe("(empty)");
  });
});

describe("the sheet editor", () => {
  test("reports a typed cell, a renamed column and a retyped column", () => {
    const { host, sheet } = mount();
    const target = cell(host, "Amount row 2");
    target.value = "42";
    target.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sheet().rows[1].cells.c2).toBe("42");

    // At rest the head shows the name and no controls at all.
    expect(host.querySelector('input[aria-label="Column 1 name"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Column 1 options"]')!.textContent).toContain("Vendor");

    openColumnMenu(host, 1);
    const head = cell(host, "Column 1 name");
    head.value = "Supplier";
    head.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sheet().columns[0].label).toBe("Supplier");

    openColumnMenu(host, 2);
    const type = host.querySelector<HTMLSelectElement>('select[aria-label="Column 2 type"]')!;
    type.value = "date";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sheet().columns[1].type).toBe("date");
  });

  test("adds and deletes rows and columns, and a deleted column takes its values with it", () => {
    const { host, sheet } = mount();
    host.querySelector<HTMLButtonElement>('button[aria-label="Add row"]')!.click();
    expect(sheet().rows.length).toBe(3);
    host.querySelector<HTMLButtonElement>('button[aria-label="Add column"]')!.click();
    expect(sheet().columns.length).toBe(3);

    host.querySelector<HTMLButtonElement>('button[aria-label="Delete row 1"]')!.click();
    expect(sheet().rows.map((row) => row.id)).not.toContain("r1");

    openColumnMenu(host, 1);
    host.querySelector<HTMLButtonElement>('button[aria-label="Delete column 1"]')!.click();
    expect(sheet().columns.map((column) => column.id)).not.toContain("c1");
    expect(sheet().rows.every((row) => !("c1" in row.cells))).toBe(true);
  });

  test("Enter walks down the column and Tab walks across the row", () => {
    const { host, sheet } = mount();
    const first = cell(host, "Vendor row 1");
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement).toBe(cell(host, "Vendor row 2"));

    cell(host, "Vendor row 2").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(cell(host, "Amount row 2"));

    // At the far corner the sheet grows rather than trapping the typist.
    cell(host, "Amount row 2").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(sheet().rows.length).toBe(3);
  });

  test("the column menu opens on the head, closes on Escape and gives focus back", () => {
    const { host } = mount();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Column 1 options"]')!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Column 1"]')!;
    expect(menu.querySelector('select[aria-label="Column 1 type"]')).not.toBeNull();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelector('[role="dialog"][aria-label="Column 1"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[aria-label="Column 1 options"]'));
  });

  test("renders computed formula values read-only", () => {
    const { host } = mount({ columns: [{ id: "amount", label: "Amount", type: "number" }, { id: "total", label: "Total", type: "formula", formula: "[amount] * 2" }], rows: [{ id: "r1", cells: { amount: "4", total: "999" } }] });
    const value = host.querySelector<HTMLElement>('[aria-label="Total row 1"]')!;
    expect(value.tagName).toBe("SPAN");
    expect(value.textContent).toBe("8");
  });
  test("does not offer deletion or type changes for locked columns", () => {
    const { host } = mount(grid(), ["c1"]);
    openColumnMenu(host, 1);
    expect(host.querySelector('[aria-label="Delete column 1"]')).toBeNull();
    expect(host.querySelector('[aria-label="Column 1 type"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[aria-label="Column 1 name"]')).not.toBeNull();
  });
  test("renders configured aggregate footer", () => {
    const { host } = mount({ columns: [{ id: "amount", label: "Amount", type: "number", aggregate: "sum" }], rows: [{ id: "r1", cells: { amount: "2" } }, { id: "r2", cells: { amount: "3" } }] });
    expect(host.querySelector('.sheet-aggregate-cell')?.textContent).toBe("5");
  });
  test("Escape puts the stored value back into the cell", () => {
    const { host } = mount();
    const target = cell(host, "Vendor row 1");
    target.focus();
    target.value = "typo";
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(target.value).toBe("Contoso");
  });
});
