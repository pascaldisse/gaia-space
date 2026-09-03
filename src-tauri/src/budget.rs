//! Shared budget ledgers stored as versioned document bodies. All monetary values are cents.
use crate::documents;
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

type Result<T> = std::result::Result<T, String>;

pub const KIND_BUDGET: &str = "budget";
pub const DEFAULT_BUDGET_CURRENCY: &str = "EUR";
pub const BUDGET_COLUMNS: [(&str, &str, &str); 5] = [
    ("date", "Date", "date"),
    ("paid_by", "Paid by", "person"),
    ("amount", "Amount", "number"),
    ("description", "Description", "text"),
    ("split", "Split among", "text"),
];
const MAX_CURRENCY_LEN: usize = 3;
const MAX_AMOUNT_FRACTION_DIGITS: usize = 2;
const ROW_ID_PREFIX: &str = "r_";

#[derive(Clone, Debug, Deserialize)]
pub struct BudgetExpenseInput {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub paid_by: Option<String>,
    pub amount: String,
    pub description: String,
    #[serde(default)]
    pub split: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BudgetMemberStatement {
    pub profile_id: String,
    pub name: String,
    pub paid_cents: i64,
    pub share_cents: i64,
    pub net_cents: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BudgetTransfer {
    pub from: String,
    pub to: String,
    pub cents: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BudgetStatement {
    pub month: Option<String>,
    pub currency: String,
    pub total_cents: i64,
    pub members: Vec<BudgetMemberStatement>,
    pub transfers: Vec<BudgetTransfer>,
    pub rows_counted: usize,
}

fn parse_cents(raw: &str) -> Result<i64> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('-') || raw.starts_with('+') {
        return Err("amount must be a positive decimal amount".into());
    }
    let mut pieces = raw.split('.');
    let whole = pieces.next().unwrap_or_default();
    let fraction = pieces.next();
    if pieces.next().is_some()
        || whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.is_some_and(|part| {
            part.is_empty()
                || part.len() > MAX_AMOUNT_FRACTION_DIGITS
                || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err("amount must be a decimal with at most two fraction digits".into());
    }
    let whole_cents = whole
        .parse::<i64>()
        .map_err(|_| "amount is too large".to_string())?
        .checked_mul(100)
        .ok_or_else(|| "amount is too large".to_string())?;
    let fraction_cents = match fraction.unwrap_or_default().len() {
        0 => 0,
        1 => {
            fraction
                .unwrap()
                .parse::<i64>()
                .map_err(|_| "invalid amount".to_string())?
                * 10
        }
        _ => fraction
            .unwrap()
            .parse::<i64>()
            .map_err(|_| "invalid amount".to_string())?,
    };
    let cents = whole_cents
        .checked_add(fraction_cents)
        .ok_or_else(|| "amount is too large".to_string())?;
    if cents <= 0 {
        Err("amount must be greater than zero".into())
    } else {
        Ok(cents)
    }
}

fn split_ids(raw: &str, members: &[String]) -> Result<Vec<String>> {
    if raw.trim().is_empty() {
        return Ok(members.to_vec());
    }
    let ids: Vec<String> = raw.split(',').map(|id| id.trim().to_string()).collect();
    if ids.iter().any(String::is_empty) || ids.iter().any(|id| !members.contains(id)) {
        return Err("every split member must belong to budget members".into());
    }
    if ids.len() != ids.iter().collect::<std::collections::BTreeSet<_>>().len() {
        return Err("split members must be distinct".into());
    }
    Ok(ids)
}

fn rows_and_members<'a>(body: &'a Value) -> Result<(&'a [Value], Vec<String>)> {
    let members = body
        .get("members")
        .and_then(Value::as_array)
        .ok_or_else(|| "budget body needs members".to_string())?
        .iter()
        .map(|member| {
            member
                .as_str()
                .map(str::to_string)
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| "budget members must be non-empty strings".to_string())
        })
        .collect::<Result<Vec<_>>>()?;
    if members.is_empty()
        || members.len()
            != members
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
    {
        return Err("budget members must be non-empty and distinct".into());
    }
    let rows = body
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| "budget body needs rows".to_string())?;
    Ok((rows, members))
}

