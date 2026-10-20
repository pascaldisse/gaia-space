//! The native coding agent: one repo, one session, end to end (roadmap.md).
//!
//! What exists so far — nothing here is a stub:
//!
//! - `keys.rs` (Stage 0): BYO provider keys, sealed in `secretbox`.
//! - `provider.rs` (Stage 1): the OpenAI-compatible chat-completions client, behind an
//!   injected transport so tests script every reply.
//!
//! Still to come: the run loop (`loop.rs`), the tools (`tools/`), the jail (`jail.rs`)
//! and the session store (`store.rs`), each in the stage that needs it.
//!
//! Everything the agent does is **project-scoped, never path-taking**: a command
//! resolves its repository from `projects.repo_path` through
//! `project_repo::validate_repo_path`, so no caller can point the agent at a
//! repository they cannot see.

pub mod keys;
pub mod provider;

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
