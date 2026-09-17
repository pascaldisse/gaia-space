//! FINANCE — plan versus actual for the company's own money.
//!
//! ── WHY THIS MODULE OWNS ITS SCHEMA ────────────────────────────────────────────
//! Every other feature migrates in `db.rs`. This one may not: `db.rs` belongs to a
//! parallel lane in this cycle, so the three finance tables are created here,
//! idempotently, on every connection (`ensure_schema`). The statements are pure
//! `IF NOT EXISTS`, so folding them into a numbered migration later is a move, not a
//! rewrite. This is a deliberate, reported deviation from the repo's habit.
//!
//! ── WHO MAY SEE MONEY ──────────────────────────────────────────────────────────
//! Not "administrators". Four named people, and the names live in a TABLE
//! (`finance_access`), never in the frontend: a nav entry is decoration, and hiding a
//! menu item is not access control. Every `finance_*` command resolves the acting
//! profile through `actor::resolve` — the webview may name WHAT to act on, never WHO
//! acts — and refuses when that profile has no row. The nav entry merely asks the
//! same gate (`finance_access_check`) and believes the answer.
//!
//! The first bootstrap matches the four names against live profiles. A name with no
//! profile is NOT silently dropped: `finance_access_check` reports it as `missing`,
//! so the interface can say which person still has to be connected.
//!
//! ── SIGN CONVENTION (one sentence, everywhere) ─────────────────────────────────
//! `amount_cents` and `planned_cents` are NEGATIVE for money leaving (costs,
//! Splitwise expenses) and POSITIVE for money arriving (revenue). A Splitwise export
//! lists a cost as a positive number; the importer negates it exactly once, here.
//!
//! ── THE PLAN IS IMPORTED, NEVER BUILT IN ───────────────────────────────────────
//! This module carries NO amounts. A company's plan is the owner's data, not the
//! program's source code, so the numbers arrive at runtime through
//! `import_finance_plan` and live only in the database.
//!
//! FILE FORMAT (also in `docs/finance-plan-format.md`) — JSON, amounts in whole
//! CENTS as integers, negative for cost, positive for revenue:
//!
//! ```json
//! {
//!   "version": 1,
//!   "currency": "EUR",
//!   "overwrite": false,
//!   "positions": [
//!     {
//!       "category": "Beispielblock",
//!       "position": "Beispielposten",
//!       "kind": "cost",
//!       "optional": false,
//!       "estimated": true,
//!       "assumption": "Monat nicht im Dokument; hier angenommen.",
//!       "source": "beispiel.html",
//!       "source_block": "Beispielblock",
//!       "source_detail": "Beispielzeile",
//!       "months": { "2026-08": -1234, "2026-09": -1234 }
//!     }
//!   ]
//! }
//! ```
//!
//! IDEMPOTENT, AND THE OWNER'S CORRECTION WINS: a (category, position, month) that
//! already holds a DIFFERENT amount is reported as `skipped`, never overwritten —
//! unless the payload says `"overwrite": true`. Importing the same file twice
//! changes nothing. Flags, assumption and provenance belong to the DOCUMENT and are
//! kept in step on every import; only amounts are the owner's.
use crate::{actor, db};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

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

fn err<T>(result: rusqlite::Result<T>) -> Result<T> {
    result.map_err(|error| error.to_string())
}

