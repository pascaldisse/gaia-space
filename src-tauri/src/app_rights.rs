//! Two-stage application rights (KB §07 §2.2 `ApplicationRights`, §3.2 Applications #9).
//!
//! Stage 1 is developer-authored: the app declares the rights it *requires*. Stage 2 is
//! admin-authored: in one named context (an org, a project, a channel) an admin grants
//! the subset it actually gets. Approval is therefore per context, and re-declaring a
//! required right never grants it — a scope stays `PENDING` until somebody approves it.
use crate::db;
use crate::rights;
use rusqlite::params;
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;

/// One right an app declares it needs, with the catalog metadata an admin reads before
/// approving it — a bare code is not enough to make an informed grant.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct RightDto {
    pub right_code: String,
    pub title: String,
    pub right_type: String,
    /// Declared rights only: should Space ask for this right in every authorized context?
    pub request_in_authorized_contexts: bool,
}

/// A right actually granted to an app in one context, with its audit trail.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AuthorizedRight {
    pub right_code: String,
    pub context_identifier: String,
    pub granted_by: Option<String>,
    pub comment: String,
    pub granted_at: i64,
}

/// Where one context stands between the two stages.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ScopeApprovalStatus {
    pub application_id: String,
    pub context_identifier: String,
    /// `APPROVED` (every required right granted) · `PARTIAL` · `PENDING` (nothing granted)
    /// · `NOT_REQUESTED` (the app declares nothing).
    pub status: String,
    pub approved: Vec<String>,
    pub pending: Vec<String>,
    /// Granted here but no longer declared — stale grants an admin should revoke.
    pub unrequested: Vec<String>,
}

