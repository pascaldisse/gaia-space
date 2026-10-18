//! Headless proof backend: runs the REAL `git.rs` commands by name with JSON args and prints the
//! JSON result. `git_cli <command> '<json args>'`. Used by proof/git-graph/shoot.mjs to feed the
//! Repos view in a plain browser (no Tauri shell); not shipped.
use gaia_space_lib::git;
use serde_json::{json, Value};
fn s(a: &Value, k: &str) -> String {
    a[k].as_str().unwrap_or_default().to_string()
}
fn os(a: &Value, k: &str) -> Option<String> {
    a[k].as_str().map(str::to_string)
}
fn out<T: serde::Serialize>(r: git::Result<T>) -> Value {
    match r {
        Ok(v) => json!({"ok": true, "value": v}),
        Err(e) => json!({"ok": false, "error": e}),
    }
}
fn main() {
    let mut args = std::env::args().skip(1);
    let cmd = args.next().expect("usage: git_cli <command> <json>");
    let a: Value = serde_json::from_str(&args.next().unwrap_or_else(|| "{}".into())).expect("json args");
    let p = s(&a, "path");
    let v = match cmd.as_str() {
        "repo_info" => out(git::repo_info(p)),
        "repo_log" => out(git::repo_log(p, a["limit"].as_u64().map(|n| n as usize))),
        "repo_log_graph" => out(git::repo_log_graph(p, a["limit"].as_u64().map(|n| n as usize), os(&a, "reference"))),
        "repo_branches" => out(git::repo_branches(p)),
        "repo_status" => out(git::repo_status(p)),
        "repo_changes" => out(git::repo_changes(p)),
        "repo_tags" => out(git::repo_tags(p)),
        "repo_remotes" => out(git::repo_remotes(p)),
        "repo_stash_list" => out(git::repo_stash_list(p)),
        "repo_worktrees" => out(git::repo_worktrees(p)),
        "repo_diff" => out(git::repo_diff(p, os(&a, "id"))),
        "repo_commit_files" => out(git::repo_commit_files(p, s(&a, "id"))),
        "repo_tree" => out(git::repo_tree(p, s(&a, "id"), os(&a, "dir"))),
        _ => json!({"ok": false, "error": format!("git_cli: unsupported command {cmd}")}),
    };
    println!("{v}");
}