fn cells(row: &Value) -> Result<&Map<String, Value>> {
    row.get("cells")
        .and_then(Value::as_object)
        .ok_or_else(|| "every budget row needs cells".to_string())
}
fn cell<'a>(cells: &'a Map<String, Value>, id: &str) -> Result<&'a str> {
    cells
        .get(id)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("budget row needs string cell '{id}'"))
}

/// Validates the immutable envelope and the grid values that carry settlement meaning.
pub fn validate_budget_body(body: &str) -> Result<()> {
    let value: Value =
        serde_json::from_str(body).map_err(|e| format!("budget body is not valid JSON: {e}"))?;
    let currency = value
        .get("currency")
        .and_then(Value::as_str)
        .ok_or_else(|| "budget body needs currency".to_string())?;
    if currency.len() != MAX_CURRENCY_LEN || !currency.bytes().all(|byte| byte.is_ascii_uppercase())
    {
        return Err("budget currency must be three uppercase letters".into());
    }
    let (rows, members) = rows_and_members(&value)?;
    let columns = value
        .get("columns")
        .and_then(Value::as_array)
        .ok_or_else(|| "budget body needs columns".to_string())?;
    if columns.len() < BUDGET_COLUMNS.len() {
        return Err("budget body needs the five fixed columns".into());
    }
    for (column, (id, label, kind)) in columns.iter().zip(BUDGET_COLUMNS) {
        if column.get("id").and_then(Value::as_str) != Some(id)
            || column.get("label").and_then(Value::as_str) != Some(label)
            || column.get("type").and_then(Value::as_str) != Some(kind)
        {
            return Err("budget fixed columns must be present in their required order".into());
        }
    }
    let mut row_ids = std::collections::BTreeSet::new();
    for row in rows {
        let row_id = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "every budget row needs a non-empty id".to_string())?;
        if !row_ids.insert(row_id) {
            return Err(format!("duplicate budget row id '{row_id}'"));
        }
        let cells = cells(row)?;
        let paid_by = cell(cells, "paid_by")?;
        if !members.iter().any(|member| member == paid_by) {
            return Err("paid_by must belong to budget members".into());
        }
        parse_cents(cell(cells, "amount")?)?;
        split_ids(cell(cells, "split")?, &members)?;
        cell(cells, "date")?;
        cell(cells, "description")?;
    }
    Ok(())
}

