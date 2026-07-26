//! Git backend — thin, explicit wrapper over libgit2 exposed as Tauri commands.
//! Every command takes an absolute repo path; no hidden global "current repo" state.

use git2::{DiffOptions, Repository, Sort, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;

fn open(path: &str) -> Result<Repository> {
    Repository::open(path).map_err(|e| format!("open {path}: {e}"))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RepoRef {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub head: Option<String>,
    pub detached: bool,
    pub bare: bool,
}

#[derive(Serialize)]
pub struct Commit {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    /// seconds since epoch
    pub time: i64,
    pub parents: Vec<String>,
}

#[derive(Serialize)]
pub struct Branch {
    pub name: String,
    pub is_head: bool,
    pub remote: bool,
    pub target: Option<String>,
}

#[derive(Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

// ---------- store of known repositories ----------

fn store_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("gaia-space").join("repos.json")
}

fn load_store() -> Vec<RepoRef> {
    std::fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(repos: &[RepoRef]) -> Result<()> {
    let p = store_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, serde_json::to_string_pretty(repos).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[tauri::command]
pub fn repo_list() -> Vec<RepoRef> {
    load_store()
}

/// Register a repository (validates it is a real git repo first).
#[tauri::command]
pub fn repo_add(path: String) -> Result<Vec<RepoRef>> {
    let repo = open(&path)?;
    let canonical = repo
        .workdir()
        .unwrap_or_else(|| repo.path())
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string();

    let mut repos = load_store();
    if !repos.iter().any(|r| r.path == canonical) {
        repos.push(RepoRef {
            name: repo_name(&canonical),
            path: canonical,
        });
        repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        save_store(&repos)?;
    }
    Ok(repos)
}

#[tauri::command]
pub fn repo_remove(path: String) -> Result<Vec<RepoRef>> {
    let mut repos = load_store();
    repos.retain(|r| r.path != path);
    save_store(&repos)?;
    Ok(repos)
}

// ---------- repository inspection ----------

#[tauri::command]
pub fn repo_info(path: String) -> Result<RepoInfo> {
    let repo = open(&path)?;
    let head = repo.head().ok();
    Ok(RepoInfo {
        name: repo_name(&path),
        path: path.clone(),
        detached: repo.head_detached().unwrap_or(false),
        bare: repo.is_bare(),
        head: head.and_then(|h| h.shorthand().ok().map(str::to_string)),
    })
}

#[tauri::command]
pub fn repo_log(path: String, limit: Option<usize>) -> Result<Vec<Commit>> {
    let repo = open(&path)?;
    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)
        .map_err(|e| e.to_string())?;
    if walk.push_head().is_err() {
        return Ok(vec![]); // unborn HEAD: empty repo
    }

    let mut out = Vec::new();
    for oid in walk.take(limit.unwrap_or(200)) {
        let oid = oid.map_err(|e| e.to_string())?;
        let c = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let author = c.author();
        out.push(Commit {
            id: oid.to_string(),
            short_id: oid.to_string()[..8].to_string(),
            summary: c.summary().ok().flatten().unwrap_or("").to_string(),
            author: author.name().unwrap_or("").to_string(),
            email: author.email().unwrap_or("").to_string(),
            time: c.time().seconds(),
            parents: c.parent_ids().map(|p| p.to_string()).collect(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn repo_branches(path: String) -> Result<Vec<Branch>> {
    let repo = open(&path)?;
    let mut out = Vec::new();
    for b in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, kind) = b.map_err(|e| e.to_string())?;
        let name = branch.name().ok().flatten().unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        out.push(Branch {
            is_head: branch.is_head(),
            remote: kind == git2::BranchType::Remote,
            target: branch.get().target().map(|o| o.to_string()),
            name,
        });
    }
    out.sort_by(|a, b| (a.remote, a.name.clone()).cmp(&(b.remote, b.name.clone())));
    Ok(out)
}

#[tauri::command]
pub fn repo_status(path: String) -> Result<Vec<StatusEntry>> {
    let repo = open(&path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for e in statuses.iter() {
        let s = e.status();
        let p = e.path().unwrap_or("").to_string();
        let staged = s.is_index_new() || s.is_index_modified() || s.is_index_deleted()
            || s.is_index_renamed() || s.is_index_typechange();
        let label = if s.is_wt_new() || s.is_index_new() {
            "new"
        } else if s.is_wt_deleted() || s.is_index_deleted() {
            "deleted"
        } else if s.is_wt_renamed() || s.is_index_renamed() {
            "renamed"
        } else if s.is_conflicted() {
            "conflicted"
        } else {
            "modified"
        };
        out.push(StatusEntry { path: p, status: label.to_string(), staged });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Unified diff for one commit (vs its first parent), or for the working tree when `id` is None.
#[tauri::command]
pub fn repo_diff(path: String, id: Option<String>) -> Result<String> {
    let repo = open(&path)?;
    let mut opts = DiffOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let diff = match id {
        Some(id) => {
            let oid = git2::Oid::from_str(&id).map_err(|e| e.to_string())?;
            let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
            let new_tree = commit.tree().map_err(|e| e.to_string())?;
            let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
            repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))
        }
        None => repo.diff_index_to_workdir(None, Some(&mut opts)),
    }
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

#[tauri::command]
pub fn repo_stage(path: String, files: Vec<String>) -> Result<()> {
    let repo = open(&path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for f in files {
        let p = Path::new(&f);
        if repo.workdir().map(|w| w.join(p).exists()).unwrap_or(false) {
            index.add_path(p).map_err(|e| e.to_string())?;
        } else {
            index.remove_path(p).map_err(|e| e.to_string())?;
        }
    }
    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn repo_commit(path: String, message: String) -> Result<String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".into());
    }
    let repo = open(&path)?;
    let sig = repo.signature().map_err(|e| {
        format!("no git identity configured (user.name / user.email): {e}")
    })?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let parents: Vec<git2::Commit> = match repo.head().ok().and_then(|h| h.target()) {
        Some(oid) => vec![repo.find_commit(oid).map_err(|e| e.to_string())?],
        None => vec![],
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

#[cfg(test)]
mod tests {
    //! Smoke tests against the real workspace repo (this checkout of gaia-space)
    //! to catch the Result-vs-Option git2 API mismatches this file is prone to.
    use super::*;

    fn repo_root() -> String {
        // src-tauri/ -> repo root
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn info_reads_head_of_real_repo() {
        let info = repo_info(repo_root()).expect("repo_info should succeed");
        assert!(!info.bare);
        assert!(info.head.is_some(), "HEAD shorthand should resolve");
    }

    #[test]
    fn log_reads_commits_with_summaries() {
        let commits = repo_log(repo_root(), Some(5)).expect("repo_log should succeed");
        assert!(!commits.is_empty());
        assert!(
            commits.iter().all(|c| c.short_id.len() == 8),
            "short_id should always be populated"
        );
    }

    #[test]
    fn branches_include_current_head() {
        let branches = repo_branches(repo_root()).expect("repo_branches should succeed");
        assert!(branches.iter().any(|b| b.is_head));
    }

    #[test]
    fn status_runs_without_error() {
        // Just proving it doesn't panic / error on a real, possibly-dirty tree.
        repo_status(repo_root()).expect("repo_status should succeed");
    }
}
