//! Server-side Git hosting: durable metadata plus bare repositories below the data root.
use crate::db;
use git2::Repository;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize)]
pub struct HostedRepository {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub default_branch: String,
    pub created_at: i64,
    pub created_by: Option<String>,
}

pub fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub fn hosted_repo_path(data_dir: &Path, project_id: &str, name: &str) -> Result<PathBuf> {
    if !valid_name(project_id) || !valid_name(name) {
        return Err("project and repository names must match [A-Za-z0-9._-]+".into());
    }
    Ok(data_dir
        .join("git")
        .join(project_id)
        .join(format!("{name}.git")))
}

fn make_id() -> String {
    format!("git-{}-{:016x}", std::process::id(), rand::random::<u64>())
}

fn create_at(
    conn: &Connection,
    data_dir: &Path,
    project_id: &str,
    name: &str,
    description: Option<String>,
    default_branch: &str,
) -> Result<HostedRepository> {
    if !valid_name(project_id) || !valid_name(name) || !valid_name(default_branch) {
        return Err(
            "project, repository, and default branch names must match [A-Za-z0-9._-]+".into(),
        );
    }
    let path = hosted_repo_path(data_dir, project_id, name)?;
    if path.exists() {
        return Err(format!(
            "hosted repository already exists: {}",
            path.display()
        ));
    }
    let owner: Option<String> = conn
        .query_row(
            "SELECT created_by FROM projects WHERE id=?1",
            [project_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project not found: {project_id}"))?;
    std::fs::create_dir_all(path.parent().expect("bare repository parent"))
        .map_err(|e| e.to_string())?;
    let repo = Repository::init_bare(&path).map_err(|e| e.to_string())?;
    repo.set_head(&format!("refs/heads/{default_branch}"))
        .map_err(|e| e.to_string())?;
    let row = HostedRepository {
        id: make_id(),
        project_id: project_id.into(),
        name: name.into(),
        description,
        default_branch: default_branch.into(),
        created_at: chrono::Utc::now().timestamp(),
        created_by: owner,
    };
    if let Err(e) = conn.execute("INSERT INTO hosted_repositories(id,project_id,name,description,default_branch,created_at,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![row.id,row.project_id,row.name,row.description,row.default_branch,row.created_at,row.created_by]) {
        let _ = std::fs::remove_dir_all(&path);
        return Err(e.to_string());
    }
    Ok(row)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_hosted_repo(
    project_id: String,
    name: String,
    description: Option<String>,
    default_branch: String,
) -> Result<HostedRepository> {
    let conn = db::conn()?;
    create_at(
        &conn,
        &db::data_dir()?,
        &project_id,
        &name,
        description,
        &default_branch,
    )
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_hosted_repos(project_id: String) -> Result<Vec<HostedRepository>> {
    let conn = db::conn()?;
    let mut statement = conn.prepare("SELECT id,project_id,name,description,default_branch,created_at,created_by FROM hosted_repositories WHERE project_id=?1 ORDER BY name").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([project_id], |r| {
            Ok(HostedRepository {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                description: r.get(3)?,
                default_branch: r.get(4)?,
                created_at: r.get(5)?,
                created_by: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_hosted_repo(id: String) -> Result<()> {
    let conn = db::conn()?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT project_id,name FROM hosted_repositories WHERE id=?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((project_id, name)) = row else {
        return Err(format!("hosted repository not found: {id}"));
    };
    let path = hosted_repo_path(&db::data_dir()?, &project_id, &name)?;
    std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM hosted_repositories WHERE id=?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn hosted_repo_clone_url(base_url: String, project: String, name: String) -> Result<String> {
    if !valid_name(&project) || !valid_name(&name) {
        return Err("project and repository names must match [A-Za-z0-9._-]+".into());
    }
    Ok(format!(
        "{}/git/{project}/{name}.git",
        base_url.trim_end_matches('/')
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_bare_repo_with_requested_head_and_rejects_bad_names() {
        let db = crate::db::TempDb::new("git-hosting");
        let conn = crate::db::open_at(db.path()).unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects(id,name,key,created_at) VALUES('project','Project','P',1)",
            [],
        )
        .unwrap();
        let data = db.path().parent().unwrap().join("data");
        let created = create_at(&conn, &data, "project", "repo", None, "main").unwrap();
        let repo =
            Repository::open_bare(hosted_repo_path(&data, "project", "repo").unwrap()).unwrap();
        assert_eq!(
            repo.find_reference("HEAD")
                .unwrap()
                .symbolic_target()
                .unwrap(),
            Some("refs/heads/main")
        );
        assert_eq!(created.name, "repo");
        assert!(!valid_name("../escape"));
    }
}
