//! SQLite persistence: one application-data database, versioned migrations, first-run seed.
use rusqlite::{Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
#[cfg(feature = "desktop")]
use tauri::{AppHandle, Manager};

pub const SCHEMA_VERSION: i64 = 75;

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_db_path(p: PathBuf) {
    let _ = DB_PATH.set(p);
}

/// Every connection enforces foreign keys: junction rows (e.g. `todo_assignees`)
/// must never survive their parent row. SQLite defaults this pragma to OFF.
pub fn enforce_foreign_keys(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")
}

/// The only sanctioned file-backed connection constructor: every caller (production or
/// test) gets `foreign_keys=ON`. Direct `Connection::open` outside this module would
/// silently reintroduce orphan junction rows.
pub fn open_at(path: impl AsRef<Path>) -> Result<Connection> {
    let conn = Connection::open(path.as_ref())?;
    // Concurrent writers (webhook queue sweepers, the HTTP server's per-request
    // connections) must wait for the write lock instead of failing the caller.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    enforce_foreign_keys(&conn)?;
    Ok(conn)
}

/// In-memory counterpart of [`open_at`], likewise foreign-key enforced.
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    enforce_foreign_keys(&conn)?;
    Ok(conn)
}

/// Test databases live in a directory reserved with `create_dir`, which is atomic and
/// fails when the name is taken. PID+clock names are not exclusive across processes
/// (PIDs are recycled, clocks are coarse), and deleting a "stale" file would destroy a
/// live database owned by another process. Dropping the guard removes only our own dir.
/// V65: Optional date-only calendar event attached to one published blog article.
pub(crate) const SCHEMA_V65: &str = r#"
CREATE TABLE IF NOT EXISTS blog_calendar_events (
    post_id TEXT PRIMARY KEY REFERENCES blog_posts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    CHECK(event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
CREATE INDEX IF NOT EXISTS blog_calendar_events_date ON blog_calendar_events(event_date);
"#;

#[cfg(test)]
pub struct TempDb {
    dir: PathBuf,
    path: PathBuf,
}

#[cfg(test)]
impl TempDb {
    pub fn new(prefix: &str) -> TempDb {
        let base = std::env::temp_dir();
        let mut attempt: u64 = 0;
        loop {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = base.join(format!("{prefix}-{}-{nanos}-{attempt}", std::process::id()));
            match std::fs::create_dir(&dir) {
                Ok(()) => {
                    let path = dir.join("test.sqlite");
                    return TempDb { dir, path };
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => attempt += 1,
                Err(e) => panic!("temp database directory: {e}"),
            }
        }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
impl AsRef<Path> for TempDb {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// `SPACE_DB` is process-global: any test that repoints it must hold this guard, or a
/// sibling test running in parallel loses its database mid-assertion.
#[cfg(test)]
pub fn test_serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The single precedence rule for "which file is *the* database", shared by every
/// entry point. Split databases (one IPC command on the app-data file, the next on
/// `SPACE_DB`) are the failure this function exists to make impossible: an explicit
/// `set_db_path` binding wins, then `SPACE_DB`, then the platform app-data dir.
pub fn resolve_db_path(
    bound: Option<PathBuf>,
    env: Option<PathBuf>,
    app_data: Option<PathBuf>,
) -> Result<PathBuf, String> {
    bound
        .or(env)
        .or(app_data)
        .ok_or_else(|| "database path unavailable; call set_db_path or set SPACE_DB".to_string())
}

fn env_db_path() -> Option<PathBuf> {
    std::env::var_os("SPACE_DB").map(PathBuf::from)
}

pub fn conn() -> Result<Connection, String> {
    let path = resolve_db_path(DB_PATH.get().cloned(), env_db_path(), None)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = open_at(path).map_err(|e| e.to_string())?;
    migrate(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// The directory that holds this installation's state. Blob payloads (uploaded document
/// files) live beside the database so a backup of one is a backup of the other; the
/// location follows the same precedence as the database itself and is never hardcoded.
pub fn data_dir() -> Result<PathBuf, String> {
    let path = resolve_db_path(DB_PATH.get().cloned(), env_db_path(), None)?;
    Ok(path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(".")))
}

/// Where this installation's database lives when nothing overrides it.
#[cfg(feature = "desktop")]
pub fn app_data_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("space.db"))
}

/// AppHandle-taking front door. It does **not** open its own file: it binds the
/// process-global path (app-data dir unless already bound / `SPACE_DB`-overridden)
/// and then hands back the same connection `conn()` gives. So an IPC command that
/// takes an `AppHandle` (recording start/stop, actor resolution) and one that does
/// not (`list_meeting_recordings`, meeting authorization) always read one database.
#[cfg(feature = "desktop")]
pub fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path = resolve_db_path(
        DB_PATH.get().cloned(),
        env_db_path(),
        Some(app_data_db_path(app)?),
    )?;
    set_db_path(path);
    conn()
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    if version < 1 {
        tx.execute_batch(SCHEMA_V1)?;
    }
    if version < 2 {
        tx.execute_batch(SCHEMA_V2)?;
    }
    if version < 3 {
        tx.execute_batch(SCHEMA_V3)?;
    }
    if version < 4 {
        tx.execute_batch(SCHEMA_V4)?;
    }
    // V5 repairs the historic V3 collision: databases stamped V3 by the
    // todo-assignee branch missed users/sessions. Every statement is idempotent.
    if version < 5 {
        tx.execute_batch(SCHEMA_V5)?;
    }
    if version < 6 {
        add_column_if_missing(&tx, "todos", "project_id", "TEXT REFERENCES projects(id)")?;
        tx.execute_batch(SCHEMA_V6)?;
    }
    if version < 7 {
        add_column_if_missing(&tx, "projects", "deadline", "TEXT")?;
        tx.execute_batch(SCHEMA_V7)?;
    }
    if version < 8 {
        tx.execute_batch(SCHEMA_V8)?;
    }
    if version < 9 {
        tx.execute_batch(SCHEMA_V9)?;
    }
    // V10: issues carry a priority (NULL = unset, then LOW/MEDIUM/HIGH/URGENT).
    if version < 10 {
        add_column_if_missing(&tx, "issues", "priority", "TEXT")?;
    }
    // V11: todos carry collaboration notes (NULL = legacy row / no notes).
    if version < 11 {
        add_column_if_missing(&tx, "todos", "notes", "TEXT")?;
    }
    // V12: an issue is worked by PEOPLE, not by one person — same shape tasks
    // already had. `issues.assignee_id` stays as the first/primary assignee so
    // every legacy filter keeps working; the junction is the truth.
    if version < 12 {
        tx.execute_batch(SCHEMA_V12)?;
    }
    // V13: read-only external calendar feeds (calendar_feeds.rs) — a sealed
    // iCal URL per profile, and a derived cache of the events it last parsed
    // to. The cache is a projection (delete+reinsert on every sync); the feed
    // row and its sealed URL are the only durable state.
    if version < 13 {
        tx.execute_batch(SCHEMA_V13)?;
    }
    if version < 14 {
        tx.execute_batch(SCHEMA_V14)?;
    }
    if version < 15 {
        tx.execute_batch(SCHEMA_V15)?;
    }
    if version < 16 {
        tx.execute_batch(SCHEMA_V16)?;
    }
    if version < 17 {
        tx.execute_batch(SCHEMA_V17)?;
    }
    if version < 18 {
        tx.execute_batch(SCHEMA_V18)?;
    }
    // V19: safe-merge runs retain the exact refs checked before finalization.
    if version < 19 {
        add_column_if_missing(&tx, "reviews", "repo_path", "TEXT")?;
        add_column_if_missing(&tx, "safe_merge_runs", "source_oid", "TEXT")?;
        add_column_if_missing(&tx, "safe_merge_runs", "target_oid", "TEXT")?;
        add_column_if_missing(&tx, "safe_merge_runs", "merge_commit_oid", "TEXT")?;
    }
    if version < 20 {
        tx.execute_batch(SCHEMA_V20)?;
    }
    // V21: explicit per-document viewer/editor grants for private documents.
    if version < 21 {
        tx.execute_batch(SCHEMA_V21)?;
    }
    // V22: CODEOWNERS is read from each MR's source commit; no cache belongs in SQLite.
    if version < 22 {
        tx.execute_batch(SCHEMA_V22)?;
    }
    if version < 23 {
        tx.execute_batch(SCHEMA_V23)?;
    }
    if version < 24 {
        // JSON array of external check names the gate waits for (KB §3.1 item 6);
        // consumed by review::evaluate_quality_gate_tx.
        add_column_if_missing(&tx, "quality_gate_rules", "external_checks_json", "TEXT")?;
        tx.execute_batch(SCHEMA_V24)?;
    }
    if version < 25 {
        tx.execute_batch(SCHEMA_V25)?;
    }
    if version < 26 {
        add_column_if_missing(&tx, "package_repositories", "retention_days", "INTEGER")?;
        add_column_if_missing(
            &tx,
            "package_repositories",
            "retention_version_count",
            "INTEGER",
        )?;
        add_column_if_missing(
            &tx,
            "package_repositories",
            "retain_downloaded",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        add_column_if_missing(
            &tx,
            "package_repositories",
            "access_level",
            "TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(access_level IN ('PRIVATE','PROJECT','PUBLIC'))",
        )?;
        add_column_if_missing(&tx, "package_versions", "accessed_at", "INTEGER")?;
        add_column_if_missing(
            &tx,
            "package_versions",
            "downloads",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &tx,
            "package_versions",
            "pinned",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        tx.execute_batch(SCHEMA_V26)?;
    }
    if version < 27 {
        tx.execute_batch(SCHEMA_V27)?;
    }
    // V29: subscriptions gain a target scope (org/team/project/location/profile/entity).
    if version < 29 {
        tx.execute_batch(SCHEMA_V29)?;
    }
    // V31: application OAuth credentials/tokens and the marketplace install model.
    if version < 31 {
        tx.execute_batch(SCHEMA_V31)?;
    }
    // V32: normalized, format-specific package metadata alongside legacy generic JSON.
    if version < 32 {
        add_column_if_missing(&tx, "package_versions", "format_metadata_json", "TEXT")?;
        tx.execute_batch(SCHEMA_V32)?;
    }
    if version < 33 {
        add_column_if_missing(
            &tx,
            "package_versions",
            "immutable",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        tx.execute_batch(SCHEMA_V33)?;
    }
    if version < 34 {
        add_column_if_missing(&tx, "documents", "published", "INTEGER NOT NULL DEFAULT 0")?;
        add_column_if_missing(&tx, "documents", "published_at", "INTEGER")?;
        add_column_if_missing(&tx, "documents", "public_slug", "TEXT")?;
        tx.execute_batch(SCHEMA_V34)?;
    }
    // V36: the authorization-code flow. V31 already owns `app_secrets`, so V36 no
    // longer declares it — a confidential client has exactly one secret, whichever
    // grant it uses.
    if version < 36 {
        tx.execute_batch(SCHEMA_V36)?;
    }
    // V37: right descriptors are additive and guarded individually because test
    // databases may contain a partially-applied migration batch.
    if version < 37 {
        add_column_if_missing(&tx, "rights", "flags", "INTEGER NOT NULL DEFAULT 0")?;
        add_column_if_missing(
            &tx,
            "rights",
            "implied_rights_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        add_column_if_missing(&tx, "rights", "feature_gate", "TEXT")?;
        add_column_if_missing(&tx, "rights", "propagation", "TEXT NOT NULL DEFAULT 'NONE'")?;
        add_column_if_missing(
            &tx,
            "rights",
            "descriptor_json",
            "TEXT NOT NULL DEFAULT '{}'",
        )?;
        tx.execute_batch(SCHEMA_V37)?;
    }
    // V38: recording/egress lifecycle is durable state, not process memory. The table
    // never existed on master, so the final shape lands in one DDL for both fresh and
    // V37 databases.
    if version < 38 {
        tx.execute_batch(SCHEMA_V38)?;
    }
    // V39: a webhook endpoint cannot trust an unsigned POST, and a failing endpoint
    // must stop being retried at some point. Both facts are per-subscription state, so
    // they are columns on `webhook_subscriptions`, added individually because older
    // databases may already carry a partially-applied batch.
    // `webhook_subscriptions` may be absent in hand-built partial databases (test
    // fixtures pinned to an old user_version), so the additive step is table-guarded.
    if version < 39 && table_exists(&tx, "webhook_subscriptions")? {
        add_column_if_missing(&tx, "webhook_subscriptions", "secret", "TEXT")?;
        add_column_if_missing(
            &tx,
            "webhook_subscriptions",
            "max_attempts",
            "INTEGER NOT NULL DEFAULT 5",
        )?;
    }
    // V40 keeps legacy doc_type stable and adds an independently versioned body mode.
    // Same table-guard rationale as V39: hand-built partial fixtures may lack the table.
    if version < 40 && table_exists(&tx, "documents")? {
        add_column_if_missing(&tx, "documents", "body_format", "TEXT NOT NULL DEFAULT 'text' CHECK(body_format IN ('text','rich-text','checklist','code'))")?;
    }
    // V41: a webhook secret must be rotatable without a delivery gap, so the single
    // `webhook_subscriptions.secret` column becomes a key ring. The column stays (older
    // readers and `save_webhook` still use it) and its value is copied into the first
    // ACTIVE row, so a database that never rotates behaves exactly as before.
    if version < 41 {
        tx.execute_batch(SCHEMA_V41)?;
        if table_exists(&tx, "webhook_subscriptions")? {
            tx.execute(
                "INSERT INTO webhook_secrets(id,webhook_id,secret,state,created_at) SELECT 'whsec-'||id,id,secret,'ACTIVE',unixepoch() FROM webhook_subscriptions WHERE secret IS NOT NULL AND secret<>'' AND id NOT IN (SELECT webhook_id FROM webhook_secrets)",
                [],
            )?;
        }
    }
    // V43: an uploaded file is a document whose body lives outside SQLite. The blob is
    // stored next to the database and the row carries only the metadata needed to serve
    // it back (original name, declared type, size, on-disk path), so a large upload never
    // bloats the database file or a version snapshot.
    if version < 43 && table_exists(&tx, "documents")? {
        tx.execute_batch(SCHEMA_V43)?;
    }
    // V45: IDE discovery state. V43/V44 are reserved by paired lanes.
    if version < 45 {
        tx.execute_batch(SCHEMA_V45)?;
    }
    // V46: dashboard widget visibility is an account preference, not browser state.
    if version < 46 {
        tx.execute_batch(SCHEMA_V46)?;
    }
    if version < 49 {
        tx.execute_batch(SCHEMA_V49)?;
    }
    // V51: feed destinations are optional; legacy rows remain unassigned. Hand-built
    // partial fixtures may predate V13 and have no feed table at all.
    if version < 51 && table_exists(&tx, "calendar_feeds")? {
        add_column_if_missing(
            &tx,
            "calendar_feeds",
            "calendar_id",
            "TEXT REFERENCES calendars(id) ON DELETE SET NULL",
        )?;
        tx.execute_batch(SCHEMA_V51)?;
    }
    // V52: each application owns one Ed25519 signing key pair used to sign outbound
    // typed application payloads. The private key never leaves this table; the public
    // key is what an app SDK verifies with, and rotation keeps the previous public key
    // visible so a receiver mid-rotation can still validate an in-flight payload.
    if version < 52 {
        tx.execute_batch(SCHEMA_V52)?;
    }
    // V53: to-do content kind and confidential absence availability; column-only migration.
    if version < 53 {
        if table_exists(&tx, "todos")? {
            add_column_if_missing(&tx, "todos", "content_kind", "TEXT NOT NULL DEFAULT 'text'")?;
        }
        if table_exists(&tx, "absences")? {
            add_column_if_missing(
                &tx,
                "absences",
                "reason_confidential",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                &tx,
                "absences",
                "availability",
                "TEXT NOT NULL DEFAULT 'away'",
            )?;
        }
    }
    if version < 54 {
        tx.execute_batch(SCHEMA_V54)?;
    }
    // V55: dev environment lifecycle. State, idle deadline and the preserved home/work
    // trees are database facts, not runtime memory: hibernation must survive a restart
    // of the server, otherwise a hibernated environment silently loses its snapshot.
    if version < 55 {
        tx.execute_batch(SCHEMA_V55)?;
    }
    // V56: two-stage application rights (KB §07 §2.2 `ApplicationRights`). What an app
    // *declares it needs* and what an admin *granted it in one context* are different
    // facts with different authors; keeping them in one table would make a developer's
    // manifest edit silently widen a granted scope.
    if version < 56 {
        tx.execute_batch(SCHEMA_V56)?;
    }
    // V58: Right taxonomy (KB §05 §2.1). Group codes become `RightGroup` codes, and
    // every persisted right gets the propagation the catalog defines for it. Rows
    // seeded before this migration carried group *labels* and a blanket `'NONE'`
    // propagation, which read as "grant only at the exact scope" for rights that were
    // in fact being honoured organization-wide — the stored value contradicted the
    // resolver. Descriptor columns are rewritten; `implied_rights_json` is not, because
    // an administrator may have edited the implication graph deliberately.
    if version < 58 && table_exists(&tx, "rights")? {
        tx.execute(
            "UPDATE rights SET right_group='DevEnvironments' WHERE right_group='Dev Environments'",
            [],
        )?;
        tx.execute(
            "UPDATE rights SET right_group='Planning' WHERE right_group='Issues'",
            [],
        )?;
        tx.execute(
            "UPDATE rights SET propagation=?1",
            [crate::rights::PROPAGATION_GLOBAL_TO_DESCENDANTS],
        )?;
        for code in crate::rights::NON_PROPAGATING_RIGHTS {
            tx.execute(
                "UPDATE rights SET propagation=?1 WHERE code=?2",
                rusqlite::params![crate::rights::PROPAGATION_NONE, code],
            )?;
        }
        for (group, flag) in crate::rights::FEATURE_GATES {
            tx.execute(
                "UPDATE rights SET feature_gate=?1 WHERE right_group=?2",
                rusqlite::params![flag, group],
            )?;
        }
        for group in ["Books", "Internal"] {
            tx.execute(
                "UPDATE rights SET flags=?1 WHERE right_group=?2",
                rusqlite::params![crate::rights::default_flags(group), group],
            )?;
        }
    }
    // V60: CalDAV-owned VEVENTs are durable and separate from read-only feed cache.
    if version < 60 {
        tx.execute_batch(SCHEMA_V60)?;
    }
    // V61: quality-gate application/role principals.  These are nullable JSON
    // principal lists so every existing rule keeps its prior meaning.
    if version < 61 && table_exists(&tx, "quality_gate_rules")? {
        add_column_if_missing(&tx, "quality_gate_rules", "applications_json", "TEXT")?;
        add_column_if_missing(&tx, "quality_gate_rules", "roles_json", "TEXT")?;
    }
    // V62: the credential surface KB §05 §3.2-3.6 requires beside the password:
    // TOTP scratch codes (a lost phone must not lock an account out), application
    // passwords (legacy clients cannot answer a 2FA prompt), configurable login
    // modules with their own order and remember-me TTLs, and the OAuth
    // request-rights queue whose `<context>:<permission>` scope strings an admin
    // approves or denies one right at a time.
    if version < 62 {
        tx.execute_batch(SCHEMA_V62)?;
    }
    // V63: self-hosted worker lifecycle (KB §03 §2.3 `WorkerDTO`, §1.2 worker pools).
    // Three facts the previous `workers` row could not carry:
    //   * `suspended` — an admin disabling a worker is NOT the same fact as the worker
    //     going OFFLINE by a missed heartbeat; collapsing them would let a heartbeat
    //     silently return a worker an admin took out of rotation.
    //   * `job_runs.worker_id` — which worker owns a run. Without it a claim cannot be
    //     exclusive and two workers can execute the same run.
    //   * `job_runs.required_tags_json` — the run's worker-tag requirement, so assignment
    //     is a query over stored facts, not a runtime guess.
    if version < 63 {
        if table_exists(&tx, "workers")? {
            add_column_if_missing(&tx, "workers", "suspended", "INTEGER NOT NULL DEFAULT 0")?;
        }
        if table_exists(&tx, "job_runs")? {
            add_column_if_missing(&tx, "job_runs", "worker_id", "TEXT")?;
            add_column_if_missing(
                &tx,
                "job_runs",
                "required_tags_json",
                "TEXT NOT NULL DEFAULT '[]'",
            )?;
            tx.execute_batch("CREATE INDEX IF NOT EXISTS job_runs_worker ON job_runs(worker_id);")?;
        }
    }
    // V65: optional date-only calendar events owned by published blog articles.
    if version < 65 {
        tx.execute_batch(SCHEMA_V65)?;
    }
    // V66: rooms are reusable locations; equipment is a separately searchable fact.
    if version < 66 {
        tx.execute_batch(SCHEMA_V66)?;
    }
    // V67: durable single-tenant organization data. Multi-workspace selection is
    // client-side and therefore never cross-contaminates server records.
    if version < 67 {
        tx.execute_batch(SCHEMA_V67)?;
    }
    // V74: standby pool targets make claims self-replenishing rather than a one-shot row transfer.
    if version < 74 {
        tx.execute_batch(SCHEMA_V74)?;
    }
    // V68: schedule dispatch claims a job+minute in SQLite, so concurrent pollers
    // cannot both turn the same cron fire into a run. NULL preserves manual/event runs.
    // Numbered last because this lane integrates after V64-V67 (PARITY.md ladder).
    if version < 68 && table_exists(&tx, "job_runs")? {
        add_column_if_missing(&tx, "job_runs", "fired_minute", "INTEGER")?;
        tx.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS job_runs_scheduled_once ON job_runs(job_id, fired_minute) WHERE fired_minute IS NOT NULL;")?;
    }
    // V71: importer runs are durable audit facts. The stored source is the operator-selected
    // path (never its contents); counts make partial imports visible after the toast is gone.
    if version < 71 {
        tx.execute_batch(SCHEMA_V71)?;
    }
    // V75: an attachment's upload is a lifecycle, not an instant. A row can exist while its
    // bytes are still moving (uploading) or after the transfer failed; without a stored state
    // the client cannot tell a finished attachment from a stalled one after a reload.
    // Existing rows are complete by construction, hence DEFAULT 'completed'.
    if version < 75 && table_exists(&tx, "message_attachments")? {
        add_column_if_missing(
            &tx,
            "message_attachments",
            "upload_state",
            "TEXT NOT NULL DEFAULT 'completed'",
        )?;
        add_column_if_missing(&tx, "message_attachments", "error", "TEXT")?;
    }
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit()
}

pub fn seed(conn: &Connection) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO profiles (id, username, display_name, created_at) VALUES ('default-org', 'gaia', 'GAIA Organization', unixepoch())", [])?;
    conn.execute("INSERT OR IGNORE INTO projects (id, name, key, description, created_by, created_at) VALUES ('demo-project', 'Demo Project', 'DEMO', 'Your persisted Space project', 'default-org', unixepoch())", [])?;
    Ok(())
}

#[cfg(test)]
pub fn migrate_path(path: impl AsRef<Path>) -> Result<Connection> {
    let conn = open_at(path)?;
    migrate(&conn)?;
    seed(&conn)?;
    Ok(conn)
}

/// V71: local/Confluence-folder importer audit ledger. Source paths are metadata only;
/// imported document bodies and attachment payloads remain in their normal stores.
pub(crate) const SCHEMA_V71: &str = r#"
CREATE TABLE IF NOT EXISTS document_imports (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    container_type TEXT NOT NULL,
    container_id TEXT,
    parent_folder_id TEXT,
    created_by TEXT REFERENCES profiles(id),
    folders_created INTEGER NOT NULL DEFAULT 0,
    documents_created INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS document_imports_container ON document_imports(container_type, container_id, created_at DESC);
"#;

/// V66: durable room inventory, equipment capabilities and a meeting reservation.
pub(crate) const SCHEMA_V66: &str = r#"
CREATE TABLE IF NOT EXISTS meeting_rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT, capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity > 0), archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS meeting_room_equipment (room_id TEXT NOT NULL REFERENCES meeting_rooms(id) ON DELETE CASCADE, equipment TEXT NOT NULL, PRIMARY KEY(room_id, equipment));
CREATE TABLE IF NOT EXISTS meeting_room_bookings (meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES meeting_rooms(id), UNIQUE(room_id, meeting_id));
CREATE INDEX IF NOT EXISTS meeting_room_bookings_room ON meeting_room_bookings(room_id);
"#;

pub(crate) const SCHEMA_V3: &str = r#"
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), role TEXT NOT NULL CHECK(role IN ('admin','member')), active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
"#;

pub(crate) const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), content TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0, source_entity_type TEXT, source_entity_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), CHECK((source_entity_type IS NULL) = (source_entity_id IS NULL)));
CREATE TABLE IF NOT EXISTS absences (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), reason_type TEXT NOT NULL, date_from TEXT NOT NULL, date_to TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()), CHECK(date_to >= date_from));
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES profiles(id), event_type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, entity_type TEXT, entity_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), read_at INTEGER, CHECK((entity_type IS NULL) = (entity_id IS NULL)));
CREATE TABLE IF NOT EXISTS subscription_settings (profile_id TEXT NOT NULL REFERENCES profiles(id), event_type TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(profile_id, event_type));
CREATE TABLE IF NOT EXISTS member_locations (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), location TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('Region','Campus','Building','Floor','Room','ConferenceRoom')), created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE INDEX IF NOT EXISTS todos_profile_done_due ON todos(profile_id, done, due_date);
CREATE INDEX IF NOT EXISTS absences_dates ON absences(date_from, date_to);
CREATE INDEX IF NOT EXISTS notifications_recipient_read ON notifications(recipient_id, read_at, created_at);
"#;

