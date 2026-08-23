//! HTTP-layer contract for the event-driven pipeline commands.
//!
//! Why a spawned binary and not an in-process handler test: `cmd`, `arg`, `to_camel` and
//! `command_policy` all live inside the `space-server` *binary* crate, so no library test can
//! reach them. The only honest way to exercise the real web path from outside that binary is
//! to run it and speak HTTP to it — which is exactly what a browser client does.
//!
//! Nothing here is hard-coded: the port is an OS-assigned free port and the database is a
//! per-run temporary file handed to the server through `SPACE_DB`.

use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Seconds to wait for the spawned server to accept connections. Env-overridable so a slow
/// CI box can raise it without a code change.
fn boot_timeout() -> Duration {
    Duration::from_secs(
        std::env::var("GAIA_TEST_SERVER_BOOT_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .filter(|v| *v > 0)
            .unwrap_or(60),
    )
}

fn free_port() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
    let port = listener.local_addr().expect("local addr").port();
    drop(listener);
    port
}

/// Owns the child process so a panicking test still kills the server.
struct Server {
    child: Child,
    base: String,
    client: reqwest::blocking::Client,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Server {
    /// Session cookie of the seeded admin, i.e. the most privileged caller there is: if a
    /// command is refused for this caller it is refused for everyone.
    fn call(&self, command: &str, body: Value) -> (u16, Value) {
        self.call_as("test-admin-session", command, body)
    }

    fn call_as(&self, session: &str, command: &str, body: Value) -> (u16, Value) {
        let response = self
            .client
            .post(format!("{}/api/cmd/{command}", self.base))
            .header(reqwest::header::COOKIE, format!("space_session={session}"))
            .json(&body)
            .send()
            .expect("cmd request");
        let status = response.status().as_u16();
        let value: Value = response.json().unwrap_or(Value::Null);
        (status, value)
    }
}

fn start_server() -> Server {
    let port = free_port();
    let db_path: PathBuf = std::env::temp_dir().join(format!(
        "gaia-space-dispatch-http-{}-{port}.sqlite",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&db_path);

    // Seed schema + an admin session before boot: `login` is rate-limited and argon2-hashed,
    // and neither is under test here — the subject is the dispatch layer behind the session.
    let conn = gaia_space_lib::db::open_at(&db_path).expect("open test db");
    gaia_space_lib::db::migrate(&conn).expect("migrate test db");
    gaia_space_lib::db::seed(&conn).expect("seed test db");
    conn.execute(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-admin','root','Root',1)",
        [],
    )
    .expect("seed profile");
    conn.execute(
        "INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) \
         VALUES('u-admin','root','x','Root','p-admin','admin',1,1)",
        [],
    )
    .expect("seed user");
    conn.execute(
        "INSERT INTO projects(id,name,key,description,created_by,archived,created_at) \
         VALUES('p-test','Test','TEST',NULL,'p-admin',0,1)",
        [],
    )
    .expect("seed project");
    conn.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at) \
         VALUES('test-admin-session','u-admin',unixepoch(),unixepoch()+3600)",
        [],
    )
    .expect("seed admin session");
    conn.execute(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-member','member','Member',1)",
        [],
    )
    .expect("seed member profile");
    conn.execute(
        "INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) \
         VALUES('u-member','member','x','Member','p-member','member',1,1)",
        [],
    )
    .expect("seed member user");
    conn.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at) \
         VALUES('test-member-session','u-member',unixepoch(),unixepoch()+3600)",
        [],
    )
    .expect("seed member session");
    drop(conn);

    let child = Command::new(env!("CARGO_BIN_EXE_space-server"))
        .env("SPACE_DB", &db_path)
        .env("SPACE_PORT", port.to_string())
        // No resident sweeper during the test: it would race the assertions on job_runs.
        .env("SPACE_WEBHOOK_TICK_SECS", "0")
        .spawn()
        .expect("spawn space-server");

    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("http client");
    let server = Server {
        child,
        base,
        client,
    };

    let deadline = Instant::now() + boot_timeout();
    loop {
        match std::net::TcpStream::connect(("127.0.0.1", port)) {
            Ok(_) => break,
            Err(e) if e.kind() == ErrorKind::ConnectionRefused => {
                assert!(Instant::now() < deadline, "space-server never came up");
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => panic!("connecting to test server: {e}"),
        }
    }
    server
}

fn script_body(id: &str, source: Value) -> Value {
    json!({"script":{
        "id": id,
        "project_id": "p-test",
        "repository": "repo-a",
        "path": format!("{id}.json"),
        "source": source.to_string(),
        "archived": false,
    }})
}