/// The four people this surface exists for. A LIST OF NAMES, matched once against
/// the profile table; the durable authority is the `finance_access` row it creates.
pub const FINANCE_PEOPLE: [&str; 4] = ["Pascal", "Charles", "Bjarne", "Jannes"];

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS finance_access (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    granted_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS finance_entries (
    id TEXT PRIMARY KEY,
    entry_date TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    source TEXT NOT NULL CHECK(source IN ('splitwise','manual')),
    external_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
/* Idempotent import: one external record can exist once per source. Manual rows
   carry no external id and are therefore never blocked by this index. */
CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_external
    ON finance_entries(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_entries_date ON finance_entries(entry_date);
CREATE TABLE IF NOT EXISTS finance_plan (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    item TEXT NOT NULL DEFAULT '',
    month TEXT NOT NULL,
    planned_cents INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'cost',
    optional INTEGER NOT NULL DEFAULT 0,
    estimated INTEGER NOT NULL DEFAULT 0,
    assumption TEXT,
    source_file TEXT NOT NULL DEFAULT '',
    source_block TEXT NOT NULL DEFAULT '',
    source_detail TEXT NOT NULL DEFAULT '',
    UNIQUE(category, item, month)
);
"#;

/// Creates the finance tables if they are absent and bootstraps access the first
/// time. Called by every command; all statements are idempotent.
pub fn ensure_schema(c: &Connection) -> Result<()> {
    err(c.execute_batch(SCHEMA))?;
    migrate_plan_to_items(c)?;
    bootstrap_access(c)?;
    Ok(())
}

/// ── THE PLAN GREW A LEVEL ─────────────────────────────────────────────────────
/// The first plan held ONE number per category and month; the documents hold a
/// category, a named position inside it (`det[]`), and a month. Adding that level
/// means a new UNIQUE key, and SQLite cannot rewrite a table constraint in place —
/// so the table is rebuilt once, and NOTHING is thrown away: every pre-existing row
/// is copied verbatim into `finance_plan_legacy` (kept forever, hand corrections
/// included) and carried into the new table with an empty `item`. When an import
/// later fills a category with its named positions, that category's summary row
/// would double-count, so the import removes it and REPORTS the removal — the
/// number still exists, in the legacy table, where it can be read.
fn plan_has_item_column(c: &Connection) -> Result<bool> {
    let mut statement = err(c.prepare("PRAGMA table_info(finance_plan)"))?;
    let names = err(statement.query_map([], |row| row.get::<_, String>(1)))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(names.iter().any(|name| name == "item"))
}

fn migrate_plan_to_items(c: &Connection) -> Result<()> {
    if plan_has_item_column(c)? {
        return Ok(());
    }
    err(c.execute_batch(
        "CREATE TABLE IF NOT EXISTS finance_plan_legacy AS SELECT * FROM finance_plan;
         ALTER TABLE finance_plan RENAME TO finance_plan_pre_items;",
    ))?;
    err(c.execute_batch(SCHEMA))?;
    err(c.execute_batch(
        "INSERT OR IGNORE INTO finance_plan(id,category,item,month,planned_cents,kind,optional,estimated,assumption,source_file,source_block,source_detail)
         SELECT id,category,'',month,planned_cents,
                CASE WHEN planned_cents < 0 THEN 'cost' ELSE 'revenue' END,
                0,0,NULL,'(vor der Aufschlüsselung)','','' FROM finance_plan_pre_items;
         DROP TABLE finance_plan_pre_items;",
    ))?;
    Ok(())
}

// ── ACCESS ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FinanceMember {
    pub profile_id: String,
    pub display_name: String,
    pub username: String,
}

/// The honest answer to "may I open Finance?" — plus, for the people who may, the
/// names that could not be matched to a profile, so the view can say so out loud
/// instead of quietly showing three of four owners.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FinanceAccess {
    pub allowed: bool,
    pub profile_id: Option<String>,
    /// Present when `allowed` is false: why, in words a person can act on.
    pub reason: Option<String>,
    /// Names from [`FINANCE_PEOPLE`] with no matching live profile.
    pub missing: Vec<String>,
}

fn profile_matching(c: &Connection, name: &str) -> Result<Option<FinanceMember>> {
    let needle = format!("%{}%", name.to_lowercase());
    err(c
        .query_row(
            "SELECT id,display_name,username FROM profiles \
             WHERE archived=0 AND (lower(display_name) LIKE ?1 OR lower(username) LIKE ?1) \
             ORDER BY created_at LIMIT 1",
            [needle],
            |row| {
                Ok(FinanceMember {
                    profile_id: row.get(0)?,
                    display_name: row.get(1)?,
                    username: row.get(2)?,
                })
            },
        )
        .optional())
}

/// Names with no live profile. Recomputed on every check, because a profile created
/// later must stop being reported as missing without anybody re-running a seed.
fn missing_people(c: &Connection) -> Result<Vec<String>> {
    let mut missing = Vec::new();
    for name in FINANCE_PEOPLE {
        if profile_matching(c, name)?.is_none() {
            missing.push(name.to_string());
        }
    }
    Ok(missing)
}

/// Grants the four named people access ONCE — only while the table is empty. After
/// that the table is the authority: a revoked person stays revoked, and a fifth
/// person added through the view is not washed away by a later bootstrap.
fn bootstrap_access(c: &Connection) -> Result<()> {
    let count: i64 = err(c.query_row("SELECT COUNT(*) FROM finance_access", [], |r| r.get(0)))?;
    if count > 0 {
        return Ok(());
    }
    for name in FINANCE_PEOPLE {
        if let Some(member) = profile_matching(c, name)? {
            err(c.execute(
                "INSERT OR IGNORE INTO finance_access(profile_id) VALUES(?1)",
                [member.profile_id],
            ))?;
        }
    }
    Ok(())
}

fn has_access(c: &Connection, profile_id: &str) -> Result<bool> {
    Ok(err(c
        .query_row(
            "SELECT 1 FROM finance_access WHERE profile_id=?1",
            [profile_id],
            |_| Ok(()),
        )
        .optional())?
    .is_some())
}

/// THE GATE. Every command below goes through it. It returns the acting profile so
/// callers never have to ask the webview who is speaking.
fn gate(c: &Connection) -> Result<String> {
    let (profile_id, _) = actor::resolve(c)?;
    if has_access(c, &profile_id)? {
        Ok(profile_id)
    } else {
        Err("Finance is restricted to its named owners".to_string())
    }
}

fn connect() -> Result<Connection> {
    let c = db::conn()?;
    ensure_schema(&c)?;
    Ok(c)
}

/// Refusal is a VALUE here, not an error: the nav asks this question on every render
/// and a red error banner for "you are not a finance owner" would be noise.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn finance_access_check() -> Result<FinanceAccess> {
    let c = connect()?;
    Ok(access_of(&c))
}

fn access_of(c: &Connection) -> FinanceAccess {
    let missing = missing_people(c).unwrap_or_default();
    match actor::resolve(c) {
        Ok((profile_id, _)) => match has_access(c, &profile_id) {
            Ok(true) => FinanceAccess {
                allowed: true,
                profile_id: Some(profile_id),
                reason: None,
                missing,
            },
            Ok(false) => FinanceAccess {
                allowed: false,
                profile_id: Some(profile_id),
                reason: Some("Finance is restricted to its named owners".into()),
                missing,
            },
            Err(reason) => FinanceAccess {
                allowed: false,
                profile_id: None,
                reason: Some(reason),
                missing,
            },
        },
        Err(reason) => FinanceAccess {
            allowed: false,
            profile_id: None,
            reason: Some(reason),
            missing,
        },
    }
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_finance_access() -> Result<Vec<FinanceMember>> {
    let c = connect()?;
    gate(&c)?;
    list_finance_access_on(&c)
}

fn list_finance_access_on(c: &Connection) -> Result<Vec<FinanceMember>> {
    let mut statement = err(c.prepare(
        "SELECT p.id,p.display_name,p.username FROM finance_access a \
         JOIN profiles p ON p.id=a.profile_id ORDER BY p.display_name",
    ))?;
    let rows = err(statement.query_map([], |row| {
        Ok(FinanceMember {
            profile_id: row.get(0)?,
            display_name: row.get(1)?,
            username: row.get(2)?,
        })
    }))?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn grant_finance_access(profile_id: String) -> Result<Vec<FinanceMember>> {
    let c = connect()?;
    gate(&c)?;
    grant_on(&c, &profile_id)?;
    list_finance_access_on(&c)
}

fn grant_on(c: &Connection, profile_id: &str) -> Result<()> {
    let exists: Option<()> = err(c
        .query_row(
            "SELECT 1 FROM profiles WHERE id=?1 AND archived=0",
            [profile_id],
            |_| Ok(()),
        )
        .optional())?;
    if exists.is_none() {
        return Err("No such person".to_string());
    }
    err(c.execute(
        "INSERT OR IGNORE INTO finance_access(profile_id) VALUES(?1)",
        [profile_id],
    ))?;
    Ok(())
}

/// A room nobody can enter is a lost room: the last owner may not remove themselves
/// out of the feature.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn revoke_finance_access(profile_id: String) -> Result<Vec<FinanceMember>> {
    let c = connect()?;
    gate(&c)?;
    revoke_on(&c, &profile_id)?;
    list_finance_access_on(&c)
}

fn revoke_on(c: &Connection, profile_id: &str) -> Result<()> {
    let count: i64 = err(c.query_row("SELECT COUNT(*) FROM finance_access", [], |r| r.get(0)))?;
    if count <= 1 {
        return Err("The last finance owner cannot be removed".to_string());
    }
    let changed = err(c.execute(
        "DELETE FROM finance_access WHERE profile_id=?1",
        [profile_id],
    ))?;
    if changed == 0 {
        return Err("That person has no finance access".to_string());
    }
    Ok(())
}

// ── ENTRIES ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FinanceEntry {
    #[serde(default)]
    pub id: String,
    /// ISO date, `YYYY-MM-DD`.
    pub entry_date: String,
    pub description: String,
    pub category: String,
    /// Negative = money out, positive = money in. See the module note.
    pub amount_cents: i64,
    pub currency: String,
    /// `splitwise` | `manual`.
    pub source: String,
    #[serde(default)]
    pub external_id: Option<String>,
}

