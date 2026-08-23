//! Cross-domain event taxonomy.
//!
//! One list, one spelling: every domain write point that fans out to webhook
//! subscriptions names its event from a constant here, and `EVENT_TAXONOMY` is the
//! closed set a subscription's `event` filter can address. Names are
//! `domain.action`, lowercase, dot-separated.
//!
//! An event exists here **only** if a real write point emits it — the list is
//! evidence, not a wish list.

/// Issue created (`issues::save_issue`, first write).
pub const ISSUE_CREATED: &str = "issue.created";
/// Issue updated (`issues::save_issue`, subsequent writes).
pub const ISSUE_UPDATED: &str = "issue.updated";
/// Issue archived (`issues::archive_issue`).
pub const ISSUE_ARCHIVED: &str = "issue.archived";

/// Document content saved with a new version (`documents::save_document`).
pub const DOCUMENT_UPDATED: &str = "document.updated";

/// Commit written to a tracked repository (`git::repo_commit`).
pub const GIT_COMMIT: &str = "git.commit";

/// Review opened (`review::create_review`, `review::open_merge_request`).
pub const REVIEW_CREATED: &str = "review.created";
/// Review metadata changed (`review::update_review`).
pub const REVIEW_UPDATED: &str = "review.updated";
/// Review merged (`review::attempt_merge`, on a successful merge).
pub const REVIEW_MERGED: &str = "review.merged";

/// Deployment status changed (`pipelines::transition_deployment`).
pub const DEPLOYMENT_STATUS_CHANGED: &str = "deployment.status_changed";
/// Legacy document event name kept for subscriptions stored before the taxonomy
/// existed. Emitted alongside [`DOCUMENT_UPDATED`] so those rows keep firing.
pub const LEGACY_DOCUMENT_EVENT: &str = "DocumentWebhookEvent";

/// The closed set of taxonomy event names, in domain order.
pub const EVENT_TAXONOMY: &[&str] = &[
    ISSUE_CREATED,
    ISSUE_UPDATED,
    ISSUE_ARCHIVED,
    DOCUMENT_UPDATED,
    GIT_COMMIT,
    REVIEW_CREATED,
    REVIEW_UPDATED,
    REVIEW_MERGED,
    DEPLOYMENT_STATUS_CHANGED,
];

/// `true` when `name` is part of the taxonomy. The legacy alias is deliberately
/// **not** a member: it is delivered, never advertised.
pub fn is_known_event(name: &str) -> bool {
    EVENT_TAXONOMY.contains(&name)
}

/// The taxonomy, for clients that render a subscription event picker.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_event_types() -> std::result::Result<Vec<String>, String> {
    Ok(EVENT_TAXONOMY.iter().map(|e| (*e).to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taxonomy_names_are_unique_and_dotted() {
        let mut seen = std::collections::BTreeSet::new();
        for name in EVENT_TAXONOMY {
            assert!(seen.insert(*name), "duplicate event name {name}");
            let (domain, action) = name.split_once('.').expect("domain.action");
            assert!(!domain.is_empty() && !action.is_empty(), "malformed {name}");
            assert_eq!(*name, name.to_lowercase(), "event names are lowercase");
        }
    }

    #[test]
    fn membership_is_closed() {
        assert!(is_known_event(ISSUE_CREATED));
        assert!(is_known_event(DEPLOYMENT_STATUS_CHANGED));
        assert!(!is_known_event(LEGACY_DOCUMENT_EVENT));
        assert!(!is_known_event("issue.invented"));
    }
}
