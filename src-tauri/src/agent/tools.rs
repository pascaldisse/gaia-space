//! The read-only tool set: `read_file`, `list_files`, `grep`.
//!
//! Every path argument is repository-relative and resolved through [`Jail`], so a tool
//! cannot be talked into reading outside the project. A refusal is returned as the tool
//! result — the model sees why — rather than aborting the run: an agent that wandered
//! into `..` should be corrected, not killed.

use crate::agent::jail::Jail;
use crate::agent::provider::ToolSchema;
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

type Result<T> = std::result::Result<T, String>;

/// A file larger than this is truncated: a tool result is context, not a download.
pub const MAX_READ_BYTES: usize = 256 * 1024;
/// A directory listing longer than this is truncated.
pub const MAX_LIST_ENTRIES: usize = 500;
/// A grep returns at most this many matching lines.
pub const MAX_MATCHES: usize = 200;
/// Files bigger than this are skipped by `grep` (minified bundles, generated data).
pub const MAX_GREP_FILE_BYTES: u64 = 512 * 1024;
/// How deep `grep` walks before giving up on a pathological tree.
pub const MAX_WALK_DEPTH: usize = 32;
/// Bytes inspected for a NUL before a file is called binary.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// What the model is offered. Kept next to the implementations so a tool cannot be
/// declared without existing, or exist without being declared.
pub fn schemas() -> Vec<ToolSchema> {
    vec![
        ToolSchema::function(
            "read_file",
            "Read one text file from the repository. `path` is relative to the repository root.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository-relative file path"}
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        ),
        ToolSchema::function(
            "list_files",
            "List one directory in the repository. Directories end with `/` and symlinks with `@`.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository-relative directory; defaults to the root"}
                },
                "additionalProperties": false
            }),
        ),
        ToolSchema::function(
            "grep",
            "Search the repository with a regular expression. Returns `path:line: text`.",
            json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Rust regular expression"},
                    "path": {"type": "string", "description": "Repository-relative file or directory; defaults to the root"}
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
        ),
    ]
}

pub fn tool_names() -> Vec<&'static str> {
    vec!["read_file", "list_files", "grep"]
}

/// Run one tool. `args_json` is the model's own string, so a malformed call is reported
/// rather than turned into a panic.
pub fn execute(jail: &Jail, tool: &str, args_json: &str) -> Result<String> {
    let args: Value = serde_json::from_str(args_json)
        .map_err(|e| format!("{tool} arguments are not valid JSON: {e}"))?;
    if !args.is_object() {
        return Err(format!("{tool} arguments must be a JSON object"));
    }
    match tool {
        "read_file" => read_file(jail, &args),
        "list_files" => list_files(jail, &args),
        "grep" => grep(jail, &args),
        other => Err(format!("unknown tool {other}")),
    }
}

fn required(args: &Value, name: &str) -> Result<String> {
    match args.get(name).and_then(Value::as_str).map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value.to_string()),
        _ => Err(format!("{name} is required")),
    }
}

fn optional(args: &Value, name: &str, default: &str) -> String {
    args.get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default)
        .to_string()
}

fn read_file(jail: &Jail, args: &Value) -> Result<String> {
    let raw = required(args, "path")?;
    let path = jail.resolve_existing(&raw)?;
    if !path.is_file() {
        return Err(format!("{raw} is not a file"));
    }
    let bytes = fs::read(&path).map_err(|e| format!("could not read {raw}: {e}"))?;
    let truncated = bytes.len() > MAX_READ_BYTES;
    let slice = &bytes[..bytes.len().min(MAX_READ_BYTES)];
    if slice.contains(&0) {
        return Err(format!("{raw} looks like a binary file"));
    }
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str(&format!(
            "\n… truncated: showing the first {} of {} bytes",
            MAX_READ_BYTES,
            bytes.len()
        ));
    }
    Ok(text)
}

