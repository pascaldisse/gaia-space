//! The tool set: `read_file`, `list_files` and `grep` are read-only; `write_file` and
//! `edit_file` change the repository and are run only through the approval path
//! ([`execute_write`]), never by the run loop directly.
//!
//! Every path argument is repository-relative and resolved through [`Jail`], so a tool
//! cannot be talked into reading or writing outside the project. A refusal is returned
//! as the tool result — the model sees why — rather than aborting the run: an agent that
//! wandered into `..` should be corrected, not killed.

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
/// One write may not put more than this into the repository. An agent that wants to
/// paste a megabyte should be asked why first.
pub const MAX_WRITE_BYTES: usize = 1024 * 1024;

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
        ToolSchema::function(
            "write_file",
            "Write one file in the repository, creating it or replacing its contents. The parent directory must already exist.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository-relative file path"},
                    "content": {"type": "string", "description": "The complete new contents"}
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
        ),
        ToolSchema::function(
            "edit_file",
            "Replace one exact, unique occurrence of `old_text` with `new_text`. If `old_text` is not unique, include more surrounding text.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository-relative file path"},
                    "old_text": {"type": "string", "description": "Exact text to replace; must occur once"},
                    "new_text": {"type": "string", "description": "Replacement text"}
                },
                "required": ["path", "old_text", "new_text"],
                "additionalProperties": false
            }),
        ),
    ]
}

pub fn tool_names() -> Vec<&'static str> {
    vec![
        "read_file",
        "list_files",
        "grep",
        "write_file",
        "edit_file",
    ]
}

/// Which tools change the repository. The run loop asks this before dispatching a turn:
/// a turn containing any of these is proposed to the user and applied only after an
/// explicit approval row, never in the same breath as the model's request.
pub fn requires_approval(tool: &str) -> bool {
    matches!(tool, "write_file" | "edit_file")
}

fn parse_args(tool: &str, args_json: &str) -> Result<Value> {
    let args: Value = serde_json::from_str(args_json)
        .map_err(|e| format!("{tool} arguments are not valid JSON: {e}"))?;
    if !args.is_object() {
        return Err(format!("{tool} arguments must be a JSON object"));
    }
    Ok(args)
}

/// Run one read-only tool. `args_json` is the model's own string, so a malformed call is
/// reported rather than turned into a panic.
///
/// A write reaching this door is an error, not a write: the only caller allowed to run
/// one is [`run::apply_call_in`](crate::agent::run::apply_call_in), and only on a call
/// the user approved.
pub fn execute(jail: &Jail, tool: &str, args_json: &str) -> Result<String> {
    if requires_approval(tool) {
        return Err(format!("{tool} needs approval before it can run"));
    }
    let args = parse_args(tool, args_json)?;
    match tool {
        "read_file" => read_file(jail, &args),
        "list_files" => list_files(jail, &args),
        "grep" => grep(jail, &args),
        other => Err(format!("unknown tool {other}")),
    }
}

/// Run one approved write. Refuses every read-only tool, so the approval path can never
/// be used as a general dispatcher.
pub fn execute_write(jail: &Jail, tool: &str, args_json: &str) -> Result<String> {
    if !requires_approval(tool) {
        return Err(format!("{tool} is not a write tool"));
    }
    let args = parse_args(tool, args_json)?;
    match tool {
        "write_file" => write_file(jail, &args),
        "edit_file" => edit_file(jail, &args),
        other => Err(format!("unknown tool {other}")),
    }
}

fn required(args: &Value, name: &str) -> Result<String> {
    match args.get(name).and_then(Value::as_str).map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value.to_string()),
        _ => Err(format!("{name} is required")),
    }
}

