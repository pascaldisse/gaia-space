//! Space-Buy: agent-first ordering ledger (docs/space-buy/DESIGN.md). Intent + approval +
//! receipt ref only — no money moves here. Mirrors platform.rs (conn/new_id/err shape) and the
//! `/api/cmd/<name>` bridge in bin/space-server.rs. Money is integer cents, as budget.rs.
use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

pub const STATUSES: [&str; 5] = ["wanted", "approved", "ordered", "delivered", "cancelled"];
pub const VENDOR_KINDS: [&str; 3] = ["api", "browser", "manual"];

fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{kind}-{nanos:x}-{:x}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
fn err<T>(value: rusqlite::Result<T>) -> Result<T> {
    value.map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BuyItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub price_cents: Option<i64>,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_qty")]
    pub qty: i64,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub notes: String,
    /// Server-owned: stamped from the session on approve / mark-ordered; ignored on save.
    #[serde(default)]
    pub approver: Option<String>,
    #[serde(default)]
    pub ordered_by: Option<String>,
    #[serde(default)]
    pub order_ref: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}
fn default_currency() -> String {
    "EUR".into()
}
fn default_qty() -> i64 {
    1
}
fn default_status() -> String {
    "wanted".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BuyVendor {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub agent_allowed: bool,
    #[serde(default)]
    pub notes: String,
}

const ITEM_COLS: &str = "id,project_id,title,url,vendor,price_cents,currency,qty,status,notes,approver,ordered_by,order_ref,created_by,created_at,updated_at";
fn item_row(row: &rusqlite::Row) -> rusqlite::Result<BuyItem> {
    Ok(BuyItem {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        url: row.get(3)?,
        vendor: row.get(4)?,
        price_cents: row.get(5)?,
        currency: row.get(6)?,
        qty: row.get(7)?,
        status: row.get(8)?,
        notes: row.get(9)?,
        approver: row.get(10)?,
        ordered_by: row.get(11)?,
        order_ref: row.get(12)?,
        created_by: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn get_item(c: &Connection, id: &str) -> Result<BuyItem> {
    err(c
        .query_row(
            &format!("SELECT {ITEM_COLS} FROM buy_items WHERE id=?1"),
            [id],
            item_row,
        )
        .optional())?
    .ok_or_else(|| "buy item not found".to_string())
}

pub fn list_items_in(c: &Connection, status: Option<&str>) -> Result<Vec<BuyItem>> {
    let sql = format!("SELECT {ITEM_COLS} FROM buy_items WHERE (?1 IS NULL OR status=?1) ORDER BY created_at DESC, id");
    let mut st = err(c.prepare(&sql))?;
    let rows = err(st.query_map([status], item_row))?;
    err(rows.collect::<std::result::Result<Vec<_>, _>>())
}

/// Upsert. Create forces `wanted` (agents propose, humans approve). Update touches only the
/// descriptive fields — status/approver/ordered_by/order_ref move through the dedicated verbs.
pub fn save_item_in(c: &Connection, mut item: BuyItem, actor: Option<String>) -> Result<BuyItem> {
    item.title = item.title.trim().to_string();
    if item.title.is_empty() {
        return Err("title is required".into());
    }
    if item.qty < 1 {
        return Err("qty must be at least 1".into());
    }
    if item.price_cents.is_some_and(|p| p < 0) {
        return Err("price must not be negative".into());
    }
    let currency = item.currency.trim().to_uppercase();
    if currency.len() != 3 {
        return Err("currency must be a 3-letter code".into());
    }
    let existing = if item.id.trim().is_empty() {
        None
    } else {
        err(c
            .query_row(
                "SELECT 1 FROM buy_items WHERE id=?1",
                [&item.id],
                |_| Ok(()),
            )
            .optional())?
    };
    if existing.is_some() {
        err(c.execute(
            "UPDATE buy_items SET project_id=?2,title=?3,url=?4,vendor=?5,price_cents=?6,currency=?7,qty=?8,notes=?9,updated_at=unixepoch() WHERE id=?1",
            params![item.id, item.project_id, item.title, item.url.trim(), item.vendor.trim(), item.price_cents, currency, item.qty, item.notes],
        ))?;
    } else {
        if item.id.trim().is_empty() {
            item.id = new_id("buy");
        }
        err(c.execute(
            "INSERT INTO buy_items(id,project_id,title,url,vendor,price_cents,currency,qty,status,notes,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'wanted',?9,?10)",
            params![item.id, item.project_id, item.title, item.url.trim(), item.vendor.trim(), item.price_cents, currency, item.qty, item.notes, actor.or(item.created_by)],
        ))?;
    }
    get_item(c, &item.id)
}

fn transition(
    c: &Connection,
    id: &str,
    from: &[&str],
    to: &str,
    set: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<BuyItem> {
    let cur = get_item(c, id)?;
    if !from.contains(&cur.status.as_str()) {
        return Err(format!("cannot move a {} item to {to}", cur.status));
    }
    let sql = format!("UPDATE buy_items SET status='{to}',{set}updated_at=unixepoch() WHERE id=?1");
    let mut all: Vec<&dyn rusqlite::ToSql> = vec![&id];
    all.extend_from_slice(args);
    err(c.execute(&sql, all.as_slice()))?;
    get_item(c, id)
}

pub fn approve_in(c: &Connection, id: &str, actor: Option<String>) -> Result<BuyItem> {
    let actor = actor.ok_or("approve needs a session identity")?;
    transition(c, id, &["wanted"], "approved", "approver=?2,", &[&actor])
}

pub fn mark_ordered_in(
    c: &Connection,
    id: &str,
    order_ref: String,
    actor: Option<String>,
) -> Result<BuyItem> {
    let actor = actor.ok_or("mark-ordered needs a session identity")?;
    if order_ref.trim().is_empty() {
        return Err("order_ref is required".into());
    }
    // `wanted` is rejected here: nothing is ordered without a human approval.
    transition(
        c,
        id,
        &["approved"],
        "ordered",
        "ordered_by=?2,order_ref=?3,",
        &[&actor, &order_ref.trim()],
    )
}

pub fn set_status_in(c: &Connection, id: &str, status: &str) -> Result<BuyItem> {
    match status {
        "delivered" => transition(c, id, &["ordered"], "delivered", "", &[]),
        "cancelled" => transition(
            c,
            id,
            &["wanted", "approved", "ordered"],
            "cancelled",
            "",
            &[],
        ),
        "wanted" | "approved" | "ordered" => {
            Err("use approve_buy_item / mark_buy_item_ordered for that move".into())
        }
        _ => Err(format!("unknown status {status:?}")),
    }
}

pub fn list_vendors_in(c: &Connection) -> Result<Vec<BuyVendor>> {
    let mut st = err(c.prepare(
        "SELECT name,kind,agent_allowed,notes FROM buy_vendors ORDER BY name COLLATE NOCASE",
    ))?;
    let rows = err(st.query_map([], |r| {
        Ok(BuyVendor {
            name: r.get(0)?,
            kind: r.get(1)?,
            agent_allowed: r.get::<_, i64>(2)? != 0,
            notes: r.get(3)?,
        })
    }))?;
    err(rows.collect::<std::result::Result<Vec<_>, _>>())
}

pub fn save_vendor_in(c: &Connection, mut vendor: BuyVendor) -> Result<BuyVendor> {
    vendor.name = vendor.name.trim().to_string();
    if vendor.name.is_empty() {
        return Err("vendor name is required".into());
    }
    if !VENDOR_KINDS.contains(&vendor.kind.as_str()) {
        return Err("vendor kind must be api, browser or manual".into());
    }
    err(c.execute(
        "INSERT INTO buy_vendors(name,kind,agent_allowed,notes) VALUES(?1,?2,?3,?4) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,agent_allowed=excluded.agent_allowed,notes=excluded.notes",
        params![vendor.name, vendor.kind, vendor.agent_allowed as i64, vendor.notes],
    ))?;
    Ok(vendor)
}

pub fn delete_vendor_in(c: &Connection, name: &str) -> Result<()> {
    let n = err(c.execute("DELETE FROM buy_vendors WHERE name=?1", [name]))?;
    if n == 0 {
        return Err("vendor not found".into());
    }
    Ok(())
}

// ---- command surface (/api/cmd/<name>; desktop IPC with the same names) ----
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_buy_items(status: Option<String>) -> Result<Vec<BuyItem>> {
    list_items_in(&db::conn()?, status.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_buy_item(item: BuyItem, actor: Option<String>) -> Result<BuyItem> {
    save_item_in(&db::conn()?, item, actor)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn approve_buy_item(id: String, actor: Option<String>) -> Result<BuyItem> {
    approve_in(&db::conn()?, &id, actor)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn mark_buy_item_ordered(
    id: String,
    order_ref: String,
    actor: Option<String>,
) -> Result<BuyItem> {
    mark_ordered_in(&db::conn()?, &id, order_ref, actor)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_buy_item_status(id: String, status: String) -> Result<BuyItem> {
    set_status_in(&db::conn()?, &id, &status)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_buy_item(id: String) -> Result<()> {
    let n = err(db::conn()?.execute("DELETE FROM buy_items WHERE id=?1", [id]))?;
    if n == 0 {
        return Err("buy item not found".into());
    }
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_buy_vendors() -> Result<Vec<BuyVendor>> {
    list_vendors_in(&db::conn()?)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_buy_vendor(vendor: BuyVendor) -> Result<BuyVendor> {
    save_vendor_in(&db::conn()?, vendor)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_buy_vendor(name: String) -> Result<()> {
    delete_vendor_in(&db::conn()?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> Connection {
        db::open_in_memory().expect("db")
    }
    fn item(title: &str) -> BuyItem {
        serde_json::from_value(serde_json::json!({"title": title, "vendor": "Amazon", "status": "ordered", "approver": "forged"})).unwrap()
    }
    #[test]
    fn amazon_is_seeded_agent_blocked() {
        let v = list_vendors_in(&conn()).unwrap();
        let a = v.iter().find(|v| v.name == "Amazon").expect("seed");
        assert!(!a.agent_allowed);
        assert_eq!(a.kind, "manual");
    }
    #[test]
    fn create_forces_wanted_and_flow_stamps_session_identity() {
        let c = conn();
        let it = save_item_in(&c, item("Katsuobushi"), Some("agent".into())).unwrap();
        assert_eq!((it.status.as_str(), it.approver.clone()), ("wanted", None));
        assert_eq!(it.created_by.as_deref(), Some("agent"));
        assert!(
            mark_ordered_in(&c, &it.id, "X1".into(), Some("agent".into())).is_err(),
            "no order before approval"
        );
        let ap = approve_in(&c, &it.id, Some("pascal".into())).unwrap();
        assert_eq!(
            (ap.status.as_str(), ap.approver.as_deref()),
            ("approved", Some("pascal"))
        );
        let od = mark_ordered_in(&c, &it.id, " 302-123 ".into(), Some("agent".into())).unwrap();
        assert_eq!(
            (
                od.status.as_str(),
                od.ordered_by.as_deref(),
                od.order_ref.as_deref()
            ),
            ("ordered", Some("agent"), Some("302-123"))
        );
        assert_eq!(
            set_status_in(&c, &it.id, "delivered").unwrap().status,
            "delivered"
        );
        assert!(set_status_in(&c, &it.id, "cancelled").is_err());
    }
    #[test]
    fn update_keeps_status_and_validates() {
        let c = conn();
        let it = save_item_in(&c, item("Kombu"), None).unwrap();
        approve_in(&c, &it.id, Some("p".into())).unwrap();
        let mut edit = it.clone();
        edit.title = "Kombu dashi".into();
        edit.status = "delivered".into();
        let after = save_item_in(&c, edit, None).unwrap();
        assert_eq!(
            (after.title.as_str(), after.status.as_str()),
            ("Kombu dashi", "approved")
        );
        let mut bad = item("x");
        bad.qty = 0;
        assert!(save_item_in(&c, bad, None).is_err());
        assert!(save_item_in(&c, item("  "), None).is_err());
        assert_eq!(list_items_in(&c, Some("approved")).unwrap().len(), 1);
        assert_eq!(list_items_in(&c, Some("wanted")).unwrap().len(), 0);
    }
    #[test]
    fn vendor_crud_validates_kind() {
        let c = conn();
        let v = BuyVendor {
            name: "Kaufland".into(),
            kind: "browser".into(),
            agent_allowed: true,
            notes: String::new(),
        };
        save_vendor_in(&c, v.clone()).unwrap();
        assert!(save_vendor_in(
            &c,
            BuyVendor {
                kind: "scrape".into(),
                ..v.clone()
            }
        )
        .is_err());
        delete_vendor_in(&c, "Kaufland").unwrap();
        assert!(delete_vendor_in(&c, "Kaufland").is_err());
    }
}
