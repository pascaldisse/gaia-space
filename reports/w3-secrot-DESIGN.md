# V41 webhook secret rotation — design

## Scope / measured baseline

- Target reservation is `PARITY.md:19`: V41 → `feat/w3-secrot`; V40 belongs to Kali at `PARITY.md:18`. This document does not alter either reservation.
- `SCHEMA_VERSION` is 39 in this checkout (`src-tauri/src/db.rs:7`). V39 conditionally adds nullable `webhook_subscriptions.secret` and `max_attempts` only if that table exists (`db.rs:197-212`).
- `WebhookSubscription.secret` is `Option<String>` (`applications.rs:231-244`); list/save select and overwrite it (`389-416`). Delivery joins the subscription at each send and signs with that current value (`425-486`). Thus secrets are plaintext SQLite values now; a delivery stores no signing-key identity (`WebhookDelivery`, `249-260`; `webhook_deliveries` DDL, `db.rs:589`).
- The existing sender emits webhook ID, delivery ID, timestamp, and signature; no key-ID header (`applications.rs:475-483`). A retry receives a fresh timestamp because `deliver_delivery` computes it per send (`461-484`).
- `secretbox` is present for authorization and calendar-feed secrets (`src-tauri/src/auth_security.rs:197-235`, `src-tauri/src/calendar_feeds.rs:111,170`), but this inspection establishes no project-wide policy requiring it for webhook secrets.

## Proposed V41 persistence

DDL proposal; implementation belongs to a later atom, not this document:

```sql
CREATE TABLE IF NOT EXISTS webhook_subscription_secrets (
  id TEXT PRIMARY KEY, -- immutable external key ID
  webhook_subscription_id TEXT NOT NULL
    REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  secret TEXT NOT NULL, -- plaintext only if the at-rest policy below rejects sealing
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  activated_at INTEGER NOT NULL,
  retire_at INTEGER, -- verification-grace end; no longer sender key once set
  revoked_at INTEGER,
  CHECK (retire_at IS NULL OR retire_at >= activated_at),
  CHECK (revoked_at IS NULL OR revoked_at >= activated_at)
);
CREATE INDEX IF NOT EXISTS webhook_subscription_secrets_subscription
  ON webhook_subscription_secrets(webhook_subscription_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_subscription_secrets_one_sender
  ON webhook_subscription_secrets(webhook_subscription_id)
  WHERE activated_at IS NOT NULL AND retire_at IS NULL AND revoked_at IS NULL;
```

Sender-key invariant: every *signed* subscription has exactly one row with `activated_at IS NOT NULL`, `retire_at IS NULL`, and `revoked_at IS NULL`; send selection uses only that row. The partial unique index proves **at most one**. Creation, migration, rotation, and revoke transactions must assert/leave **one** before commit; SQLite DDL alone cannot express “at least one” across a parent/child table. `retire_at` permits receiver verification during grace but excludes the old key from new sends; `revoked_at` excludes it from both sender selection and any future verification policy.

Legacy `secret` is nullable. Whether a legacy unsigned subscription becomes a generated signed key (making the invariant universal) or remains deliberately unsigned with no key-ring row is a product decision; do not silently change that behavior during migration.

## Version ordering / migration plan

V41 must not change V40 ownership. The shared `SCHEMA_VERSION` sequence requires V40 to land before V41. A database at user_version 39 must run V40 then V41; a branch implementing V41 first cannot safely claim `SCHEMA_VERSION = 41` unless the V40 migration is already present in its migration chain. This is an ordering/merge problem for the parent to resolve, not a license to renumber or combine migrations.

Proposed V41 transaction, after its version-ordering precondition:

1. Guard on `version < 41`; create the key-ring table/indexes idempotently.
2. If `webhook_subscriptions` exists, insert one key row for every legacy row whose `secret IS NOT NULL`; preserve the exact legacy string as initial material and stamp `created_at`/`activated_at` in the migration transaction. Use deterministic immutable IDs derived from a specified collision-safe scheme; ID format remains a decision until API/header contract is approved.
3. Make rerun/partial recovery idempotent: insert only where the subscription has no migrated row, never overwrite an existing key-ring row and never delete or alter `webhook_subscriptions.secret` in V41.
4. Leave the legacy column readable during the compatibility implementation phase; switch send/read/write paths only after key-ring data is proved present. A later approved cleanup migration may remove it, not V41 by implication.
5. Set `PRAGMA user_version=41` only after all V41 steps succeed, matching `migrate`'s transaction pattern (`db.rs:137-213`).