/// Execution proof (not a type argument) that the server's `arg()` accepts the camelCase key
/// the TypeScript client actually sends: `scriptId` reaches a `script_id: String` parameter.
/// Uses a command that is already reachable from the web, so a failure here means the
/// camelCase fallback is broken — nothing else.
#[test]
fn camel_case_arguments_reach_snake_case_parameters() {
    let server = start_server();
    let (status, value) = server.call(
        "create_pipeline_script",
        script_body(
            "s-camel",
            json!({"jobs":[{"name":"build","trigger_type":"MANUAL","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"echo hi"}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    // camelCase — the spelling `src/api/pipelines.ts` emits.
    let (status, camel) = server.call("list_job_runs_for_script", json!({"scriptId":"s-camel"}));
    assert_eq!(status, 200, "camelCase scriptId rejected: {camel}");
    // snake_case — the spelling a direct HTTP client may use. Both must be accepted.
    let (status, snake) = server.call("list_job_runs_for_script", json!({"script_id":"s-camel"}));
    assert_eq!(status, 200, "snake_case script_id rejected: {snake}");
    assert_eq!(camel["value"], snake["value"]);
    assert_eq!(camel["value"], json!([]));

    // A missing argument must be a 400, not a silent empty answer.
    let (status, missing) = server.call("list_job_runs_for_script", json!({}));
    assert_eq!(status, 400, "missing argument accepted: {missing}");
}

/// RED — pins the defect found while attacking commit 5db0d12 (my own wiring).
///
/// `trigger_pipeline_event` and `due_scheduled_runs` were added to the `dispatch!` table in
/// `space-server.rs` but NOT to `command_policy`, whose fallthrough arm is `_ => return None`.
/// `cmd` therefore answers 403 "command denied" before dispatch is ever consulted: the web
/// build cannot reach either command at all, for any caller, including an admin.
/// The fix belongs in `command_policy` (Kali's file) — this test stays until it lands.
#[test]
fn web_dispatch_reaches_the_event_driven_pipeline_commands() {
    let server = start_server();
    let (status, value) = server.call(
        "create_pipeline_script",
        script_body(
            "s-event",
            json!({"jobs":[{"name":"on-push","trigger_type":"GIT_PUSH","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"true"}],
                            "triggers":[{"type":"GitPush","repository":"repo-a","branches":["main"]}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    let (status, value) = server.call(
        "trigger_pipeline_event",
        json!({"scriptId":"s-event","event":{"type":"Push","repository":"repo-a","branch":"main"}}),
    );
    assert_ne!(
        status, 403,
        "trigger_pipeline_event is missing from command_policy: {value}"
    );
    assert_eq!(status, 200, "trigger_pipeline_event: {value}");

    let (status, value) = server.call("due_scheduled_runs", json!({"now": 1_700_000_000i64}));
    assert_ne!(
        status, 403,
        "due_scheduled_runs is missing from command_policy: {value}"
    );
    assert_eq!(status, 200, "due_scheduled_runs: {value}");
    assert_eq!(value["value"], json!([]));
}

/// RED — schedule dispatch scans every unarchived pipeline script and has no project argument.
/// A plain session must not turn this server-wide lifecycle command into an unscoped job runner.
/// The seeded database contains no scripts, so this proves the authorization boundary without
/// spawning an actual job process.
#[test]
fn ordinary_session_cannot_start_global_schedule_dispatch() {
    let server = start_server();
    let (status, value) = server.call_as(
        "test-member-session",
        "due_scheduled_runs",
        json!({"now": 1_700_000_000i64}),
    );
    assert_eq!(status, 403, "ordinary session reached global schedule dispatch: {value}");
}

/// RED companion: an event whose repository does not match the script must be refused by the
/// server-side check in `trigger_pipeline_event`, i.e. a 400 with the domain message — not a
/// 403 from the policy gate, which would hide the check entirely.
#[test]
fn mismatched_event_repository_is_a_domain_error_not_a_policy_denial() {
    let server = start_server();
    let (status, value) = server.call(
        "create_pipeline_script",
        script_body(
            "s-mismatch",
            json!({"jobs":[{"name":"on-push","trigger_type":"GIT_PUSH","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"true"}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    let (status, value) = server.call(
        "trigger_pipeline_event",
        json!({"scriptId":"s-mismatch",
               "event":{"type":"Push","repository":"other-repo","branch":"main"}}),
    );
    assert_eq!(status, 400, "expected a domain rejection, got {status}: {value}");
    assert!(
        value["error"]
            .as_str()
            .unwrap_or_default()
            .contains("does not match"),
        "unexpected error body: {value}"
    );
}