fn app_exists(c: &rusqlite::Connection, application_id: &str) -> Result<()> {
    let found: i64 = c
        .query_row(
            "SELECT count(*) FROM applications WHERE id=?1",
            [application_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if found == 0 {
        return Err("application not found".into());
    }
    Ok(())
}

/// A right code only means something if the catalog knows it; an unknown code would be a
/// grant that can never be checked, i.e. a silent permanent denial.
fn known_right(c: &rusqlite::Connection, right_code: &str) -> Result<(String, String)> {
    c.query_row(
        "SELECT title,right_type FROM rights WHERE code=?1",
        [right_code],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|_| format!("unknown right code: {right_code}"))
}

fn context(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("context identifier is required".into());
    }
    Ok(value.to_string())
}

pub(crate) fn required_rights_on(
    c: &rusqlite::Connection,
    application_id: &str,
) -> Result<Vec<RightDto>> {
    app_exists(c, application_id)?;
    let mut q = c
        .prepare(
            "SELECT r.right_code, COALESCE(c.title, r.right_code), COALESCE(c.right_type,'Unknown'), r.request_in_authorized_contexts \
             FROM app_required_rights r LEFT JOIN rights c ON c.code = r.right_code \
             WHERE r.application_id=?1 ORDER BY r.right_code",
        )
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([application_id], |r| {
            Ok(RightDto {
                right_code: r.get(0)?,
                title: r.get(1)?,
                right_type: r.get(2)?,
                request_in_authorized_contexts: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Stage 1 read: what the app says it needs.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_required_rights(application_id: String) -> Result<Vec<RightDto>> {
    required_rights_on(&db::conn()?, &application_id)
}

pub(crate) fn update_required_rights_on(
    c: &rusqlite::Connection,
    application_id: &str,
    add: &[String],
    remove: &[String],
    request_in_authorized_contexts: bool,
) -> Result<Vec<RightDto>> {
    app_exists(c, application_id)?;
    for code in add {
        known_right(c, code)?;
    }
    for code in add {
        c.execute(
            "INSERT INTO app_required_rights(application_id,right_code,request_in_authorized_contexts) VALUES(?1,?2,?3) \
             ON CONFLICT(application_id,right_code) DO UPDATE SET request_in_authorized_contexts=excluded.request_in_authorized_contexts",
            params![application_id, code, request_in_authorized_contexts],
        )
        .map_err(|e| e.to_string())?;
    }
    for code in remove {
        c.execute(
            "DELETE FROM app_required_rights WHERE application_id=?1 AND right_code=?2",
            params![application_id, code],
        )
        .map_err(|e| e.to_string())?;
    }
    required_rights_on(c, application_id)
}

/// Stage 1 write. Dropping a declaration deliberately leaves existing grants alone: they
/// are an admin's decision, and are surfaced as `unrequested` for explicit revocation.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_required_rights(
    application_id: String,
    right_codes_to_add: Vec<String>,
    right_codes_to_remove: Vec<String>,
    request_rights_in_authorized_contexts: Option<bool>,
) -> Result<Vec<RightDto>> {
    update_required_rights_on(
        &db::conn()?,
        &application_id,
        &right_codes_to_add,
        &right_codes_to_remove,
        request_rights_in_authorized_contexts.unwrap_or(false),
    )
}

/// An app asking for rights on its own behalf is stage 1 too, never stage 2.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn request_rights(application_id: String, right_codes: Vec<String>) -> Result<Vec<RightDto>> {
    update_required_rights_on(&db::conn()?, &application_id, &right_codes, &[], true)
}

pub(crate) fn authorized_rights_on(
    c: &rusqlite::Connection,
    application_id: &str,
    context_identifier: &str,
) -> Result<Vec<AuthorizedRight>> {
    app_exists(c, application_id)?;
    let context = context(context_identifier)?;
    let mut q = c
        .prepare(
            "SELECT right_code,context_identifier,granted_by,comment,granted_at FROM app_authorized_rights \
             WHERE application_id=?1 AND context_identifier=?2 ORDER BY right_code",
        )
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map(params![application_id, context], |r| {
            Ok(AuthorizedRight {
                right_code: r.get(0)?,
                context_identifier: r.get(1)?,
                granted_by: r.get(2)?,
                comment: r.get(3)?,
                granted_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Stage 2 read: what this app may actually do here.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_authorized_rights(
    application_id: String,
    context_identifier: String,
) -> Result<Vec<AuthorizedRight>> {
    authorized_rights_on(&db::conn()?, &application_id, &context_identifier)
}

pub(crate) fn update_authorized_rights_on(
    c: &rusqlite::Connection,
    application_id: &str,
    context_identifier: &str,
    granted: &[String],
    actor: Option<&str>,
    comment: &str,
) -> Result<Vec<AuthorizedRight>> {
    app_exists(c, application_id)?;
    let context = context(context_identifier)?;
    for code in granted {
        known_right(c, code)?;
    }
    // The list is the whole truth for this context: anything absent is revoked, so an
    // admin removing a checkbox actually takes the right away.
    c.execute(
        "DELETE FROM app_authorized_rights WHERE application_id=?1 AND context_identifier=?2",
        params![application_id, context],
    )
    .map_err(|e| e.to_string())?;
    for code in granted {
        c.execute(
            "INSERT OR REPLACE INTO app_authorized_rights(application_id,context_identifier,right_code,granted_by,comment) VALUES(?1,?2,?3,?4,?5)",
            params![application_id, context, code, actor, comment],
        )
        .map_err(|e| e.to_string())?;
    }
    authorized_rights_on(c, application_id, &context)
}

/// Stage 2 write — the admin decision, recorded with its actor and comment.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_authorized_rights(
    application_id: String,
    context_identifier: String,
    rights: Vec<String>,
    actor: Option<String>,
    comment: Option<String>,
) -> Result<Vec<AuthorizedRight>> {
    update_authorized_rights_on(
        &db::conn()?,
        &application_id,
        &context_identifier,
        &rights,
        actor.as_deref(),
        comment.as_deref().unwrap_or_default(),
    )
}

pub(crate) fn scope_approval_status_on(
    c: &rusqlite::Connection,
    application_id: &str,
    context_identifier: &str,
) -> Result<ScopeApprovalStatus> {
    let context = context(context_identifier)?;
    let required: Vec<String> = required_rights_on(c, application_id)?
        .into_iter()
        .map(|right| right.right_code)
        .collect();
    let authorized: Vec<String> = authorized_rights_on(c, application_id, &context)?
        .into_iter()
        .map(|right| right.right_code)
        .collect();
    let approved: Vec<String> = required
        .iter()
        .filter(|code| authorized.contains(code))
        .cloned()
        .collect();
    let pending: Vec<String> = required
        .iter()
        .filter(|code| !authorized.contains(code))
        .cloned()
        .collect();
    let unrequested: Vec<String> = authorized
        .iter()
        .filter(|code| !required.contains(code))
        .cloned()
        .collect();
    let status = if required.is_empty() {
        "NOT_REQUESTED"
    } else if pending.is_empty() {
        "APPROVED"
    } else if approved.is_empty() {
        "PENDING"
    } else {
        "PARTIAL"
    };
    Ok(ScopeApprovalStatus {
        application_id: application_id.to_string(),
        context_identifier: context,
        status: status.into(),
        approved,
        pending,
        unrequested,
    })
}

/// Does this context still owe the app an approval?
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn scope_approval_status(
    application_id: String,
    context_identifier: String,
) -> Result<ScopeApprovalStatus> {
    scope_approval_status_on(&db::conn()?, &application_id, &context_identifier)
}

pub(crate) fn approve_scope_on(
    c: &rusqlite::Connection,
    application_id: &str,
    context_identifier: &str,
    actor: Option<&str>,
    comment: &str,
) -> Result<ScopeApprovalStatus> {
    let context = context(context_identifier)?;
    let required: Vec<String> = required_rights_on(c, application_id)?
        .into_iter()
        .map(|right| right.right_code)
        .collect();
    if required.is_empty() {
        return Err("application declares no required rights".into());
    }
    // Approving the scope grants exactly the declared set and keeps nothing else: the
    // approval means "what you asked for", not "whatever was lying here".
    update_authorized_rights_on(c, application_id, &context, &required, actor, comment)?;
    scope_approval_status_on(c, application_id, &context)
}

/// Grant the whole declared set in one context — the admin's one-click approval.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn approve_scope(
    application_id: String,
    context_identifier: String,
    actor: Option<String>,
    comment: Option<String>,
) -> Result<ScopeApprovalStatus> {
    approve_scope_on(
        &db::conn()?,
        &application_id,
        &context_identifier,
        actor.as_deref(),
        comment.as_deref().unwrap_or_default(),
    )
}

/// Enforcement seam: may this app do `right_code` here? Only a stage-2 grant says yes,
/// which is what keeps a declaration from being self-service authorization.
pub fn app_has_right(
    c: &rusqlite::Connection,
    application_id: &str,
    context_identifier: &str,
    right_code: &str,
) -> Result<bool> {
    let granted: i64 = c
        .query_row(
            "SELECT count(*) FROM app_authorized_rights WHERE application_id=?1 AND context_identifier=?2 AND right_code=?3",
            params![application_id, context_identifier, right_code],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(granted > 0)
}

/// Contexts an app may act in for one project: the project itself, then the org.
/// A grant made org-wide covers every project; a project grant covers only itself.
pub fn app_project_contexts(project_id: &str) -> [String; 2] {
    [format!("project:{project_id}"), "org".to_string()]
}

/// True when any of `contexts` carries a stage-2 grant of `right_code`.
/// Enforcement points need this shape: an org-wide grant must count without being
/// re-declared per project.
pub fn app_has_right_anywhere(
    c: &rusqlite::Connection,
    application_id: &str,
    contexts: &[String],
    right_code: &str,
) -> Result<bool> {
    for context in contexts {
        if app_has_right(c, application_id, context, right_code)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The catalog an admin picks from, so the UI never invents a code.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn application_right_catalog() -> Result<Vec<RightDto>> {
    Ok(rights::CATALOG
        .iter()
        .map(|(code, title, _, right_type, _)| RightDto {
            right_code: (*code).to_string(),
            title: (*title).to_string(),
            right_type: (*right_type).to_string(),
            request_in_authorized_contexts: false,
        })
        .collect())
}

#[cfg(test)]
#[path = "app_rights_tests.rs"]
mod app_rights_tests;
