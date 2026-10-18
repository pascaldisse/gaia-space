//! Headless proof seam: runs ONE real `git::*` command (the same functions the Tauri
//! commands wrap) and prints `{"ok":..}` JSON. Used by tools/git-ui-proof so a plain
//! browser can drive the real Repos view against real libgit2. Not shipped to users.
//! usage: git-rpc <command>   (args as one JSON object on stdin)
use gaia_space_lib::git;
use serde_json::{json, Value};
use std::io::Read;
fn arg<T: serde::de::DeserializeOwned>(a: &Value, k: &str) -> Result<T, String> {
    serde_json::from_value(a.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("arg {k}: {e}"))
}
fn out<T: serde::Serialize>(r: git::Result<T>) -> Result<Value, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}
fn run(cmd: &str, a: &Value) -> Result<Value, String> {
    match cmd {
        "repo_list" => out(Ok(git::repo_list())),
        "repo_info" => out(git::repo_info(arg(a, "path")?)),
        "repo_log" => out(git::repo_log(arg(a, "path")?, arg(a, "limit")?)),
        "repo_branches" => out(git::repo_branches(arg(a, "path")?)),
        "repo_tags" => out(git::repo_tags(arg(a, "path")?)),
        "repo_stash_list" => out(git::repo_stash_list(arg(a, "path")?)),
        "repo_worktrees" => out(git::repo_worktrees(arg(a, "path")?)),
        "repo_changes" => out(git::repo_changes(arg(a, "path")?)),
        "repo_diff" => out(git::repo_diff(arg(a, "path")?, arg(a, "id")?)),
        "repo_file_diff" => out(git::repo_file_diff(arg(a, "path")?, arg(a, "file")?, arg(a, "staged")?)),
        "repo_stage" => out(git::repo_stage(arg(a, "path")?, arg(a, "files")?)),
        "repo_unstage" => out(git::repo_unstage(arg(a, "path")?, arg(a, "files")?)),
        "repo_stage_hunk" => out(git::repo_stage_hunk(arg(a, "path")?, arg(a, "file")?, arg(a, "hunk")?)),
        "repo_unstage_hunk" => out(git::repo_unstage_hunk(arg(a, "path")?, arg(a, "file")?, arg(a, "hunk")?)),
        "repo_discard" => out(git::repo_discard(arg(a, "path")?, arg(a, "files")?)),
        "repo_commit" => out(git::repo_commit(arg(a, "path")?, arg(a, "message")?, arg(a, "amend")?)),
        "repo_checkout" => out(git::repo_checkout(arg(a, "path")?, arg(a, "branch")?, arg(a, "create")?)),
        "repo_branch_delete" => out(git::repo_branch_delete(arg(a, "path")?, arg(a, "name")?, arg(a, "force")?)),
        "repo_fetch" => out(git::repo_fetch(arg(a, "path")?, arg(a, "remote")?)),
        "repo_pull" => out(git::repo_pull(arg(a, "path")?, arg(a, "remote")?)),
        "repo_push" => out(git::repo_push(arg(a, "path")?, arg(a, "remote")?, arg(a, "branch")?)),
        "repo_commit_files" => out(git::repo_commit_files(arg(a, "path")?, arg(a, "id")?)),
        "repo_tree" => out(git::repo_tree(arg(a, "path")?, arg(a, "id")?, arg(a, "dir")?)),
        other => Err(format!("git-rpc: unsupported command {other}")),
    }
}
fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    let mut buf = String::new();
    let _ = std::io::stdin().read_to_string(&mut buf);
    let args: Value = serde_json::from_str(&buf).unwrap_or(json!({}));
    let reply = match run(&cmd, &args) {
        Ok(v) => json!({"ok": true, "value": v}),
        Err(e) => json!({"ok": false, "error": e}),
    };
    println!("{reply}");
}
