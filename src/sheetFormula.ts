import type { SheetDoc } from "./api/documents";

type V2Column = { id: string; label: string; type: string; formula?: string; aggregate?: "sum" | "avg" | "min" | "max" | "count" | "none" };
type V2Sheet = { columns: V2Column[]; rows: { id: string; cells: Record<string, string> }[] };

export type FormulaResolver = (reference: string) => string | undefined;
export type SheetEvaluation = {
  cells: Record<string, Record<string, string>>;
  aggregates: Record<string, string>;
};

type Token = { kind: "number" | "ref" | "identifier" | "operator" | "paren" | "comma" | "end"; value: string };
type Value = number | "#REF" | "#DIV/0" | "#ERR" | "#CYCLE";
const ERRORS = new Set<string>(["#REF", "#DIV/0", "#ERR", "#CYCLE"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === "[") {
      const end = input.indexOf("]", i + 1);
      if (end < 0) throw new Error("reference");
      tokens.push({ kind: "ref", value: input.slice(i, end + 1) }); i = end + 1; continue;
    }
    if (char === "{") {
      const end = input.indexOf("}", i + 1);
      if (end < 0) throw new Error("reference");
      tokens.push({ kind: "ref", value: input.slice(i, end + 1) }); i = end + 1; continue;
    }
    const number = input.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { tokens.push({ kind: "number", value: number[0] }); i += number[0].length; continue; }
    const identifier = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) { tokens.push({ kind: "identifier", value: identifier[0] }); i += identifier[0].length; continue; }
    const pair = input.slice(i, i + 2);
    if (["<=", ">=", "<>", "!="].includes(pair)) { tokens.push({ kind: "operator", value: pair === "!=" ? "<>" : pair }); i += 2; continue; }
    if ("+-*/=<>".includes(char)) { tokens.push({ kind: "operator", value: char }); i += 1; continue; }
    if (char === "(") { tokens.push({ kind: "paren", value: char }); i += 1; continue; }
    if (char === ")") { tokens.push({ kind: "paren", value: char }); i += 1; continue; }
    if (char === ",") { tokens.push({ kind: "comma", value: char }); i += 1; continue; }
    throw new Error("token");
  }
  tokens.push({ kind: "end", value: "" });
  return tokens;
}

const isError = (value: Value): value is Exclude<Value, number> => typeof value === "string" && ERRORS.has(value);
const numeric = (value: string | undefined): Value => {
  if (value === undefined) return "#REF";
  if (ERRORS.has(value)) return value as Exclude<Value, number>;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const firstError = (values: Value[]): Exclude<Value, number> | null => values.find(isError) ?? null;
const display = (value: Value): string => typeof value === "number" ? (Object.is(value, -0) ? "0" : String(value)) : value;

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly resolveRef: FormulaResolver) {}
  private current() { return this.tokens[this.index]; }
  private take() { return this.tokens[this.index++]; }
  private accept(kind: Token["kind"], value?: string) {
    const token = this.current();
    if (token.kind !== kind || (value !== undefined && token.value !== value)) return false;
    this.index += 1; return true;
  }
  parse(): Value {
    const value = this.comparison();
    if (this.current().kind !== "end") throw new Error("trailing");
    return value;
  }
  private comparison(): Value {
    let left = this.additive();
    while (this.current().kind === "operator" && ["=", "<>", "<", "<=", ">", ">="].includes(this.current().value)) {
      const operator = this.take().value; const right = this.additive();
      const error = firstError([left, right]); if (error) { left = error; continue; }
      const lhs = left as number; const rhs = right as number;
      switch (operator) { case "=": left = lhs === rhs ? 1 : 0; break; case "<>": left = lhs !== rhs ? 1 : 0; break; case "<": left = lhs < rhs ? 1 : 0; break; case "<=": left = lhs <= rhs ? 1 : 0; break; case ">": left = lhs > rhs ? 1 : 0; break; default: left = lhs >= rhs ? 1 : 0; }
    }
    return left;
  }
  private additive(): Value {
    let left = this.multiplicative();
    while (this.current().kind === "operator" && ["+", "-"].includes(this.current().value)) {
      const op = this.take().value; const right = this.multiplicative(); const error = firstError([left, right]);
      left = error ?? (op === "+" ? (left as number) + (right as number) : (left as number) - (right as number));
    }
    return left;
  }
  private multiplicative(): Value {
    let left = this.unary();
    while (this.current().kind === "operator" && ["*", "/"].includes(this.current().value)) {
      const op = this.take().value; const right = this.unary(); const error = firstError([left, right]);
      if (error) left = error;
      else if (op === "/" && (right as number) === 0) left = "#DIV/0";
      else left = op === "*" ? (left as number) * (right as number) : (left as number) / (right as number);
    }
    return left;
  }
  private unary(): Value {
    if (this.accept("operator", "-")) { const value = this.unary(); return isError(value) ? value : -(value as number); }
    if (this.accept("operator", "+")) return this.unary();
    return this.primary();
  }
  private primary(): Value {
    const token = this.take();
    if (token.kind === "number") return Number(token.value);
    if (token.kind === "ref") return numeric(this.resolveRef(token.value));
    if (token.kind === "paren" && token.value === "(") {
      const value = this.comparison(); if (!this.accept("paren", ")")) throw new Error("paren"); return value;
    }
    if (token.kind === "identifier") return this.function(token.value);
    throw new Error("primary");
  }
  private function(name: string): Value {
    if (!this.accept("paren", "(")) throw new Error("function");
    const args: Value[] = [];
    if (!this.accept("paren", ")")) {
      do { args.push(this.comparison()); } while (this.accept("comma"));
      if (!this.accept("paren", ")")) throw new Error("args");
    }
    const error = firstError(args); if (error) return error;
    const nums = args as number[];
    switch (name.toUpperCase()) {
      case "SUM": return nums.reduce((sum, value) => sum + value, 0);
      case "MIN": return args.length ? Math.min(...nums) : "#ERR";
      case "MAX": return args.length ? Math.max(...nums) : "#ERR";
      case "AVG": return args.length ? nums.reduce((sum, value) => sum + value, 0) / args.length : "#ERR";
      case "ABS": return args.length === 1 ? Math.abs(nums[0]) : "#ERR";
      case "ROUND": {
        if (args.length < 1 || args.length > 2) return "#ERR";
        const digits = args.length === 2 ? Math.trunc(nums[1]) : 0;
        const factor = 10 ** digits;
        return Number.isFinite(factor) ? Math.round((nums[0] + Number.EPSILON) * factor) / factor : "#ERR";
      }
      case "IF": return args.length === 3 ? (nums[0] !== 0 ? nums[1] : nums[2]) : "#ERR";
      default: return "#ERR";
    }
  }
}

