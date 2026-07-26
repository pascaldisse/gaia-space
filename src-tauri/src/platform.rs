//! Platform records: profiles, teams, roles, rights, scoped role assignments, projects.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub role_type: String,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Right {
    pub id: String,
    pub code: String,
    pub title: String,
    pub right_type: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct RoleAssignment {
    pub id: String,
    pub role_id: String,
    pub profile_id: Option<String>,
    pub team_id: Option<String>,
    pub scope_type: String,
    pub scope_id: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub key: String,
    pub description: Option<String>,
    pub created_by: Option<String>,
    pub archived: bool,
}

#[tauri::command]
pub fn list_profiles(app: AppHandle) -> Result<Vec<Profile>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare(
            "SELECT id,username,display_name,email,archived FROM profiles ORDER BY display_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Profile {
                id: r.get(0)?,
                username: r.get(1)?,
                display_name: r.get(2)?,
                email: r.get(3)?,
                archived: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_profile(app: AppHandle, id: String) -> Result<Option<Profile>> {
    Ok(list_profiles(app)?.into_iter().find(|x| x.id == id))
}
#[tauri::command]
pub fn create_profile(app: AppHandle, profile: Profile) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO profiles(id,username,display_name,email,archived,created_at)VALUES(?1,?2,?3,?4,?5,unixepoch())",rusqlite::params![profile.id,profile.username,profile.display_name,profile.email,profile.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_profile(app: AppHandle, profile: Profile) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute(
        "UPDATE profiles SET username=?2,display_name=?3,email=?4,archived=?5 WHERE id=?1",
        rusqlite::params![
            profile.id,
            profile.username,
            profile.display_name,
            profile.email,
            profile.archived
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_teams(app: AppHandle) -> Result<Vec<Team>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare("SELECT id,name,description,parent_id,archived FROM teams ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Team {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                parent_id: r.get(3)?,
                archived: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Project>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare("SELECT id,name,key,description,created_by,archived FROM projects ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                key: r.get(2)?,
                description: r.get(3)?,
                created_by: r.get(4)?,
                archived: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_project(app: AppHandle, id: String) -> Result<Option<Project>> {
    Ok(list_projects(app)?.into_iter().find(|x| x.id == id))
}
#[tauri::command]
pub fn create_project(app: AppHandle, project: Project) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,created_at)VALUES(?1,?2,?3,?4,?5,?6,unixepoch())",rusqlite::params![project.id,project.name,project.key,project.description,project.created_by,project.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_project(app: AppHandle, project: Project) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute(
        "UPDATE projects SET name=?2,key=?3,description=?4,created_by=?5,archived=?6 WHERE id=?1",
        rusqlite::params![
            project.id,
            project.name,
            project.key,
            project.description,
            project.created_by,
            project.archived
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_roles(app: AppHandle) -> Result<Vec<Role>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare("SELECT id,name,description,role_type,archived FROM roles ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Role {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                role_type: r.get(3)?,
                archived: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
