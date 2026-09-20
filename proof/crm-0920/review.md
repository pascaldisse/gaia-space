# PR#33 review — feat/crm-server-store (jzudeml)

盤=gaia-space-wt/crm-merge, base=0ba7855 (master+PR#32 merged, stage0).

## Verdict: PASS, no blocking issues.

## Criteria

1. **cmd envelope**: `crm_snapshot()` (no args), `crm_put_records(organizations?,deals?,activities?,labels?,stages?,acting_profile_id?)`,
   `crm_purge_records(organization_ids?,deal_ids?,activity_ids?)` — top-level JSON keys = Rust param names, matching
   dispatch! macro convention used by every multi-arg sibling (e.g. `add_reaction(message_id,profile_id,emoji)`,
   `create_channel(channel,member_ids)`). Not a literal `{input}` wrapper (that shape is only used by single-struct-arg
   commands like `create_todo(input)`) — CRM's multi-field shape is the correct sibling pattern for a multi-arg command.
   PASS.

2. **auth**: `CommandPolicy::CrmAccess` routed through the same `authorize_command`/session gate as every other command
   (`cmd()` dispatch, same session-cookie/PAT middleware layer, no bypass). Session refuses unauthenticated callers
   (401, proven in `crm.e2e.proof.test.ts` + Rust dispatch tests). `acting_profile_id` is injected server-side from the
   bound session identity (never trusted from client body) and stamped as `updated_by`; `bind_session_identity`'s
   blanket recursive rewrite is explicitly SKIPPED for CrmAccess (commented, deliberate) because CRM payloads carry a
   human `owner` string field that must survive verbatim — correct, since the whole payload is opaque JSON to the server.
   PASS.

3. **per-row upsert w/ updated_at, no whole-CRM last-write-wins**: `crm_records(id PK, kind, payload_json, updated_at,
   updated_by)` + `crm_settings(key PK, ...)`, upsert via `ON CONFLICT(id) DO UPDATE`. `crmWriteFor()` diffs previous vs
   next CrmData per-id and sends ONLY changed records (`changedRecords`) + purges only removed ids (`removedIds`).
   Proven by `two_puts_of_different_records_do_not_clobber_each_other` (crm.rs) and the e2e proof (Bjarne's single-deal
   write does not touch Jannes' deal). `revision` = MAX(updated_at), used only as a poll-skip hint, never compared for
   equality before a write (no optimistic-lock/conflict rejection — correct given per-row granularity replaces the old
   whole-document revision-conflict design). PASS.

4. **localStorage→server migration, named explicitly**: `crmSync.start()` detects empty server + non-empty local
   mirror (`gaia.crm.prototype.v2`) → `status:"migration"`, states `localRecords` count in the UI banner BEFORE any
   click. Two explicit human actions: `migrate()` uploads the whole local document once via `crm_put_records`, then
   renames the local key to `gaia.crm.prototype.v2.migrated` (kept, not deleted — stated as deliberate backup).
   `dismissMigration()` = explicit "drop" path: does NOT upload, adopts the empty server snapshot, but also just marks
   the local key migrated (rename, not delete) — so nothing is ever destroyed, upload is opt-in, re-check against the
   server happens again immediately before the actual write (race-safe: local never overwrites a CRM someone else
   filled between the offer and the click). PASS — both named paths present and tested
   (`crm.sync.view.test.tsx`: "local data is offered for upload with its record count, and never sent without the click").

5. **tests present**: `crm.rs` unit tests (empty store, verbatim round-trip, two-writer non-clobber, missing-id refusal
   + nothing-written), `crmSync.test.ts` (diff/write-size logic), `crm.sync.view.test.tsx` (rendered DOM: server-wins
   render, single-deal write on drag, offline banner keeps last-known CRM, migration offer+upload+key-rename),
   `crm.e2e.proof.test.ts` (real client → real space-server HTTP, two live sessions, `SPACE_E2E`-gated so normal suite
   stays offline — exactly the "proof" pattern the spec names). PASS.

## Non-blocking notes

- `docs/specs/crm-server-store.md` names strict file ownership per lane (backend Rust files vs frontend TS files) —
  irrelevant post-merge, historical planning doc only, no action needed.
- **CORRECTION (found during Stage 4 pre-deploy check, now FIXED — see below):** the note originally here assumed
  production was at schema 144 per the task brief. It is NOT: `ssh box 'sqlite3 ... PRAGMA user_version'` reads
  **145**, with the OLD `crm_documents`/`crm_document_revisions` tables already present (0 rows in either — the
  whole-document design was deployed once, briefly, never actually written to). Since `migrate()` gates every rung on
  `version < N`, the V145 rung (now containing the NEW `crm_records`/`crm_settings` DDL) would **never fire again** on
  this box — deploying as-is would leave `crm_snapshot`/`crm_put_records`/`crm_purge_records` throwing a SQL error on
  every call (`no such table: crm_records`) as soon as a real user touched the CRM. This WAS a merge blocker.
  **Fix applied** (commit `a1d7c96`, before deploy): `SCHEMA_VERSION` 145→146; new V146 rung re-runs
  `CREATE TABLE IF NOT EXISTS crm_records/crm_settings` unconditionally-safe for every DB shape (fresh install, a box
  that got the tables from V145 itself, or — this box — one pinned at 145 under the old design). Old, empty
  `crm_documents`/`crm_document_revisions` are left in place (unused, harmless; a separate cleanup ticket, not this
  one). Verified three ways: (1) new unit test simulating exactly this box's shape
  (`a_database_already_pinned_at_v145_under_the_old_whole_document_design_still_gets_the_new_tables`), (2) the repo's
  own `tests/migrate_real_copy.rs` (`MIGRATE_CHECK_DB=...`) run against a **fresh scp'd copy of the actual live
  `space.db`** — confirmed 145→146, both new tables created, `PRAGMA integrity_check` ok, old tables untouched, (3)
  `deploy/rollout.sh`'s `census()` is generic (iterates `sqlite_master`, prints a `new tables:` diff line) and needed
  NO changes to cope with the two new tables.
- The old `v145_contract_tests` migration-ladder test (asserting `crm_documents`/`crm_document_revisions` exist after
  144→145 upgrade) was deleted and NOT replaced with an equivalent ladder test for the new `crm_records`/`crm_settings`
  shape — migration-from-144 is only proven indirectly (crm.rs unit tests run `db::migrate` on a fresh in-memory DB,
  which starts at version 0 and walks the whole ladder, exercising V145 but not as an isolated "upgrade from 144"
  contract). Covered instead by Stage 3's live-copy migration proof (task instruction). Non-blocking, noted.
- `crm_put_records`/`crm_purge_records` run in ONE transaction each (verified in crm.rs `unchecked_transaction`), so a
  bad record fails the WHOLE call before any row is written (validated up-front via `record_id()` before opening the
  tx) — matches spec's "no half write" requirement.

## Blocking issues found: NONE. No fixes required in this stage.