pub(crate) const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT, avatar_url TEXT, external INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, parent_id TEXT REFERENCES teams(id), channel_id TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS team_memberships (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), team_id TEXT NOT NULL REFERENCES teams(id), role_id TEXT REFERENCES roles(id), lead INTEGER NOT NULL DEFAULT 0, manager_id TEXT REFERENCES profiles(id), since_date TEXT, till_date TEXT, requires_approval INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, parent_id TEXT REFERENCES roles(id), role_type TEXT NOT NULL DEFAULT 'CUSTOM', archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS rights (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, right_type TEXT NOT NULL, right_group TEXT);
CREATE TABLE IF NOT EXISTS role_rights (role_id TEXT NOT NULL REFERENCES roles(id), right_id TEXT NOT NULL REFERENCES rights(id), PRIMARY KEY(role_id, right_id));
CREATE TABLE IF NOT EXISTS role_assignments (id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES roles(id), profile_id TEXT REFERENCES profiles(id), team_id TEXT REFERENCES teams(id), scope_type TEXT NOT NULL CHECK(scope_type IN ('global','project','team','channel','document')), scope_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, description TEXT, created_by TEXT REFERENCES profiles(id), archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cf_definitions (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, cf_type TEXT NOT NULL, name TEXT NOT NULL, constraints_json TEXT, default_json TEXT, ordering INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cf_values (definition_id TEXT NOT NULL REFERENCES cf_definitions(id), entity_id TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(definition_id, entity_id));
CREATE TABLE IF NOT EXISTS issue_statuses (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#6b7280', ordering INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, status_id TEXT REFERENCES issue_statuses(id), assignee_id TEXT REFERENCES profiles(id), created_by TEXT REFERENCES profiles(id), due_date TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(project_id, number));
CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, backlog_type TEXT NOT NULL DEFAULT 'manual', archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS board_columns (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), name TEXT NOT NULL, ordering INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS column_statuses (column_id TEXT NOT NULL REFERENCES board_columns(id), status_id TEXT NOT NULL REFERENCES issue_statuses(id), PRIMARY KEY(column_id, status_id));
CREATE TABLE IF NOT EXISTS sprints (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PLANNED', starts_on TEXT, ends_on TEXT, description TEXT, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS swimlanes (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), sprint_id TEXT REFERENCES sprints(id), name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, ordering INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS issue_board_positions (issue_id TEXT NOT NULL REFERENCES issues(id), board_id TEXT NOT NULL REFERENCES boards(id), sprint_id TEXT REFERENCES sprints(id), swimlane_id TEXT REFERENCES swimlanes(id), position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(issue_id, board_id));
CREATE TABLE IF NOT EXISTS planning_tags (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), parent_id TEXT REFERENCES planning_tags(id), name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS issue_tags (issue_id TEXT NOT NULL REFERENCES issues(id), tag_id TEXT NOT NULL REFERENCES planning_tags(id), PRIMARY KEY(issue_id, tag_id));
CREATE TABLE IF NOT EXISTS checklists (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), title TEXT NOT NULL, ordering INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS checklist_items (id TEXT PRIMARY KEY, checklist_id TEXT NOT NULL REFERENCES checklists(id), parent_id TEXT REFERENCES checklist_items(id), item_text TEXT NOT NULL, item_done INTEGER NOT NULL DEFAULT 0, ordering INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS time_tracking_entries (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), profile_id TEXT NOT NULL REFERENCES profiles(id), entry_date TEXT NOT NULL, duration_minutes INTEGER NOT NULL, description TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS issue_links (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), linked_issue_id TEXT NOT NULL REFERENCES issues(id), link_type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, content_type TEXT NOT NULL CHECK(content_type IN ('dm','private','public','entity-bound')), name TEXT, description TEXT, project_id TEXT REFERENCES projects(id), archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS channel_members (channel_id TEXT NOT NULL REFERENCES channels(id), profile_id TEXT NOT NULL REFERENCES profiles(id), administrator INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(channel_id, profile_id));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), author_id TEXT REFERENCES profiles(id), text TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), edited_at INTEGER, thread_of TEXT REFERENCES messages(id), archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reactions (message_id TEXT NOT NULL REFERENCES messages(id), profile_id TEXT NOT NULL REFERENCES profiles(id), emoji TEXT NOT NULL, PRIMARY KEY(message_id, profile_id, emoji));
CREATE TABLE IF NOT EXISTS read_state (channel_id TEXT NOT NULL REFERENCES channels(id), profile_id TEXT NOT NULL REFERENCES profiles(id), message_id TEXT REFERENCES messages(id), read_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(channel_id, profile_id));
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), number INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('MR','commit-set')), state TEXT NOT NULL, source_branch TEXT, target_branch TEXT, title TEXT NOT NULL, turn_based INTEGER NOT NULL DEFAULT 0, channel_id TEXT REFERENCES channels(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(project_id, number));
CREATE TABLE IF NOT EXISTS review_participants (review_id TEXT NOT NULL REFERENCES reviews(id), profile_id TEXT NOT NULL REFERENCES profiles(id), role TEXT NOT NULL, state TEXT CHECK(state IN ('accepted','rejected','waiting')), their_turn INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(review_id, profile_id));
CREATE TABLE IF NOT EXISTS review_discussions (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id), file_path TEXT NOT NULL, line_start INTEGER, line_end INTEGER, revision TEXT, resolved INTEGER NOT NULL DEFAULT 0, channel_id TEXT REFERENCES channels(id));
CREATE TABLE IF NOT EXISTS quality_gate_rules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), branch_pattern TEXT NOT NULL, min_approvals INTEGER NOT NULL DEFAULT 0, required_reviewers_json TEXT, codeowners_required INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS safe_merge_runs (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id), state TEXT NOT NULL, is_dry_run INTEGER NOT NULL DEFAULT 0, log TEXT, started_at INTEGER NOT NULL DEFAULT (unixepoch()), finished_at INTEGER);
CREATE TABLE IF NOT EXISTS document_folders (id TEXT PRIMARY KEY, container_type TEXT NOT NULL CHECK(container_type IN ('my-docs','project','kb')), container_id TEXT, parent_id TEXT REFERENCES document_folders(id), name TEXT NOT NULL, description TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, container_type TEXT NOT NULL CHECK(container_type IN ('my-docs','project','kb')), container_id TEXT, folder_id TEXT REFERENCES document_folders(id), doc_type TEXT NOT NULL CHECK(doc_type IN ('text','file')), title TEXT NOT NULL, body TEXT, version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created_by TEXT REFERENCES profiles(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS doc_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), version INTEGER NOT NULL, body TEXT, created_by TEXT REFERENCES profiles(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(document_id, version));
CREATE TABLE IF NOT EXISTS document_permissions (document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, recipient_type TEXT NOT NULL CHECK(recipient_type IN ('profile','team')), recipient_id TEXT NOT NULL, access_level TEXT NOT NULL CHECK(access_level IN ('viewer','editor')), PRIMARY KEY(document_id, recipient_type, recipient_id));
CREATE INDEX IF NOT EXISTS document_permissions_document ON document_permissions(document_id);
CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, rrule TEXT, location TEXT, organizer_id TEXT REFERENCES profiles(id), channel_id TEXT REFERENCES channels(id), archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS meeting_participants (meeting_id TEXT NOT NULL REFERENCES meetings(id), profile_id TEXT NOT NULL REFERENCES profiles(id), status TEXT NOT NULL DEFAULT 'waiting', PRIMARY KEY(meeting_id, profile_id));
CREATE TABLE IF NOT EXISTS pipeline_scripts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), repository TEXT, path TEXT NOT NULL DEFAULT '.space.kts', source TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES pipeline_scripts(id), name TEXT NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'MANUAL', archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL CHECK(status IN ('SCHEDULED','PENDING','READY_TO_START','RUNNING','FINISHING','FINISHED','TERMINATING','TERMINATED','HIBERNATING','HIBERNATED','RESTARTING','FAILED','SKIPPED')), log TEXT, triggered_at INTEGER NOT NULL DEFAULT (unixepoch()), started_at INTEGER, finished_at INTEGER);
CREATE TABLE IF NOT EXISTS deploy_targets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, target_key TEXT NOT NULL, description TEXT, manual_control INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(project_id, target_key));
CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES deploy_targets(id), version TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('SCHEDULED','DEPLOYING','FAILED','CURRENT','OBSOLETE','HANGING')), description TEXT, job_run_id TEXT REFERENCES job_runs(id), scheduled_at INTEGER, started_at INTEGER, finished_at INTEGER);
CREATE TABLE IF NOT EXISTS package_repositories (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('maven','npm','nuget','pypi','dart','container','composer','file')), mode TEXT NOT NULL DEFAULT 'HOSTING', description TEXT, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS package_versions (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES package_repositories(id), package_name TEXT NOT NULL, version TEXT NOT NULL, metadata_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(repository_id, package_name, version));
"#;

