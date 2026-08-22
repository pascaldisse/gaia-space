//! Personal productivity, organization availability, notifications, and Goto search.
use crate::{calendar_feeds, db, meetings};
use chrono::{Duration, Utc};
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
    /// Collaboration notes. None = legacy row or explicitly empty; never "".
    #[serde(default)]
    pub notes: Option<String>,
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
    /// Collaboration notes. None = legacy row or explicitly empty; never "".
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
}
fn read_todo(row: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        content: row.get(2)?,
        due_date: row.get(3)?,
        project_id: row.get(4)?,
        done: row.get(5)?,
        source_entity_type: row.get(6)?,
        source_entity_id: row.get(7)?,
        notes: row.get(8)?,
        assignee_ids: Vec::new(),
    })
}
/// Blank notes normalize to NULL: no empty-string variant ever reaches storage.
fn normalized_notes(notes: Option<String>) -> Option<String> {
    notes.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}
fn valid_anchor(entity_type: &Option<String>, entity_id: &Option<String>) -> Result<()> {
    if entity_type.is_some() != entity_id.is_some() {
        return Err("Todo and notification anchors require both entity type and entity ID".into());
    }
    Ok(())
}
/// Distinct, trimmed, non-empty assignee profile ids, order preserved.
fn clean_assignees(ids: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        let id = id.trim();
        if id.is_empty() || out.iter().any(|existing| existing == id) {
            continue;
        }
        out.push(id.to_string());
    }
    out
}
fn assignees_on(c: &Connection, todo_id: &str) -> Result<Vec<String>> {
    let mut statement = err(
        c.prepare("SELECT profile_id FROM todo_assignees WHERE todo_id=?1 ORDER BY profile_id")
    )?;
    let ids = err(statement.query_map([todo_id], |row| row.get::<_, String>(0)))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(ids)
}
/// An assignee must be a live profile; if that profile is backed by login accounts,
/// at least one of them must still be active. Deactivated people cannot be assigned.
fn assignee_is_active(c: &Connection, profile_id: &str) -> Result<bool> {
    let profile_live: bool = err(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1 AND archived=0)",
        [profile_id],
        |row| row.get(0),
    ))?;
    if !profile_live {
        return Ok(false);
    }
    let accounts: i64 = err(c.query_row(
        "SELECT count(*) FROM users WHERE profile_id=?1",
        [profile_id],
        |row| row.get(0),
    ))?;
    if accounts == 0 {
        return Ok(true);
    }
    let active: i64 = err(c.query_row(
        "SELECT count(*) FROM users WHERE profile_id=?1 AND active=1",
        [profile_id],
        |row| row.get(0),
    ))?;
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
fn replace_assignees(
    c: &Connection,
    todo_id: &str,
    project_id: Option<&str>,
    ids: &[String],
) -> Result<()> {
    let ids = clean_assignees(ids);
    if project_id.is_none() && !ids.is_empty() {
        return Err("assignment requires a project todo".into());
    }
    for pid in &ids {
        if !assignee_is_active(c, pid)? {
            return Err(format!("Assignee profile is not active: {pid}"));
        }
        if !project_member_on(
            c,
            project_id.expect("non-empty assignees require project"),
            pid,
        )? {
            return Err(format!("Assignee must be a project member: {pid}"));
        }
    }
    err(c.execute("DELETE FROM todo_assignees WHERE todo_id=?1", [todo_id]))?;
    for pid in &ids {
        err(c.execute(
            "INSERT OR IGNORE INTO todo_assignees(todo_id,profile_id) VALUES(?1,?2)",
            params![todo_id, pid],
        ))?;
    }
    Ok(())
}
/// Owner profile of a todo, for authorization at the HTTP layer.
pub fn todo_owner(id: &str) -> Result<Option<String>> {
    let c = db::conn()?;
    err(c
        .query_row("SELECT profile_id FROM todos WHERE id=?1", [id], |row| {
            row.get::<_, String>(0)
        })
        .optional())
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
    let ids = err(statement.query_map([project_id], |row| row.get::<_, String>(0)))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(ids)
}
/// Put a person into a project. The owner is a member by construction, so
/// adding them again is a no-op rather than an error.
#[cfg_attr(feature = "desktop", tauri::command)]
/// The person is `member_id`, NOT `profile_id`: the web transport rewrites every
/// `profile_id` in a request to the caller's own profile (identity law), which
/// would silently turn "add Charles" into "add myself".
pub fn add_project_member(project_id: String, member_id: String) -> Result<Vec<String>> {
    let c = db::conn()?;
    let known: bool = err(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1 AND archived=0)",
        [&member_id],
        |r| r.get(0),
    ))?;
    if !known {
        return Err("that person does not exist".into());
    }
    err(c.execute(
        "INSERT OR IGNORE INTO project_members(project_id,profile_id) VALUES(?1,?2)",
        params![project_id, member_id],
    ))?;
    project_member_ids(project_id)
}
/// Take a person out of a project. The owner cannot be removed — a project
/// without its owner is unreachable.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_project_member(project_id: String, member_id: String) -> Result<Vec<String>> {
    let c = db::conn()?;
    let owner: Option<String> = err(c
        .query_row(
            "SELECT created_by FROM projects WHERE id=?1",
            [&project_id],
            |r| r.get(0),
        )
        .optional())?
    .flatten();
    if owner.as_deref() == Some(member_id.as_str()) {
        return Err("the project owner stays a member".into());
    }
    err(c.execute(
        "DELETE FROM project_members WHERE project_id=?1 AND profile_id=?2",
        params![project_id, member_id],
    ))?;
    project_member_ids(project_id)
}
fn todo_on(c: &Connection, id: &str) -> Result<Option<Todo>> {
    let todo = err(c.query_row("SELECT id,profile_id,content,due_date,project_id,done,source_entity_type,source_entity_id,notes FROM todos WHERE id=?1", [id], read_todo).optional())?;
    match todo {
        Some(mut todo) => {
            todo.assignee_ids = assignees_on(c, id)?;
            Ok(Some(todo))
        }
        None => Ok(None),
    }
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_todos(profile_id: String, include_done: Option<bool>) -> Result<Vec<Todo>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT t.id,t.profile_id,t.content,t.due_date,t.project_id,t.done,t.source_entity_type,t.source_entity_id,t.notes FROM todos t WHERE (?2=1 OR t.done=0) AND (t.profile_id=?1 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?1)))) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at"))?;
    let mut todos = err(statement.query_map(
        params![profile_id, include_done.unwrap_or(false)],
        read_todo,
    ))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;
    drop(statement);
    for todo in todos.iter_mut() {
        todo.assignee_ids = assignees_on(&c, &todo.id)?;
    }
    Ok(todos)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_todo(input: TodoInput) -> Result<Todo> {
    let mut c = db::conn()?;
    create_todo_on(&mut c, input)
}
/// Todo row and its assignee rows are written in one transaction: an invalid or inactive
/// assignee rolls back the todo itself.
fn create_todo_on(c: &mut Connection, input: TodoInput) -> Result<Todo> {
    if input.profile_id.trim().is_empty() || input.content.trim().is_empty() {
        return Err("Todo profile and content are required".into());
    }
    valid_anchor(&input.source_entity_type, &input.source_entity_id)?;
    let id = input.id.unwrap_or_else(|| new_id("todo"));
    let project_id = normalized_project_id(input.project_id);
    let tx = err(c.transaction())?;
    err(tx.execute("INSERT INTO todos(id,profile_id,content,due_date,project_id,done,source_entity_type,source_entity_id,notes) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![id, input.profile_id, input.content.trim(), input.due_date, project_id, input.done, input.source_entity_type, input.source_entity_id, normalized_notes(input.notes)]))?;
    replace_assignees(&tx, &id, project_id.as_deref(), &input.assignee_ids)?;
    err(tx.commit())?;
    todo_on(c, &id)?.ok_or_else(|| "Created todo was not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_todo(todo: Todo) -> Result<Todo> {
    let mut c = db::conn()?;
    update_todo_on(&mut c, todo)
}
fn update_todo_on(c: &mut Connection, todo: Todo) -> Result<Todo> {
    if todo.profile_id.trim().is_empty() || todo.content.trim().is_empty() {
        return Err("Todo profile and content are required".into());
    }
    valid_anchor(&todo.source_entity_type, &todo.source_entity_id)?;
    let project_id = normalized_project_id(todo.project_id.clone());
    let tx = err(c.transaction())?;
    let updated = err(tx.execute("UPDATE todos SET profile_id=?2,content=?3,due_date=?4,project_id=?5,done=?6,source_entity_type=?7,source_entity_id=?8,notes=?9,updated_at=unixepoch() WHERE id=?1", params![todo.id, todo.profile_id, todo.content.trim(), todo.due_date, project_id, todo.done, todo.source_entity_type, todo.source_entity_id, normalized_notes(todo.notes.clone())]))?;
    if updated == 0 {
        return Err("Todo not found".into());
    }
    replace_assignees(&tx, &todo.id, project_id.as_deref(), &todo.assignee_ids)?;
    err(tx.commit())?;
    todo_on(c, &todo.id)?.ok_or_else(|| "Todo not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_project_todos(
    project_id: String,
    profile_id: String,
    include_done: Option<bool>,
) -> Result<Vec<Todo>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT t.id,t.profile_id,t.content,t.due_date,t.project_id,t.done,t.source_entity_type,t.source_entity_id,t.notes FROM todos t WHERE t.project_id=?1 AND (?3=1 OR t.done=0) AND (t.profile_id=?2 OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?2 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?2))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?2)) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at"))?;
    let mut todos = err(statement.query_map(
        params![project_id, profile_id, include_done.unwrap_or(false)],
        read_todo,
    ))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;
    drop(statement);
    for todo in &mut todos {
        todo.assignee_ids = assignees_on(&c, &todo.id)?;
    }
    Ok(todos)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_todo(id: String) -> Result<()> {
    let mut c = db::conn()?;
    delete_todo_on(&mut c, id)
}
fn delete_todo_on(c: &mut Connection, id: String) -> Result<()> {
    let tx = err(c.transaction())?;
    err(tx.execute("DELETE FROM todo_assignees WHERE todo_id=?1", [&id]))?;
    if err(tx.execute("DELETE FROM todos WHERE id=?1", [id]))? == 0 {
        return Err("Todo not found".into());
    }
    err(tx.commit())?;
    Ok(())
}
/// Dedicated completion-only command. Authorization lives in the web chokepoint;
/// this function never accepts a wider todo payload.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_todo_completion(id: String, done: bool) -> Result<Todo> {
    let mut c = db::conn()?;
    let tx = err(c.transaction())?;
    if err(tx.execute(
        "UPDATE todos SET done=?2,updated_at=unixepoch() WHERE id=?1",
        params![id, done],
    ))? == 0
    {
        return Err("Todo not found".into());
    }
    err(tx.commit())?;
    todo_on(&c, &id)?.ok_or_else(|| "Todo not found".into())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Absence {
    pub id: String,
    pub profile_id: String,
    pub reason_type: String,
    pub date_from: String,
    pub date_to: String,
    pub approved: bool,
}
#[derive(Debug, Deserialize)]
pub struct AbsenceInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub reason_type: String,
    pub date_from: String,
    pub date_to: String,
    pub approved: bool,
}
fn read_absence(row: &rusqlite::Row<'_>) -> rusqlite::Result<Absence> {
    Ok(Absence {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        reason_type: row.get(2)?,
        date_from: row.get(3)?,
        date_to: row.get(4)?,
        approved: row.get(5)?,
    })
}
fn validate_absence(absence: &Absence) -> Result<()> {
    if absence.profile_id.trim().is_empty()
        || absence.reason_type.trim().is_empty()
        || absence.date_from.is_empty()
        || absence.date_to.is_empty()
    {
        return Err("Absence profile, reason, and dates are required".into());
    }
    if absence.date_to < absence.date_from {
        return Err("Absence end date must not precede its start date".into());
    }
    Ok(())
}
fn absence_on(c: &Connection, id: &str) -> Result<Option<Absence>> {
    err(c
        .query_row(
            "SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE id=?1",
            [id],
            read_absence,
        )
        .optional())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_absences(profile_id: Option<String>) -> Result<Vec<Absence>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE (?1 IS NULL OR profile_id=?1) ORDER BY date_from DESC,date_to DESC"))?;
    let absences = err(statement.query_map([profile_id], read_absence))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(absences)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_absence(input: AbsenceInput) -> Result<Absence> {
    let absence = Absence {
        id: input.id.unwrap_or_else(|| new_id("absence")),
        profile_id: input.profile_id,
        reason_type: input.reason_type,
        date_from: input.date_from,
        date_to: input.date_to,
        approved: input.approved,
    };
    validate_absence(&absence)?;
    let c = db::conn()?;
    // `RETURNING` answers with the row this statement wrote; a separate `SELECT id=?` could
    // pick up somebody else's row if the id changed hands in between.
    err(c.query_row("INSERT INTO absences(id,profile_id,reason_type,date_from,date_to,approved) VALUES(?1,?2,?3,?4,?5,?6) RETURNING id,profile_id,reason_type,date_from,date_to,approved", params![absence.id, absence.profile_id, absence.reason_type, absence.date_from, absence.date_to, absence.approved], read_absence))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_absence(absence: Absence) -> Result<Absence> {
    validate_absence(&absence)?;
    let c = db::conn()?;
    if err(c.execute("UPDATE absences SET profile_id=?2,reason_type=?3,date_from=?4,date_to=?5,approved=?6 WHERE id=?1", params![absence.id, absence.profile_id, absence.reason_type, absence.date_from, absence.date_to, absence.approved]))? == 0 { return Err("Absence not found".into()); }
    absence_on(&c, &absence.id)?.ok_or_else(|| "Absence not found".into())
}
/// Member update. Check, write, and readback are one statement, so the row cannot change
/// identity between them: ownership lives in the `WHERE` clause, neither `approved` nor
/// `profile_id` appears in the `SET` list, and `RETURNING` answers with the very row the
/// statement modified rather than with whatever a later `SELECT id=?` would find. An admin
/// approving or transferring the row before, during, or after this statement can therefore
/// neither be overwritten by the member nor disclosed to it.
/// `Ok(None)` means zero matched rows, which the caller answers with 403.
pub fn update_absence_details(absence: Absence, owner: &str) -> Result<Option<Absence>> {
    validate_absence(&absence)?;
    let c = db::conn()?;
    err(c.query_row(
        "UPDATE absences SET reason_type=?3,date_from=?4,date_to=?5 WHERE id=?1 AND profile_id=?2 \
         RETURNING id,profile_id,reason_type,date_from,date_to,approved",
        params![absence.id, owner, absence.reason_type, absence.date_from, absence.date_to],
        read_absence,
    ).optional())
}
/// Member delete, conditional for the same reason: an id authorized a moment ago may have
/// been deleted and recreated for another profile since. `Ok(false)` means nothing matched.
pub fn delete_absence_owned(id: &str, owner: &str) -> Result<bool> {
    let c = db::conn()?;
    Ok(err(c.execute(
        "DELETE FROM absences WHERE id=?1 AND profile_id=?2",
        params![id, owner],
    ))? > 0)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_absence(id: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute("DELETE FROM absences WHERE id=?1", [id]))? == 0 {
        return Err("Absence not found".into());
    }
    Ok(())
}
fn current_absences_on(c: &Connection, date: &str) -> Result<Vec<Absence>> {
    let mut statement = err(c.prepare("SELECT id,profile_id,reason_type,date_from,date_to,approved FROM absences WHERE approved=1 AND date_from<=?1 AND date_to>=?1 ORDER BY date_from,profile_id"))?;
    let absences = err(statement.query_map([date], read_absence))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(absences)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn current_absences(date: String) -> Result<Vec<Absence>> {
    current_absences_on(&db::conn()?, &date)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Notification {
    pub id: String,
    pub recipient_id: String,
    pub event_type: String,
    pub title: String,
    pub body: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub created_at: i64,
    pub read_at: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct NotificationInput {
    pub id: Option<String>,
    pub recipient_id: String,
    pub event_type: String,
    pub title: String,
    pub body: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    /// Optional subject the event belongs to (org/team/project/location/profile/entity).
    pub target_type: Option<String>,
    pub target_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SubscriptionScope {
    pub profile_id: String,
    pub event_type: String,
    pub target_type: String,
    pub target_id: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SubscriptionSetting {
    pub profile_id: String,
    pub event_type: String,
    pub enabled: bool,
}
fn read_notification(row: &rusqlite::Row<'_>) -> rusqlite::Result<Notification> {
    Ok(Notification {
        id: row.get(0)?,
        recipient_id: row.get(1)?,
        event_type: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        entity_type: row.get(5)?,
        entity_id: row.get(6)?,
        created_at: row.get(7)?,
        read_at: row.get(8)?,
    })
}
fn emit_notification_on(c: &Connection, input: &NotificationInput) -> Result<Option<Notification>> {
    if input.recipient_id.trim().is_empty()
        || input.event_type.trim().is_empty()
        || input.title.trim().is_empty()
    {
        return Err("Notification recipient, event type, and title are required".into());
    }
    valid_anchor(&input.entity_type, &input.entity_id)?;
    valid_target(&input.target_type, &input.target_id)?;
    if !subscription_enabled_on(
        c,
        &input.recipient_id,
        &input.event_type,
        input.target_type.as_deref(),
        input.target_id.as_deref(),
    )? {
        return Ok(None);
    }
    let id = input.id.clone().unwrap_or_else(|| new_id("notification"));
    err(c.execute("INSERT INTO notifications(id,recipient_id,event_type,title,body,entity_type,entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![id, input.recipient_id, input.event_type, input.title.trim(), input.body, input.entity_type, input.entity_id]))?;
    let notification = err(c.query_row("SELECT id,recipient_id,event_type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE id=?1", [id], read_notification))?;
    Ok(Some(notification))
}
/// Emits an event into a personal notification feed unless its subscription is disabled.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn emit_notification(input: NotificationInput) -> Result<Option<Notification>> {
    emit_notification_on(&db::conn()?, &input)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_notifications(
    recipient_id: String,
    unread_only: Option<bool>,
) -> Result<Vec<Notification>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT id,recipient_id,event_type,title,body,entity_type,entity_id,created_at,read_at FROM notifications WHERE recipient_id=?1 AND (?2=0 OR read_at IS NULL) ORDER BY created_at DESC"))?;
    let notifications = err(statement.query_map(
        params![recipient_id, unread_only.unwrap_or(false)],
        read_notification,
    ))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;
    Ok(notifications)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn mark_notification_read(id: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute(
        "UPDATE notifications SET read_at=unixepoch() WHERE id=?1",
        [id],
    ))? == 0
    {
        return Err("Notification not found".into());
    }
    Ok(())
}
const TARGET_TYPES: [&str; 6] = ["org", "team", "project", "location", "profile", "entity"];
fn valid_target(target_type: &Option<String>, target_id: &Option<String>) -> Result<()> {
    if target_type.is_some() != target_id.is_some() {
        return Err("Subscription targets require both target type and target ID".into());
    }
    if let Some(kind) = target_type.as_deref() {
        if !TARGET_TYPES.contains(&kind) {
            return Err(format!("Unknown subscription target type: {kind}"));
        }
    }
    Ok(())
}
/// Precedence, most specific first: scope on (event,target) → scope on ('*',target)
/// → per-event setting → subscribed by default. A disabled row at any level wins
/// over the levels below it.
pub(crate) fn subscription_enabled_on(
    c: &Connection,
    profile_id: &str,
    event_type: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
) -> Result<bool> {
    if let (Some(kind), Some(id)) = (target_type, target_id) {
        let scoped: Option<bool> = err(c.query_row(
            "SELECT enabled FROM subscription_scopes WHERE profile_id=?1 AND target_type=?3 AND target_id=?4 AND event_type IN (?2,'*') ORDER BY event_type='*' LIMIT 1",
            params![profile_id, event_type, kind, id],
            |row| row.get(0),
        ).optional())?;
        if let Some(enabled) = scoped {
            return Ok(enabled);
        }
    }
    err(c.query_row("SELECT coalesce((SELECT enabled FROM subscription_settings WHERE profile_id=?1 AND event_type=?2),1)", params![profile_id, event_type], |row| row.get(0)))
}
fn read_scope(row: &rusqlite::Row<'_>) -> rusqlite::Result<SubscriptionScope> {
    Ok(SubscriptionScope {
        profile_id: row.get(0)?,
        event_type: row.get(1)?,
        target_type: row.get(2)?,
        target_id: row.get(3)?,
        enabled: row.get(4)?,
    })
}
pub(crate) fn list_subscription_scopes_on(
    c: &Connection,
    profile_id: &str,
) -> Result<Vec<SubscriptionScope>> {
    let mut statement = err(c.prepare("SELECT profile_id,event_type,target_type,target_id,enabled FROM subscription_scopes WHERE profile_id=?1 ORDER BY target_type,target_id,event_type"))?;
    let rows = err(statement.query_map([profile_id], read_scope))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}
pub(crate) fn save_subscription_scope_on(
    c: &Connection,
    scope: SubscriptionScope,
) -> Result<SubscriptionScope> {
    if scope.profile_id.trim().is_empty()
        || scope.event_type.trim().is_empty()
        || scope.target_id.trim().is_empty()
    {
        return Err("Subscription profile, event type, and target ID are required".into());
    }
    valid_target(
        &Some(scope.target_type.clone()),
        &Some(scope.target_id.clone()),
    )?;
    err(c.execute("INSERT INTO subscription_scopes(profile_id,event_type,target_type,target_id,enabled) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id,event_type,target_type,target_id) DO UPDATE SET enabled=excluded.enabled", params![scope.profile_id, scope.event_type, scope.target_type, scope.target_id, scope.enabled]))?;
    Ok(scope)
}
/// Subscriptions scoped to a subject for one profile.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_subscription_scopes(profile_id: String) -> Result<Vec<SubscriptionScope>> {
    list_subscription_scopes_on(&db::conn()?, &profile_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_subscription_scope(scope: SubscriptionScope) -> Result<SubscriptionScope> {
    save_subscription_scope_on(&db::conn()?, scope)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_subscription_scope(
    profile_id: String,
    event_type: String,
    target_type: String,
    target_id: String,
) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute(
        "DELETE FROM subscription_scopes WHERE profile_id=?1 AND event_type=?2 AND target_type=?3 AND target_id=?4",
        params![profile_id, event_type, target_type, target_id],
    ))? == 0
    {
        return Err("Subscription scope not found".into());
    }
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_subscription_settings(profile_id: String) -> Result<Vec<SubscriptionSetting>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT profile_id,event_type,enabled FROM subscription_settings WHERE profile_id=?1 ORDER BY event_type"))?;
    let settings = err(statement.query_map([profile_id], |row| {
        Ok(SubscriptionSetting {
            profile_id: row.get(0)?,
            event_type: row.get(1)?,
            enabled: row.get(2)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;
    Ok(settings)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_subscription_setting(setting: SubscriptionSetting) -> Result<SubscriptionSetting> {
    if setting.profile_id.trim().is_empty() || setting.event_type.trim().is_empty() {
        return Err("Subscription profile and event type are required".into());
    }
    let c = db::conn()?;
    err(c.execute("INSERT INTO subscription_settings(profile_id,event_type,enabled) VALUES(?1,?2,?3) ON CONFLICT(profile_id,event_type) DO UPDATE SET enabled=excluded.enabled", params![setting.profile_id, setting.event_type, setting.enabled]))?;
    Ok(setting)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_subscription_setting(profile_id: String, event_type: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute(
        "DELETE FROM subscription_settings WHERE profile_id=?1 AND event_type=?2",
        params![profile_id, event_type],
    ))? == 0
    {
        return Err("Subscription setting not found".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct GotoResult {
    pub id: String,
    pub entity_type: String,
    pub title: String,
    pub details: Option<String>,
    pub score: i64,
}
fn goto_search_on(c: &Connection, query: &str, limit: i64) -> Result<Vec<GotoResult>> {
    let term = query.trim();
    if term.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!("%{}%", term.to_lowercase());
    let exact = term.to_lowercase();
    let mut statement = err(c.prepare("SELECT id,entity_type,title,details,score FROM (
      SELECT id,'profile' entity_type,display_name title,username details,CASE WHEN lower(display_name)=?2 THEN 100 ELSE 50 END score FROM profiles WHERE lower(display_name) LIKE ?1 OR lower(username) LIKE ?1
      UNION ALL SELECT id,'project',name,key,CASE WHEN lower(name)=?2 OR lower(key)=?2 THEN 100 ELSE 50 END FROM projects WHERE archived=0 AND (lower(name) LIKE ?1 OR lower(key) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
      UNION ALL SELECT id,'issue',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM issues WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
      UNION ALL SELECT id,'channel',coalesce(name,''),description,CASE WHEN lower(coalesce(name,''))=?2 THEN 100 ELSE 40 END FROM channels WHERE archived=0 AND (lower(coalesce(name,'')) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
      UNION ALL SELECT id,'document',title,container_type,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM documents WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(body,'')) LIKE ?1)
      UNION ALL SELECT id,'blog',title,'Blog',CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM blog_posts WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(body) LIKE ?1)
UNION ALL SELECT id,'review',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM reviews WHERE lower(title) LIKE ?1
      UNION ALL SELECT id,'meeting',title,location,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM meetings WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
    ) ORDER BY score DESC,title COLLATE NOCASE LIMIT ?3"))?;
    let results = err(
        statement.query_map(params![pattern, exact, limit.clamp(1, 100)], |row| {
            Ok(GotoResult {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                title: row.get(2)?,
                details: row.get(3)?,
                score: row.get(4)?,
            })
        }),
    )?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;
    Ok(results)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn goto_search(query: String, limit: Option<i64>) -> Result<Vec<GotoResult>> {
    goto_search_on(&db::conn()?, &query, limit.unwrap_or(30))
}
pub fn goto_search_scoped(
    query: String,
    limit: Option<i64>,
    profile_id: String,
    allow_all: bool,
) -> Result<Vec<GotoResult>> {
    let term = query.trim();
    if term.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!("%{}%", term.to_lowercase());
    let exact = term.to_lowercase();
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,entity_type,title,details,score FROM (
SELECT id,'profile' entity_type,display_name title,username details,CASE WHEN lower(display_name)=?2 THEN 100 ELSE 50 END score FROM profiles WHERE lower(display_name) LIKE ?1 OR lower(username) LIKE ?1
UNION ALL SELECT id,'project',name,key,CASE WHEN lower(name)=?2 OR lower(key)=?2 THEN 100 ELSE 50 END FROM projects WHERE archived=0 AND (lower(name) LIKE ?1 OR lower(key) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1) AND (?4 OR created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=projects.id AND pm.profile_id=?3))
UNION ALL SELECT i.id,'issue',i.title,i.project_id || ' #' || i.number,CASE WHEN lower(i.title)=?2 THEN 100 ELSE 45 END FROM issues i WHERE i.archived=0 AND (lower(i.title) LIKE ?1 OR lower(coalesce(i.description,'')) LIKE ?1) AND EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND (?4 OR p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3)))
UNION ALL SELECT id,'channel',coalesce(name,''),description,CASE WHEN lower(coalesce(name,''))=?2 THEN 100 ELSE 40 END FROM channels WHERE archived=0 AND (lower(coalesce(name,'')) LIKE ?1 OR lower(coalesce(description,'')) LIKE ?1)
UNION ALL SELECT d.id,'document',d.title,d.container_type,CASE WHEN lower(d.title)=?2 THEN 100 ELSE 45 END FROM documents d WHERE d.archived=0 AND (lower(d.title) LIKE ?1 OR lower(coalesce(d.body,'')) LIKE ?1) AND (d.created_by=?3 OR (d.container_type='project' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND (?4 OR p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3)))))
UNION ALL SELECT id,'blog',title,'Blog',CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM blog_posts WHERE archived=0 AND (lower(title) LIKE ?1 OR lower(body) LIKE ?1)
UNION ALL SELECT id,'review',title,project_id || ' #' || number,CASE WHEN lower(title)=?2 THEN 100 ELSE 45 END FROM reviews WHERE lower(title) LIKE ?1
UNION ALL SELECT m.id,'meeting',m.title,m.location,CASE WHEN lower(m.title)=?2 THEN 100 ELSE 45 END FROM meetings m WHERE m.archived=0 AND (lower(m.title) LIKE ?1 OR lower(coalesce(m.description,'')) LIKE ?1) AND (m.organizer_id=?3 OR EXISTS(SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.profile_id=?3) OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND (?4 OR p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3))))
) ORDER BY score DESC,title COLLATE NOCASE LIMIT ?5"))?;
    let rows = err(s.query_map(
        params![
            pattern,
            exact,
            profile_id,
            allow_all,
            limit.unwrap_or(30).clamp(1, 100)
        ],
        |r| {
            Ok(GotoResult {
                id: r.get(0)?,
                entity_type: r.get(1)?,
                title: r.get(2)?,
                details: r.get(3)?,
                score: r.get(4)?,
            })
        },
    ))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string());
    rows
}

#[derive(Clone, Debug, Serialize)]
pub struct CalendarItem {
    pub id: String,
    /// The record this item was derived from: the meeting, todo or project id.
    /// A recurrence's `id` is decorated to keep occurrences distinct, so the way
    /// back to the record is carried here and never parsed back out of `id`.
    pub source_id: String,
    pub kind: String,
    pub title: String,
    pub starts_at: i64,
    pub ends_at: Option<i64>,
    pub project_id: Option<String>,
    /// Set for date-only kinds (task due date, project deadline); `None` for meetings,
    /// which are instants. Clients render the calendar day from this string.
    pub date: Option<String>,
}
/// Calendar is derived from session-visible records only: own personal/group todos,
/// project-member or assignee group todos, organized/attended meetings, and owned projects.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn calendar_aggregate(
    profile_id: String,
    range_start: i64,
    range_end: i64,
    range_start_date: Option<String>,
    range_end_date: Option<String>,
) -> Result<Vec<CalendarItem>> {
    let c = db::conn()?;
    calendar_aggregate_on(
        &c,
        &profile_id,
        range_start,
        range_end,
        range_start_date.as_deref(),
        range_end_date.as_deref(),
    )
}
/// Date-only calendar values (`todos.due_date`, `projects.deadline`) are calendar dates,
/// not instants: they are compared as `YYYY-MM-DD` strings against the day window the
/// client derived from its *local* components. `unixepoch(date)` would re-read them as
/// UTC midnight and shift the day for every session off UTC (H4).
pub fn parse_day_key(value: &str) -> Result<String> {
    let trimmed = value.trim();
    chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| format!("Calendar day key must be YYYY-MM-DD, got `{trimmed}`"))?;
    Ok(trimmed.to_string())
}
fn day_window(
    range_start: i64,
    range_end: i64,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<(String, String)> {
    let from_epoch = |seconds: i64| {
        chrono::DateTime::from_timestamp(seconds, 0)
            .ok_or_else(|| "Calendar range is out of bounds".to_string())
            .map(|at| at.date_naive().to_string())
    };
    let start = match start_date {
        Some(value) => parse_day_key(value)?,
        None => from_epoch(range_start)?,
    };
    let end = match end_date {
        Some(value) => parse_day_key(value)?,
        None => from_epoch(range_end)?,
    };
    if end <= start {
        return Err("Calendar day window must end after it starts".into());
    }
    Ok((start, end))
}
pub fn calendar_aggregate_on(
    c: &Connection,
    profile_id: &str,
    range_start: i64,
    range_end: i64,
    range_start_date: Option<&str>,
    range_end_date: Option<&str>,
) -> Result<Vec<CalendarItem>> {
    if profile_id.trim().is_empty() || range_end <= range_start {
        return Err("Calendar range and session profile are required".into());
    }
    let (day_start, day_end) =
        day_window(range_start, range_end, range_start_date, range_end_date)?;
    let mut items = Vec::new();
    // Meetings: visibility comes from `meetings::visible_meetings_on` (MEETING_READ_SCOPE)
    // and nowhere else, so the calendar can never diverge from the meeting list (SPEC:33).
    // The range filter lives in the expansion, not in SQL: a recurring meeting whose base
    // row starts before the window still contributes the occurrences falling inside it.
    for meeting in meetings::visible_meetings_on(c, profile_id)?
        .into_iter()
        .filter(|m| !m.archived)
    {
        for occurrence in meetings::expand(&meeting, range_start, range_end)? {
            // A one-off (and the base instant of a series) keeps the plain meeting id so
            // clients resolve it directly; a repeat is `<meeting id>:<instant>`.
            let id = if occurrence.starts_at == meeting.starts_at {
                meeting.id.clone()
            } else {
                occurrence.id
            };
            items.push(CalendarItem {
                id,
                source_id: meeting.id.clone(),
                kind: "meeting".into(),
                title: occurrence.title,
                starts_at: occurrence.starts_at,
                ends_at: Some(occurrence.ends_at),
                project_id: None,
                date: None,
            });
        }
    }
    let mut todos = err(c.prepare("SELECT DISTINCT t.id,t.content,t.due_date,t.project_id FROM todos t WHERE t.done=0 AND t.due_date IS NOT NULL AND t.due_date>=?1 AND t.due_date<?2 AND (t.profile_id=?3 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?3))))"))?;
    for row in err(
        todos.query_map(params![day_start, day_end, profile_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        }),
    )? {
        let (id, title, date, project_id) = row.map_err(|e| e.to_string())?;
        let starts_at = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .map_err(|_| "Invalid todo due date")?
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();
        items.push(CalendarItem {
            source_id: id.clone(),
            id,
            kind: "task".into(),
            title,
            starts_at,
            ends_at: None,
            project_id,
            date: Some(date),
        });
    }
    let mut deadlines = err(c.prepare("SELECT p.id,p.name,p.deadline FROM projects p WHERE p.archived=0 AND p.deadline IS NOT NULL AND p.deadline>=?2 AND p.deadline<?3 AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1))"))?;
    for row in err(
        deadlines.query_map(params![profile_id, day_start, day_end], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }),
    )? {
        let (id, name, date) = row.map_err(|e| e.to_string())?;
        let starts_at = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .map_err(|_| "Invalid project deadline")?
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();
        items.push(CalendarItem {
            id: format!("deadline-{id}"),
            source_id: id.clone(),
            kind: "deadline".into(),
            title: format!("{name} deadline"),
            starts_at,
            ends_at: None,
            project_id: Some(id),
            date: Some(date),
        });
    }
    // Read-only synced feeds (Settings → Connected calendars): own subscriptions only,
    // same overlap/day-window rules as meetings and tasks/deadlines above.
    items.extend(calendar_feeds::external_items_on(
        c,
        profile_id,
        range_start,
        range_end,
        &day_start,
        &day_end,
    )?);
    items.sort_by_key(|item| item.starts_at);
    Ok(items)
}

#[derive(Clone, Debug, Serialize)]
pub struct AssignedIssue {
    pub id: String,
    pub title: String,
    pub project_id: String,
    pub number: i64,
    pub due_date: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Dashboard {
    pub open_todos: Vec<Todo>,
    pub assigned_issues: Vec<AssignedIssue>,
    pub meeting_occurrences: Vec<meetings::MeetingOccurrence>,
    pub unread_notifications: Vec<Notification>,
    pub current_absences: Vec<Absence>,
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn dashboard_aggregate(profile_id: String) -> Result<Dashboard> {
    if profile_id.trim().is_empty() {
        return Err("Dashboard profile is required".into());
    }
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.due_date FROM issues i LEFT JOIN issue_statuses s ON s.id=i.status_id WHERE i.assignee_id=?1 AND i.archived=0 AND coalesce(s.resolved,0)=0 ORDER BY i.due_date IS NULL,i.due_date,i.number"))?;
    let assigned_issues = err(statement.query_map([&profile_id], |row| {
        Ok(AssignedIssue {
            id: row.get(0)?,
            project_id: row.get(1)?,
            number: row.get(2)?,
            title: row.get(3)?,
            due_date: row.get(4)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let today = now.date_naive().to_string();
    let end = now + Duration::days(7);
    Ok(Dashboard {
        open_todos: list_todos(profile_id.clone(), Some(false))?,
        assigned_issues,
        meeting_occurrences: meetings::expand_meeting_occurrences_scoped(
            now.timestamp(),
            end.timestamp(),
            profile_id.clone(),
        )?,
        unread_notifications: list_notifications(profile_id, Some(true))?,
        current_absences: current_absences_on(&c, &today)?,
    })
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
        let mut statement = c.prepare("SELECT t.id,t.profile_id,t.content,t.due_date,t.project_id,t.done,t.source_entity_type,t.source_entity_id,t.notes FROM todos t WHERE (?2=1 OR t.done=0) AND (t.profile_id=?1 OR (t.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1))) OR EXISTS(SELECT 1 FROM todo_assignees a WHERE a.todo_id=t.id AND a.profile_id=?1)))) ORDER BY t.done,t.due_date IS NULL,t.due_date,t.created_at").unwrap();
        let mut todos: Vec<Todo> = statement
            .query_map(params![profile_id, include_done], read_todo)
            .unwrap()
            .map(|t| t.unwrap())
            .collect();
        drop(statement);
        for todo in todos.iter_mut() {
            todo.assignee_ids = assignees_on(c, &todo.id).unwrap();
        }
        todos
    }
    fn todo_input(id: &str, owner: &str, assignees: &[&str]) -> TodoInput {
        TodoInput {
            id: Some(id.into()),
            profile_id: owner.into(),
            content: "Task".into(),
            notes: None,
            due_date: None,
            project_id: Some("project".into()),
            done: false,
            source_entity_type: None,
            source_entity_id: None,
            assignee_ids: assignees.iter().map(|x| x.to_string()).collect(),
        }
    }
    #[test]
    fn invalid_assignee_rolls_back_the_whole_todo_write() {
        let mut c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        // Unknown profile: nothing at all is persisted.
        let failed = create_todo_on(&mut c, todo_input("t1", "p", &["q", "ghost"]));
        assert!(failed.is_err(), "unknown assignee must fail");
        let todos: i64 = c
            .query_row("SELECT count(*) FROM todos", [], |r| r.get(0))
            .unwrap();
        let links: i64 = c
            .query_row("SELECT count(*) FROM todo_assignees", [], |r| r.get(0))
            .unwrap();
        assert_eq!((todos, links), (0, 0), "create must roll back entirely");
        // Deactivated account: also rejected.
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-r','third','x','Third','r','member',0,1)", []).unwrap();
        assert!(
            create_todo_on(&mut c, todo_input("t2", "p", &["r"])).is_err(),
            "inactive assignee must fail"
        );
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM todos", [], |r| r.get(0))
                .unwrap(),
            0
        );
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
        assert_eq!(
            c.query_row::<i64, _, _>(
                "SELECT count(*) FROM todo_assignees WHERE todo_id='t1'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
            2
        );
        delete_todo_on(&mut c, "t1".into()).unwrap();
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM todo_assignees", [], |r| r.get(0))
                .unwrap(),
            0,
            "junction rows must not outlive the todo"
        );
        // Independent path: a raw parent delete is refused/cascaded by foreign keys, never orphaned.
        create_todo_on(&mut c, todo_input("t2", "p", &["q"])).unwrap();
        c.execute("DELETE FROM todos WHERE id='t2'", []).unwrap();
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM todo_assignees", [], |r| r.get(0))
                .unwrap(),
            0,
            "ON DELETE CASCADE must be enforced"
        );
    }
    #[test]
    fn multi_assignee_roundtrip_keeps_personal_todos_owner_only() {
        let mut c = conn();
        // Owner 'p', assigned to 'q' and 'r'.
        c.execute(
            "INSERT INTO todos(id,profile_id,content) VALUES('t1','p','Shared task')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO todo_assignees(todo_id,profile_id) VALUES('t1','q'),('t1','r')",
            [],
        )
        .unwrap();
        // Owner 'q', no assignees.
        c.execute(
            "INSERT INTO todos(id,profile_id,content) VALUES('t2','q','Q private task')",
            [],
        )
        .unwrap();
        // Roundtrip: distinct, blank-stripped.
        let t1 = todo_on(&c, "t1").unwrap().unwrap();
        assert_eq!(t1.assignee_ids, vec!["q".to_string(), "r".to_string()]);
        // Visibility: owner sees own todo.
        assert!(list_todos_on(&c, "p", true).iter().any(|t| t.id == "t1"));
        // Assignees never gain read access to the owner's personal todo.
        assert!(list_todos_on(&c, "r", true).is_empty());
        assert_eq!(
            list_todos_on(&c, "q", true)
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["t2"]
        );
        // Reassign clears prior links.
        // Legacy personal rows remain untouched/read-private, but their next write
        // must clear assignments or attach a project.
        let mut legacy = todo_on(&c, "t1").unwrap().unwrap();
        legacy.content = "Changed".into();
        assert!(update_todo_on(&mut c, legacy)
            .unwrap_err()
            .contains("assignment requires a project todo"));
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
    fn feed_input(event: &str, target: Option<(&str, &str)>) -> NotificationInput {
        NotificationInput {
            id: None,
            recipient_id: "p".into(),
            event_type: event.into(),
            title: "Event".into(),
            body: None,
            entity_type: None,
            entity_id: None,
            target_type: target.map(|t| t.0.to_string()),
            target_id: target.map(|t| t.1.to_string()),
        }
    }
    #[test]
    fn scoped_subscription_beats_event_default_and_wildcard() {
        let c = conn();
        // Muted globally for the event, but re-enabled for one project target.
        c.execute("INSERT INTO subscription_settings(profile_id,event_type,enabled) VALUES('p','issue.created',0)", []).unwrap();
        save_subscription_scope_on(
            &c,
            SubscriptionScope {
                profile_id: "p".into(),
                event_type: "issue.created".into(),
                target_type: "project".into(),
                target_id: "project".into(),
                enabled: true,
            },
        )
        .unwrap();
        // Wildcard mute on another project.
        save_subscription_scope_on(
            &c,
            SubscriptionScope {
                profile_id: "p".into(),
                event_type: "*".into(),
                target_type: "project".into(),
                target_id: "other".into(),
                enabled: false,
            },
        )
        .unwrap();
        assert!(
            emit_notification_on(
                &c,
                &feed_input("issue.created", Some(("project", "project")))
            )
            .unwrap()
            .is_some(),
            "scope re-enables a muted event"
        );
        assert!(
            emit_notification_on(&c, &feed_input("issue.created", None))
                .unwrap()
                .is_none(),
            "unscoped event stays muted"
        );
        assert!(
            emit_notification_on(&c, &feed_input("issue.created", Some(("project", "other"))))
                .unwrap()
                .is_none(),
            "wildcard scope mutes the target"
        );
        assert!(
            emit_notification_on(
                &c,
                &feed_input("blog.published", Some(("project", "project")))
            )
            .unwrap()
            .is_some(),
            "unknown event defaults to subscribed"
        );
        // Independent check: the count of stored rows, not the return values.
        assert_eq!(
            c.query_row("SELECT count(*) FROM notifications", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(list_subscription_scopes_on(&c, "p").unwrap().len(), 2);
    }
    #[test]
    fn invalid_subscription_target_is_rejected() {
        let c = conn();
        assert!(save_subscription_scope_on(
            &c,
            SubscriptionScope {
                profile_id: "p".into(),
                event_type: "e".into(),
                target_type: "galaxy".into(),
                target_id: "x".into(),
                enabled: true
            }
        )
        .is_err());
        assert!(
            emit_notification_on(
                &c,
                &NotificationInput {
                    target_id: None,
                    ..feed_input("e", Some(("project", "project")))
                }
            )
            .is_err(),
            "half a target is an error"
        );
    }
    #[test]
    fn disabled_subscription_suppresses_emit() {
        let c = conn();
        c.execute("INSERT INTO subscription_settings(profile_id,event_type,enabled) VALUES('p','absence.created',0)", []).unwrap();
        let result = emit_notification_on(
            &c,
            &NotificationInput {
                id: None,
                recipient_id: "p".into(),
                event_type: "absence.created".into(),
                title: "Absent".into(),
                body: None,
                entity_type: None,
                entity_id: None,
                target_type: None,
                target_id: None,
            },
        )
        .unwrap();
        assert!(result.is_none());
        assert_eq!(
            c.query_row("SELECT count(*) FROM notifications", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
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
        assert_eq!(
            current_absences_on(&c, "2026-07-26")
                .unwrap()
                .iter()
                .map(|absence| absence.id.as_str())
                .collect::<Vec<_>>(),
            vec!["approved"]
        );
    }

    #[test]
    fn notes_round_trip_and_blank_notes_persist_as_null() {
        let mut c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        let mut input = todo_input("t-notes", "p", &["q"]);
        input.notes = Some("  handover to Q  ".into());
        let created = create_todo_on(&mut c, input).expect("create with notes");
        assert_eq!(
            created.notes.as_deref(),
            Some("handover to Q"),
            "notes are trimmed, not lost"
        );
        let mut blanked = created.clone();
        blanked.notes = Some("   ".into());
        let updated = update_todo_on(&mut c, blanked).expect("update");
        assert_eq!(
            updated.notes, None,
            "blank notes normalize to NULL, never an empty string"
        );
        let stored: Option<String> = c
            .query_row("SELECT notes FROM todos WHERE id='t-notes'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, None);
        // Legacy rows written before V11 keep NULL notes and still read back.
        c.execute(
            "INSERT INTO todos(id,profile_id,content,done) VALUES('t-legacy','p','Legacy',0)",
            [],
        )
        .unwrap();
        let legacy = todo_on(&c, "t-legacy")
            .unwrap()
            .expect("legacy todo readable");
        assert_eq!(legacy.notes, None);
    }

    #[test]
    fn calendar_date_only_items_follow_the_client_local_day_window() {
        // A task due 2030-03-10 and a project deadline on the same day must appear for a
        // client whose local day window is UTC-11..UTC+13 — the epoch range of a local
        // midnight window never lines up with the UTC instant of a date-only value.
        let c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        c.execute("INSERT INTO todos(id,profile_id,content,due_date,done) VALUES('t-due','p','Ship it','2030-03-10',0)", []).unwrap();
        c.execute(
            "UPDATE projects SET deadline='2030-03-10' WHERE id='project'",
            [],
        )
        .unwrap();
        // UTC+13 client: local midnight 2030-03-10 == 2030-03-09T11:00Z.
        let start = 1899932400i64; // 2030-03-09T11:00:00Z
        let end = start + 86_400;
        let items =
            calendar_aggregate_on(&c, "p", start, end, Some("2030-03-10"), Some("2030-03-11"))
                .unwrap();
        assert!(
            items.iter().any(|i| i.id == "t-due" && i.kind == "task"),
            "date-only task must follow the client day window: {items:?}"
        );
        assert!(
            items
                .iter()
                .any(|i| i.id == "deadline-project" && i.kind == "deadline"),
            "date-only deadline must follow the client day window: {items:?}"
        );
        // The day before holds neither.
        let earlier = calendar_aggregate_on(
            &c,
            "p",
            start - 86_400,
            start,
            Some("2030-03-09"),
            Some("2030-03-10"),
        )
        .unwrap();
        assert!(
            earlier.is_empty(),
            "date-only items must not bleed into the previous local day: {earlier:?}"
        );
        // Malformed client day keys are refused, never silently coerced.
        assert!(
            calendar_aggregate_on(&c, "p", start, end, Some("10/03/2030"), Some("2030-03-11"))
                .is_err()
        );
    }

    #[test]
    fn project_deadlines_reach_members_not_strangers() {
        let c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        c.execute(
            "UPDATE projects SET deadline='2030-03-10' WHERE id='project'",
            [],
        )
        .unwrap();
        let window = ("2030-03-01", "2030-04-01");
        let member = calendar_aggregate_on(
            &c,
            "q",
            1_899_000_000,
            1_902_000_000,
            Some(window.0),
            Some(window.1),
        )
        .unwrap();
        assert!(
            member.iter().any(|i| i.id == "deadline-project"),
            "a project member sees the deadline"
        );
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('z','zed','Zed',1)",
            [],
        )
        .unwrap();
        let stranger = calendar_aggregate_on(
            &c,
            "z",
            1_899_000_000,
            1_902_000_000,
            Some(window.0),
            Some(window.1),
        )
        .unwrap();
        assert!(
            stranger.is_empty(),
            "a non-member never sees a project deadline: {stranger:?}"
        );
    }

    #[test]
    fn calendar_meetings_use_overlap_not_starts_within() {
        let c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        // A meeting that started before the window but runs into it must still appear.
        let sql = "SELECT DISTINCT m.id FROM meetings m LEFT JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE m.archived=0 AND m.starts_at<?2 AND m.ends_at>?1 AND (m.organizer_id=?3 OR mp.profile_id=?3)";
        c.execute("INSERT INTO meetings(id,title,organizer_id,starts_at,ends_at,archived) VALUES('m-long','Long','p',900,1100,0)", []).unwrap();
        let found: i64 = c
            .query_row(
                &format!("SELECT count(*) FROM ({sql})"),
                params![1000i64, 2000i64, "p"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            found, 1,
            "a meeting crossing the range start must not be dropped"
        );
        let outside: i64 = c
            .query_row(
                &format!("SELECT count(*) FROM ({sql})"),
                params![1100i64, 2000i64, "p"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            outside, 0,
            "a meeting ending exactly on the range start is outside"
        );
    }

    /// SPEC:33 — recurrence expansion follows the *same* scope and range as the
    /// aggregate itself. The base row starts long before the window, so only an
    /// expansion can put occurrences inside it; and the expansion must carry the
    /// aggregate's own visibility predicate, never a wider one.
    #[test]
    fn recurring_meetings_expand_inside_the_calendar_range() {
        let c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        // Daily 10:00-11:00 UTC meeting whose base row is 2030-03-01, organizer p, q invited.
        let base = 1_898_762_400i64; // 2030-03-01T10:00:00Z
        c.execute("INSERT INTO meetings(id,title,organizer_id,starts_at,ends_at,rrule,archived) VALUES('m-daily','Standup','p',?1,?2,'FREQ=DAILY',0)", params![base, base + 3600]).unwrap();
        c.execute(
            "INSERT INTO meeting_participants(meeting_id,profile_id) VALUES('m-daily','q')",
            [],
        )
        .unwrap();
        // Window = 2030-03-10 (local UTC), nine days after the base row.
        let start = base + 9 * 86_400 - 36_000; // 2030-03-10T00:00:00Z
        let end = start + 86_400;
        let organizer =
            calendar_aggregate_on(&c, "p", start, end, Some("2030-03-10"), Some("2030-03-11"))
                .unwrap();
        let occurrences: Vec<_> = organizer.iter().filter(|i| i.kind == "meeting").collect();
        assert_eq!(
            occurrences.len(),
            1,
            "exactly the occurrence falling in the window: {organizer:?}"
        );
        assert_eq!(
            occurrences[0].starts_at,
            base + 9 * 86_400,
            "the expanded occurrence keeps its own instant"
        );
        assert_eq!(
            occurrences[0].id, "m-daily:1899540000",
            "a repeat is identified by base id + instant"
        );
        // Participants see it too; a stranger to meeting and project never does.
        let participant =
            calendar_aggregate_on(&c, "q", start, end, Some("2030-03-10"), Some("2030-03-11"))
                .unwrap();
        assert_eq!(
            participant.iter().filter(|i| i.kind == "meeting").count(),
            1,
            "an invited participant sees the repeat"
        );
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('z','zed','Zed',1)",
            [],
        )
        .unwrap();
        let stranger =
            calendar_aggregate_on(&c, "z", start, end, Some("2030-03-10"), Some("2030-03-11"))
                .unwrap();
        assert!(
            stranger.iter().all(|i| i.kind != "meeting"),
            "a non-participant must never see an expanded occurrence: {stranger:?}"
        );
        // Archived recurrences vanish entirely, expansion or not.
        c.execute("UPDATE meetings SET archived=1 WHERE id='m-daily'", [])
            .unwrap();
        let archived =
            calendar_aggregate_on(&c, "p", start, end, Some("2030-03-10"), Some("2030-03-11"))
                .unwrap();
        assert!(
            archived.iter().all(|i| i.kind != "meeting"),
            "archived recurrences are not expanded: {archived:?}"
        );
    }

    /// Boundaries, on the expansion path: an occurrence that started before the
    /// window but runs into it is inside; one ending exactly on the range start is out.
    #[test]
    fn expanded_occurrences_honour_the_overlap_boundaries() {
        let c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        let base = 1_898_762_400i64; // 2030-03-01T10:00:00Z, two hours long
        c.execute("INSERT INTO meetings(id,title,organizer_id,starts_at,ends_at,rrule,archived) VALUES('m-daily','Standup','p',?1,?2,'FREQ=DAILY',0)", params![base, base + 7200]).unwrap();
        let occurrence = base + 9 * 86_400;
        // Window opens one hour into the occurrence: overlap, so it must appear.
        let crossing = calendar_aggregate_on(
            &c,
            "p",
            occurrence + 3600,
            occurrence + 86_400,
            Some("2030-03-10"),
            Some("2030-03-11"),
        )
        .unwrap();
        assert_eq!(
            crossing.iter().filter(|i| i.kind == "meeting").count(),
            1,
            "an occurrence crossing the range start stays: {crossing:?}"
        );
        // Window opens exactly when it ends: outside.
        let touching = calendar_aggregate_on(
            &c,
            "p",
            occurrence + 7200,
            occurrence + 86_400,
            Some("2030-03-10"),
            Some("2030-03-11"),
        )
        .unwrap();
        assert_eq!(
            touching.iter().filter(|i| i.kind == "meeting").count(),
            0,
            "an occurrence ending on the range start is outside: {touching:?}"
        );
    }

    /// Non-recurring meetings keep their plain meeting id, so the client can still
    /// resolve them directly.
    #[test]
    fn single_meetings_keep_their_plain_id() {
        let c = conn();
        crate::db::enforce_foreign_keys(&c).unwrap();
        c.execute("INSERT INTO meetings(id,title,organizer_id,starts_at,ends_at,archived) VALUES('m-one','One off','p',1000,2000,0)", []).unwrap();
        let items =
            calendar_aggregate_on(&c, "p", 500, 3000, Some("1970-01-01"), Some("1970-01-02"))
                .unwrap();
        assert!(
            items.iter().any(|i| i.id == "m-one" && i.kind == "meeting"),
            "one-off meetings are unchanged: {items:?}"
        );
    }
}

/// Ranked content-search payload. Kept distinct from `GotoResult`: Goto is quick
/// navigation, while FTS returns a match snippet and source breadcrumb.
#[derive(Clone, Debug, Serialize)]
pub struct FullTextResult {
    pub id: String,
    pub entity_type: String,
    pub title: String,
    pub snippet: String,
    pub breadcrumb: String,
    pub score: f64,
}
fn fts_terms(query: &str) -> String {
    query
        .split_whitespace()
        .filter_map(|word| {
            let clean: String = word
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            (!clean.is_empty()).then(|| format!("\"{clean}\"*"))
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}
fn full_text_search_on(
    c: &Connection,
    query: &str,
    limit: i64,
    profile_id: Option<&str>,
    allow_all: bool,
) -> Result<Vec<FullTextResult>> {
    let terms = fts_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let profile = profile_id.unwrap_or("");
    let sql = "SELECT CASE WHEN si.entity_type='message' THEN (SELECT channel_id FROM messages WHERE id=si.entity_id) ELSE si.entity_id END,CASE WHEN si.entity_type='message' THEN 'channel' ELSE si.entity_type END,si.title,snippet(search_index,3,'<mark>','</mark>','…',14),si.breadcrumb,bm25(search_index,0.0,0.0,8.0,0.0,0.0) FROM search_index si WHERE search_index MATCH ?1 AND (si.entity_type='issue' AND EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.id=si.entity_id AND (?2 OR p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3))) OR si.entity_type='document' AND EXISTS(SELECT 1 FROM documents d WHERE d.id=si.entity_id AND (d.created_by=?3 OR (d.container_type='project' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND (?2 OR p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3)))))) OR si.entity_type='message' AND EXISTS(SELECT 1 FROM messages m JOIN channel_members cm ON cm.channel_id=m.channel_id WHERE m.id=si.entity_id AND cm.profile_id=?3) OR si.entity_type='blog' AND EXISTS(SELECT 1 FROM blog_posts b WHERE b.id=si.entity_id AND (b.project_id IS NULL OR ?2 OR EXISTS(SELECT 1 FROM projects p WHERE p.id=b.project_id AND (p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3)))))) ORDER BY bm25(search_index,0.0,0.0,8.0,0.0,0.0) LIMIT ?4";
    let mut statement = err(c.prepare(sql))?;
    let results = err(statement.query_map(
        params![terms, allow_all, profile, limit.clamp(1, 100)],
        |r| {
            Ok(FullTextResult {
                id: r.get(0)?,
                entity_type: r.get(1)?,
                title: r.get(2)?,
                snippet: r.get(3)?,
                breadcrumb: r.get(4)?,
                score: r.get(5)?,
            })
        },
    ))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string());
    results
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn full_text_search(query: String, limit: Option<i64>) -> Result<Vec<FullTextResult>> {
    full_text_search_on(&db::conn()?, &query, limit.unwrap_or(30), None, true)
}
pub fn full_text_search_scoped(
    query: String,
    limit: Option<i64>,
    profile_id: String,
    allow_all: bool,
) -> Result<Vec<FullTextResult>> {
    full_text_search_on(
        &db::conn()?,
        &query,
        limit.unwrap_or(30),
        Some(&profile_id),
        allow_all,
    )
}

#[cfg(test)]
mod full_text_tests {
    use super::*;
    #[test]
    fn fts_indexes_issue_document_message_and_blog_with_live_triggers() {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute_batch("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1); INSERT INTO projects(id,name,key,created_by,created_at) VALUES('project','Project','PROJ','p',1); INSERT INTO issue_statuses(id,project_id,name,color) VALUES('open','project','Open','#000'); INSERT INTO issues(id,project_id,number,title,description,status_id,created_by) VALUES('i','project',1,'Issue alpha','needle issue body','open','p'); INSERT INTO documents(id,container_type,container_id,doc_type,title,body,created_by) VALUES('d','my-docs','p','text','Document alpha','needle document body','p'); INSERT INTO channels(id,content_type,name) VALUES('c','public','General'); INSERT INTO channel_members(channel_id,profile_id) VALUES('c','p'); INSERT INTO messages(id,channel_id,author_id,text) VALUES('m','c','p','needle chat body'); INSERT INTO blog_posts(id,title,body,author_id) VALUES('b','Blog alpha','needle blog body','p');").unwrap();
        let hits = full_text_search_on(&c, "needle", 20, Some("p"), true).unwrap();
        let kinds: Vec<_> = hits.iter().map(|hit| hit.entity_type.as_str()).collect();
        assert!(kinds.contains(&"issue"));
        assert!(kinds.contains(&"document"));
        assert!(
            kinds.contains(&"channel"),
            "message hit routes to its channel: {hits:?}"
        );
        assert!(kinds.contains(&"blog"));
        c.execute(
            "UPDATE documents SET body='changed corpus' WHERE id='d'",
            [],
        )
        .unwrap();
        assert!(
            !full_text_search_on(&c, "needle document", 20, Some("p"), true)
                .unwrap()
                .iter()
                .any(|hit| hit.id == "d")
        );
    }
}
