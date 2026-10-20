//! The native coding agent: one repo, one session, end to end (roadmap.md).
//!
//! Stage 0 is the foundation only — the V150 tables (`db.rs`) and provider-key
//! storage (`keys.rs`). The provider client (`provider.rs`), the run loop
//! (`loop.rs`), the tools (`tools/`), the jail (`jail.rs`) and the session store
//! (`store.rs`) arrive in the stages that need them; nothing here is a stub.
//!
//! Everything the agent does is **project-scoped, never path-taking**: a command
//! resolves its repository from `projects.repo_path` through
//! `project_repo::validate_repo_path`, so no caller can point the agent at a
//! repository they cannot see.

pub mod keys;

use std::sync::atomic::{AtomicU64, Ordering};

/// Row ids are time-ordered and collision-free within the process. Minted here
/// (never accepted from a caller) so an insert can never be aimed at another
/// session's row by sending its id.
pub(crate) fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    format!(
        "{kind}-{nanos:x}-{:x}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