fn list_files(jail: &Jail, args: &Value) -> Result<String> {
    let raw = optional(args, "path", ".");
    let dir = jail.resolve_existing(&raw)?;
    if !dir.is_dir() {
        return Err(format!("{raw} is not a directory"));
    }
    let mut entries = Vec::new();
    let mut skipped = 0usize;
    for entry in fs::read_dir(&dir).map_err(|e| format!("could not list {raw}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        if entries.len() >= MAX_LIST_ENTRIES {
            skipped += 1;
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        entries.push(if kind.is_dir() {
            format!("{name}/")
        } else if kind.is_symlink() {
            format!("{name}@")
        } else {
            name
        });
    }
    entries.sort();
    let mut out = entries.join("\n");
    if skipped > 0 {
        out.push_str(&format!(
            "\n… {skipped} more entries not shown (limit {MAX_LIST_ENTRIES})"
        ));
    }
    if out.is_empty() {
        out = "(empty directory)".into();
    }
    Ok(out)
}

fn grep(jail: &Jail, args: &Value) -> Result<String> {
    let pattern = required(args, "pattern")?;
    let regex = Regex::new(&pattern).map_err(|e| format!("invalid pattern: {e}"))?;
    let raw = optional(args, "path", ".");
    let start = jail.resolve_existing(&raw)?;
    let mut out = Vec::new();
    walk(jail, &start, &regex, 0, &mut out)?;
    if out.is_empty() {
        return Ok("no matches".into());
    }
    Ok(out.join("\n"))
}

fn walk(
    jail: &Jail,
    path: &Path,
    regex: &Regex,
    depth: usize,
    out: &mut Vec<String>,
) -> Result<()> {
    if out.len() >= MAX_MATCHES {
        return Ok(());
    }
    if path.is_file() {
        return scan_file(jail, path, regex, out);
    }
    if depth >= MAX_WALK_DEPTH {
        return Ok(());
    }
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut sorted: Vec<_> = entries.filter_map(std::result::Result::ok).collect();
    sorted.sort_by_key(|entry| entry.file_name());
    for entry in sorted {
        if out.len() >= MAX_MATCHES {
            return Ok(());
        }
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        // Symlinks are never followed: a link out of the tree would defeat containment,
        // and a link to a parent directory would make the walk endless.
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        walk(jail, &entry.path(), regex, depth + 1, out)?;
    }
    Ok(())
}

fn scan_file(jail: &Jail, path: &Path, regex: &Regex, out: &mut Vec<String>) -> Result<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if !metadata.is_file() || metadata.len() > MAX_GREP_FILE_BYTES {
        return Ok(());
    }
    let Ok(bytes) = fs::read(path) else {
        return Ok(());
    };
    if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return Ok(());
    }
    let relative = path.strip_prefix(jail.root()).unwrap_or(path);
    let relative = relative.display().to_string().replace('\\', "/");
    for (index, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
        if out.len() >= MAX_MATCHES {
            break;
        }
        if regex.is_match(line) {
            out.push(format!("{}:{}: {}", relative, index + 1, line.trim_end()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> (PathBuf, Jail) {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("agent-tools-tests")
            .join(format!("{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join("README.md"), "# Title\n\nhello world\n").unwrap();
        fs::write(repo.join("src/main.rs"), "fn main() { println!(\"hello\"); }\n").unwrap();
        fs::write(repo.join(".git/config"), "hello from git\n").unwrap();
        fs::create_dir_all(base.join("repo-evil")).unwrap();
        fs::write(base.join("repo-evil/secret.txt"), "hello outside\n").unwrap();
        let jail = Jail::new(repo.canonicalize().unwrap()).unwrap();
        (base, jail)
    }

    #[test]
    fn every_declared_tool_exists_and_nothing_else_runs() {
        let (_base, jail) = scratch("declared");
        for schema in schemas() {
            assert!(
                tool_names().contains(&schema.function.name.as_str()),
                "{} is declared but not implemented",
                schema.function.name
            );
        }
        assert!(execute(&jail, "delete_everything", "{}")
            .unwrap_err()
            .contains("unknown tool"));
        assert!(execute(&jail, "read_file", "not json").is_err());
        assert!(execute(&jail, "read_file", "[]").is_err());
    }

    #[test]
    fn read_file_returns_text_and_refuses_what_it_should() {
        let (_base, jail) = scratch("read");
        assert_eq!(
            execute(&jail, "read_file", r#"{"path":"README.md"}"#).unwrap(),
            "# Title\n\nhello world\n"
        );
        assert!(execute(&jail, "read_file", r#"{"path":"src"}"#)
            .unwrap_err()
            .contains("not a file"));
        assert!(execute(&jail, "read_file", r#"{"path":"missing"}"#).is_err());
        assert!(execute(&jail, "read_file", r#"{}"#).unwrap_err().contains("required"));
        assert!(execute(&jail, "read_file", r#"{"path":"../repo-evil/secret.txt"}"#)
            .unwrap_err()
            .contains("climb out"));
        assert!(execute(&jail, "read_file", r#"{"path":".git/config"}"#).is_err());
        assert!(
            !execute(&jail, "read_file", r#"{"path":"README.md"}"#)
                .unwrap()
                .contains("outside"),
            "a tool cannot reach the sibling tree"
        );
    }

    #[test]
    fn a_binary_file_is_named_rather_than_mangled() {
        let (base, jail) = scratch("binary");
        fs::write(base.join("repo/blob.bin"), [0u8, 159, 146, 150, 0, 1]).unwrap();
        let error = execute(&jail, "read_file", r#"{"path":"blob.bin"}"#).unwrap_err();
        assert!(error.contains("binary"), "{error}");
    }

    #[test]
    fn a_large_file_is_truncated_with_a_visible_marker() {
        let (base, jail) = scratch("large");
        fs::write(base.join("repo/big.txt"), "a".repeat(MAX_READ_BYTES + 10)).unwrap();
        let text = execute(&jail, "read_file", r#"{"path":"big.txt"}"#).unwrap();
        assert!(text.contains("truncated"));
        assert!(text.len() < MAX_READ_BYTES + 200);
    }

    #[test]
    fn list_files_is_sorted_marks_directories_and_hides_git() {
        let (_base, jail) = scratch("list");
        let listing = execute(&jail, "list_files", "{}").unwrap();
        let lines: Vec<&str> = listing.lines().collect();
        assert_eq!(lines, vec!["README.md", "src/"]);
        assert!(execute(&jail, "list_files", r#"{"path":"src"}"#).unwrap().contains("main.rs"));
        assert!(execute(&jail, "list_files", r#"{"path":"README.md"}"#)
            .unwrap_err()
            .contains("not a directory"));
    }

    #[test]
    fn grep_reports_path_line_and_text_and_hides_git() {
        let (_base, jail) = scratch("grep");
        let hits = execute(&jail, "grep", r#"{"pattern":"hello"}"#).unwrap();
        assert_eq!(hits, "README.md:3: hello world\nsrc/main.rs:1: fn main() { println!(\"hello\"); }");
        assert!(
            !hits.contains(".git/config"),
            "the repository's own config is not agent-visible"
        );
        assert_eq!(
            execute(&jail, "grep", r#"{"pattern":"nothing-here"}"#).unwrap(),
            "no matches"
        );
        assert!(execute(&jail, "grep", r#"{"pattern":"("}"#)
            .unwrap_err()
            .contains("invalid pattern"));
        assert!(execute(&jail, "grep", r#"{"pattern":"hello","path":"src"}"#)
            .unwrap()
            .starts_with("src/main.rs:1:"));
        assert!(execute(&jail, "grep", r#"{"pattern":"hello","path":"../repo-evil"}"#).is_err());
    }

    #[test]
    fn grep_does_not_follow_symlinks_out_of_the_tree() {
        let (base, jail) = scratch("grep-symlink");
        std::os::unix::fs::symlink(base.join("repo-evil"), base.join("repo/escape")).unwrap();
        let hits = execute(&jail, "grep", r#"{"pattern":"hello"}"#).unwrap();
        assert!(!hits.contains("outside"), "{hits}");
    }
}
