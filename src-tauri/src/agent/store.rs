//! Sessions, transcript and the tool-call ledger (V150).
//!
//! The database is the transcript. A run never holds state that is not also a row, so a
//! session killed mid-flight can be read back exactly as it was — [`transcript_in`]
//! rebuilds the wire messages from `agent_messages` plus `agent_tool_calls`, using the
//! call row's own id as the wire's `tool_call_id`. That is why the ledger exists rather
//! than a `tool_calls` column bolted onto the message row.

use crate::agent::{new_id, provider::Message};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

type Result<T> = std::result::Result<T, String>;

/// A run may not spend unlimited model calls on one task.
pub const DEFAULT_STEP_BUDGET: i64 = 24;
pub const STATUSES: [&str; 6] = [
    "idle",
    "running",
    "awaiting_approval",
    "done",
    "failed",
    "cancelled",
];

/// The single machine identity the agent works as. `principals.kind` already has
/// `application`, so this needs no schema rebuild (roadmap.md, "Agent identity").
pub const AGENT_PRINCIPAL_ID: &str = "agent:gaia";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub agent_principal_id: String,
    pub provider_key_id: Option<String>,
    pub model: String,
    pub title: String,
    pub status: String,
    pub step_budget: i64,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

const SESSION_COLS: &str = "id,project_id,agent_principal_id,provider_key_id,model,title,status,step_budget,created_by,created_at,updated_at";

fn row_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        project_id: row.get(1)?,
        agent_principal_id: row.get(2)?,
        provider_key_id: row.get(3)?,
        model: row.get(4)?,
        title: row.get(5)?,
        status: row.get(6)?,
        step_budget: row.get(7)?,
        created_by: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct StoredMessage {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// One tool call the model asked for, before it has run.
#[derive(Clone, Debug, PartialEq)]
pub struct ProposedCall {
    pub tool: String,
    /// The model's own JSON string, kept verbatim so a malformed call is reported
    /// against what the model actually wrote.
    pub args_json: String,
}

/// Create (or find) the agent's application principal. Idempotent by id.
pub fn ensure_agent_principal_in(c: &Connection) -> Result<String> {
    c.execute(
        "INSERT OR IGNORE INTO principals(id,kind,profile_id,label) \
         VALUES(?1,'application',NULL,'GAIA Agent')",
        [AGENT_PRINCIPAL_ID],
    )
    .map_err(|e| e.to_string())?;
    Ok(AGENT_PRINCIPAL_ID.to_string())
}

/// Everything a caller may say about a new session. A struct rather than eight
/// positional arguments: two of them are `Option<&str>` and one is a step count, which
/// is exactly the shape that gets swapped silently.
pub struct NewSession<'a> {
    pub project_id: &'a str,
    pub provider_key_id: Option<&'a str>,
    pub model: &'a str,
    pub title: &'a str,
    pub step_budget: Option<i64>,
    pub system_prompt: &'a str,
    pub created_by: Option<&'a str>,
}

