# CRM on the server — one shared workspace, not one per browser

## Why

The CRM persists into `localStorage` (`gaia.crm.prototype.v2`). On the desktop that is
one machine; on the web it is **one CRM per browser**. Jannes, Bjarne, Charles and
Pascal would each see a different pipeline and none of them would know it.

Goal (Jannes, 2026-09-19): *"in der Web-Version soll alles genau so sein wie in unserer
Desktop-App und jeder muss ALLES gleich sehen und bearbeiten können."*

So: one server-held CRM, every member reads and writes all of it, desktop and web use
the same commands.

## Shape of the store — records, not one document

A single blob would mean last-write-wins across the WHOLE CRM: Bjarne saving a note
would silently revert Jannes' deal. Storage is therefore **one row per record**, and a
write names only the records it touched.

```sql
CREATE TABLE IF NOT EXISTS crm_records (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK(kind IN ('organization','deal','activity')),
  payload_json TEXT NOT NULL,         -- the client-side record, verbatim
  updated_at  INTEGER NOT NULL,       -- unixepoch, server clock
  updated_by  TEXT REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS crm_records_kind ON crm_records(kind);

CREATE TABLE IF NOT EXISTS crm_settings (
  key         TEXT PRIMARY KEY CHECK(key IN ('labels','stages')),
  payload_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES profiles(id)
);
```

`payload_json` is the client record as `src/crmStore.ts` already defines it
(`Organization`, `Deal`, `Activity`). The server does NOT re-model those fields: the
one normalizer stays `normalize()` on the client, so there is exactly one place that
decides what a valid record is. The server owns identity, time and access — nothing else.

Soft delete (`deletedAt`) stays INSIDE the payload — the trash view is client logic.
A hard purge deletes the row.

## Commands (frozen — both lanes build against exactly this)

| Command | Args | Returns |
|---|---|---|
| `crm_snapshot` | — | `{ organizations: Json[], deals: Json[], activities: Json[], labels: Json[], stages: Json[], revision: number }` |
| `crm_put_records` | `{ organizations?: Json[], deals?: Json[], activities?: Json[], labels?: Json[], stages?: Json[] }` | `{ revision: number }` |
| `crm_purge_records` | `{ organizationIds?: string[], dealIds?: string[], activityIds?: string[] }` | `{ revision: number }` |

- `revision` = `MAX(updated_at)` over both tables, or `0` when empty. It exists so a
  poller can skip a redundant re-render, NOT as a lock.
- `crm_put_records` upserts by `id`. Records not named are untouched.
- Every record must carry a non-empty string `id`; a payload without one is rejected
  with `"crm record without id"` and the whole call fails (no half write).
- `labels` / `stages` are whole lists, written as one settings row each — they are
  small and shared config, not per-user records.
- All three commands run in ONE transaction each.

## Access

Every authenticated member may read and write the whole CRM. No admin gate, no owner
filter — that is the requirement, and pretending otherwise would be a lie in the UI.
Unauthenticated callers are refused by the existing session gate, like any other command.

`updated_by` records WHO wrote last. It is stored for accountability, not used to
restrict anything yet.

## Live-ness

Polling, like `TeamTasks.tsx` (15 s). `crm_snapshot` is cheap; if `revision` is
unchanged the client does not re-render. No SSE in this step.

## Migration of existing local data

A browser or desktop that already holds `gaia.crm.prototype.v2` must not lose it:

1. On first load with an EMPTY server snapshot, the client offers to upload its local
   document once, and says how many records it will send.
2. After a successful upload the local key is renamed to
   `gaia.crm.prototype.v2.migrated` (kept, not deleted — a backup nobody asked for is
   still better than a hole).
3. If the server snapshot is NOT empty, the local document is never uploaded silently.

## Division of work — file ownership is strict

**Lane A (backend, Rust)** owns and may commit ONLY:
`src-tauri/src/crm.rs` (new), `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`,
`src-tauri/src/bin/space-server.rs`.

**Lane B (frontend, TS)** owns and may commit ONLY:
`src/api/crm.ts` (new), `src/crmStore.ts`, `src/views/CRM.tsx`,
`src/views/CrmActivities.tsx`, `src/crmSync.ts` (new), and its own new test files.

Neither lane touches the other's files. Both commit with an explicit
`git add <paths>` — never `git add -A`, never `git commit -a`.

## Proof

`src/crm.e2e.proof.test.ts` is the only place the two halves meet: the untouched
frontend modules talking HTTP to a running `space-server` as two different logged-in
people. It skips unless `SPACE_E2E` names that server, so the normal suite stays offline.

```
SPACE_DB=/tmp/crmdb/space.db SPACE_PORT=8791 ./target/debug/space-server
SPACE_E2E=http://127.0.0.1:8791 \
SPACE_E2E_COOKIE_A=space_session=<jannes> \
SPACE_E2E_COOKIE_B=space_session=<bjarne> \
bun test src/crm.e2e.proof.test.ts
```

Measured, 2026-09-19: Jannes writes an organization and a deal; Bjarne's session reads
both, adds a second deal with a write that names ONE deal; both deals survive; the
`owner` strings inside the payloads come back as written ("Jannes", "Bjarne") rather
than rebound to the calling session; `12.500` survives verbatim; a deal without an `id`
is refused with `crm record without id` and leaves the revision unchanged; an
unauthenticated caller is refused.
