//! Personal productivity, organization availability, notifications, and Goto search.
use crate::{db, meetings};
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{kind}-{nanos:x}-{:x}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}
fn err<T>(result: rusqlite::Result<T>) -> Result<T> { result.map_err(|error| error.to_string()) }

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Todo {
    pub id: String,
    pub profile_id: String,
    pub content: String,
    pub due_date: Option<String>,
    pub done: bool,
    pub source_entity_type: Option<String>,
    pub source_entity_id: Option<String>,
    /// Optional local-only project this personal task is filed under. NULL keeps it personal.
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
}
#[derive(Debug, Deserialize)]
pub struct TodoInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub content: String,
    pub due_date: Option<String>,
    pub done: bool,
    pub source_entity_type: Option<String>,
    pub source_entity_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
}
fn read_todo(row: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo { id: row.get(0)?, profile_id: row.get(1)?, content: row.get(2)?, due_date: row.get(3)?, done: row.get(4)?, source_entity_type: row.get(5)?, source_entity_id: row.get(6)?, project_id: row.get(7)?, assignee_ids: Vec::new() })
}
/// Empty or whitespace-only project ids collapse to NULL (personal, unassigned).
fn normalize_project(project_id: &Option<String>) -> Option<String> {
    project_id.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}
fn valid_anchor(entity_type: &Option<String>, entity_id: &Option<String>) -> Result<()> {
    if entity_type.is_some() != entity_id.is_some() { return Err("Todo and notification anchors require both entity type and entity ID".into()); }
    Ok(())
}
/// Distinct, trimmed, non-empty assignee profile ids, order preserved.
fn clean_assignees(ids: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        let id = id.trim();
        if id.is_empty() || out.iter().any(|existing| existing == id) { continue; }
        out.push(id.to_string());
    }
    out
}
fn assignees_on(c: &Connection, todo_id: &str) -> Result<Vec<String>> {
    let mut statement = err(c.prepare("SELECT profile_id FROM todo_assignees WHERE todo_id=?1 ORDER BY profile_id"))?;
    let ids = err(statement.query_map([todo_id], |row| row.get::<_, String>(0)))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(ids)
}
/// An assignee must be a live profile; if that profile is backed by login accounts,
/// at least one of them must still be active. Deactivated people cannot be assigned.
fn assignee_is_active(c: &Connection, profile_id: &str) -> Result<bool> {
    let profile_live: bool = err(c.query_row("SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1 AND archived=0)", [profile_id], |row| row.get(0)))?;
    if !profile_live { return Ok(false); }
    let accounts: i64 = err(c.query_row("SELECT count(*) FROM users WHERE profile_id=?1", [profile_id], |row| row.get(0)))?;
    if accounts == 0 { return Ok(true); }
    let active: i64 = err(c.query_row("SELECT count(*) FROM users WHERE profile_id=?1 AND active=1", [profile_id], |row| row.get(0)))?;
    Ok(active > 0)
}
/// Caller must run this inside a transaction: validation and rewrite are one atomic unit,
/// so one invalid assignee rolls the whole todo write back.
fn replace_assignees(c: &Connection, todo_id: &str, ids: &[String]) -> Result<()> {
    let ids = clean_assignees(ids);
    for pid in &ids {
        if !assignee_is_active(c, pid)? { return Err(format!("Assignee profile is not active: {pid}")); }
    }
    err(c.execute("DELETE FROM todo_assignees WHERE todo_id=?1", [todo_id]))?;
    for pid in &ids {
        err(c.execute("INSERT OR IGNORE INTO todo_assignees(todo_id,profile_id) VALUES(?1,?2)", params![todo_id, pid]))?;
    }
    Ok(())
}
/// Owner profile of a todo, for authorization at the HTTP layer.
pub fn todo_owner(id: &str) -> Result<Option<String>> {
    let c = db::conn()?;
    err(c.query_row("SELECT profile_id FROM todos WHERE id=?1", [id], |row| row.get::<_, String>(0)).optional())
}
/// True when the profile owns the todo or is assigned to it (read policy).
pub fn todo_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    err(c.query_row("SELECT EXISTS(SELECT 1 FROM todos t LEFT JOIN todo_assignees a ON a.todo_id=t.id WHERE t.id=?1 AND (t.profile_id=?2 OR a.profile_id=?2))", params![id, profile_id], |row| row.get(0)))
}
fn todo_on(c: &Connection, id: &str) -> Result<Option<Todo>> {
    let todo = err(c.query_row("SELECT id,profile_id,content,due_date,done,source_entity_type,source_entity_id,project_id FROM todos WHERE id=?1", [id], read_todo).optional())?;
    match todo {
        Some(mut todo) => { todo.assignee_ids = assignees_on(c, id)?; Ok(Some(todo)) }
        None => Ok(None),
    }
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_todos( profile_id: String, include_done: Option<bool>) -> Result<Vec<Todo>> {
    let c = db::conn()?;
    // Owned by the profile OR assigned to it.
    let mut statement = err(c.prepare("SELECT DISTINCT t.id,t.profile_id,t.content,t.due_date,t.done,t.source_entity_type,t.source_entity_id,t.project_id FROM todos t LEFT JOIN todo_assignees a ON a.todo_id=t.id WHERE (t.profile_id=?1 OR a.profile_id=?1) AND (?2=1 OR t.done=0) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at"))?;
    let mut todos = err(statement.query_map(params![profile_id, include_done.unwrap_or(false)], read_todo))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(statement);
    for todo in todos.iter_mut() { todo.assignee_ids = assignees_on(&c, &todo.id)?; }
    Ok(todos)
}
/// Every todo filed under a project — the Project → Work feed. Desktop's trusted
/// local command supplies no reader; web supplies the authenticated profile and is
/// restricted to tasks it owns or is assigned.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_project_todos(project_id: String, include_done: Option<bool>, readable_by: Option<String>) -> Result<Vec<Todo>> {
    let c = db::conn()?;
    list_project_todos_on(&c, &project_id, include_done.unwrap_or(false), readable_by.as_deref())
}
fn list_project_todos_on(c: &Connection, project_id: &str, include_done: bool, readable_by: Option<&str>) -> Result<Vec<Todo>> {
    if project_id.trim().is_empty() { return Ok(Vec::new()); }
    let mut statement = err(c.prepare("SELECT DISTINCT t.id,t.profile_id,t.content,t.due_date,t.done,t.source_entity_type,t.source_entity_id,t.project_id FROM todos t LEFT JOIN todo_assignees a ON a.todo_id=t.id WHERE t.project_id=?1 AND (?2=1 OR t.done=0) AND (?3 IS NULL OR t.profile_id=?3 OR a.profile_id=?3) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at"))?;
    let mut todos = err(statement.query_map(params![project_id, include_done, readable_by], read_todo))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(statement);
    for todo in todos.iter_mut() { todo.assignee_ids = assignees_on(c, &todo.id)?; }
    Ok(todos)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_todo( input: TodoInput) -> Result<Todo> {
    let mut c = db::conn()?;
    create_todo_on(&mut c, input)
}
/// Todo row and its assignee rows are written in one transaction: an invalid or inactive
/// assignee rolls back the todo itself.
fn create_todo_on(c: &mut Connection, input: TodoInput) -> Result<Todo> {
    if input.profile_id.trim().is_empty() || input.content.trim().is_empty() { return Err("Todo profile and content are required".into()); }
    valid_anchor(&input.source_entity_type, &input.source_entity_id)?;
    let id = input.id.unwrap_or_else(|| new_id("todo"));
    let project_id = normalize_project(&input.project_id);
    let tx = err(c.transaction())?;
    err(tx.execute("INSERT INTO todos(id,profile_id,content,due_date,done,source_entity_type,source_entity_id,project_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![id, input.profile_id, input.content.trim(), input.due_date, input.done, input.source_entity_type, input.source_entity_id, project_id]))?;
    replace_assignees(&tx, &id, &input.assignee_ids)?;
    err(tx.commit())?;
    todo_on(c, &id)?.ok_or_else(|| "Created todo was not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_todo( todo: Todo) -> Result<Todo> {
    let mut c = db::conn()?;
    update_todo_on(&mut c, todo)
}
fn update_todo_on(c: &mut Connection, todo: Todo) -> Result<Todo> {
    if todo.profile_id.trim().is_empty() || todo.content.trim().is_empty() { return Err("Todo profile and content are required".into()); }
    valid_anchor(&todo.source_entity_type, &todo.source_entity_id)?;
    let project_id = normalize_project(&todo.project_id);
    let tx = err(c.transaction())?;
    let updated = err(tx.execute("UPDATE todos SET profile_id=?2,content=?3,due_date=?4,done=?5,source_entity_type=?6,source_entity_id=?7,project_id=?8,updated_at=unixepoch() WHERE id=?1", params![todo.id, todo.profile_id, todo.content.trim(), todo.due_date, todo.done, todo.source_entity_type, todo.source_entity_id, project_id]))?;
    if updated == 0 { return Err("Todo not found".into()); }
    replace_assignees(&tx, &todo.id, &todo.assignee_ids)?;
    err(tx.commit())?;
    todo_on(c, &todo.id)?.ok_or_else(|| "Todo not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_todo( id: String) -> Result<()> {
    let mut c = db::conn()?;
    delete_todo_on(&mut c, id)
}
fn delete_todo_on(c: &mut Connection, id: String) -> Result<()> {
    let tx = err(c.transaction())?;
    err(tx.execute("DELETE FROM todo_assignees WHERE todo_id=?1", [&id]))?;
    if err(tx.execute("DELETE FROM todos WHERE id=?1", [id]))? == 0 { return Err("Todo not found".into()); }
    err(tx.commit())?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Absence { pub id: String, pub profile_id: String, pub reason_type: String, pub date_from: String, pub date_to: String, pub approved: bool }
#[derive(Debug, Deserialize)]
pub struct AbsenceInput { pub id: Option<String>, pub profile_id: String, pub reason_type: String, pub date_from: String, pub date_to: String, pub approved: bool }
fn read_absence(row: &rusqlite::Row<'_>) -> rusqlite::Result<Absence> { Ok(Absence { id: row.get(0)?, profile_id: row.get(1)?, reason_type: row.get(2)?, date_from: row.get(3)?, date_to: row.get(4)?, approved: row.get(5)? }) }
fn validate_absence(absence: &Absence) -> Result<()> {
    if absence.profile_id.trim().is_empty() || absence.reason_type.trim().is_empty() || absence.date_from.is_empty() || absence.date_to.is_empty() { return Err("Absence profile, reason, and dates are required".into()); }
    if absence.date_to < absence.date_from { return Err("Absence end date must not precede its start date".into()); }
    Ok(())
}
fn absence_on(c: &Connection, id: &str) -> Result<Option<Absence>> { err(c.query_row("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE id=?1", [id], read_absence).optional()) }
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_absences( profile_id: Option<String>) -> Result<Vec<Absence>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE (?1 IS NULL OR profile_id=?1) ORDER BY date_from DESC,date_to DESC"))?;
    let absences = err(statement.query_map([profile_id], read_absence))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(absences)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_absence( input: AbsenceInput) -> Result<Absence> {
    let absence = Absence { id: input.id.unwrap_or_else(|| new_id("absence")), profile_id: input.profile_id, reason_type: input.reason_type, date_from: input.date_from, date_to: input.date_to, approved: input.approved };
    validate_absence(&absence)?;
    let c = db::conn()?;
    err(c.execute("INSERT INTO absences(id,profile_id,reason_type,date_from,date_to,approved) VALUES(?1,?2,?3,?4,?5,?6)", params![absence.id, absence.profile_id, absence.reason_type, absence.date_from, absence.date_to, absence.approved]))?;
    absence_on(&c, &absence.id)?.ok_or_else(|| "Created absence was not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_absence( absence: Absence) -> Result<Absence> {
    validate_absence(&absence)?;
    let c = db::conn()?;
    if err(c.execute("UPDATE absences SET profile_id=?2,reason_type=?3,date_from=?4,date_to=?5,approved=?6 WHERE id=?1", params![absence.id, absence.profile_id, absence.reason_type, absence.date_from, absence.date_to, absence.approved]))? == 0 { return Err("Absence not found".into()); }
    absence_on(&c, &absence.id)?.ok_or_else(|| "Absence not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_absence( id: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute("DELETE FROM absences WHERE id=?1", [id]))? == 0 { return Err("Absence not found".into()); }
    Ok(())
}
fn current_absences_on(c: &Connection, date: &str) -> Result<Vec<Absence>> {
    let mut statement = err(c.prepare("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE approved=1 AND date_from<=?1 AND date_to>=?1 ORDER BY date_from,profile_id"))?;
    let absences = err(statement.query_map([date], read_absence))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(absences)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn current_absences( date: String) -> Result<Vec<Absence>> { current_absences_on(&db::conn()?, &date) }

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Notification { pub id: String, pub recipient_id: String, pub event_type: String, pub title: String, pub body: Option<String>, pub entity_type: Option<String>, pub entity_id: Option<String>, pub created_at: i64, pub read_at: Option<i64> }
#[derive(Debug, Deserialize)]
pub struct NotificationInput { pub id: Option<String>, pub recipient_id: String, pub event_type: String, pub title: String, pub body: Option<String>, pub entity_type: Option<String>, pub entity_id: Option<String> }
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SubscriptionSetting { pub profile_id: String, pub event_type: String, pub enabled: bool }
fn read_notification(row: &rusqlite::Row<'_>) -> rusqlite::Result<Notification> { Ok(Notification { id: row.get(0)?, recipient_id: row.get(1)?, event_type: row.get(2)?, title: row.get(3)?, body: row.get(4)?, entity_type: row.get(5)?, entity_id: row.get(6)?, created_at: row.get(7)?, read_at: row.get(8)? }) }
fn emit_notification_on(c: &Connection, input: &NotificationInput) -> Result<Option<Notification>> {
    if input.recipient_id.trim().is_empty() || input.event_type.trim().is_empty() || input.title.trim().is_empty() { return Err("Notification recipient, event type, and title are required".into()); }
    valid_anchor(&input.entity_type, &input.entity_id)?;
    let enabled: bool = err(c.query_row("SELECT coalesce((SELECT enabled FROM subscription_settings WHERE profile_id=?1 AND event_type=?2),1)", params![input.recipient_id, input.event_type], |row| row.get(0)))?;
    if !enabled { return Ok(None); }
    let id = input.id.clone().unwrap_or_else(|| new_id("notification"));
    err(c.execute("INSERT INTO notifications(id,recipient_id,event_type,title,body,entity_type,entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![id, input.recipient_id, input.event_type, input.title.trim(), input.body, input.entity_type, input.entity_id]))?;
    let notification = err(c.query_row("SELECT id,recipient_id,event_type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE id=?1", [id], read_notification))?;
    Ok(Some(notification))
}
/// Emits an event into a personal notification feed unless its subscription is disabled.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn emit_notification( input: NotificationInput) -> Result<Option<Notification>> { emit_notification_on(&db::conn()?, &input) }
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_notifications( recipient_id: String, unread_only: Option<bool>) -> Result<Vec<Notification>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT id,recipient_id,event_type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE recipient_id=?1 AND (?2=0 OR read_at IS NULL) ORDER BY created_at DESC"))?;
    let notifications = err(statement.query_map(params![recipient_id, unread_only.unwrap_or(false)], read_notification))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(notifications)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn mark_notification_read( id: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute("UPDATE notifications SET read_at=unixepoch() WHERE id=?1", [id]))? == 0 { return Err("Notification not found".into()); }
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_subscription_settings( profile_id: String) -> Result<Vec<SubscriptionSetting>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT profile_id,event_type,enabled FROM subscription_settings WHERE profile_id=?1 ORDER BY event_type"))?;
    let settings = err(statement.query_map([profile_id], |row| Ok(SubscriptionSetting { profile_id: row.get(0)?, event_type: row.get(1)?, enabled: row.get(2)? })))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(settings)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_subscription_setting( setting: SubscriptionSetting) -> Result<SubscriptionSetting> {
    if setting.profile_id.trim().is_empty() || setting.event_type.trim().is_empty() { return Err("Subscription profile and event type are required".into()); }
    let c = db::conn()?;
    err(c.execute("INSERT INTO subscription_settings(profile_id,event_type,enabled) VALUES(?1,?2,?3) ON CONFLICT(profile_id,event_type) DO UPDATE SET enabled=excluded.enabled", params![setting.profile_id, setting.event_type, setting.enabled]))?;
    Ok(setting)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_subscription_setting( profile_id: String, event_type: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute("DELETE FROM subscription_settings WHERE profile_id=?1 AND event_type=?2", params![profile_id, event_type]))? == 0 { return Err("Subscription setting not found".into()); }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct GotoResult { pub id: String, pub entity_type: String, pub title: String, pub details: Option<String>, pub score: i64 }
fn goto_search_on(c: &Connection, query: &str, limit: i64) -> Result<Vec<GotoResult>> {
    let term = query.trim();
    if term.is_empty() { return Ok(Vec::new()); }
    let pattern = format!("%{}%", term.to_lowercase());
    let exact = term.to_lowercase();
    let mut statement = err(c.prepare("SELECT id,entity_type,title,details,score FROM (
      SELECT id,'profile' entity_type,display_name title,username details,CASE WHEN lower(display_name)=?2 THEN 100 ELSE 50 END score FROM profiles WHERE lower(display_name) LIKE ?1 OR lower(username) LIKE ?1
      UNION ALL SELECT id,'project',name,key,CASE WHEN lower(name)=?2 OR lower(key)=?2 THEN 100 ELSE 50 END FROM projects WHERE archived=0 AND (lower(name) LIKE ?1 OR lower(key) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
      UNION ALL SELECT id,'issue',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM issues WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
      UNION ALL SELECT id,'channel',coalesce(name,''),description,CASE WHEN lower(coalesce(name,''))=?2 THEN 100 ELSE 40 END FROM channels WHERE archived=0 AND (lower(coalesce(name,'')) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
      UNION ALL SELECT id,'document',title,container_type,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM documents WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(body,'')) LIKE ?1)
      UNION ALL SELECT id,'review',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM reviews WHERE lower(title) LIKE ?1
      UNION ALL SELECT id,'meeting',title,location,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM meetings WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
    ) ORDER BY score DESC,title COLLATE NOCASE LIMIT ?3"))?;
    let results = err(statement.query_map(params![pattern, exact, limit.clamp(1, 100)], |row| Ok(GotoResult { id: row.get(0)?, entity_type: row.get(1)?, title: row.get(2)?, details: row.get(3)?, score: row.get(4)? })))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(results)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn goto_search( query: String, limit: Option<i64>) -> Result<Vec<GotoResult>> { goto_search_on(&db::conn()?, &query, limit.unwrap_or(30)) }

#[derive(Clone, Debug, Serialize)]
pub struct AssignedIssue { pub id: String, pub title: String, pub project_id: String, pub number: i64, pub due_date: Option<String> }
#[derive(Clone, Debug, Serialize)]
pub struct Dashboard { pub open_todos: Vec<Todo>, pub assigned_issues: Vec<AssignedIssue>, pub meeting_occurrences: Vec<meetings::MeetingOccurrence>, pub unread_notifications: Vec<Notification>, pub current_absences: Vec<Absence> }
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn dashboard_aggregate( profile_id: String) -> Result<Dashboard> {
    if profile_id.trim().is_empty() { return Err("Dashboard profile is required".into()); }
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.due_date FROM issues i LEFT JOIN issue_statuses s ON s.id=i.status_id WHERE i.assignee_id=?1 AND i.archived=0 AND coalesce(s.resolved,0)=0 ORDER BY i.due_date IS NULL,i.due_date,i.number"))?;
    let assigned_issues = err(statement.query_map([&profile_id], |row| Ok(AssignedIssue { id: row.get(0)?, project_id: row.get(1)?, number: row.get(2)?, title: row.get(3)?, due_date: row.get(4)? })))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    let now = Utc::now();
    let today = now.date_naive().to_string();
    let end = now + Duration::days(7);
    Ok(Dashboard { open_todos: list_todos(profile_id.clone(), Some(false))?, assigned_issues, meeting_occurrences: meetings::expand_meeting_occurrences(now.timestamp(), end.timestamp())?, unread_notifications: list_notifications(profile_id, Some(true))?, current_absences: current_absences_on(&c, &today)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> Connection {
        let c = db::open_in_memory().unwrap();
        c.execute_batch(crate::db::SCHEMA_V1).unwrap();
        c.execute_batch(crate::db::SCHEMA_V2).unwrap();
        c.execute_batch(crate::db::SCHEMA_V3).unwrap();
        c.execute_batch(crate::db::SCHEMA_V4).unwrap();
        crate::db::migrate_v6(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1),('q','other','Other',1),('r','third','Third',1)", []).unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_at) VALUES('proj','Project','PRJ',1),('proj2','Other Project','PRJ2',1)", []).unwrap();
        c
    }
    // Mirror of list_todos SQL against a raw Connection for unit testing without an AppHandle.
    fn list_todos_on(c: &Connection, profile_id: &str, include_done: bool) -> Vec<Todo> {
        let mut statement = c.prepare("SELECT DISTINCT t.id,t.profile_id,t.content,t.due_date,t.done,t.source_entity_type,t.source_entity_id,t.project_id FROM todos t LEFT JOIN todo_assignees a ON a.todo_id=t.id WHERE (t.profile_id=?1 OR a.profile_id=?1) AND (?2=1 OR t.done=0) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at").unwrap();
        let mut todos: Vec<Todo> = statement.query_map(params![profile_id, include_done], read_todo).unwrap().map(|t| t.unwrap()).collect();
        drop(statement);
        for todo in todos.iter_mut() { todo.assignee_ids = assignees_on(c, &todo.id).unwrap(); }
        todos
    }
    fn todo_input(id: &str, owner: &str, assignees: &[&str]) -> TodoInput {
        TodoInput { id: Some(id.into()), profile_id: owner.into(), content: "Task".into(), due_date: None, done: false, source_entity_type: None, source_entity_id: None, project_id: None, assignee_ids: assignees.iter().map(|x| x.to_string()).collect() }
    }
    #[test]
    fn project_association_persists_and_feeds_project_work() {
        let mut c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        // Create with a project, blank-and-whitespace ids collapse to NULL (personal).
        let mut with_project = todo_input("tp", "p", &["q"]);
        with_project.project_id = Some("proj".into());
        let created = create_todo_on(&mut c, with_project).unwrap();
        assert_eq!(created.project_id.as_deref(), Some("proj"));
        let mut personal = todo_input("tn", "p", &[]);
        personal.project_id = Some("   ".into());
        assert_eq!(create_todo_on(&mut c, personal).unwrap().project_id, None, "blank project stays personal");
        // Assignees preserved alongside the project association.
        assert_eq!(created.assignee_ids, vec!["q".to_string()]);
        // Project → Work sees only the project-filed task, both owner and assignee still see it in My tasks.
        let work: Vec<String> = list_project_todos_on(&c, "proj", true, None).unwrap().iter().map(|t| t.id.clone()).collect();
        assert_eq!(work, vec!["tp".to_string()]);
        assert!(list_project_todos_on(&c, "proj2", true, None).unwrap().is_empty());
        assert!(list_todos_on(&c, "p", true).iter().any(|t| t.id == "tp" && t.id != "only"));
        assert!(list_todos_on(&c, "q", true).iter().any(|t| t.id == "tp"), "assignee retains the task in My tasks");
        // Change the project, then remove it — personal again, still owned, no data loss.
        let mut moved = created.clone();
        moved.project_id = Some("proj2".into());
        assert_eq!(update_todo_on(&mut c, moved).unwrap().project_id.as_deref(), Some("proj2"));
        let mut cleared = todo_on(&c, "tp").unwrap().unwrap();
        cleared.project_id = None;
        assert_eq!(update_todo_on(&mut c, cleared).unwrap().project_id, None);
        assert!(list_project_todos_on(&c, "proj2", true, None).unwrap().is_empty(), "removing project clears it from Work");
        assert!(list_todos_on(&c, "p", true).iter().any(|t| t.id == "tp"), "still a personal task after removal");
        // A dangling project id is refused by the foreign key.
        let mut bad = todo_input("tb", "p", &[]);
        bad.project_id = Some("ghost".into());
        assert!(create_todo_on(&mut c, bad).is_err(), "unknown project must fail");
    }
    #[test]
    fn invalid_assignee_rolls_back_the_whole_todo_write() {
        let mut c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        // Unknown profile: nothing at all is persisted.
        let failed = create_todo_on(&mut c, todo_input("t1", "p", &["q", "ghost"]));
        assert!(failed.is_err(), "unknown assignee must fail");
        let todos: i64 = c.query_row("SELECT count(*) FROM todos", [], |r| r.get(0)).unwrap();
        let links: i64 = c.query_row("SELECT count(*) FROM todo_assignees", [], |r| r.get(0)).unwrap();
        assert_eq!((todos, links), (0, 0), "create must roll back entirely");
        // Deactivated account: also rejected.
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-r','third','x','Third','r','member',0,1)", []).unwrap();
        assert!(create_todo_on(&mut c, todo_input("t2", "p", &["r"])).is_err(), "inactive assignee must fail");
        assert_eq!(c.query_row::<i64, _, _>("SELECT count(*) FROM todos", [], |r| r.get(0)).unwrap(), 0);
        // Valid write survives, then a bad update leaves the prior state untouched.
        let created = create_todo_on(&mut c, todo_input("t3", "p", &["q"])).unwrap();
        assert_eq!(created.assignee_ids, vec!["q".to_string()]);
        let mut bad = created.clone();
        bad.content = "Changed".into();
        bad.assignee_ids = vec!["ghost".into()];
        assert!(update_todo_on(&mut c, bad).is_err());
        let after = todo_on(&c, "t3").unwrap().unwrap();
        assert_eq!(after.content, "Task");
        assert_eq!(after.assignee_ids, vec!["q".to_string()]);
    }
    #[test]
    fn deleting_a_todo_leaves_no_orphan_assignee_rows() {
        let mut c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        create_todo_on(&mut c, todo_input("t1", "p", &["q", "r"])).unwrap();
        assert_eq!(c.query_row::<i64, _, _>("SELECT count(*) FROM todo_assignees WHERE todo_id='t1'", [], |r| r.get(0)).unwrap(), 2);
        delete_todo_on(&mut c, "t1".into()).unwrap();
        assert_eq!(c.query_row::<i64, _, _>("SELECT count(*) FROM todo_assignees", [], |r| r.get(0)).unwrap(), 0, "junction rows must not outlive the todo");
        // Independent path: a raw parent delete is refused/cascaded by foreign keys, never orphaned.
        create_todo_on(&mut c, todo_input("t2", "p", &["q"])).unwrap();
        c.execute("DELETE FROM todos WHERE id='t2'", []).unwrap();
        assert_eq!(c.query_row::<i64, _, _>("SELECT count(*) FROM todo_assignees", [], |r| r.get(0)).unwrap(), 0, "ON DELETE CASCADE must be enforced");
    }
    #[test]
    fn multi_assignee_roundtrip_and_visibility() {
        let c = conn();
        // Owner 'p', assigned to 'q' and 'r'.
        c.execute("INSERT INTO todos(id,profile_id,content) VALUES('t1','p','Shared task')", []).unwrap();
        replace_assignees(&c, "t1", &["q".into(), "r".into(), "q".into(), " ".into()]).unwrap();
        // Owner 'q', no assignees.
        c.execute("INSERT INTO todos(id,profile_id,content) VALUES('t2','q','Q private task')", []).unwrap();
        // Roundtrip: distinct, blank-stripped.
        let t1 = todo_on(&c, "t1").unwrap().unwrap();
        assert_eq!(t1.assignee_ids, vec!["q".to_string(), "r".to_string()]);
        // Visibility: owner sees own todo.
        assert!(list_todos_on(&c, "p", true).iter().any(|t| t.id == "t1"));
        // Visibility: assignee 'r' sees t1 though not the owner, and not t2.
        let for_r = list_todos_on(&c, "r", true);
        assert_eq!(for_r.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t1"]);
        // 'q' sees both owned t2 and assigned t1, deduped.
        let mut for_q: Vec<String> = list_todos_on(&c, "q", true).iter().map(|t| t.id.clone()).collect();
        for_q.sort();
        assert_eq!(for_q, vec!["t1".to_string(), "t2".to_string()]);
        // Reassign clears prior links.
        replace_assignees(&c, "t1", &["r".into()]).unwrap();
        assert_eq!(assignees_on(&c, "t1").unwrap(), vec!["r".to_string()]);
        assert!(!list_todos_on(&c, "q", true).iter().any(|t| t.id == "t1"));
    }
    #[test]
    fn todo_anchor_roundtrips() {
        let c = conn();
        c.execute("INSERT INTO todos(id,profile_id,content,source_entity_type,source_entity_id) VALUES('todo','p','Read review','review','r-1')", []).unwrap();
        let todo = todo_on(&c, "todo").unwrap().unwrap();
        assert_eq!(todo.source_entity_type.as_deref(), Some("review"));
        assert_eq!(todo.source_entity_id.as_deref(), Some("r-1"));
    }
    #[test]
    fn disabled_subscription_suppresses_emit() {
        let c = conn();
        c.execute("INSERT INTO subscription_settings(profile_id,event_type,enabled) VALUES('p','absence.created',0)", []).unwrap();
        let result = emit_notification_on(&c, &NotificationInput { id: None, recipient_id: "p".into(), event_type: "absence.created".into(), title: "Absent".into(), body: None, entity_type: None, entity_id: None }).unwrap();
        assert!(result.is_none());
        assert_eq!(c.query_row("SELECT count(*) FROM notifications", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
    #[test]
    fn goto_search_hits_three_entity_types() {
        let c = conn();
        c.execute("INSERT INTO projects(id,name,key,created_at) VALUES('project','Search alpha','SEA',1)", []).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived) VALUES('issue','project',1,'Search issue',0)", []).unwrap();
        c.execute("INSERT INTO channels(id,content_type,name,archived) VALUES('channel','public','Search channel',0)", []).unwrap();
        let results = goto_search_on(&c, "search", 20).unwrap();
        assert!(results.iter().any(|result| result.entity_type == "project"));
        assert!(results.iter().any(|result| result.entity_type == "issue"));
        assert!(results.iter().any(|result| result.entity_type == "channel"));
    }
    #[test]
    fn current_absences_require_approval_and_date_overlap() {
        let c = conn();
        c.execute("INSERT INTO absences(id,profile_id,reason_type,date_from,date_to,approved) VALUES('approved','p','Vacation','2026-07-20','2026-07-30',1),('pending','p','Sick','2026-07-20','2026-07-30',0)", []).unwrap();
        assert_eq!(current_absences_on(&c, "2026-07-26").unwrap().iter().map(|absence| absence.id.as_str()).collect::<Vec<_>>(), vec!["approved"]);
    }
}
