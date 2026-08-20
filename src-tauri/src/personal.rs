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
    pub project_id: Option<String>,
    pub done: bool,
    pub source_entity_type: Option<String>,
    pub source_entity_id: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
}
#[derive(Debug, Deserialize)]
pub struct TodoInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub content: String,
    pub due_date: Option<String>,
    pub project_id: Option<String>,
    pub done: bool,
    pub source_entity_type: Option<String>,
    pub source_entity_id: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
}
fn read_todo(row: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo { id: row.get(0)?, profile_id: row.get(1)?, content: row.get(2)?, due_date: row.get(3)?, project_id: row.get(4)?, done: row.get(5)?, source_entity_type: row.get(6)?, source_entity_id: row.get(7)?, assignee_ids: Vec::new() })
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
fn normalized_project_id(project_id: Option<String>) -> Option<String> {
    project_id.and_then(|id| (!id.trim().is_empty()).then(|| id.trim().to_string()))
}
fn project_member_on(c: &Connection, project_id: &str, profile_id: &str) -> Result<bool> {
    err(c.query_row("SELECT EXISTS(SELECT 1 FROM projects p WHERE p.id=?1 AND (p.created_by=?2 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?2)))", params![project_id, profile_id], |row| row.get(0)))
}
pub fn project_member_by(project_id: &str, profile_id: &str) -> Result<bool> {
    project_member_on(&db::conn()?, project_id, profile_id)
}
/// Caller must run this inside a transaction: validation and rewrite are one atomic unit,
/// so one invalid assignee rolls the whole todo write back.
fn replace_assignees(c: &Connection, todo_id: &str, project_id: Option<&str>, ids: &[String]) -> Result<()> {
    let ids = clean_assignees(ids);
    if project_id.is_none() && !ids.is_empty() { return Err("assignment requires a project todo".into()); }
    for pid in &ids {
        if !assignee_is_active(c, pid)? { return Err(format!("Assignee profile is not active: {pid}")); }
        if !project_member_on(c, project_id.expect("non-empty assignees require project"), pid)? { return Err(format!("Assignee must be a project member: {pid}")); }
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
/// Group todos are readable by their owner, project members, and assignees. Personal
/// todos stay owner-only, including legacy personal rows that still have assignees.
pub fn todo_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    err(c.query_row("SELECT EXISTS(SELECT 1 FROM todos t WHERE t.id=?1 AND (t.profile_id=?2 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?2 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?2))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?2)))))", params![id, profile_id], |row| row.get(0)))
}
pub fn todo_assigned_by(id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    err(c.query_row("SELECT EXISTS(SELECT 1 FROM todos t JOIN todo_assignees a ON a.todo_id=t.id WHERE t.id=?1 AND t.project_id IS NOT NULL AND a.profile_id=?2)", params![id, profile_id], |row| row.get(0)))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn project_member_ids(project_id: String) -> Result<Vec<String>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT profile_id FROM (SELECT created_by AS profile_id FROM projects WHERE id=?1 AND created_by IS NOT NULL UNION SELECT profile_id FROM project_members WHERE project_id=?1) ORDER BY profile_id"))?;
    let ids = err(statement.query_map([project_id], |row| row.get::<_, String>(0)))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(ids)
}
fn todo_on(c: &Connection, id: &str) -> Result<Option<Todo>> {
    let todo = err(c.query_row("SELECT id,profile_id,content,due_date,project_id,done,source_entity_type,source_entity_id FROM todos WHERE id=?1", [id], read_todo).optional())?;
    match todo {
        Some(mut todo) => { todo.assignee_ids = assignees_on(c, id)?; Ok(Some(todo)) }
        None => Ok(None),
    }
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_todos( profile_id: String, include_done: Option<bool>) -> Result<Vec<Todo>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT t.id,t.profile_id,t.content,t.due_date,t.project_id,t.done,t.source_entity_type,t.source_entity_id FROM todos t WHERE (?2=1 OR t.done=0) AND (t.profile_id=?1 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?1)))) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at"))?;
    let mut todos = err(statement.query_map(params![profile_id, include_done.unwrap_or(false)], read_todo))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(statement);
    for todo in todos.iter_mut() { todo.assignee_ids = assignees_on(&c, &todo.id)?; }
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
    let project_id = normalized_project_id(input.project_id);
    let tx = err(c.transaction())?;
    err(tx.execute("INSERT INTO todos(id,profile_id,content,due_date,project_id,done,source_entity_type,source_entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![id, input.profile_id, input.content.trim(), input.due_date, project_id, input.done, input.source_entity_type, input.source_entity_id]))?;
    replace_assignees(&tx, &id, project_id.as_deref(), &input.assignee_ids)?;
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
    let project_id = normalized_project_id(todo.project_id.clone());
    let tx = err(c.transaction())?;
    let updated = err(tx.execute("UPDATE todos SET profile_id=?2,content=?3,due_date=?4,project_id=?5,done=?6,source_entity_type=?7,source_entity_id=?8,updated_at=unixepoch() WHERE id=?1", params![todo.id, todo.profile_id, todo.content.trim(), todo.due_date, project_id, todo.done, todo.source_entity_type, todo.source_entity_id]))?;
    if updated == 0 { return Err("Todo not found".into()); }
    replace_assignees(&tx, &todo.id, project_id.as_deref(), &todo.assignee_ids)?;
    err(tx.commit())?;
    todo_on(c, &todo.id)?.ok_or_else(|| "Todo not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_project_todos(project_id: String, profile_id: String, include_done: Option<bool>) -> Result<Vec<Todo>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT t.id,t.profile_id,t.content,t.due_date,t.project_id,t.done,t.source_entity_type,t.source_entity_id FROM todos t WHERE t.project_id=?1 AND (?3=1 OR t.done=0) AND (t.profile_id=?2 OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?2 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?2))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?2)) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at"))?;
    let mut todos = err(statement.query_map(params![project_id, profile_id, include_done.unwrap_or(false)], read_todo))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(statement);
    for todo in &mut todos { todo.assignee_ids = assignees_on(&c, &todo.id)?; }
    Ok(todos)
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
/// Dedicated completion-only command. Authorization lives in the web chokepoint;
/// this function never accepts a wider todo payload.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_todo_completion(id: String, done: bool) -> Result<Todo> {
    let mut c = db::conn()?;
    let tx = err(c.transaction())?;
    if err(tx.execute("UPDATE todos SET done=?2,updated_at=unixepoch() WHERE id=?1", params![id, done]))? == 0 { return Err("Todo not found".into()); }
    err(tx.commit())?;
    todo_on(&c, &id)?.ok_or_else(|| "Todo not found".into())
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
pub fn goto_search_scoped(query:String,limit:Option<i64>,profile_id:String)->Result<Vec<GotoResult>>{let term=query.trim();if term.is_empty(){return Ok(Vec::new());}let pattern=format!("%{}%",term.to_lowercase());let exact=term.to_lowercase();let c=db::conn()?;let mut s=err(c.prepare("SELECT id,entity_type,title,details,score FROM (
SELECT id,'profile' entity_type,display_name title,username details,CASE WHEN lower(display_name)=?2 THEN 100 ELSE 50 END score FROM profiles WHERE lower(display_name) LIKE ?1 OR lower(username) LIKE ?1
UNION ALL SELECT id,'project',name,key,CASE WHEN lower(name)=?2 OR lower(key)=?2 THEN 100 ELSE 50 END FROM projects WHERE archived=0 AND (lower(name) LIKE ?1 OR lower(key) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
UNION ALL SELECT id,'issue',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM issues WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
UNION ALL SELECT id,'channel',coalesce(name,''),description,CASE WHEN lower(coalesce(name,''))=?2 THEN 100 ELSE 40 END FROM channels WHERE archived=0 AND (lower(coalesce(name,'')) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
UNION ALL SELECT d.id,'document',d.title,d.container_type,CASE WHEN lower(d.title)=?2 THEN 100 ELSE 45 END FROM documents d WHERE d.archived=0 AND (lower(d.title) LIKE ?1 OR lower(coalesce(d.body,'')) LIKE ?1) AND (d.created_by=?3 OR (d.container_type='project' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND (p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3)))))
UNION ALL SELECT id,'review',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM reviews WHERE lower(title) LIKE ?1
UNION ALL SELECT m.id,'meeting',m.title,m.location,CASE WHEN lower(m.title)=?2 THEN 100 ELSE 45 END FROM meetings m WHERE m.archived=0 AND (lower(m.title) LIKE ?1 OR lower(coalesce(m.description,'')) LIKE ?1) AND (m.organizer_id=?3 OR EXISTS(SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.profile_id=?3) OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND (p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3))))
) ORDER BY score DESC,title COLLATE NOCASE LIMIT ?4"))?;let rows=err(s.query_map(params![pattern,exact,profile_id,limit.unwrap_or(30).clamp(1,100)],|r|Ok(GotoResult{id:r.get(0)?,entity_type:r.get(1)?,title:r.get(2)?,details:r.get(3)?,score:r.get(4)?})))?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e|e.to_string());rows}

#[derive(Clone, Debug, Serialize)]
pub struct CalendarItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub starts_at: i64,
    pub ends_at: Option<i64>,
    pub project_id: Option<String>,
    /// Present only for task/deadline date-only records; never deserialize it as an instant.
    pub date: Option<String>,
}
/// Calendar is derived from session-visible records only: own personal/group todos,
/// project-member or assignee group todos, organized/attended meetings, and owned projects.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn calendar_aggregate(profile_id: String, range_start: i64, range_end: i64) -> Result<Vec<CalendarItem>> {
    if profile_id.trim().is_empty() || range_end <= range_start { return Err("Calendar range and session profile are required".into()); }
    let c = db::conn()?;
    let mut items = Vec::new();
    let mut meetings = err(c.prepare("SELECT DISTINCT m.id,m.title,m.starts_at,m.ends_at FROM meetings m LEFT JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE m.archived=0 AND m.starts_at>=?1 AND m.starts_at<?2 AND (m.organizer_id=?3 OR mp.profile_id=?3 OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND (p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3))))"))?;
    for row in err(meetings.query_map(params![range_start, range_end, profile_id], |r| Ok(CalendarItem { id:r.get(0)?, kind:"meeting".into(), title:r.get(1)?, starts_at:r.get(2)?, ends_at:Some(r.get(3)?), project_id:None, date:None })))? { items.push(row.map_err(|e| e.to_string())?); }
    let mut todos = err(c.prepare("SELECT DISTINCT t.id,t.content,t.due_date,t.project_id FROM todos t WHERE t.done=0 AND t.due_date IS NOT NULL AND unixepoch(t.due_date)>=?1 AND unixepoch(t.due_date)<?2 AND (t.profile_id=?3 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?3))))"))?;
    for row in err(todos.query_map(params![range_start, range_end, profile_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?))))? { let (id,title,date,project_id)=row.map_err(|e|e.to_string())?; let starts_at=chrono::NaiveDate::parse_from_str(&date,"%Y-%m-%d").map_err(|_|"Invalid todo due date")?.and_hms_opt(0,0,0).unwrap().and_utc().timestamp(); items.push(CalendarItem{id,kind:"task".into(),title,starts_at,ends_at:None,project_id,date:Some(date)}); }
    let mut deadlines = err(c.prepare("SELECT id,name,deadline FROM projects WHERE archived=0 AND created_by=?1 AND deadline IS NOT NULL AND unixepoch(deadline)>=?2 AND unixepoch(deadline)<?3"))?;
    for row in err(deadlines.query_map(params![profile_id, range_start, range_end], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))))? { let (id,name,date)=row.map_err(|e|e.to_string())?; let starts_at=chrono::NaiveDate::parse_from_str(&date,"%Y-%m-%d").map_err(|_|"Invalid project deadline")?.and_hms_opt(0,0,0).unwrap().and_utc().timestamp(); items.push(CalendarItem{id:format!("deadline-{id}"),kind:"deadline".into(),title:format!("{name} deadline"),starts_at,ends_at:None,project_id:Some(id),date:Some(date)}); }
    items.sort_by_key(|item| item.starts_at);
    Ok(items)
}

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
    Ok(Dashboard { open_todos: list_todos(profile_id.clone(), Some(false))?, assigned_issues, meeting_occurrences: meetings::expand_meeting_occurrences_scoped(now.timestamp(), end.timestamp(), profile_id.clone())?, unread_notifications: list_notifications(profile_id, Some(true))?, current_absences: current_absences_on(&c, &today)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1),('q','other','Other',1),('r','third','Third',1)", []).unwrap();
        c.execute_batch("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('project','Project','PROJ','p',1); INSERT INTO project_members(project_id,profile_id) VALUES('project','q'),('project','r');").unwrap();
        c
    }
    // Mirror of list_todos SQL against a raw Connection for unit testing without an AppHandle.
    fn list_todos_on(c: &Connection, profile_id: &str, include_done: bool) -> Vec<Todo> {
        let mut statement = c.prepare("SELECT t.id,t.profile_id,t.content,t.due_date,t.project_id,t.done,t.source_entity_type,t.source_entity_id FROM todos t WHERE (?2=1 OR t.done=0) AND (t.profile_id=?1 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?1)))) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at").unwrap();
        let mut todos: Vec<Todo> = statement.query_map(params![profile_id, include_done], read_todo).unwrap().map(|t| t.unwrap()).collect();
        drop(statement);
        for todo in todos.iter_mut() { todo.assignee_ids = assignees_on(c, &todo.id).unwrap(); }
        todos
    }
    fn todo_input(id: &str, owner: &str, assignees: &[&str]) -> TodoInput {
        TodoInput { id: Some(id.into()), profile_id: owner.into(), content: "Task".into(), due_date: None, project_id: Some("project".into()), done: false, source_entity_type: None, source_entity_id: None, assignee_ids: assignees.iter().map(|x| x.to_string()).collect() }
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
    fn multi_assignee_roundtrip_keeps_personal_todos_owner_only() {
        let mut c = conn();
        // Owner 'p', assigned to 'q' and 'r'.
        c.execute("INSERT INTO todos(id,profile_id,content) VALUES('t1','p','Shared task')", []).unwrap();
        c.execute("INSERT INTO todo_assignees(todo_id,profile_id) VALUES('t1','q'),('t1','r')", []).unwrap();
        // Owner 'q', no assignees.
        c.execute("INSERT INTO todos(id,profile_id,content) VALUES('t2','q','Q private task')", []).unwrap();
        // Roundtrip: distinct, blank-stripped.
        let t1 = todo_on(&c, "t1").unwrap().unwrap();
        assert_eq!(t1.assignee_ids, vec!["q".to_string(), "r".to_string()]);
        // Visibility: owner sees own todo.
        assert!(list_todos_on(&c, "p", true).iter().any(|t| t.id == "t1"));
        // Assignees never gain read access to the owner's personal todo.
        assert!(list_todos_on(&c, "r", true).is_empty());
        assert_eq!(list_todos_on(&c, "q", true).iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t2"]);
        // Reassign clears prior links.
        // Legacy personal rows remain untouched/read-private, but their next write
        // must clear assignments or attach a project.
        let mut legacy = todo_on(&c, "t1").unwrap().unwrap();
        legacy.content = "Changed".into();
        assert!(update_todo_on(&mut c, legacy).unwrap_err().contains("assignment requires a project todo"));
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
        c.execute("INSERT INTO projects(id,name,key,created_at) VALUES('search-project','Search alpha','SEA',1)", []).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived) VALUES('issue','search-project',1,'Search issue',0)", []).unwrap();
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
