# KB Tables + Budget (Splitwise-on-sheets) — spec 2026-09-03

Order (Pascal, room chat-mtlrxc1f-w8lz): KB gets Excel-like tables · budget overview on the table system ·
people log "I paid X" · monthly statement who-owes-whom (Splitwise-like).

## Ground (exists — REUSE, never duplicate)
- `documents.kind` ∈ {markdown, sheet} → `src-tauri/src/documents.rs` (`KIND_SHEET`, `validate_sheet_body`, `sheet_search_text`, `save_document` versions) · `src/api/documents.ts` (`SheetDoc`, `parseSheet`, `serializeSheet`) · `src/components/SheetEditor.tsx` (grid, no save path of its own) · `src/views/Documents.tsx` (kind switch ~L607/L1924).
- `finance.rs` = personal ledger, gated. NOT the budget. Do not touch.
- IPC wiring pattern: `src-tauri/src/lib.rs` handler list · `src-tauri/src/bin/space-server.rs` policy/bind/ACL/dispatch (see HANDOFF.md w11 for the exemplar) · `db.rs` SCHEMA_VERSION=140 (no new tables needed here — body JSON + kind column).

## Laws riding in every lane
- bun ONLY (never npm/npx/node/tsx). Gate = `cargo test --manifest-path src-tauri/Cargo.toml` · `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` · `bunx tsc --noEmit -p tsconfig.json` · `bun test` · `bun run build`.
- never hardcode: limits/defaults = named consts (`MAX_*`, `DEFAULT_*`) · never /tmp · money = integer cents ALWAYS (no floats in storage/settlement) · deterministic rounding.
- commit every stage on the lane branch · orphan-sweep on lane end · NO live server tests inside lanes A/B/C (serial, final merge lane only, single instance, port 8787 is daemon → use another port).
- UI styling exempt by decree — function first, reuse existing `Documents.css`/`SheetEditor.css` classes.
- Whip 154: never kill Pascal's running app.

## Sheet body v2 (shared contract — A + B both implement against THIS)
```json
{ "columns": [ { "id": "c_..", "label": "Amount", "type": "text|number|date|person|formula",
                 "formula": "[Qty] * [Price]"        // formula type only; refs = [Label] or {column_id}
                 , "aggregate": "sum|avg|min|max|count|none" } ],
  "rows": [ { "id": "r_..", "cells": { "c_..": "raw string" } } ] }
```
- `person` cell value = profile id (string) · renders as profile name · editor = select over `list_profiles` (existing api).
- `formula` cells NEVER stored (cells for formula columns are ignored on parse, stripped on serialize). Computed client-side by `src/sheetFormula.ts`.
- Formula grammar (pure, no eval): numbers · `+ - * / ( )` · unary minus · refs `[Label]` (case-insensitive, first match) and `{column_id}` · functions `SUM(a,b,..) MIN MAX AVG ABS ROUND(x[,d]) IF(cond,a,b)` · comparisons `= <> < <= > >=` → 1/0. Non-numeric cell → 0 in arithmetic. Cycle (formula col referencing itself transitively) → `#CYCLE`. Unknown ref → `#REF`. Division by zero → `#DIV/0`. Errors are strings; never throw.
- Aggregate row (footer) per column over computed values; `count` counts non-empty.
- Server `validate_sheet_body` (Rust): accepts v2 fields; refuses unknown `type`, formula string > `MAX_FORMULA_LEN=512`, columns > `MAX_SHEET_COLUMNS=64`, rows > `MAX_SHEET_ROWS=5000`. Does NOT evaluate formulas (client concern) — only shape.

## Budget doc kind (`kind = 'budget'`) — body = sheet v2 with FIXED columns + envelope
```json
{ "currency": "EUR",
  "members": ["profile_id", ...],              // who splits; order = tie-break order for rounding
  "columns": [ {"id":"date","label":"Date","type":"date"},
               {"id":"paid_by","label":"Paid by","type":"person"},
               {"id":"amount","label":"Amount","type":"number"},   // decimal string "12.50" → cents
               {"id":"description","label":"Description","type":"text"},
               {"id":"split","label":"Split among","type":"text"} ], // comma-joined profile ids; "" = all members
  "rows": [ ... ] }
```
- Column ids FIXED (`BUDGET_COLUMNS` const in Rust + TS); extra user columns allowed AFTER the fixed five (e.g. Category) → same grid editor works.
- Validation (Rust `validate_budget_body`): fixed five present in order · currency = 3 uppercase letters · members non-empty, all distinct · every `paid_by` ∈ members · every split id ∈ members · amount parses as decimal with ≤2 fraction digits, > 0.