pub(crate) const SCHEMA_V4: &str = r#"
CREATE TABLE IF NOT EXISTS todo_assignees (todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(todo_id, profile_id));
CREATE INDEX IF NOT EXISTS todo_assignees_profile ON todo_assignees(profile_id);
"#;

/// Drift repair: replay the split V3/V4 definitions using only IF NOT EXISTS.
pub(crate) const SCHEMA_V5: &str = r#"
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id), role TEXT NOT NULL CHECK(role IN ('admin','member')), active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE TABLE IF NOT EXISTS todo_assignees (todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(todo_id, profile_id));
CREATE INDEX IF NOT EXISTS todo_assignees_profile ON todo_assignees(profile_id);
"#;
pub(crate) const SCHEMA_V12: &str = r#"
CREATE TABLE IF NOT EXISTS issue_assignees (issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(issue_id, profile_id));
CREATE INDEX IF NOT EXISTS issue_assignees_profile ON issue_assignees(profile_id);
INSERT OR IGNORE INTO issue_assignees(issue_id, profile_id) SELECT id, assignee_id FROM issues WHERE assignee_id IS NOT NULL AND assignee_id IN (SELECT id FROM profiles);
"#;

pub(crate) const SCHEMA_V21: &str = r#"
CREATE TABLE IF NOT EXISTS document_permissions (
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 recipient_type TEXT NOT NULL CHECK(recipient_type IN ('profile','team')),
 recipient_id TEXT NOT NULL,
 access_level TEXT NOT NULL CHECK(access_level IN ('viewer','editor')),
 PRIMARY KEY(document_id, recipient_type, recipient_id)
);
CREATE INDEX IF NOT EXISTS document_permissions_document ON document_permissions(document_id);
"#;

