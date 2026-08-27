#![allow(dead_code)]
//! Planning domain: issues are independent records; boards only map statuses and positions.
use crate::db;
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
fn err<T>(value: rusqlite::Result<T>) -> Result<T> {
    value.map_err(|e| e.to_string())
}

/// Webhook fan-out envelope: `{"event": …, "issue": …}`. Subscription filters address
/// it by dot-path, e.g. `"issue.priority"`.
///
/// Called after the write and after the issue is materialized — never with a write
/// transaction open. Fan-out is best effort: a subscriber problem must not undo a
/// user's issue edit, so the error is reported and swallowed.
fn issue_event(event_type: &str, issue: &Issue) {
    let payload = serde_json::json!({ "event": event_type, "issue": issue });
    if let Err(e) = crate::applications::enqueue_event(event_type, &payload) {
        eprintln!("webhook fan-out for {event_type} failed: {e}");
    }
    let result = crate::db::conn().and_then(|c| {
        let mut recipients = c.prepare("SELECT created_by FROM projects WHERE id=?1 UNION SELECT profile_id FROM project_members WHERE project_id=?1")
            .map_err(|e| e.to_string())?
            .query_map([&issue.project_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        recipients.sort();
        crate::personal::fan_out_notification_on(&c, crate::personal::NotificationFanout {
            recipients, event_type, title: &issue.title, body: issue.description.as_deref(),
            entity_type: "issue", entity_id: &issue.id, target_type: Some("project"), target_id: Some(&issue.project_id),
        })
    });
    if let Err(e) = result {
        eprintln!("personal feed fan-out for {event_type} failed: {e}");
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Issue {
    pub id: String,
    pub project_id: String,
    pub number: i64,
    pub title: String,
    pub description: Option<String>,
    pub status_id: Option<String>,
    pub assignee_id: Option<String>,
    pub created_by: Option<String>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub archived: bool,
    /// Everybody working this issue. `assignee_id` is the first of these.
    #[serde(default)]
    pub assignee_ids: Vec<String>,
    /// Where this ticket came from, e.g. `("message", <message id>)` for a ticket
    /// raised out of a channel conversation. Free-form by design (see `db` V133) and
    /// both-or-neither, exactly like the todo anchor it mirrors.
    #[serde(default)]
    pub source_entity_type: Option<String>,
    #[serde(default)]
    pub source_entity_id: Option<String>,
}
/// An anchor names its source with BOTH halves or neither; half an anchor is a
/// dangling pointer nothing can render. Mirrors `personal::valid_anchor`.
fn valid_anchor(entity_type: &Option<String>, entity_id: &Option<String>) -> Result<()> {
    if entity_type.is_some() != entity_id.is_some() {
        return Err("Source anchors require both entity type and entity ID".into());
    }
    Ok(())
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueStatus {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub resolved: bool,
    pub color: String,
    pub ordering: i64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Board {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub backlog_type: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoardColumn {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub ordering: i64,
    pub status_ids: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Sprint {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub state: String,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub description: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Swimlane {
    pub id: String,
    pub board_id: String,
    pub sprint_id: Option<String>,
    pub name: String,
    pub is_default: bool,
    pub ordering: i64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoardCardSettings {
    pub board_id: String,
    pub fields: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanningTag {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Checklist {
    pub id: String,
    pub issue_id: String,
    pub title: String,
    pub ordering: i64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChecklistItem {
    pub id: String,
    pub checklist_id: String,
    pub parent_id: Option<String>,
    pub item_text: String,
    pub item_done: bool,
    pub ordering: i64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeTrackingEntry {
    pub id: String,
    pub issue_id: String,
    pub profile_id: String,
    pub entry_date: String,
    pub duration_minutes: i64,
    pub description: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueComment {
    pub id: String,
    pub issue_id: String,
    pub author_id: Option<String>,
    pub body: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueActivity {
    pub id: String,
    pub issue_id: String,
    pub activity_type: String,
    pub actor_id: Option<String>,
    pub detail: Option<String>,
    pub created_at: i64,
}
#[derive(Debug, Deserialize)]
pub struct IssueCommentInput {
    pub id: Option<String>,
    pub issue_id: String,
    pub author_id: Option<String>,
    pub body: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueAttachment {
    pub id: String,
    pub issue_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_length: i64,
    pub data_url: String,
}
#[derive(Debug, Deserialize)]
pub struct IssueAttachmentInput {
    pub id: Option<String>,
    pub file_name: String,
    pub mime_type: String,
    pub byte_length: i64,
    pub data_url: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueLink {
    pub id: String,
    pub issue_id: String,
    pub linked_issue_id: String,
    pub link_type: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrackerLink {
    pub id: String,
    pub issue_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct TrackerLinkInput {
    pub issue_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueDetail {
    #[serde(flatten)]
    pub issue: Issue,
    pub tags: Vec<PlanningTag>,
    pub checklists: Vec<Checklist>,
    pub time_total_minutes: i64,
    pub children: Vec<Issue>,
    #[serde(default)]
    pub attachments: Vec<IssueAttachment>,
    #[serde(default)]
    pub comments: Vec<IssueComment>,
    #[serde(default)]
    pub activities: Vec<IssueActivity>,
    #[serde(default)]
    pub tracker_links: Vec<TrackerLink>,
}

#[derive(Debug, Deserialize)]
pub struct IssueTransferInput {
    pub issue_id: String,
    pub target_project_id: String,
}
#[derive(Debug, Deserialize)]
pub struct IssueInput {
    pub id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status_id: Option<String>,
    pub assignee_id: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
    pub created_by: Option<String>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub archived: Option<bool>,
    #[serde(default)]
    pub source_entity_type: Option<String>,
    #[serde(default)]
    pub source_entity_id: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct StatusInput {
    pub id: Option<String>,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub resolved: bool,
    pub ordering: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct BoardInput {
    pub id: Option<String>,
    pub project_id: String,
    pub name: String,
    pub backlog_type: Option<String>,
    pub archived: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct ColumnInput {
    pub id: Option<String>,
    pub board_id: String,
    pub name: String,
    pub ordering: Option<i64>,
    pub status_ids: Vec<String>,
}
#[derive(Debug, Deserialize)]
pub struct SprintInput {
    pub id: Option<String>,
    pub board_id: String,
    pub name: String,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub description: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct SwimlaneInput {
    pub id: Option<String>,
    pub board_id: String,
    pub sprint_id: Option<String>,
    pub name: String,
    pub is_default: bool,
    pub ordering: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct TagInput {
    pub id: Option<String>,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub archived: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct ChecklistInput {
    pub id: Option<String>,
    pub issue_id: String,
    pub title: String,
    pub ordering: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct ChecklistItemInput {
    pub id: Option<String>,
    pub checklist_id: String,
    pub parent_id: Option<String>,
    pub item_text: String,
    pub item_done: bool,
    pub ordering: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct TimeEntryInput {
    pub id: Option<String>,
    pub issue_id: String,
    pub profile_id: String,
    pub entry_date: String,
    pub duration_minutes: i64,
    pub description: Option<String>,
}

/// Bulk board placement. Every selected issue is placed atomically in one column.
#[derive(Debug, Deserialize)]
pub struct BulkBoardMoveInput {
    pub board_id: String,
    pub issue_ids: Vec<String>,
    pub column_id: String,
    pub sprint_id: Option<String>,
    pub swimlane_id: Option<String>,
}
/// Bulk removal returns issues to the board's manual backlog (no board position).
#[derive(Debug, Deserialize)]
pub struct BulkBoardRemoveInput {
    pub board_id: String,
    pub issue_ids: Vec<String>,
}
/// `None` is the board-level backlog; a sprint id assigns every selected board issue.
#[derive(Debug, Deserialize)]
pub struct BulkSprintUpdateInput {
    pub board_id: String,
    pub issue_ids: Vec<String>,
    pub sprint_id: Option<String>,
}

fn read_issue(r: &rusqlite::Row<'_>) -> rusqlite::Result<Issue> {
    Ok(Issue {
        id: r.get(0)?,
        project_id: r.get(1)?,
        number: r.get(2)?,
        title: r.get(3)?,
        description: r.get(4)?,
        status_id: r.get(5)?,
        assignee_id: r.get(6)?,
        created_by: r.get(7)?,
        due_date: r.get(8)?,
        priority: r.get(9)?,
        archived: r.get(10)?,
        source_entity_type: r.get(11)?,
        source_entity_id: r.get(12)?,
        assignee_ids: Vec::new(),
    })
}

/// The people on one issue, primary first.
pub(crate) fn assignees_on(c: &Connection, issue_id: &str) -> Result<Vec<String>> {
    let mut s = err(c.prepare("SELECT a.profile_id FROM issue_assignees a JOIN issues i ON i.id=a.issue_id WHERE a.issue_id=?1 ORDER BY (a.profile_id=coalesce(i.assignee_id,'')) DESC, a.profile_id"))?;
    let rows = err(s.query_map([issue_id], |r| r.get(0)))?
        .collect::<std::result::Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
fn fill_assignees(c: &Connection, issues: &mut [Issue]) -> Result<()> {
    for issue in issues.iter_mut() {
        issue.assignee_ids = assignees_on(c, &issue.id)?;
    }
    Ok(())
}
/// Write the people of an issue and keep `assignee_id` pointing at the first one.
fn write_assignees(c: &Connection, issue_id: &str, profile_ids: &[String]) -> Result<()> {
    err(c.execute("DELETE FROM issue_assignees WHERE issue_id=?1", [issue_id]))?;
    for profile_id in profile_ids {
        if profile_id.is_empty() {
            continue;
        }
        err(c.execute(
            "INSERT OR IGNORE INTO issue_assignees(issue_id,profile_id) VALUES(?1,?2)",
            params![issue_id, profile_id],
        ))?;
    }
    let primary = profile_ids.iter().find(|id| !id.is_empty()).cloned();
    err(c.execute(
        "UPDATE issues SET assignee_id=?2 WHERE id=?1",
        params![issue_id, primary],
    ))?;
    Ok(())
}
/// One issue's people, replacing whoever was on it.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_issue_assignees(issue_id: String, profile_ids: Vec<String>) -> Result<Vec<String>> {
    let c = db::conn()?;
    write_assignees(&c, &issue_id, &profile_ids)?;
    assignees_on(&c, &issue_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issue_assignees(issue_id: String) -> Result<Vec<String>> {
    assignees_on(&db::conn()?, &issue_id)
}
// Argument list mirrors the `list_issues` tauri command 1:1 (it is the filter set the
// front-end sends). Grouping into a struct would change the IPC contract.
#[allow(clippy::too_many_arguments)]
fn list_issues_on(
    c: &Connection,
    project_id: Option<&str>,
    text: Option<&str>,
    status_id: Option<&str>,
    assignee_id: Option<&str>,
    tag_id: Option<&str>,
    custom_field_id: Option<&str>,
    custom_field_value_json: Option<&str>,
    include_archived: bool,
) -> Result<Vec<Issue>> {
    let mut sql = String::from("SELECT DISTINCT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived,i.source_entity_type,i.source_entity_id FROM issues i LEFT JOIN issue_tags it ON it.issue_id=i.id");
    sql.push_str(" WHERE (?1 IS NULL OR i.project_id=?1) AND (?2 IS NULL OR lower(i.title) LIKE '%' || lower(?2) || '%' OR lower(coalesce(i.description,'')) LIKE '%' || lower(?2) || '%') AND (?3 IS NULL OR i.status_id=?3) AND (?4 IS NULL OR i.assignee_id=?4) AND (?5 IS NULL OR it.tag_id=?5) AND (?6 IS NULL OR EXISTS(SELECT 1 FROM cf_values cv WHERE cv.entity_id=i.id AND cv.definition_id=?6 AND (?7 IS NULL OR cv.value_json=?7))) AND (?8=1 OR i.archived=0) ORDER BY i.project_id,i.number");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(
        params![
            project_id,
            text,
            status_id,
            assignee_id,
            tag_id,
            custom_field_id,
            custom_field_value_json,
            include_archived
        ],
        read_issue,
    ))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    let mut rows = rows;
    fill_assignees(c, &mut rows)?;
    Ok(rows)
}

// tauri `#[command]`: the signature IS the IPC contract consumed by the front-end.
// Collapsing the filters into one argument object would break every caller.
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issues(
    project_id: Option<String>,
    text: Option<String>,
    status_id: Option<String>,
    assignee_id: Option<String>,
    tag_id: Option<String>,
    custom_field_id: Option<String>,
    custom_field_value_json: Option<String>,
    include_archived: Option<bool>,
) -> Result<Vec<Issue>> {
    let c = db::conn()?;
    list_issues_on(
        &c,
        project_id.as_deref(),
        text.as_deref(),
        status_id.as_deref(),
        assignee_id.as_deref(),
        tag_id.as_deref(),
        custom_field_id.as_deref(),
        custom_field_value_json.as_deref(),
        include_archived.unwrap_or(false),
    )
}
fn record_activity(
    c: &Connection,
    issue_id: &str,
    activity_type: &str,
    actor_id: Option<&str>,
    detail: Option<&str>,
) -> Result<()> {
    err(c.execute("INSERT INTO issue_activities(id,issue_id,activity_type,actor_id,detail) VALUES(?1,?2,?3,?4,?5)", params![new_id("issue-activity"), issue_id, activity_type, actor_id, detail]))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issue_comments(issue_id: String) -> Result<Vec<IssueComment>> {
    let c = db::conn()?;
    let mut s = err(c.prepare("SELECT id,issue_id,author_id,body,created_at,edited_at FROM issue_comments WHERE issue_id=?1 ORDER BY created_at,id"))?;
    let rows = err(s.query_map([issue_id], |r| {
        Ok(IssueComment {
            id: r.get(0)?,
            issue_id: r.get(1)?,
            author_id: r.get(2)?,
            body: r.get(3)?,
            created_at: r.get(4)?,
            edited_at: r.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_issue_comment(input: IssueCommentInput) -> Result<IssueComment> {
    let body = input.body.trim().to_string();
    if body.is_empty() {
        return Err("Comment cannot be empty".into());
    }
    let c = db::conn()?;
    let comment = IssueComment {
        id: input.id.unwrap_or_else(|| new_id("issue-comment")),
        issue_id: input.issue_id,
        author_id: input.author_id,
        body,
        created_at: 0,
        edited_at: None,
    };
    err(c.execute(
        "INSERT INTO issue_comments(id,issue_id,author_id,body) VALUES(?1,?2,?3,?4)",
        params![
            comment.id,
            comment.issue_id,
            comment.author_id,
            comment.body
        ],
    ))?;
    record_activity(
        &c,
        &comment.issue_id,
        "commented",
        comment.author_id.as_deref(),
        None,
    )?;
    let saved = err(c.query_row(
        "SELECT id,issue_id,author_id,body,created_at,edited_at FROM issue_comments WHERE id=?1",
        [&comment.id],
        |r| {
            Ok(IssueComment {
                id: r.get(0)?,
                issue_id: r.get(1)?,
                author_id: r.get(2)?,
                body: r.get(3)?,
                created_at: r.get(4)?,
                edited_at: r.get(5)?,
            })
        },
    ))?;
    // return the database timestamp rather than a client clock.
    Ok(saved)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issue_activities(issue_id: String) -> Result<Vec<IssueActivity>> {
    let c = db::conn()?;
    let mut s = err(c.prepare("SELECT id,issue_id,activity_type,actor_id,detail,created_at FROM issue_activities WHERE issue_id=?1 ORDER BY created_at,id"))?;
    let rows = err(s.query_map([issue_id], |r| {
        Ok(IssueActivity {
            id: r.get(0)?,
            issue_id: r.get(1)?,
            activity_type: r.get(2)?,
            actor_id: r.get(3)?,
            detail: r.get(4)?,
            created_at: r.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_issue(id: String) -> Result<Option<Issue>> {
    let c = db::conn()?;
    let issue = err(c.query_row("SELECT id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived,source_entity_type,source_entity_id FROM issues WHERE id=?1",[&id],read_issue).optional())?;
    match issue {
        Some(mut issue) => {
            issue.assignee_ids = assignees_on(&c, &issue.id)?;
            Ok(Some(issue))
        }
        None => Ok(None),
    }
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_issue(input: IssueInput) -> Result<Issue> {
    valid_anchor(&input.source_entity_type, &input.source_entity_id)?;
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("issue"));
    let number: i64 = err(c.query_row(
        "SELECT coalesce(max(number),0)+1 FROM issues WHERE project_id=?1",
        [&input.project_id],
        |r| r.get(0),
    ))?;
    err(c.execute("INSERT INTO issues(id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived,source_entity_type,source_entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![id,input.project_id,number,input.title,input.description,input.status_id,input.assignee_id,input.created_by,input.due_date,input.priority,input.archived.unwrap_or(false),input.source_entity_type,input.source_entity_id]))?;
    let people = if input.assignee_ids.is_empty() {
        input.assignee_id.into_iter().collect()
    } else {
        input.assignee_ids
    };
    write_assignees(&c, &id, &people)?;
    record_activity(
        &c,
        &id,
        "created",
        input.created_by.as_deref(),
        Some("Issue created"),
    )?;
    drop(c);
    let issue = get_issue(id)?.ok_or_else(|| "Created issue was not found".to_string())?;
    issue_event(crate::events::ISSUE_CREATED, &issue);
    Ok(issue)
}
/// Clone an issue into another project, mapping its status by name (or the first
/// target status) and copying tags, checklists/items, and attachments.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn clone_issue(input: IssueTransferInput) -> Result<Issue> {
    let c = db::conn()?;
    let source = err(c.query_row("SELECT id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived,source_entity_type,source_entity_id FROM issues WHERE id=?1", [&input.issue_id], read_issue).optional())?
        .ok_or_else(|| "Issue not found".to_string())?;
    if source.project_id == input.target_project_id {
        return Err("Choose a different project".into());
    }
    let source_status_name: Option<String> = match &source.status_id {
        Some(id) => err(c
            .query_row("SELECT name FROM issue_statuses WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional())?,
        None => None,
    };
    let target_status: Option<String> = if let Some(name) = source_status_name {
        err(c.query_row("SELECT id FROM issue_statuses WHERE project_id=?1 AND archived=0 AND name=?2 ORDER BY ordering LIMIT 1", params![&input.target_project_id, name], |r| r.get(0)).optional())?
    } else { None }.or(err(c.query_row("SELECT id FROM issue_statuses WHERE project_id=?1 AND archived=0 ORDER BY ordering LIMIT 1", [&input.target_project_id], |r| r.get(0)).optional())?);
    let number: i64 = err(c.query_row(
        "SELECT coalesce(max(number),0)+1 FROM issues WHERE project_id=?1",
        [&input.target_project_id],
        |r| r.get(0),
    ))?;
    let id = new_id("issue");
    let tx = err(c.unchecked_transaction())?;
    // A clone keeps the origin: the copy was still raised by that conversation.
    err(tx.execute("INSERT INTO issues(id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived,source_entity_type,source_entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", params![&id,&input.target_project_id,number,&source.title,&source.description,&target_status,&source.assignee_id,&source.created_by,&source.due_date,&source.priority,source.archived,&source.source_entity_type,&source.source_entity_id]))?;
    for assignee in assignees_on(&tx, &source.id)? {
        err(tx.execute(
            "INSERT OR IGNORE INTO issue_assignees(issue_id,profile_id) VALUES(?1,?2)",
            params![&id, assignee],
        ))?;
    }
    let mut tags = err(tx.prepare("SELECT t.name FROM planning_tags t JOIN issue_tags it ON it.tag_id=t.id WHERE it.issue_id=?1"))?;
    let tag_names = err(
        err(tags.query_map([&source.id], |r| r.get::<_, String>(0)))?
            .collect::<std::result::Result<Vec<_>, _>>(),
    )
    .map_err(|e| e.to_string())?;
    drop(tags);
    for name in tag_names {
        let tag_id: String = match err(tx.query_row("SELECT id FROM planning_tags WHERE project_id=?1 AND name=?2 AND archived=0 ORDER BY id LIMIT 1", params![&input.target_project_id, &name], |r| r.get(0)).optional())? {
            Some(id) => id,
            None => { let tag_id = new_id("tag"); err(tx.execute("INSERT INTO planning_tags(id,project_id,parent_id,name,archived) VALUES(?1,?2,NULL,?3,0)", params![&tag_id,&input.target_project_id,&name]))?; tag_id }
        };
        err(tx.execute(
            "INSERT INTO issue_tags(issue_id,tag_id) VALUES(?1,?2)",
            params![&id, tag_id],
        ))?;
    }
    let mut lists = err(
        tx.prepare("SELECT id,title,ordering FROM checklists WHERE issue_id=?1 ORDER BY ordering")
    )?;
    let old_lists = err(err(lists.query_map([&source.id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
        ))
    }))?
    .collect::<std::result::Result<Vec<_>, _>>())
    .map_err(|e| e.to_string())?;
    drop(lists);
    for (old_list, title, ordering) in old_lists {
        let new_list = new_id("checklist");
        err(tx.execute(
            "INSERT INTO checklists(id,issue_id,title,ordering) VALUES(?1,?2,?3,?4)",
            params![&new_list, &id, title, ordering],
        ))?;
        let mut items = err(tx.prepare("SELECT item_text,item_done,ordering FROM checklist_items WHERE checklist_id=?1 ORDER BY ordering"))?;
        let old_items = err(err(items.query_map([&old_list], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, i64>(2)?,
            ))
        }))?
        .collect::<std::result::Result<Vec<_>, _>>())
        .map_err(|e| e.to_string())?;
        drop(items);
        for (item_text, item_done, item_ordering) in old_items {
            err(tx.execute("INSERT INTO checklist_items(id,checklist_id,parent_id,item_text,item_done,ordering) VALUES(?1,?2,NULL,?3,?4,?5)", params![new_id("item"),&new_list,item_text,item_done,item_ordering]))?;
        }
    }
    err(tx.execute("INSERT INTO issue_attachments(id,issue_id,file_name,mime_type,byte_length,data_url) SELECT 'issue-attachment-' || lower(hex(randomblob(16))),?1,file_name,mime_type,byte_length,data_url FROM issue_attachments WHERE issue_id=?2", params![&id,&source.id]))?;
    record_activity(
        &tx,
        &id,
        "cloned",
        source.created_by.as_deref(),
        Some("Issue cloned"),
    )?;
    err(tx.commit())?;
    drop(c);
    let issue = get_issue(id)?.ok_or_else(|| "Cloned issue was not found".to_string())?;
    issue_event(crate::events::ISSUE_CREATED, &issue);
    Ok(issue)
}
/// Move an issue to another project, keeping its content and mapping status/tags.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn move_issue_to_project(input: IssueTransferInput) -> Result<Issue> {
    let c = db::conn()?;
    let source = err(c.query_row("SELECT id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived,source_entity_type,source_entity_id FROM issues WHERE id=?1", [&input.issue_id], read_issue).optional())?.ok_or_else(|| "Issue not found".to_string())?;
    if source.project_id == input.target_project_id {
        return Ok(source);
    }
    let status_name: Option<String> = match &source.status_id {
        Some(id) => err(c
            .query_row("SELECT name FROM issue_statuses WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional())?,
        None => None,
    };
    let target_status: Option<String> = if let Some(name) = status_name { err(c.query_row("SELECT id FROM issue_statuses WHERE project_id=?1 AND archived=0 AND name=?2 ORDER BY ordering LIMIT 1", params![&input.target_project_id,name], |r| r.get(0)).optional())? } else { None }.or(err(c.query_row("SELECT id FROM issue_statuses WHERE project_id=?1 AND archived=0 ORDER BY ordering LIMIT 1", [&input.target_project_id], |r| r.get(0)).optional())?);
    let number: i64 = err(c.query_row(
        "SELECT coalesce(max(number),0)+1 FROM issues WHERE project_id=?1",
        [&input.target_project_id],
        |r| r.get(0),
    ))?;
    err(c.execute(
        "UPDATE issues SET project_id=?2,number=?3,status_id=?4 WHERE id=?1",
        params![&source.id, &input.target_project_id, number, target_status],
    ))?;
    // Tags are project-scoped; recreate missing target tags while retaining names.
    let mut tags = err(c.prepare("SELECT t.name FROM planning_tags t JOIN issue_tags it ON it.tag_id=t.id WHERE it.issue_id=?1"))?;
    let names = err(
        err(tags.query_map([&source.id], |r| r.get::<_, String>(0)))?
            .collect::<std::result::Result<Vec<_>, _>>(),
    )
    .map_err(|e| e.to_string())?;
    drop(tags);
    err(c.execute("DELETE FROM issue_tags WHERE issue_id=?1", [&source.id]))?;
    for name in names {
        let tag_id: String = match err(c.query_row("SELECT id FROM planning_tags WHERE project_id=?1 AND name=?2 AND archived=0 ORDER BY id LIMIT 1", params![&input.target_project_id,&name], |r| r.get(0)).optional())? { Some(id)=>id, None=>{let id=new_id("tag");err(c.execute("INSERT INTO planning_tags(id,project_id,parent_id,name,archived) VALUES(?1,?2,NULL,?3,0)",params![&id,&input.target_project_id,&name]))?;id} };
        err(c.execute(
            "INSERT INTO issue_tags(issue_id,tag_id) VALUES(?1,?2)",
            params![&source.id, tag_id],
        ))?;
    }
    record_activity(
        &c,
        &source.id,
        "moved",
        source.created_by.as_deref(),
        Some("Issue moved to another project"),
    )?;
    drop(c);
    let issue = get_issue(source.id)?.ok_or_else(|| "Moved issue was not found".to_string())?;
    issue_event(crate::events::ISSUE_UPDATED, &issue);
    Ok(issue)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_issue(issue: Issue) -> Result<Issue> {
    valid_anchor(&issue.source_entity_type, &issue.source_entity_id)?;
    let c = db::conn()?;
    err(c.execute("UPDATE issues SET title=?2,description=?3,status_id=?4,assignee_id=?5,due_date=?6,priority=?7,archived=?8,source_entity_type=?9,source_entity_id=?10 WHERE id=?1",params![issue.id,issue.title,issue.description,issue.status_id,issue.assignee_id,issue.due_date,issue.priority,issue.archived,issue.source_entity_type,issue.source_entity_id]))?;
    // The people list wins when it is sent; a legacy single-assignee write still works.
    let people = if issue.assignee_ids.is_empty() {
        issue.assignee_id.clone().into_iter().collect()
    } else {
        issue.assignee_ids.clone()
    };
    write_assignees(&c, &issue.id, &people)?;
    record_activity(
        &c,
        &issue.id,
        "updated",
        issue.created_by.as_deref(),
        Some("Issue updated"),
    )?;
    drop(c);
    let saved = get_issue(issue.id)?.ok_or_else(|| "Issue not found".to_string())?;
    issue_event(crate::events::ISSUE_UPDATED, &saved);
    Ok(saved)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_issue(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE issues SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    record_activity(
        &c,
        &id,
        if archived { "archived" } else { "restored" },
        None,
        None,
    )?;
    drop(c);
    // The command returns nothing, so the payload has to be read back for the event.
    if let Some(issue) = get_issue(id)? {
        issue_event(crate::events::ISSUE_ARCHIVED, &issue);
    }
    Ok(())
}

fn list_statuses_on(c: &Connection, project: Option<&str>) -> Result<Vec<IssueStatus>> {
    let mut s=err(c.prepare("SELECT id,project_id,name,resolved,color,ordering FROM issue_statuses WHERE archived=0 AND (?1 IS NULL OR project_id=?1) ORDER BY project_id,ordering"))?;
    let rows = err(s.query_map([project], |r| {
        Ok(IssueStatus {
            id: r.get(0)?,
            project_id: r.get(1)?,
            name: r.get(2)?,
            resolved: r.get(3)?,
            color: r.get(4)?,
            ordering: r.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issue_statuses(project_id: Option<String>) -> Result<Vec<IssueStatus>> {
    list_statuses_on(&db::conn()?, project_id.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_issue_status(input: StatusInput) -> Result<IssueStatus> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("status"));
    let ordering = input.ordering.unwrap_or(err(c.query_row(
        "SELECT coalesce(max(ordering),-1)+1 FROM issue_statuses WHERE project_id=?1",
        [&input.project_id],
        |r| r.get(0),
    ))?);
    err(c.execute("INSERT INTO issue_statuses(id,project_id,name,resolved,color,ordering) VALUES(?1,?2,?3,?4,?5,?6)",params![id,input.project_id,input.name,input.resolved,input.color,ordering]))?;
    Ok(IssueStatus {
        id,
        project_id: input.project_id,
        name: input.name,
        resolved: input.resolved,
        color: input.color,
        ordering,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_issue_status(status: IssueStatus) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE issue_statuses SET name=?2,resolved=?3,color=?4,ordering=?5 WHERE id=?1",
        params![
            status.id,
            status.name,
            status.resolved,
            status.color,
            status.ordering
        ],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_issue_status(id: String) -> Result<()> {
    let c = db::conn()?;
    let n: i64 = err(c.query_row(
        "SELECT count(*) FROM issues WHERE status_id=?1",
        [&id],
        |r| r.get(0),
    ))?;
    if n > 0 {
        return Err("Cannot delete a status assigned to issues".into());
    };
    err(c.execute("DELETE FROM column_statuses WHERE status_id=?1", [&id]))?;
    err(c.execute("DELETE FROM issue_statuses WHERE id=?1", [id]))?;
    Ok(())
}

fn read_board(r: &rusqlite::Row<'_>) -> rusqlite::Result<Board> {
    Ok(Board {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        backlog_type: r.get(3)?,
        archived: r.get(4)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_boards(project_id: Option<String>) -> Result<Vec<Board>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,project_id,name,backlog_type,archived FROM boards WHERE (?1 IS NULL OR project_id=?1) AND archived=0 ORDER BY name"))?;
    let rows = err(s.query_map([project_id], read_board))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_board(input: BoardInput) -> Result<Board> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("board"));
    let backlog_type = input.backlog_type.unwrap_or_else(|| "MANUAL".into());
    if !matches!(backlog_type.as_str(), "MANUAL" | "SEARCH_BASED") {
        return Err("backlog_type must be MANUAL or SEARCH_BASED".into());
    };
    let board = Board {
        id,
        project_id: input.project_id,
        name: input.name,
        backlog_type,
        archived: input.archived.unwrap_or(false),
    };
    err(c.execute(
        "INSERT INTO boards(id,project_id,name,backlog_type,archived) VALUES(?1,?2,?3,?4,?5)",
        params![
            board.id,
            board.project_id,
            board.name,
            board.backlog_type,
            board.archived
        ],
    ))?;
    Ok(board)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_board(board: Board) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE boards SET name=?2,backlog_type=?3,archived=?4 WHERE id=?1",
        params![board.id, board.name, board.backlog_type, board.archived],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_board(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM issue_board_positions WHERE board_id=?1", [&id]))?;
    err(c.execute("DELETE FROM column_statuses WHERE column_id IN (SELECT id FROM board_columns WHERE board_id=?1)",[&id]))?;
    err(c.execute("DELETE FROM board_columns WHERE board_id=?1", [&id]))?;
    err(c.execute("DELETE FROM boards WHERE id=?1", [id]))?;
    Ok(())
}
fn columns_on(c: &Connection, board_id: &str) -> Result<Vec<BoardColumn>> {
    let mut s = err(c.prepare(
        "SELECT id,board_id,name,ordering FROM board_columns WHERE board_id=?1 ORDER BY ordering",
    ))?;
    let rows = err(s.query_map([board_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
        ))
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    rows.into_iter()
        .map(|(id, board_id, name, ordering)| {
            let mut ss = err(c.prepare(
                "SELECT status_id FROM column_statuses WHERE column_id=?1 ORDER BY status_id",
            ))?;
            let status_ids = err(ss.query_map([&id], |r| r.get(0)))?
                .collect::<std::result::Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(BoardColumn {
                id,
                board_id,
                name,
                ordering,
                status_ids,
            })
        })
        .collect()
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_board_columns(board_id: String) -> Result<Vec<BoardColumn>> {
    columns_on(&db::conn()?, &board_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_board_column(input: ColumnInput) -> Result<BoardColumn> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("column"));
    let ordering = input.ordering.unwrap_or(err(c.query_row(
        "SELECT coalesce(max(ordering),-1)+1 FROM board_columns WHERE board_id=?1",
        [&input.board_id],
        |r| r.get(0),
    ))?);
    let board_project: String = err(c.query_row(
        "SELECT project_id FROM boards WHERE id=?1",
        [&input.board_id],
        |r| r.get(0),
    ))?;
    for status_id in &input.status_ids {
        let status_project: String = err(c.query_row(
            "SELECT project_id FROM issue_statuses WHERE id=?1",
            [status_id],
            |r| r.get(0),
        ))?;
        if status_project != board_project {
            return Err("A board column can only map statuses in its project".into());
        }
    }
    err(c.execute("INSERT INTO board_columns(id,board_id,name,ordering) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,ordering=excluded.ordering",params![id,input.board_id,input.name,ordering]))?;
    err(c.execute("DELETE FROM column_statuses WHERE column_id=?1", [&id]))?;
    for status_id in &input.status_ids {
        err(c.execute(
            "INSERT INTO column_statuses(column_id,status_id) VALUES(?1,?2)",
            params![id, status_id],
        ))?;
    }
    Ok(BoardColumn {
        id,
        board_id: input.board_id,
        name: input.name,
        ordering,
        status_ids: input.status_ids,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_board_column(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM column_statuses WHERE column_id=?1", [&id]))?;
    err(c.execute("DELETE FROM board_columns WHERE id=?1", [id]))?;
    Ok(())
}

fn move_on(
    c: &Connection,
    board_id: &str,
    issue_id: &str,
    column_id: &str,
    sprint_id: Option<&str>,
    swimlane_id: Option<&str>,
    position: Option<i64>,
) -> Result<()> {
    let status_id:String=err(c.query_row("SELECT cs.status_id FROM board_columns bc JOIN column_statuses cs ON cs.column_id=bc.id WHERE bc.id=?1 AND bc.board_id=?2 ORDER BY cs.status_id LIMIT 1",params![column_id,board_id],|r|r.get(0)).optional())?.ok_or_else(||"Column needs at least one mapped status before moving issues".to_string())?;
    let issue_project: String = err(c.query_row(
        "SELECT project_id FROM issues WHERE id=?1",
        [issue_id],
        |r| r.get(0),
    ))?;
    let board_project: String = err(c.query_row(
        "SELECT project_id FROM boards WHERE id=?1",
        [board_id],
        |r| r.get(0),
    ))?;
    if issue_project != board_project {
        return Err("Issue and board must belong to the same project".into());
    };
    let position = position.unwrap_or(err(c.query_row(
        "SELECT coalesce(max(position),-1)+1 FROM issue_board_positions WHERE board_id=?1",
        [board_id],
        |r| r.get(0),
    ))?);
    let tx = err(c.unchecked_transaction())?;
    err(tx.execute(
        "UPDATE issues SET status_id=?2 WHERE id=?1",
        params![issue_id, status_id],
    ))?;
    err(tx.execute("INSERT INTO issue_board_positions(issue_id,board_id,sprint_id,swimlane_id,position) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(issue_id,board_id) DO UPDATE SET sprint_id=excluded.sprint_id,swimlane_id=excluded.swimlane_id,position=excluded.position",params![issue_id,board_id,sprint_id,swimlane_id,position]))?;
    err(tx.commit())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn move_issue_on_board(
    board_id: String,
    issue_id: String,
    column_id: String,
    sprint_id: Option<String>,
    swimlane_id: Option<String>,
    position: Option<i64>,
) -> Result<()> {
    move_on(
        &db::conn()?,
        &board_id,
        &issue_id,
        &column_id,
        sprint_id.as_deref(),
        swimlane_id.as_deref(),
        position,
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_board_issues(board_id: String, sprint_id: Option<String>) -> Result<Vec<Issue>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived,i.source_entity_type,i.source_entity_id FROM issue_board_positions p JOIN issues i ON i.id=p.issue_id WHERE p.board_id=?1 AND (?2 IS NULL OR p.sprint_id=?2) ORDER BY p.position"))?;
    let mut rows = err(s.query_map(params![board_id, sprint_id], read_issue))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    fill_assignees(&c, &mut rows)?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_backlog_issues(board_id: String) -> Result<Vec<Issue>> {
    let c = db::conn()?;
    let project: String = err(c.query_row(
        "SELECT project_id FROM boards WHERE id=?1",
        [&board_id],
        |r| r.get(0),
    ))?;
    let mut s=err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived,i.source_entity_type,i.source_entity_id FROM issues i WHERE i.project_id=?1 AND i.archived=0 AND NOT EXISTS(SELECT 1 FROM issue_board_positions p WHERE p.issue_id=i.id AND p.board_id=?2) ORDER BY i.number"))?;
    let mut rows = err(s.query_map(params![project, board_id], read_issue))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    fill_assignees(&c, &mut rows)?;
    Ok(rows)
}
fn nonempty_unique_ids(issue_ids: &[String]) -> Result<()> {
    if issue_ids.is_empty() || issue_ids.iter().any(|id| id.is_empty()) {
        return Err("Select at least one issue".into());
    }
    let mut unique = issue_ids.to_vec();
    unique.sort();
    unique.dedup();
    if unique.len() != issue_ids.len() {
        return Err("An issue can be selected only once".into());
    }
    Ok(())
}

fn checked_board_project(c: &Connection, board_id: &str) -> Result<String> {
    err(c.query_row(
        "SELECT project_id FROM boards WHERE id=?1",
        [board_id],
        |r| r.get(0),
    ))
}

fn checked_issue_project(c: &Connection, issue_ids: &[String], project_id: &str) -> Result<()> {
    for issue_id in issue_ids {
        let issue_project: String = err(c.query_row(
            "SELECT project_id FROM issues WHERE id=?1",
            [issue_id],
            |r| r.get(0),
        ))?;
        if issue_project != project_id {
            return Err("Every selected issue must belong to the board project".into());
        }
    }
    Ok(())
}

/// Space's bulk `addIssuesToBacklogs` equivalent: selected project issues enter one
/// board column together, retaining a deterministic contiguous order.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn bulk_move_issues_on_board(input: BulkBoardMoveInput) -> Result<()> {
    nonempty_unique_ids(&input.issue_ids)?;
    let c = db::conn()?;
    let project_id = checked_board_project(&c, &input.board_id)?;
    checked_issue_project(&c, &input.issue_ids, &project_id)?;
    let status_id: String = err(c.query_row("SELECT cs.status_id FROM board_columns bc JOIN column_statuses cs ON cs.column_id=bc.id WHERE bc.id=?1 AND bc.board_id=?2 ORDER BY cs.status_id LIMIT 1", params![input.column_id, input.board_id], |r| r.get(0)).optional())?.ok_or_else(|| "Column needs at least one mapped status before moving issues".to_string())?;
    if let Some(sprint_id) = &input.sprint_id {
        let sprint_board: String = err(c.query_row(
            "SELECT board_id FROM sprints WHERE id=?1 AND archived=0",
            [sprint_id],
            |r| r.get(0),
        ))?;
        if sprint_board != input.board_id {
            return Err("Sprint must belong to the board".into());
        }
    }
    let first_position: i64 = err(c.query_row(
        "SELECT coalesce(max(position),-1)+1 FROM issue_board_positions WHERE board_id=?1",
        [&input.board_id],
        |r| r.get(0),
    ))?;
    let tx = err(c.unchecked_transaction())?;
    for (offset, issue_id) in input.issue_ids.iter().enumerate() {
        err(tx.execute(
            "UPDATE issues SET status_id=?2 WHERE id=?1",
            params![issue_id, status_id],
        ))?;
        err(tx.execute("INSERT INTO issue_board_positions(issue_id,board_id,sprint_id,swimlane_id,position) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(issue_id,board_id) DO UPDATE SET sprint_id=excluded.sprint_id,swimlane_id=excluded.swimlane_id,position=excluded.position", params![issue_id, input.board_id, input.sprint_id, input.swimlane_id, first_position + offset as i64]))?;
    }
    err(tx.commit())
}

/// Space's bulk `removeIssuesFromBacklogs` equivalent: atomically remove board membership.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn bulk_remove_issues_from_board(input: BulkBoardRemoveInput) -> Result<()> {
    nonempty_unique_ids(&input.issue_ids)?;
    let c = db::conn()?;
    checked_board_project(&c, &input.board_id)?;
    for issue_id in &input.issue_ids {
        let present: Option<i64> = err(c
            .query_row(
                "SELECT 1 FROM issue_board_positions WHERE board_id=?1 AND issue_id=?2",
                params![input.board_id, issue_id],
                |r| r.get(0),
            )
            .optional())?;
        if present.is_none() {
            return Err("Every selected issue must be on the board".into());
        }
    }
    let tx = err(c.unchecked_transaction())?;
    for issue_id in &input.issue_ids {
        err(tx.execute(
            "DELETE FROM issue_board_positions WHERE board_id=?1 AND issue_id=?2",
            params![input.board_id, issue_id],
        ))?;
    }
    err(tx.commit())
}

/// Space's `bulkUpdateIssuesSprints`: preserve board membership/status while changing sprint.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn bulk_update_issues_sprints(input: BulkSprintUpdateInput) -> Result<()> {
    nonempty_unique_ids(&input.issue_ids)?;
    let c = db::conn()?;
    checked_board_project(&c, &input.board_id)?;
    if let Some(sprint_id) = &input.sprint_id {
        let sprint_board: String = err(c.query_row(
            "SELECT board_id FROM sprints WHERE id=?1 AND archived=0",
            [sprint_id],
            |r| r.get(0),
        ))?;
        if sprint_board != input.board_id {
            return Err("Sprint must belong to the board".into());
        }
    }
    for issue_id in &input.issue_ids {
        let present: Option<i64> = err(c
            .query_row(
                "SELECT 1 FROM issue_board_positions WHERE board_id=?1 AND issue_id=?2",
                params![input.board_id, issue_id],
                |r| r.get(0),
            )
            .optional())?;
        if present.is_none() {
            return Err("Every selected issue must be on the board".into());
        }
    }
    let tx = err(c.unchecked_transaction())?;
    for issue_id in &input.issue_ids {
        err(tx.execute(
            "UPDATE issue_board_positions SET sprint_id=?3 WHERE board_id=?1 AND issue_id=?2",
            params![input.board_id, issue_id, input.sprint_id],
        ))?;
    }
    err(tx.commit())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_issue_from_board(board_id: String, issue_id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "DELETE FROM issue_board_positions WHERE board_id=?1 AND issue_id=?2",
        params![board_id, issue_id],
    ))?;
    Ok(())
}

fn read_sprint(r: &rusqlite::Row<'_>) -> rusqlite::Result<Sprint> {
    Ok(Sprint {
        id: r.get(0)?,
        board_id: r.get(1)?,
        name: r.get(2)?,
        state: r.get(3)?,
        starts_on: r.get(4)?,
        ends_on: r.get(5)?,
        description: r.get(6)?,
        archived: r.get(7)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_sprints(board_id: Option<String>) -> Result<Vec<Sprint>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,board_id,name,state,starts_on,ends_on,description,archived FROM sprints WHERE (?1 IS NULL OR board_id=?1) AND archived=0 ORDER BY starts_on,name"))?;
    let rows = err(s.query_map([board_id], read_sprint))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_sprint(input: SprintInput) -> Result<Sprint> {
    let c = db::conn()?;
    let sprint = Sprint {
        id: input.id.unwrap_or_else(|| new_id("sprint")),
        board_id: input.board_id,
        name: input.name,
        state: "PLANNED".into(),
        starts_on: input.starts_on,
        ends_on: input.ends_on,
        description: input.description,
        archived: false,
    };
    err(c.execute("INSERT INTO sprints(id,board_id,name,state,starts_on,ends_on,description,archived) VALUES(?1,?2,?3,?4,?5,?6,?7,0)",params![sprint.id,sprint.board_id,sprint.name,sprint.state,sprint.starts_on,sprint.ends_on,sprint.description]))?;
    Ok(sprint)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_sprint(sprint: Sprint) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE sprints SET name=?2,starts_on=?3,ends_on=?4,description=?5 WHERE id=?1",
        params![
            sprint.id,
            sprint.name,
            sprint.starts_on,
            sprint.ends_on,
            sprint.description
        ],
    ))?;
    Ok(())
}
fn launch_on(c: &Connection, id: &str) -> Result<()> {
    let (board_id, state): (String, String) = err(c.query_row(
        "SELECT board_id,state FROM sprints WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ))?;
    if state != "PLANNED" {
        return Err("Only planned sprints can be launched".into());
    };
    let tx = err(c.unchecked_transaction())?;
    let current: Option<String> = err(tx
        .query_row(
            "SELECT id FROM sprints WHERE board_id=?1 AND state='CURRENT' AND archived=0",
            [&board_id],
            |r| r.get(0),
        )
        .optional())?;
    if let Some(old) = current {
        err(tx.execute("UPDATE sprints SET state='CLOSED' WHERE id=?1", [&old]))?;
        err(tx.execute("UPDATE issue_board_positions SET sprint_id=?1 WHERE board_id=?2 AND sprint_id=?3 AND issue_id IN (SELECT i.id FROM issues i LEFT JOIN issue_statuses s ON s.id=i.status_id WHERE coalesce(s.resolved,0)=0)",params![id,&board_id,old]))?;
    };
    err(tx.execute("UPDATE sprints SET state='CURRENT' WHERE id=?1", [id]))?;
    err(tx.commit())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn launch_sprint(id: String) -> Result<()> {
    launch_on(&db::conn()?, &id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn close_sprint(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE sprints SET state='CLOSED' WHERE id=?1 AND state='CURRENT'",
        [id],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_sprint(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE sprints SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_sprint(id: String) -> Result<()> {
    let c = db::conn()?;
    let state: String =
        err(c.query_row("SELECT state FROM sprints WHERE id=?1", [&id], |r| r.get(0)))?;
    if state == "CURRENT" {
        return Err("A current sprint cannot be deleted".into());
    };
    err(c.execute(
        "DELETE FROM issue_board_positions WHERE sprint_id=?1",
        [&id],
    ))?;
    err(c.execute("DELETE FROM sprints WHERE id=?1", [id]))?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_board_card_settings(board_id: String) -> Result<BoardCardSettings> {
    let c = db::conn()?;
    let json: Option<String> = err(c
        .query_row(
            "SELECT fields_json FROM board_card_settings WHERE board_id=?1",
            [&board_id],
            |r| r.get(0),
        )
        .optional())?;
    let fields = json
        .map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or_else(|| {
            vec![
                "priority".into(),
                "due_date".into(),
                "assignees".into(),
                "checklists".into(),
                "subitems".into(),
            ]
        });
    Ok(BoardCardSettings { board_id, fields })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_board_card_settings(settings: BoardCardSettings) -> Result<BoardCardSettings> {
    const CARD_FIELDS: &[&str] = &[
        "priority",
        "due_date",
        "assignees",
        "checklists",
        "subitems",
    ];
    if settings
        .fields
        .iter()
        .any(|field| !CARD_FIELDS.contains(&field.as_str()))
    {
        return Err("Unsupported board card field".into());
    }
    let c = db::conn()?;
    let json = serde_json::to_string(&settings.fields).map_err(|e| e.to_string())?;
    err(c.execute("INSERT INTO board_card_settings(board_id,fields_json) VALUES(?1,?2) ON CONFLICT(board_id) DO UPDATE SET fields_json=excluded.fields_json", params![settings.board_id, json]))?;
    Ok(settings)
}

fn read_swimlane(r: &rusqlite::Row<'_>) -> rusqlite::Result<Swimlane> {
    Ok(Swimlane {
        id: r.get(0)?,
        board_id: r.get(1)?,
        sprint_id: r.get(2)?,
        name: r.get(3)?,
        is_default: r.get(4)?,
        ordering: r.get(5)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_swimlanes(board_id: String, sprint_id: Option<String>) -> Result<Vec<Swimlane>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,board_id,sprint_id,name,is_default,ordering FROM swimlanes WHERE board_id=?1 AND (?2 IS NULL OR sprint_id=?2) ORDER BY ordering"))?;
    let rows = err(s.query_map(params![board_id, sprint_id], read_swimlane))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_swimlane(input: SwimlaneInput) -> Result<Swimlane> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("swimlane"));
    let ordering = input.ordering.unwrap_or(err(c.query_row(
        "SELECT coalesce(max(ordering),-1)+1 FROM swimlanes WHERE board_id=?1",
        [&input.board_id],
        |r| r.get(0),
    ))?);
    if input.is_default {
        err(c.execute(
            "UPDATE swimlanes SET is_default=0 WHERE board_id=?1",
            [&input.board_id],
        ))?;
    };
    err(c.execute("INSERT INTO swimlanes(id,board_id,sprint_id,name,is_default,ordering) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET sprint_id=excluded.sprint_id,name=excluded.name,is_default=excluded.is_default,ordering=excluded.ordering",params![id,input.board_id,input.sprint_id,input.name,input.is_default,ordering]))?;
    Ok(Swimlane {
        id,
        board_id: input.board_id,
        sprint_id: input.sprint_id,
        name: input.name,
        is_default: input.is_default,
        ordering,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_swimlane(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE issue_board_positions SET swimlane_id=NULL WHERE swimlane_id=?1",
        [&id],
    ))?;
    err(c.execute("DELETE FROM swimlanes WHERE id=?1", [id]))?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_planning_tags(project_id: String) -> Result<Vec<PlanningTag>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,project_id,parent_id,name,archived FROM planning_tags WHERE project_id=?1 AND archived=0 ORDER BY name"))?;
    let rows = err(s.query_map([project_id], |r| {
        Ok(PlanningTag {
            id: r.get(0)?,
            project_id: r.get(1)?,
            parent_id: r.get(2)?,
            name: r.get(3)?,
            archived: r.get(4)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_planning_tag(input: TagInput) -> Result<PlanningTag> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("tag"));
    if let Some(parent) = &input.parent_id {
        let p: String = err(c.query_row(
            "SELECT project_id FROM planning_tags WHERE id=?1",
            [parent],
            |r| r.get(0),
        ))?;
        if p != input.project_id {
            return Err("Tag parent must be in the same project".into());
        }
    };
    let tag = PlanningTag {
        id,
        project_id: input.project_id,
        parent_id: input.parent_id,
        name: input.name,
        archived: input.archived.unwrap_or(false),
    };
    err(c.execute("INSERT INTO planning_tags(id,project_id,parent_id,name,archived) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,archived=excluded.archived",params![tag.id,tag.project_id,tag.parent_id,tag.name,tag.archived]))?;
    Ok(tag)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_planning_tag(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM issue_tags WHERE tag_id=?1", [&id]))?;
    err(c.execute("DELETE FROM planning_tags WHERE id=?1", [id]))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_issue_tags(issue_id: String, tag_ids: Vec<String>) -> Result<()> {
    let c = db::conn()?;
    let project: String = err(c.query_row(
        "SELECT project_id FROM issues WHERE id=?1",
        [&issue_id],
        |r| r.get(0),
    ))?;
    let tx = err(c.unchecked_transaction())?;
    err(tx.execute("DELETE FROM issue_tags WHERE issue_id=?1", [&issue_id]))?;
    for tag in tag_ids {
        let tag_project: String = err(tx.query_row(
            "SELECT project_id FROM planning_tags WHERE id=?1",
            [&tag],
            |r| r.get(0),
        ))?;
        if tag_project != project {
            return Err("Tags must belong to the issue project".into());
        };
        err(tx.execute(
            "INSERT INTO issue_tags(issue_id,tag_id) VALUES(?1,?2)",
            params![issue_id, tag],
        ))?;
    }
    err(tx.commit())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_checklists(issue_id: String) -> Result<Vec<Checklist>> {
    let c = db::conn()?;
    let mut s = err(c.prepare(
        "SELECT id,issue_id,title,ordering FROM checklists WHERE issue_id=?1 ORDER BY ordering",
    ))?;
    let rows = err(s.query_map([issue_id], |r| {
        Ok(Checklist {
            id: r.get(0)?,
            issue_id: r.get(1)?,
            title: r.get(2)?,
            ordering: r.get(3)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_checklist(input: ChecklistInput) -> Result<Checklist> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("checklist"));
    let ordering = input.ordering.unwrap_or(err(c.query_row(
        "SELECT coalesce(max(ordering),-1)+1 FROM checklists WHERE issue_id=?1",
        [&input.issue_id],
        |r| r.get(0),
    ))?);
    err(c.execute("INSERT INTO checklists(id,issue_id,title,ordering) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,ordering=excluded.ordering",params![id,input.issue_id,input.title,ordering]))?;
    Ok(Checklist {
        id,
        issue_id: input.issue_id,
        title: input.title,
        ordering,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_checklist(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM checklist_items WHERE checklist_id=?1", [&id]))?;
    err(c.execute("DELETE FROM checklists WHERE id=?1", [id]))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_checklist_items(checklist_id: String) -> Result<Vec<ChecklistItem>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,checklist_id,parent_id,item_text,item_done,ordering FROM checklist_items WHERE checklist_id=?1 ORDER BY ordering"))?;
    let rows = err(s.query_map([checklist_id], |r| {
        Ok(ChecklistItem {
            id: r.get(0)?,
            checklist_id: r.get(1)?,
            parent_id: r.get(2)?,
            item_text: r.get(3)?,
            item_done: r.get(4)?,
            ordering: r.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_checklist_item(input: ChecklistItemInput) -> Result<ChecklistItem> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("item"));
    let ordering = input.ordering.unwrap_or(err(c.query_row(
        "SELECT coalesce(max(ordering),-1)+1 FROM checklist_items WHERE checklist_id=?1",
        [&input.checklist_id],
        |r| r.get(0),
    ))?);
    err(c.execute("INSERT INTO checklist_items(id,checklist_id,parent_id,item_text,item_done,ordering) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,item_text=excluded.item_text,item_done=excluded.item_done,ordering=excluded.ordering",params![id,input.checklist_id,input.parent_id,input.item_text,input.item_done,ordering]))?;
    Ok(ChecklistItem {
        id,
        checklist_id: input.checklist_id,
        parent_id: input.parent_id,
        item_text: input.item_text,
        item_done: input.item_done,
        ordering,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn toggle_checklist_item(id: String, item_done: bool) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE checklist_items SET item_done=?2 WHERE id=?1",
        params![id, item_done],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_checklist_item(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM checklist_items WHERE id=?1", [id]))?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_time_tracking_entries(issue_id: String) -> Result<Vec<TimeTrackingEntry>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,issue_id,profile_id,entry_date,duration_minutes,description FROM time_tracking_entries WHERE issue_id=?1 ORDER BY entry_date DESC"))?;
    let rows = err(s.query_map([issue_id], |r| {
        Ok(TimeTrackingEntry {
            id: r.get(0)?,
            issue_id: r.get(1)?,
            profile_id: r.get(2)?,
            entry_date: r.get(3)?,
            duration_minutes: r.get(4)?,
            description: r.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_time_tracking_entry(input: TimeEntryInput) -> Result<TimeTrackingEntry> {
    if input.duration_minutes <= 0 {
        return Err("Duration must be positive".into());
    };
    let c = db::conn()?;
    let entry = TimeTrackingEntry {
        id: input.id.unwrap_or_else(|| new_id("time")),
        issue_id: input.issue_id,
        profile_id: input.profile_id,
        entry_date: input.entry_date,
        duration_minutes: input.duration_minutes,
        description: input.description,
    };
    err(c.execute("INSERT INTO time_tracking_entries(id,issue_id,profile_id,entry_date,duration_minutes,description) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET entry_date=excluded.entry_date,duration_minutes=excluded.duration_minutes,description=excluded.description",params![entry.id,entry.issue_id,entry.profile_id,entry.entry_date,entry.duration_minutes,entry.description]))?;
    Ok(entry)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_time_tracking_entry(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM time_tracking_entries WHERE id=?1", [id]))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn issue_time_total(issue_id: String) -> Result<i64> {
    let c = db::conn()?;
    err(c.query_row(
        "SELECT coalesce(sum(duration_minutes),0) FROM time_tracking_entries WHERE issue_id=?1",
        [issue_id],
        |r| r.get(0),
    ))
}

fn reachable(c: &Connection, from: &str, target: &str) -> Result<bool> {
    let mut current = vec![from.to_string()];
    let mut seen = std::collections::HashSet::new();
    while let Some(id) = current.pop() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if id == target {
            return Ok(true);
        }
        let mut s=err(c.prepare("SELECT linked_issue_id FROM issue_links WHERE issue_id=?1 AND link_type='PARENT_CHILD'"))?;
        let next = err(s.query_map([id], |r| r.get::<_, String>(0)))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        current.extend(next)
    }
    Ok(false)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_issue_child(parent_id: String, child_id: String) -> Result<IssueLink> {
    if parent_id == child_id {
        return Err("An issue cannot be its own child".into());
    };
    let c = db::conn()?;
    if reachable(&c, &child_id, &parent_id)? {
        return Err("Parent/child link would create a cycle".into());
    };
    let link = IssueLink {
        id: new_id("link"),
        issue_id: parent_id,
        linked_issue_id: child_id,
        link_type: "PARENT_CHILD".into(),
    };
    err(c.execute(
        "INSERT INTO issue_links(id,issue_id,linked_issue_id,link_type) VALUES(?1,?2,?3,?4)",
        params![link.id, link.issue_id, link.linked_issue_id, link.link_type],
    ))?;
    Ok(link)
}
fn valid_external_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issue_tracker_links(issue_id: String) -> Result<Vec<TrackerLink>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,issue_id,target_kind,target_id,url,title FROM issue_tracker_links WHERE issue_id=?1 ORDER BY id"))?;
    let rows = err(s.query_map([issue_id], |r| {
        Ok(TrackerLink {
            id: r.get(0)?,
            issue_id: r.get(1)?,
            target_kind: r.get(2)?,
            target_id: r.get(3)?,
            url: r.get(4)?,
            title: r.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_issue_tracker_link(input: TrackerLinkInput) -> Result<TrackerLink> {
    let kind = input.target_kind.to_uppercase();
    if !matches!(kind.as_str(), "ISSUE" | "REVIEW" | "EXTERNAL") {
        return Err("target_kind must be ISSUE, REVIEW, or EXTERNAL".into());
    }
    let c = db::conn()?;
    let issue_project: String = err(c.query_row(
        "SELECT project_id FROM issues WHERE id=?1",
        [&input.issue_id],
        |r| r.get(0),
    ))?;
    match kind.as_str() {
        "ISSUE" => {
            let target = input
                .target_id
                .as_deref()
                .ok_or("Issue target is required")?;
            if target == input.issue_id {
                return Err("An issue cannot link to itself".into());
            };
            let project: String = err(c.query_row(
                "SELECT project_id FROM issues WHERE id=?1",
                [target],
                |r| r.get(0),
            ))?;
            if project != issue_project {
                return Err("Linked issues must be in the same project".into());
            }
        }
        "REVIEW" => {
            let target = input
                .target_id
                .as_deref()
                .ok_or("Review target is required")?;
            let project: String = err(c.query_row(
                "SELECT project_id FROM reviews WHERE id=?1",
                [target],
                |r| r.get(0),
            ))?;
            if project != issue_project {
                return Err("Linked reviews must be in the same project".into());
            }
        }
        "EXTERNAL" => {
            if input.target_id.is_some() || !input.url.as_deref().is_some_and(valid_external_url) {
                return Err("External link requires an http(s) URL".into());
            }
        }
        _ => unreachable!(),
    }
    let link = TrackerLink {
        id: new_id("tracker-link"),
        issue_id: input.issue_id,
        target_kind: kind,
        target_id: input.target_id,
        url: input.url,
        title: input.title.filter(|v| !v.trim().is_empty()),
    };
    err(c.execute("INSERT INTO issue_tracker_links(id,issue_id,target_kind,target_id,url,title) VALUES(?1,?2,?3,?4,?5,?6)",params![link.id,link.issue_id,link.target_kind,link.target_id,link.url,link.title]))?;
    record_activity(
        &c,
        &link.issue_id,
        "tracker_linked",
        None,
        link.title.as_deref().or(link.url.as_deref()),
    )?;
    Ok(link)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_issue_tracker_link(id: String) -> Result<()> {
    err(db::conn()?.execute("DELETE FROM issue_tracker_links WHERE id=?1", [id]))?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_issue_link(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM issue_links WHERE id=?1", [id]))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issue_attachments(issue_id: String) -> Result<Vec<IssueAttachment>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT id,issue_id,file_name,mime_type,byte_length,data_url FROM issue_attachments WHERE issue_id=?1 ORDER BY created_at,id"))?;
    let attachments = err(statement.query_map([issue_id], |row| {
        Ok(IssueAttachment {
            id: row.get(0)?,
            issue_id: row.get(1)?,
            file_name: row.get(2)?,
            mime_type: row.get(3)?,
            byte_length: row.get(4)?,
            data_url: row.get(5)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(attachments)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_issue_attachment(
    issue_id: String,
    attachment: IssueAttachmentInput,
) -> Result<IssueAttachment> {
    if !attachment.data_url.starts_with("data:")
        || !(0..=10 * 1024 * 1024).contains(&attachment.byte_length)
    {
        return Err("invalid attachment".into());
    }
    let c = db::conn()?;
    let item = IssueAttachment {
        id: attachment.id.unwrap_or_else(|| new_id("issue-attachment")),
        issue_id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        byte_length: attachment.byte_length,
        data_url: attachment.data_url,
    };
    err(c.execute("INSERT INTO issue_attachments(id,issue_id,file_name,mime_type,byte_length,data_url) VALUES(?1,?2,?3,?4,?5,?6)", params![item.id,item.issue_id,item.file_name,item.mime_type,item.byte_length,item.data_url]))?;
    Ok(item)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_issue_attachment(id: String) -> Result<()> {
    err(db::conn()?.execute("DELETE FROM issue_attachments WHERE id=?1", [id]))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_issue_detail(id: String) -> Result<Option<IssueDetail>> {
    let issue = match get_issue(id.clone())? {
        Some(i) => i,
        None => return Ok(None),
    };
    let c = db::conn()?;
    let mut tag_s=err(c.prepare("SELECT t.id,t.project_id,t.parent_id,t.name,t.archived FROM planning_tags t JOIN issue_tags it ON it.tag_id=t.id WHERE it.issue_id=?1"))?;
    let tags = err(tag_s.query_map([&id], |r| {
        Ok(PlanningTag {
            id: r.get(0)?,
            project_id: r.get(1)?,
            parent_id: r.get(2)?,
            name: r.get(3)?,
            archived: r.get(4)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    let checklists = list_checklists(id.clone())?;
    let time_total_minutes = issue_time_total(id.clone())?;
    let attachments = list_issue_attachments(id.clone())?;
    let comments = list_issue_comments(id.clone())?;
    let activities = list_issue_activities(id.clone())?;
    let tracker_links = list_issue_tracker_links(id.clone())?;
    let mut child_s=err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived,i.source_entity_type,i.source_entity_id FROM issues i JOIN issue_links l ON l.linked_issue_id=i.id WHERE l.issue_id=?1 AND l.link_type='PARENT_CHILD'"))?;
    let mut children = err(child_s.query_map([id], read_issue))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    fill_assignees(&c, &mut children)?;
    Ok(Some(IssueDetail {
        issue,
        tags,
        checklists,
        time_total_minutes,
        children,
        attachments,
        comments,
        activities,
        tracker_links,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> Connection {
        let c = crate::db::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE issues(id TEXT PRIMARY KEY,project_id TEXT,number INT,title TEXT,description TEXT,status_id TEXT,assignee_id TEXT,created_by TEXT,due_date TEXT,archived INT);CREATE TABLE issue_statuses(id TEXT PRIMARY KEY,project_id TEXT,name TEXT,resolved INT,color TEXT,ordering INT,archived INT DEFAULT 0);CREATE TABLE boards(id TEXT PRIMARY KEY,project_id TEXT,name TEXT,backlog_type TEXT,archived INT);CREATE TABLE board_columns(id TEXT PRIMARY KEY,board_id TEXT,name TEXT,ordering INT);CREATE TABLE column_statuses(column_id TEXT,status_id TEXT);CREATE TABLE sprints(id TEXT PRIMARY KEY,board_id TEXT,name TEXT,state TEXT,starts_on TEXT,ends_on TEXT,description TEXT,archived INT);CREATE TABLE issue_board_positions(issue_id TEXT,board_id TEXT,sprint_id TEXT,swimlane_id TEXT,position INT,PRIMARY KEY(issue_id,board_id));CREATE TABLE issue_links(id TEXT,issue_id TEXT,linked_issue_id TEXT,link_type TEXT);").unwrap();
        c
    }
    /// A ticket raised out of a channel must still know where it came from after a
    /// round-trip through storage — that is the entire point of V133's two columns.
    #[test]
    fn source_anchor_round_trips_on_an_issue() {
        let c = crate::db::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c.execute("INSERT INTO projects(id,name,key,archived,created_at) VALUES('p','P','P',0,unixepoch())", []).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived,source_entity_type,source_entity_id) VALUES('i','p',1,'Ship notes',0,'message','m-1')", []).unwrap();
        let issue = c.query_row("SELECT id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived,source_entity_type,source_entity_id FROM issues WHERE id=?1", ["i"], read_issue).unwrap();
        assert_eq!(issue.source_entity_type.as_deref(), Some("message"));
        assert_eq!(issue.source_entity_id.as_deref(), Some("m-1"));
        assert_eq!(
            issue.title, "Ship notes",
            "the anchor adds to the row, it does not replace it"
        );
    }

    /// Half an anchor is a pointer nothing can follow, so it is refused on the way in
    /// rather than stored and rendered as a dead link later.
    #[test]
    fn an_issue_anchor_is_both_halves_or_neither() {
        assert!(valid_anchor(&None, &None).is_ok());
        assert!(valid_anchor(&Some("message".into()), &Some("m-1".into())).is_ok());
        assert!(valid_anchor(&Some("message".into()), &None).is_err());
        assert!(valid_anchor(&None, &Some("m-1".into())).is_err());
    }

    #[test]
    fn bulk_selection_requires_unique_nonempty_issue_ids() {
        assert!(nonempty_unique_ids(&[]).is_err());
        assert!(nonempty_unique_ids(&["i".into(), "i".into()]).is_err());
        assert!(nonempty_unique_ids(&["i1".into(), "i2".into()]).is_ok());
    }
    #[test]
    fn tracker_link_schema_rejects_mismatched_target_shape() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE issues(id TEXT PRIMARY KEY);")
            .unwrap();
        c.execute_batch(crate::db::SCHEMA_V79).unwrap();
        c.execute("INSERT INTO issues(id) VALUES('i')", []).unwrap();
        c.execute("INSERT INTO issue_tracker_links(id,issue_id,target_kind,url) VALUES('external','i','EXTERNAL','https://tracker.example/ONE')",[]).unwrap();
        assert!(c.execute("INSERT INTO issue_tracker_links(id,issue_id,target_kind,target_id) VALUES('bad','i','EXTERNAL','other')",[]).is_err());
        assert!(valid_external_url("https://tracker.example/ONE"));
        assert!(!valid_external_url("file:///not-a-tracker"));
    }
    #[test]
    fn status_to_column_mapping_is_project_scoped() {
        let c = conn();
        c.execute("INSERT INTO boards VALUES('b','p','B','MANUAL',0)", [])
            .unwrap();
        c.execute(
            "INSERT INTO issue_statuses VALUES('s','p','Open',0,'#000',0,0)",
            [],
        )
        .unwrap();
        let input = ColumnInput {
            id: Some("c".into()),
            board_id: "b".into(),
            name: "Open".into(),
            ordering: Some(0),
            status_ids: vec!["s".into()],
        };
        let id = input.id.clone().unwrap();
        let board = input.board_id.clone();
        let project: String = c
            .query_row("SELECT project_id FROM boards WHERE id=?1", [&board], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(project, "p");
        c.execute(
            "INSERT INTO board_columns VALUES(?1,?2,?3,?4)",
            params![id, board, input.name, 0],
        )
        .unwrap();
        c.execute("INSERT INTO column_statuses VALUES('c','s')", [])
            .unwrap();
        assert_eq!(columns_on(&c, "b").unwrap()[0].status_ids, vec!["s"]);
    }
    #[test]
    fn sprint_lifecycle_launch_closes_current_and_rolls_unresolved() {
        let c = conn();
        c.execute("INSERT INTO boards VALUES('b','p','B','MANUAL',0)", [])
            .unwrap();
        c.execute(
            "INSERT INTO issue_statuses VALUES('open','p','Open',0,'#000',0,0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO issues VALUES('i','p',1,'I',NULL,'open',NULL,NULL,NULL,0)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO sprints VALUES('old','b','Old','CURRENT',NULL,NULL,NULL,0),('new','b','New','PLANNED',NULL,NULL,NULL,0)",[]).unwrap();
        c.execute(
            "INSERT INTO issue_board_positions VALUES('i','b','old',NULL,0)",
            [],
        )
        .unwrap();
        launch_on(&c, "new").unwrap();
        assert_eq!(
            c.query_row("SELECT state FROM sprints WHERE id='old'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "CLOSED"
        );
        assert_eq!(
            c.query_row(
                "SELECT sprint_id FROM issue_board_positions WHERE issue_id='i'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "new"
        );
    }
    #[test]
    fn issue_move_updates_status_and_position() {
        let c = conn();
        c.execute("INSERT INTO boards VALUES('b','p','B','MANUAL',0)", [])
            .unwrap();
        c.execute(
            "INSERT INTO issue_statuses VALUES('s','p','Done',1,'#000',0,0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO issues VALUES('i','p',1,'I',NULL,NULL,NULL,NULL,NULL,0)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO board_columns VALUES('c','b','Done',0)", [])
            .unwrap();
        c.execute("INSERT INTO column_statuses VALUES('c','s')", [])
            .unwrap();
        move_on(&c, "b", "i", "c", None, None, Some(7)).unwrap();
        assert_eq!(
            c.query_row("SELECT status_id FROM issues WHERE id='i'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "s"
        );
        assert_eq!(
            c.query_row(
                "SELECT position FROM issue_board_positions WHERE issue_id='i'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            7
        );
    }
}
