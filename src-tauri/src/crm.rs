//! The workspace CRM document.
//!
//! ── ONE DOCUMENT, EVERY BACKUP ──────────────────────────────────────────────────
//! CRM sales data used to live only in each browser's `localStorage` (`src/crmStore.ts`
//! `loadCrm`/`saveCrm`), invisible to `space.db`'s production backup. There is exactly
//! one workspace-wide document (`id='default'`), an opaque JSON blob this module never
//! parses beyond validating it *is* JSON — the shape is the TypeScript side's contract,
//! not this module's.
//!
//! ── OPTIMISTIC CONCURRENCY, NOT LOCKING ─────────────────────────────────────────
//! A save names the revision it started from (`base_revision`). If the stored revision
//! has moved since, the write is refused with `crm-conflict:<current>` and nothing is
//! touched: a stale client must re-read and retry, never silently stomp a concurrent
//! edit. The revision check and the write happen inside the same transaction, so two
//! concurrent savers can never both believe they won.
//!
//! ── HISTORY IS RECOVERY, NOT AN AUDIT LOG ───────────────────────────────────────
//! Every accepted save appends the document's PREVIOUS state into
//! `crm_document_revisions` before overwriting it, and only the newest 50 rows survive
//! per document: a blob overwrite must be recoverable from an accidental paste, not
//! reconstructible forever.
use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
type Result<T> = std::result::Result<T, String>;
fn err<T>(result: rusqlite::Result<T>) -> Result<T> {
    result.map_err(|error| error.to_string())
}
/// The only document that exists today. A future multi-document surface would take an
/// id from the caller instead of hard-coding this.
const DOCUMENT_ID: &str = "default";
/// How many prior versions of the document `save_crm_document` keeps for recovery.
const MAX_REVISIONS: i64 = 50;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrmDocument {
    pub data: String,
    pub revision: i64,
    pub updated_at: i64,
    pub updated_by: Option<String>,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// An absent document is not an error: it is the empty, never-saved state every
/// workspace starts in.
fn document_on(c: &Connection, id: &str) -> Result<CrmDocument> {
    let found: Option<CrmDocument> = err(c
        .query_row(
            "SELECT data,revision,updated_at,updated_by FROM crm_documents WHERE id=?1",
            [id],
            |row| {
                Ok(CrmDocument {
                    data: row.get(0)?,
                    revision: row.get(1)?,
                    updated_at: row.get(2)?,
                    updated_by: row.get(3)?,
                })
            },
        )
        .optional())?;
    Ok(found.unwrap_or(CrmDocument {
        data: String::new(),
        revision: 0,
        updated_at: 0,
        updated_by: None,
    }))
}

/// Reads are workspace-wide: `profile_id` names the caller for authorization at the
/// dispatch layer (`CommandPolicy::Session`), not a scope on the data itself — every
/// member reads the same document.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_crm_document(profile_id: String) -> Result<CrmDocument> {
    let _ = profile_id;
    let c = db::conn()?;
    document_on(&c, DOCUMENT_ID)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_crm_document(
    data: String,
    base_revision: i64,
    profile_id: String,
) -> Result<CrmDocument> {
    let mut c = db::conn()?;
    save_crm_document_on(&mut c, DOCUMENT_ID, data, base_revision, profile_id)
}

fn save_crm_document_on(
    c: &mut Connection,
    id: &str,
    data: String,
    base_revision: i64,
    profile_id: String,
) -> Result<CrmDocument> {
    if serde_json::from_str::<serde_json::Value>(&data).is_err() {
        return Err("crm document is not valid JSON".into());
    }
    let tx = err(c.transaction())?;
    // Revision check and write share one transaction: nothing observes a state
    // between "checked" and "written" that another saver could race against.
    let current = document_on(&tx, id)?;
    if current.revision != base_revision {
        return Err(format!("crm-conflict:{}", current.revision));
    }
    // Only a real prior document (revision > 0) has anything worth archiving; the
    // first save of a workspace has no predecessor to protect.
    if current.revision > 0 {
        err(tx.execute(
            "INSERT INTO crm_document_revisions(document_id,revision,data,saved_at,saved_by) VALUES(?1,?2,?3,?4,?5)",
            params![id, current.revision, current.data, now_millis(), current.updated_by],
        ))?;
        err(tx.execute(
            "DELETE FROM crm_document_revisions WHERE document_id=?1 AND revision NOT IN \
             (SELECT revision FROM crm_document_revisions WHERE document_id=?1 ORDER BY revision DESC LIMIT ?2)",
            params![id, MAX_REVISIONS],
        ))?;
    }
    let new_revision = current.revision + 1;
    let updated_at = now_millis();
    err(tx.execute(
        "INSERT INTO crm_documents(id,data,revision,updated_at,updated_by) VALUES(?1,?2,?3,?4,?5) \
         ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
        params![id, data, new_revision, updated_at, profile_id],
    ))?;
    err(tx.commit())?;
    Ok(CrmDocument {
        data,
        revision: new_revision,
        updated_at,
        updated_by: Some(profile_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c
    }

    #[test]
    fn an_absent_document_reads_as_empty_at_revision_zero() {
        let c = fixture();
        let doc = get_crm_document_on(&c);
        assert_eq!(doc.data, "");
        assert_eq!(doc.revision, 0);
        assert_eq!(doc.updated_at, 0);
        assert_eq!(doc.updated_by, None);
    }

    /// `get_crm_document` itself opens its own connection via `db::conn()`, which a
    /// unit test cannot redirect at an in-memory database — so the read half is
    /// exercised through the same `document_on` helper the command calls.
    fn get_crm_document_on(c: &Connection) -> CrmDocument {
        document_on(c, DOCUMENT_ID).unwrap()
    }

    #[test]
    fn a_save_round_trips_the_exact_json_and_advances_the_revision() {
        let mut c = fixture();
        let saved = save_crm_document_on(
            &mut c,
            DOCUMENT_ID,
            r#"{"deals":[{"id":"d1","amount":500}]}"#.into(),
            0,
            "pa".into(),
        )
        .unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.updated_by.as_deref(), Some("pa"));
        assert!(saved.updated_at > 0);
        let read_back = get_crm_document_on(&c);
        assert_eq!(read_back.data, r#"{"deals":[{"id":"d1","amount":500}]}"#);
        assert_eq!(read_back.revision, 1);
        assert_eq!(read_back.updated_by.as_deref(), Some("pa"));
    }

    #[test]
    fn a_stale_base_revision_is_refused_and_the_stored_revision_does_not_move() {
        let mut c = fixture();
        save_crm_document_on(&mut c, DOCUMENT_ID, "{}".into(), 0, "pa".into()).unwrap();
        // Bob still thinks the document is at revision 0.
        let refused =
            save_crm_document_on(&mut c, DOCUMENT_ID, r#"{"x":1}"#.into(), 0, "pb".into())
                .unwrap_err();
        assert_eq!(refused, "crm-conflict:1");
        let stored = get_crm_document_on(&c);
        assert_eq!(stored.data, "{}", "the stale write never lands");
        assert_eq!(stored.revision, 1, "the stored revision does not move");
        assert_eq!(
            stored.updated_by.as_deref(),
            Some("pa"),
            "authorship is unchanged by the refused write"
        );
    }

    #[test]
    fn invalid_json_is_rejected_on_save() {
        let mut c = fixture();
        let refused =
            save_crm_document_on(&mut c, DOCUMENT_ID, "not json".into(), 0, "pa".into())
                .unwrap_err();
        assert!(refused.contains("not valid JSON"), "{refused}");
        assert_eq!(
            get_crm_document_on(&c).revision,
            0,
            "a rejected save never touches the document"
        );
        // Empty string is not valid JSON either, and is explicitly rejected.
        let refused_empty =
            save_crm_document_on(&mut c, DOCUMENT_ID, "".into(), 0, "pa".into()).unwrap_err();
        assert!(refused_empty.contains("not valid JSON"), "{refused_empty}");
    }

    #[test]
    fn revision_history_is_capped_at_fifty_and_holds_the_pre_save_document() {
        let mut c = fixture();
        for n in 0..55 {
            let data = format!(r#"{{"n":{n}}}"#);
            save_crm_document_on(&mut c, DOCUMENT_ID, data, n, "pa".into()).unwrap();
        }
        let current = get_crm_document_on(&c);
        assert_eq!(current.revision, 55, "55 accepted saves");
        let count: i64 = c
            .query_row(
                "SELECT count(*) FROM crm_document_revisions WHERE document_id=?1",
                [DOCUMENT_ID],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, MAX_REVISIONS, "only the newest 50 survive");
        // The document just before the final save (revision 54, body {"n":53}, set by
        // the 54th call) is the pre-save snapshot appended by the 55th save and must
        // be present.
        let pre_save: String = c
            .query_row(
                "SELECT data FROM crm_document_revisions WHERE document_id=?1 AND revision=54",
                [DOCUMENT_ID],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pre_save, r#"{"n":53}"#);
        // The oldest snapshots (revision 1..=4) were pruned to stay at the cap.
        let oldest_kept: i64 = c
            .query_row(
                "SELECT min(revision) FROM crm_document_revisions WHERE document_id=?1",
                [DOCUMENT_ID],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(oldest_kept, 5, "revisions 1..4 were pruned to hold the cap at 50");
    }
}
