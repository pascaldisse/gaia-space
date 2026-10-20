//! The session run loop (roadmap.md, Stage 2).
//!
//! One step is one model call. Between calls the loop runs the tools the model asked
//! for, records every result, and feeds it back. The loop stops at exactly three
//! places, and each one leaves a status on the session row:
//!
//! - **a final answer** — an assistant turn with no tool calls (`done`);
//! - **the step budget** — `agent_sessions.step_budget` model calls spent without one
//!   (`failed`, with the budget named in the error);
//! - **cancellation** — the token flipped from outside, checked before every model
//!   call so a cancelled run never spends another one (`cancelled`).
//!
//! There is no fourth exit. A provider error fails the session rather than looping,
//! and a tool refusal is a *result* the model reads, not a crash: an agent that asks
//! for `../etc/passwd` gets told why and can try again.
//!
//! Nothing here holds state that is not a row. The transcript is rebuilt from the
//! database at the start of a run, so a session resumed after a crash replays exactly
//! what happened — including the tool results, which live in `agent_tool_calls`.

use crate::agent::jail::Jail;
use crate::agent::provider::{ChatRequest, Message, Provider, ToolCall};
use crate::agent::store::{self, ProposedCall};
use crate::agent::tools;
use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

type Result<T> = std::result::Result<T, String>;

/// The rules the model is given once, at the top of every session. Kept short: the tool
/// schemas carry the rest, and a long prompt is a cost paid on every single call.
pub const SYSTEM_PROMPT: &str = "You are GAIA, a coding agent working inside one git repository. \
Every path you pass to a tool is relative to the repository root. Absolute paths, any \
`..` component and the `.git` directory are refused. Use read_file, list_files and grep \
to inspect the code, then answer in plain text. This build is read-only: you cannot \
write, edit or run commands. When you have the answer, reply without calling a tool.";

/// A cancellation flag shared with whoever started the run. Flipping it is safe from
/// any thread; the loop only reads it, and only between model calls.
#[derive(Clone, Debug, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// How one run ended. `error` is set whenever `status` is `failed`; it is the same text
/// the session row's failure is about to be explained by, kept here so a caller does not
/// have to re-read the row.
#[derive(Clone, Debug, PartialEq)]
pub struct RunOutcome {
    pub status: String,
    pub steps: u32,
    pub final_text: Option<String>,
    pub error: Option<String>,
}