/// Unlike [`required`], nothing is trimmed: leading whitespace inside a file is content.
fn string_arg(args: &Value, name: &str) -> Result<String> {
    match args.get(name).and_then(Value::as_str) {
        Some(value) => Ok(value.to_string()),
        None => Err(format!("{name} is required and must be a string")),
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

fn write_file(jail: &Jail, args: &Value) -> Result<String> {
    let raw = required(args, "path")?;
    let content = string_arg(args, "content")?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "content is {} bytes; the limit for one write is {MAX_WRITE_BYTES}",
            content.len()
        ));
    }
    let path = jail.resolve_for_write(&raw)?;
    fs::write(&path, content.as_bytes()).map_err(|e| format!("could not write {raw}: {e}"))?;
    Ok(format!("wrote {} bytes to {raw}", content.len()))
}

/// Exact-match replace, and the match must be unique — the same discipline this repo's
/// own tooling uses. A repeated fragment is refused rather than guessed at: "replace the
/// first one" is how an agent silently edits the wrong function.
fn edit_file(jail: &Jail, args: &Value) -> Result<String> {
    let raw = required(args, "path")?;
    let old_text = string_arg(args, "old_text")?;
    let new_text = string_arg(args, "new_text")?;
    if old_text.is_empty() {
        return Err("old_text must not be empty; quote the exact text to replace".into());
    }
    if old_text == new_text {
        return Err("old_text and new_text are identical; there is nothing to replace".into());
    }
    let path = jail.resolve_for_write(&raw)?;
    if !path.is_file() {
        return Err(format!("{raw} is not an existing file; use write_file to create it"));
    }
    let bytes = fs::read(&path).map_err(|e| format!("could not read {raw}: {e}"))?;
    if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return Err(format!("{raw} looks like a binary file"));
    }
    let text = String::from_utf8(bytes).map_err(|_| format!("{raw} is not valid UTF-8"))?;
    let found = text.matches(&old_text).count();
    match found {
        1 => {}
        0 => return Err(format!("old_text was not found in {raw}")),
        count => {
            return Err(format!(
                "old_text occurs {count} times in {raw}; include more surrounding text so it matches exactly once"
            ))
        }
    }
    let updated = text.replacen(&old_text, &new_text, 1);
    if updated.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "the edited file would be {} bytes; the limit for one write is {MAX_WRITE_BYTES}",
            updated.len()
        ));
    }
    fs::write(&path, updated.as_bytes()).map_err(|e| format!("could not write {raw}: {e}"))?;
    Ok(format!(
        "edited {raw}: 1 replacement, {} bytes",
        updated.len()
    ))
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

    // --- writes (Stage 3) ---------------------------------------------------------

    #[test]
    fn a_write_is_not_reachable_through_the_read_door() {
        let (_base, jail) = scratch("doors");
        assert!(execute(&jail, "write_file", r#"{"path":"x","content":"y"}"#)
            .unwrap_err()
            .contains("needs approval"));
        assert!(execute(&jail, "edit_file", r#"{"path":"README.md","old_text":"a","new_text":"b"}"#)
            .unwrap_err()
            .contains("needs approval"));
        assert!(execute_write(&jail, "read_file", r#"{"path":"README.md"}"#)
            .unwrap_err()
            .contains("not a write tool"));
    }

    #[test]
    fn requires_approval_classifies_every_declared_tool() {
        let declared: Vec<String> = schemas()
            .into_iter()
            .map(|schema| schema.function.name)
            .collect();
        assert_eq!(declared.len(), tool_names().len());
        for name in declared {
            let expected = matches!(name.as_str(), "write_file" | "edit_file");
            assert_eq!(requires_approval(&name), expected, "{name} is misclassified");
        }
        assert!(!requires_approval("no_such_tool"));
    }

    #[test]
    fn write_file_creates_replaces_and_may_write_nothing() {
        let (_base, jail) = scratch("write-file");
        let summary = execute_write(
            &jail,
            "write_file",
            r#"{"path":"src/new.rs","content":"fn a() {}\n"}"#,
        )
        .unwrap();
        assert!(summary.starts_with("wrote "), "{summary}");
        assert_eq!(
            fs::read_to_string(jail.root().join("src/new.rs")).unwrap(),
            "fn a() {}\n"
        );

        execute_write(
            &jail,
            "write_file",
            r#"{"path":"README.md","content":"replaced\n"}"#,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(jail.root().join("README.md")).unwrap(), "replaced\n");

        execute_write(&jail, "write_file", r#"{"path":"empty.txt","content":""}"#).unwrap();
        assert_eq!(fs::read_to_string(jail.root().join("empty.txt")).unwrap(), "");

        assert!(execute_write(&jail, "write_file", r#"{"path":"README.md"}"#)
            .unwrap_err()
            .contains("content"));
    }

    #[test]
    fn write_file_cannot_escape_or_touch_git() {
        let (base, jail) = scratch("write-escapes");
        assert!(execute_write(&jail, "write_file", r#"{"path":"../out.txt","content":"x"}"#)
            .unwrap_err()
            .contains("climb out"));
        assert!(execute_write(&jail, "write_file", r#"{"path":".git/hooks/pre-commit","content":"x"}"#)
            .unwrap_err()
            .contains(".git"));
        assert!(
            !base.join("repo-evil/out.txt").exists() && !base.join("out.txt").exists(),
            "nothing may be created outside the repository"
        );
        assert_eq!(
            fs::read_to_string(jail.root().join(".git/config")).unwrap(),
            "hello from git\n",
            "the repository's own config is untouched"
        );
    }

    #[test]
    fn edit_file_needs_one_exact_match() {
        let (_base, jail) = scratch("edit");
        execute_write(
            &jail,
            "write_file",
            r#"{"path":"note.txt","content":"alpha beta alpha beta\n"}"#,
        )
        .unwrap();

        let error = execute_write(
            &jail,
            "edit_file",
            r#"{"path":"note.txt","old_text":"alpha","new_text":"gamma"}"#,
        )
        .unwrap_err();
        assert!(error.contains("occurs 2 times"), "{error}");
        assert_eq!(
            fs::read_to_string(jail.root().join("note.txt")).unwrap(),
            "alpha beta alpha beta\n",
            "a refused edit changes nothing"
        );

        assert!(execute_write(
            &jail,
            "edit_file",
            r#"{"path":"note.txt","old_text":"delta","new_text":"gamma"}"#,
        )
        .unwrap_err()
        .contains("not found"));

        let summary = execute_write(
            &jail,
            "edit_file",
            r#"{"path":"note.txt","old_text":"alpha beta alpha","new_text":"gamma"}"#,
        )
        .unwrap();
        assert!(summary.contains("1 replacement"), "{summary}");
        assert_eq!(
            fs::read_to_string(jail.root().join("note.txt")).unwrap(),
            "gamma beta\n"
        );

        assert!(execute_write(
            &jail,
            "edit_file",
            r#"{"path":"absent.txt","old_text":"a","new_text":"b"}"#,
        )
        .unwrap_err()
        .contains("not an existing file"));
    }

    #[test]
    fn edit_file_refuses_a_binary_file_and_an_empty_search() {
        let (base, jail) = scratch("edit-refusals");
        fs::write(base.join("repo/blob.bin"), [0u8, 1, 2]).unwrap();
        assert!(execute_write(
            &jail,
            "edit_file",
            r#"{"path":"blob.bin","old_text":"a","new_text":"b"}"#,
        )
        .unwrap_err()
        .contains("binary"));
        assert!(execute_write(
            &jail,
            "edit_file",
            r#"{"path":"README.md","old_text":"","new_text":"b"}"#,
        )
        .unwrap_err()
        .contains("must not be empty"));
        assert!(execute_write(
            &jail,
            "edit_file",
            r#"{"path":"README.md","old_text":"hello","new_text":"hello"}"#,
        )
        .unwrap_err()
        .contains("identical"));
    }
}
