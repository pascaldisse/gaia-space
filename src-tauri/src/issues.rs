//! Planning records: independent issues plus statuses, boards, sprints, tags, checklists and time entries.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Serialize, Deserialize)]
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
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct IssueStatus {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub resolved: bool,
    pub color: String,
    pub ordering: i64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub backlog_type: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Sprint {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub state: String,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PlanningTag {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Checklist {
    pub id: String,
    pub issue_id: String,
    pub title: String,
    pub ordering: i64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct TimeTrackingEntry {
    pub id: String,
    pub issue_id: String,
    pub profile_id: String,
    pub entry_date: String,
    pub duration_minutes: i64,
    pub description: Option<String>,
}
#[tauri::command]
pub fn list_issues(app: AppHandle) -> Result<Vec<Issue>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,archived FROM issues ORDER BY project_id,number").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
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
                archived: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_issue(app: AppHandle, id: String) -> Result<Option<Issue>> {
    Ok(list_issues(app)?.into_iter().find(|v| v.id == id))
}
#[tauri::command]
pub fn create_issue(app: AppHandle, issue: Issue) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO issues(id,project_id,number,title,description,status_id,assignee_id,created_by,due_date,archived)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![issue.id,issue.project_id,issue.number,issue.title,issue.description,issue.status_id,issue.assignee_id,issue.created_by,issue.due_date,issue.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_issue(app: AppHandle, issue: Issue) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("UPDATE issues SET title=?2,description=?3,status_id=?4,assignee_id=?5,due_date=?6,archived=?7 WHERE id=?1",rusqlite::params![issue.id,issue.title,issue.description,issue.status_id,issue.assignee_id,issue.due_date,issue.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_issue_statuses(app: AppHandle) -> Result<Vec<IssueStatus>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,project_id,name,resolved,color,ordering FROM issue_statuses ORDER BY ordering").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(IssueStatus {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                resolved: r.get(3)?,
                color: r.get(4)?,
                ordering: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn list_boards(app: AppHandle) -> Result<Vec<Board>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare("SELECT id,project_id,name,backlog_type,archived FROM boards ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Board {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                backlog_type: r.get(3)?,
                archived: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn list_sprints(app: AppHandle) -> Result<Vec<Sprint>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare("SELECT id,board_id,name,state,starts_on,ends_on FROM sprints ORDER BY starts_on")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Sprint {
                id: r.get(0)?,
                board_id: r.get(1)?,
                name: r.get(2)?,
                state: r.get(3)?,
                starts_on: r.get(4)?,
                ends_on: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
// TODO: board column/status mapping, sprint rollover, swimlanes, issue positions, tag/checklist trees, and timers need domain rules.