/// Run a session to its end. `jail` is the session's repository; `provider` is already
/// built for the key the session names, so this function never sees a secret.
pub fn run_session(
    c: &Connection,
    session_id: &str,
    jail: &Jail,
    provider: &Provider,
    cancel: &CancelToken,
) -> Result<RunOutcome> {
    let session = store::session_in(c, session_id)?;
    if session.status == "running" {
        return Err("this session is already running".into());
    }
    // A pending write is the one thing a run may not step over: the model asked for it,
    // the user has not answered, and the transcript would not replay without it.
    let pending = store::pending_calls_in(c, session_id)?;
    if !pending.is_empty() {
        return Err(format!(
            "this session is waiting for {} tool call(s) to be approved or denied",
            pending.len()
        ));
    }

    let mut messages = store::transcript_in(c, session_id)?;
    if messages.is_empty() {
        store::append_message_in(c, session_id, "system", SYSTEM_PROMPT)?;
        messages.push(Message::system(SYSTEM_PROMPT));
    }
    let schemas = tools::schemas();

    store::set_status_in(c, session_id, "running")?;
    let mut steps: u32 = 0;

    loop {
        if cancel.is_cancelled() {
            store::set_status_in(c, session_id, "cancelled")?;
            return Ok(RunOutcome {
                status: "cancelled".into(),
                steps,
                final_text: None,
                error: None,
            });
        }
        if i64::from(steps) >= session.step_budget {
            let error = format!(
                "step budget of {} model calls was exhausted without a final answer",
                session.step_budget
            );
            store::set_status_in(c, session_id, "failed")?;
            return Ok(RunOutcome {
                status: "failed".into(),
                steps,
                final_text: None,
                error: Some(error),
            });
        }

        let request =
            ChatRequest::new(session.model.clone(), messages.clone()).with_tools(schemas.clone());
        let response = match provider.complete(&request) {
            Ok(response) => response,
            Err(error) => {
                store::set_status_in(c, session_id, "failed")?;
                return Ok(RunOutcome {
                    status: "failed".into(),
                    steps,
                    final_text: None,
                    error: Some(error),
                });
            }
        };
        steps += 1;

        let choice = match response.reply() {
            Ok(choice) => choice,
            Err(error) => {
                store::set_status_in(c, session_id, "failed")?;
                return Ok(RunOutcome {
                    status: "failed".into(),
                    steps,
                    final_text: None,
                    error: Some(error),
                });
            }
        };

        let content = choice.message.content.clone().unwrap_or_default();
        let calls = choice.message.tool_calls.clone().unwrap_or_default();

        // No tool calls: this is the answer the user was waiting for.
        if calls.is_empty() {
            store::append_message_in(c, session_id, "assistant", &content)?;
            store::set_status_in(c, session_id, "done")?;
            let final_text = if content.trim().is_empty() {
                None
            } else {
                Some(content)
            };
            return Ok(RunOutcome {
                status: "done".into(),
                steps,
                final_text,
                error: None,
            });
        }

        // Persist the turn before running anything: a crash mid-tool leaves a proposed
        // call on record rather than an assistant message with no trace of its intent.
        let proposed: Vec<ProposedCall> = calls
            .iter()
            .map(|call| ProposedCall {
                tool: call.function.name.clone(),
                args_json: call.function.arguments.clone(),
            })
            .collect();
        let (_, call_ids) = store::append_assistant_in(c, session_id, &content, &proposed)?;

        // The ledger row id is the wire call id. Using the provider's own id would let a
        // model that repeats `call_1` collide with an earlier turn's row on replay.
        let wire_calls: Vec<ToolCall> = calls
            .iter()
            .zip(call_ids.iter())
            .map(|(call, id)| ToolCall {
                id: id.clone(),
                kind: "function".into(),
                function: call.function.clone(),
            })
            .collect();
        messages.push(Message::assistant(
            if content.is_empty() {
                None
            } else {
                Some(content.clone())
            },
            Some(wire_calls),
        ));

        // A turn that changes the repository is proposed whole: nothing in it runs — not
        // even the reads beside it — until the user has decided on every call. Stopping
        // here is what makes "no write without an approval row" true by construction.
        if calls
            .iter()
            .any(|call| tools::requires_approval(&call.function.name))
        {
            store::set_status_in(c, session_id, "awaiting_approval")?;
            return Ok(RunOutcome {
                status: "awaiting_approval".into(),
                steps,
                final_text: None,
                error: None,
            });
        }

        for (call, id) in calls.iter().zip(call_ids.iter()) {
            let (ok, output) =
                match tools::execute(jail, &call.function.name, &call.function.arguments) {
                    Ok(output) => (true, output),
                    Err(error) => (false, error),
                };
            store::record_tool_result_in(c, id, ok, &output)?;
            messages.push(Message::tool(id.clone(), output));
        }
    }
}

/// Apply a call the user approved. The status check is the gate: anything that is not
/// `approved` is refused, so a write can only ever run on the far side of an approval
/// row. A read that shared a turn with a write is applied through the read door; a write
/// through [`tools::execute_write`]. A tool-level refusal is recorded as a failed call,
/// not returned as an error, because it is the model's next input.
pub fn apply_call_in(c: &Connection, call_id: &str, jail: &Jail) -> Result<()> {
    let call = store::call_in(c, call_id)?;
    if call.status != "approved" {
        return Err(format!(
            "this tool call is {}; only an approved call may run",
            call.status
        ));
    }
    let outcome = if tools::requires_approval(&call.tool) {
        tools::execute_write(jail, &call.tool, &call.args_json)
    } else {
        tools::execute(jail, &call.tool, &call.args_json)
    };
    let (ok, output) = match outcome {
        Ok(output) => (true, output),
        Err(error) => (false, error),
    };
    store::record_tool_result_in(c, call_id, ok, &output)
}

