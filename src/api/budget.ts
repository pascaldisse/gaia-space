import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_BUDGET_CURRENCY = "EUR";

export type BudgetColumnType = "text" | "number" | "date" | "person";
export type BudgetColumn = { id: string; label: string; type: BudgetColumnType };
export type BudgetRow = { id: string; cells: Record<string, string> };
/** A budget is a sheet v2 envelope; its five leading columns are fixed by the server. */
export type BudgetDoc = {
  currency: string;
  members: string[];
  columns: BudgetColumn[];
  rows: BudgetRow[];
};

export const BUDGET_COLUMNS = [
  { id: "date", label: "Date", type: "date" },
  { id: "paid_by", label: "Paid by", type: "person" },
  { id: "amount", label: "Amount", type: "number" },
  { id: "description", label: "Description", type: "text" },
  { id: "split", label: "Split among", type: "text" },
] as const satisfies readonly BudgetColumn[];

export type BudgetExpenseInput = {
  date?: string;
  paid_by?: string;
  amount: string;
  description: string;
  split?: string[];
};

export type BudgetStatementMember = {
  profile_id: string;
  name: string;
  paid_cents: number;
  share_cents: number;
  net_cents: number;
};
export type BudgetTransfer = { from: string; to: string; cents: number };
export type BudgetStatement = {
  month: string | null;
  currency: string;
  total_cents: number;
  members: BudgetStatementMember[];
  transfers: BudgetTransfer[];
  rows_counted: number;
};

export function emptyBudget(members: string[], currency = DEFAULT_BUDGET_CURRENCY): BudgetDoc {
  return { currency, members: [...new Set(members)], columns: BUDGET_COLUMNS.map((column) => ({ ...column })), rows: [] };
}

/** Tolerant read: an empty/new or malformed body remains a valid budget envelope. */
export function parseBudget(body: string | null | undefined): BudgetDoc {
  let raw: unknown;
  try { raw = JSON.parse(body ?? ""); } catch { return emptyBudget([]); }
  if (!raw || typeof raw !== "object") return emptyBudget([]);
  const source = raw as Partial<BudgetDoc>;
  const members = Array.isArray(source.members) ? source.members.filter((member): member is string => typeof member === "string") : [];
  const columns = Array.isArray(source.columns)
    ? source.columns.flatMap((column) => {
      if (!column || typeof column.id !== "string" || typeof column.label !== "string" || !["text", "number", "date", "person"].includes(column.type)) return [];
      return [{ id: column.id, label: column.label, type: column.type } as BudgetColumn];
    })
    : BUDGET_COLUMNS.map((column) => ({ ...column }));
  const known = new Set(columns.map((column) => column.id));
  const rows = Array.isArray(source.rows) ? source.rows.flatMap((row) => {
    if (!row || typeof row.id !== "string" || !row.cells || typeof row.cells !== "object") return [];
    const cells = Object.fromEntries(Object.entries(row.cells).filter(([id, value]) => known.has(id) && typeof value === "string"));
    return [{ id: row.id, cells }];
  }) : [];
  return {
    currency: typeof source.currency === "string" ? source.currency : DEFAULT_BUDGET_CURRENCY,
    members: [...new Set(members)],
    columns: columns.length ? columns : BUDGET_COLUMNS.map((column) => ({ ...column })),
    rows,
  };
}

export function serializeBudget(budget: BudgetDoc): string {
  return JSON.stringify({
    currency: budget.currency,
    members: [...new Set(budget.members)],
    columns: budget.columns.map(({ id, label, type }) => ({ id, label, type })),
    rows: budget.rows.map((row) => ({
      id: row.id,
      cells: Object.fromEntries(Object.entries(row.cells).filter(([id, value]) => budget.columns.some((column) => column.id === id) && value !== "")),
    })),
  });
}

export const budgetApi = {
  statement: (documentId: string, month: string | null) =>
    invoke<BudgetStatement>("budget_statement", { documentId, month }),
  addExpense: (documentId: string, expense: BudgetExpenseInput) =>
    invoke<void>("budget_add_expense", { documentId, expense }),
  exportStatement: (documentId: string, month: string) =>
    invoke<string>("budget_export_statement", { documentId, month }),
};
