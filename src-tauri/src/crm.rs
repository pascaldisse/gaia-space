//! CRM — ONE shared store on the server, not one per browser.
//!
//! Contract: `docs/specs/crm-server-store.md` (frozen; the frontend lane builds
//! against exactly these three commands).
//!
//! ── WHY ROWS, NOT ONE DOCUMENT ────────────────────────────────────────────────
//! A single blob would make every save a last-write-wins over the WHOLE CRM: Bjarne
//! writing a note would silently revert Jannes' deal. Storage is therefore one row
//! per record (`crm_records`), and a write names only the records it touched. Two
//! people editing DIFFERENT records never collide — that is the entire point, and
//! `two_puts_of_different_records_do_not_clobber_each_other` proves it.
//!
//! ── WHAT THE SERVER OWNS ──────────────────────────────────────────────────────
//! Identity, time and access. NOT the shape of a record: `payload_json` is the
//! client record verbatim, because `normalize()` in `src/crmStore.ts` must stay the
//! single place that decides what a valid record is. Soft delete (`deletedAt`) lives
//! INSIDE the payload — the trash view is client logic. `crm_purge_records` is the
//! hard delete.
//!
//! ── WHO MAY READ AND WRITE ────────────────────────────────────────────────────
//! Every authenticated member, all of it. No admin gate, no owner filter: that is
//! the requirement ("jeder muss ALLES gleich sehen und bearbeiten können"), and a
//! hidden row would be a lie in a shared pipeline. The existing session gate refuses
//! unauthenticated callers, like for any other command. `updated_by` is
//! accountability, never a restriction.
//!
//! ── WHO WROTE LAST ────────────────────────────────────────────────────────────
//! `actor::resolve` first (the native authority — the webview may never name who
//! acts), and only when the installation cannot tell — the normal case on the
//! multi-profile web server — the identity the HTTP gate bound onto the request
//! (`acting_profile_id`, injected in `space-server.rs`, never trusted from a body
//! that was not rebound). An id that is not a live profile is dropped to NULL rather
//! than failing a save: attribution is not worth losing a person's work over.
use crate::{actor, db};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

type Result<T> = std::result::Result<T, String>;

/// The three record kinds, matching the table's CHECK constraint and the client's
/// `Organization` / `Deal` / `Activity`.
const KIND_ORGANIZATION: &str = "organization";
const KIND_DEAL: &str = "deal";
const KIND_ACTIVITY: &str = "activity";

/// The two settings keys, matching the table's CHECK constraint. Whole lists, not
/// per-record rows: they are small shared config.
const SETTING_LABELS: &str = "labels";
const SETTING_STAGES: &str = "stages";

/// The refusal named in the contract. Any record missing a usable `id` fails the
/// WHOLE call — a half-written CRM is worse than a rejected save.
const ERR_NO_ID: &str = "crm record without id";

fn err<T>(result: rusqlite::Result<T>) -> Result<T> {
    result.map_err(|error| error.to_string())
}

fn connect() -> Result<Connection> {
    db::conn()
}

/// Everything the client needs to render the CRM, in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CrmSnapshot {
    pub organizations: Vec<Value>,
    pub deals: Vec<Value>,
    pub activities: Vec<Value>,
    pub labels: Vec<Value>,
    pub stages: Vec<Value>,
    /// `MAX(updated_at)` over both tables, `0` when the store is empty. A hint for a
    /// poller that nothing changed — NOT a lock, and never compared for equality
    /// before a write.
    pub revision: i64,
}

/// What both writing commands return: the new revision, so the caller that just
/// wrote does not re-render on its own change.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrmRevision {
    pub revision: i64,
}