/// A session is only useful when its project has a bound repository, so that is refused
/// here rather than discovered by the first tool call. The path is resolved through the
/// sanctioned `project_repo` door, never passed in.
///
/// `system_prompt` becomes the transcript's first message at creation time, not on the
/// first run: a session whose rules arrived late would have a user turn ahead of them in
/// the sequence, and `seq` is the order the database replays.
pub fn create_session_in(c: &Connection, new: NewSession<'_>) -> Result<Session> {
    let NewSession {
        project_id,
        provider_key_id,
        model,
        title,
        step_budget,
        system_prompt,
        created_by,
    } = new;
    let model = model.trim();
    if model.is_empty() {
        return Err("model is required".into());
    }
    let title = title.trim();
    if title.is_empty() {
        return Err("title is required".into());
    }
    if system_prompt.trim().is_empty() {
        return Err("a session needs a system prompt".into());
    }
    let step_budget = step_budget.unwrap_or(DEFAULT_STEP_BUDGET);
    if step_budget < 1 {
        return Err("step_budget must be at least 1".into());
    }
    if let Some(key_id) = provider_key_id {
        let exists: Option<i64> = c
            .query_row(
                "SELECT 1 FROM agent_provider_keys WHERE id=?1",
                [key_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err("provider key not found".into());
        }
    }
    match crate::project_repo::project_repo_path_on(c, project_id)? {
        None => return Err("the project has no bound repository".into()),
        Some(path) => {
            if crate::project_repo::validate_repo_path(&path).is_err() {
                return Err("the project's repository path is no longer a git repository".into());
            }
        }
    }
    let principal = ensure_agent_principal_in(c)?;
    let id = new_id("session");
    c.execute(
        "INSERT INTO agent_sessions(id,project_id,agent_principal_id,provider_key_id,model,title,status,step_budget,created_by) \
         VALUES(?1,?2,?3,?4,?5,?6,'idle',?7,?8)",
        params![id, project_id, principal, provider_key_id, model, title, step_budget, created_by],
    )
    .map_err(|e| e.to_string())?;
    append_message_in(c, &id, "system", system_prompt)?;
    session_in(c, &id)
}

pub fn session_in(c: &Connection, id: &str) -> Result<Session> {
    c.query_row(
        &format!("SELECT {SESSION_COLS} FROM agent_sessions WHERE id=?1"),
        [id],
        row_session,
    )
    .map_err(|_| "agent session not found".to_string())
}

pub fn list_sessions_in(c: &Connection, project_id: &str) -> Result<Vec<Session>> {
    let mut st = c
        .prepare(&format!(
            "SELECT {SESSION_COLS} FROM agent_sessions WHERE project_id=?1 \
             ORDER BY created_at DESC, id"
        ))
        .map_err(|e| e.to_string())?;
    let rows = st.query_map([project_id], row_session).map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn set_status_in(c: &Connection, id: &str, status: &str) -> Result<()> {
    if !STATUSES.contains(&status) {
        return Err(format!("unknown session status {status:?}"));
    }
    let changed = c
        .execute(
            "UPDATE agent_sessions SET status=?2, updated_at=unixepoch() WHERE id=?1",
            params![id, status],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("agent session not found".into());
    }
    Ok(())
}

/// Append one message. `seq` is per session and dense; `UNIQUE(session_id, seq)` keeps a
/// transcript from ever holding two answers in the same slot.
pub fn append_message_in(
    c: &Connection,
    session_id: &str,
    role: &str,
    content: &str,
) -> Result<StoredMessage> {
    if !matches!(role, "system" | "user" | "assistant" | "tool") {
        return Err(format!("unknown message role {role:?}"));
    }
    let seq: i64 = c
        .query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM agent_messages WHERE session_id=?1",
            [session_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let id = new_id("msg");
    c.execute(
        "INSERT INTO agent_messages(id,session_id,seq,role,content) VALUES(?1,?2,?3,?4,?5)",
        params![id, session_id, seq, role, content],
    )
    .map_err(|e| e.to_string())?;
    let created_at: i64 = c
        .query_row("SELECT created_at FROM agent_messages WHERE id=?1", [&id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    Ok(StoredMessage {
        id,
        session_id: session_id.to_string(),
        seq,
        role: role.to_string(),
        content: content.to_string(),
        created_at,
    })
}

/// Persist an assistant turn and the calls it proposed. Returns the call row ids — they
/// double as the wire `tool_call_id`, so a replayed transcript lines up with its results
/// without a second correlation column.
pub fn append_assistant_in(
    c: &Connection,
    session_id: &str,
    content: &str,
    calls: &[ProposedCall],
) -> Result<(StoredMessage, Vec<String>)> {
    let message = append_message_in(c, session_id, "assistant", content)?;
    let mut ids = Vec::with_capacity(calls.len());
    for call in calls {
        let id = new_id("call");
        c.execute(
            "INSERT INTO agent_tool_calls(id,session_id,message_id,tool,args_json,status) \
             VALUES(?1,?2,?3,?4,?5,'proposed')",
            params![id, session_id, message.id, call.tool, call.args_json],
        )
        .map_err(|e| e.to_string())?;
        ids.push(id);
    }
    Ok((message, ids))
}

/// Record what a call produced. Read-only tools go straight from `proposed` to `ran`;
/// Stage 3's writes pause at `approved` before anything touches the disk.
pub fn record_tool_result_in(
    c: &Connection,
    call_id: &str,
    ok: bool,
    output: &str,
) -> Result<()> {
    let result = json!({ "ok": ok, "output": output }).to_string();
    let status = if ok { "ran" } else { "failed" };
    let changed = c
        .execute(
            "UPDATE agent_tool_calls SET result_json=?2, status=?3 WHERE id=?1",
            params![call_id, result, status],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("tool call not found".into());
    }
    Ok(())
}

/// The wire transcript for a session, oldest first. Tool results are synthesized from
/// the ledger rows of each assistant turn, so nothing has to be re-parsed out of prose.
///
/// A turn whose calls have not all produced a result is a mid-flight turn (the run died,
/// or Stage 3 is waiting for an approval). It is replayed as text only, never as a
/// half-answered tool exchange the provider would reject.
pub fn transcript_in(c: &Connection, session_id: &str) -> Result<Vec<Message>> {
    let mut st = c
        .prepare(
            "SELECT id,role,content FROM agent_messages WHERE session_id=?1 ORDER BY seq",
        )
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([session_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .map_err(|e| e.to_string())?;
    let messages: Vec<(String, String, String)> = rows
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(messages.len());
    for (id, role, content) in messages {
        match role.as_str() {
            "system" => out.push(Message::system(content)),
            "user" => out.push(Message::user(content)),
            "tool" => out.push(Message::tool(String::new(), content)),
            _ => {
                let calls = calls_for_message_in(c, &id)?;
                let text = if content.is_empty() { None } else { Some(content) };
                if calls.is_empty() {
                    out.push(Message::assistant(text, None));
                    continue;
                }
                let mut results = Vec::with_capacity(calls.len());
                let mut complete = true;
                for (call_id, _, _) in &calls {
                    match tool_result_in(c, call_id)? {
                        Some(output) => results.push((call_id.clone(), output)),
                        None => complete = false,
                    }
                }
                if complete {
                    let wire_calls = calls
                        .iter()
                        .map(|(call_id, tool, args)| crate::agent::provider::ToolCall {
                            id: call_id.clone(),
                            kind: "function".into(),
                            function: crate::agent::provider::FunctionCall {
                                name: tool.clone(),
                                arguments: args.clone(),
                            },
                        })
                        .collect();
                    out.push(Message::assistant(text, Some(wire_calls)));
                    for (call_id, output) in results {
                        out.push(Message::tool(call_id, output));
                    }
                } else if let Some(text) = text {
                    out.push(Message::assistant(Some(text), None));
                }
            }
        }
    }
    Ok(out)
}

/// `(call_id, tool, args_json)` in the order they were proposed.
fn calls_for_message_in(
    c: &Connection,
    message_id: &str,
) -> Result<Vec<(String, String, String)>> {
    let mut st = c
        .prepare(
            "SELECT id,tool,args_json FROM agent_tool_calls WHERE message_id=?1 ORDER BY rowid",
        )
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([message_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// `None` while a call is still `proposed` (Stage 3's approval gate). A call that ran
/// carries `{"ok":..,"output":".."}`; a legacy or hand-written row falls back to its raw
/// `result_json` rather than disappearing from the transcript.
fn tool_result_in(c: &Connection, call_id: &str) -> Result<Option<String>> {
    let raw: Option<Option<String>> = c
        .query_row(
            "SELECT result_json FROM agent_tool_calls WHERE id=?1",
            [call_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(Some(raw)) = raw else {
        return Ok(None);
    };
    Ok(Some(match serde_json::from_str::<Value>(&raw) {
        Ok(value) => value
            .get("output")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| raw.clone()),
        Err(_) => raw.clone(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = crate::db::open_in_memory().expect("db");
        crate::db::migrate(&c).expect("migrate");
        crate::db::seed(&c).expect("seed");
        c
    }

    /// A project with a real (empty) repository, so `create_session_in` has something to
    /// validate. Repos live under the cargo target dir, never the OS temp dir.
    fn project_with_repo(c: &Connection, tag: &str) -> String {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("agent-store-tests")
            .join(format!("{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git2::Repository::init(&dir).unwrap();
        let path = dir.canonicalize().unwrap().to_str().unwrap().to_string();
        let project = format!("project-{tag}");
        c.execute(
            "INSERT INTO projects(id,name,key,created_by,created_at,repo_path) \
             VALUES(?1,?2,?3,'default-org',unixepoch(),?4)",
            params![project, tag, tag.to_uppercase(), path],
        )
        .unwrap();
        project
    }

    fn new_session(project_id: &str) -> NewSession<'_> {
        NewSession {
            project_id,
            provider_key_id: None,
            model: "m",
            title: "t",
            step_budget: None,
            system_prompt: "rules",
            created_by: None,
        }
    }

    #[test]
    fn a_session_needs_a_project_with_a_repository() {
        let c = conn();
        let error =
            create_session_in(&c, new_session("demo-project")).unwrap_err();
        assert!(error.contains("no bound repository"), "{error}");
        assert!(create_session_in(&c, new_session("nope")).is_err());
        let project = project_with_repo(&c, "needs-repo");
        assert!(create_session_in(&c, NewSession { model: " ", ..new_session(&project) }).is_err());
        assert!(create_session_in(&c, NewSession { step_budget: Some(0), ..new_session(&project) }).is_err());
        let session = create_session_in(&c, NewSession { model: "gpt-test", title: "Read", step_budget: Some(4), ..new_session(&project) })
            .expect("session");
        assert_eq!(
            (session.status.as_str(), session.step_budget, session.model.as_str()),
            ("idle", 4, "gpt-test")
        );
        assert_eq!(session.agent_principal_id, AGENT_PRINCIPAL_ID);
        assert_eq!(list_sessions_in(&c, &project).unwrap().len(), 1);
    }

    #[test]
    fn statuses_and_roles_are_closed_sets() {
        let c = conn();
        let project = project_with_repo(&c, "closed-sets");
        let session = create_session_in(&c, new_session(&project)).unwrap();
        assert!(set_status_in(&c, &session.id, "paused").is_err());
        set_status_in(&c, &session.id, "running").unwrap();
        assert_eq!(session_in(&c, &session.id).unwrap().status, "running");
        assert!(append_message_in(&c, &session.id, "butler", "x").is_err());
        assert!(set_status_in(&c, "missing", "done").is_err());
    }

    #[test]
    fn the_transcript_round_trips_including_tool_calls_and_results() {
        let c = conn();
        let project = project_with_repo(&c, "transcript");
        let session = create_session_in(&c, new_session(&project)).unwrap();
        append_message_in(&c, &session.id, "user", "read it").unwrap();
        let (_, call_ids) = append_assistant_in(
            &c,
            &session.id,
            "",
            &[ProposedCall {
                tool: "read_file".into(),
                args_json: r#"{"path":"a.txt"}"#.into(),
            }],
        )
        .unwrap();
        assert_eq!(call_ids.len(), 1, "one ledger row per proposed call");
        let mid_flight = transcript_in(&c, &session.id).unwrap();
        assert_eq!(
            mid_flight.len(),
            2,
            "a turn whose call has not run is not replayed as a half-answered exchange"
        );
        record_tool_result_in(&c, &call_ids[0], true, "hello").unwrap();
        append_message_in(&c, &session.id, "assistant", "done").unwrap();

        let wire = transcript_in(&c, &session.id).unwrap();
        assert_eq!(wire.len(), 5, "system, user, assistant, tool, assistant");
        assert_eq!(wire[0].role, "system");
        assert_eq!(wire[0].content.as_deref(), Some("rules"), "the prompt is seq 1");
        assert_eq!(wire[1].content.as_deref(), Some("read it"));
        let calls = wire[2].tool_calls.as_ref().expect("tool calls replayed");
        assert_eq!(calls[0].id, call_ids[0], "the row id is the wire call id");
        assert_eq!(calls[0].function.name, "read_file");
        assert_eq!(calls[0].function.arguments, r#"{"path":"a.txt"}"#);
        assert_eq!(wire[3].role, "tool");
        assert_eq!(wire[3].tool_call_id.as_deref(), Some(call_ids[0].as_str()));
        assert_eq!(wire[3].content.as_deref(), Some("hello"));
        assert_eq!(wire[4].content.as_deref(), Some("done"));
        assert_eq!(wire.iter().filter(|m| m.role == "system").count(), 1);
    }

    #[test]
    fn a_failed_call_keeps_its_output_and_its_status() {
        let c = conn();
        let project = project_with_repo(&c, "failed-call");
        let session = create_session_in(&c, new_session(&project)).unwrap();
        let (_, ids) = append_assistant_in(
            &c,
            &session.id,
            "",
            &[ProposedCall {
                tool: "read_file".into(),
                args_json: "{}".into(),
            }],
        )
        .unwrap();
        record_tool_result_in(&c, &ids[0], false, "path is required").unwrap();
        let status: String = c
            .query_row(
                "SELECT status FROM agent_tool_calls WHERE id=?1",
                [&ids[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "failed");
        let wire = transcript_in(&c, &session.id).unwrap();
        assert_eq!(wire.last().unwrap().content.as_deref(), Some("path is required"));
    }

    #[test]
    fn message_ids_are_minted_not_taken_from_the_caller() {
        let c = conn();
        let project = project_with_repo(&c, "ids");
        let session = create_session_in(&c, new_session(&project)).unwrap();
        let first = append_message_in(&c, &session.id, "user", "a").unwrap();
        let second = append_message_in(&c, &session.id, "user", "b").unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(second.seq, first.seq + 1, "the system prompt already holds seq 1");
        assert!(first.id.starts_with("msg-"));
    }
}
