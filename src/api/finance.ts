import { invoke } from "@tauri-apps/api/core";

/** Negative = money out, positive = money in. The Rust module owns that convention
 *  (`finance.rs`); nothing on this side may re-interpret a sign. */
export type FinanceEntry = {
  id: string;
  entry_date: string;
  description: string;
  category: string;
  amount_cents: number;
  currency: string;
  source: "splitwise" | "manual";
  external_id?: string | null;
};

/** The plan is TWO levels deep: a block from the document (`category`) and the named
 *  position inside it (`item`, the document's `det[]` entry). Rows written before that
 *  second level existed carry an empty `item`. */
export type FinancePlanRow = {
  id: string;
  category: string;
  item: string;
  /** `YYYY-MM` */
  month: string;
  planned_cents: number;
  /** `cost` | `revenue` — stated by the document, never read off the sign. */
  kind: string;
  optional: boolean;
  estimated: boolean;
  /** Set when the MONTH is ours, not the document's — in words, so it can be shown. */
  assumption?: string | null;
  source_file: string;
  source_block: string;
  source_detail: string;
};

export type FinanceMember = { profile_id: string; display_name: string; username: string };

/** The refusal is a VALUE, not an exception: the nav asks this on every render and a
 *  "you are not an owner" is an answer, not a failure. `missing` names the finance
 *  owners who have no profile on this installation. */
export type FinanceAccess = {
  allowed: boolean;
  profile_id?: string | null;
  reason?: string | null;
  missing: string[];
};

export type ImportSummary = { imported: number; skipped_duplicates: number; errors: string[] };
export type SeedSummary = { inserted: number; kept: number; categories: number; replaced_summary_rows?: number };

/** What a plan import did. `skipped` counts the cells it did NOT write: identical
 *  ones, and hand-corrected ones it refused to overwrite. Format:
 *  `docs/finance-plan-format.md`. */
export type ImportPlanSummary = {
  inserted: number;
  updated: number;
  skipped: number;
  categories: number;
  positions: number;
  errors: string[];
  replaced_summary_rows?: number;
};

/** Every call is gated server-side against `finance_access`; hiding the nav entry is
 *  presentation, never protection. */
export const financeApi = {
  access: () => invoke<FinanceAccess>("finance_access_check"),
  listAccess: () => invoke<FinanceMember[]>("list_finance_access"),
  grant: (profileId: string) => invoke<FinanceMember[]>("grant_finance_access", { profileId }),
  revoke: (profileId: string) => invoke<FinanceMember[]>("revoke_finance_access", { profileId }),
  listEntries: (from?: string, to?: string) => invoke<FinanceEntry[]>("list_finance_entries", { from, to }),
  createEntry: (entry: Omit<FinanceEntry, "id"> & { id?: string }) => invoke<FinanceEntry>("create_finance_entry", { entry }),
  updateEntry: (entry: FinanceEntry) => invoke<FinanceEntry>("update_finance_entry", { entry }),
  deleteEntry: (id: string) => invoke<void>("delete_finance_entry", { id }),
  listPlan: () => invoke<FinancePlanRow[]>("list_finance_plan"),
  upsertPlan: (row: Partial<FinancePlanRow> & { category: string; item: string; month: string; planned_cents: number }) =>
    invoke<FinancePlanRow>("upsert_finance_plan", { row }),
  deletePlan: (id: string) => invoke<void>("delete_finance_plan", { id }),
  /** Empty alias — there is no built-in plan; the numbers arrive through `importPlan`. */
  seedPlan: () => invoke<SeedSummary>("seed_finance_plan"),
  /** Idempotent: a plan number corrected by hand is skipped, not overwritten. */
  importPlan: (payloadJson: string) => invoke<ImportPlanSummary>("import_finance_plan", { payloadJson }),
  importSplitwise: (csvText: string) => invoke<ImportSummary>("import_splitwise_csv", { csvText }),
};
