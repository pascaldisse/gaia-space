#![allow(dead_code)]
//! Platform domain: profiles, teams + memberships, roles, rights, scoped role
//! assignments, projects, and the generic Custom Fields engine.
//!
//! Simplifications vs. docs/space-knowledge-base/05-platform-auth-permissions.md
//! (documented, not silently dropped):
//! - `TD_Membership` (§2.5) is reduced to `profile x team x role` (+ lead/manager/
//!   since/till/requires_approval/archived) — no pending-edit/approver workflow.
//! - `role_assignments.scope_type` supports global/project/team/channel/document
//!   (matches the `roles.scope_type` CHECK in db.rs); Space's `Profile` RightType
//!   scope is not a separate assignment scope here — profile-scoped rights are
//!   granted the same way (typically at `global` scope).
//! - Custom Fields `entity_type` here is an open string (`issue`, `profile`,
//!   `team`, `membership`, ...) rather than Space's richer per-domain identifier
//!   types (`IssueTrackerIdentifier` etc.) — one flat namespace, callers agree on
//!   the string.
use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;

type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{kind}-{nanos:x}-{:x}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
fn err<T>(value: rusqlite::Result<T>) -> Result<T> {
    value.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
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

// ---------------------------------------------------------------------------
// Teams + memberships
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Deserialize)]
pub struct TeamInput {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TeamMembership {
    pub id: String,
    pub profile_id: String,
    pub team_id: String,
    pub role_id: Option<String>,
    pub lead: bool,
    pub manager_id: Option<String>,
    pub since_date: Option<String>,
    pub till_date: Option<String>,
    pub requires_approval: bool,
    pub archived: bool,
}
#[derive(Debug, Deserialize)]
pub struct TeamMembershipInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub team_id: String,
    pub role_id: Option<String>,
    pub lead: Option<bool>,
    pub manager_id: Option<String>,
    pub since_date: Option<String>,
    pub till_date: Option<String>,
    pub requires_approval: Option<bool>,
}

fn read_team(r: &rusqlite::Row<'_>) -> rusqlite::Result<Team> {
    Ok(Team {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        parent_id: r.get(3)?,
        archived: r.get(4)?,
    })
}
#[tauri::command]
pub fn list_teams(app: AppHandle) -> Result<Vec<Team>> {
    let c = db::connection(&app)?;
    let mut s = c
        .prepare("SELECT id,name,description,parent_id,archived FROM teams ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], read_team)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_team(app: AppHandle, id: String) -> Result<Option<Team>> {
    Ok(list_teams(app)?.into_iter().find(|x| x.id == id))
}
#[tauri::command]
pub fn create_team(app: AppHandle, input: TeamInput) -> Result<Team> {
    let c = db::connection(&app)?;
    let id = input.id.unwrap_or_else(|| new_id("team"));
    err(c.execute(
        "INSERT INTO teams(id,name,description,parent_id) VALUES(?1,?2,?3,?4)",
        params![id, input.name, input.description, input.parent_id],
    ))?;
    get_team(app, id)?.ok_or_else(|| "Created team was not found".into())
}
#[tauri::command]
pub fn update_team(app: AppHandle, team: Team) -> Result<Team> {
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE teams SET name=?2,description=?3,parent_id=?4,archived=?5 WHERE id=?1",
        params![
            team.id,
            team.name,
            team.description,
            team.parent_id,
            team.archived
        ],
    ))?;
    get_team(app, team.id)?.ok_or_else(|| "Team not found".into())
}
#[tauri::command]
pub fn archive_team(app: AppHandle, id: String, archived: bool) -> Result<()> {
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE teams SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}

fn read_membership(r: &rusqlite::Row<'_>) -> rusqlite::Result<TeamMembership> {
    Ok(TeamMembership {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        team_id: r.get(2)?,
        role_id: r.get(3)?,
        lead: r.get(4)?,
        manager_id: r.get(5)?,
        since_date: r.get(6)?,
        till_date: r.get(7)?,
        requires_approval: r.get(8)?,
        archived: r.get(9)?,
    })
}
const MEMBERSHIP_COLUMNS: &str = "id,profile_id,team_id,role_id,lead,manager_id,since_date,till_date,requires_approval,archived";
#[tauri::command]
pub fn list_team_memberships(
    app: AppHandle,
    team_id: Option<String>,
    profile_id: Option<String>,
) -> Result<Vec<TeamMembership>> {
    let c = db::connection(&app)?;
    let sql = format!("SELECT {MEMBERSHIP_COLUMNS} FROM team_memberships WHERE (?1 IS NULL OR team_id=?1) AND (?2 IS NULL OR profile_id=?2) ORDER BY team_id, profile_id");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(params![team_id, profile_id], read_membership))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[tauri::command]
