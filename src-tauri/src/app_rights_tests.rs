//! Tests for the two-stage application rights model (KB §07 §2.2 `ApplicationRights`).
#![cfg(test)]
use crate::app_rights::{
    app_has_right, approve_scope_on, authorized_rights_on, required_rights_on,
    scope_approval_status_on, update_authorized_rights_on, update_required_rights_on,
};
use crate::rights;

fn conn() -> rusqlite::Connection {
    let c = crate::db::open_in_memory().unwrap();
    crate::db::migrate(&c).unwrap();
    for (code, title, description, right_type, right_group) in rights::CATALOG {
        c.execute(
            "INSERT OR IGNORE INTO rights(id,code,title,description,right_type,right_group) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![format!("right-{code}"), code, title, description, right_type, right_group],
        )
        .unwrap();
    }
    c.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('app','App','Application','client-1')", []).unwrap();
    c
}

fn codes(values: Vec<&str>) -> Vec<String> {
    values.into_iter().map(str::to_string).collect()
}

/// A declaration is not a grant: after stage 1 the app still holds nothing anywhere.
#[test]
fn declaring_a_required_right_grants_nothing_until_an_admin_approves_the_scope() {
    let c = conn();
    update_required_rights_on(
        &c,
        "app",
        &codes(vec!["Project.CreateIssues", "Channel.PostMessages"]),
        &[],
        true,
    )
    .unwrap();
    let status = scope_approval_status_on(&c, "app", "project:demo-project").unwrap();
    assert_eq!(status.status, "PENDING");
    assert_eq!(status.approved, Vec::<String>::new());
    assert_eq!(status.pending.len(), 2);
    assert!(!app_has_right(&c, "app", "project:demo-project", "Project.CreateIssues").unwrap());

    let after =
        approve_scope_on(&c, "app", "project:demo-project", Some("admin"), "reviewed").unwrap();
    assert_eq!(after.status, "APPROVED");
    assert!(after.pending.is_empty());
    assert!(app_has_right(&c, "app", "project:demo-project", "Project.CreateIssues").unwrap());
    let granted = authorized_rights_on(&c, "app", "project:demo-project").unwrap();
    assert_eq!(granted[0].granted_by.as_deref(), Some("admin"));
    assert_eq!(granted[0].comment, "reviewed");
}

/// Approval is per context: granting in one project must not leak into another.
#[test]
fn an_approval_binds_only_the_context_it_was_given_in() {
    let c = conn();
    update_required_rights_on(&c, "app", &codes(vec!["Project.CreateIssues"]), &[], true).unwrap();
    approve_scope_on(&c, "app", "project:a", Some("admin"), "").unwrap();
    assert!(app_has_right(&c, "app", "project:a", "Project.CreateIssues").unwrap());
    assert!(!app_has_right(&c, "app", "project:b", "Project.CreateIssues").unwrap());
    assert_eq!(
        scope_approval_status_on(&c, "app", "project:b")
            .unwrap()
            .status,
        "PENDING"
    );
}

/// A partial grant is visible as such, and dropping a checkbox really revokes.
#[test]
fn a_partial_grant_reports_partial_and_an_omitted_right_is_revoked() {
    let c = conn();
    update_required_rights_on(
        &c,
        "app",
        &codes(vec!["Project.CreateIssues", "Channel.PostMessages"]),
        &[],
        false,
    )
    .unwrap();
    update_authorized_rights_on(
        &c,
        "app",
        "org",
        &codes(vec!["Project.CreateIssues"]),
        Some("admin"),
        "",
    )
    .unwrap();
    let status = scope_approval_status_on(&c, "app", "org").unwrap();
    assert_eq!(status.status, "PARTIAL");
    assert_eq!(status.pending, codes(vec!["Channel.PostMessages"]));

    update_authorized_rights_on(&c, "app", "org", &[], Some("admin"), "revoked").unwrap();
    assert!(!app_has_right(&c, "app", "org", "Project.CreateIssues").unwrap());
}

/// Undeclaring does not silently revoke; the stale grant is surfaced for an admin.
#[test]
fn a_grant_that_is_no_longer_declared_is_reported_as_unrequested() {
    let c = conn();
    update_required_rights_on(&c, "app", &codes(vec!["Project.CreateIssues"]), &[], false).unwrap();
    approve_scope_on(&c, "app", "org", None, "").unwrap();
    update_required_rights_on(&c, "app", &[], &codes(vec!["Project.CreateIssues"]), false).unwrap();
    let status = scope_approval_status_on(&c, "app", "org").unwrap();
    assert_eq!(status.status, "NOT_REQUESTED");
    assert_eq!(status.unrequested, codes(vec!["Project.CreateIssues"]));
    assert!(app_has_right(&c, "app", "org", "Project.CreateIssues").unwrap());
}

/// Codes outside the catalog, missing apps and empty contexts are refused at the boundary.
#[test]
fn an_uncheckable_grant_is_refused() {
    let c = conn();
    assert!(
        update_required_rights_on(&c, "app", &codes(vec!["Made.Up"]), &[], false)
            .unwrap_err()
            .contains("unknown right code")
    );
    assert_eq!(required_rights_on(&c, "app").unwrap(), vec![]);
    assert_eq!(
        update_authorized_rights_on(&c, "ghost", "org", &[], None, "").unwrap_err(),
        "application not found"
    );
    assert_eq!(
        authorized_rights_on(&c, "app", "  ").unwrap_err(),
        "context identifier is required"
    );
    assert_eq!(
        approve_scope_on(&c, "app", "org", None, "").unwrap_err(),
        "application declares no required rights"
    );
}
