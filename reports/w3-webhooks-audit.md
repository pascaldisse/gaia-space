# W3 webhook audit — Kali / round 2

## Verdict

**BLOCK — do not merge as-is.** `process_webhook_queue` has a confirmed duplicate-delivery race.

## Executed evidence

- V38-copy simulation: migrated a head database, removed V39 columns, stamped `user_version=38`, ran `migrate()` twice; both `secret` and `max_attempts` existed. A separate fresh database also contained both columns.
  - `cargo test --manifest-path src-tauri/Cargo.toml audit_v38_copy_upgrades_idempotently_and_fresh_has_v39_columns -- --nocapture` → PASS
- HMAC interoperability vectors calculated independently with Python `hmac` and checked against Rust, including a 100-byte key:
  - `shhh`, `1700000000.{"issue":"GAIA-7"}` → `sha256=563c5679e8f4b4058024abd67d7a087c0eda7291a461b9521d72c697f4fa52f5`
  - `"k" * 100`, same message → `sha256=c1573a26e4c4ade48b68e73da266d5ef1ce859456289447bd10a4f89a513168e`
  - `cargo test --manifest-path src-tauri/Cargo.toml audit_hmac_matches_external_python_vectors_including_long_key -- --nocapture` → PASS
- Confirmed queue race with a local HTTP listener: one initial failed delivery was made due, then two concurrent `process_webhook_queue(1)` calls were run. The listener accepted **three** requests total (initial + two retries); the temporary audit test passed only because the duplicate retry occurred.
  - `cargo test --manifest-path src-tauri/Cargo.toml audit_parallel_sweep_sends_duplicate_delivery -- --nocapture` → PASS (reproducer; temporary test removed afterward)

## Blocking defect: no atomic queue claim

`due_webhook_deliveries()` selects due IDs, then `deliver_delivery()` reads `attempts`, performs HTTP, and updates afterward. Two sweepers can select/read the same row before either update, so both POST it. Both can write the same next attempt count, concealing one external side effect.

- Location: `src-tauri/src/applications.rs`, `due_webhook_deliveries`, `process_webhook_queue`, `deliver_delivery`.
- Required repair: atomically claim a row before HTTP (transactional conditional `UPDATE ... WHERE status='FAILED' AND next_attempt_at <= unixepoch()` to an in-flight state, or lease token/state); only claimant may deliver. Preserve recovery for abandoned claims.

## Non-blocking findings

- Retry budget: PASS. `attempts >= max_attempts` rejects delivery; after a failed final attempt `retry_schedule` is `None` and `next_attempt_at` becomes `NULL`. Existing dead-letter test passes. `delivery_backoff` clamps shift input to 0..5; no shift overflow.
- HMAC: PASS. Manual HMAC construction matches independent Python/openssl output, including HMAC key hashing for keys over 64 bytes.
- Replay wording is misleading: the timestamp is MAC-bound, so it prevents changing a captured body under a *different* timestamp; it does **not** prevent replay of the identical signed request. Receiver-side freshness and replay-cache validation are required. No receiver verification contract/instructions were found by repository search. Document required timestamp tolerance and nonce/signature replay-cache behavior, or remove the claim.

## Scope

No production code was changed. Temporary audit tests were removed. No V40 migration; no PARITY changes.

## Required gate rerun

- `cargo check --manifest-path src-tauri/Cargo.toml` → PASS; pre-existing warnings: unused `AppHandle`/`Manager`, deprecated `Key::from_slice`/`Nonce::from_slice`.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` → FAIL; 21 pre-existing lint errors across unrelated files (`lib.rs`, `secretbox.rs`, `blogs.rs`, `calls.rs`, `debug_server.rs`, `documents.rs`, `issues.rs`, `oauth.rs`, `pipelines.rs`, `review.rs`). No audit-file or webhook-source change caused these.
- `bunx tsc --noEmit` → PASS.
- `bun test` → PASS, 115 pass / 0 fail.
- `bun run build` → PASS; existing >500 kB chunk warning.
- `python3 scripts/parity_totals.py --check` → PASS, `TOTAL: rows 356` unchanged.

## Round 3 re-audit — Kali
**Verdict: MERGEABLE.** Re-applied the prior race against `claim_delivery`; one conditional SQLite `UPDATE` writes a 120-second lease before any HTTP request.
- 8 concurrent `process_webhook_queue(1)` workers: PASS; exactly 1 sweeper returned a delivery, listener observed exactly initial POST + 1 retry, and attempts became 2.
- Lease recovery: PASS; forcing `next_attempt_at=unixepoch()-1` after a claim makes the abandoned PENDING row claimable again. Claiming preserves attempts (3 remained 3). SUCCEEDED and `next_attempt_at IS NULL` dead-letter rows cannot be manually claimed.
- `retry_webhook_delivery(..., respect_backoff=false)` shares `claim_delivery`; it bypasses only backoff, never a live PENDING lease. Sweeper’s conditional claim loses cleanly to it; no second POST/attempt is possible.
- `open_at` busy timeout: PASS under 8-writer race; no lock error/deadlock observed. Full cargo gate below is the regression check; timeout only waits for SQLite’s writer lock, not an application mutex.
- V39: PASS. A real fresh V39 copy with `secret`/`max_attempts` removed and `user_version=38` regained both; a hand-built V38 partial DB lacking `webhook_subscriptions` migrated and stamped V39 without error.
## Round 3 gates
- `cargo test --manifest-path src-tauri/Cargo.toml delivery_tests::two_sweepers_deliver_a_due_row_exactly_once -- --nocapture` → PASS (8 sweepers)
- `cargo test --manifest-path src-tauri/Cargo.toml expired_claim_recovers -- --nocapture` → PASS
- `cargo test --manifest-path src-tauri/Cargo.toml v39_guard_upgrades -- --nocapture` → PASS
- Full gate rerun: `cargo test --manifest-path src-tauri/Cargo.toml` → PASS, 202 tests (163 lib + 39 server); `cargo check --manifest-path src-tauri/Cargo.toml` → PASS; `bunx tsc --noEmit` → PASS; `bun test` → PASS, 115; `bun run build` → PASS; `python3 scripts/parity_totals.py --check` → PASS, TOTAL 356. Existing four Rust warnings and the >500 kB Vite chunk warning remain.