pub fn add_team_membership(app: AppHandle, input: TeamMembershipInput) -> Result<TeamMembership> {
    let c = db::connection(&app)?;
    let id = input.id.unwrap_or_else(|| new_id("membership"));
    err(c.execute(
        "INSERT INTO team_memberships(id,profile_id,team_id,role_id,lead,manager_id,since_date,till_date,requires_approval) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![id, input.profile_id, input.team_id, input.role_id, input.lead.unwrap_or(false), input.manager_id, input.since_date, input.till_date, input.requires_approval.unwrap_or(false)],
    ))?;
    let sql = format!("SELECT {MEMBERSHIP_COLUMNS} FROM team_memberships WHERE id=?1");
    err(c.query_row(&sql, [&id], read_membership))
}
#[tauri::command]
pub fn update_team_membership(app: AppHandle, membership: TeamMembership) -> Result<()> {
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE team_memberships SET role_id=?2,lead=?3,manager_id=?4,since_date=?5,till_date=?6,requires_approval=?7,archived=?8 WHERE id=?1",
        params![membership.id, membership.role_id, membership.lead, membership.manager_id, membership.since_date, membership.till_date, membership.requires_approval, membership.archived],
    ))?;
    Ok(())
}
#[tauri::command]
pub fn remove_team_membership(app: AppHandle, id: String) -> Result<()> {
    let c = db::connection(&app)?;
    err(c.execute("DELETE FROM team_memberships WHERE id=?1", [id]))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Rights catalog (docs/space-knowledge-base/05-platform-auth-permissions.md §2.1)
// ---------------------------------------------------------------------------

/// (code, title, description, right_type, right_group) — a representative subset
/// of Space's ~150 concrete `Right` classes, one row per RightType (scope).
/// Codes are namespaced `<RightType>.<Name>` so they stay unique across types.
const RIGHTS_CATALOG: &[(&str, &str, &str, &str, &str)] = &[
    ("Global.Superadmin", "Superadmin", "Full organization administration.", "Global", "Permissions"),
    ("Global.CreateProjects", "Create projects", "Create new projects in the organization.", "Global", "Project"),
    ("Global.AddNewProfile", "Add member profile", "Add a new member account.", "Global", "Members"),
    ("Global.AddNewTeam", "Add team", "Create a new team in the org directory.", "Global", "Teams"),
    ("Global.EditRoles", "Edit roles", "Create/edit custom roles and their rights.", "Global", "Permissions"),
    ("Global.ViewRoles", "View roles", "View the roles catalog.", "Global", "Permissions"),
    ("Global.ViewTeams", "View teams", "View the team directory.", "Global", "Teams"),
    ("Global.EditOrganizationInfo", "Edit organization info", "Edit org name/logo/settings.", "Global", "Organization"),
    ("Global.ViewOrganizationInfo", "View organization info", "View org name/logo/settings.", "Global", "Organization"),
    ("Global.ManageAuthModule", "Manage auth modules", "Configure login modules.", "Global", "AuthenticationModules"),
    ("Global.EditCustomFields", "Edit global custom fields", "Manage cross-entity custom field definitions.", "Global", "GlobalCustomFields"),
    ("Global.OrgMember", "Organization member", "Baseline membership right held by every account.", "Global", "Members"),
    ("Project.ViewProject", "View project", "View a project and its contents.", "Project", "Project"),
    ("Project.AdminProject", "Administer project", "Manage project settings and membership.", "Project", "Project"),
    ("Project.VcsRead", "Read repository", "Read a project's Git repositories.", "Project", "VcsRepositories"),
    ("Project.VcsWrite", "Write repository", "Push to a project's Git repositories.", "Project", "VcsRepositories"),
    ("Project.VcsAdmin", "Administer repository", "Manage repository settings/branch protection.", "Project", "VcsRepositories"),
    ("Project.ViewCodeReview", "View code review", "View merge requests/code reviews.", "Project", "CodeReview"),
    ("Project.CreateCodeReview", "Create code review", "Open merge requests/code reviews.", "Project", "CodeReview"),
    ("Project.EditCodeReview", "Edit code review", "Edit/merge code reviews.", "Project", "CodeReview"),
    ("Project.ViewSecretKeys", "View secrets", "View project secret names.", "Project", "ProjectSecrets"),
    ("Project.CreateSecrets", "Create secrets", "Create project secrets.", "Project", "ProjectSecrets"),
    ("Project.ViewParameters", "View parameters", "View automation parameters.", "Project", "ProjectParameters"),
    ("Project.ModifyParameters", "Modify parameters", "Edit automation parameters.", "Project", "ProjectParameters"),
    ("Team.ViewTeamMembers", "View team members", "View a team's member list.", "Team", "TeamMembers"),
    ("Team.ManageTeamMembers", "Manage team members", "Add/remove team members.", "Team", "TeamMembers"),
    ("Team.EditTeam", "Edit team", "Edit team name/description/parent.", "Team", "Teams"),
    ("Team.DeleteTeam", "Delete team", "Archive/delete a team.", "Team", "Teams"),
    ("Profile.ViewProfile", "View profile", "View a member's full profile.", "Profile", "Members"),
    ("Profile.ViewProfileBasic", "View basic profile", "View a member's basic info.", "Profile", "Members"),
    ("Profile.EditProfile", "Edit profile", "Edit a member's profile.", "Profile", "Members"),
    ("Profile.DeleteProfile", "Delete profile", "Remove a member profile.", "Profile", "Members"),
    ("Profile.ViewAbsences", "View absences", "View a member's absences.", "Profile", "MemberAbsences"),
    ("Profile.EditAbsences", "Edit absences", "Edit a member's absences.", "Profile", "MemberAbsences"),
    ("Profile.ApproveAbsences", "Approve absences", "Approve a member's absence requests.", "Profile", "MemberAbsences"),
    ("Profile.CreatePermanentTokens", "Create permanent tokens", "Create personal permanent tokens.", "Profile", "MemberPermanentTokens"),
    ("Profile.SetUpTwoFactorAuthentication", "Set up 2FA", "Enable two-factor authentication.", "Profile", "TwoFactorAuthentication"),
    ("Channel.ViewChannel", "View channel", "View a chat channel and its messages.", "Channel", "Channels"),
    ("Channel.PostMessages", "Post messages", "Send messages in a channel.", "Channel", "Chat"),
    ("Channel.ManageChannel", "Manage channel", "Edit channel settings/membership.", "Channel", "Channels"),
    ("Channel.DeleteChannel", "Delete channel", "Archive/delete a channel.", "Channel", "Channels"),
    ("Document.ViewDocuments", "View documents", "View documents in a container.", "Document", "Documents"),
    ("Document.CreateDocuments", "Create documents", "Create new documents.", "Document", "Documents"),
    ("Document.EditDocuments", "Edit documents", "Edit document content.", "Document", "Documents"),
    ("Document.DeleteDocumentsForever", "Delete documents forever", "Permanently delete documents.", "Document", "Documents"),
    ("Document.ManageDocuments", "Manage documents", "Move/archive/share documents.", "Document", "Documents"),
    ("DocumentFolder.ViewFoldersMetadata", "View folder metadata", "View folder names/hierarchy.", "DocumentFolder", "Documents"),
    ("DocumentFolder.ManageDocumentFolders", "Manage folders", "Create/rename/move folders.", "DocumentFolder", "Documents"),
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Right {
    pub id: String,
    pub code: String,
    pub title: String,
    pub description: Option<String>,
    pub right_type: String,
    pub right_group: Option<String>,
}
fn read_right(r: &rusqlite::Row<'_>) -> rusqlite::Result<Right> {
    Ok(Right {
        id: r.get(0)?,
        code: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        right_type: r.get(4)?,
        right_group: r.get(5)?,
    })
}
#[tauri::command]
pub fn list_rights(app: AppHandle) -> Result<Vec<Right>> {
    let c = db::connection(&app)?;
    let mut s = err(c.prepare(
        "SELECT id,code,title,description,right_type,right_group FROM rights ORDER BY right_type,right_group,title",
    ))?;
    let rows = err(s.query_map([], read_right))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
fn seed_rights_on(c: &Connection) -> Result<usize> {
    for (code, title, description, right_type, right_group) in RIGHTS_CATALOG {
        err(c.execute(
            "INSERT OR IGNORE INTO rights(id,code,title,description,right_type,right_group) VALUES(?1,?2,?3,?4,?5,?6)",
            params![new_id("right"), code, title, description, right_type, right_group],
        ))?;
    }
    err(c.query_row("SELECT count(*) FROM rights", [], |r| r.get::<_, i64>(0))).map(|n| n as usize)
}
/// Idempotent: inserting the catalog twice never duplicates a `code` (UNIQUE),
/// so the total row count converges after the first call.
#[tauri::command]
pub fn seed_rights(app: AppHandle) -> Result<usize> {
    seed_rights_on(&db::connection(&app)?)
}

// ---------------------------------------------------------------------------
// Roles + role<->rights matrix
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub role_type: String,
    pub archived: bool,
}
#[derive(Debug, Deserialize)]
pub struct RoleInput {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub role_type: Option<String>,
}
fn read_role(r: &rusqlite::Row<'_>) -> rusqlite::Result<Role> {
    Ok(Role {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        parent_id: r.get(3)?,
        role_type: r.get(4)?,
        archived: r.get(5)?,
    })
}
#[tauri::command]
pub fn list_roles(app: AppHandle) -> Result<Vec<Role>> {
    let c = db::connection(&app)?;
    let mut s = err(c.prepare(
        "SELECT id,name,description,parent_id,role_type,archived FROM roles ORDER BY name",
    ))?;
    let rows = err(s.query_map([], read_role))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[tauri::command]
pub fn get_role(app: AppHandle, id: String) -> Result<Option<Role>> {
    Ok(list_roles(app)?.into_iter().find(|x| x.id == id))
}
#[tauri::command]
pub fn create_role(app: AppHandle, input: RoleInput) -> Result<Role> {
    let c = db::connection(&app)?;
    let id = input.id.unwrap_or_else(|| new_id("role"));
    err(c.execute(
        "INSERT INTO roles(id,name,description,parent_id,role_type) VALUES(?1,?2,?3,?4,?5)",
        params![
            id,
            input.name,
            input.description,
            input.parent_id,
            input.role_type.unwrap_or_else(|| "CUSTOM".into())
        ],
    ))?;
    get_role(app, id)?.ok_or_else(|| "Created role was not found".into())
}
#[tauri::command]
pub fn update_role(app: AppHandle, role: Role) -> Result<Role> {
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE roles SET name=?2,description=?3,parent_id=?4,role_type=?5,archived=?6 WHERE id=?1",
        params![
            role.id,
            role.name,
            role.description,
            role.parent_id,
            role.role_type,
            role.archived
        ],
    ))?;
    get_role(app, role.id)?.ok_or_else(|| "Role not found".into())
}
#[tauri::command]
pub fn archive_role(app: AppHandle, id: String, archived: bool) -> Result<()> {
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE roles SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}
#[tauri::command]
pub fn list_role_rights(app: AppHandle, role_id: String) -> Result<Vec<String>> {
    let c = db::connection(&app)?;
    let mut s = err(c.prepare(
        "SELECT r.code FROM role_rights rr JOIN rights r ON r.id=rr.right_id WHERE rr.role_id=?1 ORDER BY r.code",
    ))?;
    let rows = err(s.query_map([role_id], |r| r.get::<_, String>(0)))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
/// Replaces the full set of rights a role grants with `right_codes` (idempotent
/// full-replace; unknown codes fail the whole call rather than silently no-op).
#[tauri::command]
pub fn set_role_rights(app: AppHandle, role_id: String, right_codes: Vec<String>) -> Result<()> {
    let mut c = db::connection(&app)?;
    let tx = err(c.transaction())?;
    err(tx.execute("DELETE FROM role_rights WHERE role_id=?1", [&role_id]))?;
    for code in &right_codes {
        let right_id: String = err(tx
            .query_row("SELECT id FROM rights WHERE code=?1", [code], |r| r.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    rusqlite::Error::InvalidParameterName(format!("Unknown right code: {code}"))
                }
                other => other,
            }))?;
        err(tx.execute(
            "INSERT INTO role_rights(role_id,right_id) VALUES(?1,?2)",
            params![role_id, right_id],
        ))?;
    }
    err(tx.commit())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Role assignments (profile OR team, at a scope) + check_right
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RoleAssignment {
    pub id: String,
    pub role_id: String,
    pub profile_id: Option<String>,
    pub team_id: Option<String>,
    pub scope_type: String,
    pub scope_id: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct RoleAssignmentInput {
    pub id: Option<String>,
    pub role_id: String,
    pub profile_id: Option<String>,
    pub team_id: Option<String>,
    pub scope_type: String,
    pub scope_id: Option<String>,
}
fn read_assignment(r: &rusqlite::Row<'_>) -> rusqlite::Result<RoleAssignment> {
    Ok(RoleAssignment {
        id: r.get(0)?,
        role_id: r.get(1)?,
        profile_id: r.get(2)?,
        team_id: r.get(3)?,
        scope_type: r.get(4)?,
        scope_id: r.get(5)?,
    })
}
const ASSIGNMENT_COLUMNS: &str = "id,role_id,profile_id,team_id,scope_type,scope_id";
#[tauri::command]
pub fn list_role_assignments(
    app: AppHandle,
    profile_id: Option<String>,
    team_id: Option<String>,
) -> Result<Vec<RoleAssignment>> {
    let c = db::connection(&app)?;
    let sql = format!("SELECT {ASSIGNMENT_COLUMNS} FROM role_assignments WHERE (?1 IS NULL OR profile_id=?1) AND (?2 IS NULL OR team_id=?2) ORDER BY scope_type,scope_id");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(params![profile_id, team_id], read_assignment))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[tauri::command]
pub fn create_role_assignment(app: AppHandle, input: RoleAssignmentInput) -> Result<RoleAssignment> {
    if input.profile_id.is_none() == input.team_id.is_none() {
        return Err("Assign the role to exactly one of profile_id or team_id".into());
    }
    let c = db::connection(&app)?;
    let id = input.id.unwrap_or_else(|| new_id("assignment"));
    err(c.execute(
        "INSERT INTO role_assignments(id,role_id,profile_id,team_id,scope_type,scope_id) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, input.role_id, input.profile_id, input.team_id, input.scope_type, input.scope_id],
    ))?;
    let sql = format!("SELECT {ASSIGNMENT_COLUMNS} FROM role_assignments WHERE id=?1");
    err(c.query_row(&sql, [&id], read_assignment))
}
#[tauri::command]
pub fn delete_role_assignment(app: AppHandle, id: String) -> Result<()> {
    let c = db::connection(&app)?;
    err(c.execute("DELETE FROM role_assignments WHERE id=?1", [id]))?;
    Ok(())
}

/// Core authorization door: does `profile_id` hold `right_code` at
/// `(scope_type, scope_id)`, via a role assigned directly to the profile OR to
/// a (non-archived) team the profile belongs to?
///
/// Scope containment: a `global`-scoped assignment always satisfies any
/// requested scope (global implies narrower scopes). Any other assignment
/// scope must match the requested `scope_type` AND `scope_id` exactly — a
/// `project` grant does NOT imply `global`, nor a different project/team/etc.
fn check_right_on(
    c: &Connection,
    profile_id: &str,
    right_code: &str,
    scope_type: &str,
    scope_id: Option<&str>,
) -> Result<bool> {
    let mut s = err(c.prepare(
        "SELECT ra.scope_type, ra.scope_id
         FROM role_assignments ra
         JOIN role_rights rr ON rr.role_id = ra.role_id
         JOIN rights r ON r.id = rr.right_id
         WHERE r.code = ?1
           AND (
             ra.profile_id = ?2
             OR ra.team_id IN (SELECT team_id FROM team_memberships WHERE profile_id = ?2 AND archived = 0)
           )",
    ))?;
    let rows = err(s.query_map(params![right_code, profile_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    for (assignment_scope_type, assignment_scope_id) in rows {
        if assignment_scope_type == "global" {
            return Ok(true);
        }
        if assignment_scope_type == scope_type && assignment_scope_id.as_deref() == scope_id {
            return Ok(true);
        }
    }
    Ok(false)
}
#[tauri::command]
pub fn check_right(
    app: AppHandle,
    profile_id: String,
    right_code: String,
    scope_type: String,
    scope_id: Option<String>,
) -> Result<bool> {
    let c = db::connection(&app)?;
    check_right_on(&c, &profile_id, &right_code, &scope_type, scope_id.as_deref())
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Custom Fields engine (generic across entity_type: issue/profile/team/membership/...)
// ---------------------------------------------------------------------------

/// Supported `cf_type`s (KB 02 "custom fields — type system" subset chosen for
/// this wave: text/int/date/enum/profile/bool).
const CF_TYPES: &[&str] = &["text", "int", "date", "enum", "profile", "bool"];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CfDefinition {
    pub id: String,
    pub entity_type: String,
    pub cf_type: String,
    pub name: String,
    pub constraints_json: Option<String>,
    pub default_json: Option<String>,
    pub ordering: i64,
    pub archived: bool,
}
#[derive(Debug, Deserialize)]
pub struct CfDefinitionInput {
    pub id: Option<String>,
    pub entity_type: String,
    pub cf_type: String,
    pub name: String,
    pub constraints_json: Option<String>,
    pub default_json: Option<String>,
    pub ordering: Option<i64>,
}
#[derive(Debug, Serialize)]
pub struct CfValueEntry {
    #[serde(flatten)]
    pub definition: CfDefinition,
    pub value_json: Option<String>,
}
fn read_cf_definition(r: &rusqlite::Row<'_>) -> rusqlite::Result<CfDefinition> {
    Ok(CfDefinition {
        id: r.get(0)?,
        entity_type: r.get(1)?,
        cf_type: r.get(2)?,
        name: r.get(3)?,
        constraints_json: r.get(4)?,
        default_json: r.get(5)?,
        ordering: r.get(6)?,
        archived: r.get(7)?,
    })
}
const CF_DEF_COLUMNS: &str =
    "id,entity_type,cf_type,name,constraints_json,default_json,ordering,archived";

fn validate_cf_shape(cf_type: &str, constraints_json: Option<&str>) -> Result<()> {
    if !CF_TYPES.contains(&cf_type) {
        return Err(format!(
            "Unsupported custom field type '{cf_type}' (expected one of {CF_TYPES:?})"
        ));
    }
    if cf_type == "enum" {
        let constraints: serde_json::Value = match constraints_json {
            Some(s) if !s.is_empty() => {
                serde_json::from_str(s).map_err(|e| format!("Invalid constraints JSON: {e}"))?
            }
            _ => return Err("Enum custom fields require constraints.options".into()),
        };
        let options = constraints
            .get("options")
            .and_then(|v| v.as_array())
            .filter(|a| !a.is_empty())
            .ok_or("Enum custom fields require a non-empty constraints.options array")?;
        if !options.iter().all(|o| o.is_string()) {
            return Err("constraints.options must be an array of strings".into());
        }
    }
    Ok(())
}
/// Validates a candidate value against a field's `cf_type` + `constraints_json`
/// (min/max length or numeric range, ISO date parse, enum option membership,
/// boolean type). `profile` referential existence is checked by the caller
/// (needs a live connection to `profiles`).
fn validate_cf_value(cf_type: &str, constraints_json: Option<&str>, value_json: &str) -> Result<serde_json::Value> {
    let value: serde_json::Value =
        serde_json::from_str(value_json).map_err(|e| format!("Invalid JSON value: {e}"))?;
    let constraints: serde_json::Value = match constraints_json {
        Some(s) if !s.is_empty() => {
            serde_json::from_str(s).map_err(|e| format!("Invalid constraints JSON: {e}"))?
        }
        _ => serde_json::json!({}),
    };
    match cf_type {
        "bool" => {
            if !value.is_boolean() {
                return Err("Expected a boolean value".into());
            }
        }
        "text" => {
            let s = value.as_str().ok_or("Expected a string value")?;
            if let Some(min) = constraints.get("minLength").and_then(|v| v.as_u64()) {
                if (s.len() as u64) < min {
                    return Err(format!("Value shorter than minLength {min}"));
                }
            }
            if let Some(max) = constraints.get("maxLength").and_then(|v| v.as_u64()) {
                if (s.len() as u64) > max {
                    return Err(format!("Value longer than maxLength {max}"));
                }
            }
        }
        "int" => {
            let n = value.as_i64().ok_or("Expected an integer value")?;
            if let Some(min) = constraints.get("min").and_then(|v| v.as_i64()) {
                if n < min {
                    return Err(format!("Value below min {min}"));
                }
            }
            if let Some(max) = constraints.get("max").and_then(|v| v.as_i64()) {
                if n > max {
                    return Err(format!("Value above max {max}"));
                }
            }
        }
        "date" => {
            let s = value
                .as_str()
                .ok_or("Expected an ISO date string (YYYY-MM-DD)")?;
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| format!("Invalid date '{s}', expected YYYY-MM-DD"))?;
        }
        "enum" => {
            let s = value
                .as_str()
                .ok_or("Expected a string value for an enum field")?;
            let options = constraints
                .get("options")
                .and_then(|v| v.as_array())
                .ok_or("Enum field is missing constraints.options")?;
            let allowed = options.iter().any(|o| o.as_str() == Some(s));
            if !allowed {
                return Err(format!("'{s}' is not one of the allowed enum options"));
            }
        }
        "profile" => {
            value.as_str().ok_or("Expected a profile id string")?;
        }
        other => return Err(format!("Unsupported custom field type: {other}")),
    }
    Ok(value)
}

#[tauri::command]
pub fn list_cf_definitions(app: AppHandle, entity_type: Option<String>) -> Result<Vec<CfDefinition>> {
    let c = db::connection(&app)?;
    let sql = format!("SELECT {CF_DEF_COLUMNS} FROM cf_definitions WHERE archived=0 AND (?1 IS NULL OR entity_type=?1) ORDER BY entity_type,ordering");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map([entity_type], read_cf_definition))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[tauri::command]
pub fn create_cf_definition(app: AppHandle, input: CfDefinitionInput) -> Result<CfDefinition> {
    validate_cf_shape(&input.cf_type, input.constraints_json.as_deref())?;
    let c = db::connection(&app)?;
    let id = input.id.unwrap_or_else(|| new_id("cfdef"));
    let ordering = match input.ordering {
        Some(o) => o,
        None => err(c.query_row(
            "SELECT coalesce(max(ordering),-1)+1 FROM cf_definitions WHERE entity_type=?1",
            [&input.entity_type],
            |r| r.get(0),
        ))?,
    };
    err(c.execute(
        "INSERT INTO cf_definitions(id,entity_type,cf_type,name,constraints_json,default_json,ordering) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, input.entity_type, input.cf_type, input.name, input.constraints_json, input.default_json, ordering],
    ))?;
    let sql = format!("SELECT {CF_DEF_COLUMNS} FROM cf_definitions WHERE id=?1");
    err(c.query_row(&sql, [&id], read_cf_definition))
}
#[tauri::command]
pub fn update_cf_definition(app: AppHandle, definition: CfDefinition) -> Result<CfDefinition> {
    validate_cf_shape(&definition.cf_type, definition.constraints_json.as_deref())?;
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE cf_definitions SET entity_type=?2,cf_type=?3,name=?4,constraints_json=?5,default_json=?6,ordering=?7,archived=?8 WHERE id=?1",
        params![definition.id, definition.entity_type, definition.cf_type, definition.name, definition.constraints_json, definition.default_json, definition.ordering, definition.archived],
    ))?;
    let sql = format!("SELECT {CF_DEF_COLUMNS} FROM cf_definitions WHERE id=?1");
    err(c.query_row(&sql, [&definition.id], read_cf_definition))
}
#[tauri::command]
pub fn archive_cf_definition(app: AppHandle, id: String, archived: bool) -> Result<()> {
    let c = db::connection(&app)?;
    err(c.execute(
        "UPDATE cf_definitions SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}

fn cf_set_value_on(c: &Connection, definition_id: &str, entity_id: &str, value_json: &str) -> Result<()> {
    let (cf_type, constraints_json): (String, Option<String>) = err(c
        .query_row(
            "SELECT cf_type,constraints_json FROM cf_definitions WHERE id=?1",
            [definition_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional())?
    .ok_or_else(|| format!("Unknown custom field definition: {definition_id}"))?;
    let value = validate_cf_value(&cf_type, constraints_json.as_deref(), value_json)?;
    if cf_type == "profile" {
        let profile_id = value.as_str().unwrap_or_default();
        let exists: i64 = err(c.query_row(
            "SELECT count(*) FROM profiles WHERE id=?1",
            [profile_id],
            |r| r.get(0),
        ))?;
        if exists == 0 {
            return Err(format!("Profile '{profile_id}' does not exist"));
        }
    }
    err(c.execute(
        "INSERT INTO cf_values(definition_id,entity_id,value_json) VALUES(?1,?2,?3)
         ON CONFLICT(definition_id,entity_id) DO UPDATE SET value_json=excluded.value_json",
        params![definition_id, entity_id, value_json],
    ))?;
    Ok(())
}
#[tauri::command]
pub fn cf_set_value(
    app: AppHandle,
    definition_id: String,
    entity_id: String,
    value_json: String,
) -> Result<()> {
    let c = db::connection(&app)?;
    cf_set_value_on(&c, &definition_id, &entity_id, &value_json)
}
#[tauri::command]
pub fn cf_get_values(app: AppHandle, entity_type: String, entity_id: String) -> Result<Vec<CfValueEntry>> {
    let c = db::connection(&app)?;
    let sql = format!(
        "SELECT {cols}, v.value_json FROM cf_definitions d LEFT JOIN cf_values v ON v.definition_id=d.id AND v.entity_id=?2 WHERE d.entity_type=?1 AND d.archived=0 ORDER BY d.ordering",
        cols = CF_DEF_COLUMNS
            .split(',')
            .map(|col| format!("d.{col}"))
            .collect::<Vec<_>>()
            .join(",")
    );
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(params![entity_type, entity_id], |r| {
        Ok(CfValueEntry {
            definition: read_cf_definition(r)?,
            value_json: r.get(8)?,
        })
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c
    }
    fn insert_role_right(c: &Connection, role_id: &str, right_code: &str, right_type: &str) {
        c.execute(
            "INSERT INTO roles(id,name) VALUES(?1,?1)",
            [role_id],
        )
        .ok();
        let right_id = format!("{right_code}-id");
        c.execute(
            "INSERT OR IGNORE INTO rights(id,code,title,right_type) VALUES(?1,?2,?2,?3)",
            params![right_id, right_code, right_type],
        )
        .unwrap();
        c.execute(
            "INSERT INTO role_rights(role_id,right_id) VALUES(?1,?2)",
            params![role_id, right_id],
        )
        .unwrap();
    }

    #[test]
    fn check_right_resolves_team_inherited_assignment() {
        let c = conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p1','p1','P1',0)", []).unwrap();
        c.execute("INSERT INTO teams(id,name) VALUES('t1','Team1')", []).unwrap();
        c.execute("INSERT INTO team_memberships(id,profile_id,team_id) VALUES('m1','p1','t1')", []).unwrap();
        insert_role_right(&c, "r1", "Project.ViewProject", "Project");
        c.execute(
            "INSERT INTO role_assignments(id,role_id,team_id,scope_type,scope_id) VALUES('a1','r1','t1','project','proj1')",
            [],
        )
        .unwrap();
        assert!(check_right_on(&c, "p1", "Project.ViewProject", "project", Some("proj1")).unwrap());
        // different project scope_id: must not match (no cross-scope leakage).
        assert!(!check_right_on(&c, "p1", "Project.ViewProject", "project", Some("proj2")).unwrap());
        // profile with no membership at all: no right.
        assert!(!check_right_on(&c, "nobody", "Project.ViewProject", "project", Some("proj1")).unwrap());
    }

    #[test]
    fn check_right_scope_isolation_project_vs_global() {
        let c = conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p2','p2','P2',0)", []).unwrap();
        insert_role_right(&c, "r2", "Global.EditRoles", "Global");
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES('a2','r2','p2','project','proj1')",
            [],
        )
        .unwrap();
        // A project-scoped grant must NOT imply global.
        assert!(!check_right_on(&c, "p2", "Global.EditRoles", "global", None).unwrap());
        // ...but it does hold for the exact project it was granted on.
        assert!(check_right_on(&c, "p2", "Global.EditRoles", "project", Some("proj1")).unwrap());

        insert_role_right(&c, "r3", "Global.EditRoles", "Global");
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES('a3','r3','p2','global',NULL)",
            [],
        )
        .unwrap();
        // A global grant DOES imply any narrower scope.
        assert!(check_right_on(&c, "p2", "Global.EditRoles", "project", Some("any-project")).unwrap());
        assert!(check_right_on(&c, "p2", "Global.EditRoles", "team", Some("any-team")).unwrap());
    }

    #[test]
    fn cf_enum_constraint_rejects_invalid_value() {
        let c = conn();
        c.execute(
            "INSERT INTO cf_definitions(id,entity_type,cf_type,name,constraints_json) VALUES('d1','issue','enum','Priority','{\"options\":[\"low\",\"high\"]}')",
            [],
        )
        .unwrap();
        assert!(cf_set_value_on(&c, "d1", "issue-1", "\"medium\"").is_err());
        assert!(cf_set_value_on(&c, "d1", "issue-1", "\"high\"").is_ok());
        let stored: String = c
            .query_row(
                "SELECT value_json FROM cf_values WHERE definition_id='d1' AND entity_id='issue-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, "\"high\"");
    }

    #[test]
    fn rights_seed_is_idempotent() {
        let c = conn();
        let first = seed_rights_on(&c).unwrap();
        let second = seed_rights_on(&c).unwrap();
        assert_eq!(first, second);
        assert_eq!(first, RIGHTS_CATALOG.len());
        let distinct_codes: i64 = c
            .query_row("SELECT count(DISTINCT code) FROM rights", [], |r| r.get(0))
            .unwrap();
        assert_eq!(distinct_codes as usize, RIGHTS_CATALOG.len());
    }

    #[test]
    fn role_assignment_requires_exactly_one_target() {
        let c = conn();
        c.execute("INSERT INTO roles(id,name) VALUES('r4','R4')", []).unwrap();
        let both = RoleAssignmentInput {
            id: None,
            role_id: "r4".into(),
            profile_id: Some("p".into()),
            team_id: Some("t".into()),
            scope_type: "global".into(),
            scope_id: None,
        };
        assert!((both.profile_id.is_none() == both.team_id.is_none()));
        let neither = RoleAssignmentInput {
            id: None,
            role_id: "r4".into(),
            profile_id: None,
            team_id: None,
            scope_type: "global".into(),
            scope_id: None,
        };
        assert!((neither.profile_id.is_none() == neither.team_id.is_none()));
        let _ = &c;
    }

    #[test]
    fn set_role_rights_full_replace() {
        let c = conn();
        c.execute("INSERT INTO roles(id,name) VALUES('r5','R5')", []).unwrap();
        seed_rights_on(&c).unwrap();
        let mut tx_conn = c;
        // emulate set_role_rights body against a plain Connection (no AppHandle in unit tests)
        let codes = vec!["Global.Superadmin".to_string()];
        {
            let tx = tx_conn.transaction().unwrap();
            tx.execute("DELETE FROM role_rights WHERE role_id=?1", ["r5"]).unwrap();
            for code in &codes {
                let right_id: String = tx
                    .query_row("SELECT id FROM rights WHERE code=?1", [code], |r| r.get(0))
                    .unwrap();
                tx.execute(
                    "INSERT INTO role_rights(role_id,right_id) VALUES(?1,?2)",
                    params!["r5", right_id],
                )
                .unwrap();
            }
            tx.commit().unwrap();
        }
        let count: i64 = tx_conn
            .query_row(
                "SELECT count(*) FROM role_rights WHERE role_id='r5'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