const ENTRY_COLUMNS: &str =
    "id,entry_date,description,category,amount_cents,currency,source,external_id";

fn read_entry(row: &rusqlite::Row) -> rusqlite::Result<FinanceEntry> {
    Ok(FinanceEntry {
        id: row.get(0)?,
        entry_date: row.get(1)?,
        description: row.get(2)?,
        category: row.get(3)?,
        amount_cents: row.get(4)?,
        currency: row.get(5)?,
        source: row.get(6)?,
        external_id: row.get(7)?,
    })
}

/// `from`/`to` are inclusive ISO dates. Both optional: an unbounded end is what the
/// current month wants on its last day.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_finance_entries(from: Option<String>, to: Option<String>) -> Result<Vec<FinanceEntry>> {
    let c = connect()?;
    gate(&c)?;
    list_entries_on(&c, from, to)
}

fn list_entries_on(
    c: &Connection,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<FinanceEntry>> {
    let mut statement = err(c.prepare(&format!(
        "SELECT {ENTRY_COLUMNS} FROM finance_entries \
         WHERE (?1 IS NULL OR entry_date>=?1) AND (?2 IS NULL OR entry_date<=?2) \
         ORDER BY entry_date DESC, id DESC"
    )))?;
    let rows = err(statement.query_map(params![from, to], read_entry))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn validate_entry(entry: &FinanceEntry) -> Result<()> {
    if entry.entry_date.trim().is_empty() || entry.description.trim().is_empty() {
        return Err("Date and description are required".to_string());
    }
    if entry.source != "manual" && entry.source != "splitwise" {
        return Err("Unknown entry source".to_string());
    }
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_finance_entry(entry: FinanceEntry) -> Result<FinanceEntry> {
    let c = connect()?;
    gate(&c)?;
    create_entry_on(&c, entry)
}

fn create_entry_on(c: &Connection, entry: FinanceEntry) -> Result<FinanceEntry> {
    validate_entry(&entry)?;
    let id = if entry.id.trim().is_empty() {
        new_id("fin")
    } else {
        entry.id.clone()
    };
    err(c.execute(
        "INSERT INTO finance_entries(id,entry_date,description,category,amount_cents,currency,source,external_id) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            entry.entry_date.trim(),
            entry.description.trim(),
            entry.category.trim(),
            entry.amount_cents,
            entry.currency.trim(),
            entry.source,
            entry.external_id
        ],
    ))?;
    entry_on(c, &id)?.ok_or_else(|| "Created entry was not found".to_string())
}

fn entry_on(c: &Connection, id: &str) -> Result<Option<FinanceEntry>> {
    err(c
        .query_row(
            &format!("SELECT {ENTRY_COLUMNS} FROM finance_entries WHERE id=?1"),
            [id],
            read_entry,
        )
        .optional())
}

/// The source and the external id are NOT taken from the payload: an edit may correct
/// what a number means, never where it came from — that is what keeps a re-import
/// idempotent after somebody fixed a category by hand.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_finance_entry(entry: FinanceEntry) -> Result<FinanceEntry> {
    let c = connect()?;
    gate(&c)?;
    update_entry_on(&c, entry)
}

fn update_entry_on(c: &Connection, entry: FinanceEntry) -> Result<FinanceEntry> {
    validate_entry(&entry)?;
    let changed = err(c.execute(
        "UPDATE finance_entries SET entry_date=?2,description=?3,category=?4,amount_cents=?5,currency=?6 WHERE id=?1",
        params![
            entry.id,
            entry.entry_date.trim(),
            entry.description.trim(),
            entry.category.trim(),
            entry.amount_cents,
            entry.currency.trim()
        ],
    ))?;
    if changed == 0 {
        return Err("Entry not found".to_string());
    }
    entry_on(c, &entry.id)?.ok_or_else(|| "Entry not found".to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_finance_entry(id: String) -> Result<()> {
    let c = connect()?;
    gate(&c)?;
    delete_entry_on(&c, &id)
}

fn delete_entry_on(c: &Connection, id: &str) -> Result<()> {
    let changed = err(c.execute("DELETE FROM finance_entries WHERE id=?1", [id]))?;
    if changed == 0 {
        return Err("Entry not found".to_string());
    }
    Ok(())
}

// ── PLAN ──────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FinancePlanRow {
    #[serde(default)]
    pub id: String,
    /// The block a document draws around a group of positions.
    pub category: String,
    /// The named position inside the block — the document's `det[]` entry. Empty on
    /// rows that predate the two-level plan.
    #[serde(default)]
    pub item: String,
    /// `YYYY-MM`.
    pub month: String,
    /// Negative = planned cost, positive = planned revenue.
    pub planned_cents: i64,
    /// `cost` | `revenue` — stated, not inferred from the sign, so a corrected zero
    /// still knows which block it belongs to.
    #[serde(default)]
    pub kind: String,
    /// The document's own `opt:true`.
    #[serde(default)]
    pub optional: bool,
    /// The document's own `est:true`.
    #[serde(default)]
    pub estimated: bool,
    /// Present when the MONTH is ours, not the document's — in words, so the view can
    /// show it and the owner can correct it.
    #[serde(default)]
    pub assumption: Option<String>,
    #[serde(default)]
    pub source_file: String,
    #[serde(default)]
    pub source_block: String,
    #[serde(default)]
    pub source_detail: String,
}

const PLAN_COLUMNS: &str = "id,category,item,month,planned_cents,kind,optional,estimated,assumption,source_file,source_block,source_detail";

fn read_plan(row: &rusqlite::Row) -> rusqlite::Result<FinancePlanRow> {
    Ok(FinancePlanRow {
        id: row.get(0)?,
        category: row.get(1)?,
        item: row.get(2)?,
        month: row.get(3)?,
        planned_cents: row.get(4)?,
        kind: row.get(5)?,
        optional: row.get::<_, i64>(6)? != 0,
        estimated: row.get::<_, i64>(7)? != 0,
        assumption: row.get(8)?,
        source_file: row.get(9)?,
        source_block: row.get(10)?,
        source_detail: row.get(11)?,
    })
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_finance_plan() -> Result<Vec<FinancePlanRow>> {
    let c = connect()?;
    gate(&c)?;
    list_plan_on(&c)
}

fn list_plan_on(c: &Connection) -> Result<Vec<FinancePlanRow>> {
    let mut statement = err(c.prepare(&format!(
        "SELECT {PLAN_COLUMNS} FROM finance_plan ORDER BY category, item, month"
    )))?;
    let rows = err(statement.query_map([], read_plan))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn valid_month(month: &str) -> bool {
    month.len() == 7
        && month.as_bytes()[4] == b'-'
        && month[0..4].bytes().all(|b| b.is_ascii_digit())
        && month[5..7].bytes().all(|b| b.is_ascii_digit())
}

/// One plan number per category, position and month — writing the same triple twice
/// corrects it instead of creating a second truth. The provenance columns are NOT
/// overwritten by an edit: correcting an amount may not rewrite where it came from,
/// and an assumption stays visible until the document says otherwise.
/// Editing a cell in the view lands exactly here.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn upsert_finance_plan(row: FinancePlanRow) -> Result<FinancePlanRow> {
    let c = connect()?;
    gate(&c)?;
    upsert_plan_on(&c, row)
}

fn upsert_plan_on(c: &Connection, row: FinancePlanRow) -> Result<FinancePlanRow> {
    if row.category.trim().is_empty() {
        return Err("Category is required".to_string());
    }
    if !valid_month(row.month.trim()) {
        return Err("Month must be YYYY-MM".to_string());
    }
    let id = if row.id.trim().is_empty() {
        new_id("plan")
    } else {
        row.id.clone()
    };
    let kind = match row.kind.as_str() {
        "revenue" => "revenue",
        "cost" => "cost",
        _ if row.planned_cents > 0 => "revenue",
        _ => "cost",
    };
    err(c.execute(
        "INSERT INTO finance_plan(id,category,item,month,planned_cents,kind,optional,estimated,assumption,source_file,source_block,source_detail) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) \
         ON CONFLICT(category,item,month) DO UPDATE SET planned_cents=excluded.planned_cents",
        params![
            id,
            row.category.trim(),
            row.item.trim(),
            row.month.trim(),
            row.planned_cents,
            kind,
            row.optional as i64,
            row.estimated as i64,
            row.assumption,
            row.source_file,
            row.source_block,
            row.source_detail
        ],
    ))?;
    err(c.query_row(
        &format!(
            "SELECT {PLAN_COLUMNS} FROM finance_plan WHERE category=?1 AND item=?2 AND month=?3"
        ),
        params![row.category.trim(), row.item.trim(), row.month.trim()],
        read_plan,
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_finance_plan(id: String) -> Result<()> {
    let c = connect()?;
    gate(&c)?;
    let changed = err(c.execute("DELETE FROM finance_plan WHERE id=?1", [id]))?;
    if changed == 0 {
        return Err("Plan row not found".to_string());
    }
    Ok(())
}

// ── PLAN IMPORT ───────────────────────────────────────────────────────────────

/// One position of the imported file: a block from the plan (`category`), the named
/// position inside it, and the months it is spread over. The wire shape is the JSON
/// documented at the top of this file and in `docs/finance-plan-format.md`.
#[derive(Clone, Debug, Deserialize)]
pub struct PlanImportPosition {
    pub category: String,
    pub position: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub estimated: bool,
    #[serde(default)]
    pub assumption: Option<String>,
    /// Where the number comes from, in the owner's words. Stored as `source_file`.
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub source_block: Option<String>,
    #[serde(default)]
    pub source_detail: Option<String>,
    /// `"YYYY-MM" -> cents`, integer, negative for cost.
    #[serde(default)]
    pub months: std::collections::BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PlanImportFile {
    pub version: u32,
    #[serde(default)]
    pub currency: Option<String>,
    /// The ONLY way an existing, possibly hand-corrected amount is rewritten.
    #[serde(default)]
    pub overwrite: bool,
    #[serde(default)]
    pub positions: Vec<PlanImportPosition>,
}

/// What the import did, in the caller's language. `skipped` counts the cells the
/// import did NOT write: identical ones and — the point of the whole exercise —
/// hand-corrected ones it refused to overwrite.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ImportPlanSummary {
    pub inserted: usize,
    pub updated: usize,
    pub skipped: usize,
    pub categories: usize,
    pub positions: usize,
    pub errors: Vec<String>,
    /// Rows of the one-level plan a named position replaces. Not lost:
    /// `finance_plan_legacy` still holds them.
    #[serde(default)]
    pub replaced_summary_rows: usize,
}

const PLAN_FORMAT_VERSION: u32 = 1;
const COST: &str = "cost";
const REVENUE: &str = "revenue";

/// Imports a plan file. Idempotent by (category, position, month): the same file
/// twice changes nothing, and a cell the owner corrected by hand is REPORTED as
/// skipped, never silently rewritten.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn import_finance_plan(payload_json: String) -> Result<ImportPlanSummary> {
    let c = connect()?;
    gate(&c)?;
    import_plan_on(&c, &payload_json)
}

fn import_plan_on(c: &Connection, payload_json: &str) -> Result<ImportPlanSummary> {
    let file: PlanImportFile = serde_json::from_str(payload_json)
        .map_err(|e| format!("Plan file is not readable JSON: {e}"))?;
    if file.version != PLAN_FORMAT_VERSION {
        return Err(format!(
            "Plan file version {} is not supported (expected {PLAN_FORMAT_VERSION})",
            file.version
        ));
    }
    let mut summary = ImportPlanSummary::default();
    let mut categories: Vec<String> = Vec::new();
    for entry in &file.positions {
        let category = entry.category.trim();
        let item = entry.position.trim();
        if category.is_empty() {
            summary
                .errors
                .push(format!("Position „{item}“ has no category — skipped"));
            continue;
        }
        let kind = match entry.kind.as_deref() {
            Some("revenue") => REVENUE,
            Some("cost") => COST,
            Some(other) => {
                summary.errors.push(format!(
                    "{category} · {item}: unknown kind „{other}“ — skipped"
                ));
                continue;
            }
            None => COST,
        };
        summary.positions += 1;
        if !categories.iter().any(|name| name == category) {
            categories.push(category.to_string());
        }
        // The flags, the assumption and the provenance are the DOCUMENT speaking.
        // They are kept in step on every import; only amounts belong to the owner.
        err(c.execute(
            "UPDATE finance_plan SET kind=?1, optional=?2, estimated=?3, assumption=?4, \
             source_file=?5, source_block=?6, source_detail=?7 \
             WHERE category=?8 AND item=?9",
            params![
                kind,
                entry.optional as i64,
                entry.estimated as i64,
                entry.assumption,
                entry.source.clone().unwrap_or_default(),
                entry.source_block.clone().unwrap_or_default(),
                entry.source_detail.clone().unwrap_or_default(),
                category,
                item
            ],
        ))?;
        for (month, cents) in &entry.months {
            let month = month.trim();
            if !valid_month(month) {
                summary
                    .errors
                    .push(format!("{category} · {item}: „{month}“ is not YYYY-MM"));
                continue;
            }
            let existing: Option<i64> = err(c
                .query_row(
                    "SELECT planned_cents FROM finance_plan WHERE category=?1 AND item=?2 AND month=?3",
                    params![category, item, month],
                    |row| row.get(0),
                )
                .optional())?;
            match existing {
                None => {
                    err(c.execute(
                        "INSERT INTO finance_plan(id,category,item,month,planned_cents,kind,optional,estimated,assumption,source_file,source_block,source_detail) \
                         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                        params![
                            new_id("plan"),
                            category,
                            item,
                            month,
                            cents,
                            kind,
                            entry.optional as i64,
                            entry.estimated as i64,
                            entry.assumption,
                            entry.source.clone().unwrap_or_default(),
                            entry.source_block.clone().unwrap_or_default(),
                            entry.source_detail.clone().unwrap_or_default()
                        ],
                    ))?;
                    summary.inserted += 1;
                }
                Some(current) if current == *cents => summary.skipped += 1,
                Some(_) if !file.overwrite => summary.skipped += 1,
                Some(_) => {
                    err(c.execute(
                        "UPDATE finance_plan SET planned_cents=?1 WHERE category=?2 AND item=?3 AND month=?4",
                        params![cents, category, item, month],
                    ))?;
                    summary.updated += 1;
                }
            }
            // A category that now has NAMED positions may not keep its one-level
            // summary row for the same month: that would count the same money twice.
            if !item.is_empty() {
                summary.replaced_summary_rows += err(c.execute(
                    "DELETE FROM finance_plan WHERE category=?1 AND item='' AND month=?2",
                    params![category, month],
                ))?;
            }
        }
    }
    summary.categories = categories.len();
    Ok(summary)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SeedSummary {
    pub inserted: usize,
    pub kept: usize,
    pub categories: usize,
    #[serde(default)]
    pub replaced_summary_rows: usize,
}

/// KEPT AS AN EMPTY ALIAS, on purpose. Older frontends and older installations may
/// still call it; it must not fail and it must not invent numbers. There is no
/// built-in plan any more — the plan arrives through `import_finance_plan`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn seed_finance_plan() -> Result<SeedSummary> {
    let c = connect()?;
    gate(&c)?;
    Ok(SeedSummary::default())
}

// ── SPLITWISE CSV IMPORT ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub errors: Vec<String>,
}

/// RFC4180-ish field splitting: quoted fields may contain commas, and a doubled
/// quote inside a quoted field is one quote. Splitwise descriptions routinely carry
/// both, so a naive `split(',')` silently shifts every following column.
fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => fields.push(std::mem::take(&mut field)),
            _ => field.push(ch),
        }
    }
    fields.push(field);
    fields.into_iter().map(|f| f.trim().to_string()).collect()
}