fn statement_on(
    c: &Connection,
    document_id: &str,
    month: Option<String>,
) -> Result<BudgetStatement> {
    if month.as_deref().is_some_and(|month| !valid_month(month)) {
        return Err("month must be YYYY-MM".into());
    }
    let (title, body, kind): (String, String, String) = c
        .query_row(
            "SELECT title,coalesce(body,''),kind FROM documents WHERE id=?1",
            [document_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "budget document not found".to_string())?;
    let _ = title;
    if kind != KIND_BUDGET {
        return Err("document is not a budget".into());
    }
    validate_budget_body(&body)?;
    let value: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let currency = value["currency"].as_str().unwrap_or_default().to_string();
    let (rows, member_ids) = rows_and_members(&value)?;
    let mut paid = vec![0_i64; member_ids.len()];
    let mut share = vec![0_i64; member_ids.len()];
    let mut total_cents = 0_i64;
    let mut rows_counted = 0_usize;
    for row in rows {
        let cells = cells(row)?;
        let date = cell(cells, "date")?;
        if month
            .as_deref()
            .is_some_and(|month| !date.starts_with(month))
        {
            continue;
        }
        let cents = parse_cents(cell(cells, "amount")?)?;
        let payer = cell(cells, "paid_by")?;
        let payer_index = member_ids
            .iter()
            .position(|member| member == payer)
            .ok_or_else(|| "paid_by must belong to budget members".to_string())?;
        let split = split_ids(cell(cells, "split")?, &member_ids)?;
        let base = cents / split.len() as i64;
        let remainder = cents % split.len() as i64;
        paid[payer_index] += cents;
        total_cents += cents;
        rows_counted += 1;
        for (index, member) in member_ids.iter().enumerate() {
            if let Some(split_index) = split.iter().position(|id| id == member) {
                share[index] += base + i64::from(split_index < remainder as usize);
            }
        }
    }
    let names = member_ids.iter().map(|id| c.query_row("SELECT coalesce(nullif(display_name,''),nullif(username,''),id) FROM profiles WHERE id=?1", [id], |row| row.get::<_, String>(0)).optional().map_err(|e| e.to_string()).map(|name| name.unwrap_or_else(|| id.clone()))).collect::<Result<Vec<_>>>()?;
    let mut members = Vec::with_capacity(member_ids.len());
    for (index, profile_id) in member_ids.iter().enumerate() {
        members.push(BudgetMemberStatement {
            profile_id: profile_id.clone(),
            name: names[index].clone(),
            paid_cents: paid[index],
            share_cents: share[index],
            net_cents: paid[index] - share[index],
        });
    }
    let mut credit_left: Vec<i64> = members
        .iter()
        .map(|member| member.net_cents.max(0))
        .collect();
    let mut debt_left: Vec<i64> = members
        .iter()
        .map(|member| (-member.net_cents).max(0))
        .collect();
    let largest = |values: &[i64]| {
        values
            .iter()
            .enumerate()
            .filter(|(_, cents)| **cents > 0)
            .max_by(|(left_index, left), (right_index, right)| {
                left.cmp(right).then_with(|| right_index.cmp(left_index))
            })
            .map(|(index, _)| index)
    };
    let mut transfers = Vec::new();
    while let (Some(creditor), Some(debtor)) = (largest(&credit_left), largest(&debt_left)) {
        let cents = credit_left[creditor].min(debt_left[debtor]);
        transfers.push(BudgetTransfer {
            from: members[debtor].profile_id.clone(),
            to: members[creditor].profile_id.clone(),
            cents,
        });
        credit_left[creditor] -= cents;
        debt_left[debtor] -= cents;
    }
    Ok(BudgetStatement {
        month,
        currency,
        total_cents,
        members,
        transfers,
        rows_counted,
    })
}

fn valid_month(month: &str) -> bool {
    month.len() == 7
        && month.as_bytes()[4] == b'-'
        && month[..4].bytes().all(|byte| byte.is_ascii_digit())
        && month[5..].bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn budget_statement(
    document_id: String,
    month: Option<String>,
    profile_id: Option<String>,
) -> Result<BudgetStatement> {
    let c = documents::document_connection()?;
    if let Some(profile_id) = profile_id {
        if !documents::document_readable_by_on(&c, &document_id, &profile_id)? {
            return Err("document access denied".into());
        }
    }
    statement_on(&c, &document_id, month)
}

fn default_actor(c: &Connection, document_id: &str) -> Result<String> {
    c.query_row(
        "SELECT coalesce(created_by,'') FROM documents WHERE id=?1",
        [document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| "budget document not found".to_string())
    .and_then(|actor| {
        if actor.is_empty() {
            Err("paid_by is required when the document has no creator".into())
        } else {
            Ok(actor)
        }
    })
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn budget_add_expense(
    document_id: String,
    input: BudgetExpenseInput,
    actor: Option<String>,
) -> Result<documents::Document> {
    let mut c = documents::document_connection()?;
    let actor = actor.unwrap_or(default_actor(&c, &document_id)?);
    add_expense_on(&mut c, &document_id, input, &actor)
}

fn add_expense_on(
    c: &mut Connection,
    document_id: &str,
    input: BudgetExpenseInput,
    actor: &str,
) -> Result<documents::Document> {
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let body: String = tx
        .query_row(
            "SELECT coalesce(body,'') FROM documents WHERE id=?1 AND kind=?2",
            rusqlite::params![document_id, KIND_BUDGET],
            |row| row.get(0),
        )
        .map_err(|_| "budget document not found".to_string())?;
    let mut value: Value =
        serde_json::from_str(&body).map_err(|e| format!("budget body is not valid JSON: {e}"))?;
    let members = rows_and_members(&value)?.1;
    let paid_by = input.paid_by.unwrap_or_else(|| actor.to_string());
    if !members.contains(&paid_by) {
        return Err("paid_by must belong to budget members".into());
    }
    parse_cents(&input.amount)?;
    let split = input.split.unwrap_or_default();
    if split.iter().any(|id| !members.contains(id))
        || split.len()
            != split
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
    {
        return Err("every split member must belong to budget members".into());
    }
    let rows = value
        .get_mut("rows")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "budget body needs rows".to_string())?;
    let row_id = format!(
        "{ROW_ID_PREFIX}{}{}",
        Utc::now().timestamp_micros(),
        rows.len()
    );
    rows.push(json!({"id": row_id, "cells": {
        "date": input.date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string()),
        "paid_by": paid_by, "amount": input.amount,
        "description": input.description, "split": split.join(",")
    }}));
    let next = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    validate_budget_body(&next)?;
    let title: String = tx
        .query_row(
            "SELECT title FROM documents WHERE id=?1",
            [document_id],
            |row| row.get(0),
        )
        .map_err(|_| "budget document not found".to_string())?;
    let (doc, _kind) = documents::save_document_tx(
        &tx,
        document_id,
        &title,
        Some(next),
        Some(actor.to_string()),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    documents::document_updated_event(&doc);
    Ok(doc)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn budget_export_statement(
    document_id: String,
    month: String,
    profile_id: Option<String>,
) -> Result<String> {
    if !valid_month(&month) {
        return Err("month must be YYYY-MM".into());
    }
    let c = documents::document_connection()?;
    if let Some(profile_id) = profile_id {
        if !documents::document_writable_by_on(&c, &document_id, &profile_id, false)? {
            return Err("document write denied".into());
        }
    }
    let statement = statement_on(&c, &document_id, Some(month.clone()))?;
    let (title, container_type, container_id, folder_id, created_by): (String, String, Option<String>, Option<String>, Option<String>) = c.query_row("SELECT title,container_type,container_id,folder_id,created_by FROM documents WHERE id=?1", [&document_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))).map_err(|_| "budget document not found".to_string())?;
    let mut markdown =
        String::from("| Member | Paid | Share | Net |\n| --- | ---: | ---: | ---: |\n");
    for member in &statement.members {
        markdown.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            member.name, member.paid_cents, member.share_cents, member.net_cents
        ));
    }
    markdown.push_str("\n## Who owes whom\n\n");
    if statement.transfers.is_empty() {
        markdown.push_str("No transfers.\n");
    }
    for transfer in &statement.transfers {
        markdown.push_str(&format!(
            "- {} owes {} {} {}\n",
            transfer.from, transfer.to, transfer.cents, statement.currency
        ));
    }
    let exported_id = format!("budget-statement-{}", Utc::now().timestamp_micros());
    documents::create_document(documents::Document {
        id: exported_id.clone(),
        container_type,
        container_id,
        folder_id,
        doc_type: "text".into(),
        body_format: "text".into(),
        kind: documents::KIND_MARKDOWN.into(),
        title: format!("{title} — {month} statement"),
        body: Some(markdown),
        version: 1,
        archived: false,
        created_by,
        source_entity_type: None,
        source_entity_id: None,
    })?;
    Ok(exported_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn body(members: &[&str], rows: &[(&str, &str, &str, &str, &str)]) -> String {
        json!({
            "currency": "EUR", "members": members,
            "columns": BUDGET_COLUMNS.iter().map(|(id,label,kind)| json!({"id":id,"label":label,"type":kind})).collect::<Vec<_>>(),
            "rows": rows.iter().enumerate().map(|(index, (date, paid_by, amount, description, split))| json!({"id":format!("r_{index}"),"cells":{"date":date,"paid_by":paid_by,"amount":amount,"description":description,"split":split}})).collect::<Vec<_>>()
        }).to_string()
    }
    fn fixture(rows: &[(&str, &str, &str, &str, &str)]) -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute(
            "ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'markdown'",
            [],
        )
        .ok();
        c.execute(
            "ALTER TABLE documents ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text'",
            [],
        )
        .ok();
        c.execute_batch("INSERT INTO profiles(id,username,display_name,created_at) VALUES
            ('ada','ada','Ada',1),('bea','bea','Bea',1),('cid','cid','Cid',1),('dan','dan','Dan',1),('eve','eve','Eve',1),('outsider','outsider','Outsider',1);") .unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,body_format,title,body,version,archived,created_by,kind) VALUES('budget','my-docs','ada','text','text','Trip',?1,1,0,'ada','budget')", [body(&["ada","bea","cid","dan","eve"], rows)]).unwrap();
        c
    }
    fn member<'a>(statement: &'a BudgetStatement, id: &str) -> &'a BudgetMemberStatement {
        statement
            .members
            .iter()
            .find(|member| member.profile_id == id)
            .unwrap()
    }

    #[test]
    fn rounding_remainder_goes_to_first_member_order() {
        let c = fixture(&[]);
        c.execute(
            "UPDATE documents SET body=?1 WHERE id='budget'",
            [body(
                &["ada", "bea", "cid"],
                &[("2026-09-01", "ada", "10.00", "Dinner", "")],
            )],
        )
        .unwrap();
        let s = statement_on(&c, "budget", None).unwrap();
        assert_eq!(
            (
                member(&s, "ada").share_cents,
                member(&s, "bea").share_cents,
                member(&s, "cid").share_cents
            ),
            (334, 333, 333)
        );
    }
    #[test]
    fn empty_split_means_every_member() {
        let c = fixture(&[("2026-09-01", "ada", "5.00", "Coffee", "")]);
        let s = statement_on(&c, "budget", None).unwrap();
        assert_eq!(
            s.members
                .iter()
                .map(|member| member.share_cents)
                .sum::<i64>(),
            500
        );
        assert!(s.members.iter().all(|member| member.share_cents == 100));
    }
    #[test]
    fn explicit_subset_split_is_respected() {
        let c = fixture(&[("2026-09-01", "ada", "9.00", "Taxi", "bea,cid")]);
        let s = statement_on(&c, "budget", None).unwrap();
        assert_eq!(member(&s, "bea").share_cents, 450);
        assert_eq!(member(&s, "cid").share_cents, 450);
        assert_eq!(member(&s, "ada").share_cents, 0);
    }
    #[test]
    fn month_filter_counts_only_requested_month() {
        let c = fixture(&[
            ("2026-08-30", "ada", "1.00", "Old", ""),
            ("2026-09-01", "bea", "2.00", "New", ""),
        ]);
        let s = statement_on(&c, "budget", Some("2026-09".into())).unwrap();
        assert_eq!((s.total_cents, s.rows_counted), (200, 1));
    }
    #[test]
    fn simplification_preserves_each_member_net_and_uses_at_most_n_minus_one_transfers() {
        let c = fixture(&[
            ("2026-09-01", "ada", "10.01", "A", ""),
            ("2026-09-02", "bea", "8.02", "B", "ada,cid,dan"),
            ("2026-09-03", "cid", "7.03", "C", "bea,eve"),
            ("2026-09-04", "dan", "6.04", "D", "ada,eve"),
        ]);
        let s = statement_on(&c, "budget", None).unwrap();
        assert!(s.transfers.len() <= s.members.len() - 1);
        for member in &s.members {
            let transferred: i64 = s
                .transfers
                .iter()
                .map(|transfer| {
                    if transfer.from == member.profile_id {
                        transfer.cents
                    } else if transfer.to == member.profile_id {
                        -transfer.cents
                    } else {
                        0
                    }
                })
                .sum();
            assert_eq!(transferred, -member.net_cents, "{}", member.profile_id);
        }
    }
    #[test]
    fn settled_budget_has_no_transfers() {
        let c = fixture(&[
            ("2026-09-01", "ada", "5.00", "A", "ada"),
            ("2026-09-01", "bea", "5.00", "B", "bea"),
        ]);
        assert!(statement_on(&c, "budget", None)
            .unwrap()
            .transfers
            .is_empty());
    }
    #[test]
    fn invalid_amount_is_refused_without_float_coercion() {
        for amount in ["0", "1.234", "-1.00", "1e2"] {
            assert!(parse_cents(amount).is_err(), "{amount}");
        }
    }
    #[test]
    fn paid_by_outside_members_is_refused() {
        let bad = body(&["ada"], &[("2026-09-01", "outsider", "1.00", "Bad", "")]);
        assert!(validate_budget_body(&bad).is_err());
    }
    #[test]
    fn add_expense_defaults_date_payer_and_all_members() {
        let mut c = fixture(&[]);
        let doc = add_expense_on(
            &mut c,
            "budget",
            BudgetExpenseInput {
                date: None,
                paid_by: None,
                amount: "2.50".into(),
                description: "Tea".into(),
                split: None,
            },
            "ada",
        )
        .unwrap();
        let value: Value = serde_json::from_str(doc.body.as_deref().unwrap()).unwrap();
        let cells = &value["rows"][0]["cells"];
        assert_eq!(cells["paid_by"], "ada");
        assert_eq!(cells["split"], "");
        assert_eq!(cells["date"].as_str().unwrap().len(), 10);
    }
    #[test]
    fn sequential_adds_append_two_rows_and_two_versions() {
        let mut c = fixture(&[]);
        for description in ["One", "Two"] {
            add_expense_on(
                &mut c,
                "budget",
                BudgetExpenseInput {
                    date: Some("2026-09-01".into()),
                    paid_by: None,
                    amount: "1.00".into(),
                    description: description.into(),
                    split: None,
                },
                "ada",
            )
            .unwrap();
        }
        let (version, body): (i64, String) = c
            .query_row(
                "SELECT version,body FROM documents WHERE id='budget'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(version, 3);
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap()["rows"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            c.query_row::<i64, _, _>(
                "SELECT count(*) FROM doc_versions WHERE document_id='budget'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            2
        );
    }
    #[test]
    fn budget_requires_fixed_columns_in_order() {
        let mut value: Value = serde_json::from_str(&body(&["ada"], &[])).unwrap();
        value["columns"].as_array_mut().unwrap().swap(0, 1);
        assert!(validate_budget_body(&value.to_string()).is_err());
    }
    #[test]
    fn split_member_outside_members_is_refused() {
        let bad = body(
            &["ada"],
            &[("2026-09-01", "ada", "1.00", "Bad", "outsider")],
        );
        assert!(validate_budget_body(&bad).is_err());
    }
    #[test]
    fn statement_refuses_a_non_readable_document() {
        let c = fixture(&[]);
        assert!(!documents::document_readable_by_on(&c, "budget", "outsider").unwrap());
        assert_eq!(statement_on(&c, "budget", None).unwrap().currency, "EUR");
    }
    #[test]
    fn export_markdown_uses_the_budget_folder_and_month_title() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("budget-export");
        let c = db::migrate_path(&temp).unwrap();
        c.execute(
            "ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'markdown'",
            [],
        )
        .ok();
        c.execute(
            "ALTER TABLE documents ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text'",
            [],
        )
        .ok();
        c.execute_batch("INSERT INTO profiles(id,username,display_name,created_at) VALUES('ada','ada','Ada',1); INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES('folder','my-docs','ada',NULL,'Folder');").unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,body_format,title,body,version,archived,created_by,kind) VALUES('budget','my-docs','ada','folder','text','text','Trip',?1,1,0,'ada','budget')", [body(&["ada"], &[("2026-09-01","ada","2.00","Tea","")])]).unwrap();
        let previous = std::env::var_os("SPACE_DB");
        std::env::set_var("SPACE_DB", temp.path());
        let exported =
            budget_export_statement("budget".into(), "2026-09".into(), Some("ada".into())).unwrap();
        if let Some(previous) = previous {
            std::env::set_var("SPACE_DB", previous);
        } else {
            std::env::remove_var("SPACE_DB");
        }
        let (folder_id, title, kind): (Option<String>, String, String) = c
            .query_row(
                "SELECT folder_id,title,kind FROM documents WHERE id=?1",
                [&exported],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (folder_id.as_deref(), title.as_str(), kind.as_str()),
            (Some("folder"), "Trip — 2026-09 statement", "markdown")
        );
    }
}
