//! Independent authorization audit for the pipeline commands.
//!
//! This file re-derives its own harness on purpose instead of sharing one with
//! `pipelines_dispatch_http.rs`. The claim under audit ("a read-tier project member reaches
//! arbitrary shell execution") is asserted by that file, and a check must not share a failure
//! mode with the thing it checks: a bug in a shared fixture would make both agree while both
//! are wrong. Everything here is measured against a freshly spawned server binary over real
//! HTTP, exactly as a browser client speaks to it.
//!
//! Nothing is hard-coded: the port is OS-assigned, the database and the pipeline workdir are
//! per-run temporary paths, and every timeout is env-overridable.

use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Seconds to wait for the spawned server to accept connections.
fn boot_timeout() -> Duration {
    Duration::from_secs(env_secs("GAIA_TEST_SERVER_BOOT_TIMEOUT_SECS", 60))
}

/// Seconds to wait for a triggered pipeline step to leave observable evidence on disk.
fn effect_timeout() -> Duration {
    Duration::from_secs(env_secs("GAIA_TEST_PIPELINE_EFFECT_TIMEOUT_SECS", 20))
}

fn env_secs(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(default)
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
    db_path: PathBuf,
    workdir: PathBuf,
    scratch: PathBuf,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.workdir);
        let _ = std::fs::remove_dir_all(&self.scratch);
        let _ = std::fs::remove_file(&self.db_path);
    }
}

/// The seeded callers. `Admin` is the platform administrator, `Owner` owns `PROJECT_OWNED`,
/// `Member` is a plain member of `PROJECT_SHARED` (read tier), `Outsider` belongs to nothing.
#[derive(Clone, Copy)]
enum As {
    Admin,
    Owner,
    Member,
    Outsider,
}

impl As {
    fn session(self) -> &'static str {
        match self {
            As::Admin => "audit-admin-session",
            As::Owner => "audit-owner-session",
            As::Member => "audit-member-session",
            As::Outsider => "audit-outsider-session",
        }
    }
}

/// Project created by (and therefore owned by) the admin, with `Member` added as a plain
/// member. This is the read tier under audit.
const PROJECT_SHARED: &str = "pa-shared";
/// Project owned by `Owner`. Control group: proves a denial below means "read tier is not
/// enough", not "nobody but an admin may ever author a pipeline".
const PROJECT_OWNED: &str = "pa-owned";

impl Server {
    fn call_as(&self, who: As, command: &str, body: Value) -> (u16, Value) {
        let response = self
            .client
            .post(format!("{}/api/cmd/{command}", self.base))
            .header(
                reqwest::header::COOKIE,
                format!("space_session={}", who.session()),
            )
            .json(&body)
            .send()
            .expect("cmd request");
        let status = response.status().as_u16();
        let value: Value = response.json().unwrap_or(Value::Null);
        (status, value)
    }

    /// A marker path outside every run workdir. If a step creates it, code ran as the server
    /// user with arbitrary filesystem reach — that is the measurement, not an argument.
    fn marker(&self, name: &str) -> PathBuf {
        self.scratch.join(format!("marker-{name}"))
    }