/// Splits on newlines but keeps a quoted multi-line field together — a description
/// with a line break must not become two half rows.
fn csv_rows(text: &str) -> Vec<String> {
    let mut rows = Vec::new();
    let mut current = String::new();
    let mut quotes = 0usize;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        quotes += line.chars().filter(|c| *c == '"').count();
        if current.is_empty() {
            current.push_str(line);
        } else {
            current.push('\n');
            current.push_str(line);
        }
        if quotes.is_multiple_of(2) {
            rows.push(std::mem::take(&mut current));
            quotes = 0;
        }
    }
    if !current.is_empty() {
        rows.push(current);
    }
    rows
}

/// `12,50` and `12.50` are the same money; thousands separators and a currency sign
/// are noise. Returns cents as a POSITIVE magnitude — the sign is applied by the
/// caller, once.
fn parse_cost(raw: &str) -> Option<i64> {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == ',' || *c == '.' || *c == '-')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    // Last separator wins as the decimal point; anything before it is grouping.
    let normalized = match (cleaned.rfind(','), cleaned.rfind('.')) {
        (Some(comma), Some(dot)) if comma > dot => cleaned.replace('.', "").replace(',', "."),
        (Some(_), None) => cleaned.replace(',', "."),
        _ => cleaned.replace(',', ""),
    };
    let value: f64 = normalized.parse().ok()?;
    Some((value * 100.0).round() as i64)
}

