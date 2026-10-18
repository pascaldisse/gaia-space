//! Git backend — thin, explicit wrapper over libgit2 exposed as Tauri commands.
//! Every command takes an absolute repo path; no hidden global "current repo" state.

use git2::{
    build::CheckoutBuilder, Cred, CredentialType, DiffOptions, FetchOptions, PushOptions,
    RemoteCallbacks, Repository, Sort, StatusOptions,
};
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
#[derive(Serialize)]
pub struct Tag {
    pub name: String,
    pub target: String,
}
#[derive(Serialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}
#[derive(Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
}
#[derive(Serialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub id: String,
}
#[derive(Serialize)]
pub struct CommitFile {
    pub path: String,
    pub status: String,
}
#[derive(Serialize)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
}
/// Credential resolution order for remote operations, per project law: the
/// git credential helper (gitcredentials(7)) first, then the ssh agent. A
/// failure returns one explicit error instead of a silent anonymous attempt.
fn remote_callbacks() -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(|url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) || allowed.contains(CredentialType::DEFAULT) {
            if let Ok(cfg) = git2::Config::open_default() {
                if let Ok(c) = Cred::credential_helper(&cfg, url, username_from_url) {
                    return Ok(c);
                }
            }
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            if let Some(user) = username_from_url {
                if let Ok(c) = Cred::ssh_key_from_agent(user) {
                    return Ok(c);
                }
            }
        }
        Err(git2::Error::from_str(&format!(
            "no git credentials available for {url}: tried the git credential helper and the ssh agent"
        )))
    });
    cb
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
    std::fs::write(
        &p,
        serde_json::to_string_pretty(repos).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_list() -> Vec<RepoRef> {
    load_store()
}

/// Register a repository (validates it is a real git repo first).
#[cfg_attr(feature = "desktop", tauri::command)]
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

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_remove(path: String) -> Result<Vec<RepoRef>> {
    let mut repos = load_store();
    repos.retain(|r| r.path != path);
    save_store(&repos)?;
    Ok(repos)
}

// ---------- repository inspection ----------

#[cfg_attr(feature = "desktop", tauri::command)]
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

#[cfg_attr(feature = "desktop", tauri::command)]
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

#[cfg_attr(feature = "desktop", tauri::command)]
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

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_status(path: String) -> Result<Vec<StatusEntry>> {
    let repo = open(&path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for e in statuses.iter() {
        let s = e.status();
        let p = e.path().unwrap_or("").to_string();
        let staged = s.is_index_new()
            || s.is_index_modified()
            || s.is_index_deleted()
            || s.is_index_renamed()
            || s.is_index_typechange();
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
        out.push(StatusEntry {
            path: p,
            status: label.to_string(),
            staged,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Unified diff for one commit (vs its first parent), or for the working tree when `id` is None.
#[cfg_attr(feature = "desktop", tauri::command)]
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

#[cfg_attr(feature = "desktop", tauri::command)]
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

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_commit(path: String, message: String) -> Result<String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".into());
    }
    let repo = open(&path)?;
    let sig = repo
        .signature()
        .map_err(|e| format!("no git identity configured (user.name / user.email): {e}"))?;
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
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(str::to_string));
    commit_event(&path, &oid.to_string(), &message, branch.as_deref());
    Ok(oid.to_string())
}

// ---------- remote operations ----------
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_fetch(path: String, remote: Option<String>) -> Result<()> {
    let repo = open(&path)?;
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let mut r = repo
        .find_remote(&remote_name)
        .map_err(|e| format!("remote {remote_name}: {e}"))?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(remote_callbacks());
    r.fetch(&[] as &[&str], Some(&mut opts), None)
        .map_err(|e| format!("fetch {remote_name}: {e}"))?;
    Ok(())
}
/// Fetch + fast-forward only. A non-fast-forward upstream (diverged history)
/// returns an explicit error instead of attempting a silent merge.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_pull(path: String) -> Result<String> {
    let repo = open(&path)?;
    let head_ref = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head_ref
        .shorthand()
        .ok()
        .ok_or("HEAD has no shorthand (detached?)")?
        .to_string();
    let remote_name = "origin".to_string();
    let mut remote = repo
        .find_remote(&remote_name)
        .map_err(|e| format!("remote {remote_name}: {e}"))?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(remote_callbacks());
    remote
        .fetch(&[branch_name.as_str()], Some(&mut opts), None)
        .map_err(|e| format!("fetch: {e}"))?;
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;
    let (analysis, _pref) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;
    if analysis.is_up_to_date() {
        return Ok("up to date".into());
    }
    if !analysis.is_fast_forward() {
        return Err("pull would require a merge (non-fast-forward); resolve manually".into());
    }
    let refname = format!("refs/heads/{branch_name}");
    let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
    reference
        .set_target(fetch_commit.id(), "fast-forward pull")
        .map_err(|e| e.to_string())?;
    repo.set_head(&refname).map_err(|e| e.to_string())?;
    repo.checkout_head(Some(CheckoutBuilder::new().force()))
        .map_err(|e| e.to_string())?;
    Ok(format!("fast-forwarded to {}", fetch_commit.id()))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_push(path: String, remote: Option<String>, branch: Option<String>) -> Result<()> {
    let repo = open(&path)?;
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let branch_name = match branch {
        Some(b) => b,
        None => repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().ok().map(str::to_string))
            .ok_or("HEAD has no shorthand (detached?)")?,
    };
    let mut r = repo
        .find_remote(&remote_name)
        .map_err(|e| format!("remote {remote_name}: {e}"))?;
    let mut opts = PushOptions::new();
    opts.remote_callbacks(remote_callbacks());
    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    r.push(&[refspec.as_str()], Some(&mut opts))
        .map_err(|e| format!("push {branch_name} to {remote_name}: {e}"))?;
    Ok(())
}
// ---------- branches / tags / remotes ----------
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_checkout(path: String, branch: String) -> Result<()> {
    let repo = open(&path)?;
    let refname = format!("refs/heads/{branch}");
    let obj = repo
        .revparse_single(&refname)
        .or_else(|_| repo.revparse_single(&branch))
        .map_err(|e| format!("branch {branch}: {e}"))?;
    repo.checkout_tree(&obj, Some(&mut CheckoutBuilder::new()))
        .map_err(|e| e.to_string())?;
    if repo.find_reference(&refname).is_ok() {
        repo.set_head(&refname).map_err(|e| e.to_string())?;
    } else {
        repo.set_head_detached(obj.id()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_branch_create(path: String, name: String, from: Option<String>) -> Result<()> {
    let repo = open(&path)?;
    let target = match from {
        Some(r) => repo
            .revparse_single(&r)
            .map_err(|e| format!("{r}: {e}"))?
            .peel_to_commit()
            .map_err(|e| e.to_string())?,
        None => repo
            .head()
            .map_err(|e| e.to_string())?
            .peel_to_commit()
            .map_err(|e| e.to_string())?,
    };
    repo.branch(&name, &target, false)
        .map_err(|e| format!("create branch {name}: {e}"))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_tags(path: String) -> Result<Vec<Tag>> {
    let repo = open(&path)?;
    let mut out = Vec::new();
    repo.tag_foreach(|oid, name| {
        let name = String::from_utf8_lossy(name)
            .trim_start_matches("refs/tags/")
            .to_string();
        out.push(Tag {
            name,
            target: oid.to_string(),
        });
        true
    })
    .map_err(|e| e.to_string())?;
    Ok(out)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_remotes(path: String) -> Result<Vec<RemoteInfo>> {
    let repo = open(&path)?;
    let names = repo.remotes().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for name in names.iter().filter_map(|r| r.ok()).flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            out.push(RemoteInfo {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
            });
        }
    }
    Ok(out)
}
// ---------- stash ----------
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_stash_save(path: String, message: Option<String>) -> Result<String> {
    let mut repo = open(&path)?;
    let sig = repo
        .signature()
        .map_err(|e| format!("no git identity configured (user.name / user.email): {e}"))?;
    let msg = message.unwrap_or_else(|| "WIP".to_string());
    let oid = repo
        .stash_save(&sig, &msg, Some(git2::StashFlags::DEFAULT))
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_stash_pop(path: String, index: Option<usize>) -> Result<()> {
    let mut repo = open(&path)?;
    repo.stash_pop(index.unwrap_or(0), None)
        .map_err(|e| e.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_stash_list(path: String) -> Result<Vec<StashEntry>> {
    let mut repo = open(&path)?;
    let mut out = Vec::new();
    repo.stash_foreach(|index, message, _oid| {
        out.push(StashEntry {
            index,
            message: message.to_string(),
        });
        true
    })
    .map_err(|e| e.to_string())?;
    Ok(out)
}
// ---------- commit / tree inspection ----------
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_commit_files(path: String, id: String) -> Result<Vec<CommitFile>> {
    let repo = open(&path)?;
    let oid = git2::Oid::from_str(&id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let new_tree = commit.tree().map_err(|e| e.to_string())?;
    let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    diff.foreach(
        &mut |delta, _progress| {
            let status = match delta.status() {
                git2::Delta::Added => "A",
                git2::Delta::Deleted => "D",
                git2::Delta::Modified => "M",
                git2::Delta::Renamed => "R",
                git2::Delta::Copied => "C",
                git2::Delta::Typechange => "T",
                _ => "M",
            };
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(CommitFile {
                path,
                status: status.to_string(),
            });
            true
        },
        None,
        None,
        None,
    )
    .map_err(|e| e.to_string())?;
    Ok(out)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_tree(path: String, id: String, dir: Option<String>) -> Result<Vec<TreeEntry>> {
    let repo = open(&path)?;
    let oid = git2::Oid::from_str(&id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    let target = match &dir {
        Some(d) if !d.is_empty() => {
            let entry = tree
                .get_path(Path::new(d))
                .map_err(|e| format!("{d}: {e}"))?;
            entry
                .to_object(&repo)
                .map_err(|e| e.to_string())?
                .peel_to_tree()
                .map_err(|e| e.to_string())?
        }
        _ => tree,
    };
    let mut out = Vec::new();
    for entry in target.iter() {
        let name = entry.name().unwrap_or("").to_string();
        let is_dir = entry.kind() == Some(git2::ObjectType::Tree);
        let path = match &dir {
            Some(d) if !d.is_empty() => format!("{d}/{name}"),
            _ => name.clone(),
        };
        out.push(TreeEntry {
            name,
            path,
            is_dir,
            id: entry.id().to_string(),
        });
    }
    Ok(out)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_unstage(path: String, files: Vec<String>) -> Result<()> {
    let repo = open(&path)?;
    let paths: Vec<&Path> = files.iter().map(Path::new).collect();
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let result = match &head_commit {
        Some(commit) => repo
            .reset_default(Some(commit.as_object()), paths)
            .map_err(|e| e.to_string()),
        None => {
            // unborn HEAD: nothing committed yet, so "unstage" just drops the index entry.
            let mut index = repo.index().map_err(|e| e.to_string())?;
            for f in &files {
                let _ = index.remove_path(Path::new(f));
            }
            index.write().map_err(|e| e.to_string())
        }
    };
    result
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_worktrees(path: String) -> Result<Vec<WorktreeInfo>> {
    let repo = open(&path)?;
    let names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for name in names.iter().filter_map(|r| r.ok()).flatten() {
        if let Ok(wt) = repo.find_worktree(name) {
            out.push(WorktreeInfo {
                name: name.to_string(),
                path: wt.path().to_string_lossy().to_string(),
            });
        }
    }
    Ok(out)
}
/// Webhook fan-out envelope for a commit: `{"event": …, "commit": {…}}`; filters
/// address it by dot-path, e.g. `"commit.branch"`. Best effort **after** the commit
/// object exists — a subscriber problem must never fail a write the repo already has.
fn commit_event(repo_path: &str, oid: &str, message: &str, branch: Option<&str>) {
    let event_type = crate::events::GIT_COMMIT;
    let payload = serde_json::json!({
        "event": event_type,
        "commit": {
            "repo_path": repo_path,
            "id": oid,
            "message": message,
            "branch": branch,
        }
    });
    if let Err(e) = crate::applications::enqueue_event(event_type, &payload) {
        eprintln!("webhook fan-out for {event_type} failed: {e}");
    }
}

// ---------- history ops: cherry-pick / revert / reset / stash apply+drop / interactive rebase ----------

/// Paths with index conflicts, for error text.
fn conflict_paths(idx: &git2::Index) -> Vec<String> {
    idx.conflicts()
        .map(|it| {
            it.filter_map(|c| c.ok())
                .filter_map(|c| c.their.or(c.our).or(c.ancestor))
                .map(|e| String::from_utf8_lossy(&e.path).to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Move HEAD (branch tip, or detached HEAD) to `oid`.
fn advance_head(repo: &Repository, oid: git2::Oid, reflog: &str) -> Result<()> {
    let head = repo.head().map_err(|e| e.to_string())?;
    if head.is_branch() {
        let name = head.name().map_err(|e| format!("HEAD ref name: {e}"))?;
        repo.reference(name, oid, true, reflog).map_err(|e| e.to_string())?;
    } else {
        repo.set_head_detached(oid).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Commit an in-memory merge `idx` on top of HEAD, then check the new tree out
/// (safe checkout: refuses to overwrite local edits). Conflicts leave the repo untouched.
fn commit_index_on_head(
    repo: &Repository,
    mut idx: git2::Index,
    author: &git2::Signature,
    message: &str,
    what: &str,
) -> Result<String> {
    if idx.has_conflicts() {
        return Err(format!(
            "{what} conflicts in {}; repository left untouched",
            conflict_paths(&idx).join(", ")
        ));
    }
    let tree = repo
        .find_tree(idx.write_tree_to(repo).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| e.to_string())?;
    let committer = repo
        .signature()
        .map_err(|e| format!("no git identity configured (user.name / user.email): {e}"))?;
    let oid = repo
        .commit(None, author, &committer, message, &tree, &[&head])
        .map_err(|e| e.to_string())?;
    let mut co = CheckoutBuilder::new();
    co.safe();
    repo.checkout_tree(tree.as_object(), Some(&mut co))
        .map_err(|e| format!("{what}: checkout refused (local changes in the way?): {e}"))?;
    advance_head(repo, oid, what)?;
    Ok(oid.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_cherry_pick(path: String, commit: String) -> Result<String> {
    let repo = open(&path)?;
    let pick = repo
        .revparse_single(&commit)
        .and_then(|o| o.peel_to_commit())
        .map_err(|e| format!("commit {commit}: {e}"))?;
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| e.to_string())?;
    let mainline = if pick.parent_count() > 1 { 1 } else { 0 };
    let idx = repo
        .cherrypick_commit(&pick, &head, mainline, None)
        .map_err(|e| e.to_string())?;
    let author = pick.author();
    let res = commit_index_on_head(&repo, idx, &author, pick.message().unwrap_or(""), "cherry-pick");
    res
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_revert(path: String, commit: String) -> Result<String> {
    let repo = open(&path)?;
    let target = repo
        .revparse_single(&commit)
        .and_then(|o| o.peel_to_commit())
        .map_err(|e| format!("commit {commit}: {e}"))?;
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| e.to_string())?;
    let mainline = if target.parent_count() > 1 { 1 } else { 0 };
    let idx = repo
        .revert_commit(&target, &head, mainline, None)
        .map_err(|e| e.to_string())?;
    let author = repo
        .signature()
        .map_err(|e| format!("no git identity configured (user.name / user.email): {e}"))?;
    let msg = format!(
        "Revert \"{}\"\n\nThis reverts commit {}.\n",
        target.summary().ok().flatten().unwrap_or(""),
        target.id()
    );
    commit_index_on_head(&repo, idx, &author, &msg, "revert")
}

/// Reset modes accepted by [`repo_reset`]; `mixed` when the caller passes none.
pub const RESET_MODES: [&str; 3] = ["soft", "mixed", "hard"];
pub const RESET_DEFAULT_MODE: &str = "mixed";

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_reset(path: String, commit: String, mode: Option<String>) -> Result<String> {
    let repo = open(&path)?;
    let mode = mode.unwrap_or_else(|| RESET_DEFAULT_MODE.to_string());
    let kind = match mode.as_str() {
        "soft" => git2::ResetType::Soft,
        "mixed" => git2::ResetType::Mixed,
        "hard" => git2::ResetType::Hard,
        other => return Err(format!("reset mode '{other}' not one of {RESET_MODES:?}")),
    };
    let target = repo
        .revparse_single(&commit)
        .map_err(|e| format!("commit {commit}: {e}"))?;
    repo.reset(&target, kind, None).map_err(|e| e.to_string())?;
    let id = target.peel_to_commit().map_err(|e| e.to_string())?.id().to_string();
    Ok(id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_stash_apply(path: String, index: Option<usize>) -> Result<()> {
    let mut repo = open(&path)?;
    repo.stash_apply(index.unwrap_or(0), None)
        .map_err(|e| e.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_stash_drop(path: String, index: Option<usize>) -> Result<()> {
    let mut repo = open(&path)?;
    repo.stash_drop(index.unwrap_or(0)).map_err(|e| e.to_string())
}

// ---- interactive rebase ----

/// Actions a todo row may carry. `pick` is what [`repo_rebase_plan`] emits.
pub const REBASE_ACTIONS: [&str; 5] = ["pick", "squash", "fixup", "reword", "drop"];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RebaseRow {
    pub id: String,
    pub action: String,
    pub summary: String,
    /// new commit message; required for `reword`, ignored otherwise
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct RebaseOutcome {
    /// `done` | `conflict`
    pub status: String,
    /// branch/HEAD tip after the run (new tip when done)
    pub head: Option<String>,
    pub message: String,
    /// on `conflict`: the paths in conflict
    pub conflicts: Vec<String>,
    /// on `conflict`: shell command that abandons the rebase
    pub abort_command: Option<String>,
}

fn plan_rows(repo: &Repository, onto: &str, from: Option<&str>) -> Result<(Vec<RebaseRow>, git2::Oid, git2::Oid)> {
    let onto_c = repo
        .revparse_single(onto)
        .and_then(|o| o.peel_to_commit())
        .map_err(|e| format!("onto {onto}: {e}"))?;
    let from_c = match from {
        Some(f) => repo.revparse_single(f).and_then(|o| o.peel_to_commit()),
        None => repo.head().and_then(|h| h.peel_to_commit()),
    }
    .map_err(|e| format!("from: {e}"))?;
    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE).map_err(|e| e.to_string())?;
    walk.push(from_c.id()).map_err(|e| e.to_string())?;
    walk.hide(onto_c.id()).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for oid in walk {
        let oid = oid.map_err(|e| e.to_string())?;
        let c = repo.find_commit(oid).map_err(|e| e.to_string())?;
        if c.parent_count() > 1 {
            return Err(format!("merge commit {} in range; interactive rebase needs linear history", oid));
        }
        rows.push(RebaseRow {
            id: oid.to_string(),
            action: "pick".into(),
            summary: c.summary().ok().flatten().unwrap_or("").to_string(),
            message: None,
        });
    }
    Ok((rows, onto_c.id(), from_c.id()))
}

/// Todo list for `onto..from` (`from` defaults to HEAD), oldest first, all `pick`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_rebase_plan(path: String, onto: String, from: Option<String>) -> Result<Vec<RebaseRow>> {
    let repo = open(&path)?;
    plan_rows(&repo, &onto, from.as_deref()).map(|(rows, _, _)| rows)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_rebase_abort(path: String) -> Result<()> {
    let repo = open(&path)?;
    let mut rb = repo.open_rebase(None).map_err(|e| format!("no rebase in progress: {e}"))?;
    rb.abort().map_err(|e| e.to_string())
}

/// Execute a (possibly edited) todo list. Row order must equal the order
/// [`repo_rebase_plan`] produced — libgit2's rebase replays the original range, so
/// only the *action* per row changes (reordering is rejected, not silently ignored).
/// Stops at the first conflict, leaves the rebase open, and reports the abort command.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn repo_rebase_apply(
    path: String,
    onto: String,
    from: Option<String>,
    plan: Vec<RebaseRow>,
) -> Result<RebaseOutcome> {
    let repo = open(&path)?;
    let (orig, onto_id, from_id) = plan_rows(&repo, &onto, from.as_deref())?;
    if orig.len() != plan.len() || orig.iter().zip(&plan).any(|(a, b)| a.id != b.id) {
        return Err(format!(
            "plan does not match {onto}..{}: rows must be the same commits in the same order",
            from.as_deref().unwrap_or("HEAD")
        ));
    }
    let mut kept = false;
    for row in &plan {
        if !REBASE_ACTIONS.contains(&row.action.as_str()) {
            return Err(format!("row {}: action '{}' not one of {REBASE_ACTIONS:?}", row.id, row.action));
        }
        match row.action.as_str() {
            "reword" if row.message.as_deref().map(str::trim).unwrap_or("").is_empty() => {
                return Err(format!("row {}: reword needs a non-empty message", row.id));
            }
            "squash" | "fixup" if !kept => {
                return Err(format!("row {}: {} has no earlier kept commit to combine into", row.id, row.action));
            }
            "drop" => {}
            _ => kept = true,
        }
    }
    let dirty = repo
        .statuses(Some(StatusOptions::new().include_untracked(false)))
        .map_err(|e| e.to_string())?;
    if !dirty.is_empty() {
        return Err("working tree has uncommitted changes; commit or stash before rebasing".into());
    }
    if plan.is_empty() {
        return Ok(RebaseOutcome {
            status: "done".into(),
            head: Some(from_id.to_string()),
            message: "nothing to rebase".into(),
            conflicts: vec![],
            abort_command: None,
        });
    }
    let sig = repo
        .signature()
        .map_err(|e| format!("no git identity configured (user.name / user.email): {e}"))?;
    let branch = repo.find_annotated_commit(from_id).map_err(|e| e.to_string())?;
    let onto_a = repo.find_annotated_commit(onto_id).map_err(|e| e.to_string())?;
    let mut rb = repo
        .rebase(Some(&branch), Some(&onto_a), Some(&onto_a), None)
        .map_err(|e| format!("rebase start: {e}"))?;
    let mut step = 0usize;
    while let Some(op) = rb.next() {
        let op = op.map_err(|e| e.to_string())?;
        let row = &plan[step];
        step += 1;
        debug_assert_eq!(op.id().to_string(), row.id);
        let idx = repo.index().map_err(|e| e.to_string())?;
        if idx.has_conflicts() {
            let conflicts = conflict_paths(&idx);
            return Ok(RebaseOutcome {
                status: "conflict".into(),
                head: None,
                message: format!(
                    "stopped at {} ({}): conflicts in {}",
                    &row.id[..8.min(row.id.len())],
                    row.summary,
                    conflicts.join(", ")
                ),
                conflicts,
                abort_command: Some(format!("git -C '{path}' rebase --abort")),
            });
        }
        match row.action.as_str() {
            "pick" => {
                rb.commit(None, &sig, None).map_err(|e| e.to_string())?;
            }
            "reword" => {
                rb.commit(None, &sig, row.message.as_deref()).map_err(|e| e.to_string())?;
            }
            "squash" | "fixup" => {
                let mut idx = repo.index().map_err(|e| e.to_string())?;
                let tree = repo
                    .find_tree(idx.write_tree().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                let prev = repo.head().and_then(|h| h.peel_to_commit()).map_err(|e| e.to_string())?;
                let src = repo.find_commit(op.id()).map_err(|e| e.to_string())?;
                let msg = if row.action == "squash" {
                    format!("{}\n\n{}", prev.message().unwrap_or("").trim_end(), src.message().unwrap_or("").trim_end())
                } else {
                    prev.message().unwrap_or("").to_string()
                };
                let parents: Vec<git2::Commit> = prev.parents().collect();
                let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
                let combined = repo
                    .commit(None, &prev.author(), &sig, &msg, &tree, &parent_refs)
                    .map_err(|e| e.to_string())?;
                repo.set_head_detached(combined).map_err(|e| e.to_string())?;
            }
            "drop" => {
                // not `reset --hard`: libgit2's reset clears the on-disk rebase state
                let mut co = CheckoutBuilder::new();
                co.force();
                repo.checkout_head(Some(&mut co)).map_err(|e| e.to_string())?;
            }
            other => return Err(format!("unreachable action {other}")),
        }
    }
    rb.finish(Some(&sig)).map_err(|e| e.to_string())?;
    let head = repo.head().ok().and_then(|h| h.target()).map(|o| o.to_string());
    Ok(RebaseOutcome {
        status: "done".into(),
        head,
        message: format!("rebased {} rows onto {}", plan.len(), &onto_id.to_string()[..8]),
        conflicts: vec![],
        abort_command: None,
    })
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

    // ---------- new atoms: tempfile-init repo round trips (no network) ----------
    fn init_temp_repo() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_string_lossy().to_string();
        let repo = Repository::init(&path).expect("init");
        let mut cfg = repo.config().expect("config");
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@example.com").unwrap();
        (dir, path)
    }

    fn write_and_commit(path: &str, file: &str, contents: &str, message: &str) -> String {
        std::fs::write(Path::new(path).join(file), contents).expect("write file");
        repo_stage(path.to_string(), vec![file.to_string()]).expect("stage");
        repo_commit(path.to_string(), message.to_string()).expect("commit")
    }

    #[test]
    fn branch_create_and_checkout_round_trip() {
        let (_dir, path) = init_temp_repo();
        write_and_commit(&path, "a.txt", "one", "first");
        repo_branch_create(path.clone(), "feature".into(), None).expect("branch create");
        let branches = repo_branches(path.clone()).expect("branches");
        assert!(branches.iter().any(|b| b.name == "feature"));
        repo_checkout(path.clone(), "feature".into()).expect("checkout");
        let info = repo_info(path.clone()).expect("info");
        assert_eq!(info.head.as_deref(), Some("feature"));
    }

    #[test]
    fn stash_save_pop_round_trip() {
        let (_dir, path) = init_temp_repo();
        write_and_commit(&path, "a.txt", "one", "first");
        std::fs::write(Path::new(&path).join("a.txt"), "two").expect("modify");
        repo_stash_save(path.clone(), Some("wip".into())).expect("stash save");
        let dirty = std::fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
        assert_eq!(dirty, "one", "stash save should restore the clean working tree");
        let list = repo_stash_list(path.clone()).expect("stash list");
        assert_eq!(list.len(), 1);
        repo_stash_pop(path.clone(), None).expect("stash pop");
        let restored = std::fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
        assert_eq!(restored, "two");
        let list_after = repo_stash_list(path).expect("stash list after pop");
        assert!(list_after.is_empty());
    }

    #[test]
    fn commit_files_reports_added_paths() {
        let (_dir, path) = init_temp_repo();
        let oid = write_and_commit(&path, "a.txt", "one", "first");
        let files = repo_commit_files(path, oid).expect("commit files");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].status, "A");
    }

    #[test]
    fn tree_lists_entries_at_commit() {
        let (_dir, path) = init_temp_repo();
        let oid = write_and_commit(&path, "a.txt", "one", "first");
        let entries = repo_tree(path, oid, None).expect("tree");
        assert!(entries.iter().any(|e| e.name == "a.txt" && !e.is_dir));
    }

    #[test]
    fn unstage_removes_from_index_without_touching_workdir() {
        let (_dir, path) = init_temp_repo();
        write_and_commit(&path, "a.txt", "one", "first");
        std::fs::write(Path::new(&path).join("a.txt"), "two").expect("modify");
        repo_stage(path.clone(), vec!["a.txt".into()]).expect("stage");
        let staged_before = repo_status(path.clone()).expect("status");
        assert!(staged_before.iter().any(|s| s.path == "a.txt" && s.staged));
        repo_unstage(path.clone(), vec!["a.txt".into()]).expect("unstage");
        let staged_after = repo_status(path.clone()).expect("status");
        assert!(staged_after.iter().any(|s| s.path == "a.txt" && !s.staged));
        let contents = std::fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
        assert_eq!(contents, "two", "unstage must not touch the working tree");
    }

    #[test]
    fn tags_and_remotes_read_empty_repo_without_error() {
        let (_dir, path) = init_temp_repo();
        assert!(repo_tags(path.clone()).expect("tags").is_empty());
        assert!(repo_remotes(path.clone()).expect("remotes").is_empty());
        assert!(repo_worktrees(path).expect("worktrees").is_empty());
    }
}

/// Throwaway-repo fixtures shared by the history-op test modules.
#[cfg(test)]
mod hist_fixture {
    use super::*;
    pub fn repo() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_string_lossy().to_string();
        let repo = Repository::init(&path).expect("init");
        let mut cfg = repo.config().expect("config");
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@example.com").unwrap();
        (dir, path)
    }
    pub fn commit(path: &str, file: &str, contents: &str, message: &str) -> String {
        std::fs::write(Path::new(path).join(file), contents).expect("write");
        repo_stage(path.to_string(), vec![file.to_string()]).expect("stage");
        repo_commit(path.to_string(), message.to_string()).expect("commit")
    }
    pub fn summaries(path: &str) -> Vec<String> {
        repo_log(path.to_string(), None).expect("log").into_iter().map(|c| c.summary).collect()
    }
    pub fn read(path: &str, file: &str) -> String {
        std::fs::read_to_string(Path::new(path).join(file)).expect("read")
    }
}

#[cfg(test)]
mod rebase {
    use super::hist_fixture::*;
    use super::*;

    /// base + c1 c2 c3, each touching its own file.
    fn four() -> (tempfile::TempDir, String, Vec<String>) {
        let (d, p) = repo();
        let ids = vec![
            commit(&p, "base.txt", "b", "base"),
            commit(&p, "a.txt", "a", "add a"),
            commit(&p, "b.txt", "b", "add b"),
            commit(&p, "c.txt", "c", "add c"),
        ];
        (d, p, ids)
    }
    fn set(plan: &mut [RebaseRow], i: usize, action: &str) {
        plan[i].action = action.into();
    }

    #[test]
    fn plan_lists_commits_after_onto_oldest_first() {
        let (_d, p, ids) = four();
        let plan = repo_rebase_plan(p, ids[0].clone(), None).unwrap();
        let got: Vec<_> = plan.iter().map(|r| (r.id.clone(), r.action.as_str(), r.summary.as_str())).collect();
        assert_eq!(got, vec![
            (ids[1].clone(), "pick", "add a"),
            (ids[2].clone(), "pick", "add b"),
            (ids[3].clone(), "pick", "add c"),
        ]);
    }

    #[test]
    fn squash_three_into_one() {
        let (_d, p, ids) = four();
        let mut plan = repo_rebase_plan(p.clone(), ids[0].clone(), None).unwrap();
        set(&mut plan, 1, "squash");
        set(&mut plan, 2, "fixup");
        let out = repo_rebase_apply(p.clone(), ids[0].clone(), None, plan).unwrap();
        assert_eq!(out.status, "done", "{out:?}");
        assert_eq!(summaries(&p), vec!["add a", "base"]);
        // squash joined messages, fixup dropped its own
        let head = repo_log(p.clone(), Some(1)).unwrap().remove(0);
        assert_eq!(head.parents, vec![ids[0].clone()]);
        let repo = Repository::open(&p).unwrap();
        let msg = repo.head().unwrap().peel_to_commit().unwrap().message().unwrap().to_string();
        assert_eq!(msg, "add a\n\nadd b");
        for f in ["a.txt", "b.txt", "c.txt"] {
            assert!(Path::new(&p).join(f).exists(), "{f} content kept in the squashed commit");
        }
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn drop_middle_commit() {
        let (_d, p, ids) = four();
        let mut plan = repo_rebase_plan(p.clone(), ids[0].clone(), None).unwrap();
        set(&mut plan, 1, "drop");
        let out = repo_rebase_apply(p.clone(), ids[0].clone(), None, plan).unwrap();
        assert_eq!(out.status, "done", "{out:?}");
        assert_eq!(summaries(&p), vec!["add c", "add a", "base"]);
        assert!(!Path::new(&p).join("b.txt").exists(), "dropped commit's file is gone");
        assert!(Path::new(&p).join("c.txt").exists());
    }

    #[test]
    fn reword_replaces_message() {
        let (_d, p, ids) = four();
        let mut plan = repo_rebase_plan(p.clone(), ids[0].clone(), None).unwrap();
        set(&mut plan, 1, "reword");
        plan[1].message = Some("add b (renamed)".into());
        let out = repo_rebase_apply(p.clone(), ids[0].clone(), None, plan).unwrap();
        assert_eq!(out.status, "done", "{out:?}");
        assert_eq!(summaries(&p), vec!["add c", "add b (renamed)", "add a", "base"]);
    }

    #[test]
    fn reword_without_message_and_leading_squash_are_rejected() {
        let (_d, p, ids) = four();
        let mut plan = repo_rebase_plan(p.clone(), ids[0].clone(), None).unwrap();
        set(&mut plan, 0, "reword");
        assert!(repo_rebase_apply(p.clone(), ids[0].clone(), None, plan).unwrap_err().contains("reword needs"));
        let mut plan = repo_rebase_plan(p.clone(), ids[0].clone(), None).unwrap();
        set(&mut plan, 0, "squash");
        assert!(repo_rebase_apply(p.clone(), ids[0].clone(), None, plan).unwrap_err().contains("no earlier kept commit"));
        let mut plan = repo_rebase_plan(p.clone(), ids[0].clone(), None).unwrap();
        plan.swap(0, 1);
        assert!(repo_rebase_apply(p, ids[0].clone(), None, plan).unwrap_err().contains("same order"));
    }

    #[test]
    fn conflict_stops_and_abort_restores() {
        let (_d, p) = repo();
        let base = commit(&p, "f.txt", "base", "base");
        commit(&p, "f.txt", "one", "edit one");
        let tip = commit(&p, "f.txt", "two", "edit two");
        let mut plan = repo_rebase_plan(p.clone(), base.clone(), None).unwrap();
        // drop the FIRST edit, keep the second: its patch (one->two) cannot apply onto base
        set(&mut plan, 0, "drop");
        let out = repo_rebase_apply(p.clone(), base, None, plan).unwrap();
        assert_eq!(out.status, "conflict", "{out:?}");
        assert_eq!(out.conflicts, vec!["f.txt"]);
        let abort = out.abort_command.expect("abort command reported");
        assert!(abort.contains("rebase --abort"), "{abort}");
        repo_rebase_abort(p.clone()).expect("abort");
        let repo = Repository::open(&p).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert_eq!(repo.head().unwrap().target().unwrap().to_string(), tip);
        assert_eq!(read(&p, "f.txt"), "two");
    }
}

#[cfg(test)]
mod history_ops {
    use super::hist_fixture::*;
    use super::*;

    #[test]
    fn reset_soft_keeps_index_and_files() {
        let (_d, p) = repo();
        let first = commit(&p, "a.txt", "1", "first");
        commit(&p, "a.txt", "2", "second");
        repo_reset(p.clone(), first.clone(), Some("soft".into())).unwrap();
        assert_eq!(summaries(&p), vec!["first"]);
        assert_eq!(read(&p, "a.txt"), "2");
        let st = repo_status(p).unwrap();
        assert!(st.iter().any(|s| s.path == "a.txt" && s.staged), "change still staged: {:?}", st.iter().map(|s| (&s.path, s.staged)).collect::<Vec<_>>());
    }

    #[test]
    fn reset_default_is_mixed_unstages_but_keeps_files() {
        let (_d, p) = repo();
        let first = commit(&p, "a.txt", "1", "first");
        commit(&p, "a.txt", "2", "second");
        repo_reset(p.clone(), first, None).unwrap();
        assert_eq!(read(&p, "a.txt"), "2");
        let st = repo_status(p).unwrap();
        assert!(st.iter().any(|s| s.path == "a.txt" && !s.staged));
    }

    #[test]
    fn reset_hard_discards_files_and_rejects_bad_mode() {
        let (_d, p) = repo();
        let first = commit(&p, "a.txt", "1", "first");
        commit(&p, "a.txt", "2", "second");
        assert!(repo_reset(p.clone(), first.clone(), Some("bogus".into())).is_err());
        repo_reset(p.clone(), first, Some("hard".into())).unwrap();
        assert_eq!(read(&p, "a.txt"), "1");
        assert!(repo_status(p).unwrap().is_empty());
    }

    #[test]
    fn stash_apply_keeps_entry_drop_removes_pop_round_trips() {
        let (_d, p) = repo();
        commit(&p, "a.txt", "one", "first");
        std::fs::write(Path::new(&p).join("a.txt"), "two").unwrap();
        repo_stash_save(p.clone(), Some("wip".into())).unwrap();
        assert_eq!(read(&p, "a.txt"), "one");
        repo_stash_apply(p.clone(), None).unwrap();
        assert_eq!(read(&p, "a.txt"), "two");
        assert_eq!(repo_stash_list(p.clone()).unwrap().len(), 1, "apply keeps the stash");
        repo_stash_drop(p.clone(), Some(0)).unwrap();
        assert!(repo_stash_list(p.clone()).unwrap().is_empty());
        // pop round-trip
        repo_reset(p.clone(), "HEAD".into(), Some("hard".into())).unwrap();
        std::fs::write(Path::new(&p).join("a.txt"), "three").unwrap();
        repo_stash_save(p.clone(), None).unwrap();
        assert_eq!(read(&p, "a.txt"), "one");
        repo_stash_pop(p.clone(), None).unwrap();
        assert_eq!(read(&p, "a.txt"), "three");
        assert!(repo_stash_list(p).unwrap().is_empty());
    }

    #[test]
    fn cherry_pick_copies_commit_onto_head() {
        let (_d, p) = repo();
        commit(&p, "base.txt", "b", "base");
        let main = repo_info(p.clone()).unwrap().head.unwrap();
        repo_branch_create(p.clone(), "side".into(), None).unwrap();
        repo_checkout(p.clone(), "side".into()).unwrap();
        let side = commit(&p, "side.txt", "s", "side work");
        repo_checkout(p.clone(), main).unwrap();
        assert!(!Path::new(&p).join("side.txt").exists());
        repo_cherry_pick(p.clone(), side).unwrap();
        assert_eq!(summaries(&p), vec!["side work", "base"]);
        assert_eq!(read(&p, "side.txt"), "s");
        assert!(repo_status(p).unwrap().is_empty());
    }

    #[test]
    fn revert_adds_inverse_commit() {
        let (_d, p) = repo();
        commit(&p, "a.txt", "1", "first");
        let second = commit(&p, "a.txt", "2", "second");
        repo_revert(p.clone(), second).unwrap();
        assert_eq!(read(&p, "a.txt"), "1");
        assert_eq!(summaries(&p)[0], "Revert \"second\"");
        assert!(repo_status(p).unwrap().is_empty());
    }
}
