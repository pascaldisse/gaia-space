import { describe, expect, test } from "bun:test";
import { evaluateFormula, evaluateSheet } from "./sheetFormula";
import type { SheetDoc } from "./api/documents";

const formula = (input: string, refs: Record<string, string> = {}) => evaluateFormula(input, (reference) => refs[reference]);
const sheet = (columns: SheetDoc["columns"], rows: SheetDoc["rows"]): SheetDoc => ({ columns, rows });

describe("sheet formulas", () => {
  test("honours multiplication precedence", () => expect(formula("2 + 3 * 4")).toBe("14"));
  test("honours parentheses", () => expect(formula("(2 + 3) * 4")).toBe("20"));
  test("supports unary minus", () => expect(formula("-2 * 3")).toBe("-6"));
  test("resolves bracket labels", () => expect(formula("[Amount] + 1", { "[Amount]": "4" })).toBe("5"));
  test("resolves id references", () => expect(formula("{c_amount} * 2", { "{c_amount}": "3" })).toBe("6"));
  test("SUM accepts many values", () => expect(formula("SUM(1, 2, 3)")).toBe("6"));
  test("MIN accepts many values", () => expect(formula("MIN(9, 2, 3)")).toBe("2"));
  test("MAX accepts many values", () => expect(formula("MAX(9, 2, 3)")).toBe("9"));
  test("AVG accepts many values", () => expect(formula("AVG(2, 3, 4)")).toBe("3"));
  test("ABS works", () => expect(formula("ABS(-4)")).toBe("4"));
  test("ROUND defaults to integer", () => expect(formula("ROUND(2.6)")).toBe("3"));
  test("ROUND accepts digits", () => expect(formula("ROUND(1.235, 2)")).toBe("1.24"));
  test("IF selects true branch", () => expect(formula("IF(2 > 1, 7, 8)")).toBe("7"));
  test("IF selects false branch", () => expect(formula("IF(2 < 1, 7, 8)")).toBe("8"));
  test("comparisons return one or zero", () => expect(formula("4 <> 4")).toBe("0"));
  test("unknown reference is REF", () => expect(formula("[Missing] + 1")).toBe("#REF"));
  test("division by zero is explicit", () => expect(formula("4 / 0")).toBe("#DIV/0"));
  test("invalid grammar never throws", () => expect(formula("SUM(")).toBe("#ERR"));
  test("non-numeric references are zero", () => expect(formula("[Name] + 1", { "[Name]": "Ada" })).toBe("1"));
  test("labels are case-insensitive and first match wins", () => {
    const result = evaluateSheet(sheet([
      { id: "a", label: "Amount", type: "number" }, { id: "b", label: "amount", type: "number" },
      { id: "total", label: "Total", type: "formula", formula: "[AMOUNT] * 2" },
    ] as SheetDoc["columns"], [{ id: "r", cells: { a: "5", b: "8" } }]));
    expect(result.cells.r.total).toBe("10");
  });
  test("formula columns are computed per row", () => {
    const result = evaluateSheet(sheet([
      { id: "qty", label: "Qty", type: "number" }, { id: "price", label: "Price", type: "number" },
      { id: "total", label: "Total", type: "formula", formula: "[qty] * {price}" },
    ] as SheetDoc["columns"], [{ id: "r", cells: { qty: "3", price: "4", total: "stored but ignored" } }]));
    expect(result.cells.r.total).toBe("12");
  });
  test("transitive formula cycles are marked", () => {
    const result = evaluateSheet(sheet([
      { id: "a", label: "A", type: "formula", formula: "[B]" }, { id: "b", label: "B", type: "formula", formula: "[A]" },
    ] as SheetDoc["columns"], [{ id: "r", cells: {} }]));
    expect(result.cells.r).toEqual({ a: "#CYCLE", b: "#CYCLE" });
  });
  test("sum aggregate uses computed values", () => {
    const result = evaluateSheet(sheet([
      { id: "a", label: "A", type: "number", aggregate: "sum" }, { id: "b", label: "B", type: "formula", formula: "[A] * 2", aggregate: "avg" },
    ] as SheetDoc["columns"], [{ id: "r1", cells: { a: "2" } }, { id: "r2", cells: { a: "4" } }]));
    expect(result.aggregates).toEqual({ a: "6", b: "6" });
  });
  test("count aggregate counts only non-empty cells", () => {
    const result = evaluateSheet(sheet([{ id: "a", label: "A", type: "text", aggregate: "count" }] as SheetDoc["columns"], [
      { id: "r1", cells: { a: "x" } }, { id: "r2", cells: { a: "" } }, { id: "r3", cells: {} },
    ]));
    expect(result.aggregates.a).toBe("1");
  });
});