/// One parsed Splitwise line, already in this module's sign convention.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SplitwiseRow {
    pub entry_date: String,
    pub description: String,
    pub category: String,
    /// Negative: a Splitwise cost is money leaving.
    pub amount_cents: i64,
    pub currency: String,
    /// Stable across re-exports: the identity of the line, not of the file.
    pub external_id: String,
}

/// FNV-1a over the line's identifying fields. A hash, not a random id, is what makes
/// a second upload of the same export a no-op.
fn fingerprint(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for byte in part.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
        hash ^= 0x1f;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("sw-{hash:016x}")
}

/// Parses a Splitwise export. Returns the rows worth storing and one human sentence
/// per line that could not be read — a bad line is NAMED, never silently dropped.
pub fn parse_splitwise(csv_text: &str) -> (Vec<SplitwiseRow>, Vec<String>) {
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    let lines = csv_rows(csv_text);
    let mut lines = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty());
    let Some((_, header)) = lines.next() else {
        return (rows, vec!["The file is empty".to_string()]);
    };
    let columns = split_csv_line(header);
    let expected = ["date", "description", "category", "cost", "currency"];
    let head_ok = columns
        .iter()
        .take(5)
        .map(|c| c.to_lowercase())
        .eq(expected.iter().map(|c| c.to_string()));
    if !head_ok {
        return (
            rows,
            vec!["Not a Splitwise export: the header must start with Date,Description,Category,Cost,Currency".to_string()],
        );
    }
    for (index, line) in lines {
        let fields = split_csv_line(line);
        if fields.len() < 5 {
            errors.push(format!("Line {}: fewer than five columns", index + 1));
            continue;
        }
        let (date, description, category, cost, currency) = (
            fields[0].as_str(),
            fields[1].as_str(),
            fields[2].as_str(),
            fields[3].as_str(),
            fields[4].as_str(),
        );
        // The export's closing "Total balance" line is a SUMMARY, not an expense.
        if description.eq_ignore_ascii_case("total balance") || date.is_empty() {
            continue;
        }
        let Some(cents) = parse_cost(cost) else {
            errors.push(format!("Line {}: no cost on \"{description}\"", index + 1));
            continue;
        };
        rows.push(SplitwiseRow {
            entry_date: date.to_string(),
            description: description.to_string(),
            category: if category.is_empty() {
                "Uncategorized".to_string()
            } else {
                category.to_string()
            },
            amount_cents: -cents.abs(),
            currency: if currency.is_empty() {
                "EUR".to_string()
            } else {
                currency.to_string()
            },
            external_id: fingerprint(&[date, description, cost, currency]),
        });
    }
    (rows, errors)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn import_splitwise_csv(csv_text: String) -> Result<ImportSummary> {
    let c = connect()?;
    gate(&c)?;
    import_on(&c, &csv_text)
}

