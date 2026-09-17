# gaia-space DB → ladybug (LoomDB): feasibility measurement

READ-ONLY. worktree /tmp/ladybug-assess @ 4e6136b · refs: ~/projects/ladybug, ~/projects/paloptic
Every number carries the command that produced it. `unknown` = could not measure.

---

## 1 · gaia-space storage surface (what a graph store does NOT give free)

- rusqlite call sites: **36 files**, **534 refs**
  `grep -rl rusqlite --include=*.rs .` (36) · `grep -rh rusqlite --include=*.rs . | wc -l` (534)
  hotspots: documents.rs=122, review.rs=89, chat.rs=79, calls.rs=46, meetings.rs=40, platform.rs=23, applications.rs=27
- SCHEMA_VERSION: **144** — `grep -n 'SCHEMA_VERSION: i64' src-tauri/src/db.rs`
- migration steps in ladder: **118** `if version < N` branches — `grep -cE 'if version < [0-9]+' src-tauri/src/db.rs`
- live tables (distinct names): **164** — `grep -oE 'CREATE TABLE (IF NOT EXISTS )?[a-z_]+' db.rs | awk '{print $NF}' | sort -u | wc -l`
  (188 CREATE TABLE stmts total incl. re-creates across migrations)
- indexes: **107** `CREATE [UNIQUE] INDEX` — `grep -c 'CREATE INDEX\|CREATE UNIQUE INDEX' db.rs`
- FOREIGN KEYs: keyword `FOREIGN KEY`=**0**, but inline `REFERENCES`=**195** AND enforced →
  `db.rs::enforce_foreign_keys` sets `PRAGMA foreign_keys=ON` on *every* connection (open/open_in_memory).
  ⇒ **FK enforcement is REAL and used** (195 references), just declared inline not as table constraints.
- triggers: **17** `CREATE TRIGGER` — `grep -c 'CREATE TRIGGER' db.rs`
- FTS: **1** `search_index USING fts5(entity_type, entity_id, title, body, breadcrumb)` — full-text search index. `grep -n 'USING fts' db.rs`
- explicit transactions: **~75** `.transaction()/unchecked_transaction/BEGIN` refs across src-tauri/src — `grep -rhc ... | awk sum`

⇒ relational features in active use that a property-graph store does not give for free:
  164 typed tables · 195 enforced FKs · 107 secondary indexes · 17 triggers · 1 FTS5 index · ~75 ACID tx sites · 144-step in-place migration ladder.

---

## 2 · Ladybug reality

- what: `~/projects/ladybug` = **LoomDB**, a fork of **LadybugDB (Kùzu lineage)**, MIT — `head README.md`, `FORK-SURVEY.md`
- version: **project Lbug 0.20.0** (ext 0.19.0) — `grep VERSION CMakeLists.txt` (`project(Lbug VERSION 0.20.0 ...)`)
- language: **C++20 / C11**; 157,315 C++ .cpp + 70,153 headers (FORK-SURVEY LOC table); build = CMake ≥3.15 / Makefile frontend
- model: **embedded graph DB, Cypher, node/rel tables, columnar, ACID, native FTS + vector index**
- client interfaces present in tree: `tools/{rust_api, nodejs_api, python_api, java_api, wasm, c_api(src/c_api), shell(lbug)}`
  BUT **`tools/rust_api` and `tools/nodejs_api` are EMPTY** (uninitialized submodules) — `ls -la tools/rust_api tools/nodejs_api` → 0 files
  no `lbug` built: `find build -name lbug` → none; `which lbug` → none
- **how paloptic actually talks to it (packages/graph/src/loom.ts):** ONLY via the **`lbug` CLI shell binary**, spawned as a subprocess:
  `Bun.spawn(["/bin/sh","-c","exec \"$@\"","sh", lbug, dbPath, "--nostats", "--no_progress_bar", ...])` — stdin=Cypher, stdout=results.
  No Rust crate, no C API, no node binding in paloptic — `grep kuzu|ladybug|lbug package.json` → nothing. Pure text-over-stdio CLI.
- concurrency: **single-writer, exclusive file lock**. loom.ts comment: "Native shell connections acquire exclusive file locks, including JSON reads."
  paloptic works around it with a JS mutex `serializedLoomProcess()` that serializes ALL callers on one DB path (loom-concurrency.test.ts proves N callers serialize).
- transactions: per-`lbug`-invocation only (Cypher script run atomically); no cross-request app-level tx handle like rusqlite `.transaction()`.
- durability: columnar disk store + WAL (Kùzu lineage); adequate for the analytics view, but exercised via one-shot CLI runs, not a long-lived server connection.
- migration story: **none in-DB** — loom.ts does `rm -rf outputDir` then rebuilds the whole DB from graph.json via `CREATE NODE/REL TABLE` + `COPY ... FROM csv`. Schema evolution = re-import, not migrate.

---

## 3 · Where paloptic's CANONICAL data lives  ← CRUX