pub(crate) const SCHEMA_V20: &str = r#"
CREATE TABLE IF NOT EXISTS protected_branch_rules (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 branch_pattern TEXT NOT NULL, regex INTEGER NOT NULL DEFAULT 0,
 allow_create_json TEXT, allow_push_json TEXT, allow_delete_json TEXT, allow_force_push_json TEXT,
 allow_merge_json TEXT, linear_history INTEGER NOT NULL DEFAULT 0, bypass_quality_gate_json TEXT
);
CREATE INDEX IF NOT EXISTS protected_branch_rules_project_pattern ON protected_branch_rules(project_id, branch_pattern);
"#;
/// V21 reserves a distinct migration boundary for source-branch CODEOWNERS.
/// Matching is computed from Git at gate evaluation; a copied file would go stale when
/// an MR source branch advances.
pub(crate) const SCHEMA_V22: &str = r#"
CREATE INDEX IF NOT EXISTS reviews_project_target_source ON reviews(project_id, target_branch, source_branch);
"#;
/// App OAuth (client_credentials) + marketplace metadata and install records.
/// Secrets and tokens are stored hashed; plaintext leaves only at creation.
pub(crate) const SCHEMA_V31: &str = r#"
CREATE TABLE IF NOT EXISTS app_secrets (application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE, secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS app_tokens (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS app_tokens_app_active ON app_tokens(application_id, revoked_at);
CREATE TABLE IF NOT EXISTS marketplace_apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, vendor TEXT NOT NULL, description TEXT, capabilities_json TEXT NOT NULL DEFAULT '[]', compatibility TEXT, listing_url TEXT);
CREATE TABLE IF NOT EXISTS app_installs (id TEXT PRIMARY KEY, marketplace_app_id TEXT REFERENCES marketplace_apps(id) ON DELETE CASCADE, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, install_kind TEXT NOT NULL CHECK(install_kind IN ('MARKETPLACE','LINK','MANUAL','JENKINS','TEAMCITY')), installed_by TEXT, installed_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(marketplace_app_id, application_id));
"#;
/// Personal feeds: a subscription can be scoped to a subject, not only an event type.
pub(crate) const SCHEMA_V29: &str = r#"
CREATE TABLE IF NOT EXISTS subscription_scopes (profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, event_type TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('org','team','project','location','profile','entity')), target_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(profile_id, event_type, target_type, target_id));
CREATE INDEX IF NOT EXISTS subscription_scopes_target ON subscription_scopes(target_type, target_id);
"#;
/// V36: OAuth2 authorization-code flow (oauth.rs). The client secret it authenticates
/// against is the V31 `app_secrets` row: one application, one secret, shared with the
/// client_credentials grant. Redirect URIs are an exact-match
/// allowlist; codes and access tokens keep only their Argon2 digest at rest, and a
/// code row is retired by `consumed_at` on first use.
pub(crate) const SCHEMA_V36: &str = r#"
CREATE TABLE IF NOT EXISTS oauth_redirect_uris (application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, redirect_uri TEXT NOT NULL, PRIMARY KEY(application_id, redirect_uri));
CREATE TABLE IF NOT EXISTS oauth_auth_codes (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', code_challenge TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE INDEX IF NOT EXISTS oauth_auth_codes_expiry ON oauth_auth_codes(expires_at, consumed_at);
CREATE TABLE IF NOT EXISTS oauth_access_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_active ON oauth_access_tokens(user_id, revoked_at);
"#;
/// Auth-only credentials; V26 is owned by packages.
/// Document publication (public link) and KB book grants. A book is the top-level
/// 'kb' folder and a KB document carries its book id in `container_id`, so a grant on
/// the book row is the whole enforcement surface.
pub(crate) const SCHEMA_V34: &str = r#"
CREATE UNIQUE INDEX IF NOT EXISTS documents_public_slug ON documents(public_slug) WHERE public_slug IS NOT NULL;
CREATE TABLE IF NOT EXISTS document_folder_permissions (folder_id TEXT NOT NULL REFERENCES document_folders(id) ON DELETE CASCADE, recipient_type TEXT NOT NULL CHECK(recipient_type IN ('profile','team')), recipient_id TEXT NOT NULL, access_level TEXT NOT NULL CHECK(access_level IN ('viewer','editor')), PRIMARY KEY(folder_id, recipient_type, recipient_id));
"#;
pub(crate) const SCHEMA_V27: &str = r#"
CREATE TABLE IF NOT EXISTS permanent_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS permanent_tokens_user_active ON permanent_tokens(user_id, revoked_at);
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT, role_id TEXT NOT NULL REFERENCES roles(id), project_id TEXT NOT NULL REFERENCES projects(id), invited_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER, max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses > 0), uses INTEGER NOT NULL DEFAULT 0 CHECK(uses >= 0));
CREATE INDEX IF NOT EXISTS invitations_active ON invitations(expires_at, uses);
CREATE TABLE IF NOT EXISTS user_totp (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret_sealed TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, enrolled_at INTEGER NOT NULL);
"#;
/// V32 owns typed registry metadata. The existing `metadata_json` remains a lossless
/// generic envelope for compatibility; this column is the validated, per-format projection.
/// V33: package-version immutability and local vulnerability ledger.
pub(crate) const SCHEMA_V33: &str = r#"
CREATE TABLE IF NOT EXISTS package_vulnerabilities (
 id TEXT PRIMARY KEY, package_version_id TEXT NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
 cve_id TEXT NOT NULL, severity TEXT NOT NULL, affected_range TEXT NOT NULL, title TEXT, description TEXT,
 UNIQUE(package_version_id, cve_id, affected_range)
);
CREATE INDEX IF NOT EXISTS package_vulnerabilities_version ON package_vulnerabilities(package_version_id);
"#;

// Columns are added via add_column_if_missing (idempotent); this batch holds the rest.
pub(crate) const SCHEMA_V32: &str = r#"
SELECT 1;
"#;