    fn wait_for(&self, path: &Path) -> bool {
        let deadline = Instant::now() + effect_timeout();
        while Instant::now() < deadline {
            if path.exists() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// True when the row is still in the database, read straight from storage rather than
    /// through a command whose own authorization could hide the answer.
    fn script_exists(&self, id: &str) -> bool {
        let conn = gaia_space_lib::db::open_at(&self.db_path).expect("open db for assertion");
        conn.query_row(
            "SELECT COUNT(*) FROM pipeline_scripts WHERE id=?1",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .expect("count scripts")
            > 0
    }

    fn script_project(&self, id: &str) -> Option<String> {
        let conn = gaia_space_lib::db::open_at(&self.db_path).expect("open db for assertion");
        conn.query_row(
            "SELECT project_id FROM pipeline_scripts WHERE id=?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }
}

fn shell_script(command: &str) -> Value {
    json!({"jobs":[{"name":"exec","trigger_type":"MANUAL","timeout_secs":null,
                    "steps":[{"type":"Shell","script": command}]}]})
}

fn script_body(id: &str, project_id: &str, source: Value) -> Value {
    json!({"script":{
        "id": id,
        "project_id": project_id,
        "repository": "repo-audit",
        "path": format!("{id}.json"),
        "source": source.to_string(),
        "archived": false,
    }})
}

fn start_server() -> Server {
    let port = free_port();
    let root = std::env::temp_dir().join(format!(
        "gaia-space-authz-audit-{}-{port}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("create audit root");
    let db_path = root.join("audit.sqlite");
    let workdir = root.join("workdir");
    let scratch = root.join("scratch");
    std::fs::create_dir_all(&scratch).expect("create scratch");

    // Seed schema, users and sessions before boot: `login` is rate-limited and argon2-hashed,
    // and neither is the subject here — the subject is the authorization predicate.
    let conn = gaia_space_lib::db::open_at(&db_path).expect("open test db");
    gaia_space_lib::db::migrate(&conn).expect("migrate test db");
    gaia_space_lib::db::seed(&conn).expect("seed test db");
    let people = [
        ("pa-admin", "u-admin", "auditroot", "admin", As::Admin),
        ("pa-owner", "u-owner", "auditowner", "member", As::Owner),
        ("pa-member", "u-member", "auditmember", "member", As::Member),
        (
            "pa-outsider",
            "u-outsider",
            "auditoutsider",
            "member",
            As::Outsider,
        ),
    ];
    for (profile, user, username, role, who) in people {
        conn.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?2,1)",
            [profile, username],
        )
        .expect("seed profile");
        conn.execute(
            "INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) \
             VALUES(?1,?2,'x',?2,?3,?4,1,1)",
            [user, username, profile, role],
        )
        .expect("seed user");
        conn.execute(
            "INSERT INTO sessions(token,user_id,created_at,expires_at) \
             VALUES(?1,?2,unixepoch(),unixepoch()+3600)",
            [who.session(), user],
        )
        .expect("seed session");
    }
    conn.execute(
        "INSERT INTO projects(id,name,key,description,created_by,archived,created_at) \
         VALUES(?1,'Shared','SHARED',NULL,'pa-admin',0,1)",
        [PROJECT_SHARED],
    )
    .expect("seed shared project");
    conn.execute(
        "INSERT INTO projects(id,name,key,description,created_by,archived,created_at) \
         VALUES(?1,'Owned','OWNED',NULL,'pa-owner',0,1)",
        [PROJECT_OWNED],
    )
    .expect("seed owned project");
    conn.execute(
        "INSERT INTO project_members(project_id,profile_id) VALUES(?1,'pa-member')",
        [PROJECT_SHARED],
    )
    .expect("seed membership");
    drop(conn);

    let child = Command::new(env!("CARGO_BIN_EXE_space-server"))
        .env("SPACE_DB", &db_path)
        .env("SPACE_PORT", port.to_string())
        .env("SPACE_PIPELINE_WORKDIR", &workdir)
        // No resident sweeper: it would race the assertions on job_runs.
        .env("SPACE_WEBHOOK_TICK_SECS", "0")
        .spawn()
        .expect("spawn space-server");
    let server = Server {
        child,
        base: format!("http://127.0.0.1:{port}"),
        client: reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("http client"),
        db_path,
        workdir,
        scratch,
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

/// The headline claim, re-measured from scratch: does read-tier project membership actually
/// buy arbitrary shell execution on the server host?
///
/// The step writes a marker file at an absolute path outside every run workdir. Existence of
/// that file after the call is the only evidence accepted here — a 200 alone would not prove
/// execution, and a 403 alone would not prove the absence of a side effect, so both are
/// recorded and the file is the verdict.
#[test]
fn read_tier_member_must_not_reach_shell_execution_via_trigger() {
    let server = start_server();
    let marker = server.marker("read-tier-trigger");

    // Authored by the admin inside the project the member merely *belongs to*.
    let (status, value) = server.call_as(
        As::Admin,
        "create_pipeline_script",
        script_body(
            "sa-readtier",
            PROJECT_SHARED,
            shell_script(&format!("printf owned > {}", marker.display())),
        ),
    );
    assert_eq!(status, 200, "admin could not author the fixture: {value}");

    let (status, value) = server.call_as(
        As::Member,
        "trigger_pipeline_event",
        json!({"scriptId":"sa-readtier","event":{"type":"Manual"}}),
    );
    let executed = if status == 200 {
        server.wait_for(&marker)
    } else {
        // Even a refused call must not have run anything on the way to the refusal.
        server.wait_for(&marker)
    };

    assert!(
        !executed,
        "a caller holding only project READ access executed an arbitrary shell command as the \
         server user (marker file {} was created; trigger returned {status}: {value}). Firing a \
         pipeline needs a write/execute-tier predicate, not `project_readable`.",
        marker.display()
    );
    assert_eq!(
        status, 403,
        "read-tier member was allowed to fire a pipeline ({status}): {value}. Nothing ran this \
         time, but the gate is open and any step body would run."
    );
}

/// Control group. If the denial above were really "only administrators may ever fire", the
/// product would be broken in the other direction. The project owner must still be able to
/// fire, and the effect must be real.
#[test]
fn project_owner_may_still_fire_and_the_step_really_runs() {
    let server = start_server();
    let marker = server.marker("owner-trigger");

    let (status, value) = server.call_as(
        As::Owner,
        "create_pipeline_script",
        script_body(
            "sa-owner",
            PROJECT_OWNED,
            shell_script(&format!("printf owned > {}", marker.display())),
        ),
    );
    assert_eq!(
        status, 200,
        "the owner of a project may no longer author its pipelines: {value}"
    );

    let (status, value) = server.call_as(
        As::Owner,
        "trigger_pipeline_event",
        json!({"scriptId":"sa-owner","event":{"type":"Manual"}}),
    );
    assert_eq!(
        status, 200,
        "the owner of a project may no longer fire its pipelines: {value}"
    );
    assert!(
        server.wait_for(&marker),
        "the owner's pipeline was accepted but never executed: the audit above would then be \
         vacuous, because nothing runs for anybody"
    );
}

/// Authoring is execution deferred: whoever may write a script body may run it later. Read
/// tier must therefore be refused create, update and delete inside the very project it can
/// read, and the database must be unchanged after each refusal.
#[test]
fn read_tier_member_must_not_create_update_or_delete_scripts() {
    let server = start_server();
    // Every hole is recorded before the test fails, so the RED states the *full* extent of the
    // gap rather than only the first door found open.
    let mut findings: Vec<String> = Vec::new();

    // create
    let (status, value) = server.call_as(
        As::Member,
        "create_pipeline_script",
        script_body("sa-member-create", PROJECT_SHARED, shell_script("echo hi")),
    );
    if status != 403 {
        findings.push(format!(
            "create_pipeline_script: read-tier member authored a pipeline script in a project it \
             can merely read (status {status}): {value}"
        ));
    }
    if server.script_exists("sa-member-create") && status == 403 {
        findings.push(
            "create_pipeline_script: reported as refused but the row exists (refusal happened \
             after the write)"
                .to_owned(),
        );
    }

    // A script the member does not own, authored by the admin.
    let (status, value) = server.call_as(
        As::Admin,
        "create_pipeline_script",
        script_body("sa-admin-owned", PROJECT_SHARED, shell_script("echo hi")),
    );
    assert_eq!(status, 200, "admin could not author the fixture: {value}");

    // update — the most dangerous of the three: it rewrites the shell body that will run.
    let (status, value) = server.call_as(
        As::Member,
        "update_pipeline_script",
        script_body(
            "sa-admin-owned",
            PROJECT_SHARED,
            shell_script("echo pwned-by-member"),
        ),
    );
    if status != 403 {
        findings.push(format!(
            "update_pipeline_script: read-tier member rewrote the shell body of someone else's \
             pipeline (status {status}): {value}"
        ));
    }

    // delete
    let (status, value) = server.call_as(
        As::Member,
        "delete_pipeline_script",
        json!({"id":"sa-admin-owned"}),
    );
    if status != 403 {
        findings.push(format!(
            "delete_pipeline_script: read-tier member deleted someone else's pipeline (status \
             {status}): {value}"
        ));
    }
    if !server.script_exists("sa-admin-owned") {
        findings.push(
            "delete_pipeline_script: the row is gone — a read-tier caller destroyed another \
             caller's pipeline"
                .to_owned(),
        );
    }

    assert!(
        findings.is_empty(),
        "authoring a pipeline is execution deferred, yet `project_readable` (admin|owner|member) \
         still guards `PipelineScriptWrite`:\n  - {}",
        findings.join("\n  - ")
    );
}

/// A caller with no relationship to a project at all must be refused every pipeline command,
/// and must not learn from the status code whether the script exists.
#[test]
fn outsider_is_refused_every_pipeline_command() {
    let server = start_server();
    let (status, value) = server.call_as(
        As::Admin,
        "create_pipeline_script",
        script_body(
            "sa-outsider-target",
            PROJECT_SHARED,
            shell_script("echo hi"),
        ),
    );
    assert_eq!(status, 200, "admin could not author the fixture: {value}");

    for (command, body) in [
        (
            "create_pipeline_script",
            script_body("sa-outsider-new", PROJECT_SHARED, shell_script("echo hi")),
        ),
        (
            "update_pipeline_script",
            script_body(
                "sa-outsider-target",
                PROJECT_SHARED,
                shell_script("echo no"),
            ),
        ),
        ("delete_pipeline_script", json!({"id":"sa-outsider-target"})),
        (
            "trigger_pipeline_event",
            json!({"scriptId":"sa-outsider-target","event":{"type":"Manual"}}),
        ),
    ] {
        let (status, value) = server.call_as(As::Outsider, command, body);
        assert_eq!(
            status, 403,
            "a caller who is neither admin, owner nor member reached `{command}`: {value}"
        );
    }
    assert!(
        server.script_exists("sa-outsider-target"),
        "an outsider's refused calls still mutated storage"
    );
}

/// `project_id` in the payload is attacker-controlled. Two directions must both be closed:
/// dragging a script *out* of a project the caller cannot write, and pushing one *into* a
/// project the caller does not own. Checking only the stored project, or only the payload,
/// leaves exactly one of these open.
#[test]
fn update_must_not_smuggle_a_script_across_projects() {
    let server = start_server();

    // Owned by `Owner`, who may legitimately edit it inside its own project.
    let (status, value) = server.call_as(
        As::Owner,
        "create_pipeline_script",
        script_body("sa-move-out", PROJECT_OWNED, shell_script("echo hi")),
    );
    assert_eq!(status, 200, "owner could not author the fixture: {value}");

    // Direction 1: push it into a project the caller does not own. The stored project passes
    // the predicate, so only a check of the *payload* project can stop this.
    let (status, value) = server.call_as(
        As::Owner,
        "update_pipeline_script",
        script_body("sa-move-out", PROJECT_SHARED, shell_script("echo hi")),
    );
    assert_eq!(
        status, 403,
        "a script was moved into a project its author does not own: {value}"
    );
    assert_eq!(
        server.script_project("sa-move-out").as_deref(),
        Some(PROJECT_OWNED),
        "the move was reported as refused but storage already shows the new project"
    );

    // Direction 2: a script living in a project the caller cannot write, relabelled with a
    // project the caller does own. Only a check of the *stored* project can stop this.
    let (status, value) = server.call_as(
        As::Admin,
        "create_pipeline_script",
        script_body("sa-drag-in", PROJECT_SHARED, shell_script("echo hi")),
    );
    assert_eq!(status, 200, "admin could not author the fixture: {value}");

    let (status, value) = server.call_as(
        As::Owner,
        "update_pipeline_script",
        script_body("sa-drag-in", PROJECT_OWNED, shell_script("echo pwned")),
    );
    assert_eq!(
        status, 403,
        "a forged payload `project_id` bought write access to a foreign project's script: \
         {value}"
    );
    assert_eq!(
        server.script_project("sa-drag-in").as_deref(),
        Some(PROJECT_SHARED),
        "the forged update was reported as refused but storage already moved the script"
    );
}

/// Firing is decided by the script's *stored* project. A caller who owns some other project
/// must not be able to fire a foreign script by naming it.
#[test]
fn trigger_is_decided_by_the_scripts_stored_project() {
    let server = start_server();
    let marker = server.marker("cross-project-trigger");

    let (status, value) = server.call_as(
        As::Admin,
        "create_pipeline_script",
        script_body(
            "sa-foreign",
            PROJECT_SHARED,
            shell_script(&format!("printf owned > {}", marker.display())),
        ),
    );
    assert_eq!(status, 200, "admin could not author the fixture: {value}");

    let (status, value) = server.call_as(
        As::Owner,
        "trigger_pipeline_event",
        json!({"scriptId":"sa-foreign","event":{"type":"Manual"}}),
    );
    assert!(
        !server.wait_for(&marker),
        "the owner of an unrelated project executed a foreign project's pipeline (status \
         {status}): {value}"
    );
    assert_eq!(
        status, 403,
        "owning one project granted the right to fire another project's pipeline: {value}"
    );
}
