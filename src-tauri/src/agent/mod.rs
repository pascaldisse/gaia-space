//! The native coding agent: one repo, one session, end to end (roadmap.md).
//!
//! What exists so far — nothing here is a stub:
//!
//! - `keys.rs` (Stage 0): BYO provider keys, sealed in `secretbox`.
//! - `provider.rs` (Stage 1): the OpenAI-compatible chat-completions client, behind an
//!   injected transport so tests script every reply.
//! - `store.rs`, `jail.rs`, `tools.rs`, `run.rs` (Stage 2): the session transcript, the
//!   repository containment rule, the read-only tools and the run loop. The loop lives
//!   in `run.rs` because `loop` is a keyword; it is the module roadmap.md calls `loop.rs`.
//!
//! Still to come: writes and approvals (Stage 3), `run_command` (Stage 4), the command
//! surface (Stage 5) and agent identity for commits (Stage 6).
//!
//! Everything the agent does is **project-scoped, never path-taking**: a command
//! resolves its repository from `projects.repo_path` through
//! `project_repo::validate_repo_path`, so no caller can point the agent at a
//! repository they cannot see.

pub mod jail;
pub mod keys;
pub mod provider;
pub mod run;
pub mod store;
pub mod tools;

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