/// The acting profile, or NULL.
///
/// `actor::resolve` is asked FIRST: on the desktop it reads native state the webview
/// cannot reach, so a page cannot claim to be somebody else. It is unresolvable on
/// the shared server (many profiles), and only there does the HTTP-gate-bound
/// identity apply.
fn updated_by(c: &Connection, bound: Option<String>) -> Result<Option<String>> {
    if let Ok((profile_id, _)) = actor::resolve(c) {
        return Ok(Some(profile_id));
    }
    let Some(candidate) = bound.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let live: Option<()> = err(c
        .query_row(
            "SELECT 1 FROM profiles WHERE id=?1 AND archived=0",
            [&candidate],
            |_| Ok(()),
        )
        .optional())?;
    Ok(live.map(|_| candidate))
}

/// The `id` of one client record, or the contract's refusal.
///
/// Deliberately strict: only a non-empty STRING counts. A numeric or missing id
/// would make the upsert silently invent rows that no client can address again.
fn record_id(payload: &Value) -> Result<String> {
    payload
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| ERR_NO_ID.to_string())
}

/// Strictly increasing write stamp.
///
/// The server clock in whole seconds, except that two writes within the same second
/// must still produce two different revisions — otherwise a poller would skip the
/// second one. So: `max(now, current_revision + 1)`. Reported deviation from a plain
/// `unixepoch()`; it only ever moves the stamp forward, never backwards.
fn write_stamp(c: &Connection) -> Result<i64> {
    let now: i64 = err(c.query_row("SELECT unixepoch()", [], |row| row.get(0)))?;
    let current = revision_on(c)?;
    Ok(now.max(current + 1))
}

fn revision_on(c: &Connection) -> Result<i64> {
    err(c.query_row(
        "SELECT MAX(value) FROM (\
           SELECT COALESCE(MAX(updated_at),0) AS value FROM crm_records \
           UNION ALL \
           SELECT COALESCE(MAX(updated_at),0) AS value FROM crm_settings)",
        [],
        |row| row.get(0),
    ))
}

fn records_of_kind(c: &Connection, kind: &str) -> Result<Vec<Value>> {
    let mut statement = err(
        c.prepare("SELECT payload_json FROM crm_records WHERE kind=?1 ORDER BY id")
    )?;
    let rows = err(statement.query_map([kind], |row| row.get::<_, String>(0)))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    rows.into_iter()
        .map(|json| serde_json::from_str(&json).map_err(|e| e.to_string()))
        .collect()
}

/// A settings row holds a whole LIST. A stored value that is not a list is reported
/// rather than silently reshaped — the client owns that shape, so a mismatch is a
/// bug worth seeing.
fn setting_list(c: &Connection, key: &str) -> Result<Vec<Value>> {
    let stored: Option<String> = err(c
        .query_row(
            "SELECT payload_json FROM crm_settings WHERE key=?1",
            [key],
            |row| row.get(0),
        )
        .optional())?;
    let Some(stored) = stored else {
        return Ok(Vec::new());
    };
    match serde_json::from_str::<Value>(&stored).map_err(|e| e.to_string())? {
        Value::Array(items) => Ok(items),
        _ => Err(format!("crm setting `{key}` is not a list")),
    }
}

// ── COMMANDS ──────────────────────────────────────────────────────────────────

/// The whole shared CRM. Cheap enough to poll (15 s, like `TeamTasks.tsx`).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn crm_snapshot() -> Result<CrmSnapshot> {
    snapshot_on(&connect()?)
}

pub fn snapshot_on(c: &Connection) -> Result<CrmSnapshot> {
    // One transaction, so a concurrent write cannot be half-visible across the five
    // lists and the revision.
    let tx = err(c.unchecked_transaction())?;
    let snapshot = CrmSnapshot {
        organizations: records_of_kind(&tx, KIND_ORGANIZATION)?,
        deals: records_of_kind(&tx, KIND_DEAL)?,
        activities: records_of_kind(&tx, KIND_ACTIVITY)?,
        labels: setting_list(&tx, SETTING_LABELS)?,
        stages: setting_list(&tx, SETTING_STAGES)?,
        revision: revision_on(&tx)?,
    };
    err(tx.commit())?;
    Ok(snapshot)
}

