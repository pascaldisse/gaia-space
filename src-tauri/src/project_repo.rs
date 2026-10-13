//! Project ↔ git repository binding (V148 `projects.repo_path`).
//!
//! WHY PROJECT-SCOPED COMMANDS AND NOT `repo_info(path)` ON THE WEB: a web command that takes a
//! caller-supplied filesystem path is an arbitrary-repo reader for every session. Here the path
//! never comes from the reader: it is stored by `set_project_repo` (owner-or-admin gate in the
//! server policy) and every read resolves it from the project row. Reads reuse `git.rs`.

use crate::{db, git, platform};
use git2::{ErrorCode, Repository};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::path::PathBuf;

pub type Result<T> = std::result::Result<T, String>;

/// Most recent commits shown on the Repository tab.
pub const OVERVIEW_COMMITS: usize = 20;
/// README bytes returned at most (a README is prose; a 50 MB blob is not).
pub const README_MAX_BYTES: usize = 256 * 1024;

#[derive(Serialize)]
pub struct ProjectRepoOverview {
    pub path: String,
    pub name: String,
    /// Short branch name, `None` on detached/unborn HEAD.
    pub branch: Option<String>,
    pub detached: bool,
    pub head_id: Option<String>,
    pub head_short: Option<String>,
    /// `None` = no upstream configured (not zero).
    pub ahead: Option<usize>,
    pub behind: Option<usize>,
    pub upstream: Option<String>,
    /// Working-tree entries from `git::repo_status` (staged + unstaged + untracked).
    pub dirty: usize,
    pub commits: Vec<git::Commit>,
}

/// `~` / `~/x` → home dir (env-resolved via `dirs`); everything else untouched.
pub fn expand_home(raw: &str) -> Result<PathBuf> {
    let raw = raw.trim();
    if raw == "~" || raw.starts_with("~/") {
        let home = dirs::home_dir().ok_or("home directory is unknown")?;
        return Ok(if raw == "~" { home } else { home.join(&raw[2..]) });
    }
    Ok(PathBuf::from(raw))
}

/// Canonical absolute path of a real, non-bare git repository root, or an error.
pub fn validate_repo_path(raw: &str) -> Result<String> {
    if raw.trim().is_empty() {
        return Err("A repository path is required".into());
    }
    let expanded = expand_home(raw)?;
    let canonical = expanded
        .canonicalize()
        .map_err(|_| format!("{} does not exist", expanded.display()))?;
    let repo = Repository::open(&canonical)
        .map_err(|_| format!("{} is not a git repository", canonical.display()))?;
    if repo.is_bare() {
        return Err("bare repositories cannot be bound".into());
    }
    canonical
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "repository path is not valid UTF-8".into())
}