fn import_on(c: &Connection, csv_text: &str) -> Result<ImportSummary> {
    let (rows, errors) = parse_splitwise(csv_text);
    let mut imported = 0usize;
    let mut skipped_duplicates = 0usize;
    for row in rows {
        let changed = err(c.execute(
            "INSERT OR IGNORE INTO finance_entries(id,entry_date,description,category,amount_cents,currency,source,external_id) \
             VALUES(?1,?2,?3,?4,?5,?6,'splitwise',?7)",
            params![
                new_id("fin"),
                row.entry_date,
                row.description,
                row.category,
                row.amount_cents,
                row.currency,
                row.external_id
            ],
        ))?;
        if changed == 1 {
            imported += 1;
        } else {
            skipped_duplicates += 1;
        }
    }
    Ok(ImportSummary {
        imported,
        skipped_duplicates,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPORT: &str = "Date,Description,Category,Cost,Currency,Ada,Bob\n\
2026-08-04,Coffee,Food and drink,12.50,EUR,-6.25,6.25\n\
2026-08-05,\"Dinner, with clients\",Food and drink,\"1,234.50\",EUR,-617.25,617.25\n\
2026-08-06,Broken row,Utilities,,EUR,0,0\n\
,Total balance,,0.00,EUR,0,0\n";

    fn fixture() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-pascal','pascal','Pascal Disse',1),('p-jannes','jannes','Jannes Zude',2),('p-bjarne','bjarne','Bjarne Design',3),('p-other','xena','Xena Outsider',4)", []).unwrap();
        ensure_schema(&c).unwrap();
        c
    }

    #[test]
    fn parses_quoted_commas_and_skips_the_total_balance_line() {
        let (rows, errors) = parse_splitwise(EXPORT);
        assert_eq!(rows.len(), 2, "the total-balance line is not an expense");
        assert_eq!(rows[0].description, "Coffee");
        assert_eq!(rows[0].amount_cents, -1250, "a cost is money leaving");
        assert_eq!(rows[1].description, "Dinner, with clients");
        assert_eq!(
            rows[1].amount_cents, -123_450,
            "thousands separator survives"
        );
        assert_eq!(errors.len(), 1, "an unreadable cost is named, not dropped");
        assert!(errors[0].contains("Broken row"));
    }

    #[test]
    fn rejects_a_file_that_is_not_a_splitwise_export() {
        let (rows, errors) = parse_splitwise("a,b,c\n1,2,3\n");
        assert!(rows.is_empty());
        assert!(errors[0].contains("Splitwise"));
    }

    #[test]
    fn parses_german_decimal_comma_and_empty_currency() {
        let (rows, errors) = parse_splitwise(
            "Date,Description,Category,Cost,Currency\n2026-09-01,Bahn,Transport,\"12,50\",\n",
        );
        assert!(errors.is_empty());
        assert_eq!(rows[0].amount_cents, -1250);
        assert_eq!(rows[0].currency, "EUR");
    }

    #[test]
    fn importing_the_same_export_twice_creates_no_duplicates() {
        let c = fixture();
        let first = import_on(&c, EXPORT).unwrap();
        assert_eq!(first.imported, 2);
        assert_eq!(first.skipped_duplicates, 0);
        let second = import_on(&c, EXPORT).unwrap();
        assert_eq!(second.imported, 0);
        assert_eq!(
            second.skipped_duplicates, 2,
            "a second upload changes nothing"
        );
        assert_eq!(list_entries_on(&c, None, None).unwrap().len(), 2);
    }

    #[test]
    fn a_manual_entry_never_collides_with_another_manual_entry() {
        let c = fixture();
        let entry = FinanceEntry {
            id: String::new(),
            entry_date: "2026-08-04".into(),
            description: "Notar".into(),
            category: "Gründung & Setup".into(),
            amount_cents: -52_000,
            currency: "EUR".into(),
            source: "manual".into(),
            external_id: None,
        };
        create_entry_on(&c, entry.clone()).unwrap();
        create_entry_on(&c, entry).unwrap();
        assert_eq!(list_entries_on(&c, None, None).unwrap().len(), 2);
    }

    #[test]
    fn entries_are_listed_inside_the_asked_range_only() {
        let c = fixture();
        import_on(&c, EXPORT).unwrap();
        let august =
            list_entries_on(&c, Some("2026-08-05".into()), Some("2026-08-31".into())).unwrap();
        assert_eq!(august.len(), 1);
        assert_eq!(august[0].description, "Dinner, with clients");
    }

    #[test]
    fn update_and_delete_touch_exactly_one_entry() {
        let c = fixture();
        import_on(&c, EXPORT).unwrap();
        let mut entry = list_entries_on(&c, None, None).unwrap().pop().unwrap();
        entry.category = "Reisekosten".into();
        let saved = update_entry_on(&c, entry.clone()).unwrap();
        assert_eq!(saved.category, "Reisekosten");
        assert_eq!(
            saved.source, "splitwise",
            "an edit cannot rewrite the origin"
        );
        delete_entry_on(&c, &saved.id).unwrap();
        assert_eq!(list_entries_on(&c, None, None).unwrap().len(), 1);
        assert_eq!(
            delete_entry_on(&c, &saved.id),
            Err("Entry not found".to_string())
        );
    }

    fn plan_row(category: &str, item: &str, month: &str, cents: i64) -> FinancePlanRow {
        FinancePlanRow {
            id: String::new(),
            category: category.into(),
            item: item.into(),
            month: month.into(),
            planned_cents: cents,
            kind: String::new(),
            optional: false,
            estimated: false,
            assumption: None,
            source_file: String::new(),
            source_block: String::new(),
            source_detail: String::new(),
        }
    }

    #[test]
    fn the_plan_holds_one_number_per_category_item_and_month() {
        let c = fixture();
        let row = plan_row("Reisekosten", "Reisen mit Bjarne", "2026-09", -25_000);
        upsert_plan_on(&c, row.clone()).unwrap();
        let corrected = upsert_plan_on(
            &c,
            FinancePlanRow {
                planned_cents: -30_000,
                ..row
            },
        )
        .unwrap();
        assert_eq!(corrected.planned_cents, -30_000);
        assert_eq!(
            list_plan_on(&c).unwrap().len(),
            1,
            "a correction is not a second row"
        );
        // A SECOND position in the same category and month is its own row.
        upsert_plan_on(
            &c,
            plan_row("Reisekosten", "Reisen Sep–Okt", "2026-09", -12_000),
        )
        .unwrap();
        assert_eq!(list_plan_on(&c).unwrap().len(), 2);
        assert!(upsert_plan_on(&c, plan_row("X", "Y", "2026/09", 0)).is_err());
    }

    /// A plan file with INVENTED numbers. No real figure of any company belongs in
    /// this source tree; the shape is what the tests are about.
    fn sample_plan(overwrite: bool) -> String {
        format!(
            r#"{{
              "version": 1,
              "currency": "EUR",
              "overwrite": {overwrite},
              "positions": [
                {{
                  "category": "Beispielkosten",
                  "position": "Beispielposten A",
                  "kind": "cost",
                  "optional": false,
                  "estimated": true,
                  "assumption": "Monat nicht im Dokument; hier angenommen.",
                  "source": "beispiel.html",
                  "source_block": "Block A",
                  "source_detail": "Zeile 1",
                  "months": {{ "2026-08": -1000, "2026-09": -2000 }}
                }},
                {{
                  "category": "Beispielkosten",
                  "position": "Beispielposten B",
                  "kind": "cost",
                  "optional": true,
                  "estimated": false,
                  "assumption": null,
                  "source": "beispiel.html",
                  "months": {{ "2026-08": -500 }}
                }},
                {{
                  "category": "Beispielumsatz",
                  "position": "Beispielerlös",
                  "kind": "revenue",
                  "optional": false,
                  "estimated": false,
                  "months": {{ "2026-09": 7000 }}
                }}
              ]
            }}"#
        )
    }

    #[test]
    fn importing_the_same_plan_twice_changes_nothing() {
        let c = fixture();
        let first = import_plan_on(&c, &sample_plan(false)).unwrap();
        assert_eq!((first.inserted, first.updated, first.skipped), (4, 0, 0));
        assert_eq!(first.positions, 3);
        assert_eq!(first.categories, 2);
        assert!(first.errors.is_empty());
        let second = import_plan_on(&c, &sample_plan(false)).unwrap();
        assert_eq!(
            (second.inserted, second.updated, second.skipped),
            (0, 0, 4),
            "a second import writes nothing"
        );
        assert_eq!(list_plan_on(&c).unwrap().len(), 4);
    }

    /// A hand-corrected number is the owner's, not the file's — and the refusal is
    /// REPORTED, never silent.
    #[test]
    fn a_corrected_plan_cell_is_skipped_not_overwritten() {
        let c = fixture();
        import_plan_on(&c, &sample_plan(false)).unwrap();
        upsert_plan_on(
            &c,
            plan_row("Beispielkosten", "Beispielposten A", "2026-08", -1_234),
        )
        .unwrap();
        let again = import_plan_on(&c, &sample_plan(false)).unwrap();
        assert_eq!(again.updated, 0);
        assert_eq!(again.skipped, 4, "all four cells stay as they are");
        let cell = |c: &Connection| -> i64 {
            list_plan_on(c)
                .unwrap()
                .into_iter()
                .find(|r| r.item == "Beispielposten A" && r.month == "2026-08")
                .unwrap()
                .planned_cents
        };
        assert_eq!(cell(&c), -1_234, "the correction survives");
        // …unless the file explicitly asks to overwrite.
        let forced = import_plan_on(&c, &sample_plan(true)).unwrap();
        assert_eq!(forced.updated, 1);
        assert_eq!(forced.skipped, 3);
        assert_eq!(cell(&c), -1_000);
    }

    /// The flags, the assumption and the provenance are the DOCUMENT speaking: they
    /// catch up on every import, and a corrected AMOUNT is not touched while they do.
    #[test]
    fn the_document_flags_catch_up_without_touching_amounts() {
        let c = fixture();
        import_plan_on(&c, &sample_plan(false)).unwrap();
        c.execute(
            "UPDATE finance_plan SET optional=0, estimated=0, assumption=NULL, planned_cents=-4_242 \
             WHERE item='Beispielposten B'",
            [],
        )
        .unwrap();
        import_plan_on(&c, &sample_plan(false)).unwrap();
        let row = list_plan_on(&c)
            .unwrap()
            .into_iter()
            .find(|r| r.item == "Beispielposten B")
            .expect("the position is still there");
        assert!(row.optional, "the file calls this position optional");
        assert_eq!(row.source_file, "beispiel.html");
        assert_eq!(row.planned_cents, -4_242, "a corrected amount is not touched");
        let a = list_plan_on(&c)
            .unwrap()
            .into_iter()
            .find(|r| r.item == "Beispielposten A" && r.month == "2026-09")
            .unwrap();
        assert!(a.estimated);
        assert_eq!(
            a.assumption.as_deref(),
            Some("Monat nicht im Dokument; hier angenommen.")
        );
    }

    /// Kind is STATED by the file, never read off the sign, and an unknown kind is
    /// an error the import names instead of guessing at.
    #[test]
    fn the_import_states_its_kinds_and_names_what_it_could_not_read() {
        let c = fixture();
        import_plan_on(&c, &sample_plan(false)).unwrap();
        let rows = list_plan_on(&c).unwrap();
        assert!(rows
            .iter()
            .filter(|r| r.category == "Beispielkosten")
            .all(|r| r.kind == COST && r.planned_cents < 0));
        assert!(rows
            .iter()
            .filter(|r| r.category == "Beispielumsatz")
            .all(|r| r.kind == REVENUE && r.planned_cents > 0));
        let broken = r#"{"version":1,"positions":[
            {"category":"K","position":"P","kind":"spende","months":{"2026-08":-1}},
            {"category":"","position":"Ohne Block","months":{"2026-08":-1}},
            {"category":"K2","position":"P2","kind":"cost","months":{"2026/08":-1,"2026-08":-7}}
        ]}"#;
        let summary = import_plan_on(&c, broken).unwrap();
        assert_eq!(summary.errors.len(), 3, "each unreadable thing is named once");
        assert!(summary.errors.iter().any(|e| e.contains("spende")));
        assert!(summary.errors.iter().any(|e| e.contains("no category")));
        assert!(summary.errors.iter().any(|e| e.contains("2026/08")));
        assert_eq!(summary.inserted, 1, "the readable month still lands");
    }

    /// A file the module cannot stand behind is refused as a whole, with a sentence.
    #[test]
    fn an_unreadable_or_foreign_plan_file_is_refused() {
        let c = fixture();
        assert!(import_plan_on(&c, "not json at all").is_err());
        let future = import_plan_on(&c, r#"{"version":99,"positions":[]}"#);
        assert!(future.unwrap_err().contains("version 99"));
        assert!(list_plan_on(&c).unwrap().is_empty(), "nothing was written");
        // The alias still answers, and it invents nothing.
        let empty = SeedSummary::default();
        assert_eq!((empty.inserted, empty.kept, empty.categories), (0, 0, 0));
    }

    /// The one-level plan is not thrown away: it is archived, and its summary rows
    /// step aside for the named positions instead of double-counting them.
    #[test]
    fn the_old_one_level_plan_is_archived_not_lost() {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute_batch(
            "CREATE TABLE finance_plan (id TEXT PRIMARY KEY, category TEXT NOT NULL, month TEXT NOT NULL, planned_cents INTEGER NOT NULL, UNIQUE(category, month));
             INSERT INTO finance_plan(id,category,month,planned_cents) VALUES('old-1','Beispielkosten','2026-08',-9_100),('old-2','Eigene Zeile','2026-08',-4_200);",
        )
        .unwrap();
        ensure_schema(&c).unwrap();
        let migrated = list_plan_on(&c).unwrap();
        assert_eq!(migrated.len(), 2, "nothing is dropped by the rebuild");
        assert!(migrated.iter().all(|r| r.item.is_empty()));
        let summary = import_plan_on(&c, &sample_plan(false)).unwrap();
        assert_eq!(
            summary.replaced_summary_rows, 1,
            "only the imported category's summary steps aside"
        );
        let after = list_plan_on(&c).unwrap();
        assert!(
            after
                .iter()
                .any(|r| r.category == "Eigene Zeile" && r.planned_cents == -4_200),
            "a row of the owner's own stays"
        );
        assert!(!after
            .iter()
            .any(|r| r.category == "Beispielkosten" && r.item.is_empty()));
        let archived: i64 = c
            .query_row("SELECT COUNT(*) FROM finance_plan_legacy", [], |r| r.get(0))
            .unwrap();
        assert_eq!(archived, 2, "the old plan is readable after the migration");
    }

    /// A round trip the owner can trust: what goes in comes back out, cell for cell
    /// and flag for flag.
    #[test]
    fn a_plan_survives_export_and_reimport_unchanged() {
        let c = fixture();
        import_plan_on(&c, &sample_plan(false)).unwrap();
        let before = list_plan_on(&c).unwrap();
        c.execute("DELETE FROM finance_plan", []).unwrap();
        assert!(list_plan_on(&c).unwrap().is_empty());
        let again = import_plan_on(&c, &sample_plan(false)).unwrap();
        assert_eq!(again.inserted, before.len());
        let after = list_plan_on(&c).unwrap();
        assert_eq!(after.len(), before.len());
        for (a, b) in before.iter().zip(after.iter()) {
            assert_eq!(
                (
                    &a.category,
                    &a.item,
                    &a.month,
                    a.planned_cents,
                    &a.kind,
                    a.optional,
                    a.estimated,
                    &a.assumption
                ),
                (
                    &b.category,
                    &b.item,
                    &b.month,
                    b.planned_cents,
                    &b.kind,
                    b.optional,
                    b.estimated,
                    &b.assumption
                )
            );
        }
    }

    #[test]
    fn access_is_bootstrapped_from_the_named_people_and_reports_who_is_missing() {
        let c = fixture();
        let members = list_finance_access_on(&c).unwrap();
        let ids: Vec<&str> = members.iter().map(|m| m.profile_id.as_str()).collect();
        assert_eq!(ids, ["p-bjarne", "p-jannes", "p-pascal"]);
        assert!(!ids.contains(&"p-other"), "nobody else is let in");
        assert_eq!(
            missing_people(&c).unwrap(),
            vec!["Charles".to_string()],
            "a name without a profile is reported, not swallowed"
        );
    }

    #[test]
    fn the_gate_refuses_a_profile_without_a_row_and_admits_one_with() {
        let c = fixture();
        assert!(has_access(&c, "p-pascal").unwrap());
        assert!(!has_access(&c, "p-other").unwrap());
        grant_on(&c, "p-other").unwrap();
        assert!(has_access(&c, "p-other").unwrap());
        assert_eq!(grant_on(&c, "ghost"), Err("No such person".to_string()));
        revoke_on(&c, "p-other").unwrap();
        assert!(!has_access(&c, "p-other").unwrap());
        assert_eq!(
            revoke_on(&c, "p-other"),
            Err("That person has no finance access".to_string())
        );
    }

    #[test]
    fn the_last_owner_cannot_lock_everybody_out() {
        let c = fixture();
        revoke_on(&c, "p-bjarne").unwrap();
        revoke_on(&c, "p-jannes").unwrap();
        assert_eq!(
            revoke_on(&c, "p-pascal"),
            Err("The last finance owner cannot be removed".to_string())
        );
    }

    #[test]
    fn a_second_bootstrap_never_restores_a_revoked_owner() {
        let c = fixture();
        revoke_on(&c, "p-bjarne").unwrap();
        ensure_schema(&c).unwrap();
        let ids: Vec<String> = list_finance_access_on(&c)
            .unwrap()
            .into_iter()
            .map(|m| m.profile_id)
            .collect();
        assert!(!ids.contains(&"p-bjarne".to_string()));
    }
}
