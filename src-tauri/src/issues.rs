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
pub struct IssueLink {
    pub id: String,
    pub issue_id: String,
    pub linked_issue_id: String,
    pub link_type: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueDetail {
    #[serde(flatten)]
    pub issue: Issue,
    pub tags: Vec<PlanningTag>,
    pub checklists: Vec<Checklist>,
    pub time_total_minutes: i64,
    pub children: Vec<Issue>,
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
fn list_issues_on(
    c: &Connection,
    project_id: Option<&str>,
    text: Option<&str>,
    status_id: Option<&str>,
    assignee_id: Option<&str>,
    tag_id: Option<&str>,
    include_archived: bool,
) -> Result<Vec<Issue>> {
    let mut sql = String::from("SELECT DISTINCT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived FROM issues i LEFT JOIN issue_tags it ON it.issue_id=i.id");
    sql.push_str(" WHERE (?1 IS NULL OR i.project_id=?1) AND (?2 IS NULL OR lower(i.title) LIKE '%' || lower(?2) || '%' OR lower(coalesce(i.description,'')) LIKE '%' || lower(?2) || '%') AND (?3 IS NULL OR i.status_id=?3) AND (?4 IS NULL OR i.assignee_id=?4) AND (?5 IS NULL OR it.tag_id=?5) AND (?6=1 OR i.archived=0) ORDER BY i.project_id,i.number");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(
        params![
            project_id,
            text,
            status_id,
            assignee_id,
            tag_id,
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

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_issues(
    project_id: Option<String>,
    text: Option<String>,
    status_id: Option<String>,
    assignee_id: Option<String>,
    tag_id: Option<String>,
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
        include_archived.unwrap_or(false),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_issue(id: String) -> Result<Option<Issue>> {
    let c = db::conn()?;
    let issue = err(c.query_row("SELECT id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived FROM issues WHERE id=?1",[&id],read_issue).optional())?;
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
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("issue"));
    let number: i64 = err(c.query_row(
        "SELECT coalesce(max(number),0)+1 FROM issues WHERE project_id=?1",
        [&input.project_id],
        |r| r.get(0),
    ))?;
    err(c.execute("INSERT INTO issues(id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,priority,archived) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![id,input.project_id,number,input.title,input.description,input.status_id,input.assignee_id,input.created_by,input.due_date,input.priority,input.archived.unwrap_or(false)]))?;
    let people = if input.assignee_ids.is_empty() {
        input.assignee_id.into_iter().collect()
    } else {
        input.assignee_ids
    };
    write_assignees(&c, &id, &people)?;
    get_issue(id)?.ok_or_else(|| "Created issue was not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_issue(issue: Issue) -> Result<Issue> {
    let c = db::conn()?;
    err(c.execute("UPDATE issues SET title=?2,description=?3,status_id=?4,assignee_id=?5,due_date=?6,priority=?7,archived=?8 WHERE id=?1",params![issue.id,issue.title,issue.description,issue.status_id,issue.assignee_id,issue.due_date,issue.priority,issue.archived]))?;
    // The people list wins when it is sent; a legacy single-assignee write still works.
    let people = if issue.assignee_ids.is_empty() {
        issue.assignee_id.clone().into_iter().collect()
    } else {
        issue.assignee_ids.clone()
    };
    write_assignees(&c, &issue.id, &people)?;
    get_issue(issue.id)?.ok_or_else(|| "Issue not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_issue(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE issues SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
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
    let mut s=err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived FROM issue_board_positions p JOIN issues i ON i.id=p.issue_id WHERE p.board_id=?1 AND (?2 IS NULL OR p.sprint_id=?2) ORDER BY p.position"))?;
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
    let mut s=err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived FROM issues i WHERE i.project_id=?1 AND i.archived=0 AND NOT EXISTS(SELECT 1 FROM issue_board_positions p WHERE p.issue_id=i.id AND p.board_id=?2) ORDER BY i.number"))?;
    let mut rows = err(s.query_map(params![project, board_id], read_issue))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    fill_assignees(&c, &mut rows)?;
    Ok(rows)
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_issue_link(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM issue_links WHERE id=?1", [id]))?;
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
    let mut child_s=err(c.prepare("SELECT i.id,i.project_id,i.number,i.title,i.description,i.status_id,i.assignee_id,i.created_by,i.due_date,i.priority,i.archived FROM issues i JOIN issue_links l ON l.linked_issue_id=i.id WHERE l.issue_id=?1 AND l.link_type='PARENT_CHILD'"))?;
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
