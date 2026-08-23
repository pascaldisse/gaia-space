//! Independent audit of schedule reservation and the V64 upgrade path.

use std::io::ErrorKind;
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use rusqlite::params;
use serde_json::{json, Value};

fn free_port() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
    let port = listener.local_addr().expect("local addr").port();
    drop(listener);
    port
}

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
    fn call(&self, command: &str, body: Value) -> (u16, Value) {
        let response = self
            .client
            .post(format!("{}/api/cmd/{command}", self.base))
            .header(reqwest::header::COOKIE, "space_session=audit-admin")
            .json(&body)
            .send()
            .expect("command request");
        let status = response.status().as_u16();
        (status, response.json().unwrap_or(Value::Null))
    }
}

fn start_server() -> Server {
    let port = free_port();
    let root = std::env::temp_dir().join(format!(
        "gaia-space-schedule-audit-{}-{port}",
        std::process::id()
    ));
    std::fs::create_dir(&root).expect("reserve audit directory");
    let db_path = root.join("audit.sqlite");
    let conn = gaia_space_lib::db::open_at(&db_path).expect("open audit db");
    gaia_space_lib::db::migrate(&conn).expect("migrate audit db");
    gaia_space_lib::db::seed(&conn).expect("seed audit db");
    conn.execute_batch(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES('audit-profile','audit','Audit',1);
         INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('audit-user','audit','x','Audit','audit-profile','admin',1,1);
         INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES('audit-admin','audit-user',unixepoch(),unixepoch()+3600);
         INSERT INTO projects(id,name,key,description,created_by,archived,created_at) VALUES('audit-project','Audit','AUDIT',NULL,'audit-profile',0,1);",
    )
    .expect("seed audit principal");
    drop(conn);

    let child = Command::new(env!("CARGO_BIN_EXE_space-server"))
        .env("SPACE_DB", &db_path)
        .env("SPACE_PORT", port.to_string())
        .env("SPACE_PIPELINE_WORKDIR", root.join("runs"))
        .env("SPACE_WEBHOOK_TICK_SECS", "0")
        .spawn()
        .expect("spawn space-server");
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match std::net::TcpStream::connect(("127.0.0.1", port)) {
            Ok(_) => break,
            Err(e) if e.kind() == ErrorKind::ConnectionRefused => {
                assert!(Instant::now() < deadline, "space-server never came up");
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => panic!("connect server: {e}"),
        }
    }
    Server {
        child,
        base: format!("http://127.0.0.1:{port}"),
        client: reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("http client"),
    }
}

#[test]
fn caller_controlled_now_can_reserve_one_hourly_fire_twice() {
    let server = start_server();
    let source = json!({"jobs":[{"name":"hourly","trigger_type":"SCHEDULE","timeout_secs":null,
        "steps":[{"type":"Shell","script":"true"}],
        "triggers":[{"type":"Schedule","cron":"0 * * * *"}]}]});
    let (status, value) = server.call(
        "create_pipeline_script",
        json!({"script":{
            "id":"audit-hourly", "project_id":"audit-project", "repository":"repo",
            "path":"audit.json", "source":source.to_string(), "archived":false
        }}),
    );
    assert_eq!(status, 200, "create script: {value}");

    let wall_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs() as i64;
    let fire = (wall_now.div_euclid(3600) + 1) * 3600;
    for now in [fire, fire + 60] {
        let (status, value) = server.call("due_scheduled_runs", json!({"now":now}));
        assert_eq!(status, 200, "schedule tick at {now}: {value}");
    }
    let (status, value) = server.call(
        "list_job_runs_for_script",
        json!({"scriptId":"audit-hourly"}),
    );
    assert_eq!(status, 200, "list runs: {value}");
    assert_eq!(
        value["value"].as_array().map(Vec::len),
        Some(1),
        "one hourly cron fire was reserved under two caller-supplied minutes: {value}"
    );
}

#[test]
fn v64_upgrade_preserves_history_allows_null_repeats_and_serializes_claims() {
    let root = std::env::temp_dir().join(format!(
        "gaia-space-v64-audit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    std::fs::create_dir(&root).expect("reserve migration directory");
    let path = root.join("legacy.sqlite");
    let conn = gaia_space_lib::db::open_at(&path).expect("open legacy db");
    conn.execute_batch(
        "CREATE TABLE job_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, status TEXT NOT NULL, log TEXT, triggered_at INTEGER NOT NULL);
         INSERT INTO job_runs VALUES ('old-1','job','FINISHED',NULL,1700000000);
         INSERT INTO job_runs VALUES ('old-2','job','FAILED',NULL,1700000000);
         PRAGMA user_version=63;",
    )
    .expect("seed pre-V64 history");
    gaia_space_lib::db::migrate(&conn).expect("V64 migrates duplicate legacy history");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM job_runs", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM pragma_index_list('job_runs') WHERE name='job_runs_scheduled_once' AND [unique]=1 AND partial=1", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    for id in ["manual-1", "manual-2"] {
        conn.execute("INSERT INTO job_runs(id,job_id,status,triggered_at,fired_minute) VALUES(?1,'job','SCHEDULED',1,NULL)", [id]).expect("NULL fired minute remains repeatable");
    }
    drop(conn);

    let barrier = Arc::new(Barrier::new(8));
    let inserted: usize = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8).map(|n| {
            let barrier = barrier.clone();
            let path = &path;
            scope.spawn(move || {
                let conn = gaia_space_lib::db::open_at(path).expect("open contender");
                barrier.wait();
                conn.execute("INSERT OR IGNORE INTO job_runs(id,job_id,status,triggered_at,fired_minute) VALUES(?1,'job','SCHEDULED',1,1700000040)", params![format!("claim-{n}")]).expect("atomic reservation")
            })
        }).collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("contender"))
            .sum()
    });
    assert_eq!(inserted, 1, "exactly one concurrent schedule claim wins");
    let conn = gaia_space_lib::db::open_at(&path).expect("reopen audit db");
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM job_runs WHERE fired_minute=1700000040",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}