### Settlement (Rust `src-tauri/src/budget.rs`, single implementation — TS does NOT reimplement)
`budget_statement(document_id, month: "YYYY-MM" | null)` → for rows whose date starts with month (null = all):
- share per row: `amount_cents` split equally over split-set (empty = all members); remainder cents (amount mod n) go one each to the first `rem` members in `members` order (deterministic).
- per member: `paid_cents`, `share_cents`, `net_cents = paid - share`.
- transfers = debt simplification: creditors (net>0) vs debtors (net<0), both sorted by |net| desc then member order; greedy match largest-vs-largest → list `{from,to,cents}`; invariant Σtransfers per member == -net (test it) · count ≤ members-1.
- output `{ month, currency, total_cents, members:[{profile_id,name,paid_cents,share_cents,net_cents}], transfers:[{from,to,cents}], rows_counted }`.
- ACL = the document's existing read ACL (reuse documents' viewer check, same as `get_document`). caller-provided container ids untrusted.

### Quick-add (Rust `budget_add_expense(document_id, {date?, paid_by?, amount, description, split?})`)
- server-side read-modify-write inside ONE transaction: parse body → append row (`newRowId` equivalent, `r_` + ulid/uuid) → validate → `save_document` path (new version, same event fan-out `document.updated`). Client never sends the whole body for this → no clobber between two people adding at once.
- defaults: date = today UTC `YYYY-MM-DD` · paid_by = actor · split = all. ACL = document EDIT right.

### Export statement → KB page (Rust `budget_export_statement(document_id, month)`)
- creates a `markdown` document in the same folder titled `"{doc title} — {month} statement"` via existing create path; body = markdown table (members paid/share/net) + "who owes whom" list; returns document id. Re-export same month = new document (versions of the budget itself remain the ledger).

## Lanes (parallel, own worktrees, one branch each; merge lane after)
- A `feat/kb-sheet-v2` worktree `~/projects/gs-sheet-v2`: `src/sheetFormula.ts` (+ `.test.ts`, ≥20 cases incl. cycle/ref/div0/if/precedence) · `src/api/documents.ts` types+parse/serialize v2 · `SheetEditor.tsx` formula (read-only computed cells, monospace), person select, footer aggregates, column-head menu gains formula input + aggregate select · Rust `validate_sheet_body` v2 + tests.
- B `feat/kb-budget-core` worktree `~/projects/gs-budget-core`: `src-tauri/src/budget.rs` (KIND_BUDGET registered in documents `validate_kind`, validate_budget_body, statement, add_expense, export) · lib.rs IPC · space-server policy/ACL/dispatch · Rust tests ≥12 (rounding remainder, empty split=all, month filter, simplification invariant, ACL refusal, concurrent add = 2 rows).
- C `feat/kb-budget-ui` worktree `~/projects/gs-budget-ui`: `src/api/budget.ts` wrappers (shapes above, verbatim) · `src/views/Budget.tsx` = for `doc.kind==='budget'`: (1) quick-add bar: amount · description · date(today) · paid-by(me) · split(all|pick) · one button "I paid" → `budget_add_expense` then reload doc; (2) grid = existing `SheetEditor` (fixed columns locked from deletion/type change via new `lockedColumnIds` prop — coordinate: add prop as optional so A's file merges cleanly); (3) "Statement" panel: month picker (default current) → `budget_statement` → members table + "X owes Y €Z" list + "Export to page" button. New-document dialog gains "Budget" type (members = container members preselected, currency default `DEFAULT_BUDGET_CURRENCY='EUR'`). Tests: `src/views/budget.view.test.tsx` (quick-add calls api w/ defaults · statement renders transfers · locked columns) mocking api like `finance.view.test.tsx` does.
- Merge lane: A→B→C onto `feat/kb-tables-budget`, resolve `api/documents.ts`+`Documents.tsx`, full gate, ONE live run: space-server on free port, curl create budget → add 3 expenses (2 members) → statement → assert transfers; paste proof to `proof/kb-budget-live.txt`; HANDOFF.md section; PARITY.md UNTOUCHED (non-Space feature; note in HANDOFF only).
