//! OAuth consent: the `<context>:<permission>` scope-string request-rights queue
//! (KB §05 §2.3, §3.4-3.5 `circlet.permissions.appAuth`).
//!
//! An app asks for rights in a named context — through an OAuth `scope` parameter
//! (`project:key:MY-APP:Project.View`) or a REST `request-rights` payload
//! (`{contextIdentifier, rightCodes}`). Asking is not getting: each pair lands in
//! this queue as `PENDING` until an admin approves or denies it one right at a
//! time. Approval is the only writer of a stage-2 grant, so a wider scope string
//! can never widen what the app already holds.
use crate::{app_rights, db};
use rusqlite::params;
use serde::Serialize;

type Result<T> = std::result::Result<T, String>;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RightRequest {
    pub id: String,
    pub application_id: String,
    pub context_identifier: String,
    pub right_code: String,
    /// `PENDING` · `APPROVED` · `DENIED`
    pub status: String,
    pub requested_at: i64,
    pub decided_at: Option<i64>,
    pub decided_by: Option<String>,
}

/// Splits one scope string into `(context identifier, right code)`.
///
/// The context itself contains colons (`project:key:MY-APP`), so the right code is
/// the last segment and everything before it is the context — the same reading the
/// live REST payload uses when it names the two halves separately.
pub fn parse_scope(scope: &str) -> Result<(String, String)> {
    let scope = scope.trim();
    let Some((context, right_code)) = scope.rsplit_once(':') else {
        return Err(format!(
            "scope {scope:?} must be <context>:<permission>, e.g. global:Project.Issues.Create"
        ));
    };
    if context.is_empty() || right_code.is_empty() {
        return Err(format!(
            "scope {scope:?} must be <context>:<permission>, e.g. global:Project.Issues.Create"
        ));
    }
    Ok((context.to_string(), right_code.to_string()))
}

/// Parses a space-separated OAuth `scope` parameter into its request pairs.
pub fn parse_scopes(scope: &str) -> Result<Vec<(String, String)>> {
    scope.split_whitespace().map(parse_scope).collect()
}

