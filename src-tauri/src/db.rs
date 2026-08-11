//! SQLite persistence: one application-data database, versioned migrations, first-run seed.
use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::OnceLock;
#[cfg(test)]
use std::path::Path;
use tauri::{AppHandle, Manager};

pub const SCHEMA_VERSION: i64 = 3;

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn set_db_path(p: PathBuf) { let _ = DB_PATH.set(p); }

pub fn conn() -> Result<Connection, String> {
    let path = DB_PATH.get().cloned().or_else(|| std::env::var_os("SPACE_DB").map(PathBuf::from)).ok_or_else(|| "database path unavailable; call set_db_path or set SPACE_DB".to_string())?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    migrate(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn connection(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("space.db")).map_err(|e| e.to_string())?;
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
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit()
}

pub fn seed(conn: &Connection) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO profiles (id, username, display_name, created_at) VALUES ('default-org', 'gaia', 'GAIA Organization', unixepoch())", [])?;
    conn.execute("INSERT OR IGNORE INTO projects (id, name, key, description, created_by, created_at) VALUES ('demo-project', 'Demo Project', 'DEMO', 'Your persisted Space project', 'default-org', unixepoch())", [])?;
    Ok(())
}

#[cfg(test)]
pub fn migrate_path(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn v1_database_upgrades_to_v3() {
        let path = std::env::temp_dir().join(format!("gaia-space-v1-upgrade-{}.sqlite", std::process::id()));
        let conn = Connection::open(&path).expect("v1 database");
        conn.execute_batch(SCHEMA_V1).expect("v1 schema");
        conn.pragma_update(None, "user_version", 1).expect("v1 version");
        migrate(&conn).expect("v3 migration");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, 3);
        for table in ["todos", "absences", "notifications", "subscription_settings", "member_locations"] {
            let exists: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [table], |row| row.get(0)).unwrap();
            assert_eq!(exists, 1, "{table}");
        }
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migration_and_domain_roundtrips() {
        let path =
            std::env::temp_dir().join(format!("gaia-space-db-{}.sqlite", std::process::id()));
        let conn = migrate_path(&path).expect("migration");
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
        let _ = std::fs::remove_file(path);
    }
}