**Ladybug is NOT the system of record. It is a fully materialized, disposable analytics view.**
- pipeline: source → `extract.ts::buildGraph()` → `emit.ts::writeGraph()` writes **viz/data/graph.json** → `loom.ts::loadGraphToLoom()` `rm -rf` the loom dir, regenerates CSVs from graph.json, `COPY` into `paloptic.lbug`.
- i.e. `paloptic.lbug` is derived from `graph.json`, which is itself derived (buildGraph) from upstream source data.
- ⇒ **if gaia-space "used the same db", it would be a one-way SYNC/EXPORT into a rebuildable view — NOT a port of the system of record.** gaia-space's 164-table sqlite IS a system of record; ladybug here is not.

---

## 4 · Port cost + what would be LOST

Port cost, in the units counted:
- rewrite **534 rusqlite call sites across 36 files** to a graph client — and there is **no usable client**: rust_api submodule empty, so either init+build the C++ tree (157k+70k LOC, CMake) to get a Rust crate, or drive it over the same `lbug` stdio CLI paloptic uses (text marshalling for 534 sites — non-starter for a transactional server).
- remodel **164 relational tables → node/rel tables** (Cypher DDL); re-express **195 FK references, 107 indexes, 17 triggers, 1 FTS5 index** in graph terms.
- reproduce **~75 ACID transaction sites** on a store whose paloptic access pattern is **single-writer, exclusive-lock, one-process-at-a-time** — a multi-user server backend regression.

What would be LOST:
- **FK enforcement** — 195 enforced references (`foreign_keys=ON` every connection) → graph store gives edges, not referential-integrity constraints on the 164 tables.
- **FTS** — the `search_index` fts5 index (server-side full-text search) → would need ladybug's separate FTS extension re-indexed off the view.
- **the 144-step migration history** — in-place `user_version` ladder (118 branches, `migrate_real_copy.rs` asserts real-copy climb to 144). Ladybug path = drop+re-import, so 144 steps of accreted schema evolution are discarded, not carried.
- **the sqlite-file backup ritual** (deploy/rollout.sh, .github/workflows/deploy-space.yml):
  - live DB = single file `/var/lib/gaia-space/space.db`.
  - rollout does: **pre-census** (`PRAGMA user_version` + `integrity_check` + per-table row counts) → **WAL-safe live copy via sqlite3 `src.backup(dst)`** into `/root/gaia-space-backups/$STAMP/space.db` → **census-diff** the backup must equal pre-census → install/migrate/verify → **on any gate failure, restore space.db from that backup**.
  - this whole one-file, hot-backup, verify-by-census, atomic-rollback ritual has no equivalent for a columnar multi-file graph store; it would have to be reinvented.

---

## 5 · Cheaper alternatives + cost

(a) **sqlite stays system of record; export a graph VIEW into ladybug for cross-product analysis** (mirror what paloptic already does: dump → graph.json → COPY into .lbug).
   cost: write ONE exporter (sqlite → graph.json), reuse paloptic's existing `loadGraphToLoom`. ~0 changes to the 534 call sites, 0 tables remodeled, 0 lost features. Gains cross-product Cypher analytics.
   this is the ONLY option that answers the underlying wish ("same db as paloptic" = shared analysis surface) without regressing the server.

(b) **one shared postgres** (both products on PG).
   cost: still rewrites 534 rusqlite sites (rusqlite→postgres client), remodels/migrates 164 tables + 144-step ladder into PG migrations, re-does FTS (PG tsvector) and backup (pg_dump/PITR). Large, but keeps relational integrity/FK/FTS/tx — unlike ladybug. Does NOT unify with paloptic's graph model; paloptic's canonical is still graph.json.

(c) **nothing.**
   cost: 0. Two stores stay purpose-fit: gaia-space=relational OLTP system of record; ladybug=paloptic's disposable graph analytics view.

---

## Bottom line (5 lines)
1. A "port" is infeasible as posed: ladybug is NOT a system of record — it's a rebuildable analytics view derived from graph.json; "same db" = a SYNC, not a port.
2. No usable programmatic client exists here anyway: rust_api/nodejs_api submodules empty, no lbug built; paloptic drives it purely by spawning the `lbug` CLI over stdio — unfit for 534 transactional call sites.
3. Porting would rewrite 534 call sites / 36 files, remodel 164 tables, and LOSE 195 enforced FKs, 107 indexes, 17 triggers, the fts5 search index, the 144-step migration ladder, and the single-file sqlite hot-backup+census+rollback ritual — plus regress from concurrent writers to single-writer exclusive-lock.
4. Recommendation: **option (a)** — keep sqlite as system of record, add a sqlite→graph.json exporter and reuse paloptic's `loadGraphToLoom` to publish a graph view into ladybug for cross-product Cypher analysis. Near-zero risk, gets the actual benefit.
5. Reject a full port (a/b heavy, ladybug not authoritative); "nothing" (c) is a valid do-no-harm baseline.