pub fn project_repo_path_on(c: &Connection, project_id: &str) -> Result<Option<String>> {
    let row: Option<Option<String>> = c
        .query_row("SELECT repo_path FROM projects WHERE id=?1", [project_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    match row {
        None => Err("project access denied".into()),
        Some(path) => Ok(path.filter(|p| !p.trim().is_empty())),
    }
}

/// Bind (or, with an empty path, unbind) a project's repository. The path is validated and
/// stored canonical. Authorization is the caller's (server policy / desktop identity).
pub fn set_project_repo_on(c: &Connection, project_id: &str, path: &str) -> Result<platform::Project> {
    if platform::project_on(c, project_id)?.is_none() {
        return Err("project access denied".into());
    }
    let stored: Option<String> = if path.trim().is_empty() {
        None
    } else {
        Some(validate_repo_path(path)?)
    };
    c.execute("UPDATE projects SET repo_path=?2 WHERE id=?1", rusqlite::params![project_id, stored])
        .map_err(|e| e.to_string())?;
    platform::project_on(c, project_id)?.ok_or_else(|| "project access denied".into())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_project_repo(project_id: String, path: String) -> Result<platform::Project> {
    let c = db::conn()?;
    set_project_repo_on(&c, &project_id, &path)
}

/// Everything the Repository tab shows above the README, in one round trip.
/// `None` = project has no bound repository.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn project_repo_overview(project_id: String) -> Result<Option<ProjectRepoOverview>> {
    let c = db::conn()?;
    let Some(path) = project_repo_path_on(&c, &project_id)? else {
        return Ok(None);
    };
    overview_at(&path).map(Some)
}

pub fn overview_at(path: &str) -> Result<ProjectRepoOverview> {
    let info = git::repo_info(path.to_string())?;
    let commits = git::repo_log(path.to_string(), Some(OVERVIEW_COMMITS))?;
    let dirty = git::repo_status(path.to_string())?.len();
    let repo = Repository::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let head_id = commits.first().map(|c| c.id.clone());
    let (mut ahead, mut behind, mut upstream) = (None, None, None);
    if let Ok(head) = repo.head() {
        if let Some(local) = head.target() {
            if let Ok(name) = repo.branch_upstream_name(head.name().unwrap_or("")) {
                if let Some(name) = name.as_str() {
                    if let Ok(up) = repo.refname_to_id(name) {
                        if let Ok((a, b)) = repo.graph_ahead_behind(local, up) {
                            ahead = Some(a);
                            behind = Some(b);
                            upstream = Some(name.trim_start_matches("refs/remotes/").to_string());
                        }
                    }
                }
            }
        }
    }
    Ok(ProjectRepoOverview {
        path: info.path,
        name: info.name,
        branch: if info.detached { None } else { info.head },
        detached: info.detached,
        head_short: head_id.as_ref().map(|id| id.chars().take(8).collect()),
        head_id,
        ahead,
        behind,
        upstream,
        dirty,
        commits,
    })
}

/// README.md (case-insensitive name at the tree root) as of HEAD, `None` if the repository has
/// none or no commits yet. Read from the object database, never the working tree: what is
/// committed is what the tab claims to show.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn project_repo_readme(project_id: String) -> Result<Option<String>> {
    let c = db::conn()?;
    let Some(path) = project_repo_path_on(&c, &project_id)? else {
        return Ok(None);
    };
    readme_at(&path)
}

pub fn readme_at(path: &str) -> Result<Option<String>> {
    let repo = Repository::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let tree = head.peel_to_commit().map_err(|e| e.to_string())?.tree().map_err(|e| e.to_string())?;
    for entry in tree.iter() {
        let Some(name) = entry.name() else { continue };
        if !name.eq_ignore_ascii_case("README.md") {
            continue;
        }
        let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
        let bytes = blob.content();
        let slice = &bytes[..bytes.len().min(README_MAX_BYTES)];
        return Ok(Some(String::from_utf8_lossy(slice).into_owned()));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;

    /// A throwaway repo under the cargo target dir (never the OS temp dir).
    fn scratch(tag: &str) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join("project-repo-tests").join(format!("{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn commit_file(repo: &Repository, dir: &std::path::Path, file: &str, body: &str, msg: &str) {
        std::fs::write(dir.join(file), body).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("t", "t@example.test").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents).unwrap();
    }

    #[test]
    fn validate_rejects_missing_and_non_repo_and_accepts_repo() {
        let dir = scratch("validate");
        assert!(validate_repo_path("").is_err());
        assert!(validate_repo_path(dir.join("nope").to_str().unwrap()).unwrap_err().contains("does not exist"));
        assert!(validate_repo_path(dir.to_str().unwrap()).unwrap_err().contains("not a git repository"));
        Repository::init(&dir).unwrap();
        assert_eq!(validate_repo_path(dir.to_str().unwrap()).unwrap(), dir.canonicalize().unwrap().to_str().unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn overview_and_readme_read_head_not_worktree() {
        let dir = scratch("overview");
        let repo = Repository::init(&dir).unwrap();
        let path = dir.to_str().unwrap();
        assert!(readme_at(path).unwrap().is_none(), "unborn HEAD has no README");
        commit_file(&repo, &dir, "README.md", "# Hello\n\n- a\n", "first");
        commit_file(&repo, &dir, "b.txt", "b", "second");
        std::fs::write(dir.join("README.md"), "# edited in worktree only").unwrap();
        std::fs::write(dir.join("untracked.txt"), "u").unwrap();
        assert_eq!(readme_at(path).unwrap().unwrap(), "# Hello\n\n- a\n");
        let o = overview_at(path).unwrap();
        assert_eq!(o.commits.len(), 2);
        assert_eq!(o.commits[0].summary, "second");
        assert_eq!(o.head_id.as_deref(), Some(o.commits[0].id.as_str()));
        assert_eq!(o.head_short.as_deref().map(str::len), Some(8));
        assert_eq!(o.dirty, 2, "modified README + untracked file");
        assert!(o.branch.is_some() && !o.detached);
        assert!(o.ahead.is_none() && o.behind.is_none(), "no upstream → unknown, not 0");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn expand_home_uses_home_dir() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_home("~/x/y").unwrap(), home.join("x/y"));
        assert_eq!(expand_home("~").unwrap(), home);
        assert_eq!(expand_home("/abs").unwrap(), PathBuf::from("/abs"));
    }
}
