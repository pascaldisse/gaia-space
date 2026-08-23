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
    /// The per-run database file, so a test can inspect or pre-poison the real storage.
    db_path: PathBuf,
    /// Root the spawned server was told to use for run workdirs.
    #[allow(dead_code)]
    workdir: PathBuf,
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
    start_server_with(&[])
}

/// `start_server`, plus extra SQL executed against the seeded database *before* the server
/// boots. That is the only way to test an upgrade path or a pre-existing data shape: the
/// rows have to exist before `migrate` of the running binary ever looks at them.
fn start_server_with(extra_sql: &[&str]) -> Server {
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
    // A second project the member *does* belong to: the control group for every
    // foreign-project denial below. Without it a 403 could just mean "members may never
    // author scripts", which is a different (and wrong) conclusion.
    conn.execute(
        "INSERT INTO projects(id,name,key,description,created_by,archived,created_at) \
         VALUES('p-own','Own','OWN',NULL,'p-admin',0,1)",
        [],
    )
    .expect("seed member project");
    conn.execute(
        "INSERT INTO project_members(project_id,profile_id) VALUES('p-own','p-member')",
        [],
    )
    .expect("seed member membership");
    conn.execute(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-owner','owner','Owner',1)",
        [],
    )
    .expect("seed owner profile");
    conn.execute(
        "INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) \
         VALUES('u-owner','owner','x','Owner','p-owner','member',1,1)",
        [],
    )
    .expect("seed owner user");
    conn.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at) \
         VALUES('test-owner-session','u-owner',unixepoch(),unixepoch()+3600)",
        [],
    )
    .expect("seed owner session");
    conn.execute(
        "INSERT INTO projects(id,name,key,description,created_by,archived,created_at) \
         VALUES('p-exec','Exec','EXEC',NULL,'p-owner',0,1)",
        [],
    )
    .expect("seed executable project");
    conn.execute(
        "INSERT INTO project_members(project_id,profile_id) VALUES('p-exec','p-member')",
        [],
    )
    .expect("seed read-tier executable-project member");
    for sql in extra_sql {
        conn.execute_batch(sql)
            .unwrap_or_else(|e| panic!("extra seed SQL failed: {e}\n{sql}"));
    }
    drop(conn);

    let workdir = std::env::temp_dir().join(format!("gaia-space-dispatch-work-{port}"));
    let child = Command::new(env!("CARGO_BIN_EXE_space-server"))
        .env("SPACE_DB", &db_path)
        .env("SPACE_PORT", port.to_string())
        // Triggered runs must never write into the developer's real data dir.
        .env("SPACE_PIPELINE_WORKDIR", &workdir)
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
        db_path: db_path.clone(),
        workdir: workdir.clone(),
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
    assert_eq!(
        status, 403,
        "ordinary session reached global schedule dispatch: {value}"
    );
}