/// Approve or deny a proposed call in one step, applying it when approved. A denial
/// touches nothing on disk; the model reads the denial on its next turn.
pub fn resolve_approval_in(
    c: &Connection,
    call_id: &str,
    approve: bool,
    jail: &Jail,
) -> Result<()> {
    store::decide_call_in(c, call_id, approve)?;
    if approve {
        apply_call_in(c, call_id, jail)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// The transport is a `fn` pointer, so the script and the recording are globals and
    /// these tests hold `SERIAL` for their whole body.
    static SERIAL: Mutex<()> = Mutex::new(());
    static QUEUE: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
    static SENT: Mutex<Vec<Value>> = Mutex::new(Vec::new());

    fn script(replies: Vec<String>) {
        let mut queue = QUEUE.lock().unwrap_or_else(|e| e.into_inner());
        queue.clear();
        queue.extend(replies);
        SENT.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    fn transport(_url: &str, _headers: &[(String, String)], body: &str) -> Result<(i64, String)> {
        let parsed: Value = serde_json::from_str(body).expect("the request body is JSON");
        SENT.lock().unwrap_or_else(|e| e.into_inner()).push(parsed);
        match QUEUE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pop_front()
        {
            Some(reply) => Ok((200, reply)),
            None => Err("the script ran out of replies".into()),
        }
    }

    fn sent() -> Vec<Value> {
        SENT
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn tool_call_reply(tool: &str, arguments: &str) -> String {
        json!({
            "model": "gpt-test",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": tool, "arguments": arguments}
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        })
        .to_string()
    }

    fn text_reply(text: &str) -> String {
        json!({
            "model": "gpt-test",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop"
            }]
        })
        .to_string()
    }

    /// One assistant turn asking for several tools at once — a read and a write, say.
    fn multi_tool_call_reply(calls: &[(&str, &str)]) -> String {
        let calls: Vec<Value> = calls
            .iter()
            .enumerate()
            .map(|(index, (tool, arguments))| {
                json!({
                    "id": format!("call_{index}"),
                    "type": "function",
                    "function": {"name": tool, "arguments": arguments}
                })
            })
            .collect();
        json!({
            "model": "gpt-test",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": null, "tool_calls": calls},
                "finish_reason": "tool_calls"
            }]
        })
        .to_string()
    }

    struct Fixture {
        conn: Connection,
        jail: Jail,
        session: String,
        _base: PathBuf,
    }

    /// A real git repository under the cargo target dir, a project bound to it, and a
    /// session with `budget` steps. Repos never live in the OS temp dir.
    fn fixture(tag: &str, budget: Option<i64>) -> Fixture {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("agent-loop-tests")
            .join(format!("{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git2::Repository::init(&repo).unwrap();
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join("README.md"), "# Demo\n\nhello from the repository\n").unwrap();
        std::fs::write(repo.join("src/lib.rs"), "pub fn answer() -> u32 { 42 }\n").unwrap();
        std::fs::write(repo.join(".git/secret"), "not for the agent\n").unwrap();
        let repo = repo.canonicalize().unwrap();

        let conn = crate::db::open_in_memory().expect("db");
        crate::db::migrate(&conn).expect("migrate");
        crate::db::seed(&conn).expect("seed");
        conn.execute(
            "INSERT INTO projects(id,name,key,created_by,created_at,repo_path) \
             VALUES('proj-agent','Agent','AGT','default-org',unixepoch(),?1)",
            [repo.to_str().unwrap()],
        )
        .unwrap();

        let session = store::create_session_in(
            &conn,
            store::NewSession {
                project_id: "proj-agent",
                provider_key_id: None,
                model: "gpt-test",
                title: "Read the README",
                step_budget: budget,
                system_prompt: SYSTEM_PROMPT,
                created_by: None,
            },
        )
        .expect("session");

        Fixture {
            conn,
            jail: Jail::new(&repo).unwrap(),
            session: session.id,
            _base: base,
        }
    }

    fn transcript_roles(conn: &Connection, session: &str) -> Vec<String> {
        let mut st = conn
            .prepare("SELECT role FROM agent_messages WHERE session_id=?1 ORDER BY seq")
            .unwrap();
        st.query_map([session], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<Vec<String>, _>>()
            .unwrap()
    }

    /// `(call_id, tool, status)` in the order the model proposed them.
    fn calls(conn: &Connection, session: &str) -> Vec<(String, String, String)> {
        let mut st = conn
            .prepare(
                "SELECT id,tool,status FROM agent_tool_calls WHERE session_id=?1 ORDER BY rowid",
            )
            .unwrap();
        st.query_map([session], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap()
    }

    #[test]
    fn a_scripted_session_reads_a_file_and_answers() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("scripted", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "What does the README say?")
            .unwrap();
        script(vec![
            tool_call_reply("read_file", r#"{"path":"README.md"}"#),
            text_reply("The README says hello from the repository."),
        ]);

        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let outcome = run_session(
            &f.conn,
            &f.session,
            &f.jail,
            &provider,
            &CancelToken::new(),
        )
        .expect("run");

        assert_eq!(outcome.status, "done");
        assert_eq!(outcome.steps, 2, "one call for the tool, one for the answer");
        assert_eq!(
            outcome.final_text.as_deref(),
            Some("The README says hello from the repository.")
        );
        assert_eq!(outcome.error, None);

        let sent = sent();
        assert_eq!(sent.len(), 2);
        let tools_sent = sent[0]["tools"].as_array().expect("tools are declared");
        let names: Vec<&str> = tools_sent
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            vec!["read_file", "list_files", "grep", "write_file", "edit_file"]
        );
        assert_eq!(sent[0]["messages"][0]["role"], "system");
        assert_eq!(sent[0]["messages"][1]["content"], "What does the README say?");

        // The model's `call_1` never becomes an id we keep: the ledger row does.
        let assistant = &sent[1]["messages"][2];
        assert_eq!(assistant["role"], "assistant");
        let wire = &assistant["tool_calls"][0];
        assert_eq!(wire["function"]["name"], "read_file");
        assert_ne!(wire["id"], "call_1");
        let call_id = wire["id"].as_str().unwrap();
        assert!(call_id.starts_with("call-"), "{call_id}");
        let result = &sent[1]["messages"][3];
        assert_eq!(result["role"], "tool");
        assert_eq!(result["tool_call_id"], call_id);
        assert!(
            result["content"]
                .as_str()
                .unwrap()
                .contains("hello from the repository"),
            "the file contents reach the model: {result}"
        );

        // And the same exchange is on record, not just in memory.
        assert_eq!(
            transcript_roles(&f.conn, &f.session),
            vec!["system", "user", "assistant", "assistant"]
        );
        let (tool, status, result_json): (String, String, String) = f
            .conn
            .query_row(
                "SELECT tool,status,result_json FROM agent_tool_calls WHERE session_id=?1",
                [&f.session],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((tool.as_str(), status.as_str()), ("read_file", "ran"));
        let result: Value = serde_json::from_str(&result_json).unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(
            store::session_in(&f.conn, &f.session).unwrap().status,
            "done"
        );
    }

    /// The gate's "replayable": what a second run sends is exactly what the first run
    /// persisted — same roles, same contents, same tool-call ids.
    #[test]
    fn a_second_run_sends_exactly_the_persisted_transcript() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("replay", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "Read src/lib.rs").unwrap();
        script(vec![
            tool_call_reply("read_file", r#"{"path":"src/lib.rs"}"#),
            text_reply("It returns 42."),
        ]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let cancel = CancelToken::new();
        run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();

        let persisted = serde_json::to_value(store::transcript_in(&f.conn, &f.session).unwrap())
            .expect("the transcript serializes");
        script(vec![text_reply("Still 42.")]);
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();
        assert_eq!(outcome.status, "done");
        assert_eq!(outcome.steps, 1);

        let sent = sent();
        assert_eq!(
            sent[0]["messages"], persisted,
            "a resumed session replays the stored transcript byte for byte"
        );
        assert_eq!(
            sent[0]["messages"].as_array().unwrap().len(),
            5,
            "system, user, assistant(tool), tool result, final answer"
        );
    }

    #[test]
    fn the_step_budget_stops_a_loop_that_never_answers() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("budget", Some(2));
        store::append_message_in(&f.conn, &f.session, "user", "Keep looking").unwrap();
        script(vec![
            tool_call_reply("list_files", "{}"),
            tool_call_reply("list_files", "{}"),
            tool_call_reply("list_files", "{}"),
        ]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let outcome = run_session(
            &f.conn,
            &f.session,
            &f.jail,
            &provider,
            &CancelToken::new(),
        )
        .unwrap();

        assert_eq!(outcome.status, "failed");
        assert_eq!(outcome.steps, 2, "the budget is a hard ceiling on model calls");
        let error = outcome.error.expect("the failure says why");
        assert!(error.contains("step budget of 2"), "{error}");
        assert_eq!(sent().len(), 2, "no third call is attempted");
        assert_eq!(
            store::session_in(&f.conn, &f.session).unwrap().status,
            "failed"
        );
    }

    #[test]
    fn cancellation_stops_before_the_next_model_call() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("cancel", Some(8));
        store::append_message_in(&f.conn, &f.session, "user", "Work forever").unwrap();

        // The scripted transport flips the token during the first call, so the check at
        // the top of the second iteration is what stops the run.
        static TRIP: Mutex<Option<CancelToken>> = Mutex::new(None);
        fn cancelling_transport(
            url: &str,
            headers: &[(String, String)],
            body: &str,
        ) -> Result<(i64, String)> {
            if let Some(token) = TRIP
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .cloned()
            {
                token.cancel();
            }
            transport(url, headers, body)
        }

        let token = CancelToken::new();
        *TRIP.lock().unwrap_or_else(|e| e.into_inner()) = Some(token.clone());
        script(vec![
            tool_call_reply("list_files", "{}"),
            tool_call_reply("list_files", "{}"),
        ]);
        let provider = Provider::with_transport("sk-test", None::<String>, cancelling_transport);
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &token).unwrap();
        *TRIP.lock().unwrap_or_else(|e| e.into_inner()) = None;

        assert_eq!(outcome.status, "cancelled");
        assert_eq!(outcome.steps, 1);
        assert_eq!(outcome.error, None);
        assert_eq!(sent().len(), 1, "the cancelled run spends no second call");
        assert_eq!(
            store::session_in(&f.conn, &f.session).unwrap().status,
            "cancelled"
        );
        assert_eq!(
            transcript_roles(&f.conn, &f.session),
            vec!["system", "user", "assistant"],
            "the tool call it did get to run is on record"
        );
    }

    #[test]
    fn a_jail_refusal_is_a_result_the_model_reads_not_a_failed_run() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("refusal", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "Read the machine's secrets")
            .unwrap();
        script(vec![
            tool_call_reply("read_file", r#"{"path":"../../etc/passwd"}"#),
            text_reply("I cannot read outside the repository."),
        ]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let outcome = run_session(
            &f.conn,
            &f.session,
            &f.jail,
            &provider,
            &CancelToken::new(),
        )
        .unwrap();

        assert_eq!(outcome.status, "done", "a refusal is not a fatal error");
        let sent = sent();
        let refusal = sent[1]["messages"][3]["content"].as_str().unwrap();
        assert!(refusal.contains("climb out"), "{refusal}");
        let status: String = f
            .conn
            .query_row(
                "SELECT status FROM agent_tool_calls WHERE session_id=?1",
                [&f.session],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "failed", "the ledger records the refusal as a failed call");
    }

    #[test]
    fn a_write_is_proposed_and_waits_for_approval() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("approve", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "Create NOTES.md").unwrap();
        script(vec![tool_call_reply(
            "write_file",
            r#"{"path":"NOTES.md","content":"hello\n"}"#,
        )]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let cancel = CancelToken::new();
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();

        assert_eq!(outcome.status, "awaiting_approval");
        assert_eq!(outcome.steps, 1);
        assert!(
            !f.jail.root().join("NOTES.md").exists(),
            "nothing may be written before the user approves"
        );
        let rows = calls(&f.conn, &f.session);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].2, "proposed");

        // The run cannot step over the pending decision.
        let error = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap_err();
        assert!(error.contains("waiting for 1 tool call"), "{error}");

        resolve_approval_in(&f.conn, &rows[0].0, true, &f.jail).unwrap();
        assert_eq!(
            std::fs::read_to_string(f.jail.root().join("NOTES.md")).unwrap(),
            "hello\n"
        );
        assert_eq!(calls(&f.conn, &f.session)[0].2, "ran");

        script(vec![text_reply("Created NOTES.md.")]);
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();
        assert_eq!(outcome.status, "done");
        let sent = sent();
        assert_eq!(
            sent[0]["messages"].as_array().unwrap().len(),
            4,
            "the request carries system, user, the approved call and its result"
        );
        assert!(
            sent[0]["messages"][3]["content"]
                .as_str()
                .unwrap()
                .contains("wrote 6 bytes to NOTES.md"),
            "the model is told what the write did"
        );
        assert_eq!(
            transcript_roles(&f.conn, &f.session),
            vec!["system", "user", "assistant", "assistant"],
            "the tool result lives in the ledger, not as a stored message row"
        );
    }

    #[test]
    fn a_denied_write_never_touches_the_repository() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("deny", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "Delete nothing, add NOTES.md")
            .unwrap();
        script(vec![tool_call_reply(
            "write_file",
            r#"{"path":"NOTES.md","content":"hello\n"}"#,
        )]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let cancel = CancelToken::new();
        run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();

        let call_id = calls(&f.conn, &f.session)[0].0.clone();
        resolve_approval_in(&f.conn, &call_id, false, &f.jail).unwrap();
        assert!(
            !f.jail.root().join("NOTES.md").exists(),
            "a denied write leaves the repository untouched"
        );
        let row = store::call_in(&f.conn, &call_id).unwrap();
        assert_eq!(row.status, "denied");

        script(vec![text_reply("Understood, nothing was written.")]);
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();
        assert_eq!(outcome.status, "done");
        assert!(
            sent()[0]["messages"][3]["content"]
                .as_str()
                .unwrap()
                .contains("denied"),
            "the model learns the write was denied"
        );
    }

    #[test]
    fn an_approved_write_that_escapes_fails_and_writes_nothing() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("approve-escape", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "Write outside").unwrap();
        script(vec![tool_call_reply(
            "write_file",
            r#"{"path":"../escaped.txt","content":"x"}"#,
        )]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let cancel = CancelToken::new();
        run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();

        let call_id = calls(&f.conn, &f.session)[0].0.clone();
        resolve_approval_in(&f.conn, &call_id, true, &f.jail).unwrap();
        let row = store::call_in(&f.conn, &call_id).unwrap();
        assert_eq!(row.status, "failed");
        assert!(
            !f.jail.root().parent().unwrap().join("escaped.txt").exists(),
            "an approval is not a jail bypass"
        );
        assert_eq!(
            store::pending_calls_in(&f.conn, &f.session).unwrap().len(),
            0,
            "a failed write is resolved, not still pending"
        );
    }

    #[test]
    fn a_turn_with_a_read_and_a_write_waits_together() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("mixed", Some(6));
        store::append_message_in(&f.conn, &f.session, "user", "Read the README, then add a note")
            .unwrap();
        script(vec![multi_tool_call_reply(&[
            ("read_file", r#"{"path":"README.md"}"#),
            ("write_file", r#"{"path":"NOTES.md","content":"x"}"#),
        ])]);
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let cancel = CancelToken::new();
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();

        assert_eq!(outcome.status, "awaiting_approval");
        let rows = calls(&f.conn, &f.session);
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows.iter().map(|(_, _, status)| status.as_str()).collect::<Vec<_>>(),
            vec!["proposed", "proposed"],
            "a turn is proposed whole; the read beside the write does not run early"
        );

        resolve_approval_in(&f.conn, &rows[0].0, true, &f.jail).unwrap();
        resolve_approval_in(&f.conn, &rows[1].0, false, &f.jail).unwrap();
        assert_eq!(calls(&f.conn, &f.session)[0].2, "ran");
        assert!(!f.jail.root().join("NOTES.md").exists());

        script(vec![text_reply("Read it; the write was denied.")]);
        let outcome = run_session(&f.conn, &f.session, &f.jail, &provider, &cancel).unwrap();
        assert_eq!(outcome.status, "done");
        let sent = sent();
        assert!(
            sent[0]["messages"][3]["content"]
                .as_str()
                .unwrap()
                .contains("hello from the repository"),
            "the approved read result is in the replay"
        );
        assert!(sent[0]["messages"][4]["content"]
            .as_str()
            .unwrap()
            .contains("denied"));
    }

    #[test]
    fn a_session_already_running_is_not_run_twice() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let f = fixture("double", Some(3));
        store::set_status_in(&f.conn, &f.session, "running").unwrap();
        script(Vec::new());
        let provider = Provider::with_transport("sk-test", None::<String>, transport);
        let error = run_session(
            &f.conn,
            &f.session,
            &f.jail,
            &provider,
            &CancelToken::new(),
        )
        .unwrap_err();
        assert!(error.contains("already running"), "{error}");
        assert!(sent().is_empty(), "no model call is made");
    }
}
