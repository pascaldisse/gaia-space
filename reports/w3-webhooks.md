# w3 B2 — webhook delivery/retry (feat/w3-webhooks)

Builder: ☀Vishnu (L2). Audit: ☾Kali → reports/w3-webhooks-audit.md.

## What master already had (b9a6f90)
- `webhook_subscriptions` / `webhook_deliveries` tables, `deliver_webhook`, `retry_webhook_delivery`, `list_webhook_deliveries`
- exponential backoff `30 * 2^attempts` written into `next_attempt_at`

## What was missing → landed here
| gap | fix | evidence |
|---|---|---|
| unsigned POST — receiver cannot authenticate the sender | HMAC-SHA256 over `{timestamp}.{payload}`, headers `x-gaia-space-signature: sha256=…` + `x-gaia-space-timestamp` | `applications.rs::webhook_signature`; test `webhook_delivery_posts_then_retries_after_an_http_failure` asserts header == recomputed MAC |
| unbounded retries — a dead endpoint is retried forever | per-subscription `max_attempts` (default 5); budget spent ⇒ `next_attempt_at=NULL` = dead letter | `retry_schedule`; test `attempts_budget_dead_letters_and_the_sweeper_skips_dead_rows` |
| nothing ever drained the queue — `next_attempt_at` was written but never read | `due_webhook_deliveries` + `process_webhook_queue(limit)` command (Session policy, registered in space-server and the Tauri handler) | `applications.rs`, `bin/space-server.rs`, `lib.rs` |
| manual retry could exceed the budget | `deliver_delivery` refuses when `attempts >= max_attempts` | same dead-letter test |
| client could not see signing/budget state | `WebhookSubscription.secret/max_attempts` in TS, "signed/unsigned · max N" row, "Run retry queue" button | `src/api/applications.ts`, `src/views/Applications.tsx` |

## Schema
V39 (ledger-reserved, PARITY.md MIGRATION RESERVATIONS): `webhook_subscriptions.secret TEXT`, `.max_attempts INTEGER NOT NULL DEFAULT 5`, both via `add_column_if_missing` so partially-applied databases converge. No table rebuild, no CHECK change — dead-lettering rides on `next_attempt_at IS NULL` instead of a new status value.

## Deliberately not done (corpses)
- **background ticker**: no thread/timer sweeps the queue; `process_webhook_queue` must be called (UI button, or a caller's scheduler). A daemon thread in `space-server` is a lifecycle decision for the server lane, not for this one.
- **event fan-out**: `deliver_webhook` still takes an explicit `webhook_id`; domain events (issue/chat) do not yet fan out to matching `event_type` subscriptions. `filters_json` remains stored-but-unevaluated.
- **secret rotation/reveal-once UX**: secret is a plain column, set through `save_webhook`.

## Gates (this worktree, 2026-08-22)
```
cargo check --all-targets   0 errors (pre-existing warnings only)
cargo clippy --all-targets  0 errors (pre-existing warnings only)
bunx tsc --noEmit           0
bun test                    115 pass / 0 fail (23 files)
bun run build               ✓ built
python3 scripts/parity_totals.py --check   TOTAL rows 356 (unchanged)
```
UNVERIFIED: concurrent `process_webhook_queue` sweeps are not proven single-delivery (no row-level claim); Kali's audit owns this.
