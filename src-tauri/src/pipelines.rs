#![allow(dead_code)]
//! Automation, deployment and package-registry persistence. Jobs are intentionally independent/parallel.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;
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
#[derive(Debug, Serialize, Deserialize)]
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
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PackageVersion {
    pub id: String,
    pub repository_id: String,
    pub package_name: String,
    pub version: String,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}
#[tauri::command]
pub fn list_pipeline_scripts(app: AppHandle) -> Result<Vec<PipelineScript>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,project_id,repository,path,source,archived FROM pipeline_scripts ORDER BY path").map_err(|e|e.to_string())?;
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
#[tauri::command]
pub fn create_pipeline_script(app: AppHandle, script: PipelineScript) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO pipeline_scripts(id,project_id,repository,path,source,archived)VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![script.id,script.project_id,script.repository,script.path,script.source,script.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_pipeline_script(app: AppHandle, script: PipelineScript) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("UPDATE pipeline_scripts SET project_id=?2,repository=?3,path=?4,source=?5,archived=?6 WHERE id=?1",rusqlite::params![script.id,script.project_id,script.repository,script.path,script.source,script.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_jobs(app: AppHandle) -> Result<Vec<Job>> {
    let c = db::connection(&app)?;
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
#[tauri::command]
pub fn list_job_runs(app: AppHandle) -> Result<Vec<JobRun>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,job_id,status,log,triggered_at,started_at,finished_at FROM job_runs ORDER BY triggered_at DESC").map_err(|e|e.to_string())?;
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
#[tauri::command]
pub fn list_deploy_targets(app: AppHandle) -> Result<Vec<DeployTarget>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,project_id,name,target_key,description,manual_control,archived FROM deploy_targets ORDER BY name").map_err(|e|e.to_string())?;
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
#[tauri::command]
pub fn list_package_repositories(app: AppHandle) -> Result<Vec<PackageRepository>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,project_id,name,format,mode,description,archived FROM package_repositories ORDER BY name").map_err(|e|e.to_string())?;
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
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
// TODO: DSL evaluation/runs, deployment state transitions and per-format package metadata.