Required migration tests, patterned after `v39_guard_upgrades_a_v38_copy_and_tolerates_a_partial_database_without_the_table` (`db.rs:1551-1576`):

- **fresh:** migrate empty DB through all schemas; key-ring table/indexes exist and version is 41. Create a signed subscription through the new path; assert one sender key.
- **upgraded:** begin from a V40-shaped DB with subscriptions containing a plaintext secret; migrate; assert every legacy row survives, its secret bytes survive in exactly one active key row, and no subscription/delivery rows are lost.
- **partial DB:** supply a pre-V41 `user_version` fixture with `webhook_subscriptions` absent, then migrate; assert no failure, V41 schema exists, no phantom key rows exist, and user_version reaches 41. Also cover table-present/key-ring-partially-created rerun once the chosen idempotence mechanism is implemented.

## Delivery / receiver contract decisions

A later implementation must add `x-gaia-space-key-id` beside the current headers and document it in `docs/webhook-receiver-guide.md`. Receivers that only look up a secret by webhook ID cannot select an overlap key from the new header; compatibility behavior, unknown-key rejection, and the header rollout must be specified before changing the guide.

**Parent decisions required — do not infer:**

1. **Queued retry identity:** during old-key grace, does an existing `webhook_deliveries` row retain the old signing key, requiring `key_id` on delivery, or does every attempt select/re-sign with the current sender key? Current delivery SQL reads the subscription secret at send time, so it implements neither key retention nor key identity.
2. **Grace default:** what default duration, minimum/maximum, and operator override apply to `retire_at`? Source contains no grace policy.
3. **At-rest protection — UNVERIFIED policy:** current webhook values are plaintext. Recommendation: seal new key material with existing `secretbox` before persistence, because the repository already uses it for other persisted secrets; this is a recommendation, not evidence of an established webhook policy. Parent must approve/reject it and define key-environment failure/rotation behavior. If approved, rename/define the material column and migration conversion precisely rather than shipping a misleading plaintext `secret` column.
4. **`x-gaia-space-key-id` compatibility:** must receivers accept both legacy no-key-ID requests and key-ID requests during rollout; for how long; and does the receiver guide require key lookup by `(webhook_id, key_id)`? Existing guide describes lookup by webhook ID/secret only.
5. **Nullable legacy secret:** preserve unsigned endpoints indefinitely, generate a key at migration, or require an operator rotation before signing? This determines whether “one sender key” is universal or applies only to signed subscriptions.
6. **Lifecycle semantics:** may a revoked key be used to verify already-delivered/retried traffic, and may a retired key verify until `retire_at`? The schema supports either policy; product semantics must choose.

## Implementation estimate / atoms

Estimate is planning only: **~355–545 Rust LOC + ~110–190 TypeScript/UI LOC + ~210–320 test LOC + ~35–65 guide/doc LOC**.

| Area | Estimated LOC | Work |
|---|---:|---|
| `src-tauri/src/db.rs` | 70–115 Rust + 70–110 tests | V41 DDL, guarded backfill, fresh/upgraded/partial tests |
| `src-tauri/src/applications.rs` | 145–215 Rust + 90–135 tests | key model, rotation/list/revoke, atomic sender selection, delivery-key choice |
| `src-tauri/src/lib.rs`, `src-tauri/src/bin/space-server.rs` | 25–45 Rust + 20–35 tests | command registration / HTTP exposure where applicable |
| `src/api/applications.ts`, `src/views/Applications.tsx` | 110–190 TypeScript/UI | one-time secret display, key metadata, rotate/revoke UX |
| `docs/webhook-receiver-guide.md` | 35–65 Markdown/tests | key-ID lookup and overlap contract after decisions |

Suggested atoms: (1) parent resolves six decisions plus V40/V41 merge order; (2) migration/key-ring and its three test types; (3) backend rotation/read/send semantics plus retry-key test; (4) command/API/UI one-time secret and lifecycle controls; (5) receiver guide/header compatibility and end-to-end local HTTP coverage. No implementation is contained here.