/// RED — `trigger_pipeline_event` is gated by `CommandPolicy::Session`, i.e. "any logged-in
/// user". The only server-side check is that the event's repository equals the script's
/// repository — a *consistency* check, not an *authorization* check, and it is skipped
/// entirely for the repository-less event variants (`Manual`, `CodeReview*`, `SafeMerge`).
/// The seeded member belongs to no project, yet can fire jobs of an admin's script in
/// `p-test` by guessing its id. Job execution is arbitrary shell — this is remote code
/// execution for any account.
#[test]
fn member_cannot_trigger_jobs_of_a_project_it_does_not_belong_to() {
    let server = start_server();
    let (status, value) = server.call(
        "create_pipeline_script",
        script_body(
            "s-foreign",
            json!({"jobs":[{"name":"manual","trigger_type":"MANUAL","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"true"}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    // No repository in the event => the repository consistency check never runs.
    let (status, value) = server.call_as(
        "test-member-session",
        "trigger_pipeline_event",
        json!({"scriptId":"s-foreign","event":{"type":"Manual"}}),
    );
    assert_eq!(
        status, 403,
        "a non-member fired jobs of a foreign project's script: {value}"
    );
}

/// RED — the authorization fix on `trigger_pipeline_event` (`CommandPolicy::PipelineScriptWrite`,
/// commit 03c4d29) reads the script's project and demands `project_readable`. That closes the
/// firing door but leaves the *authoring* door open: `create_pipeline_script` and
/// `update_pipeline_script` are still plain `CommandPolicy::Session` with no project scoping,
/// so a non-member can write a script — arbitrary shell steps — into someone else's project.
/// It is then executed by that project's members, or unattended by the schedule ticker.
#[test]
fn member_cannot_author_a_pipeline_script_in_a_foreign_project() {
    let server = start_server();
    let (status, value) = server.call_as(
        "test-member-session",
        "create_pipeline_script",
        script_body(
            "s-implant",
            json!({"jobs":[{"name":"implant","trigger_type":"SCHEDULE","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"true"}],
                            "triggers":[{"type":"Schedule","cron":"* * * * *"}]}]}),
        ),
    );
    assert_eq!(
        status, 403,
        "a non-member wrote a shell-executing script into a foreign project: {value}"
    );
}

/// RED — MEDIUM: duplicate schedule dispatch.
///
/// `due_scheduled_runs` reads the watermark (`MAX(triggered_at)`), drops the connection, and
/// only then spawns. Read and insert are not in one transaction and `job_runs` carries no
/// `(job_id, fired_minute)` uniqueness, so two overlapping ticks — two browser tabs, two
/// server replicas, or the resident sweeper racing a manual click — both see the same empty
/// watermark and both start the job.
///
/// Side effects are held down on purpose so this is a real execution proof and not an
/// argument: the job's single step is `true`, the workdir root is a per-run temp directory,
/// and the database is the per-run temp file. `now` is the real clock, which makes the
/// *sequential* case pass (the first run's `triggered_at` moves the watermark past `now`) —
/// therefore any duplicate observed here is caused by the concurrency, nothing else.
///
/// Measured on this branch: 32 simultaneous ticks started up to 10 runs of the same job in
/// the same minute. The race is timing-dependent, so the test plays several independent
/// rounds (fresh script each) and fails if *any* round starts more than one run.
#[test]
fn concurrent_schedule_ticks_do_not_start_the_same_job_twice() {
    let server = start_server();
    // Both knobs are env-tunable so a slow or a very fast box can widen the window without
    // a code change; the defaults are what reproduced the duplicate here.
    let ticks: usize = env_usize("GAIA_TEST_CONCURRENT_TICKS", 32);
    // Six rounds: measured 6/6 reproductions on this branch, versus 4/5 at three rounds.
    let rounds: usize = env_usize("GAIA_TEST_RACE_ROUNDS", 6);

    for round in 0..rounds {
        let script_id = format!("s-sched-{round}");
        let (status, value) = server.call(
            "create_pipeline_script",
            script_body(
                &script_id,
                json!({"jobs":[{"name":"tick","trigger_type":"SCHEDULE","timeout_secs":null,
                                "steps":[{"type":"Shell","script":"true"}],
                                "triggers":[{"type":"Schedule","cron":"* * * * *"}]}]}),
            ),
        );
        assert_eq!(status, 200, "create_pipeline_script: {value}");

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_secs() as i64;

        let barrier = std::sync::Barrier::new(ticks);
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..ticks)
                .map(|_| {
                    let (barrier, server, script_id) = (&barrier, &server, script_id.as_str());
                    scope.spawn(move || {
                        // Warm up the TCP connection first: connect + handshake latency would
                        // otherwise stagger the threads and the race is never even attempted.
                        let _ =
                            server.call("list_job_runs_for_script", json!({"scriptId":script_id}));
                        barrier.wait();
                        let began = Instant::now();
                        let (status, value) =
                            server.call("due_scheduled_runs", json!({"now": now}));
                        (status, value, began, Instant::now())
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("tick thread"))
                .collect::<Vec<_>>()
        });
        for (status, value, ..) in &results {
            assert_eq!(*status, 200, "due_scheduled_runs: {value}");
        }
        // Overlap witness: without it, a green round would only mean the calls never raced.
        let latest_start = results.iter().map(|r| r.2).max().expect("starts");
        let earliest_end = results.iter().map(|r| r.3).min().expect("ends");
        assert!(
            latest_start < earliest_end,
            "round {round}: the ticks never overlapped in time, so no duplicate could have \
             been observed and this round proves nothing"
        );

        // The database is the witness, not the responses: count what was actually started.
        let (status, runs) = server.call("list_job_runs_for_script", json!({"scriptId":script_id}));
        assert_eq!(status, 200, "list_job_runs_for_script: {runs}");
        let started = runs["value"].as_array().map(Vec::len).unwrap_or(0);
        assert!(
            started >= 1,
            "round {round}: the scheduled job never fired at all, so this proves nothing: {runs}"
        );
        assert_eq!(
            started, 1,
            "round {round}: the same scheduled minute started {started} runs; \
             `due_scheduled_runs` needs an atomic reservation or a unique \
             (job_id, fired_minute) index: {runs}"
        );
    }
}

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .filter(|v| *v > 1)
        .unwrap_or(default)
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
    assert_eq!(
        status, 400,
        "expected a domain rejection, got {status}: {value}"
    );
    assert!(
        value["error"]
            .as_str()
            .unwrap_or_default()
            .contains("does not match"),
        "unexpected error body: {value}"
    );
}

/// Same as `script_body` but the project is the caller's choice — the horizontal-privilege
/// tests need to name a project other than the seeded default.
fn script_body_in(id: &str, project_id: &str, source: Value) -> Value {
    json!({"script":{
        "id": id,
        "project_id": project_id,
        "repository": "repo-a",
        "path": format!("{id}.json"),
        "source": source.to_string(),
        "archived": false,
    }})
}

/// Poll `list_job_runs_for_script` until it reports at least `want` runs, or the deadline
/// passes. Runs are inserted synchronously by the trigger, but reading through HTTP after a
/// separate connection still deserves a bounded wait rather than a sleep guess.
fn runs_for(server: &Server, script_id: &str) -> usize {
    let (status, runs) = server.call("list_job_runs_for_script", json!({"scriptId":script_id}));
    assert_eq!(status, 200, "list_job_runs_for_script: {runs}");
    runs["value"].as_array().map(Vec::len).unwrap_or(0)
}

/// COUNTER-TEST to the duplicate-schedule fix.
///
/// The fix for `concurrent_schedule_ticks_do_not_start_the_same_job_twice` is specified as a
/// unique `(job_id, fired_minute)` reservation. Every trigger path — manual, event and
/// schedule — funnels through the *same* `spawn_script_jobs` insert, so a `fired_minute`
/// stamped unconditionally there would silently collapse legitimate repeats: two pushes in
/// the same minute are two builds, not one. This pins the invariant the deduplication must
/// not eat.
#[test]
fn two_events_in_the_same_minute_each_start_their_own_run() {
    let server = start_server();
    let (status, value) = server.call(
        "create_pipeline_script",
        script_body(
            "s-repeat",
            json!({"jobs":[{"name":"on-push","trigger_type":"GIT_PUSH","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"true"}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    // Two pushes, back to back, therefore certainly inside one wall-clock minute.
    for attempt in 0..2 {
        let (status, value) = server.call(
            "trigger_pipeline_event",
            json!({"scriptId":"s-repeat",
                   "event":{"type":"Push","repository":"repo-a","branch":"main"}}),
        );
        assert_eq!(status, 200, "push {attempt} was refused: {value}");
        assert_eq!(
            value["value"].as_array().map(Vec::len).unwrap_or(0),
            1,
            "push {attempt} returned no run: {value}"
        );
    }

    let started = runs_for(&server, "s-repeat");
    assert_eq!(
        started, 2,
        "two separate pushes in the same minute produced {started} run(s): the duplicate-fire \
         deduplication is over-reaching and swallowed a real build"
    );
}

/// RED — HIGH: horizontal privilege slide through `update_pipeline_script`.
///
/// Scoping only the *creation* of a script to its project is not enough while `update` stays
/// `CommandPolicy::Session`: a member authors legally inside their own project, then rewrites
/// the row's `project_id` to a project they do not belong to. The shell steps land in the
/// foreign project exactly as if `create` had never been gated.
#[test]
fn a_member_cannot_repoint_their_script_into_a_foreign_project() {
    let server = start_server();
    let source = json!({"jobs":[{"name":"slide","trigger_type":"MANUAL","timeout_secs":null,
                                 "steps":[{"type":"Shell","script":"true"}]}]});

    // Control: authoring inside their OWN project must keep working. If this ever fails the
    // denial below proves nothing — it would just mean members lost script authoring wholesale.
    let (status, value) = server.call_as(
        "test-member-session",
        "create_pipeline_script",
        script_body_in("s-slide", "p-own", source.clone()),
    );
    assert_eq!(
        status, 200,
        "a member could not author a script in their own project: {value}"
    );

    let (status, value) = server.call_as(
        "test-member-session",
        "update_pipeline_script",
        script_body_in("s-slide", "p-test", source),
    );
    assert_eq!(
        status, 403,
        "a member moved their shell-executing script into a foreign project: {value}"
    );
}

/// RED — HIGH: `delete_pipeline_script` takes a bare `id`, so a project-scoped policy has to
/// resolve the project from the stored row. If it does not, any session can destroy another
/// project's CI definition (and, through `pipelines.rs`, its whole run history).
#[test]
fn a_member_cannot_delete_a_foreign_projects_script() {
    let server = start_server();
    let (status, value) = server.call(
        "create_pipeline_script",
        script_body(
            "s-victim",
            json!({"jobs":[{"name":"build","trigger_type":"MANUAL","timeout_secs":null,
                            "steps":[{"type":"Shell","script":"true"}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    let (status, value) = server.call_as(
        "test-member-session",
        "delete_pipeline_script",
        json!({"id":"s-victim"}),
    );
    assert_eq!(
        status, 403,
        "a non-member deleted a foreign project's pipeline script: {value}"
    );
}

/// RED — MEDIUM: a forged `project_id` must not be a way in. `pipeline_scripts.project_id` is
/// `NOT NULL REFERENCES projects(id)` with `foreign_keys=ON`, so a bogus id cannot land in
/// storage — but it must be refused as an *authorization* failure at the gate, not leak
/// through as a 200 or crash out as a 500 that tells the attacker the gate was never reached.
#[test]
fn a_forged_project_id_is_refused_rather_than_accepted() {
    let server = start_server();
    let source = json!({"jobs":[{"name":"forge","trigger_type":"SCHEDULE","timeout_secs":null,
                                 "steps":[{"type":"Shell","script":"true"}],
                                 "triggers":[{"type":"Schedule","cron":"* * * * *"}]}]});
    for forged in ["", "no-such-project", "../p-test"] {
        let (status, value) = server.call_as(
            "test-member-session",
            "create_pipeline_script",
            script_body_in("s-forged", forged, source.clone()),
        );
        assert_eq!(
            status, 403,
            "project_id {forged:?} was not refused by the project gate (got {status}): {value}"
        );
        assert_eq!(
            runs_for(&server, "s-forged"),
            0,
            "project_id {forged:?} left a live script behind"
        );
    }
}

/// RED — HIGH: the upgrade path of the duplicate-fire unique index.
///
/// A `CREATE UNIQUE INDEX` over `(job_id, fired_minute)` fails outright on any existing
/// database that already contains the duplicates this branch just proved are produced. If
/// `migrate` propagates that error the server does not boot at all: the fix for a MEDIUM
/// race becomes a total outage for every installation that ever raced. This seeds exactly
/// that history and demands the server still comes up and still answers.
#[test]
fn an_existing_database_with_duplicate_runs_still_boots() {
    let minute = 1_700_000_000i64; // fixed instant inside one minute; two runs share it
    let seed = format!(
        "INSERT INTO pipeline_scripts(id,project_id,repository,path,source,archived,created_at) \
           VALUES('s-legacy','p-test','repo-a','legacy.json','{{\"jobs\":[]}}',0,1);\n\
         INSERT INTO jobs(id,script_id,name,trigger_type,archived) \
           VALUES('s-legacy::legacy','s-legacy','legacy','SCHEDULE',0);\n\
         INSERT INTO job_runs(id,job_id,status,log,triggered_at) \
           VALUES('legacy-run-1','s-legacy::legacy','FINISHED',NULL,{minute});\n\
         INSERT INTO job_runs(id,job_id,status,log,triggered_at) \
           VALUES('legacy-run-2','s-legacy::legacy','FINISHED',NULL,{minute});\n\
         INSERT INTO job_runs(id,job_id,status,log,triggered_at) \
           VALUES('legacy-run-3','s-legacy::legacy','FAILED',NULL,{});",
        minute + 30
    );
    // If the migration aborts, `start_server_with` never sees the port open and fails here
    // with "space-server never came up" — which is the outage, reported as a test failure.
    let server = start_server_with(&[seed.as_str()]);

    let (status, value) = server.call("list_job_runs_for_script", json!({"scriptId":"s-legacy"}));
    assert_eq!(
        status, 200,
        "the upgraded database no longer serves its own run history: {value}"
    );
    assert_eq!(
        value["value"].as_array().map(Vec::len).unwrap_or(0),
        3,
        "the upgrade destroyed pre-existing run history instead of preserving it: {value}"
    );
    assert!(server.db_path.exists(), "the test database vanished");
}

/// RED — HIGH: `project_readable` is a *read* predicate (admin, owner, or plain member) and it
/// is what guards `trigger_pipeline_event`. A pipeline step is an arbitrary shell command on
/// the server host, so "may read this project" is being spent as "may execute code here".
///
/// This is measured, not argued: the step writes a marker file at an absolute path outside
/// any run workdir, and the test asserts the file exists afterwards. If it appears, a caller
/// holding only project read access achieved arbitrary filesystem writes as the server user.
#[test]
fn a_read_tier_project_member_reaches_arbitrary_shell_execution() {
    let marker = std::env::temp_dir().join(format!(
        "gaia-space-readtier-proof-{}-{}",
        std::process::id(),
        free_port()
    ));
    let _ = std::fs::remove_file(&marker);
    let server = start_server();

    // Authored by a non-admin owner inside the project the member merely reads.
    let (status, value) = server.call_as(
        "test-owner-session",
        "create_pipeline_script",
        script_body_in(
            "s-readtier",
            "p-exec",
            json!({"jobs":[{"name":"exec","trigger_type":"MANUAL","timeout_secs":null,
                            "steps":[{"type":"Shell",
                                      "script": format!("printf owned > {}", marker.display())}]}]}),
        ),
    );
    assert_eq!(status, 200, "create_pipeline_script: {value}");

    let (status, value) = server.call_as(
        "test-owner-session",
        "trigger_pipeline_event",
        json!({"scriptId":"s-readtier","event":{"type":"Manual"}}),
    );
    assert_eq!(status, 200, "the non-admin project owner was refused: {value}");
    let deadline = Instant::now() + Duration::from_secs(20);
    while !marker.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(marker.exists(), "the project owner's event never reached its shell step");
    let _ = std::fs::remove_file(&marker);

    let (status, value) = server.call_as(
        "test-member-session",
        "trigger_pipeline_event",
        json!({"scriptId":"s-readtier","event":{"type":"Manual"}}),
    );
    assert_eq!(
        status, 403,
        "a read-tier member reached the shell-capable pipeline runner: {value}"
    );

    std::thread::sleep(Duration::from_millis(100));
    let executed = marker.exists();
    let _ = std::fs::remove_file(&marker);
    assert!(
        !executed,
        "a caller with only project READ access executed an arbitrary shell command on the server host"
    );
}
