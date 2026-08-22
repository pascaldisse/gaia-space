#![allow(dead_code)]
//! Code review persistence; discussions deliberately reuse chat channels.
//!
//! Merge safety (hard constraint, see docs/space-knowledge-base/01-git-code-review.md):
//! nothing reachable from the UI ever checks out, writes a ref, or commits into a
//! user-registered repository. `merge_preview` (used by both `dry_run_merge` and
//! `attempt_merge`) only ever calls `Repository::merge_commits`, which builds an
//! in-memory `git2::Index` and touches neither the working directory nor any ref.
//! The one function that performs a *real* merge commit + ref update
//! (`execute_real_merge_in_test`) is `#[cfg(test)]`-gated — it does not exist in the
//! shipped binary at all — and is only ever invoked in this file's test module
//! against disposable repos created under `target/test-repos/`.
use crate::db;
use git2::{DiffOptions, Repository};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
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
    pub repo_path: Option<String>,
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
    pub source_oid: Option<String>,
    pub target_oid: Option<String>,
    pub merge_commit_oid: Option<String>,
}

/// Input for opening a merge request against a registered repo's *real* branches.
#[derive(Debug, Deserialize)]
pub struct NewMergeRequest {
    pub id: String,
    pub project_id: String,
    pub repo_path: String,
    pub source_branch: String,
    pub target_branch: String,
    pub title: String,
    pub author_id: String,
    pub reviewer_ids: Vec<String>,
    pub channel_id: String,
}