/** Evaluates the small, deliberately non-JavaScript formula grammar. Invalid input is data, not an exception. */
export function evaluateFormula(formula: string, resolveRef: FormulaResolver): string {
  try { return display(new Parser(tokenize(formula), resolveRef).parse()); } catch { return "#ERR"; }
}

export function evaluateSheet(sheet: SheetDoc, _opts?: unknown): SheetEvaluation {
  const v2 = sheet as unknown as V2Sheet;
  const cells: Record<string, Record<string, string>> = {};
  const byId = new Map(v2.columns.map((column) => [column.id, column]));
  const byLabel = new Map<string, string>();
  for (const column of v2.columns) if (!byLabel.has(column.label.trim().toLowerCase())) byLabel.set(column.label.trim().toLowerCase(), column.id);
  for (const row of v2.rows) {
    const output: Record<string, string> = {};
    const visiting = new Set<string>();
    const resolveColumn = (columnId: string): string => {
      const column = byId.get(columnId); if (!column) return "#REF";
      if (column.type !== "formula") return row.cells[columnId] ?? "";
      if (columnId in output) return output[columnId];
      if (visiting.has(columnId)) return "#CYCLE";
      visiting.add(columnId);
      const value = evaluateFormula(column.formula ?? "", (reference) => {
        const id = reference.startsWith("[")
          ? byLabel.get(reference.slice(1, -1).trim().toLowerCase())
          : reference.slice(1, -1);
        return id ? resolveColumn(id) : undefined;
      });
      visiting.delete(columnId); output[columnId] = value; return value;
    };
    for (const column of v2.columns) output[column.id] = column.type === "formula" ? resolveColumn(column.id) : row.cells[column.id] ?? "";
    cells[row.id] = output;
  }
  const aggregates: Record<string, string> = {};
  for (const column of v2.columns) {
    const aggregate = column.aggregate ?? "none";
    if (aggregate === "none") continue;
    const values = v2.rows.map((row) => cells[row.id]?.[column.id] ?? "");
    if (aggregate === "count") { aggregates[column.id] = String(values.filter((value) => value !== "").length); continue; }
    const numbers = values.map((value) => numeric(value)).map((value) => typeof value === "number" ? value : 0);
    if (aggregate === "sum") aggregates[column.id] = display(numbers.reduce((sum, value) => sum + value, 0));
    else if (aggregate === "avg") aggregates[column.id] = display(numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0);
    else if (aggregate === "min") aggregates[column.id] = display(numbers.length ? Math.min(...numbers) : 0);
    else if (aggregate === "max") aggregates[column.id] = display(numbers.length ? Math.max(...numbers) : 0);
  }
  return { cells, aggregates };
}
