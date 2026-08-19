//! SQLite persistence: one application-data database, versioned migrations, first-run seed.
use rusqlite::{Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
#[cfg(feature = "desktop")]
use tauri::{AppHandle, Manager};

pub const SCHEMA_VERSION: i64 = 10;

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_db_path(p: PathBuf) { let _ = DB_PATH.set(p); }

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
            let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
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
    pub fn path(&self) -> &Path { &self.path }
}

#[cfg(test)]
impl AsRef<Path> for TempDb {
    fn as_ref(&self) -> &Path { &self.path }
}

#[cfg(test)]
impl Drop for TempDb {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.dir); }
}

pub fn conn() -> Result<Connection, String> {
    let path = DB_PATH.get().cloned().or_else(|| std::env::var_os("SPACE_DB").map(PathBuf::from)).ok_or_else(|| "database path unavailable; call set_db_path or set SPACE_DB".to_string())?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let conn = open_at(path).map_err(|e| e.to_string())?;
    migrate(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[cfg(feature = "desktop")]
pub fn connection(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = open_at(dir.join("space.db")).map_err(|e| e.to_string())?;
    migrate(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
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

fn add_column_if_missing(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let found = stmt.query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column);
    if !found { conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    type SchemaObject = (String, String, String, Option<String>);
    type ForeignKey = (String, i64, i64, String, String, String, String, String, String);

    fn normalized_schema_objects(conn: &Connection) -> BTreeSet<SchemaObject> {
        let mut statement = conn.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'").unwrap();
        statement.query_map([], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?,
            row.get::<_, Option<String>>(3)?.map(|sql| sql.split_whitespace().collect::<Vec<_>>().join(" ")),
        ))).unwrap().collect::<std::result::Result<_, _>>().unwrap()
    }

    fn foreign_key_rows(conn: &Connection) -> BTreeSet<ForeignKey> {
        let mut tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").unwrap();
        let tables = tables.query_map([], |row| row.get::<_, String>(0)).unwrap().collect::<std::result::Result<Vec<_>, _>>().unwrap();
        tables.into_iter().flat_map(|table| {
            let mut statement = conn.prepare(&format!("PRAGMA foreign_key_list({table})")).unwrap();
            statement.query_map([], |row| Ok((
                table.clone(), row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
            ))).unwrap().collect::<std::result::Result<Vec<_>, _>>().unwrap()
        }).collect()
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

        let bjarne: String = conn.query_row("SELECT profile_id FROM users WHERE id='u-bj'", [], |r| r.get(0)).unwrap();
        let jannes: String = conn.query_row("SELECT profile_id FROM users WHERE id='u-ja'", [], |r| r.get(0)).unwrap();
        assert_eq!(bjarne, "profile-bj", "an existing matching profile is reused, not duplicated");
        assert_eq!(jannes, "profile-u-ja", "a user without a profile gets a personal one");
        let org_users: i64 = conn.query_row("SELECT count(*) FROM users WHERE profile_id='default-org'", [], |r| r.get(0)).unwrap();
        assert_eq!(org_users, 0, "no account may author as the organization profile");
        let shared: i64 = conn.query_row("SELECT count(*) FROM (SELECT profile_id FROM users GROUP BY profile_id HAVING count(*) > 1)", [], |r| r.get(0)).unwrap();
        assert_eq!(shared, 0, "one profile per account");
    }

    #[test]
    fn v1_database_upgrades_to_latest() {
        let temp = TempDb::new("gaia-space-v1-upgrade");
        let conn = open_at(&temp).expect("v1 database");
        conn.execute_batch(SCHEMA_V1).expect("v1 schema");
        conn.pragma_update(None, "user_version", 1).expect("v1 version");
        migrate(&conn).expect("migration");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        for table in ["todos", "absences", "notifications", "subscription_settings", "member_locations", "todo_assignees"] {
            let exists: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [table], |row| row.get(0)).unwrap();
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
        conn.pragma_update(None, "user_version", 2).expect("v2 version");
        migrate(&conn).expect("migration");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let exists: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='todo_assignees'", [], |row| row.get(0)).unwrap();
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
            let exists: i64 = drifted.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [table], |r| r.get(0)).unwrap();
            assert_eq!(exists, 1, "{table}");
        }
        assert!(drifted.execute("INSERT INTO todos(id,profile_id,content,project_id) VALUES('todo','missing','x','missing')", []).is_err(), "V6 FK holds");
        migrate(&drifted).unwrap(); // repair + ALTER migrations converge.

        let fresh = open_in_memory().unwrap();
        migrate(&fresh).unwrap();
        assert_eq!(
            normalized_schema_objects(&drifted), normalized_schema_objects(&fresh),
            "V4-to-V7 migration must retain every table, index, and trigger",
        );
        assert_eq!(
            foreign_key_rows(&drifted), foreign_key_rows(&fresh),
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
