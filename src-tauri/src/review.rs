#![allow(dead_code)]
//! Code review persistence; discussions deliberately reuse chat channels.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Serialize, Deserialize)]
pub struct Review {
    pub id: String,
    pub project_id: String,
    pub number: i64,
    pub kind: String,
    pub state: String,
    pub source_branch: Option<String>,
    pub target_branch: Option<String>,
    pub title: String,
    pub turn_based: bool,
    pub channel_id: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewParticipant {
    pub review_id: String,
    pub profile_id: String,
    pub role: String,
    pub state: Option<String>,
    pub their_turn: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewDiscussion {
    pub id: String,
    pub review_id: String,
    pub file_path: String,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    pub revision: Option<String>,
    pub resolved: bool,
    pub channel_id: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct QualityGateRule {
    pub id: String,
    pub project_id: String,
    pub branch_pattern: String,
    pub min_approvals: i64,
    pub required_reviewers_json: Option<String>,
    pub codeowners_required: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct SafeMergeRun {
    pub id: String,
    pub review_id: String,
    pub state: String,
    pub is_dry_run: bool,
    pub log: Option<String>,
}
#[tauri::command]
pub fn list_reviews(app: AppHandle) -> Result<Vec<Review>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,project_id,number,kind,state,source_branch,target_branch,title,turn_based,channel_id FROM reviews ORDER BY project_id,number").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Review {
                id: r.get(0)?,
                project_id: r.get(1)?,
                number: r.get(2)?,
                kind: r.get(3)?,
                state: r.get(4)?,
                source_branch: r.get(5)?,
                target_branch: r.get(6)?,
                title: r.get(7)?,
                turn_based: r.get(8)?,
                channel_id: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_review(app: AppHandle, id: String) -> Result<Option<Review>> {
    Ok(list_reviews(app)?.into_iter().find(|v| v.id == id))
}
#[tauri::command]
pub fn create_review(app: AppHandle, review: Review) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO reviews(id,project_id,number,kind,state,source_branch,target_branch,title,turn_based,channel_id)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![review.id,review.project_id,review.number,review.kind,review.state,review.source_branch,review.target_branch,review.title,review.turn_based,review.channel_id]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_review(app: AppHandle, review: Review) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("UPDATE reviews SET state=?2,source_branch=?3,target_branch=?4,title=?5,turn_based=?6,channel_id=?7 WHERE id=?1",rusqlite::params![review.id,review.state,review.source_branch,review.target_branch,review.title,review.turn_based,review.channel_id]).map_err(|e|e.to_string())?;
    Ok(())
}
// TODO: quality-gate evaluation, CODEOWNERS matching, safe-merge execution, suggestions and review-turn transitions.