/// Upsert by `id`. Records NOT named are untouched — this is what keeps two people
/// editing different records from overwriting one another.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn crm_put_records(
    organizations: Option<Vec<Value>>,
    deals: Option<Vec<Value>>,
    activities: Option<Vec<Value>>,
    labels: Option<Vec<Value>>,
    stages: Option<Vec<Value>>,
    acting_profile_id: Option<String>,
) -> Result<CrmRevision> {
    put_records_on(
        &connect()?,
        organizations,
        deals,
        activities,
        labels,
        stages,
        acting_profile_id,
    )
}

pub fn put_records_on(
    c: &Connection,
    organizations: Option<Vec<Value>>,
    deals: Option<Vec<Value>>,
    activities: Option<Vec<Value>>,
    labels: Option<Vec<Value>>,
    stages: Option<Vec<Value>>,
    acting_profile_id: Option<String>,
) -> Result<CrmRevision> {
    // Validate EVERY payload before opening the transaction's first write: the
    // contract says one bad record fails the whole call with nothing written.
    let mut records: Vec<(String, &'static str, &Value)> = Vec::new();
    for (kind, payloads) in [
        (KIND_ORGANIZATION, &organizations),
        (KIND_DEAL, &deals),
        (KIND_ACTIVITY, &activities),
    ] {
        for payload in payloads.iter().flat_map(|list| list.iter()) {
            records.push((record_id(payload)?, kind, payload));
        }
    }

    let author = updated_by(c, acting_profile_id)?;
    let tx = err(c.unchecked_transaction())?;
    let stamp = write_stamp(&tx)?;
    for (id, kind, payload) in &records {
        err(tx.execute(
            "INSERT INTO crm_records(id,kind,payload_json,updated_at,updated_by) \
             VALUES(?1,?2,?3,?4,?5) \
             ON CONFLICT(id) DO UPDATE SET \
               kind=excluded.kind, payload_json=excluded.payload_json, \
               updated_at=excluded.updated_at, updated_by=excluded.updated_by",
            params![
                id,
                kind,
                serde_json::to_string(payload).map_err(|e| e.to_string())?,
                stamp,
                author
            ],
        ))?;
    }
    for (key, list) in [(SETTING_LABELS, &labels), (SETTING_STAGES, &stages)] {
        let Some(list) = list else { continue };
        err(tx.execute(
            "INSERT INTO crm_settings(key,payload_json,updated_at,updated_by) \
             VALUES(?1,?2,?3,?4) \
             ON CONFLICT(key) DO UPDATE SET \
               payload_json=excluded.payload_json, updated_at=excluded.updated_at, \
               updated_by=excluded.updated_by",
            params![
                key,
                serde_json::to_string(list).map_err(|e| e.to_string())?,
                stamp,
                author
            ],
        ))?;
    }
    let revision = revision_on(&tx)?;
    err(tx.commit())?;
    Ok(CrmRevision { revision })
}

/// The HARD delete. The trash view's soft delete stays inside the payload; this is
/// what empties the trash, and the rows are gone afterwards.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn crm_purge_records(
    organization_ids: Option<Vec<String>>,
    deal_ids: Option<Vec<String>>,
    activity_ids: Option<Vec<String>>,
) -> Result<CrmRevision> {
    purge_records_on(&connect()?, organization_ids, deal_ids, activity_ids)
}