pub(crate) const SCHEMA_V26: &str = r#"
CREATE TABLE IF NOT EXISTS package_repository_acl (repository_id TEXT NOT NULL REFERENCES package_repositories(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('VIEWER','WRITER','MANAGER')), PRIMARY KEY(repository_id, profile_id));
CREATE INDEX IF NOT EXISTS package_versions_retention ON package_versions(repository_id, created_at);
CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, name TEXT NOT NULL, os TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'ONLINE' CHECK(status IN ('ONLINE','OFFLINE','DISABLED')), registered_at INTEGER NOT NULL DEFAULT (unixepoch()), last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS job_artifacts (id TEXT PRIMARY KEY, job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE, name TEXT NOT NULL, content BLOB NOT NULL, size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE INDEX IF NOT EXISTS job_artifacts_run ON job_artifacts(job_run_id);
CREATE TABLE IF NOT EXISTS test_reports (id TEXT PRIMARY KEY, job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE, suite TEXT NOT NULL, test_name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PASSED','FAILED','SKIPPED')), duration_ms INTEGER, message TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE INDEX IF NOT EXISTS test_reports_run ON test_reports(job_run_id);
"#;

pub(crate) const SCHEMA_V25: &str = r#"
CREATE TABLE IF NOT EXISTS board_card_settings (board_id TEXT PRIMARY KEY REFERENCES boards(id), fields_json TEXT NOT NULL DEFAULT '["priority","due_date","assignees","checklists","subitems"]');
"#;

pub(crate) const SCHEMA_V24: &str = r#"
CREATE TABLE IF NOT EXISTS review_external_checks (review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, check_name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED')), details TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(review_id,check_name));
"#;
pub(crate) const SCHEMA_V23: &str = r#"
CREATE TABLE IF NOT EXISTS review_stacks (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 repo_path TEXT NOT NULL, target_branch TEXT NOT NULL, source_branch TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS review_stack_items (
 stack_id TEXT NOT NULL REFERENCES review_stacks(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
 ordering INTEGER NOT NULL, PRIMARY KEY(stack_id, review_id), UNIQUE(stack_id, ordering)
);
CREATE INDEX IF NOT EXISTS review_stack_items_review ON review_stack_items(review_id);
"#;

pub(crate) const SCHEMA_V18: &str = r#"
CREATE TABLE IF NOT EXISTS webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE, payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED')), attempts INTEGER NOT NULL DEFAULT 0, response_status INTEGER, last_error TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), delivered_at INTEGER, next_attempt_at INTEGER);
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_created ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_pending ON webhook_deliveries(status, next_attempt_at);
"#;

pub(crate) const SCHEMA_V17: &str = r#"
CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_draft_once ON blog_posts(draft_id) WHERE draft_id IS NOT NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, title, body, breadcrumb);
INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'issue',id,title,coalesce(description,''),'Issue · ' || project_id FROM issues WHERE archived=0;
INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'document',id,title,coalesce(body,''),'Document · ' || container_type FROM documents WHERE archived=0;
INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'message',id,'Message',text,'Chat · ' || channel_id FROM messages WHERE archived=0;
INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'blog',id,title,body,'Blog' FROM blog_posts WHERE archived=0;
CREATE TRIGGER IF NOT EXISTS search_issues_ai AFTER INSERT ON issues WHEN new.archived=0 BEGIN INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) VALUES('issue',new.id,new.title,coalesce(new.description,''),'Issue · ' || new.project_id); END;
CREATE TRIGGER IF NOT EXISTS search_issues_au AFTER UPDATE ON issues BEGIN DELETE FROM search_index WHERE entity_type='issue' AND entity_id=old.id; INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'issue',new.id,new.title,coalesce(new.description,''),'Issue · ' || new.project_id WHERE new.archived=0; END;
CREATE TRIGGER IF NOT EXISTS search_issues_ad AFTER DELETE ON issues BEGIN DELETE FROM search_index WHERE entity_type='issue' AND entity_id=old.id; END;
CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON documents WHEN new.archived=0 BEGIN INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) VALUES('document',new.id,new.title,coalesce(new.body,''),'Document · ' || new.container_type); END;
CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON documents BEGIN DELETE FROM search_index WHERE entity_type='document' AND entity_id=old.id; INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'document',new.id,new.title,coalesce(new.body,''),'Document · ' || new.container_type WHERE new.archived=0; END;
CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON documents BEGIN DELETE FROM search_index WHERE entity_type='document' AND entity_id=old.id; END;
CREATE TRIGGER IF NOT EXISTS search_messages_ai AFTER INSERT ON messages WHEN new.archived=0 BEGIN INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) VALUES('message',new.id,'Message',new.text,'Chat · ' || new.channel_id); END;
CREATE TRIGGER IF NOT EXISTS search_messages_au AFTER UPDATE ON messages BEGIN DELETE FROM search_index WHERE entity_type='message' AND entity_id=old.id; INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'message',new.id,'Message',new.text,'Chat · ' || new.channel_id WHERE new.archived=0; END;
CREATE TRIGGER IF NOT EXISTS search_messages_ad AFTER DELETE ON messages BEGIN DELETE FROM search_index WHERE entity_type='message' AND entity_id=old.id; END;
CREATE TRIGGER IF NOT EXISTS search_blogs_ai AFTER INSERT ON blog_posts WHEN new.archived=0 BEGIN INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) VALUES('blog',new.id,new.title,new.body,'Blog'); END;
CREATE TRIGGER IF NOT EXISTS search_blogs_au AFTER UPDATE ON blog_posts BEGIN DELETE FROM search_index WHERE entity_type='blog' AND entity_id=old.id; INSERT INTO search_index(entity_type,entity_id,title,body,breadcrumb) SELECT 'blog',new.id,new.title,new.body,'Blog' WHERE new.archived=0; END;
CREATE TRIGGER IF NOT EXISTS search_blogs_ad AFTER DELETE ON blog_posts BEGIN DELETE FROM search_index WHERE entity_type='blog' AND entity_id=old.id; END;
"#;
pub(crate) const SCHEMA_V15: &str = r#"
CREATE TABLE IF NOT EXISTS blog_posts (id TEXT PRIMARY KEY, draft_id TEXT REFERENCES documents(id), title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL REFERENCES profiles(id), team_id TEXT REFERENCES teams(id), project_id TEXT REFERENCES projects(id), location_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), published_at INTEGER NOT NULL DEFAULT (unixepoch()), archived INTEGER NOT NULL DEFAULT 0, archived_by TEXT REFERENCES profiles(id), archived_at INTEGER);
CREATE INDEX IF NOT EXISTS blog_posts_published ON blog_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS blog_posts_author ON blog_posts(author_id,published_at DESC);
CREATE TABLE IF NOT EXISTS blog_aliases (post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE, alias TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(post_id,alias));
"#;
pub(crate) const SCHEMA_V14: &str = r#"
CREATE TABLE IF NOT EXISTS devfiles (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, generated INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(project_id,path));
CREATE INDEX IF NOT EXISTS devfiles_project ON devfiles(project_id);
CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, application_type TEXT NOT NULL CHECK(application_type IN ('Application','InternalApp','MarketplaceApp','FeaturedIntegration')), endpoint_uri TEXT, client_id TEXT NOT NULL UNIQUE, client_credentials_flow_enabled INTEGER NOT NULL DEFAULT 0, code_flow_enabled INTEGER NOT NULL DEFAULT 0, pkce_required INTEGER NOT NULL DEFAULT 0, connection_status TEXT NOT NULL DEFAULT 'CONNECTING' CHECK(connection_status IN ('CONNECTING','FAILED_TO_CONNECT','RECONNECTING','CONNECTED')), archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS webhook_subscriptions (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, event_type TEXT NOT NULL, filters_json TEXT, endpoint_uri TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_application ON webhook_subscriptions(application_id);
CREATE TABLE IF NOT EXISTS chatbot_registrations (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, display_name TEXT NOT NULL, description TEXT, commands_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS chatbot_registrations_application ON chatbot_registrations(application_id);
CREATE TABLE IF NOT EXISTS ui_extensions (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, extension_type TEXT NOT NULL, display_name TEXT NOT NULL, unique_code TEXT NOT NULL UNIQUE, iframe_url TEXT, enabled INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS ui_extensions_application ON ui_extensions(application_id);
"#;
pub(crate) const SCHEMA_V13: &str = r#"
CREATE TABLE IF NOT EXISTS calendar_feeds (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), label TEXT NOT NULL, ics_url_sealed TEXT NOT NULL, created_at INTEGER NOT NULL, last_synced_at INTEGER, last_error TEXT, event_count INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS calendar_feeds_profile ON calendar_feeds(profile_id);
CREATE TABLE IF NOT EXISTS calendar_feed_events (feed_id TEXT NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE, uid TEXT NOT NULL, occurrence_key TEXT NOT NULL, title TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER, all_day_date TEXT, PRIMARY KEY(feed_id, uid, occurrence_key));
CREATE INDEX IF NOT EXISTS calendar_feed_events_range ON calendar_feed_events(feed_id, starts_at);
"#;
pub(crate) const SCHEMA_V6: &str = r#"
CREATE INDEX IF NOT EXISTS todos_project_id ON todos(project_id);
"#;
pub(crate) const SCHEMA_V7: &str = r#""#;
/// Explicit project membership for group-scoped resources. Project creators remain
/// members implicitly, preserving pre-membership projects without a backfill.
pub(crate) const SCHEMA_V8: &str = r#"
CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(project_id, profile_id));
CREATE INDEX IF NOT EXISTS project_members_profile ON project_members(profile_id);
"#;

/// V9 separates人 from org: a user account must never author as the shared
/// organization profile. Users still bound to `default-org` are rebound to a
/// personal profile — an existing profile whose username matches, otherwise a
/// freshly created one. Historic authorship is left untouched (unattributable).
pub(crate) const SCHEMA_V9: &str = r#"
UPDATE users SET profile_id = (SELECT p.id FROM profiles p WHERE lower(p.username) = lower(users.username) LIMIT 1)
 WHERE profile_id = 'default-org'
   AND EXISTS (SELECT 1 FROM profiles p WHERE lower(p.username) = lower(users.username))
   AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.id <> users.id AND u2.profile_id = (SELECT p.id FROM profiles p WHERE lower(p.username) = lower(users.username) LIMIT 1));
INSERT OR IGNORE INTO profiles(id, username, display_name, created_at)
 SELECT 'profile-' || u.id, u.username, COALESCE(NULLIF(u.display_name, ''), u.username), unixepoch()
   FROM users u WHERE u.profile_id = 'default-org';
UPDATE users SET profile_id = 'profile-' || id
 WHERE profile_id = 'default-org'
   AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = 'profile-' || users.id);
"#;

