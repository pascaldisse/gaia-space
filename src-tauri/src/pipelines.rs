#![allow(dead_code)]
//! Automation (CI/CD), deployment and package-registry persistence.
//!
//! Config-as-code, JetBrains-Space-style: a `pipeline_scripts` row's `source` column is the
//! single source of truth for that script's jobs+steps (mirrors `.space.kts`), stored here as
//! JSON (`ScriptDef`) rather than a Kotlin DSL — no DSL parser in scope, same information
//! shape. The `jobs` table (fixed schema, no steps/timeout column) is kept as a queryable
//! materialization of job names for FK joins from `job_runs`; it is resynced from the parsed
//! script on every create/update. Job ids are deterministic (`{script_id}::{name}`) so history
//! survives script edits that don't rename jobs.
//!
//! Real Space product limits (docs/space-knowledge-base/03-packages-cicd.md §1.2), enforced
//! as validation constants below: jobs within one script always run in parallel (no dependency
//! graph — never build one), max 100 jobs/script, max 50 steps/job, max (and default) job
//! timeout 2h. Deploy-target health checks are explicitly "(Not yet available)" even in the
//! real product per the KB — not built here either.
//!
//! Execution model: `trigger_pipeline_script` inserts one `SCHEDULED` `job_runs` row per job
//! and returns immediately (a 2h job cannot hold a Tauri IPC call open); each job then runs on
//! its own OS thread against a shared `Arc<Mutex<Connection>>`, steps sequential, real
//! `sh -c` child processes, stdout+stderr captured and appended to the run's `log` column as
//! they complete so the UI can poll for live progress.
use crate::db;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
type Result<T> = std::result::Result<T, String>;

// ---------- Space's real Automation limits (KB §1.2) ----------
pub const MAX_JOBS_PER_SCRIPT: usize = 100;
pub const MAX_STEPS_PER_JOB: usize = 50;
pub const MAX_JOB_TIMEOUT_SECS: u64 = 7200; // 2h — also the max, per docs
pub const DEFAULT_JOB_TIMEOUT_SECS: u64 = 7200;

