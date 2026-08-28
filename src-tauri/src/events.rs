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
/// Review participants changed state or turn.
pub const REVIEW_PARTICIPANT_UPDATED: &str = "review.participant_updated";
/// Inline discussion added to a review.
pub const REVIEW_DISCUSSION_CREATED: &str = "review.discussion_created";
/// Inline discussion resolved or reopened.
pub const REVIEW_DISCUSSION_UPDATED: &str = "review.discussion_updated";
/// Suggested edit accepted, rejected, or reopened.
pub const REVIEW_SUGGESTION_UPDATED: &str = "review.suggestion_updated";

/// Deployment status changed (`pipelines::transition_deployment`).
pub const DEPLOYMENT_STATUS_CHANGED: &str = "deployment.status_changed";

/// To-do created with an audience beyond its author (`personal::create_todo_on`).
pub const TODO_CREATED: &str = "todo.created";
/// To-do completed (`personal::set_todo_completion`, on the 0 → 1 edge).
pub const TODO_COMPLETED: &str = "todo.completed";
/// Project created (`platform::create_project_on`).
pub const PROJECT_CREATED: &str = "project.created";

/// ACTOR CONVENTION for organisation-feed events: the notification store has no
/// actor column, so an emitter that knows who acted writes the body as
/// `by <display name>` (optionally `by <display name> · <context>`). The
/// activity feed in `src/attention.ts` reads exactly that prefix and otherwise
/// says "Someone" — it never guesses a name out of free text.
pub fn actor_body(actor_name: &str, context: Option<&str>) -> String {
    match context.map(str::trim).filter(|value| !value.is_empty()) {
        Some(context) => format!("by {actor_name} · {context}"),
        None => format!("by {actor_name}"),
    }
}
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
    REVIEW_PARTICIPANT_UPDATED,
    REVIEW_DISCUSSION_CREATED,
    REVIEW_DISCUSSION_UPDATED,
    REVIEW_SUGGESTION_UPDATED,
    DEPLOYMENT_STATUS_CHANGED,
    TODO_CREATED,
    TODO_COMPLETED,
    PROJECT_CREATED,
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
    fn actor_body_states_who_acted_and_never_invents_context() {
        assert_eq!(actor_body("Ada Lovelace", None), "by Ada Lovelace");
        assert_eq!(actor_body("Ada", Some("  ")), "by Ada");
        assert_eq!(actor_body("Ada", Some("Orbital")), "by Ada · Orbital");
    }

    #[test]
    fn organisation_events_are_part_of_the_taxonomy() {
        for name in [TODO_CREATED, TODO_COMPLETED, PROJECT_CREATED] {
            assert!(is_known_event(name), "{name} must be advertised");
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