pub fn purge_records_on(
    c: &Connection,
    organization_ids: Option<Vec<String>>,
    deal_ids: Option<Vec<String>>,
    activity_ids: Option<Vec<String>>,
) -> Result<CrmRevision> {
    let tx = err(c.unchecked_transaction())?;
    for (kind, ids) in [
        (KIND_ORGANIZATION, &organization_ids),
        (KIND_DEAL, &deal_ids),
        (KIND_ACTIVITY, &activity_ids),
    ] {
        for id in ids.iter().flat_map(|list| list.iter()) {
            // The kind is part of the predicate: a deal id may not erase an
            // organization row even if the client confuses the two lists.
            err(tx.execute(
                "DELETE FROM crm_records WHERE id=?1 AND kind=?2",
                params![id, kind],
            ))?;
        }
    }
    let revision = revision_on(&tx)?;
    err(tx.commit())?;
    Ok(CrmRevision { revision })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) \
             VALUES('p-jannes','jannes','Jannes Zude',1),('p-bjarne','bjarne','Bjarne Design',2)",
            [],
        )
        .unwrap();
        c
    }

    fn org(id: &str, name: &str) -> Value {
        json!({"id": id, "name": name, "owner": "Jannes", "labels": ["A"], "deletedAt": null})
    }

    #[test]
    fn an_empty_store_answers_with_empty_lists_and_revision_zero() {
        let c = fixture();
        let snapshot = snapshot_on(&c).unwrap();
        assert!(snapshot.organizations.is_empty());
        assert!(snapshot.deals.is_empty());
        assert!(snapshot.activities.is_empty());
        assert!(snapshot.labels.is_empty());
        assert!(snapshot.stages.is_empty());
        assert_eq!(snapshot.revision, 0, "nothing written, nothing to poll for");
    }

    #[test]
    fn a_put_then_snapshot_returns_the_payload_verbatim() {
        let c = fixture();
        let organization = org("org-1", "Paloptic");
        let deal = json!({"id":"deal-1","organizationId":"org-1","title":"Pilot","owner":"Bjarne"});
        let activity = json!({"id":"act-1","dealId":"deal-1","kind":"call","owner":"Charles"});
        put_records_on(
            &c,
            Some(vec![organization.clone()]),
            Some(vec![deal.clone()]),
            Some(vec![activity.clone()]),
            Some(vec![json!({"id":"l-1","name":"Hot"})]),
            Some(vec![json!("Non-Qualified"), json!("Won")]),
            Some("p-jannes".into()),
        )
        .unwrap();
        let snapshot = snapshot_on(&c).unwrap();
        assert_eq!(snapshot.organizations, vec![organization]);
        assert_eq!(snapshot.deals, vec![deal]);
        assert_eq!(snapshot.activities, vec![activity]);
        assert_eq!(snapshot.labels, vec![json!({"id":"l-1","name":"Hot"})]);
        assert_eq!(snapshot.stages, vec![json!("Non-Qualified"), json!("Won")]);
    }

    #[test]
    fn two_puts_of_different_records_do_not_clobber_each_other() {
        let c = fixture();
        // The whole reason the store is rows: Jannes and Bjarne save at the same
        // time, each naming only their own record.
        put_records_on(&c, Some(vec![org("org-1", "Paloptic")]), None, None, None, None, Some("p-jannes".into())).unwrap();
        put_records_on(&c, Some(vec![org("org-2", "Bjarne GmbH")]), None, None, None, None, Some("p-bjarne".into())).unwrap();
        let snapshot = snapshot_on(&c).unwrap();
        assert_eq!(snapshot.organizations.len(), 2, "neither save erased the other");
        assert_eq!(snapshot.organizations[0]["name"], json!("Paloptic"));
        assert_eq!(snapshot.organizations[1]["name"], json!("Bjarne GmbH"));
        // And a second write to ONE of them leaves the other untouched.
        put_records_on(&c, Some(vec![org("org-1", "Paloptic AG")]), None, None, None, None, Some("p-jannes".into())).unwrap();
        let snapshot = snapshot_on(&c).unwrap();
        assert_eq!(snapshot.organizations.len(), 2);
        assert_eq!(snapshot.organizations[0]["name"], json!("Paloptic AG"), "an upsert by id");
        assert_eq!(snapshot.organizations[1]["name"], json!("Bjarne GmbH"), "untouched");
    }

    #[test]
    fn a_record_without_an_id_is_refused_and_writes_nothing() {
        let c = fixture();
        put_records_on(&c, Some(vec![org("org-1", "Paloptic")]), None, None, None, None, None).unwrap();
        let before = snapshot_on(&c).unwrap();
        for bad in [json!({"name":"Nameless"}), json!({"id":"","name":"Empty"}), json!({"id":7})] {
            let error = put_records_on(
                &c,
                Some(vec![org("org-2", "Would-be")]),
                Some(vec![bad.clone()]),
                None,
                None,
                None,
                None,
            )
            .unwrap_err();
            assert_eq!(error, "crm record without id", "the contract's exact words");
        }
        let after = snapshot_on(&c).unwrap();
        assert_eq!(after, before, "no half write: the good record in the same call is not stored either");
    }

    #[test]
    fn purging_removes_the_rows() {
        let c = fixture();
        put_records_on(
            &c,
            Some(vec![org("org-1", "Paloptic"), org("org-2", "Other")]),
            Some(vec![json!({"id":"deal-1","title":"Pilot"})]),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        purge_records_on(&c, Some(vec!["org-1".into()]), None, None).unwrap();
        let snapshot = snapshot_on(&c).unwrap();
        assert_eq!(snapshot.organizations.len(), 1);
        assert_eq!(snapshot.organizations[0]["id"], json!("org-2"));
        assert_eq!(snapshot.deals.len(), 1, "a purge names its kind");
        // An id from the wrong list erases nothing.
        purge_records_on(&c, Some(vec!["deal-1".into()]), None, None).unwrap();
        assert_eq!(snapshot_on(&c).unwrap().deals.len(), 1);
        purge_records_on(&c, None, Some(vec!["deal-1".into()]), None).unwrap();
        assert!(snapshot_on(&c).unwrap().deals.is_empty());
    }

    #[test]
    fn the_revision_advances_on_every_write() {
        let c = fixture();
        assert_eq!(snapshot_on(&c).unwrap().revision, 0);
        let first = put_records_on(&c, Some(vec![org("org-1", "Paloptic")]), None, None, None, None, None)
            .unwrap()
            .revision;
        assert!(first > 0, "a write is visible to a poller");
        assert_eq!(snapshot_on(&c).unwrap().revision, first, "a read never moves it");
        // Same second, second write: still a different revision, or the poller
        // would skip this change.
        let second = put_records_on(&c, Some(vec![org("org-2", "Other")]), None, None, None, None, None)
            .unwrap()
            .revision;
        assert!(second > first, "{second} must be newer than {first}");
        let third = put_records_on(&c, None, None, None, Some(vec![json!("Hot")]), None, None)
            .unwrap()
            .revision;
        assert!(third > second, "settings writes move the revision too");
        let purged = purge_records_on(&c, Some(vec!["org-2".into()]), None, None).unwrap().revision;
        assert_eq!(purged, third, "a purge deletes rows; MAX(updated_at) of what remains is the truth");
        assert_eq!(snapshot_on(&c).unwrap().revision, purged);
    }

    #[test]
    fn the_writer_is_recorded_from_the_bound_session_identity() {
        let c = fixture();
        put_records_on(&c, Some(vec![org("org-1", "Paloptic")]), None, None, None, None, Some("p-bjarne".into())).unwrap();
        let author: Option<String> = c
            .query_row("SELECT updated_by FROM crm_records WHERE id='org-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(author.as_deref(), Some("p-bjarne"));
        // An id that is not a live profile costs the attribution, never the record.
        put_records_on(&c, Some(vec![org("org-2", "Other")]), None, None, None, None, Some("ghost".into())).unwrap();
        let author: Option<String> = c
            .query_row("SELECT updated_by FROM crm_records WHERE id='org-2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(author, None, "a bogus id is dropped, the save still happens");
    }

    #[test]
    fn every_member_sees_the_same_crm() {
        // There is no owner filter and no admin gate by design: the snapshot does not
        // take a profile at all, so two members cannot be shown different pipelines.
        let c = fixture();
        put_records_on(&c, Some(vec![org("org-1", "Paloptic")]), None, None, None, None, Some("p-jannes".into())).unwrap();
        put_records_on(&c, Some(vec![org("org-2", "Other")]), None, None, None, None, Some("p-bjarne".into())).unwrap();
        assert_eq!(snapshot_on(&c).unwrap().organizations.len(), 2);
    }
}