const PACKAGE_FORMATS: [&str; 8] = [
    "maven",
    "npm",
    "nuget",
    "pypi",
    "dart",
    "container",
    "composer",
    "file",
];
const REPO_MODES: [&str; 2] = ["HOSTING", "PROXY"];

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineScript {
    pub id: String,
    pub project_id: String,
    pub repository: Option<String>,
    pub path: String,
    pub source: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub script_id: String,
    pub name: String,
    pub trigger_type: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Worker {
    pub id: String,
    pub name: String,
    pub os: String,
    pub tags_json: String,
    pub status: String,
    pub registered_at: i64,
    pub last_seen_at: i64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct JobArtifact {
    pub id: String,
    pub job_run_id: String,
    pub name: String,
    pub size_bytes: i64,
    pub created_at: i64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct JobArtifactInput {
    pub id: String,
    pub job_run_id: String,
    pub name: String,
    pub content: Vec<u8>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct TestReport {
    pub id: String,
    pub job_run_id: String,
    pub suite: String,
    pub test_name: String,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub message: Option<String>,
    pub created_at: i64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JobRun {
    pub id: String,
    pub job_id: String,
    pub status: String,
    pub log: Option<String>,
    pub triggered_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct DeployTarget {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub target_key: String,
    pub description: Option<String>,
    pub manual_control: bool,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Deployment {
    pub id: String,
    pub target_id: String,
    pub version: String,
    pub status: String,
    pub description: Option<String>,
    pub job_run_id: Option<String>,
    pub scheduled_at: Option<i64>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct ScheduleDeploymentRequest {
    pub id: String,
    pub target_id: String,
    pub version: String,
    pub description: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PackageRepository {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub format: String,
    pub mode: String,
    pub description: Option<String>,
    pub archived: bool,
    #[serde(default)]
    pub retention_days: Option<i64>,
    #[serde(default)]
    pub retention_version_count: Option<i64>,
    #[serde(default = "default_retain_downloaded")]
    pub retain_downloaded: bool,
    #[serde(default = "default_access_level")]
    pub access_level: String,
}
fn default_retain_downloaded() -> bool {
    true
}
fn default_access_level() -> String {
    "PRIVATE".into()
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PackageRepositoryAcl {
    pub repository_id: String,
    pub profile_id: String,
    pub role: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PackageVersion {
    pub id: String,
    pub repository_id: String,
    pub package_name: String,
    pub version: String,
    pub metadata_json: Option<String>,
    pub format_metadata_json: Option<String>,
    pub created_at: i64,
    pub accessed_at: Option<i64>,
    pub downloads: i64,
    pub pinned: bool,
    pub immutable: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PackageVulnerability {
    pub id: String,
    pub package_version_id: String,
    pub cve_id: String,
    pub severity: String,
    pub affected_range: String,
    pub title: Option<String>,
    pub description: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct DependencyOverview {
    pub version: PackageVersion,
    pub vulnerabilities: Vec<PackageVulnerability>,
}
/// Scanner seam: deployments can replace this no-network default with a vetted scanner.
pub trait VulnerabilityScanner: Send + Sync {
    fn scan(&self, version: &PackageVersion) -> Result<Vec<PackageVulnerability>>;
}
pub struct NoopVulnerabilityScanner;
impl VulnerabilityScanner for NoopVulnerabilityScanner {
    fn scan(&self, _: &PackageVersion) -> Result<Vec<PackageVulnerability>> {
        Ok(vec![])
    }
}

// ---------- script JSON model (the ".space.kts equivalent") ----------
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptJobDef {
    pub name: String,
    #[serde(default = "default_trigger_type")]
    pub trigger_type: String,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub steps: Vec<String>,
}
fn default_trigger_type() -> String {
    "MANUAL".into()
}
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ScriptDef {
    #[serde(default)]
    pub jobs: Vec<ScriptJobDef>,
}

/// Parses `source` as a `ScriptDef` and enforces Space's real Automation limits.
pub fn parse_and_validate_script(source: &str) -> Result<ScriptDef> {
    let def: ScriptDef =
        serde_json::from_str(source).map_err(|e| format!("invalid pipeline script JSON: {e}"))?;
    if def.jobs.len() > MAX_JOBS_PER_SCRIPT {
        return Err(format!(
            "script exceeds max {MAX_JOBS_PER_SCRIPT} jobs/script (has {})",
            def.jobs.len()
        ));
    }
    let mut seen = HashSet::new();
    for job in &def.jobs {
        if job.name.trim().is_empty() {
            return Err("every job needs a non-empty name".into());
        }
        if !seen.insert(job.name.clone()) {
            return Err(format!("duplicate job name '{}' in script", job.name));
        }
        if job.steps.is_empty() {
            return Err(format!("job '{}' needs at least one step", job.name));
        }
        if job.steps.len() > MAX_STEPS_PER_JOB {
            return Err(format!(
                "job '{}' exceeds max {MAX_STEPS_PER_JOB} steps/job (has {})",
                job.name,
                job.steps.len()
            ));
        }
        if let Some(t) = job.timeout_secs {
            if t == 0 || t > MAX_JOB_TIMEOUT_SECS {
                return Err(format!("job '{}' timeout_secs must be in 1..={MAX_JOB_TIMEOUT_SECS} (2h max, per Space docs)", job.name));
            }
        }
    }
    Ok(def)
}

fn job_id_for(script_id: &str, name: &str) -> String {
    format!("{script_id}::{name}")
}

/// Resyncs the `jobs` index table from a validated script def: upserts current jobs,
/// archives ones no longer present (soft-delete, same convention as the rest of the schema).
fn sync_jobs_tx(conn: &Connection, script_id: &str, def: &ScriptDef) -> Result<()> {
    let mut stmt = conn
        .prepare("SELECT id FROM jobs WHERE script_id=?1")
        .map_err(|e| e.to_string())?;
    let existing: HashSet<String> = stmt
        .query_map(params![script_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let mut kept = HashSet::new();
    for job in &def.jobs {
        let id = job_id_for(script_id, &job.name);
        conn.execute(
            "INSERT INTO jobs(id,script_id,name,trigger_type,archived) VALUES(?1,?2,?3,?4,0)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, trigger_type=excluded.trigger_type, archived=0",
            params![id, script_id, job.name, job.trigger_type],
        )
        .map_err(|e| e.to_string())?;
        kept.insert(id);
    }
    for id in existing.difference(&kept) {
        conn.execute("UPDATE jobs SET archived=1 WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn create_pipeline_script_tx(conn: &Connection, script: &PipelineScript) -> Result<()> {
    let def = parse_and_validate_script(&script.source)?;
    conn.execute(
        "INSERT INTO pipeline_scripts(id,project_id,repository,path,source,archived)VALUES(?1,?2,?3,?4,?5,?6)",
        params![script.id, script.project_id, script.repository, script.path, script.source, script.archived],
    )
    .map_err(|e| e.to_string())?;
    sync_jobs_tx(conn, &script.id, &def)
}
fn update_pipeline_script_tx(conn: &Connection, script: &PipelineScript) -> Result<()> {
    let def = parse_and_validate_script(&script.source)?;
    conn.execute(
        "UPDATE pipeline_scripts SET project_id=?2,repository=?3,path=?4,source=?5,archived=?6 WHERE id=?1",
        params![script.id, script.project_id, script.repository, script.path, script.source, script.archived],
    )
    .map_err(|e| e.to_string())?;
    sync_jobs_tx(conn, &script.id, &def)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_pipeline_scripts() -> Result<Vec<PipelineScript>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,project_id,repository,path,source,archived FROM pipeline_scripts ORDER BY path").map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(PipelineScript {
                id: r.get(0)?,
                project_id: r.get(1)?,
                repository: r.get(2)?,
                path: r.get(3)?,
                source: r.get(4)?,
                archived: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_pipeline_script(script: PipelineScript) -> Result<()> {
    let c = db::conn()?;
    create_pipeline_script_tx(&c, &script)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_pipeline_script(script: PipelineScript) -> Result<()> {
    let c = db::conn()?;
    update_pipeline_script_tx(&c, &script)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_pipeline_script(id: String) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "DELETE FROM job_runs WHERE job_id IN (SELECT id FROM jobs WHERE script_id=?1)",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    c.execute("DELETE FROM jobs WHERE script_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    c.execute("DELETE FROM pipeline_scripts WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_jobs() -> Result<Vec<Job>> {
    let c = db::conn()?;
    let mut s = c
        .prepare("SELECT id,script_id,name,trigger_type,archived FROM jobs ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Job {
                id: r.get(0)?,
                script_id: r.get(1)?,
                name: r.get(2)?,
                trigger_type: r.get(3)?,
                archived: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_jobs_for_script(script_id: String) -> Result<Vec<Job>> {
    let c = db::conn()?;
    let mut s = c
        .prepare("SELECT id,script_id,name,trigger_type,archived FROM jobs WHERE script_id=?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(params![script_id], |r| {
            Ok(Job {
                id: r.get(0)?,
                script_id: r.get(1)?,
                name: r.get(2)?,
                trigger_type: r.get(3)?,
                archived: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_job_runs() -> Result<Vec<JobRun>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,job_id,status,log,triggered_at,started_at,finished_at FROM job_runs ORDER BY triggered_at DESC").map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(JobRun {
                id: r.get(0)?,
                job_id: r.get(1)?,
                status: r.get(2)?,
                log: r.get(3)?,
                triggered_at: r.get(4)?,
                started_at: r.get(5)?,
                finished_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_job_runs_for_script(script_id: String) -> Result<Vec<JobRun>> {
    let c = db::conn()?;
    let mut s = c
        .prepare(
            "SELECT job_runs.id,job_runs.job_id,job_runs.status,job_runs.log,job_runs.triggered_at,job_runs.started_at,job_runs.finished_at
             FROM job_runs JOIN jobs ON jobs.id=job_runs.job_id WHERE jobs.script_id=?1 ORDER BY job_runs.triggered_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(params![script_id], |r| {
            Ok(JobRun {
                id: r.get(0)?,
                job_id: r.get(1)?,
                status: r.get(2)?,
                log: r.get(3)?,
                triggered_at: r.get(4)?,
                started_at: r.get(5)?,
                finished_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn register_worker(worker: Worker) -> Result<Worker> {
    if worker.name.trim().is_empty() || worker.os.trim().is_empty() {
        return Err("worker name and os are required".into());
    }
    serde_json::from_str::<Vec<String>>(&worker.tags_json)
        .map_err(|_| "worker tags_json must be a JSON string array")?;
    let c = db::conn()?;
    let now = now_secs();
    c.execute("INSERT INTO workers(id,name,os,tags_json,status,registered_at,last_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,os=excluded.os,tags_json=excluded.tags_json,status=excluded.status,last_seen_at=excluded.last_seen_at",params![worker.id,worker.name,worker.os,worker.tags_json,worker.status,now]).map_err(|e|e.to_string())?;
    c.query_row(
        "SELECT id,name,os,tags_json,status,registered_at,last_seen_at FROM workers WHERE id=?1",
        params![worker.id],
        |r| {
            Ok(Worker {
                id: r.get(0)?,
                name: r.get(1)?,
                os: r.get(2)?,
                tags_json: r.get(3)?,
                status: r.get(4)?,
                registered_at: r.get(5)?,
                last_seen_at: r.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_workers() -> Result<Vec<Worker>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,name,os,tags_json,status,registered_at,last_seen_at FROM workers ORDER BY name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok(Worker {
                id: r.get(0)?,
                name: r.get(1)?,
                os: r.get(2)?,
                tags_json: r.get(3)?,
                status: r.get(4)?,
                registered_at: r.get(5)?,
                last_seen_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_job_artifact(input: JobArtifactInput) -> Result<JobArtifact> {
    if input.name.trim().is_empty() {
        return Err("artifact name is required".into());
    };
    let c = db::conn()?;
    let now = now_secs();
    let size = input.content.len() as i64;
    c.execute("INSERT INTO job_artifacts(id,job_run_id,name,content,size_bytes,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![input.id,input.job_run_id,input.name,input.content,size,now]).map_err(|e|e.to_string())?;
    Ok(JobArtifact {
        id: input.id,
        job_run_id: input.job_run_id,
        name: input.name,
        size_bytes: size,
        created_at: now,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_job_artifacts(job_run_id: String) -> Result<Vec<JobArtifact>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,job_run_id,name,size_bytes,created_at FROM job_artifacts WHERE job_run_id=?1 ORDER BY created_at DESC").map_err(|e|e.to_string())?;
    let rows = q
        .query_map(params![job_run_id], |r| {
            Ok(JobArtifact {
                id: r.get(0)?,
                job_run_id: r.get(1)?,
                name: r.get(2)?,
                size_bytes: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_test_report(report: TestReport) -> Result<()> {
    if !matches!(report.status.as_str(), "PASSED" | "FAILED" | "SKIPPED") {
        return Err("test report status must be PASSED, FAILED, or SKIPPED".into());
    };
    let c = db::conn()?;
    c.execute("INSERT INTO test_reports(id,job_run_id,suite,test_name,status,duration_ms,message,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![report.id,report.job_run_id,report.suite,report.test_name,report.status,report.duration_ms,report.message,report.created_at]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_test_reports(job_run_id: String) -> Result<Vec<TestReport>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,job_run_id,suite,test_name,status,duration_ms,message,created_at FROM test_reports WHERE job_run_id=?1 ORDER BY suite,test_name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map(params![job_run_id], |r| {
            Ok(TestReport {
                id: r.get(0)?,
                job_run_id: r.get(1)?,
                suite: r.get(2)?,
                test_name: r.get(3)?,
                status: r.get(4)?,
                duration_ms: r.get(5)?,
                message: r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ---------- real local executor: parallel jobs, sequential steps, real processes ----------

/// Runs one shell step to completion (or until `deadline`), capturing combined stdout+stderr.
/// Std-lib only: reader threads drain the piped streams while the main thread polls
/// `try_wait`, so a hung/long step can still be killed at the deadline without deadlocking on
/// a full pipe buffer.
fn run_step(cmd: &str, cwd: &Path, deadline: Instant) -> Result<(bool, String)> {
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let out_handle = thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_handle = thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let out = out_handle.join().unwrap_or_default();
                let err = err_handle.join().unwrap_or_default();
                return Ok((status.success(), format!("{out}{err}")));
            }
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let out = out_handle.join().unwrap_or_default();
                    let err = err_handle.join().unwrap_or_default();
                    return Ok((false, format!("{out}{err}[step timed out]\n")));
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

fn set_run_running(conn: &Arc<Mutex<Connection>>, run_id: &str, started_at: i64) {
    if let Ok(c) = conn.lock() {
        let _ = c.execute(
            "UPDATE job_runs SET status='RUNNING', started_at=?2 WHERE id=?1",
            params![run_id, started_at],
        );
    }
}
fn set_run_log(conn: &Arc<Mutex<Connection>>, run_id: &str, log: &str) {
    if let Ok(c) = conn.lock() {
        let _ = c.execute(
            "UPDATE job_runs SET log=?2 WHERE id=?1",
            params![run_id, log],
        );
    }
}
fn finish_run(
    conn: &Arc<Mutex<Connection>>,
    run_id: &str,
    status: &str,
    log: &str,
    finished_at: i64,
) {
    if let Ok(c) = conn.lock() {
        let _ = c.execute(
            "UPDATE job_runs SET status=?2, log=?3, finished_at=?4 WHERE id=?1",
            params![run_id, status, log, finished_at],
        );
    }
}

/// Executes one job run's steps sequentially against a per-run workdir. Runs on its own
/// thread; jobs of the same script never wait on each other (no dependency graph, by design).
fn execute_job_run(
    conn: Arc<Mutex<Connection>>,
    run_dir: PathBuf,
    run_id: String,
    steps: Vec<String>,
    timeout_secs: u64,
) {
    let _ = fs::create_dir_all(&run_dir);
    set_run_running(&conn, &run_id, now_secs());
    let deadline = Instant::now() + Duration::from_secs(timeout_secs.max(1));
    let mut log = String::new();
    let mut failed = false;
    for step in &steps {
        if Instant::now() >= deadline {
            log.push_str(&format!("$ {step}\n[skipped: job timed out]\n"));
            failed = true;
            break;
        }
        log.push_str(&format!("$ {step}\n"));
        match run_step(step, &run_dir, deadline) {
            Ok((success, output)) => {
                log.push_str(&output);
                if !output.ends_with('\n') {
                    log.push('\n');
                }
                set_run_log(&conn, &run_id, &log);
                if !success {
                    failed = true;
                    break;
                }
            }
            Err(e) => {
                log.push_str(&format!("[step error: {e}]\n"));
                failed = true;
                break;
            }
        }
    }
    finish_run(
        &conn,
        &run_id,
        if failed { "FAILED" } else { "FINISHED" },
        &log,
        now_secs(),
    );
}

/// Inserts `SCHEDULED` run rows for every (non-archived-in-current-source) job of a script
/// and spawns one background thread per job — this is the "jobs always run in parallel"
/// contract. Returns the initial rows immediately; callers that need to await completion
/// (tests) can join the returned handles, production code (the tauri command) drops them,
/// which detaches the threads to keep running without blocking the IPC call.
fn spawn_script_jobs(
    conn: Arc<Mutex<Connection>>,
    workdir_root: PathBuf,
    script_id: &str,
    required_trigger: Option<&str>,
) -> Result<(Vec<JobRun>, Vec<thread::JoinHandle<()>>)> {
    let def = {
        let c = conn
            .lock()
            .map_err(|_| "pipeline db lock poisoned".to_string())?;
        let source: String = c
            .query_row(
                "SELECT source FROM pipeline_scripts WHERE id=?1",
                params![script_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        parse_and_validate_script(&source)?
    };
    let mut runs = Vec::new();
    let mut handles = Vec::new();
    for job in def
        .jobs
        .iter()
        .filter(|job| required_trigger.map_or(true, |trigger| job.trigger_type == trigger))
    {
        let job_id = job_id_for(script_id, &job.name);
        let run_id = format!("{job_id}::run-{}", now_nanos());
        let triggered_at = now_secs();
        {
            let c = conn
                .lock()
                .map_err(|_| "pipeline db lock poisoned".to_string())?;
            c.execute(
                "INSERT INTO job_runs(id,job_id,status,log,triggered_at) VALUES(?1,?2,'SCHEDULED',NULL,?3)",
                params![run_id, job_id, triggered_at],
            )
            .map_err(|e| e.to_string())?;
        }
        runs.push(JobRun {
            id: run_id.clone(),
            job_id: job_id.clone(),
            status: "SCHEDULED".into(),
            log: None,
            triggered_at,
            started_at: None,
            finished_at: None,
        });
        let conn2 = conn.clone();
        let run_dir = workdir_root.join(&run_id);
        let run_id2 = run_id.clone();
        let steps = job.steps.clone();
        let timeout = job.timeout_secs.unwrap_or(DEFAULT_JOB_TIMEOUT_SECS);
        handles.push(thread::spawn(move || {
            execute_job_run(conn2, run_dir, run_id2, steps, timeout)
        }));
    }
    Ok((runs, handles))
}

/// Manual trigger for every job in a script — Space's `.space.kts` scripts default to git-push
/// triggers, but this desktop build has no daemon watching repos, so triggers are manual-only
/// (surfaced as such in Pipelines.tsx).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn trigger_pipeline_script(script_id: String) -> Result<Vec<JobRun>> {
    let conn = db::conn()?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let workdir_root = std::env::temp_dir().join("pipeline-runs");
    let shared = Arc::new(Mutex::new(conn));
    let (runs, _handles) = spawn_script_jobs(shared, workdir_root, &script_id, None)?;
    Ok(runs)
}
/// Repository push entry point. The caller supplies the repository + branch rather than a
/// global watcher assumption; only GIT_PUSH jobs from that repository's script are scheduled.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn trigger_pipeline_on_push(
    script_id: String,
    repository: String,
    branch: String,
) -> Result<Vec<JobRun>> {
    if repository.trim().is_empty() || branch.trim().is_empty() {
        return Err("push repository and branch are required".into());
    }
    let conn = db::conn()?;
    let configured: Option<String> = conn
        .query_row(
            "SELECT repository FROM pipeline_scripts WHERE id=?1",
            params![script_id],
            |r| r.get(0),
        )
        .map_err(|_| "pipeline script not found".to_string())?;
    if configured.as_deref() != Some(repository.as_str()) {
        return Err("push repository does not match pipeline script".into());
    }
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let workdir_root = std::env::var_os("SPACE_PIPELINE_WORKDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("gaia-space")
                .join("pipeline-runs")
        });
    let shared = Arc::new(Mutex::new(conn));
    let (runs, _handles) = spawn_script_jobs(shared, workdir_root, &script_id, Some("GIT_PUSH"))?;
    Ok(runs)
}

// ---------- deploy targets + deployments ----------

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_deploy_targets() -> Result<Vec<DeployTarget>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,project_id,name,target_key,description,manual_control,archived FROM deploy_targets ORDER BY name").map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(DeployTarget {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                target_key: r.get(3)?,
                description: r.get(4)?,
                manual_control: r.get(5)?,
                archived: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_deploy_target(target: DeployTarget) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "INSERT INTO deploy_targets(id,project_id,name,target_key,description,manual_control,archived) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![target.id, target.project_id, target.name, target.target_key, target.description, target.manual_control, target.archived],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_deploy_target(target: DeployTarget) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE deploy_targets SET name=?2,target_key=?3,description=?4,manual_control=?5,archived=?6 WHERE id=?1",
        params![target.id, target.name, target.target_key, target.description, target.manual_control, target.archived],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_deploy_target(id: String) -> Result<()> {
    let c = db::conn()?;
    c.execute("DELETE FROM deployments WHERE target_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    c.execute("DELETE FROM deploy_targets WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn deployment_from_row(r: &rusqlite::Row) -> rusqlite::Result<Deployment> {
    Ok(Deployment {
        id: r.get(0)?,
        target_id: r.get(1)?,
        version: r.get(2)?,
        status: r.get(3)?,
        description: r.get(4)?,
        job_run_id: r.get(5)?,
        scheduled_at: r.get(6)?,
        started_at: r.get(7)?,
        finished_at: r.get(8)?,
    })
}
const DEPLOYMENT_COLUMNS: &str =
    "id,target_id,version,status,description,job_run_id,scheduled_at,started_at,finished_at";

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_deployments_for_target(target_id: String) -> Result<Vec<Deployment>> {
    let c = db::conn()?;
    let mut s = c
        .prepare(&format!("SELECT {DEPLOYMENT_COLUMNS} FROM deployments WHERE target_id=?1 ORDER BY scheduled_at DESC"))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(params![target_id], deployment_from_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn schedule_deployment_tx(
    conn: &Connection,
    req: &ScheduleDeploymentRequest,
) -> Result<Deployment> {
    let now = now_secs();
    conn.execute(
        "INSERT INTO deployments(id,target_id,version,status,description,scheduled_at) VALUES(?1,?2,?3,'SCHEDULED',?4,?5)",
        params![req.id, req.target_id, req.version, req.description, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Deployment {
        id: req.id.clone(),
        target_id: req.target_id.clone(),
        version: req.version.clone(),
        status: "SCHEDULED".into(),
        description: req.description.clone(),
        job_run_id: None,
        scheduled_at: Some(now),
        started_at: None,
        finished_at: None,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn schedule_deployment(req: ScheduleDeploymentRequest) -> Result<Deployment> {
    let c = db::conn()?;
    schedule_deployment_tx(&c, &req)
}

/// Space's real `DeploymentStatus` state machine (KB §2.4): SCHEDULED -> DEPLOYING ->
/// {CURRENT|FAILED|HANGING}; only one deployment may be CURRENT per target ("only one
/// deployment for a Git branch"), so promoting one to CURRENT auto-supersedes ("completed" /
/// `OBSOLETE`) whichever was previously CURRENT on the same target.
fn allowed_deployment_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("SCHEDULED", "DEPLOYING")
            | ("SCHEDULED", "FAILED")
            | ("DEPLOYING", "CURRENT")
            | ("DEPLOYING", "FAILED")
            | ("DEPLOYING", "HANGING")
            | ("HANGING", "FAILED")
            | ("HANGING", "CURRENT")
            | ("CURRENT", "OBSOLETE")
            | ("CURRENT", "FAILED")
    )
}
fn transition_deployment_tx(conn: &Connection, id: &str, to: &str) -> Result<Deployment> {
    let (target_id, from): (String, String) = conn
        .query_row(
            "SELECT target_id,status FROM deployments WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if !allowed_deployment_transition(&from, to) {
        return Err(format!("illegal deployment transition {from} -> {to}"));
    }
    let now = now_secs();
    match to {
        "DEPLOYING" => {
            conn.execute(
                "UPDATE deployments SET status=?2, started_at=?3 WHERE id=?1",
                params![id, to, now],
            )
            .map_err(|e| e.to_string())?;
        }
        "CURRENT" => {
            // Only one CURRENT per target: whichever deployment held it becomes OBSOLETE ("completed").
            conn.execute(
                "UPDATE deployments SET status='OBSOLETE', finished_at=?2 WHERE target_id=?1 AND status='CURRENT'",
                params![target_id, now],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE deployments SET status=?2 WHERE id=?1",
                params![id, to],
            )
            .map_err(|e| e.to_string())?;
        }
        _ => {
            conn.execute(
                "UPDATE deployments SET status=?2, finished_at=?3 WHERE id=?1",
                params![id, to, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    conn.query_row(
        &format!("SELECT {DEPLOYMENT_COLUMNS} FROM deployments WHERE id=?1"),
        params![id],
        deployment_from_row,
    )
    .map_err(|e| e.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn transition_deployment(id: String, status: String) -> Result<Deployment> {
    let c = db::conn()?;
    transition_deployment_tx(&c, &id, &status)
}

// ---------- package repositories + versions ----------

fn validate_package_format(format: &str) -> Result<()> {
    if PACKAGE_FORMATS.contains(&format) {
        Ok(())
    } else {
        Err(format!(
            "unsupported package format '{format}' (must be one of {PACKAGE_FORMATS:?})"
        ))
    }
}
fn validate_repo_mode(mode: &str) -> Result<()> {
    if REPO_MODES.contains(&mode) {
        Ok(())
    } else {
        Err(format!(
            "repository mode must be one of {REPO_MODES:?} (got '{mode}')"
        ))
    }
}

/// A registry path segment must be one portable filename, never a path expression.
fn validate_package_path_component(value: &str, field: &str) -> Result<()> {
    if value.is_empty()
        || matches!(value, "." | "..")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(format!(
            "invalid package {field}: expected non-empty [A-Za-z0-9._-]+ path component"
        ));
    }
    Ok(())
}
fn package_base_dir() -> PathBuf {
    std::env::var_os("SPACE_PACKAGE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("gaia-space")
                .join("packages")
        })
}
/// Independently resolve the filesystem path; lexical validation alone never authorizes a write.
fn canonical_path_within(base_dir: &Path, path: &Path) -> Result<PathBuf> {
    let canonical_base =
        fs::canonicalize(base_dir).map_err(|e| format!("cannot canonicalize package root: {e}"))?;
    let canonical_path =
        fs::canonicalize(path).map_err(|e| format!("cannot canonicalize package path: {e}"))?;
    if canonical_path.starts_with(&canonical_base) {
        Ok(canonical_path)
    } else {
        Err("package path resolves outside package root".into())
    }
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_package_repositories() -> Result<Vec<PackageRepository>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,project_id,name,format,mode,description,archived,retention_days,retention_version_count,retain_downloaded,access_level FROM package_repositories ORDER BY name").map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(PackageRepository {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                format: r.get(3)?,
                mode: r.get(4)?,
                description: r.get(5)?,
                archived: r.get(6)?,
                retention_days: r.get(7)?,
                retention_version_count: r.get(8)?,
                retain_downloaded: r.get(9)?,
                access_level: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_package_repository(repo: PackageRepository) -> Result<()> {
    validate_package_path_component(&repo.id, "repository id")?;
    validate_package_format(&repo.format)?;
    validate_repo_mode(&repo.mode)?;
    validate_package_access_level(&repo.access_level)?;
    let c = db::conn()?;
    c.execute(
        "INSERT INTO package_repositories(id,project_id,name,format,mode,description,archived,retention_days,retention_version_count,retain_downloaded,access_level) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![repo.id, repo.project_id, repo.name, repo.format, repo.mode, repo.description, repo.archived, repo.retention_days, repo.retention_version_count, repo.retain_downloaded, repo.access_level],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_package_repository(repo: PackageRepository) -> Result<()> {
    validate_package_format(&repo.format)?;
    validate_repo_mode(&repo.mode)?;
    validate_package_access_level(&repo.access_level)?;
    let c = db::conn()?;
    c.execute(
        "UPDATE package_repositories SET name=?2,format=?3,mode=?4,description=?5,archived=?6,retention_days=?7,retention_version_count=?8,retain_downloaded=?9,access_level=?10 WHERE id=?1",
        params![repo.id, repo.name, repo.format, repo.mode, repo.description, repo.archived, repo.retention_days, repo.retention_version_count, repo.retain_downloaded, repo.access_level],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_package_repository(id: String) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "DELETE FROM package_versions WHERE repository_id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    c.execute("DELETE FROM package_repositories WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_package_versions(
    repository_id: String,
    query: Option<String>,
) -> Result<Vec<PackageVersion>> {
    let c = db::conn()?;
    let like = format!("%{}%", query.unwrap_or_default());
    let mut s = c
        .prepare("SELECT id,repository_id,package_name,version,metadata_json,format_metadata_json,created_at,accessed_at,downloads,pinned,immutable FROM package_versions WHERE repository_id=?1 AND package_name LIKE ?2 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(params![repository_id, like], |r| {
            Ok(PackageVersion {
                id: r.get(0)?,
                repository_id: r.get(1)?,
                package_name: r.get(2)?,
                version: r.get(3)?,
                metadata_json: r.get(4)?,
                format_metadata_json: r.get(5)?,
                created_at: r.get(6)?,
                accessed_at: r.get(7)?,
                downloads: r.get(8)?,
                pinned: r.get(9)?,
                immutable: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Typed, registry-format projections persisted independently from the generic envelope.
/// Values not supplied by a transport are deliberately represented as empty/null defaults,
/// never guessed from a remote registry.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MavenMetadata {
    group_id: String,
    artifact_id: String,
    version: String,
    checksum: Option<String>,
    snapshot: bool,
    deps: Vec<Value>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NpmMetadata {
    manifest: Value,
    deps: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NugetMetadata {
    framework_deps: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PypiMetadata {
    files: Value,
    deps: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContainerMetadata {
    oci_manifest: Value,
    config: Value,
    history: Value,
    subject_referrers: Value,
}

fn field(value: &serde_json::Map<String, Value>, name: &str, fallback: Value) -> Value {
    value.get(name).cloned().unwrap_or(fallback)
}
fn package_immutable_default() -> bool {
    std::env::var("SPACE_PACKAGE_IMMUTABLE_DEFAULT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}
fn typed_format_metadata(
    format: &str,
    package_name: &str,
    version: &str,
    metadata: &Value,
) -> Result<Value> {
    let object = metadata
        .as_object()
        .ok_or_else(|| "metadata must be a JSON object".to_string())?;
    let projection = object
        .get("formatMetadata")
        .and_then(Value::as_object)
        .unwrap_or(object);
    let typed = match format {
        "maven" => json!(MavenMetadata {
            group_id: field(projection, "groupId", json!(package_name))
                .as_str()
                .ok_or("maven groupId must be a string")?
                .into(),
            artifact_id: field(projection, "artifactId", json!(package_name))
                .as_str()
                .ok_or("maven artifactId must be a string")?
                .into(),
            version: field(projection, "version", json!(version))
                .as_str()
                .ok_or("maven version must be a string")?
                .into(),
            checksum: projection
                .get("checksum")
                .and_then(Value::as_str)
                .map(str::to_owned),
            snapshot: field(
                projection,
                "snapshot",
                json!(version.ends_with("-SNAPSHOT"))
            )
            .as_bool()
            .ok_or("maven snapshot must be boolean")?,
            deps: field(projection, "deps", json!([]))
                .as_array()
                .ok_or("maven deps must be an array")?
                .clone(),
        }),
        "npm" => json!(NpmMetadata {
            manifest: field(projection, "manifest", metadata.clone()),
            deps: field(projection, "deps", json!({}))
        }),
        "nuget" => json!(NugetMetadata {
            framework_deps: field(projection, "frameworkDeps", json!({}))
        }),
        "pypi" => json!(PypiMetadata {
            files: field(projection, "files", json!([])),
            deps: field(projection, "deps", json!([]))
        }),
        "container" => json!(ContainerMetadata {
            oci_manifest: field(projection, "ociManifest", json!({})),
            config: field(projection, "config", json!({})),
            history: field(projection, "history", json!([])),
            subject_referrers: field(projection, "subjectReferrers", json!([]))
        }),
        _ => json!({}),
    };
    Ok(typed)
}

/// Publishes one version: merges caller metadata with `_format`/`_file_path`/`_file_size`
/// bookkeeping and, if a payload is supplied, writes it under the app-data packages dir
/// (`<app-data>/packages/<repo>/<name>/<version>/<filename>`, all path segments parameterized
/// — never a fixed/guessed location). Payload is stored as UTF-8 text (this local registry
/// has no upload transport for arbitrary binaries yet; real Space's binary artifact storage is
/// future work — noted here rather than faked).
fn publish_package_version_tx(
    conn: &Connection,
    base_dir: &Path,
    repository_id: &str,
    package_name: &str,
    version: &str,
    metadata_json: Option<&str>,
    payload_filename: Option<&str>,
    payload_content: Option<&[u8]>,
    immutable: Option<bool>,
) -> Result<PackageVersion> {
    validate_package_path_component(repository_id, "repository id")?;
    validate_package_path_component(package_name, "name")?;
    validate_package_path_component(version, "version")?;
    if let Some(filename) = payload_filename {
        validate_package_path_component(filename, "payload filename")?;
    }
    if payload_filename.is_some() != payload_content.is_some() {
        return Err("payload filename and content must be supplied together".into());
    }
    let format: String = conn
        .query_row(
            "SELECT format FROM package_repositories WHERE id=?1",
            params![repository_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("unknown package repository '{repository_id}'"))?;
    let mut meta: serde_json::Value = match metadata_json {
        Some(s) if !s.trim().is_empty() => {
            serde_json::from_str(s).map_err(|e| format!("invalid metadata JSON: {e}"))?
        }
        _ => serde_json::json!({}),
    };
    let Some(meta_object) = meta.as_object_mut() else {
        return Err("metadata must be a JSON object".into());
    };
    // Server-owned fields cannot be supplied to seed a deletion path.
    meta_object.remove("_file_path");
    meta_object.remove("_file_size");
    meta_object.remove("_format");
    if let (Some(filename), Some(content)) = (payload_filename, payload_content) {
        fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;
        let dir = base_dir
            .join(repository_id)
            .join(package_name)
            .join(version);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        canonical_path_within(base_dir, &dir)?;
        let file_path = dir.join(filename);
        fs::write(&file_path, content).map_err(|e| e.to_string())?;
        let canonical_file_path = canonical_path_within(base_dir, &file_path)?;
        meta["_file_path"] = serde_json::Value::String(canonical_file_path.display().to_string());
        meta["_file_size"] = serde_json::Value::from(content.len());
    }
    let format_metadata = typed_format_metadata(&format, package_name, version, &meta)?;
    meta["_format"] = serde_json::Value::String(format);
    let id = format!("{repository_id}::{package_name}::{version}");
    let existing_immutable: Option<bool> = conn
        .query_row(
            "SELECT immutable FROM package_versions WHERE id=?1",
            params![&id],
            |r| r.get(0),
        )
        .ok();
    if existing_immutable == Some(true) {
        return Err(format!(
            "package version {package_name}@{version} is immutable and cannot be republished"
        ));
    }
    // Deployment policy is parameterized; callers may override it per publish.
    let immutable = immutable.unwrap_or_else(package_immutable_default);
    conn.execute("INSERT INTO package_versions(id,repository_id,package_name,version,metadata_json,format_metadata_json,immutable) VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,format_metadata_json=excluded.format_metadata_json,immutable=excluded.immutable", params![id, repository_id, package_name, version, meta.to_string(), format_metadata.to_string(), immutable]).map_err(|e| e.to_string())?;
    let created_at: i64 = conn
        .query_row(
            "SELECT created_at FROM package_versions WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(PackageVersion {
        id,
        repository_id: repository_id.into(),
        package_name: package_name.into(),
        version: version.into(),
        metadata_json: Some(meta.to_string()),
        format_metadata_json: Some(format_metadata.to_string()),
        created_at,
        accessed_at: None,
        downloads: 0,
        pinned: false,
        immutable,
    })
}
/// Publishes arbitrary registry bytes. HTTP registry routes use this rather than lossy text
/// conversion; metadata and path safety remain identical to the desktop command.
pub fn publish_registry_bytes(
    repository_id: &str,
    package_name: &str,
    version: &str,
    metadata_json: Option<&str>,
    payload_filename: Option<&str>,
    payload: Option<&[u8]>,
) -> Result<PackageVersion> {
    let c = db::conn()?;
    publish_package_version_tx(
        &c,
        &package_base_dir(),
        repository_id,
        package_name,
        version,
        metadata_json,
        payload_filename,
        payload,
        None,
    )
}
/// Reads a stored registry asset only after resolving its server-owned path beneath the registry root.
pub fn download_registry_bytes(
    repository_id: &str,
    package_name: &str,
    version: &str,
    filename: &str,
) -> Result<Vec<u8>> {
    validate_package_path_component(repository_id, "repository id")?;
    validate_package_path_component(package_name, "name")?;
    validate_package_path_component(version, "version")?;
    validate_package_path_component(filename, "payload filename")?;
    let c = db::conn()?;
    let meta: String = c.query_row("SELECT metadata_json FROM package_versions WHERE repository_id=?1 AND package_name=?2 AND version=?3", params![repository_id, package_name, version], |r| r.get(0)).map_err(|_| "package version not found".to_string())?;
    let value: Value = serde_json::from_str(&meta).map_err(|e| e.to_string())?;
    let path = value
        .get("_file_path")
        .and_then(Value::as_str)
        .ok_or_else(|| "package version has no downloadable payload".to_string())?;
    let canonical = canonical_path_within(&package_base_dir(), Path::new(path))?;
    if canonical.file_name().and_then(|v| v.to_str()) != Some(filename) {
        return Err("payload filename does not match package version".into());
    }
    c.execute("UPDATE package_versions SET downloads=downloads+1,accessed_at=?4 WHERE repository_id=?1 AND package_name=?2 AND version=?3",params![repository_id,package_name,version,now_secs()]).map_err(|e|e.to_string())?;
    fs::read(canonical).map_err(|e| e.to_string())
}
pub fn generic_registry_metadata(
    repository_id: &str,
    package_name: &str,
    version: &str,
) -> Result<Value> {
    let c = db::conn()?;
    let (metadata, created_at): (Option<String>, i64) = c.query_row("SELECT metadata_json,created_at FROM package_versions WHERE repository_id=?1 AND package_name=?2 AND version=?3", params![repository_id,package_name,version], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|_| "package version not found".to_string())?;
    let mut value = metadata
        .and_then(|m| serde_json::from_str(&m).ok())
        .unwrap_or_else(|| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("name".into(), json!(package_name));
        object.insert("version".into(), json!(version));
        object.insert("publishedAt".into(), json!(created_at));
    }
    Ok(value)
}
pub fn npm_registry_metadata(repository_id: &str, package_name: &str) -> Result<Value> {
    let c = db::conn()?;
    let mut statement = c.prepare("SELECT version,metadata_json,created_at FROM package_versions WHERE repository_id=?1 AND package_name=?2 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![repository_id, package_name], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Err("npm package not found".into());
    }
    let latest = rows[0].0.clone();
    let mut versions = serde_json::Map::new();
    let mut time = serde_json::Map::new();
    for (version, metadata, created_at) in rows {
        let mut doc = metadata
            .and_then(|m| serde_json::from_str::<Value>(&m).ok())
            .unwrap_or_else(|| json!({}));
        if let Some(obj) = doc.as_object_mut() {
            obj.insert("name".into(), json!(package_name));
            obj.insert("version".into(), json!(&version));
        }
        versions.insert(version.clone(), doc);
        time.insert(version, json!(created_at));
    }
    Ok(json!({"name":package_name,"dist-tags":{"latest":latest},"versions":versions,"time":time}))
}
#[cfg_attr(feature = "desktop", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub fn publish_package_version(
    repository_id: String,
    package_name: String,
    version: String,
    metadata_json: Option<String>,
    payload_filename: Option<String>,
    payload_content: Option<String>,
    immutable: Option<bool>,
) -> Result<PackageVersion> {
    let c = db::conn()?;
    let base_dir = package_base_dir();
    publish_package_version_tx(
        &c,
        &base_dir,
        &repository_id,
        &package_name,
        &version,
        metadata_json.as_deref(),
        payload_filename.as_deref(),
        payload_content.as_deref().map(str::as_bytes),
        immutable,
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_package_vulnerability(vulnerability: PackageVulnerability) -> Result<()> {
    let c = db::conn()?;
    c.execute("INSERT INTO package_vulnerabilities(id,package_version_id,cve_id,severity,affected_range,title,description) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(package_version_id,cve_id,affected_range) DO UPDATE SET severity=excluded.severity,title=excluded.title,description=excluded.description", params![vulnerability.id,vulnerability.package_version_id,vulnerability.cve_id,vulnerability.severity,vulnerability.affected_range,vulnerability.title,vulnerability.description]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn dependency_overview(version_id: String) -> Result<DependencyOverview> {
    let c = db::conn()?;
    let version=c.query_row("SELECT id,repository_id,package_name,version,metadata_json,format_metadata_json,created_at,accessed_at,downloads,pinned,immutable FROM package_versions WHERE id=?1",params![version_id],|r| Ok(PackageVersion{id:r.get(0)?,repository_id:r.get(1)?,package_name:r.get(2)?,version:r.get(3)?,metadata_json:r.get(4)?,format_metadata_json:r.get(5)?,created_at:r.get(6)?,accessed_at:r.get(7)?,downloads:r.get(8)?,pinned:r.get(9)?,immutable:r.get(10)?})).map_err(|_|"package version not found".to_string())?;
    let mut q=c.prepare("SELECT id,package_version_id,cve_id,severity,affected_range,title,description FROM package_vulnerabilities WHERE package_version_id=?1").map_err(|e|e.to_string())?;
    let vulnerabilities = q
        .query_map(params![version.id], |r| {
            Ok(PackageVulnerability {
                id: r.get(0)?,
                package_version_id: r.get(1)?,
                cve_id: r.get(2)?,
                severity: r.get(3)?,
                affected_range: r.get(4)?,
                title: r.get(5)?,
                description: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(DependencyOverview {
        version,
        vulnerabilities,
    })
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn download_package_payload(
    repository_id: String,
    package_name: String,
    version: String,
    filename: String,
) -> Result<Vec<u8>> {
    download_registry_bytes(&repository_id, &package_name, &version, &filename)
}
fn validate_package_access_level(value: &str) -> Result<()> {
    if matches!(value, "PRIVATE" | "PROJECT" | "PUBLIC") {
        Ok(())
    } else {
        Err("access level must be PRIVATE, PROJECT, or PUBLIC".into())
    }
}
fn validate_package_acl_role(value: &str) -> Result<()> {
    if matches!(value, "VIEWER" | "WRITER" | "MANAGER") {
        Ok(())
    } else {
        Err("package ACL role must be VIEWER, WRITER, or MANAGER".into())
    }
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_package_repository_acl(repository_id: String) -> Result<Vec<PackageRepositoryAcl>> {
    let c = db::conn()?;
    let mut statement = c.prepare("SELECT repository_id,profile_id,role FROM package_repository_acl WHERE repository_id=?1 ORDER BY profile_id").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![repository_id], |r| {
            Ok(PackageRepositoryAcl {
                repository_id: r.get(0)?,
                profile_id: r.get(1)?,
                role: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_package_repository_acl(entry: PackageRepositoryAcl) -> Result<()> {
    validate_package_acl_role(&entry.role)?;
    let c = db::conn()?;
    c.execute("INSERT INTO package_repository_acl(repository_id,profile_id,role) VALUES(?1,?2,?3) ON CONFLICT(repository_id,profile_id) DO UPDATE SET role=excluded.role",params![entry.repository_id,entry.profile_id,entry.role]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_package_repository_acl(repository_id: String, profile_id: String) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "DELETE FROM package_repository_acl WHERE repository_id=?1 AND profile_id=?2",
        params![repository_id, profile_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn apply_package_retention(repository_id: String) -> Result<usize> {
    let c = db::conn()?;
    let (days,count,retain):(Option<i64>,Option<i64>,bool)=c.query_row("SELECT retention_days,retention_version_count,retain_downloaded FROM package_repositories WHERE id=?1",params![repository_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"package repository not found".to_string())?;
    let cutoff = days
        .filter(|value| *value >= 0)
        .map(|value| now_secs() - value * 86_400);
    let mut statement=c.prepare("SELECT id,created_at,downloads FROM package_versions WHERE repository_id=?1 AND pinned=0 ORDER BY package_name,created_at DESC").map_err(|e|e.to_string())?;
    let versions = statement
        .query_map(params![repository_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut seen = std::collections::HashMap::<String, usize>::new();
    let mut removed = 0;
    for (id, created, downloads) in versions {
        let ordinal = seen
            .entry(id.rsplit("::").nth(1).unwrap_or("").to_string())
            .or_default();
        *ordinal += 1;
        let old_by_days = cutoff.is_some_and(|time| created < time);
        let old_by_count = count.is_some_and(|limit| *ordinal as i64 > limit.max(0));
        if (old_by_days || old_by_count) && !(retain && downloads > 0) {
            c.execute("DELETE FROM package_versions WHERE id=?1", params![id])
                .map_err(|e| e.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_package_version_pinned(id: String, pinned: bool) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE package_versions SET pinned=?2 WHERE id=?1",
        params![id, pinned],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_package_version(id: String) -> Result<()> {
    let c = db::conn()?;
    let meta: Option<String> = c
        .query_row(
            "SELECT metadata_json FROM package_versions WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .ok();
    if let Some(m) = meta {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&m) {
            if let Some(p) = v.get("_file_path").and_then(|p| p.as_str()) {
                match canonical_path_within(&package_base_dir(), Path::new(p)) {
                    Ok(path) => {
                        let _ = fs::remove_file(path);
                    }
                    Err(e) => {
                        eprintln!("SECURITY: refusing package payload deletion for {id}: {e}")
                    }
                }
            }
        }
    }
    c.execute("DELETE FROM package_versions WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    static UNIQUE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    /// pid+nanos alone can collide when cargo runs several tests in parallel threads within
    /// the same process at near-identical timestamps; an atomic counter makes it exact.
    fn unique_suffix() -> String {
        let n = UNIQUE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        format!("{}-{}-{n}", std::process::id(), now_nanos())
    }
    fn temp_db() -> PathBuf {
        std::env::temp_dir().join(format!(
            "gaia-space-pipelines-test-{}.sqlite",
            unique_suffix()
        ))
    }
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gaia-space-pipelines-test-{name}-{}",
            unique_suffix()
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }
    fn sweep(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_dir_all(path);
    }

    fn script_source(jobs: &[(&str, &[&str])]) -> String {
        let defs: Vec<ScriptJobDef> = jobs
            .iter()
            .map(|(name, steps)| ScriptJobDef {
                name: name.to_string(),
                trigger_type: "MANUAL".into(),
                timeout_secs: None,
                steps: steps.iter().map(|s| s.to_string()).collect(),
            })
            .collect();
        serde_json::to_string(&ScriptDef { jobs: defs }).unwrap()
    }

    /// A triggered job spawns a real `sh -c` step and its stdout is captured into the run log.
    #[test]
    fn job_run_executes_real_step_and_captures_log() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        let src = script_source(&[("build", &["echo hello-marker-42"])]);
        conn.execute("INSERT INTO pipeline_scripts(id,project_id,source) VALUES('script-a','demo-project',?1)", params![src]).unwrap();
        sync_jobs_tx(&conn, "script-a", &parse_and_validate_script(&src).unwrap()).unwrap();
        let workdir = temp_dir("runs-a");
        let shared = Arc::new(Mutex::new(conn));
        let (runs, handles) =
            spawn_script_jobs(shared.clone(), workdir.clone(), "script-a", None).expect("spawn");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "SCHEDULED");
        for h in handles {
            h.join().unwrap();
        }
        let c = shared.lock().unwrap();
        let (status, log): (String, Option<String>) = c
            .query_row(
                "SELECT status,log FROM job_runs WHERE id=?1",
                params![runs[0].id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "FINISHED");
        assert!(log.unwrap().contains("hello-marker-42"));
        drop(c);
        sweep(&db_path);
        sweep(&workdir);
    }

    /// Two jobs in the same script run concurrently, not serially. Proven load-independently:
    /// each job stamps a wall-clock timestamp before and after a 0.5s sleep, and true
    /// parallelism means job-two must begin before job-one finishes (and vice versa) — serial
    /// execution could never satisfy that regardless of how slow/busy the test machine is.
    #[test]
    fn two_jobs_in_a_script_run_in_parallel() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        let ts = "python3 -c \"import time; print('TS:' + repr(time.time()))\"";
        let src = script_source(&[
            ("job-one", &[ts, "sleep 0.5", ts]),
            ("job-two", &[ts, "sleep 0.5", ts]),
        ]);
        conn.execute("INSERT INTO pipeline_scripts(id,project_id,source) VALUES('script-b','demo-project',?1)", params![src]).unwrap();
        sync_jobs_tx(&conn, "script-b", &parse_and_validate_script(&src).unwrap()).unwrap();
        let workdir = temp_dir("runs-b");
        let shared = Arc::new(Mutex::new(conn));
        let (runs, handles) =
            spawn_script_jobs(shared.clone(), workdir.clone(), "script-b", None).expect("spawn");
        assert_eq!(runs.len(), 2);
        for h in handles {
            h.join().unwrap();
        }
        let c = shared.lock().unwrap();
        let mut begins = Vec::new();
        let mut ends = Vec::new();
        for run in &runs {
            let (status, log): (String, String) = c
                .query_row(
                    "SELECT status,log FROM job_runs WHERE id=?1",
                    params![run.id],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        ))
                    },
                )
                .unwrap();
            assert_eq!(status, "FINISHED");
            let stamps: Vec<f64> = log
                .lines()
                .filter_map(|l| l.strip_prefix("TS:").and_then(|s| s.parse::<f64>().ok()))
                .collect();
            assert_eq!(
                stamps.len(),
                2,
                "expected begin+end timestamps in log: {log}"
            );
            begins.push(stamps[0]);
            ends.push(stamps[1]);
        }
        drop(c);
        assert!(
            begins[1] < ends[0] && begins[0] < ends[1],
            "jobs did not overlap (ran serially): begins={begins:?} ends={ends:?}"
        );
        sweep(&db_path);
        sweep(&workdir);
    }

    /// Space's real limits: >100 jobs/script and >50 steps/job must be rejected up front.
    #[test]
    fn limit_validation_rejects_oversize_scripts() {
        let too_many_jobs: Vec<(String, Vec<&str>)> = (0..(MAX_JOBS_PER_SCRIPT + 1))
            .map(|i| (format!("job-{i}"), vec!["echo hi"]))
            .collect();
        let jobs_ref: Vec<(&str, &[&str])> = too_many_jobs
            .iter()
            .map(|(n, s)| (n.as_str(), s.as_slice()))
            .collect();
        let err = parse_and_validate_script(&script_source(&jobs_ref)).unwrap_err();
        assert!(err.contains("100 jobs"), "unexpected error: {err}");

        let too_many_steps: Vec<&str> = std::iter::repeat("echo hi")
            .take(MAX_STEPS_PER_JOB + 1)
            .collect();
        let err2 =
            parse_and_validate_script(&script_source(&[("build", &too_many_steps)])).unwrap_err();
        assert!(err2.contains("50 steps"), "unexpected error: {err2}");

        // sanity: a script within limits validates fine.
        assert!(parse_and_validate_script(&script_source(&[("build", &["echo ok"])])).is_ok());
    }

    /// Deployment state machine: SCHEDULED -> DEPLOYING -> CURRENT is legal and promoting a
    /// second deployment to CURRENT on the same target auto-supersedes (OBSOLETE) the first;
    /// skipping straight to CURRENT from SCHEDULED is illegal.
    #[test]
    fn deployment_transition_sequence() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO deploy_targets(id,project_id,name,target_key) VALUES('target-1','demo-project','Staging','staging')", []).unwrap();
        let d1 = schedule_deployment_tx(
            &conn,
            &ScheduleDeploymentRequest {
                id: "deploy-1".into(),
                target_id: "target-1".into(),
                version: "1.0.0".into(),
                description: None,
            },
        )
        .unwrap();
        assert_eq!(d1.status, "SCHEDULED");

        assert!(
            transition_deployment_tx(&conn, "deploy-1", "CURRENT").is_err(),
            "SCHEDULED -> CURRENT must be illegal"
        );

        let d1 = transition_deployment_tx(&conn, "deploy-1", "DEPLOYING").unwrap();
        assert_eq!(d1.status, "DEPLOYING");
        let d1 = transition_deployment_tx(&conn, "deploy-1", "CURRENT").unwrap();
        assert_eq!(d1.status, "CURRENT");

        let d2 = schedule_deployment_tx(
            &conn,
            &ScheduleDeploymentRequest {
                id: "deploy-2".into(),
                target_id: "target-1".into(),
                version: "1.0.1".into(),
                description: None,
            },
        )
        .unwrap();
        transition_deployment_tx(&conn, &d2.id, "DEPLOYING").unwrap();
        let d2 = transition_deployment_tx(&conn, &d2.id, "CURRENT").unwrap();
        assert_eq!(d2.status, "CURRENT");

        let d1_after: String = conn
            .query_row(
                "SELECT status FROM deployments WHERE id='deploy-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            d1_after, "OBSOLETE",
            "promoting deploy-2 to CURRENT must supersede deploy-1"
        );
        sweep(&db_path);
    }

    /// Publishing a version writes metadata + payload file under the parameterized base dir
    /// and records the file path/size/format in stored metadata.
    #[test]
    fn package_version_publish_writes_metadata_and_payload() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).expect("migrate");
        conn.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-1','demo-npm','npm','HOSTING')", []).unwrap();
        let base_dir = temp_dir("packages");
        let pv = publish_package_version_tx(
            &conn,
            &base_dir,
            "repo-1",
            "left-pad",
            "1.2.3",
            Some(r#"{"license":"MIT"}"#),
            Some("left-pad-1.2.3.tgz"),
            Some(b"fake package payload bytes"),
            None,
        )
        .unwrap();
        assert_eq!(pv.package_name, "left-pad");
        let meta: serde_json::Value = serde_json::from_str(&pv.metadata_json.unwrap()).unwrap();
        assert_eq!(meta["license"], "MIT");
        assert_eq!(meta["_format"], "npm");
        let file_path = meta["_file_path"].as_str().unwrap();
        assert!(
            Path::new(file_path).exists(),
            "payload file should exist at {file_path}"
        );
        assert_eq!(
            fs::read_to_string(file_path).unwrap(),
            "fake package payload bytes"
        );
        assert!(
            Path::new(file_path)
                .canonicalize()
                .unwrap()
                .starts_with(base_dir.canonicalize().unwrap()),
            "payload must resolve inside package base dir"
        );

        // oversized/unsupported format rejected before touching disk.
        conn.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-2','demo-x','npm','HOSTING')", []).unwrap();
        assert!(publish_package_version_tx(
            &conn,
            &base_dir,
            "repo-2",
            "x",
            "1.0.0",
            Some("not json"),
            None,
            None,
            None
        )
        .is_err());
        sweep(&db_path);
        sweep(&base_dir);
    }
    #[test]
    fn package_publish_rejects_unsafe_repository_ids() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).unwrap();
        let base_dir = temp_dir("unsafe-repo");
        for repository_id in ["..", "..%2f", "/tmp/package-escape", "repo/nested"] {
            assert!(
                publish_package_version_tx(
                    &conn,
                    &base_dir,
                    repository_id,
                    "pkg",
                    "1.0.0",
                    None,
                    Some("pkg.tgz"),
                    Some(b"payload"),
                    None
                )
                .is_err(),
                "repository id {repository_id:?}"
            );
        }
        sweep(&db_path);
        sweep(&base_dir);
    }
    #[test]
    fn package_publish_rejects_unsafe_package_names() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).unwrap();
        conn.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-safe','safe','npm','HOSTING')",[]).unwrap();
        let base_dir = temp_dir("unsafe-name");
        for package_name in ["..", "..%2f", "/tmp/package-escape", "pkg/nested"] {
            assert!(
                publish_package_version_tx(
                    &conn,
                    &base_dir,
                    "repo-safe",
                    package_name,
                    "1.0.0",
                    None,
                    Some("pkg.tgz"),
                    Some(b"payload"),
                    None
                )
                .is_err(),
                "package name {package_name:?}"
            );
        }
        sweep(&db_path);
        sweep(&base_dir);
    }
    #[test]
    fn package_publish_rejects_unsafe_versions() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).unwrap();
        conn.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-safe','safe','npm','HOSTING')",[]).unwrap();
        let base_dir = temp_dir("unsafe-version");
        for version in ["..", "..%2f", "/tmp/package-escape", "1.0/nested"] {
            assert!(
                publish_package_version_tx(
                    &conn,
                    &base_dir,
                    "repo-safe",
                    "pkg",
                    version,
                    None,
                    Some("pkg.tgz"),
                    Some(b"payload"),
                    None
                )
                .is_err(),
                "version {version:?}"
            );
        }
        sweep(&db_path);
        sweep(&base_dir);
    }
    #[test]
    fn package_publish_rejects_unsafe_payload_filenames() {
        let db_path = temp_db();
        let conn = db::migrate_path(&db_path).unwrap();
        conn.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-safe','safe','npm','HOSTING')",[]).unwrap();
        let base_dir = temp_dir("unsafe-filename");
        for filename in ["..", "..%2f", "/tmp/package-escape", "payload/nested.tgz"] {
            assert!(
                publish_package_version_tx(
                    &conn,
                    &base_dir,
                    "repo-safe",
                    "pkg",
                    "1.0.0",
                    None,
                    Some(filename),
                    Some(b"payload"),
                    None
                )
                .is_err(),
                "payload filename {filename:?}"
            );
        }
        sweep(&db_path);
        sweep(&base_dir);
    }
}