/// Input for anchoring a new inline discussion to a file/line/revision on the real diff.
#[derive(Debug, Deserialize)]
pub struct NewDiscussion {
    pub id: String,
    pub review_id: String,
    pub channel_id: String,
    pub file_path: String,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    pub revision: Option<String>,
    pub author_id: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct QualityGateEvaluation {
    pub satisfied: bool,
    pub reasons: Vec<String>,
    pub approvals: i64,
    pub min_approvals: i64,
    pub matched_rules: i64,
    /// Source-branch CODEOWNERS paths that have a rule, plus locally resolved owners.
    pub codeowner_paths: Vec<String>,
    pub codeowner_approvers: Vec<String>,
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_reviews() -> Result<Vec<Review>> {
    let c = db::conn()?;
    let mut s=c.prepare("SELECT id,project_id,number,kind,state,source_branch,target_branch,title,turn_based,channel_id,repo_path FROM reviews ORDER BY project_id,number").map_err(|e|e.to_string())?;
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
                repo_path: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_review(id: String) -> Result<Option<Review>> {
    Ok(list_reviews()?.into_iter().find(|v| v.id == id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_review(review: Review) -> Result<()> {
    let c = db::conn()?;
    c.execute("INSERT INTO reviews(id,project_id,number,kind,state,source_branch,target_branch,title,turn_based,channel_id)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![review.id,review.project_id,review.number,review.kind,review.state,review.source_branch,review.target_branch,review.title,review.turn_based,review.channel_id]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_review(review: Review) -> Result<()> {
    let c = db::conn()?;
    c.execute("UPDATE reviews SET state=?2,source_branch=?3,target_branch=?4,title=?5,turn_based=?6,channel_id=?7 WHERE id=?1",rusqlite::params![review.id,review.state,review.source_branch,review.target_branch,review.title,review.turn_based,review.channel_id]).map_err(|e|e.to_string())?;
    Ok(())
}

// ---------- participants (roles, accept/reject, turn-based ping-pong) ----------

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_review_participants(review_id: String) -> Result<Vec<ReviewParticipant>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT review_id,profile_id,role,state,their_turn FROM review_participants WHERE review_id=?1 ORDER BY role").map_err(|e| e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![review_id], |r| {
            Ok(ReviewParticipant {
                review_id: r.get(0)?,
                profile_id: r.get(1)?,
                role: r.get(2)?,
                state: r.get(3)?,
                their_turn: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_review_participant(participant: ReviewParticipant) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "INSERT OR REPLACE INTO review_participants(review_id,profile_id,role,state,their_turn) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![participant.review_id, participant.profile_id, participant.role, participant.state, participant.their_turn],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
/// Reviewer accept/reject flips the turn to the author (`ResumeReview`/`WaitAuthorResponse`
/// in KB §2 terms); an author resuming work flips it back to every reviewer.
fn set_participant_state_tx(
    conn: &Connection,
    review_id: &str,
    profile_id: &str,
    state: Option<&str>,
) -> Result<()> {
    let role: String = conn
        .query_row(
            "SELECT role FROM review_participants WHERE review_id=?1 AND profile_id=?2",
            rusqlite::params![review_id, profile_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE review_participants SET state=?3 WHERE review_id=?1 AND profile_id=?2",
        rusqlite::params![review_id, profile_id, state],
    )
    .map_err(|e| e.to_string())?;
    if role == "Reviewer" {
        conn.execute(
            "UPDATE review_participants SET their_turn=0 WHERE review_id=?1 AND profile_id=?2",
            rusqlite::params![review_id, profile_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE review_participants SET their_turn=1 WHERE review_id=?1 AND role='Author'",
            rusqlite::params![review_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE review_participants SET their_turn=0 WHERE review_id=?1 AND role='Author'",
            rusqlite::params![review_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE review_participants SET their_turn=1 WHERE review_id=?1 AND role='Reviewer'",
            rusqlite::params![review_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_participant_state(
    review_id: String,
    profile_id: String,
    state: Option<String>,
) -> Result<()> {
    let c = db::conn()?;
    set_participant_state_tx(&c, &review_id, &profile_id, state.as_deref())
}

// ---------- create a review from a registered repo's real branches ----------

fn next_review_number_tx(conn: &Connection, project_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(number),0)+1 FROM reviews WHERE project_id=?1",
        rusqlite::params![project_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
/// DB half of opening a merge request (real-branch validation happens in the command
/// wrapper via `git::repo_branches`, which is why this takes a plain `&Connection` and is
/// unit-testable without a `tauri::AppHandle`).
fn open_merge_request_tx(conn: &Connection, req: &NewMergeRequest) -> Result<Review> {
    let number = next_review_number_tx(conn, &req.project_id)?;
    // Discussion/feed channel for this review — direct insert (chat.rs untouched, per file ownership).
    conn.execute(
        "INSERT INTO channels(id,content_type,name,project_id) VALUES(?1,'entity-bound',?2,?3)",
        rusqlite::params![
            req.channel_id,
            format!("review #{number}: {}", req.title),
            req.project_id
        ],
    )
    .map_err(|e| e.to_string())?;
    let review = Review {
        id: req.id.clone(),
        project_id: req.project_id.clone(),
        number,
        kind: "MR".into(),
        state: "Opened".into(),
        source_branch: Some(req.source_branch.clone()),
        target_branch: Some(req.target_branch.clone()),
        title: req.title.clone(),
        turn_based: true,
        channel_id: Some(req.channel_id.clone()),
        repo_path: Some(req.repo_path.clone()),
    };
    conn.execute(
        "INSERT INTO reviews(id,project_id,number,kind,state,source_branch,target_branch,title,turn_based,channel_id,repo_path)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        rusqlite::params![review.id, review.project_id, review.number, review.kind, review.state, review.source_branch, review.target_branch, review.title, review.turn_based, review.channel_id, review.repo_path],
    )
    .map_err(|e| e.to_string())?;
    // Author: no accept/reject state, waiting on reviewers (their_turn=false).
    conn.execute(
        "INSERT INTO review_participants(review_id,profile_id,role,state,their_turn) VALUES(?1,?2,'Author',NULL,0)",
        rusqlite::params![req.id, req.author_id],
    )
    .map_err(|e| e.to_string())?;
    // Reviewers: waiting to act, their_turn=true (KB §2 CodeReviewParticipant.theirTurn).
    for reviewer_id in &req.reviewer_ids {
        conn.execute(
            "INSERT INTO review_participants(review_id,profile_id,role,state,their_turn) VALUES(?1,?2,'Reviewer','waiting',1)",
            rusqlite::params![req.id, reviewer_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(review)
}
/// Create a review (kind=MR) from a registered repo's real branches, project-scoped numbering.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn open_merge_request(req: NewMergeRequest) -> Result<Review> {
    if req.source_branch == req.target_branch {
        return Err("source and target branch must differ".into());
    }
    let branches = crate::git::repo_branches(req.repo_path.clone())?;
    if !branches.iter().any(|b| b.name == req.source_branch) {
        return Err(format!(
            "source branch '{}' not found in repo",
            req.source_branch
        ));
    }
    if !branches.iter().any(|b| b.name == req.target_branch) {
        return Err(format!(
            "target branch '{}' not found in repo",
            req.target_branch
        ));
    }
    let c = db::conn()?;
    open_merge_request_tx(&c, &req)
}

/// Unified diff for the review: merge-base(target,source) tree vs. source tip tree —
/// i.e. exactly the changes the MR would introduce, same git2 plumbing style as git.rs.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn review_diff(
    repo_path: String,
    source_branch: String,
    target_branch: String,
) -> Result<String> {
    let repo = open(&repo_path)?;
    let source = branch_commit(&repo, &source_branch)?;
    let target = branch_commit(&repo, &target_branch)?;
    let base_oid = repo
        .merge_base(target.id(), source.id())
        .map_err(|e| e.to_string())?;
    let base_tree = repo
        .find_commit(base_oid)
        .map_err(|e| e.to_string())?
        .tree()
        .map_err(|e| e.to_string())?;
    let source_tree = source.tree().map_err(|e| e.to_string())?;
    let mut opts = DiffOptions::new();
    let diff = repo
        .diff_tree_to_tree(Some(&base_tree), Some(&source_tree), Some(&mut opts))
        .map_err(|e| e.to_string())?;
    let mut buf = String::new();
    diff.print(git2::DiffFormat::Patch, |_d, _h, line| {
        match line.origin() {
            '+' | '-' | ' ' => buf.push(line.origin()),
            _ => {}
        }
        buf.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|e| e.to_string())?;
    Ok(buf)
}

// ---------- inline discussions (anchored file/line/revision, backed by a channel) ----------

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_review_discussions(review_id: String) -> Result<Vec<ReviewDiscussion>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,review_id,file_path,line_start,line_end,revision,resolved,channel_id FROM review_discussions WHERE review_id=?1 ORDER BY file_path,line_start").map_err(|e| e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![review_id], |r| {
            Ok(ReviewDiscussion {
                id: r.get(0)?,
                review_id: r.get(1)?,
                file_path: r.get(2)?,
                line_start: r.get(3)?,
                line_end: r.get(4)?,
                revision: r.get(5)?,
                resolved: r.get(6)?,
                channel_id: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
fn create_review_discussion_tx(
    conn: &Connection,
    d: &NewDiscussion,
    now: i64,
) -> Result<ReviewDiscussion> {
    conn.execute(
        "INSERT INTO channels(id,content_type,name) VALUES(?1,'entity-bound',?2)",
        rusqlite::params![d.channel_id, format!("discussion: {}", d.file_path)],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO review_discussions(id,review_id,file_path,line_start,line_end,revision,resolved,channel_id) VALUES(?1,?2,?3,?4,?5,?6,0,?7)",
        rusqlite::params![d.id, d.review_id, d.file_path, d.line_start, d.line_end, d.revision, d.channel_id],
    )
    .map_err(|e| e.to_string())?;
    if !d.message.trim().is_empty() {
        conn.execute(
            "INSERT INTO messages(id,channel_id,author_id,text,created_at) VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![
                format!("{}-msg0", d.id),
                d.channel_id,
                d.author_id,
                d.message,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(ReviewDiscussion {
        id: d.id.clone(),
        review_id: d.review_id.clone(),
        file_path: d.file_path.clone(),
        line_start: d.line_start,
        line_end: d.line_end,
        revision: d.revision.clone(),
        resolved: false,
        channel_id: Some(d.channel_id.clone()),
    })
}
/// Anchored inline discussion on the real diff; backing channel row is a direct insert
/// (chat.rs untouched — chat's own commands remain available for reading/posting later).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_review_discussion(discussion: NewDiscussion) -> Result<ReviewDiscussion> {
    let c = db::conn()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    create_review_discussion_tx(&c, &discussion, now)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_discussion_resolved(id: String, resolved: bool) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE review_discussions SET resolved=?2 WHERE id=?1",
        rusqlite::params![id, resolved],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- protected branches: per-action allow-lists ----------
#[derive(Debug, Serialize, Deserialize)]
pub struct ProtectedBranchRule {
    pub id: String,
    pub project_id: String,
    pub branch_pattern: String,
    pub regex: bool,
    pub allow_create_json: Option<String>,
    pub allow_push_json: Option<String>,
    pub allow_delete_json: Option<String>,
    pub allow_force_push_json: Option<String>,
    pub allow_merge_json: Option<String>,
    pub linear_history: bool,
    pub bypass_quality_gate_json: Option<String>,
}
fn protected_rows_tx(conn: &Connection, project_id: &str) -> Result<Vec<ProtectedBranchRule>> {
    let mut s=conn.prepare("SELECT id,project_id,branch_pattern,regex,allow_create_json,allow_push_json,allow_delete_json,allow_force_push_json,allow_merge_json,linear_history,bypass_quality_gate_json FROM protected_branch_rules WHERE project_id=?1 ORDER BY branch_pattern").map_err(|e|e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![project_id], |r| {
            Ok(ProtectedBranchRule {
                id: r.get(0)?,
                project_id: r.get(1)?,
                branch_pattern: r.get(2)?,
                regex: r.get(3)?,
                allow_create_json: r.get(4)?,
                allow_push_json: r.get(5)?,
                allow_delete_json: r.get(6)?,
                allow_force_push_json: r.get(7)?,
                allow_merge_json: r.get(8)?,
                linear_history: r.get(9)?,
                bypass_quality_gate_json: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_protected_branch_rules(project_id: String) -> Result<Vec<ProtectedBranchRule>> {
    protected_rows_tx(&db::conn()?, &project_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_protected_branch_rule(rule: ProtectedBranchRule) -> Result<()> {
    let c = db::conn()?;
    c.execute("INSERT INTO protected_branch_rules(id,project_id,branch_pattern,regex,allow_create_json,allow_push_json,allow_delete_json,allow_force_push_json,allow_merge_json,linear_history,bypass_quality_gate_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(id) DO UPDATE SET branch_pattern=excluded.branch_pattern,regex=excluded.regex,allow_create_json=excluded.allow_create_json,allow_push_json=excluded.allow_push_json,allow_delete_json=excluded.allow_delete_json,allow_force_push_json=excluded.allow_force_push_json,allow_merge_json=excluded.allow_merge_json,linear_history=excluded.linear_history,bypass_quality_gate_json=excluded.bypass_quality_gate_json", rusqlite::params![rule.id,rule.project_id,rule.branch_pattern,rule.regex,rule.allow_create_json,rule.allow_push_json,rule.allow_delete_json,rule.allow_force_push_json,rule.allow_merge_json,rule.linear_history,rule.bypass_quality_gate_json]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_protected_branch_rule(id: String) -> Result<()> {
    db::conn()?
        .execute(
            "DELETE FROM protected_branch_rules WHERE id=?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn principal_allowed(json: &Option<String>, actor: &str) -> bool {
    json.as_ref()
        .and_then(|x| serde_json::from_str::<Vec<String>>(x).ok())
        .is_some_and(|v| v.iter().any(|p| p == actor))
}
fn protection_matches(rule: &ProtectedBranchRule, branch: &str) -> bool {
    if rule.regex {
        return false;
    }
    branch_matches(&rule.branch_pattern, branch)
}
fn enforce_merge_permission_tx(
    conn: &Connection,
    project_id: &str,
    branch: &str,
    actor: &str,
) -> Result<()> {
    for rule in protected_rows_tx(conn, project_id)?
        .iter()
        .filter(|r| protection_matches(r, branch))
    {
        if !principal_allowed(&rule.allow_merge_json, actor) {
            return Err(format!(
                "{actor} is not allowed to merge protected branch '{}'",
                rule.branch_pattern
            ));
        }
    }
    Ok(())
}

// ---------- quality gates: rules CRUD + live evaluation ----------

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_quality_gate_rules(project_id: String) -> Result<Vec<QualityGateRule>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,project_id,branch_pattern,min_approvals,required_reviewers_json,codeowners_required FROM quality_gate_rules WHERE project_id=?1 ORDER BY branch_pattern").map_err(|e| e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![project_id], |r| {
            Ok(QualityGateRule {
                id: r.get(0)?,
                project_id: r.get(1)?,
                branch_pattern: r.get(2)?,
                min_approvals: r.get(3)?,
                required_reviewers_json: r.get(4)?,
                codeowners_required: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_quality_gate_rule(rule: QualityGateRule) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "INSERT INTO quality_gate_rules(id,project_id,branch_pattern,min_approvals,required_reviewers_json,codeowners_required) VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![rule.id, rule.project_id, rule.branch_pattern, rule.min_approvals, rule.required_reviewers_json, rule.codeowners_required],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_quality_gate_rule(rule: QualityGateRule) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE quality_gate_rules SET branch_pattern=?2,min_approvals=?3,required_reviewers_json=?4,codeowners_required=?5 WHERE id=?1",
        rusqlite::params![rule.id, rule.branch_pattern, rule.min_approvals, rule.required_reviewers_json, rule.codeowners_required],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_quality_gate_rule(id: String) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "DELETE FROM quality_gate_rules WHERE id=?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
/// `*`-suffix glob only (e.g. "main", "release/*") — deliberately not full gitignore-style
/// precedence; real CODEOWNERS-grade matching is future work (see KB §4 gap analysis).
fn branch_matches(pattern: &str, branch: &str) -> bool {
    if pattern.is_empty() || pattern == "*" {
        return true;
    }
    match pattern.strip_suffix('*') {
        Some(prefix) => branch.starts_with(prefix),
        None => pattern == branch,
    }
}
#[derive(Debug)]
struct CodeOwnerMatch {
    path: String,
    owner_ids: Vec<String>,
}

/// Split owners while retaining quoted role names, e.g. "Project Admin".
fn codeowner_tokens(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for ch in input.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// `*` stays in one path component; `**` can span components.
fn codeowner_glob(pattern: &[u8], path: &[u8]) -> bool {
    match pattern {
        [] => path.is_empty(),
        [b'*', b'*', rest @ ..] => {
            codeowner_glob(rest, path) || (!path.is_empty() && codeowner_glob(pattern, &path[1..]))
        }
        [b'*', rest @ ..] => {
            codeowner_glob(rest, path)
                || (!path.is_empty() && path[0] != b'/' && codeowner_glob(pattern, &path[1..]))
        }
        [b'?', rest @ ..] => {
            !path.is_empty() && path[0] != b'/' && codeowner_glob(rest, &path[1..])
        }
        [first, rest @ ..] => {
            !path.is_empty() && *first == path[0] && codeowner_glob(rest, &path[1..])
        }
    }
}

fn codeowner_pattern_matches(raw: &str, path: &str) -> bool {
    let mut pattern = raw.trim_start_matches('/').to_owned();
    if pattern.ends_with('/') {
        pattern.push_str("**");
    }
    if !pattern.contains('/') {
        return codeowner_glob(
            pattern.as_bytes(),
            path.rsplit('/').next().unwrap_or(path).as_bytes(),
        );
    }
    codeowner_glob(pattern.as_bytes(), path.as_bytes())
}

fn codeowner_profile_ids(
    conn: &Connection,
    project_id: &str,
    owners: &[String],
) -> Result<Vec<String>> {
    let mut ids = std::collections::BTreeSet::new();
    for owner in owners {
        let owner = owner.trim_start_matches('@');
        let mut profiles = conn
            .prepare(
                "SELECT id FROM profiles WHERE lower(username)=lower(?1) OR lower(email)=lower(?1)",
            )
            .map_err(|e| e.to_string())?;
        let rows = profiles
            .query_map(rusqlite::params![owner], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for id in rows {
            ids.insert(id.map_err(|e| e.to_string())?);
        }
        let mut role_members = conn.prepare(
            "SELECT DISTINCT a.profile_id FROM roles r JOIN role_assignments a ON a.role_id=r.id \
             WHERE r.name=?1 AND a.profile_id IS NOT NULL AND (a.scope_type='global' OR (a.scope_type='project' AND a.scope_id=?2))",
        ).map_err(|e| e.to_string())?;
        let rows = role_members
            .query_map(rusqlite::params![owner, project_id], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        for id in rows {
            ids.insert(id.map_err(|e| e.to_string())?);
        }
    }
    Ok(ids.into_iter().collect())
}

/// Read root CODEOWNERS (or `.space/CODEOWNERS`) from the MR source commit and apply
/// last-match-wins ownership to changed paths. It is never cached, so new source pushes
/// are evaluated against their own ownership file.
fn codeowner_matches_tx(conn: &Connection, review_id: &str) -> Result<Vec<CodeOwnerMatch>> {
    let (project_id, repo_path, source_branch, target_branch): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT project_id,repo_path,source_branch,target_branch FROM reviews WHERE id=?1",
            rusqlite::params![review_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    let (repo_path, source_branch, target_branch) = match (repo_path, source_branch, target_branch)
    {
        (Some(repo), Some(source), Some(target)) => (repo, source, target),
        _ => return Ok(Vec::new()),
    };
    let repo = open(&repo_path)?;
    let source = branch_commit(&repo, &source_branch)?;
    let target = branch_commit(&repo, &target_branch)?;
    let base = repo
        .merge_base(target.id(), source.id())
        .map_err(|e| e.to_string())?;
    let base_tree = repo
        .find_commit(base)
        .map_err(|e| e.to_string())?
        .tree()
        .map_err(|e| e.to_string())?;
    let source_tree = source.tree().map_err(|e| e.to_string())?;
    let entry = source_tree
        .get_path(std::path::Path::new("CODEOWNERS"))
        .or_else(|_| source_tree.get_path(std::path::Path::new(".space/CODEOWNERS")));
    let Ok(entry) = entry else {
        return Ok(Vec::new());
    };
    let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
    let text =
        std::str::from_utf8(blob.content()).map_err(|_| "CODEOWNERS must be UTF-8".to_string())?;
    let rules: Vec<(String, Vec<String>)> = text
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let tokens = codeowner_tokens(line);
            (tokens.len() >= 2).then(|| (tokens[0].clone(), tokens[1..].to_vec()))
        })
        .collect();
    let diff = repo
        .diff_tree_to_tree(Some(&base_tree), Some(&source_tree), None)
        .map_err(|e| e.to_string())?;
    let mut matches = Vec::new();
    for delta in diff.deltas() {
        let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path()) else {
            continue;
        };
        let path = path.to_string_lossy().to_string();
        if let Some((_, owners)) = rules
            .iter()
            .rev()
            .find(|(pattern, _)| codeowner_pattern_matches(pattern, &path))
        {
            matches.push(CodeOwnerMatch {
                path,
                owner_ids: codeowner_profile_ids(conn, &project_id, owners)?,
            });
        }
    }
    Ok(matches)
}

fn evaluate_quality_gate_tx(conn: &Connection, review_id: &str) -> Result<QualityGateEvaluation> {
    let (project_id, target_branch): (String, Option<String>) = conn
        .query_row(
            "SELECT project_id,target_branch FROM reviews WHERE id=?1",
            rusqlite::params![review_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let target = target_branch.unwrap_or_default();

    let mut s = conn
        .prepare("SELECT id,project_id,branch_pattern,min_approvals,required_reviewers_json,codeowners_required FROM quality_gate_rules WHERE project_id=?1")
        .map_err(|e| e.to_string())?;
    let rules: Vec<QualityGateRule> = s
        .query_map(rusqlite::params![project_id], |r| {
            Ok(QualityGateRule {
                id: r.get(0)?,
                project_id: r.get(1)?,
                branch_pattern: r.get(2)?,
                min_approvals: r.get(3)?,
                required_reviewers_json: r.get(4)?,
                codeowners_required: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let matched: Vec<&QualityGateRule> = rules
        .iter()
        .filter(|r| branch_matches(&r.branch_pattern, &target))
        .collect();
    if matched.is_empty() {
        return Ok(QualityGateEvaluation {
            satisfied: true,
            reasons: vec!["no quality gate rule matches this target branch".into()],
            approvals: 0,
            min_approvals: 0,
            matched_rules: 0,
            codeowner_paths: Vec::new(),
            codeowner_approvers: Vec::new(),
        });
    }

    let min_approvals = matched.iter().map(|r| r.min_approvals).max().unwrap_or(0);
    let codeowners_required = matched.iter().any(|r| r.codeowners_required);
    let mut required_reviewers: std::collections::HashSet<String> = Default::default();
    for r in &matched {
        if let Some(json) = &r.required_reviewers_json {
            if let Ok(list) = serde_json::from_str::<Vec<String>>(json) {
                required_reviewers.extend(list);
            }
        }
    }

    let approvals: i64 = conn
        .query_row("SELECT COUNT(*) FROM review_participants WHERE review_id=?1 AND role='Reviewer' AND state='accepted'", rusqlite::params![review_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let mut accepted_ids: std::collections::HashSet<String> = Default::default();
    {
        let mut s2 = conn.prepare("SELECT profile_id FROM review_participants WHERE review_id=?1 AND state='accepted'").map_err(|e| e.to_string())?;
        let mut rows = s2
            .query(rusqlite::params![review_id])
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            accepted_ids.insert(row.get::<_, String>(0).map_err(|e| e.to_string())?);
        }
    }

    let mut reasons = Vec::new();
    if approvals < min_approvals {
        reasons.push(format!(
            "needs {} more approval(s) ({}/{})",
            min_approvals - approvals,
            approvals,
            min_approvals
        ));
    }
    let missing_reviewers: Vec<String> = required_reviewers
        .iter()
        .filter(|id| !accepted_ids.contains(*id))
        .cloned()
        .collect();
    if !missing_reviewers.is_empty() {
        reasons.push(format!(
            "missing approval from required reviewer(s): {}",
            missing_reviewers.join(", ")
        ));
    }
    let codeowner_matches = if codeowners_required {
        codeowner_matches_tx(conn, review_id)?
    } else {
        Vec::new()
    };
    let codeowner_paths: Vec<String> = codeowner_matches.iter().map(|m| m.path.clone()).collect();
    let mut codeowner_approvers = std::collections::BTreeSet::new();
    for owner_match in &codeowner_matches {
        codeowner_approvers.extend(owner_match.owner_ids.iter().cloned());
        if owner_match.owner_ids.is_empty() {
            reasons.push(format!(
                "CODEOWNERS for '{}' has no locally resolvable owner",
                owner_match.path
            ));
        } else if !owner_match
            .owner_ids
            .iter()
            .any(|id| accepted_ids.contains(id))
        {
            reasons.push(format!(
                "missing CODEOWNERS approval for '{}'",
                owner_match.path
            ));
        }
    }
    if codeowners_required && codeowner_matches.is_empty() {
        reasons.push(
            "CODEOWNERS gate requires a source-branch CODEOWNERS rule for changed files".into(),
        );
    }

    Ok(QualityGateEvaluation {
        satisfied: reasons.is_empty(),
        reasons,
        approvals,
        min_approvals,
        matched_rules: matched.len() as i64,
        codeowner_paths,
        codeowner_approvers: codeowner_approvers.into_iter().collect(),
    })
}
/// Live gate evaluation banner: satisfied/blocking reasons for a review's target branch.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn evaluate_quality_gate(review_id: String) -> Result<QualityGateEvaluation> {
    let c = db::conn()?;
    evaluate_quality_gate_tx(&c, &review_id)
}

// ---------- safe merge: snapshot → CI completion → atomic ref finalization ----------
fn open(path: &str) -> Result<Repository> {
    Repository::open(path).map_err(|e| format!("open {path}: {e}"))
}
fn branch_commit<'a>(repo: &'a Repository, name: &str) -> Result<git2::Commit<'a>> {
    repo.revparse_single(&format!("refs/heads/{name}"))
        .or_else(|_| repo.revparse_single(name))
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())
}
/// Builds a merge result entirely in libgit2's in-memory index. It never checks out a
/// worktree. The returned oids are a TOCTOU guard: finalization refuses stale refs.
fn merge_preview(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<(bool, Vec<String>, String, String)> {
    let repo = open(repo_path)?;
    let source = branch_commit(&repo, source_branch)?;
    let target = branch_commit(&repo, target_branch)?;
    let idx = repo
        .merge_commits(&target, &source, None)
        .map_err(|e| e.to_string())?;
    let mut conflicts = Vec::new();
    if idx.has_conflicts() {
        for entry in idx.conflicts().map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if let Some(p) = entry.our.or(entry.their).or(entry.ancestor) {
                conflicts.push(String::from_utf8_lossy(&p.path).to_string());
            }
        }
    }
    Ok((
        !conflicts.is_empty(),
        conflicts,
        source.id().to_string(),
        target.id().to_string(),
    ))
}
/// A safe merge waits until every configured project Automation job has a completed
/// green latest run. Projects without configured jobs have no CI requirement.
fn ci_status_tx(conn: &Connection, project_id: &str) -> Result<(bool, Vec<String>)> {
    let mut statement = conn.prepare(
        "SELECT j.name, r.status FROM jobs j JOIN pipeline_scripts p ON p.id=j.script_id \
         LEFT JOIN job_runs r ON r.id=(SELECT jr.id FROM job_runs jr WHERE jr.job_id=j.id ORDER BY jr.triggered_at DESC LIMIT 1) \
         WHERE p.project_id=?1 AND p.archived=0 AND j.archived=0 ORDER BY j.name",
    ).map_err(|e| e.to_string())?;
    let jobs: Vec<(String, Option<String>)> = statement
        .query_map(rusqlite::params![project_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut reasons = Vec::new();
    for (name, status) in jobs {
        match status.as_deref() {
            Some("FINISHED") => {}
            Some("FAILED") | Some("TERMINATED") => reasons.push(format!("CI job '{name}' failed")),
            Some(status) => reasons.push(format!("CI job '{name}' is {status}; waiting")),
            None => reasons.push(format!("CI job '{name}' has no run; waiting")),
        }
    }
    Ok((reasons.is_empty(), reasons))
}
fn record_merge_run_tx(
    conn: &Connection,
    id: &str,
    review_id: &str,
    state: &str,
    is_dry_run: bool,
    log: String,
    source_oid: Option<&str>,
    target_oid: Option<&str>,
    merge_commit_oid: Option<&str>,
) -> Result<SafeMergeRun> {
    conn.execute(
        "INSERT INTO safe_merge_runs(id,review_id,state,is_dry_run,log,source_oid,target_oid,merge_commit_oid,finished_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,unixepoch())",
        rusqlite::params![id, review_id, state, is_dry_run, log, source_oid, target_oid, merge_commit_oid],
    ).map_err(|e| e.to_string())?;
    Ok(SafeMergeRun {
        id: id.into(),
        review_id: review_id.into(),
        state: state.into(),
        is_dry_run,
        log: Some(log),
        source_oid: source_oid.map(Into::into),
        target_oid: target_oid.map(Into::into),
        merge_commit_oid: merge_commit_oid.map(Into::into),
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_safe_merge_runs(review_id: String) -> Result<Vec<SafeMergeRun>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,review_id,state,is_dry_run,log,source_oid,target_oid,merge_commit_oid FROM safe_merge_runs WHERE review_id=?1 ORDER BY started_at DESC").map_err(|e| e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![review_id], |r| {
            Ok(SafeMergeRun {
                id: r.get(0)?,
                review_id: r.get(1)?,
                state: r.get(2)?,
                is_dry_run: r.get(3)?,
                log: r.get(4)?,
                source_oid: r.get(5)?,
                target_oid: r.get(6)?,
                merge_commit_oid: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
fn review_project_tx(conn: &Connection, review_id: &str) -> Result<String> {
    conn.query_row(
        "SELECT project_id FROM reviews WHERE id=?1",
        rusqlite::params![review_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
/// Snapshot the merge result and current refs. A non-green CI leaves a RUNNING record,
/// so callers can poll and retry finalization without ever writing repository state.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn dry_run_merge(
    id: String,
    repo_path: String,
    review_id: String,
    source_branch: String,
    target_branch: String,
) -> Result<SafeMergeRun> {
    let (conflicted, conflicts, source_oid, target_oid) =
        merge_preview(&repo_path, &source_branch, &target_branch)?;
    let c = db::conn()?;
    let (_, ci_reasons) = ci_status_tx(&c, &review_project_tx(&c, &review_id)?)?;
    let (state, log) = if conflicted {
        (
            "FAILING",
            format!("dry run — conflicts in: {}", conflicts.join(", ")),
        )
    } else if !ci_reasons.is_empty() {
        (
            "RUNNING",
            format!("dry run mergeable; {}", ci_reasons.join("; ")),
        )
    } else {
        ("SUCCEEDED", "dry run mergeable; CI green".into())
    };
    record_merge_run_tx(
        &c,
        &id,
        &review_id,
        state,
        true,
        log,
        Some(&source_oid),
        Some(&target_oid),
        None,
    )
}
/// Final merge is deliberate, ref-only Git plumbing: no checkout or worktree mutation.
/// It rechecks CI and both branch tips immediately before updating the target ref.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn attempt_merge(
    id: String,
    repo_path: String,
    review_id: String,
    source_branch: String,
    target_branch: String,
    actor_id: String,
) -> Result<SafeMergeRun> {
    let (conflicted, conflicts, source_oid, target_oid) =
        merge_preview(&repo_path, &source_branch, &target_branch)?;
    let c = db::conn()?;
    let project_id = review_project_tx(&c, &review_id)?;
    enforce_merge_permission_tx(&c, &project_id, &target_branch, &actor_id)?;
    let (_, ci_reasons) = ci_status_tx(&c, &project_id)?;
    if conflicted {
        return record_merge_run_tx(
            &c,
            &id,
            &review_id,
            "FAILING",
            false,
            format!("merge blocked — conflicts in: {}", conflicts.join(", ")),
            Some(&source_oid),
            Some(&target_oid),
            None,
        );
    }
    if !ci_reasons.is_empty() {
        return record_merge_run_tx(
            &c,
            &id,
            &review_id,
            "RUNNING",
            false,
            format!("merge waiting for CI: {}", ci_reasons.join("; ")),
            Some(&source_oid),
            Some(&target_oid),
            None,
        );
    }
    let repo = open(&repo_path)?;
    let source = branch_commit(&repo, &source_branch)?;
    let target = branch_commit(&repo, &target_branch)?;
    if source.id().to_string() != source_oid || target.id().to_string() != target_oid {
        return Err("branch changed during safe-merge verification; run dry run again".into());
    }
    let mut index = repo
        .merge_commits(&target, &source, None)
        .map_err(|e| e.to_string())?;
    if index.has_conflicts() {
        return Err("merge became conflicted during finalization; run dry run again".into());
    }
    let tree_oid = index.write_tree_to(&repo).map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let signature = git2::Signature::now("gaia-space safe merge", "noreply@gaia.space")
        .map_err(|e| e.to_string())?;
    let merge_oid = repo
        .commit(
            None,
            &signature,
            &signature,
            "Safe merge",
            &tree,
            &[&target, &source],
        )
        .map_err(|e| e.to_string())?;
    // Re-read the ref just before its update; a concurrent target movement is never overwritten.
    if branch_commit(&repo, &target_branch)?.id().to_string() != target_oid {
        return Err(
            "target branch changed before finalization; merge commit left unreachable".into(),
        );
    }
    repo.reference(
        &format!("refs/heads/{target_branch}"),
        merge_oid,
        false,
        "gaia-space safe merge",
    )
    .map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE reviews SET state='Merged' WHERE id=?1",
        rusqlite::params![review_id],
    )
    .map_err(|e| e.to_string())?;
    record_merge_run_tx(
        &c,
        &id,
        &review_id,
        "SUCCEEDED",
        false,
        format!("merged as {merge_oid}; CI green"),
        Some(&source_oid),
        Some(&target_oid),
        Some(&merge_oid.to_string()),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// Fresh dir under src-tauri/target/test-repos/ — never a user-registered repo, swept
    /// at both the start (stale runs) and end of each test.
    fn throwaway_dir(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-repos")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn sweep(dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }
    /// `TempDb` reserves its directory with an atomic `create_dir`, which is exclusive
    /// across processes; nothing here ever deletes a path it did not create.
    fn temp_db() -> db::TempDb {
        db::TempDb::new("gaia-space-review-test")
    }

    /// Builds a commit via plumbing only (blob + treebuilder) — no working-directory
    /// checkout needed, so both branches can be constructed in one repo without switching HEAD.
    fn plumb_commit(
        repo: &Repository,
        branch_ref: &str,
        parent: Option<git2::Oid>,
        filename: &str,
        content: &str,
    ) -> git2::Oid {
        let blob_oid = repo.blob(content.as_bytes()).unwrap();
        let mut builder = match parent {
            Some(p) => {
                let parent_tree = repo.find_commit(p).unwrap().tree().unwrap();
                repo.treebuilder(Some(&parent_tree)).unwrap()
            }
            None => repo.treebuilder(None).unwrap(),
        };
        builder.insert(filename, blob_oid, 0o100644).unwrap();
        let tree_oid = builder.write().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let parents: Vec<git2::Commit> = parent
            .map(|p| vec![repo.find_commit(p).unwrap()])
            .unwrap_or_default();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some(branch_ref), &sig, &sig, "msg", &tree, &parent_refs)
            .unwrap()
    }

    /// main: base.txt -> "base". feature branches off main, adds extra.txt (no conflict).
    fn clean_repo(name: &str) -> (PathBuf, Repository) {
        let dir = throwaway_dir(name);
        let repo = Repository::init(&dir).unwrap();
        let base = plumb_commit(&repo, "refs/heads/main", None, "base.txt", "base\n");
        repo.reference("refs/heads/feature", base, false, "create feature")
            .unwrap();
        plumb_commit(
            &repo,
            "refs/heads/feature",
            Some(base),
            "extra.txt",
            "extra\n",
        );
        (dir, repo)
    }

    /// main and feature both edit conflict.txt differently from the same base -> real conflict.
    fn conflicting_repo(name: &str) -> (PathBuf, Repository) {
        let dir = throwaway_dir(name);
        let repo = Repository::init(&dir).unwrap();
        let base = plumb_commit(&repo, "refs/heads/main", None, "conflict.txt", "base\n");
        repo.reference("refs/heads/feature", base, false, "create feature")
            .unwrap();
        plumb_commit(
            &repo,
            "refs/heads/feature",
            Some(base),
            "conflict.txt",
            "feature-change\n",
        );
        plumb_commit(
            &repo,
            "refs/heads/main",
            Some(base),
            "conflict.txt",
            "main-change\n",
        );
        (dir, repo)
    }

    #[test]
    fn open_merge_request_creates_review_from_real_branches_in_throwaway_repo() {
        let (dir, _repo) = clean_repo("mr-create");
        let path = dir.to_string_lossy().to_string();

        // Real git2 branch listing against the throwaway repo (reused from git.rs's command).
        let branches = crate::git::repo_branches(path.clone()).expect("repo_branches");
        assert!(branches.iter().any(|b| b.name == "main"));
        assert!(branches.iter().any(|b| b.name == "feature"));

        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('reviewer-1','reviewer1','Reviewer One',unixepoch())", []).unwrap();
        let req = NewMergeRequest {
            id: "mr-1".into(),
            project_id: "demo-project".into(),
            repo_path: path,
            source_branch: "feature".into(),
            target_branch: "main".into(),
            title: "Add extra.txt".into(),
            author_id: "default-org".into(),
            reviewer_ids: vec!["reviewer-1".into()],
            channel_id: "mr-1-channel".into(),
        };
        let review = open_merge_request_tx(&conn, &req).expect("open_merge_request_tx");
        assert_eq!(review.number, 1);
        assert_eq!(review.state, "Opened");
        assert_eq!(review.kind, "MR");

        let participants: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM review_participants WHERE review_id='mr-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(participants, 2, "author + 1 reviewer");
        let channels: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM channels WHERE id='mr-1-channel'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(channels, 1);

        drop(db_path);
        sweep(&dir);
    }

    #[test]
    fn quality_gate_blocks_when_approvals_missing() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO reviews(id,project_id,number,kind,state,target_branch,title) VALUES('r1','demo-project',1,'MR','Opened','main','T')", []).unwrap();
        conn.execute("INSERT INTO quality_gate_rules(id,project_id,branch_pattern,min_approvals) VALUES('rule1','demo-project','main',2)", []).unwrap();

        let eval = evaluate_quality_gate_tx(&conn, "r1").expect("evaluate");
        assert!(!eval.satisfied);
        assert!(!eval.reasons.is_empty());
        assert_eq!(eval.min_approvals, 2);

        drop(db_path);
    }

    #[test]
    fn quality_gate_passes_when_satisfied() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO reviews(id,project_id,number,kind,state,target_branch,title) VALUES('r2','demo-project',2,'MR','Opened','main','T')", []).unwrap();
        conn.execute("INSERT INTO quality_gate_rules(id,project_id,branch_pattern,min_approvals) VALUES('rule2','demo-project','main',1)", []).unwrap();
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('rev-1','rev1','Reviewer One',unixepoch())", []).unwrap();
        conn.execute("INSERT INTO review_participants(review_id,profile_id,role,state,their_turn) VALUES('r2','rev-1','Reviewer','accepted',0)", []).unwrap();

        let eval = evaluate_quality_gate_tx(&conn, "r2").expect("evaluate");
        assert!(eval.satisfied, "reasons: {:?}", eval.reasons);
        assert_eq!(eval.approvals, 1);

        drop(db_path);
    }

    #[test]
    fn codeowners_last_match_wins_and_requires_the_matching_reviewer() {
        assert!(codeowner_pattern_matches("/src/**", "src/lib.rs"));
        assert!(!codeowner_pattern_matches("*.ts", "src/lib.rs"));
        let (dir, repo) = clean_repo("codeowners");
        let feature = branch_commit(&repo, "feature").unwrap().id();
        plumb_commit(
            &repo,
            "refs/heads/feature",
            Some(feature),
            "CODEOWNERS",
            "* @reviewer1\nextra.txt @owner2\n",
        );
        let path = dir.to_string_lossy().to_string();
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('reviewer-1','reviewer1','Reviewer One',unixepoch())", []).unwrap();
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('reviewer-2','owner2','Reviewer Two',unixepoch())", []).unwrap();
        conn.execute("INSERT INTO reviews(id,project_id,number,kind,state,source_branch,target_branch,title,repo_path) VALUES('r-owner','demo-project',1,'MR','Opened','feature','main','T',?1)", rusqlite::params![path]).unwrap();
        conn.execute("INSERT INTO quality_gate_rules(id,project_id,branch_pattern,codeowners_required) VALUES('owners','demo-project','main',1)", []).unwrap();
        conn.execute("INSERT INTO review_participants(review_id,profile_id,role,state,their_turn) VALUES('r-owner','reviewer-1','Reviewer','accepted',0)", []).unwrap();
        let blocked = evaluate_quality_gate_tx(&conn, "r-owner").unwrap();
        assert!(!blocked.satisfied);
        assert!(blocked.reasons.iter().any(|r| r.contains("extra.txt")));
        conn.execute("INSERT INTO review_participants(review_id,profile_id,role,state,their_turn) VALUES('r-owner','reviewer-2','Reviewer','accepted',0)", []).unwrap();
        let passed = evaluate_quality_gate_tx(&conn, "r-owner").unwrap();
        assert!(passed.satisfied, "{:?}", passed.reasons);
        assert!(passed
            .codeowner_paths
            .iter()
            .any(|path| path == "extra.txt"));
        assert_eq!(passed.codeowner_approvers, vec!["reviewer-1", "reviewer-2"]);
        drop(db_path);
        sweep(&dir);
    }

    #[test]
    fn dry_run_merge_detects_a_planted_conflict() {
        let (dir, _repo) = conflicting_repo("dry-run-conflict");
        let path = dir.to_string_lossy().to_string();

        let (conflicted, conflicts, source_oid, target_oid) =
            merge_preview(&path, "feature", "main").expect("merge_preview");
        assert!(conflicted);
        assert!(
            conflicts.iter().any(|f| f == "conflict.txt"),
            "conflicts: {conflicts:?}"
        );

        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO reviews(id,project_id,number,kind,state,title) VALUES('r3','demo-project',3,'MR','Opened','T')", []).unwrap();
        let run = record_merge_run_tx(
            &conn,
            "run-1",
            "r3",
            "FAILING",
            true,
            format!("dry run — conflicts in: {}", conflicts.join(", ")),
            Some(&source_oid),
            Some(&target_oid),
            None,
        )
        .expect("record");
        assert_eq!(run.state, "FAILING");
        assert!(run.log.unwrap().contains("conflict.txt"));

        drop(db_path);
        sweep(&dir);
    }

    /// Real git2 merge + branch-ref update. `#[cfg(test)]`-gated: this code path does not
    /// exist in the shipped binary. Only ever runs here, against a throwaway repo.
    #[cfg(test)]
    fn execute_real_merge_in_test(
        repo_path: &str,
        source_branch: &str,
        target_branch: &str,
    ) -> Result<String> {
        let repo = open(repo_path)?;
        let source = branch_commit(&repo, source_branch)?;
        let target = branch_commit(&repo, target_branch)?;
        let mut idx = repo
            .merge_commits(&target, &source, None)
            .map_err(|e| e.to_string())?;
        if idx.has_conflicts() {
            return Err("merge has conflicts".into());
        }
        let tree_oid = idx.write_tree_to(&repo).map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
        let sig = git2::Signature::now("Test", "test@example.com").map_err(|e| e.to_string())?;
        let oid = repo
            .commit(None, &sig, &sig, "merge", &tree, &[&target, &source])
            .map_err(|e| e.to_string())?;
        repo.reference(&format!("refs/heads/{target_branch}"), oid, true, "merge")
            .map_err(|e| e.to_string())?;
        Ok(oid.to_string())
    }

    #[test]
    fn real_merge_runs_only_against_a_throwaway_test_repo() {
        let (dir, _repo) = clean_repo("real-merge-throwaway");
        let path = dir.to_string_lossy().to_string();

        let oid = execute_real_merge_in_test(&path, "feature", "main").expect("real merge");

        let repo = Repository::open(&path).unwrap();
        let main_tip = repo
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(
            main_tip.to_string(),
            oid,
            "main branch ref must now point at the merge commit"
        );
        let tree = repo.find_commit(main_tip).unwrap().tree().unwrap();
        assert!(
            tree.get_name("extra.txt").is_some(),
            "merged tree must contain feature's file"
        );
        assert!(
            tree.get_name("base.txt").is_some(),
            "merged tree must keep main's file"
        );

        sweep(&dir);
    }
}
