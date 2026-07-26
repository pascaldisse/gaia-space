//! Personal productivity, organization availability, notifications, and Goto search.
use crate::{db, meetings};
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;

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
}
fn read_todo(row: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo { id: row.get(0)?, profile_id: row.get(1)?, content: row.get(2)?, due_date: row.get(3)?, done: row.get(4)?, source_entity_type: row.get(5)?, source_entity_id: row.get(6)? })
}
fn valid_anchor(entity_type: &Option<String>, entity_id: &Option<String>) -> Result<()> {
    if entity_type.is_some() != entity_id.is_some() { return Err("Todo and notification anchors require both entity type and entity ID".into()); }
    Ok(())
}
fn todo_on(c: &Connection, id: &str) -> Result<Option<Todo>> {
    err(c.query_row("SELECT id,profile_id,content,due_date,done,source_entity_type,source_entity_id FROM todos WHERE id=?1", [id], read_todo).optional())
}
#[tauri::command]
pub fn list_todos(app: AppHandle, profile_id: String, include_done: Option<bool>) -> Result<Vec<Todo>> {
    let c = db::connection(&app)?;
    let mut statement = err(c.prepare("SELECT id,profile_id,content,due_date,done,source_entity_type,source_entity_id FROM todos WHERE profile_id=?1 AND (?2=1 OR done=0) ORDER BY done,due_date IS NULL,due_date,created_at"))?;
    let todos = err(statement.query_map(params![profile_id, include_done.unwrap_or(false)], read_todo))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(todos)
}
#[tauri::command]
pub fn create_todo(app: AppHandle, input: TodoInput) -> Result<Todo> {
    if input.profile_id.trim().is_empty() || input.content.trim().is_empty() { return Err("Todo profile and content are required".into()); }
    valid_anchor(&input.source_entity_type, &input.source_entity_id)?;
    let c = db::connection(&app)?;
    let id = input.id.unwrap_or_else(|| new_id("todo"));
    err(c.execute("INSERT INTO todos(id,profile_id,content,due_date,done,source_entity_type,source_entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![id, input.profile_id, input.content.trim(), input.due_date, input.done, input.source_entity_type, input.source_entity_id]))?;
    todo_on(&c, &id)?.ok_or_else(|| "Created todo was not found".into())
}
#[tauri::command]
pub fn update_todo(app: AppHandle, todo: Todo) -> Result<Todo> {
    if todo.profile_id.trim().is_empty() || todo.content.trim().is_empty() { return Err("Todo profile and content are required".into()); }
    valid_anchor(&todo.source_entity_type, &todo.source_entity_id)?;
    let c = db::connection(&app)?;
    let updated = err(c.execute("UPDATE todos SET profile_id=?2,content=?3,due_date=?4,done=?5,source_entity_type=?6,source_entity_id=?7,updated_at=unixepoch() WHERE id=?1", params![todo.id, todo.profile_id, todo.content.trim(), todo.due_date, todo.done, todo.source_entity_type, todo.source_entity_id]))?;
    if updated == 0 { return Err("Todo not found".into()); }
    todo_on(&c, &todo.id)?.ok_or_else(|| "Todo not found".into())
}
#[tauri::command]
pub fn delete_todo(app: AppHandle, id: String) -> Result<()> {
    let c = db::connection(&app)?;
    if err(c.execute("DELETE FROM todos WHERE id=?1", [id]))? == 0 { return Err("Todo not found".into()); }
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
#[tauri::command]
pub fn list_absences(app: AppHandle, profile_id: Option<String>) -> Result<Vec<Absence>> {
    let c = db::connection(&app)?;
    let mut statement = err(c.prepare("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE (?1 IS NULL OR profile_id=?1) ORDER BY date_from DESC,date_to DESC"))?;
    let absences = err(statement.query_map([profile_id], read_absence))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(absences)
}
#[tauri::command]
pub fn create_absence(app: AppHandle, input: AbsenceInput) -> Result<Absence> {
    let absence = Absence { id: input.id.unwrap_or_else(|| new_id("absence")), profile_id: input.profile_id, reason_type: input.reason_type, date_from: input.date_from, date_to: input.date_to, approved: input.approved };
    validate_absence(&absence)?;
    let c = db::connection(&app)?;
    err(c.execute("INSERT INTO absences(id,profile_id,reason_type,date_from,date_to,approved) VALUES(?1,?2,?3,?4,?5,?6)", params![absence.id, absence.profile_id, absence.reason_type, absence.date_from, absence.date_to, absence.approved]))?;
    absence_on(&c, &absence.id)?.ok_or_else(|| "Created absence was not found".into())
}
#[tauri::command]
pub fn update_absence(app: AppHandle, absence: Absence) -> Result<Absence> {
    validate_absence(&absence)?;
    let c = db::connection(&app)?;
    if err(c.execute("UPDATE absences SET profile_id=?2,reason_type=?3,date_from=?4,date_to=?5,approved=?6 WHERE id=?1", params![absence.id, absence.profile_id, absence.reason_type, absence.date_from, absence.date_to, absence.approved]))? == 0 { return Err("Absence not found".into()); }
    absence_on(&c, &absence.id)?.ok_or_else(|| "Absence not found".into())
}
#[tauri::command]
pub fn delete_absence(app: AppHandle, id: String) -> Result<()> {
    let c = db::connection(&app)?;
    if err(c.execute("DELETE FROM absences WHERE id=?1", [id]))? == 0 { return Err("Absence not found".into()); }
    Ok(())
}
fn current_absences_on(c: &Connection, date: &str) -> Result<Vec<Absence>> {
    let mut statement = err(c.prepare("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE approved=1 AND date_from<=?1 AND date_to>=?1 ORDER BY date_from,profile_id"))?;
    let absences = err(statement.query_map([date], read_absence))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(absences)
}
#[tauri::command]
pub fn current_absences(app: AppHandle, date: String) -> Result<Vec<Absence>> { current_absences_on(&db::connection(&app)?, &date) }

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
#[tauri::command]
pub fn emit_notification(app: AppHandle, input: NotificationInput) -> Result<Option<Notification>> { emit_notification_on(&db::connection(&app)?, &input) }
#[tauri::command]
pub fn list_notifications(app: AppHandle, recipient_id: String, unread_only: Option<bool>) -> Result<Vec<Notification>> {
    let c = db::connection(&app)?;
    let mut statement = err(c.prepare("SELECT id,recipient_id,event_type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE recipient_id=?1 AND (?2=0 OR read_at IS NULL) ORDER BY created_at DESC"))?;
    let notifications = err(statement.query_map(params![recipient_id, unread_only.unwrap_or(false)], read_notification))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(notifications)
}
#[tauri::command]
pub fn mark_notification_read(app: AppHandle, id: String) -> Result<()> {
    let c = db::connection(&app)?;
    if err(c.execute("UPDATE notifications SET read_at=unixepoch() WHERE id=?1", [id]))? == 0 { return Err("Notification not found".into()); }
    Ok(())
}
#[tauri::command]
pub fn list_subscription_settings(app: AppHandle, profile_id: String) -> Result<Vec<SubscriptionSetting>> {
    let c = db::connection(&app)?;
    let mut statement = err(c.prepare("SELECT profile_id,event_type,enabled FROM subscription_settings WHERE profile_id=?1 ORDER BY event_type"))?;
    let settings = err(statement.query_map([profile_id], |row| Ok(SubscriptionSetting { profile_id: row.get(0)?, event_type: row.get(1)?, enabled: row.get(2)? })))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(settings)
}
#[tauri::command]
pub fn save_subscription_setting(app: AppHandle, setting: SubscriptionSetting) -> Result<SubscriptionSetting> {
    if setting.profile_id.trim().is_empty() || setting.event_type.trim().is_empty() { return Err("Subscription profile and event type are required".into()); }
    let c = db::connection(&app)?;
    err(c.execute("INSERT INTO subscription_settings(profile_id,event_type,enabled) VALUES(?1,?2,?3) ON CONFLICT(profile_id,event_type) DO UPDATE SET enabled=excluded.enabled", params![setting.profile_id, setting.event_type, setting.enabled]))?;
    Ok(setting)
}
#[tauri::command]
pub fn delete_subscription_setting(app: AppHandle, profile_id: String, event_type: String) -> Result<()> {
    let c = db::connection(&app)?;
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
#[tauri::command]
pub fn goto_search(app: AppHandle, query: String, limit: Option<i64>) -> Result<Vec<GotoResult>> { goto_search_on(&db::connection(&app)?, &query, limit.unwrap_or(30)) }

#[derive(Clone, Debug, Serialize)]
pub struct AssignedIssue { pub id: String, pub title: String, pub project_id: String, pub number: i64, pub due_date: Option<String> }
#[derive(Clone, Debug, Serialize)]
pub struct Dashboard { pub open_todos: Vec<Todo>, pub assigned_issues: Vec<AssignedIssue>, pub meeting_occurrences: Vec<meetings::MeetingOccurrence>, pub unread_notifications: Vec<Notification>, pub current_absences: Vec<Absence> }
#[tauri::command]
pub fn dashboard_aggregate(app: AppHandle, profile_id: String) -> Result<Dashboard> {
    if profile_id.trim().is_empty() { return Err("Dashboard profile is required".into()); }
    let c = db::connection(&app)?;
    let mut statement = err(c.prepare("SELECT id,project_id,number,title,due_date FROM issues i LEFT JOIN issue_statuses s ON s.id=i.status_id WHERE i.assignee_id=?1 AND i.archived=0 AND coalesce(s.resolved,0)=0 ORDER BY i.due_date IS NULL,i.due_date,i.number"))?;
    let assigned_issues = err(statement.query_map([&profile_id], |row| Ok(AssignedIssue { id: row.get(0)?, project_id: row.get(1)?, number: row.get(2)?, title: row.get(3)?, due_date: row.get(4)? })))?.collect::<std::result::Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    let now = Utc::now();
    let today = now.date_naive().to_string();
    let end = now + Duration::days(7);
    Ok(Dashboard { open_todos: list_todos(app.clone(), profile_id.clone(), Some(false))?, assigned_issues, meeting_occurrences: meetings::expand_meeting_occurrences(app.clone(), now.timestamp(), end.timestamp())?, unread_notifications: list_notifications(app, profile_id, Some(true))?, current_absences: current_absences_on(&c, &today)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::db::SCHEMA_V1).unwrap();
        c.execute_batch(crate::db::SCHEMA_V2).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1)", []).unwrap();
        c
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