/// V37 also expands assignment scopes. SQLite cannot alter a CHECK constraint,
/// so reconstruct the small junction table inside the migration transaction.
/// V38 (recording/egress lifecycle, final shape):
/// - an egress job started before a crash must still be stoppable and listable, so the
///   handle lives in SQLite, not in a process-local map;
/// - `starting` is the local reservation taken before the non-transactional Egress RPC,
///   `stopping` is the durable compare-and-swap target (one in-flight StopEgress per row);
/// - `last_error` carries the operator-visible transport error and the `UNCONFIRMED:`
///   marker that keeps a row whose remote state is unknown locked (fail closed);
/// - the partial unique index is the single-active-recording-per-meeting boundary.
pub(crate) const SCHEMA_V38: &str = r#"
CREATE TABLE IF NOT EXISTS meeting_recordings (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, egress_id TEXT, status TEXT NOT NULL CHECK(status IN ('starting','recording','stopping','stopped','failed')), filepath TEXT, started_by TEXT REFERENCES profiles(id), started_at INTEGER NOT NULL DEFAULT (unixepoch()), stopped_at INTEGER, stop_attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_recordings_active ON meeting_recordings(meeting_id) WHERE status IN ('starting','recording','stopping');
CREATE INDEX IF NOT EXISTS meeting_recordings_meeting ON meeting_recordings(meeting_id, started_at);
"#;

/// V41 key ring for webhook signing secrets.
///
/// `state` is the whole lifecycle: exactly one ACTIVE row signs, any number of RETIRING
/// rows co-sign until `expires_at`, after which delivery prunes them. `expires_at` is
/// NULL for ACTIVE — the signing key never expires on its own, only by being replaced.
/// V49: named user calendars. Feed rows may opt into one, while legacy feeds
/// intentionally remain unassigned until the user chooses a destination.
pub(crate) const SCHEMA_V49: &str = r#"
CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2563eb', visible INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS calendars_profile ON calendars(profile_id);
"#;

/// V51 indexes the optional feed destination used by Calendar filtering.
pub(crate) const SCHEMA_V51: &str = r#"
CREATE INDEX IF NOT EXISTS calendar_feeds_calendar ON calendar_feeds(calendar_id);
"#;

pub(crate) const SCHEMA_V54: &str = r#"
CREATE TABLE IF NOT EXISTS app_ssh_keys (application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, public_key TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(application_id, fingerprint));
CREATE TABLE IF NOT EXISTS app_gpg_keys (application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, public_key TEXT NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(application_id, fingerprint));
"#;

/// V60: events created by CalDAV clients. Feed events stay projections and are never
/// modified by a remote PUT, while these rows are owned by their named calendar.
pub(crate) const SCHEMA_V60: &str = r#"
CREATE TABLE IF NOT EXISTS calendar_caldav_events (
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 href TEXT NOT NULL,
 uid TEXT NOT NULL,
 title TEXT NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER,
 all_day_date TEXT,
 updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(calendar_id, href)
);
CREATE INDEX IF NOT EXISTS calendar_caldav_events_range ON calendar_caldav_events(calendar_id, starts_at);
"#;
pub(crate) const SCHEMA_V67: &str = r#"
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slogan TEXT,
    logo_id TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    onboarding_required INTEGER NOT NULL DEFAULT 0,
    allow_domains_edit INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS org_settings (
    org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    available_right_codes TEXT NOT NULL DEFAULT '[]',
    is_space_code INTEGER NOT NULL DEFAULT 0,
    is_space_code_only INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO organizations(id,name) VALUES('default','GAIA Organization');
INSERT OR IGNORE INTO org_settings(org_id) VALUES('default');
"#;
pub(crate) const SCHEMA_V62: &str = r#"
CREATE TABLE IF NOT EXISTS totp_scratch_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), used_at INTEGER);
CREATE INDEX IF NOT EXISTS totp_scratch_codes_user ON totp_scratch_codes(user_id, used_at);
CREATE TABLE IF NOT EXISTS application_passwords (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), last_used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS application_passwords_user ON application_passwords(user_id, revoked_at);
CREATE TABLE IF NOT EXISTS auth_modules (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('password','external-password','oauth2','saml')), enabled INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS auth_config (id INTEGER PRIMARY KEY CHECK(id = 1), dont_remember_me_ttl_secs INTEGER NOT NULL, admin_remember_me_ttl_secs INTEGER NOT NULL, user_remember_me_ttl_secs INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_right_requests (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE, context_identifier TEXT NOT NULL, right_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DENIED')), requested_at INTEGER NOT NULL DEFAULT (unixepoch()), decided_at INTEGER, decided_by TEXT REFERENCES users(id) ON DELETE SET NULL, UNIQUE(application_id, context_identifier, right_code));
CREATE INDEX IF NOT EXISTS app_right_requests_status ON app_right_requests(status, application_id);
"#;

pub(crate) const SCHEMA_V56: &str = r#"
CREATE TABLE IF NOT EXISTS app_required_rights (
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    right_code TEXT NOT NULL,
    request_in_authorized_contexts INTEGER NOT NULL DEFAULT 0,
    requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY(application_id, right_code)
);
CREATE TABLE IF NOT EXISTS app_authorized_rights (
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    context_identifier TEXT NOT NULL,
    right_code TEXT NOT NULL,
    granted_by TEXT,
    comment TEXT NOT NULL DEFAULT '',
    granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY(application_id, context_identifier, right_code)
);
CREATE INDEX IF NOT EXISTS app_authorized_rights_context ON app_authorized_rights(application_id, context_identifier);
"#;

/// V74: one target per project + IDE + instance type. The pool contains durable
/// STANDBY rows; its target is configuration, not process-local scheduler state.
pub(crate) const SCHEMA_V74: &str = r#"
CREATE TABLE IF NOT EXISTS dev_environment_pool_policies (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ide TEXT NOT NULL,
    instance_type TEXT NOT NULL,
    target_size INTEGER NOT NULL CHECK(target_size >= 0),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY(project_id, ide, instance_type)
);
"#;

pub(crate) const SCHEMA_V55: &str = r#"
CREATE TABLE IF NOT EXISTS dev_environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    repository TEXT,
    branch TEXT,
    ide TEXT NOT NULL DEFAULT 'IntelliJ IDEA',
    instance_type TEXT NOT NULL DEFAULT 'regular',
    state TEXT NOT NULL CHECK(state IN ('STARTING','RUNNING','HIBERNATING','HIBERNATED','STANDBY','FAILED','DELETED')),
    idle_timeout_minutes INTEGER NOT NULL DEFAULT 30,
    last_activity_at INTEGER NOT NULL DEFAULT (unixepoch()),
    hibernated_at INTEGER,
    persisted_home TEXT,
    persisted_worktree TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS dev_environments_project ON dev_environments(project_id, state);
CREATE INDEX IF NOT EXISTS dev_environments_owner ON dev_environments(owner_id);
"#;

pub(crate) const SCHEMA_V52: &str = r#"
CREATE TABLE IF NOT EXISTS app_signing_keys (application_id TEXT PRIMARY KEY, key_id TEXT NOT NULL, private_key TEXT NOT NULL, public_key TEXT NOT NULL, previous_key_id TEXT, previous_public_key TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
"#;

pub(crate) const SCHEMA_V45: &str = r#"
CREATE TABLE IF NOT EXISTS ide_connections (id TEXT PRIMARY KEY, ide TEXT NOT NULL, connected INTEGER NOT NULL DEFAULT 1, last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS ide_opened_repositories (connection_id TEXT NOT NULL REFERENCES ide_connections(id) ON DELETE CASCADE, repository TEXT NOT NULL, PRIMARY KEY(connection_id, repository));
CREATE INDEX IF NOT EXISTS ide_opened_repositories_repository ON ide_opened_repositories(repository);
"#;
pub(crate) const SCHEMA_V46: &str = r#"
CREATE TABLE IF NOT EXISTS user_preferences (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    dashboard_hidden_widgets TEXT NOT NULL
);
"#;

pub(crate) const SCHEMA_V41: &str = r#"
CREATE TABLE IF NOT EXISTS webhook_secrets (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, secret TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ACTIVE','RETIRING')), created_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER);
CREATE INDEX IF NOT EXISTS webhook_secrets_webhook ON webhook_secrets(webhook_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_secrets_active ON webhook_secrets(webhook_id) WHERE state='ACTIVE';
"#;

/// V43 uploaded-file payload metadata (one row per `documents.doc_type='file'`).
pub(crate) const SCHEMA_V43: &str = r#"
CREATE TABLE IF NOT EXISTS document_files (document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, stored_path TEXT NOT NULL, uploaded_by TEXT REFERENCES profiles(id), uploaded_at INTEGER NOT NULL DEFAULT (unixepoch()));
"#;

pub(crate) const SCHEMA_V37: &str = r#"
ALTER TABLE role_assignments RENAME TO role_assignments_v36;
CREATE TABLE role_assignments (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES roles(id),
    profile_id TEXT REFERENCES profiles(id),
    team_id TEXT REFERENCES teams(id),
    scope_type TEXT NOT NULL CHECK(scope_type IN ('global','project','team','profile','channel','document','documentFolder')),
    scope_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO role_assignments(id,role_id,profile_id,team_id,scope_type,scope_id,created_at)
 SELECT id,role_id,profile_id,team_id,scope_type,scope_id,created_at FROM role_assignments_v36;
DROP TABLE role_assignments_v36;
"#;

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let found = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column);
    if !found {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    // --- one database per process: path resolution ---------------------------

    /// The app-data dir is only a *default*. Once a path is bound (desktop setup, or a
    /// test), every later resolution — including an AppHandle-carrying IPC command —
    /// must return that same file, or recording start/stop and the list/authorization
    /// queries would run against two databases.
    #[test]
    fn bound_path_wins_over_env_and_app_data() {
        let bound = PathBuf::from("/bound/space.db");
        let resolved = resolve_db_path(
            Some(bound.clone()),
            Some(PathBuf::from("/env/space.db")),
            Some(PathBuf::from("/appdata/space.db")),
        )
        .expect("a bound path always resolves");
        assert_eq!(resolved, bound);
    }

    #[test]
    fn env_overrides_app_data_when_nothing_is_bound() {
        let resolved = resolve_db_path(
            None,
            Some(PathBuf::from("/env/space.db")),
            Some(PathBuf::from("/appdata/space.db")),
        )
        .expect("env path resolves");
        assert_eq!(resolved, PathBuf::from("/env/space.db"));
    }

    #[test]
    fn app_data_is_the_fallback_not_a_second_source() {
        let app = PathBuf::from("/appdata/space.db");
        assert_eq!(
            resolve_db_path(None, None, Some(app.clone())).expect("app-data resolves"),
            app
        );
        // Desktop binds on first `connection(app)` call; a *later* AppHandle naming a
        // different dir must not repoint the process.
        assert_eq!(
            resolve_db_path(
                Some(app.clone()),
                None,
                Some(PathBuf::from("/other/space.db"))
            )
            .expect("bound path resolves"),
            app
        );
    }

    #[test]
    fn no_source_at_all_fails_loudly() {
        assert!(resolve_db_path(None, None, None).is_err());
    }

    /// End-to-end on real files: what `conn()` opens after binding is the bound file,
    /// so a row written through one handle is visible through the next.
    #[test]
    fn conn_opens_the_bound_file() {
        let _guard = test_serial();
        let temp = TempDb::new("db-single-source");
        let path = resolve_db_path(None, None, Some(temp.path().to_path_buf()))
            .expect("app-data fallback resolves");
        let first = open_at(&path).expect("open bound file");
        migrate(&first).expect("migrate");
        first
            .execute(
                "CREATE TABLE IF NOT EXISTS single_source_probe(id TEXT PRIMARY KEY)",
                [],
            )
            .expect("probe table");
        first
            .execute("INSERT INTO single_source_probe(id) VALUES('x')", [])
            .expect("probe row");
        drop(first);
        let second = open_at(&path).expect("reopen bound file");
        let seen: i64 = second
            .query_row("SELECT count(*) FROM single_source_probe", [], |r| r.get(0))
            .expect("probe visible through the same path");
        assert_eq!(seen, 1, "both handles must address one database file");
    }

    type SchemaObject = (String, String, String, Option<String>);
    type ForeignKey = (
        String,
        i64,
        i64,
        String,
        String,
        String,
        String,
        String,
        String,
    );

    fn normalized_schema_objects(conn: &Connection) -> BTreeSet<SchemaObject> {
        let mut statement = conn.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'").unwrap();
        statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, Option<String>>(3)?
                        .map(|sql| sql.split_whitespace().collect::<Vec<_>>().join(" ")),
                ))
            })
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap()
    }

    fn foreign_key_rows(conn: &Connection) -> BTreeSet<ForeignKey> {
        let mut tables = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            )
            .unwrap();
        let tables = tables
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        tables
            .into_iter()
            .flat_map(|table| {
                let mut statement = conn
                    .prepare(&format!("PRAGMA foreign_key_list({table})"))
                    .unwrap();
                statement
                    .query_map([], |row| {
                        Ok((
                            table.clone(),
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                            row.get(6)?,
                            row.get(7)?,
                        ))
                    })
                    .unwrap()
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .unwrap()
            })
            .collect()
    }
    #[test]
    fn v12_gives_issues_many_assignees_and_carries_the_single_one_over() {
        let temp = TempDb::new("gaia-space-v12-assignees");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        seed(&conn).expect("seed");
        conn.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','pa','Pa',0)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO issues(id,project_id,number,title,description,assignee_id,archived) VALUES('legacy-issue','demo-project',99,'Legacy',NULL,'pa',0)", []).unwrap();
        conn.execute("DELETE FROM issue_assignees", []).unwrap();
        // Simulate a database stamped at V11 and migrate forward again.
        conn.pragma_update(None, "user_version", 11).unwrap();
        migrate(&conn).expect("v12");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        // The single assignee that existed before is now a row in the junction.
        let carried: i64 = conn.query_row("SELECT count(*) FROM issue_assignees WHERE issue_id='legacy-issue' AND profile_id='pa'", [], |r| r.get(0)).unwrap();
        assert_eq!(carried, 1, "the existing assignee survives the migration");
        // A second person can now work the same issue.
        conn.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('pb','pb','Pb',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO issue_assignees(issue_id,profile_id) VALUES('legacy-issue','pb')",
            [],
        )
        .unwrap();
        let people: i64 = conn
            .query_row(
                "SELECT count(*) FROM issue_assignees WHERE issue_id='legacy-issue'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(people, 2);
        // Deleting the issue takes its assignment rows with it.
        conn.execute("DELETE FROM issues WHERE id='legacy-issue'", [])
            .unwrap();
        let orphans: i64 = conn
            .query_row(
                "SELECT count(*) FROM issue_assignees WHERE issue_id='legacy-issue'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 0, "junction rows never survive their issue");
        migrate(&conn).expect("idempotent");
    }

    #[test]
    fn v13_adds_calendar_feeds_and_cascades_their_cached_events() {
        let temp = TempDb::new("gaia-space-v13-calendar-feeds");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        seed(&conn).expect("seed");
        conn.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','pa','Pa',0)",
            [],
        )
        .unwrap();
        // Simulate a database stamped at V12 and migrate forward again.
        conn.pragma_update(None, "user_version", 12).unwrap();
        migrate(&conn).expect("v13");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        conn.execute("INSERT INTO calendar_feeds(id,profile_id,label,ics_url_sealed,created_at,event_count) VALUES('f1','pa','Mine','sealed',0,0)", []).unwrap();
        conn.execute("INSERT INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES('f1','u1','1','x',0,NULL,NULL)", []).unwrap();
        conn.execute("DELETE FROM calendar_feeds WHERE id='f1'", [])
            .unwrap();
        let orphans: i64 = conn
            .query_row(
                "SELECT count(*) FROM calendar_feed_events WHERE feed_id='f1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            orphans, 0,
            "junction-shaped cache rows never survive their feed"
        );
        migrate(&conn).expect("idempotent");
    }

    #[test]
    fn v14_adds_devfiles_and_application_extension_tables() {
        let temp = TempDb::new("gaia-space-v14-applications");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        seed(&conn).expect("seed");
        conn.pragma_update(None, "user_version", 13).unwrap();
        migrate(&conn).expect("v14");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        conn.execute("INSERT INTO devfiles(id,project_id,path,name,content,generated) VALUES('d','demo-project','.space/dev.devfile.yaml','Dev','schemaVersion: 2.2.0',0)", []).unwrap();
        conn.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('a','App','Application','client')", []).unwrap();
        conn.execute("INSERT INTO webhook_subscriptions(id,application_id,event_type,endpoint_uri) VALUES('w','a','IssueWebhookEvent','https://example.test/hook')", []).unwrap();
        conn.execute("DELETE FROM applications WHERE id='a'", [])
            .unwrap();
        let orphaned: i64 = conn
            .query_row(
                "SELECT count(*) FROM webhook_subscriptions WHERE application_id='a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphaned, 0, "extension rows cascade with their application");
    }

    #[test]
    fn v11_adds_nullable_todo_notes_without_touching_legacy_rows() {
        let temp = TempDb::new("gaia-space-v11-notes");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        seed(&conn).expect("seed");
        conn.execute("INSERT INTO todos(id,profile_id,content,done) VALUES('legacy','default-org','Legacy row',0)", []).unwrap();
        conn.execute("UPDATE todos SET notes=NULL WHERE id='legacy'", [])
            .unwrap();
        // Simulate a database stamped at V10 and migrate forward again.
        conn.pragma_update(None, "user_version", 10).unwrap();
        migrate(&conn).expect("v11");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            version, SCHEMA_VERSION,
            "schema version is monotonic and lands on head"
        );
        assert_eq!(SCHEMA_VERSION, 74);
        let notes: Option<String> = conn
            .query_row("SELECT notes FROM todos WHERE id='legacy'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(notes, None, "legacy rows keep NULL notes");
        let content: String = conn
            .query_row("SELECT content FROM todos WHERE id='legacy'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            content, "Legacy row",
            "migration never rewrites existing rows"
        );
        // Re-running is idempotent: no duplicate column, no error.
        migrate(&conn).expect("idempotent");
    }

    #[test]
    fn v60_adds_caldav_events_to_a_v59_database() {
        let temp = TempDb::new("gaia-space-v60-caldav");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        conn.execute("DROP TABLE calendar_caldav_events", [])
            .unwrap();
        conn.pragma_update(None, "user_version", 59).unwrap();
        migrate(&conn).expect("V60 migration");
        let columns: i64 = conn.query_row("SELECT count(*) FROM pragma_table_info('calendar_caldav_events') WHERE name='calendar_id'", [], |row| row.get(0)).unwrap();
        assert_eq!(columns, 1);
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    /// V68 is this lane's rung and it is the ladder's head, so every wave-10 database
    /// (stamped 63..=67 by a sibling branch) must climb to it and end up with both the
    /// `fired_minute` column and the partial unique index the schedule claim depends on.
    #[test]
    fn v68_schedule_claim_reaches_every_wave10_start_version() {
        for start in [63i64, 64, 65, 66, 67] {
            let temp = TempDb::new(&format!("gaia-space-v68-from-{start}"));
            let conn = open_at(&temp).expect("database");
            migrate(&conn).expect("first climb to head");
            // Remove the V68 artifacts and rewind: the rung must rebuild them.
            conn.execute_batch("DROP INDEX IF EXISTS job_runs_scheduled_once;")
                .unwrap();
            conn.pragma_update(None, "user_version", start).unwrap();
            migrate(&conn).expect("replay from a wave-10 sibling version");
            // Second climb from the same start: the rung must be idempotent per start,
            // not merely idempotent from the default head.
            conn.pragma_update(None, "user_version", start).unwrap();
            migrate(&conn).expect("replaying the same start version twice");
            migrate(&conn).expect("replaying an already-head database");

            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(
                version, SCHEMA_VERSION,
                "a database stamped v{start} lands on head"
            );
            let column: i64 = conn
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('job_runs') WHERE name='fired_minute'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(column, 1, "v{start} replay leaves job_runs.fired_minute");
            let index: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='job_runs_scheduled_once'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(
                index, 1,
                "v{start} replay restores the claim index exactly once"
            );
            let column_count: i64 = conn
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('job_runs') WHERE name='fired_minute'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(
                column_count, 1,
                "v{start} double replay never duplicates fired_minute"
            );
        }
    }

    /// Re-running the head migration must not error and must not leave a second index
    /// behind — the claim index is what makes a cron fire exactly-once.
    #[test]
    fn v68_schedule_claim_is_idempotent_on_a_second_migrate() {
        let temp = TempDb::new("gaia-space-v68-idempotent");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        migrate(&conn).expect("migrating an already-head database is a no-op");
        conn.pragma_update(None, "user_version", 67).unwrap();
        migrate(&conn).expect("replaying the V68 rung");
        migrate(&conn).expect("replaying the V68 rung twice");

        let indexes: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='job_runs_scheduled_once'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 1, "the claim index exists exactly once");
        let columns: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('job_runs') WHERE name='fired_minute'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(columns, 1, "fired_minute is added once, never duplicated");
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    /// The integration lane merged three schema-touching branches into one serial
    /// (V43 documents, V45 IDE state, V46 preferences). This walks the whole ladder from every version
    /// those branches care about and re-runs it, so neither DDL depends on the other
    /// having run first and neither breaks on a second pass.
    #[test]
    fn the_whole_migration_ladder_is_replayable_from_any_prior_version() {
        for start in [0i64, 38, 41, 43, 44, 63, 64, 65, 66, 67, 68, 70, 73] {
            let temp = TempDb::new(&format!("gaia-space-ladder-{start}"));
            let conn = open_at(&temp).expect("database");
            migrate(&conn).expect("first climb to head");
            conn.pragma_update(None, "user_version", start).unwrap();
            migrate(&conn).expect("replay from an older version");
            migrate(&conn).expect("replaying twice is idempotent");
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(
                version, SCHEMA_VERSION,
                "ladder from v{start} lands on head"
            );
            for table in ["documents", "document_files", "user_preferences"] {
                assert!(
                    table_exists(&conn, table).unwrap(),
                    "v{start} replay must still leave {table} in place"
                );
            }
            let file_columns: Vec<String> = conn
                .prepare("PRAGMA table_info(document_files)")
                .unwrap()
                .query_map([], |r| r.get(1))
                .unwrap()
                .collect::<std::result::Result<_, _>>()
                .unwrap();
            assert!(
                file_columns.iter().any(|c| c == "stored_path"),
                "V43 document-file payload columns survive the replay from v{start}: {file_columns:?}"
            );
        }
    }

    #[test]
    fn v45_dashboard_preferences_upgrade_and_rerun_are_idempotent() {
        let temp = TempDb::new("gaia-space-v45-dashboard-preferences");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate to head");
        conn.execute("DROP TABLE user_preferences", []).unwrap();
        conn.pragma_update(None, "user_version", 44).unwrap();
        migrate(&conn).expect("v45 creates preferences table");
        conn.pragma_update(None, "user_version", 44).unwrap();
        migrate(&conn).expect("v45 rerun is idempotent");
        let table: String = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='user_preferences'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table, "user_preferences");
    }

    #[test]
    fn v9_rebinds_users_off_the_organization_profile() {
        let temp = TempDb::new("gaia-space-v9-identity");
        let conn = open_at(&temp).expect("database");
        conn.execute_batch(SCHEMA_V1).expect("v1");
        conn.pragma_update(None, "user_version", 0).unwrap();
        migrate(&conn).expect("migrate to head");
        seed(&conn).expect("seed");
        // A pre-existing personal profile for bjarne, plus two users still bound to the org.
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('profile-bj','Bjarne','Bjarne',1)", []).unwrap();
        conn.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('u-bj','bjarne','x','Bjarne','default-org','member',1),('u-ja','jannes','x','Jannes','default-org','member',1)", []).unwrap();
        conn.pragma_update(None, "user_version", 8).unwrap();
        migrate(&conn).expect("v9");

        let bjarne: String = conn
            .query_row("SELECT profile_id FROM users WHERE id='u-bj'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let jannes: String = conn
            .query_row("SELECT profile_id FROM users WHERE id='u-ja'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            bjarne, "profile-bj",
            "an existing matching profile is reused, not duplicated"
        );
        assert_eq!(
            jannes, "profile-u-ja",
            "a user without a profile gets a personal one"
        );
        let org_users: i64 = conn
            .query_row(
                "SELECT count(*) FROM users WHERE profile_id='default-org'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            org_users, 0,
            "no account may author as the organization profile"
        );
        let shared: i64 = conn.query_row("SELECT count(*) FROM (SELECT profile_id FROM users GROUP BY profile_id HAVING count(*) > 1)", [], |r| r.get(0)).unwrap();
        assert_eq!(shared, 0, "one profile per account");
    }

    #[test]
    fn v20_database_gains_document_permissions() {
        let conn = open_in_memory().expect("db");
        migrate(&conn).expect("latest schema");
        conn.execute("DROP TABLE document_permissions", [])
            .expect("simulate V20 database");
        conn.pragma_update(None, "user_version", 20)
            .expect("V20 stamp");
        migrate(&conn).expect("V21 migration");
        let exists: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='document_permissions'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(exists, 1);
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn v1_database_upgrades_to_latest() {
        let temp = TempDb::new("gaia-space-v1-upgrade");
        let conn = open_at(&temp).expect("v1 database");
        conn.execute_batch(SCHEMA_V1).expect("v1 schema");
        conn.pragma_update(None, "user_version", 1)
            .expect("v1 version");
        migrate(&conn).expect("migration");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        for table in [
            "todos",
            "absences",
            "notifications",
            "subscription_settings",
            "member_locations",
            "todo_assignees",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "{table}");
        }
        drop(conn);
        drop(temp);
    }

    #[test]
    fn v2_database_upgrades_to_latest_with_todo_assignees() {
        let conn = open_in_memory().expect("db");
        conn.execute_batch(SCHEMA_V1).expect("v1 schema");
        conn.execute_batch(SCHEMA_V2).expect("v2 schema");
        conn.pragma_update(None, "user_version", 2)
            .expect("v2 version");
        migrate(&conn).expect("migration");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='todo_assignees'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    #[test]
    fn drifted_v4_is_repaired_and_latest_shape_matches_fresh_create() {
        let drifted = open_in_memory().unwrap();
        drifted.execute_batch(SCHEMA_V1).unwrap();
        drifted.execute_batch(SCHEMA_V2).unwrap();
        // Historical collision: v3 was consumed by V4's todo-assignee schema.
        drifted.execute_batch(SCHEMA_V4).unwrap();
        drifted.pragma_update(None, "user_version", 4).unwrap();
        migrate(&drifted).unwrap();
        for table in ["users", "sessions", "todo_assignees"] {
            let exists: i64 = drifted
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "{table}");
        }
        assert!(drifted.execute("INSERT INTO todos(id,profile_id,content,project_id) VALUES('todo','missing','x','missing')", []).is_err(), "V6 FK holds");
        migrate(&drifted).unwrap(); // repair + ALTER migrations converge.

        let fresh = open_in_memory().unwrap();
        migrate(&fresh).unwrap();
        assert_eq!(
            normalized_schema_objects(&drifted),
            normalized_schema_objects(&fresh),
            "V4-to-V7 migration must retain every table, index, and trigger",
        );
        assert_eq!(
            foreign_key_rows(&drifted),
            foreign_key_rows(&fresh),
            "V4-to-V7 migration must retain every table foreign key",
        );
    }

    #[test]
    fn migration_and_domain_roundtrips() {
        let temp = TempDb::new("gaia-space-db");
        let conn = migrate_path(&temp).expect("migration");
        let cases = [
            ("teams", "id", "team"),
            ("issues", "id", "issue"),
            ("channels", "id", "channel"),
            ("reviews", "id", "review"),
            ("documents", "id", "doc"),
            ("meetings", "id", "meeting"),
            ("pipeline_scripts", "id", "script"),
        ];
        conn.execute("INSERT INTO teams(id,name) VALUES('team','Team')", [])
            .unwrap();
        conn.execute("INSERT INTO issues(id,project_id,number,title) VALUES('issue','demo-project',1,'Issue')", []).unwrap();
        conn.execute(
            "INSERT INTO channels(id,content_type,name) VALUES('channel','public','General')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO reviews(id,project_id,number,kind,state,title) VALUES('review','demo-project',1,'MR','Opened','Review')", []).unwrap();
        conn.execute("INSERT INTO documents(id,container_type,doc_type,title) VALUES('doc','project','text','Doc')", []).unwrap();
        conn.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at) VALUES('meeting','Meet',1,2)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO pipeline_scripts(id,project_id,source) VALUES('script','demo-project','job')", []).unwrap();
        for (table, column, id) in cases {
            let count: i64 = conn
                .query_row(
                    &format!("SELECT count(*) FROM {table} WHERE {column}='{id}'"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "{table}");
        }
        drop(temp);
    }
}

pub(crate) const SCHEMA_V16: &str = r#"
CREATE TABLE IF NOT EXISTS message_attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL, data_url TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE INDEX IF NOT EXISTS message_attachments_message ON message_attachments(message_id);
CREATE TABLE IF NOT EXISTS message_mentions (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(message_id, profile_id));
CREATE INDEX IF NOT EXISTS message_mentions_profile ON message_mentions(profile_id);
"#;

#[cfg(test)]
mod right_descriptor_migration_tests {
    use super::*;

    #[test]
    fn v37_adds_idempotent_right_descriptor_columns() {
        let c = open_in_memory().unwrap();
        c.execute_batch(SCHEMA_V1).unwrap();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','p','P',0)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO roles(id,name) VALUES('r','Role')", [])
            .unwrap();
        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('a','r','p','document')", []).unwrap();
        c.pragma_update(None, "user_version", 27).unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT scope_type FROM role_assignments WHERE id='a'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "document"
        );
        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('b','r','p','profile')", []).unwrap();
        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('c','r','p','documentFolder')", []).unwrap();
        migrate(&c).unwrap();
        let columns: Vec<String> = c
            .prepare("PRAGMA table_info(rights)")
            .unwrap()
            .query_map([], |r| r.get(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for column in [
            "flags",
            "implied_rights_json",
            "feature_gate",
            "propagation",
            "descriptor_json",
        ] {
            assert!(columns.contains(&column.to_string()));
        }
    }
}

/// V38 on an *existing* V37 database, not just a fresh one. The recording table never
/// existed on master, so an installed V37 file must gain the final shape (columns,
/// CHECK, partial unique index) in one step, keep its pre-V38 rows, and survive a
/// repeated migrate — the crash-restart path runs `migrate` on every open.
#[cfg(test)]
mod v38_recording_migration_tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Builds a database that looks like a V37 install: full pre-V38 schema, no
    /// `meeting_recordings`, `user_version = 37`.
    fn v37_database() -> Connection {
        let c = open_in_memory().unwrap();
        migrate(&c).unwrap();
        c.execute_batch(
            "DROP INDEX IF EXISTS meeting_recordings_meeting;\n             DROP INDEX IF EXISTS meeting_recordings_active;\n             DROP TABLE IF EXISTS meeting_recordings;",
        )
        .unwrap();
        c.pragma_update(None, "user_version", 37).unwrap();
        c
    }

    fn seed_meeting(c: &Connection, id: &str) {
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,0)",
            rusqlite::params![format!("host-{id}")],
        )
        .unwrap();
        c.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id) VALUES(?1,'Standup',0,60,?2)",
            rusqlite::params![id, format!("host-{id}")],
        )
        .unwrap();
    }

    fn columns(c: &Connection, table: &str) -> Vec<(String, String, i64)> {
        c.prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn v37_database_starts_without_the_recording_table() {
        let c = v37_database();
        let present: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='meeting_recordings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(present, 0, "the V37 fixture must not already carry V38");
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            37
        );
    }

    #[test]
    fn migrating_a_v37_database_lands_the_final_v38_shape() {
        let c = v37_database();
        migrate(&c).unwrap();

        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION,
            "an upgraded V37 file must be stamped with the current version"
        );

        let cols = columns(&c, "meeting_recordings");
        let names: Vec<&str> = cols.iter().map(|(n, _, _)| n.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "id",
                "meeting_id",
                "egress_id",
                "status",
                "filepath",
                "started_by",
                "started_at",
                "stopped_at",
                "stop_attempts",
                "last_error",
            ]
        );
        for required in ["meeting_id", "status", "started_at", "stop_attempts"] {
            let (_, _, notnull) = cols.iter().find(|(n, _, _)| n == required).unwrap();
            assert_eq!(*notnull, 1, "{required} must be NOT NULL");
        }

        let indexes: BTreeSet<String> = c
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='meeting_recordings' AND name NOT LIKE 'sqlite_%'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            indexes,
            BTreeSet::from([
                "meeting_recordings_active".to_string(),
                "meeting_recordings_meeting".to_string(),
            ])
        );
        let active_sql: String = c
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name='meeting_recordings_active'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            active_sql.contains("UNIQUE")
                && active_sql.contains("WHERE status IN ('starting','recording','stopping')"),
            "single-active-recording boundary must be a partial UNIQUE index: {active_sql}"
        );
    }

    /// The migrated table must actually enforce its invariants on an upgraded file —
    /// shape without behaviour would let a second egress job start after a restart.
    #[test]
    fn upgraded_table_enforces_status_check_and_single_active_recording() {
        let c = v37_database();
        migrate(&c).unwrap();
        seed_meeting(&c, "m1");

        c.execute(
            "INSERT INTO meeting_recordings(id,meeting_id,status,started_at) VALUES('r1','m1','recording',10)",
            [],
        )
        .unwrap();
        assert!(
            c.execute(
                "INSERT INTO meeting_recordings(id,meeting_id,status,started_at) VALUES('r2','m1','starting',20)",
                [],
            )
            .is_err(),
            "two live jobs for one meeting must be unrepresentable"
        );
        assert!(
            c.execute(
                "INSERT INTO meeting_recordings(id,meeting_id,status,started_at) VALUES('r3','m1','paused',30)",
                [],
            )
            .is_err(),
            "status CHECK must reject unknown states"
        );
        // A terminal row is not "live": a later recording may follow it.
        c.execute(
            "UPDATE meeting_recordings SET status='stopped', stopped_at=40 WHERE id='r1'",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO meeting_recordings(id,meeting_id,status,started_at) VALUES('r4','m1','starting',50)",
            [],
        )
        .unwrap();
        let defaults: (i64, Option<String>) = c
            .query_row(
                "SELECT stop_attempts, last_error FROM meeting_recordings WHERE id='r4'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(defaults, (0, None));
    }

    /// Every open runs `migrate`. Re-running it must not drop, recreate, or duplicate
    /// anything: pre-V38 rows and already-written recording rows survive untouched.
    #[test]
    fn migrate_is_idempotent_on_an_upgraded_v37_database() {
        let c = v37_database();
        seed_meeting(&c, "m1");
        migrate(&c).unwrap();
        c.execute(
            "INSERT INTO meeting_recordings(id,meeting_id,status,started_at) VALUES('r1','m1','recording',10)",
            [],
        )
        .unwrap();

        let shape_before = columns(&c, "meeting_recordings");
        let ddl_before: Vec<String> = c
            .prepare("SELECT sql FROM sqlite_master WHERE tbl_name='meeting_recordings' AND sql IS NOT NULL ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        migrate(&c).unwrap();
        migrate(&c).unwrap();

        assert_eq!(shape_before, columns(&c, "meeting_recordings"));
        let ddl_after: Vec<String> = c
            .prepare("SELECT sql FROM sqlite_master WHERE tbl_name='meeting_recordings' AND sql IS NOT NULL ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(ddl_before, ddl_after);
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM meeting_recordings WHERE id='r1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1,
            "existing recording rows must survive a re-migrate"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM meetings WHERE id='m1'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1,
            "pre-V38 rows must survive the upgrade"
        );
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    /// A fresh install and an upgraded V37 install must be indistinguishable.
    #[test]
    fn upgraded_v37_matches_a_fresh_v38_database() {
        let upgraded = v37_database();
        migrate(&upgraded).unwrap();
        let fresh = open_in_memory().unwrap();
        migrate(&fresh).unwrap();

        let ddl = |c: &Connection| -> Vec<String> {
            c.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='meeting_recordings' AND sql IS NOT NULL ORDER BY name")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(ddl(&upgraded), ddl(&fresh));
    }
}

#[cfg(test)]
mod v39_webhook_migration_tests {
    use super::*;

    #[test]
    fn v39_guard_upgrades_a_v38_copy_and_tolerates_a_partial_database_without_the_table() {
        let copy = open_in_memory().unwrap();
        migrate(&copy).unwrap();
        copy.execute("ALTER TABLE webhook_subscriptions DROP COLUMN secret", [])
            .unwrap();
        copy.execute(
            "ALTER TABLE webhook_subscriptions DROP COLUMN max_attempts",
            [],
        )
        .unwrap();
        copy.pragma_update(None, "user_version", 38).unwrap();
        migrate(&copy).unwrap();
        let columns = |conn: &Connection| -> Vec<String> {
            conn.prepare("PRAGMA table_info(webhook_subscriptions)")
                .unwrap()
                .query_map([], |row| row.get(1))
                .unwrap()
                .collect::<std::result::Result<Vec<String>, _>>()
                .unwrap()
        };
        let upgraded = columns(&copy);
        assert!(upgraded.contains(&"secret".into()));
        assert!(upgraded.contains(&"max_attempts".into()));

        let partial = open_in_memory().unwrap();
        partial.pragma_update(None, "user_version", 38).unwrap();
        migrate(&partial).unwrap();
        assert_eq!(
            partial
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert!(!table_exists(&partial, "webhook_subscriptions").unwrap());
    }

    #[test]
    fn v49_adds_profile_scoped_named_calendars() {
        let temp = TempDb::new("gaia-space-v49-calendars");
        let conn = open_at(&temp).expect("database");
        migrate(&conn).expect("migrate");
        seed(&conn).expect("seed");
        conn.execute("INSERT INTO calendars(id,profile_id,name,color,visible,created_at) VALUES('work','default-org','Work','#2563eb',1,0)", []).expect("calendar insert");
        let profile: String = conn
            .query_row(
                "SELECT profile_id FROM calendars WHERE id='work'",
                [],
                |r| r.get(0),
            )
            .expect("calendar owner");
        assert_eq!(profile, "default-org");
    }

    #[test]
    fn v75_adds_attachment_upload_lifecycle_columns() {
        let c = open_in_memory().unwrap();
        // legacy shape: pre-V75 attachments table, database stamped at 74.
        c.execute_batch(SCHEMA_V1).unwrap();
        c.execute_batch(
            "CREATE TABLE message_attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL, data_url TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));",
        )
        .unwrap();
        c.execute("INSERT INTO message_attachments(id,message_id,file_name,mime_type,byte_length,data_url,created_at) VALUES('a','m','f.png','image/png',3,'data:,x',0)", []).unwrap();
        c.pragma_update(None, "user_version", 74).unwrap();
        migrate(&c).unwrap();
        let (state, err): (String, Option<String>) = c
            .query_row(
                "SELECT upload_state,error FROM message_attachments WHERE id='a'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, "completed");
        assert!(err.is_none());
    }

    #[test]
    fn v75_is_idempotent_on_a_fresh_database() {
        let c = open_in_memory().unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        let cols: Vec<String> = c
            .prepare("PRAGMA table_info(message_attachments)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert!(cols.contains(&"upload_state".to_string()));
        assert!(cols.contains(&"error".to_string()));
    }
}