fn read(c: &rusqlite::Connection, id: &str) -> Result<Option<RightRequest>> {
    use rusqlite::OptionalExtension;
    c.query_row(
        "SELECT id,application_id,context_identifier,right_code,status,requested_at,decided_at,decided_by FROM app_right_requests WHERE id=?1",
        [id],
        |r| {
            Ok(RightRequest {
                id: r.get(0)?,
                application_id: r.get(1)?,
                context_identifier: r.get(2)?,
                right_code: r.get(3)?,
                status: r.get(4)?,
                requested_at: r.get(5)?,
                decided_at: r.get(6)?,
                decided_by: r.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Files (or re-files) a consent request. A right already decided keeps its
/// decision: re-asking must not reset a denial back to pending noise.
pub fn request_rights_on(
    c: &rusqlite::Connection,
    application_id: &str,
    context_identifier: &str,
    right_codes: &[String],
) -> Result<Vec<RightRequest>> {
    if context_identifier.trim().is_empty() {
        return Err("context identifier is required".into());
    }
    let known: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM applications WHERE id=?1)",
            [application_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !known {
        return Err(format!("unknown application {application_id:?}"));
    }
    let mut out = Vec::new();
    for right_code in right_codes {
        let right_code = right_code.trim();
        if right_code.is_empty() {
            continue;
        }
        let id = format!(
            "appreq-{}",
            &crate::auth_security::opaque("")[..16]
        );
        c.execute(
            "INSERT INTO app_right_requests(id,application_id,context_identifier,right_code) VALUES(?1,?2,?3,?4) ON CONFLICT(application_id,context_identifier,right_code) DO NOTHING",
            params![id, application_id, context_identifier.trim(), right_code],
        )
        .map_err(|e| e.to_string())?;
        let stored: String = c
            .query_row(
                "SELECT id FROM app_right_requests WHERE application_id=?1 AND context_identifier=?2 AND right_code=?3",
                params![application_id, context_identifier.trim(), right_code],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if let Some(item) = read(c, &stored)? {
            out.push(item);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn request_consent_rights(
    application_id: String,
    context_identifier: String,
    right_codes: Vec<String>,
) -> Result<Vec<RightRequest>> {
    request_rights_on(
        &db::conn()?,
        &application_id,
        &context_identifier,
        &right_codes,
    )
}

/// Files the pairs carried by an OAuth `scope` parameter.
pub fn request_scope_string(application_id: &str, scope: &str) -> Result<Vec<RightRequest>> {
    let c = db::conn()?;
    let mut out = Vec::new();
    for (context, right_code) in parse_scopes(scope)? {
        out.extend(request_rights_on(
            &c,
            application_id,
            &context,
            &[right_code],
        )?);
    }
    Ok(out)
}

pub fn list_requests_on(
    c: &rusqlite::Connection,
    application_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<RightRequest>> {
    let mut q = c
        .prepare("SELECT id,application_id,context_identifier,right_code,status,requested_at,decided_at,decided_by FROM app_right_requests WHERE (?1 IS NULL OR application_id=?1) AND (?2 IS NULL OR status=?2) ORDER BY requested_at DESC, right_code")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map(params![application_id, status], |r| {
            Ok(RightRequest {
                id: r.get(0)?,
                application_id: r.get(1)?,
                context_identifier: r.get(2)?,
                right_code: r.get(3)?,
                status: r.get(4)?,
                requested_at: r.get(5)?,
                decided_at: r.get(6)?,
                decided_by: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn list_requests(
    application_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<RightRequest>> {
    list_requests_on(
        &db::conn()?,
        application_id.as_deref(),
        status.as_deref(),
    )
}

/// Admin decision on one requested right. Approving unions the right into the
/// app's stage-2 grants for that context; denying writes only the decision, so a
/// denied right leaves the existing grants untouched.
pub fn decide_on(
    c: &rusqlite::Connection,
    request_id: &str,
    approve: bool,
    actor: Option<&str>,
) -> Result<RightRequest> {
    let Some(item) = read(c, request_id)? else {
        return Err(format!("unknown right request {request_id:?}"));
    };
    if item.status != "PENDING" {
        return Err(format!(
            "right request {request_id:?} was already {}",
            item.status
        ));
    }
    if approve {
        let mut codes: Vec<String> =
            app_rights::authorized_rights_on(c, &item.application_id, &item.context_identifier)?
                .into_iter()
                .map(|right| right.right_code)
                .collect();
        if !codes.contains(&item.right_code) {
            codes.push(item.right_code.clone());
        }
        app_rights::update_authorized_rights_on(
            c,
            &item.application_id,
            &item.context_identifier,
            &codes,
            actor,
            "approved from the consent queue",
        )?;
    }
    c.execute(
        "UPDATE app_right_requests SET status=?1,decided_at=unixepoch(),decided_by=?2 WHERE id=?3",
        params![
            if approve { "APPROVED" } else { "DENIED" },
            actor,
            request_id
        ],
    )
    .map_err(|e| e.to_string())?;
    read(c, request_id)?.ok_or_else(|| "right request vanished".to_string())
}

#[tauri::command]
pub fn decide(request_id: String, approve: bool, actor: Option<String>) -> Result<RightRequest> {
    decide_on(&db::conn()?, &request_id, approve, actor.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_scope_request_requires_and_records_an_explicit_approval() {
        let _serial = crate::db::test_serial();
        let temp = crate::db::TempDb::new("app-consent");
        let c = crate::db::migrate_path(&temp).expect("migration");
        c.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('consent-app','Consent app','Application','consent-client')", []).expect("application");
        c.execute("INSERT INTO rights(id,code,title,right_type) VALUES('consent-right','Project.View','View project','Project')", []).expect("right catalog");

        let requests = request_rights_on(&c, "consent-app", "project:key:DEMO", &["Project.View".into()]).expect("request");
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].status, "PENDING");
        let approved = decide_on(&c, &requests[0].id, true, None).expect("approval");
        assert_eq!(approved.status, "APPROVED");
        let granted = app_rights::authorized_rights_on(&c, "consent-app", "project:key:DEMO").expect("grant");
        assert_eq!(granted.iter().map(|right| right.right_code.as_str()).collect::<Vec<_>>(), vec!["Project.View"]);
        assert!(decide_on(&c, &requests[0].id, true, None).is_err(), "a decision is single-use");
    }
    #[test]
    fn a_context_keeps_its_colons_and_only_the_last_segment_is_the_right() {
        assert_eq!(
            parse_scope("project:key:MY-APP:Project.View").unwrap(),
            ("project:key:MY-APP".into(), "Project.View".into())
        );
        assert_eq!(
            parse_scope("global:Project.Issues.Create").unwrap(),
            ("global".into(), "Project.Issues.Create".into())
        );
        assert_eq!(
            parse_scopes("global:A project:key:P:B").unwrap(),
            vec![
                ("global".into(), "A".into()),
                ("project:key:P".into(), "B".into())
            ]
        );
        for bad in ["nocolon", "global:", ":Right", ""] {
            assert!(parse_scope(bad).is_err(), "{bad:?} must be rejected");
        }
    }
}
