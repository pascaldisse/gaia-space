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
use crate::{db, rights};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

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

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_profiles() -> Result<Vec<Profile>> {
    let c = db::conn()?;
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_profile(id: String) -> Result<Option<Profile>> {
    Ok(list_profiles()?.into_iter().find(|x| x.id == id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_profile(profile: Profile) -> Result<()> {
    let c = db::conn()?;
    c.execute("INSERT INTO profiles(id,username,display_name,email,archived,created_at)VALUES(?1,?2,?3,?4,?5,unixepoch())",rusqlite::params![profile.id,profile.username,profile.display_name,profile.email,profile.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_profile(profile: Profile) -> Result<()> {
    let c = db::conn()?;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemberLocation {
    pub id: String,
    pub profile_id: String,
    pub location: String,
    pub location_type: String,
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_member_locations(profile_id: Option<String>) -> Result<Vec<MemberLocation>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,profile_id,location,type FROM member_locations WHERE (?1 IS NULL OR profile_id=?1) ORDER BY location")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([profile_id], |r| {
            Ok(MemberLocation {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                location: r.get(2)?,
                location_type: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_member_location(
    member_id: String,
    location: String,
    location_type: String,
) -> Result<MemberLocation> {
    let location = location.trim().to_string();
    if location.is_empty() {
        return Err("A location is required".into());
    }
    if ![
        "Region",
        "Campus",
        "Building",
        "Floor",
        "Room",
        "ConferenceRoom",
    ]
    .contains(&location_type.as_str())
    {
        return Err("Invalid location type".into());
    }
    let value = MemberLocation {
        id: new_id("member-location"),
        profile_id: member_id,
        location,
        location_type,
    };
    let c = db::conn()?;
    c.execute(
        "INSERT INTO member_locations(id,profile_id,location,type) VALUES(?1,?2,?3,?4)",
        params![
            value.id,
            value.profile_id,
            value.location,
            value.location_type
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(value)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_member_location(id: String) -> Result<()> {
    let c = db::conn()?;
    c.execute("DELETE FROM member_locations WHERE id=?1", [id])
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_teams() -> Result<Vec<Team>> {
    let c = db::conn()?;
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_team(id: String) -> Result<Option<Team>> {
    Ok(list_teams()?.into_iter().find(|x| x.id == id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_team(input: TeamInput) -> Result<Team> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("team"));
    err(c.execute(
        "INSERT INTO teams(id,name,description,parent_id) VALUES(?1,?2,?3,?4)",
        params![id, input.name, input.description, input.parent_id],
    ))?;
    get_team(id)?.ok_or_else(|| "Created team was not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_team(team: Team) -> Result<Team> {
    let c = db::conn()?;
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
    get_team(team.id)?.ok_or_else(|| "Team not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_team(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
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
const MEMBERSHIP_COLUMNS: &str =
    "id,profile_id,team_id,role_id,lead,manager_id,since_date,till_date,requires_approval,archived";
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_team_memberships(
    team_id: Option<String>,
    profile_id: Option<String>,
) -> Result<Vec<TeamMembership>> {
    let c = db::conn()?;
    let sql = format!("SELECT {MEMBERSHIP_COLUMNS} FROM team_memberships WHERE (?1 IS NULL OR team_id=?1) AND (?2 IS NULL OR profile_id=?2) ORDER BY team_id, profile_id");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(params![team_id, profile_id], read_membership))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_team_membership(input: TeamMembershipInput) -> Result<TeamMembership> {
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("membership"));
    err(c.execute(
        "INSERT INTO team_memberships(id,profile_id,team_id,role_id,lead,manager_id,since_date,till_date,requires_approval) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![id, input.profile_id, input.team_id, input.role_id, input.lead.unwrap_or(false), input.manager_id, input.since_date, input.till_date, input.requires_approval.unwrap_or(false)],
    ))?;
    let sql = format!("SELECT {MEMBERSHIP_COLUMNS} FROM team_memberships WHERE id=?1");
    err(c.query_row(&sql, [&id], read_membership))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_team_membership(membership: TeamMembership) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE team_memberships SET role_id=?2,lead=?3,manager_id=?4,since_date=?5,till_date=?6,requires_approval=?7,archived=?8 WHERE id=?1",
        params![membership.id, membership.role_id, membership.lead, membership.manager_id, membership.since_date, membership.till_date, membership.requires_approval, membership.archived],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_team_membership(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM team_memberships WHERE id=?1", [id]))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Rights catalog (docs/space-knowledge-base/05-platform-auth-permissions.md §2.1)
// ---------------------------------------------------------------------------

/// (code, title, description, right_type, right_group) — a representative subset
/// of Space's ~150 concrete `Right` classes, one row per RightType (scope).
/// Codes are namespaced `<RightType>.<Name>` so they stay unique across types.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Right {
    pub id: String,
    pub code: String,
    pub title: String,
    pub description: Option<String>,
    pub right_type: String,
    pub right_group: Option<String>,
    /// Bit flags, transitive dependencies, feature gate, scope propagation and
    /// opaque descriptor metadata compose the complete Right descriptor.
    pub flags: u32,
    pub implied_rights: Vec<String>,
    pub feature_gate: Option<String>,
    pub propagation: String,
    pub descriptor: serde_json::Value,
}
fn read_right(r: &rusqlite::Row<'_>) -> rusqlite::Result<Right> {
    Ok(Right {
        id: r.get(0)?,
        code: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        right_type: r.get(4)?,
        right_group: r.get(5)?,
        flags: r.get(6)?,
        implied_rights: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_default(),
        feature_gate: r.get(8)?,
        propagation: r.get(9)?,
        descriptor: serde_json::from_str(&r.get::<_, String>(10)?)
            .unwrap_or(serde_json::Value::Null),
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_rights() -> Result<Vec<Right>> {
    let c = db::conn()?;
    let mut s = err(c.prepare(
        "SELECT id,code,title,description,right_type,right_group,flags,implied_rights_json,feature_gate,propagation,descriptor_json FROM rights ORDER BY right_type,right_group,title",
    ))?;
    let rows = err(s.query_map([], read_right))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
/// KB §05 §2.1 `RightGroup`. The catalog stores a group *code* per right; this is the
/// registry that gives that code a title and a display order, so the Admin matrix does
/// not have to invent headings from right codes.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RightGroup {
    pub code: String,
    pub title: String,
    pub priority: i32,
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_right_groups() -> Result<Vec<RightGroup>> {
    let mut groups: Vec<RightGroup> = rights::RIGHT_GROUPS
        .iter()
        .map(|(code, title, priority)| RightGroup {
            code: (*code).to_string(),
            title: (*title).to_string(),
            priority: *priority,
        })
        .collect();
    groups.sort_by(|a, b| a.priority.cmp(&b.priority).then_with(|| a.code.cmp(&b.code)));
    Ok(groups)
}
fn seed_rights_on(c: &Connection) -> Result<usize> {
    for (code, title, description, right_type, right_group) in rights::CATALOG {
        let implied_rights_json = serde_json::to_string(&rights::default_implied_rights(code))
            .map_err(|e| e.to_string())?;
        err(c.execute(
            "INSERT OR IGNORE INTO rights(id,code,title,description,right_type,right_group,implied_rights_json,flags,feature_gate,propagation,descriptor_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'{}')",
            params![
                new_id("right"),
                code,
                title,
                description,
                right_type,
                right_group,
                implied_rights_json,
                rights::default_flags(right_group),
                rights::feature_gate_for_group(right_group),
                rights::default_propagation(code)
            ],
        ))?;
        // Descriptor columns are catalog-owned: a right that changed group, gained a
        // feature gate or stopped propagating must not stay described by the row a
        // previous release seeded. `implied_rights_json` is deliberately excluded —
        // that column is the administrator's to edit.
        err(c.execute(
            "UPDATE rights SET title=?2,description=?3,right_type=?4,right_group=?5,flags=?6,feature_gate=?7,propagation=?8 WHERE code=?1",
            params![
                code,
                title,
                description,
                right_type,
                right_group,
                rights::default_flags(right_group),
                rights::feature_gate_for_group(right_group),
                rights::default_propagation(code)
            ],
        ))?;
    }
    err(c.query_row("SELECT count(*) FROM rights", [], |r| r.get::<_, i64>(0))).map(|n| n as usize)
}
/// B4-3: the starting role set. Rights are seeded first because a role is defined by
/// the rows it points at. Re-running this never rewrites an existing role: once an
/// administrator has edited `Member`, the seed has no further opinion about it.
fn seed_default_roles_on(c: &Connection) -> Result<usize> {
    seed_rights_on(c)?;
    let mut created = 0;
    for (name, description, grants) in rights::DEFAULT_ROLES {
        let existing: Option<String> = c
            .query_row(
                "SELECT id FROM roles WHERE name=?1 AND role_type='SYSTEM'",
                [name],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if existing.is_some() {
            continue;
        }
        let role_id = new_id("role");
        err(c.execute(
            "INSERT INTO roles(id,name,description,role_type) VALUES(?1,?2,?3,'SYSTEM')",
            params![role_id, name, description],
        ))?;
        for code in *grants {
            err(c.execute(
                "INSERT OR IGNORE INTO role_rights(role_id,right_id) SELECT ?1,id FROM rights WHERE code=?2",
                params![role_id, code],
            ))?;
        }
        created += 1;
    }
    Ok(created)
}

/// Idempotent: inserting the catalog twice never duplicates a `code` (UNIQUE),
/// so the total row count converges after the first call.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn seed_rights() -> Result<usize> {
    let c = db::conn()?;
    seed_default_roles_on(&c)?;
    err(c.query_row("SELECT count(*) FROM rights", [], |r| r.get::<_, i64>(0))).map(|n| n as usize)
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_roles() -> Result<Vec<Role>> {
    let c = db::conn()?;
    let mut s = err(c.prepare(
        "SELECT id,name,description,parent_id,role_type,archived FROM roles ORDER BY name",
    ))?;
    let rows = err(s.query_map([], read_role))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_role(id: String) -> Result<Option<Role>> {
    Ok(list_roles()?.into_iter().find(|x| x.id == id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_role(input: RoleInput) -> Result<Role> {
    let c = db::conn()?;
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
    get_role(id)?.ok_or_else(|| "Created role was not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_role(role: Role) -> Result<Role> {
    let c = db::conn()?;
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
    get_role(role.id)?.ok_or_else(|| "Role not found".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_role(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE roles SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_role_rights(role_id: String) -> Result<Vec<String>> {
    let c = db::conn()?;
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_role_rights(role_id: String, right_codes: Vec<String>) -> Result<()> {
    let mut c = db::conn()?;
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_role_assignments(
    profile_id: Option<String>,
    team_id: Option<String>,
) -> Result<Vec<RoleAssignment>> {
    let c = db::conn()?;
    let sql = format!("SELECT {ASSIGNMENT_COLUMNS} FROM role_assignments WHERE (?1 IS NULL OR profile_id=?1) AND (?2 IS NULL OR team_id=?2) ORDER BY scope_type,scope_id");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map(params![profile_id, team_id], read_assignment))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_role_assignment(input: RoleAssignmentInput) -> Result<RoleAssignment> {
    if input.profile_id.is_none() == input.team_id.is_none() {
        return Err("Assign the role to exactly one of profile_id or team_id".into());
    }
    if !rights::is_scope_type(&input.scope_type) {
        return Err(format!("unknown right scope type {}", input.scope_type));
    }
    let c = db::conn()?;
    let id = input.id.unwrap_or_else(|| new_id("assignment"));
    err(c.execute(
        "INSERT INTO role_assignments(id,role_id,profile_id,team_id,scope_type,scope_id) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, input.role_id, input.profile_id, input.team_id, input.scope_type, input.scope_id],
    ))?;
    let sql = format!("SELECT {ASSIGNMENT_COLUMNS} FROM role_assignments WHERE id=?1");
    err(c.query_row(&sql, [&id], read_assignment))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_role_assignment(id: String) -> Result<()> {
    let c = db::conn()?;
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
    // A deactivated account holds nothing. Rights hang off the profile, so without
    // this the rights model kept handing out authority (including
    // Global.Superadmin, and therefore admin) to accounts that had been switched
    // off. A profile with no account at all is untouched: those are desktop-local
    // identities, which no login can deactivate.
    if !account_is_live(c, profile_id)? {
        return Ok(false);
    }
    let mut s = err(c.prepare(
        "SELECT ra.scope_type, ra.scope_id, r.code, r.implied_rights_json
         FROM role_assignments ra
         JOIN role_rights rr ON rr.role_id = ra.role_id
         JOIN rights r ON r.id = rr.right_id
         WHERE ra.profile_id = ?1
            OR ra.team_id IN (SELECT team_id FROM team_memberships WHERE profile_id = ?1 AND archived = 0)",
    ))?;
    let rows = err(s.query_map([profile_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    let mut descriptor_statement =
        err(c.prepare("SELECT code,implied_rights_json,propagation FROM rights"))?;
    let descriptor_rows = err(descriptor_statement.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    }))?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    let propagations: std::collections::BTreeMap<String, String> = descriptor_rows
        .iter()
        .map(|(code, _, propagation)| (code.clone(), propagation.clone()))
        .collect();
    let descriptors: std::collections::BTreeMap<String, Vec<String>> = descriptor_rows
        .into_iter()
        .map(|(code, json, _)| (code, serde_json::from_str(&json).unwrap_or_default()))
        .collect();
    // KB §2.1 `RightPropagation`. A grant made at the organization level reaches the
    // scopes below it only if the right says it may; a right marked `NONE` has to be
    // granted on the very scope it is checked against. Unknown rights fall back to
    // propagating, which is the behaviour every caller had before propagation existed.
    let requested_propagates = propagations
        .get(right_code)
        .map(|propagation| propagation != rights::PROPAGATION_NONE)
        .unwrap_or(true);
    for (assignment_scope_type, assignment_scope_id, granted_code, _) in rows {
        let mut pending = vec![granted_code.as_str()];
        let mut seen = std::collections::BTreeSet::new();
        let mut granted = false;
        while let Some(code) = pending.pop() {
            if !seen.insert(code) {
                continue;
            }
            if code == right_code {
                granted = true;
                break;
            }
            if let Some(implied) = descriptors.get(code) {
                pending.extend(implied.iter().map(String::as_str));
            }
        }
        if !granted {
            continue;
        }
        if assignment_scope_type == "global" && (requested_propagates || scope_type == "global") {
            return Ok(true);
        }
        if assignment_scope_type == scope_type && assignment_scope_id.as_deref() == scope_id {
            return Ok(true);
        }
    }
    Ok(false)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn check_right(
    profile_id: String,
    right_code: String,
    scope_type: String,
    scope_id: Option<String>,
) -> Result<bool> {
    let c = db::conn()?;
    check_right_on(
        &c,
        &profile_id,
        &right_code,
        &scope_type,
        scope_id.as_deref(),
    )
}
/// Enforcement helper for operational handlers. Account administrators are an
/// explicit break-glass path; all other grants resolve through the catalog.
pub fn require_right_on(
    c: &Connection,
    profile_id: &str,
    right: rights::Right,
    scope_type: &str,
    scope_id: Option<&str>,
) -> Result<()> {
    if is_admin_on(c, profile_id)?
        || check_right_on(c, profile_id, right.code(), scope_type, scope_id)?
    {
        return Ok(());
    }
    // A right nobody has configured in the role matrix is not yet enforced:
    // the catalog is opt-in tightening, not a default lockout. The moment an
    // admin grants the right to any role, it becomes a real gate everywhere.
    let configured: i64 = err(c.query_row(
        "SELECT count(*) FROM role_rights rr JOIN rights r ON r.id = rr.right_id WHERE r.code = ?1",
        params![right.code()],
        |r| r.get(0),
    ))?;
    if configured == 0 {
        Ok(())
    } else {
        Err(format!("missing right {}", right.code()))
    }
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
    pub deadline: Option<String>,
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_projects() -> Result<Vec<Project>> {
    let c = db::conn()?;
    let mut s = c
        .prepare("SELECT id,name,key,description,created_by,archived,deadline FROM projects ORDER BY archived,name")
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
                deadline: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_project(id: String) -> Result<Option<Project>> {
    Ok(list_projects()?.into_iter().find(|x| x.id == id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_project(project: Project) -> Result<()> {
    let c = db::conn()?;
    create_project_on(&c, project)
}
/// Ownership law: a project is never created ownerless. Web mints `created_by`
/// from the session before it gets here; desktop has no session, so the shell
/// sends the locally selected profile. A missing owner is a bug in the caller,
/// not a row we silently accept (a NULL owner locks the project out of every
/// owner-or-admin gate forever).
pub fn create_project_on(c: &Connection, project: Project) -> Result<()> {
    let owner = project
        .created_by
        .as_deref()
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .ok_or("A project owner is required")?
        .to_string();
    let project = Project {
        created_by: Some(owner),
        ..project
    };
    c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,deadline,created_at)VALUES(?1,?2,?3,?4,?5,?6,?7,unixepoch())",rusqlite::params![project.id,project.name,project.key,project.description,project.created_by,project.archived,project.deadline.filter(|date| !date.trim().is_empty())]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_project(project: Project) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE projects SET name=?2,key=?3,description=?4,created_by=?5,archived=?6,deadline=?7 WHERE id=?1",
        rusqlite::params![
            project.id,
            project.name,
            project.key,
            project.description,
            project.created_by,
            project.archived,
            project.deadline.filter(|date| !date.trim().is_empty())
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Narrow deadline write: the only column it can change is `projects.deadline`, so a
/// stale whole-project payload can never overwrite name/description/ownership (H6).
/// Authorization (owner or admin, identity bound from the session) lives in the web
/// command gate; this function refuses anything that is not a valid `YYYY-MM-DD` date
/// or an explicit clear, and never invents a project row.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_project_deadline(
    project_id: String,
    deadline: Option<String>,
    actor_profile_id: Option<String>,
) -> Result<Project> {
    let c = db::conn()?;
    // Desktop passes its local identity; web passes none because the HTTP
    // command gate already authorized the session before dispatch.
    if let Some(actor) = actor_profile_id.as_deref() {
        authorize_project_deadline_on(&c, actor, &project_id)?;
    }
    set_project_deadline_on(&c, &project_id, deadline.as_deref())
}
/// Desktop parity for the web deadline gate. The desktop app has no HTTP
/// session, so the acting identity is the locally selected profile: the same
/// owner-or-superadmin rule is applied against the local rights model.
/// A profile is live unless it owns account rows and every one of them is
/// deactivated. Profiles without any account (desktop-local identities) are live.
fn account_is_live(c: &Connection, profile_id: &str) -> Result<bool> {
    let (accounts, active): (i64, i64) = c
        .query_row(
            "SELECT count(*), coalesce(sum(active),0) FROM users WHERE profile_id=?1",
            [profile_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(accounts == 0 || active > 0)
}

/// The one meaning of "admin" in this codebase. Two notions existed in parallel and
/// never mapped onto each other: the web session gate reads `users.role='admin'`,
/// the rights model reads the `Global.Superadmin` right. Either one makes an admin,
/// on every transport; a deactivated account confers nothing. Every gate — the HTTP
/// command gate and the desktop authorizers alike — asks this function.
pub fn is_admin_on(c: &Connection, profile_id: &str) -> Result<bool> {
    if profile_id.trim().is_empty() {
        return Ok(false);
    }
    let by_account: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE profile_id=?1 AND role='admin' AND active=1)",
            [profile_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if by_account {
        return Ok(true);
    }
    check_right_on(
        c,
        profile_id,
        rights::Right::Superadmin.code(),
        "global",
        None,
    )
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn is_admin(profile_id: String) -> Result<bool> {
    let c = db::conn()?;
    is_admin_on(&c, &profile_id)
}

pub fn authorize_project_deadline_on(
    c: &Connection,
    actor_profile_id: &str,
    project_id: &str,
) -> Result<()> {
    if actor_profile_id.trim().is_empty() {
        return Err("A profile is required".into());
    }
    let owner: Option<Option<String>> = c
        .query_row(
            "SELECT created_by FROM projects WHERE id=?1",
            [project_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let owner = owner.ok_or_else(|| "project access denied".to_string())?;
    if owner.as_deref() == Some(actor_profile_id) {
        return Ok(());
    }
    if is_admin_on(c, actor_profile_id)? {
        return Ok(());
    }
    Err("only the project owner or an admin can set this deadline".into())
}
pub fn set_project_deadline_on(
    c: &Connection,
    project_id: &str,
    deadline: Option<&str>,
) -> Result<Project> {
    if project_id.trim().is_empty() {
        return Err("A project is required".into());
    }
    let normalized = match deadline.map(str::trim).filter(|date| !date.is_empty()) {
        Some(date) => Some(crate::personal::parse_day_key(date)?),
        None => None,
    };
    // First-write law: a deadline may be written into an empty column, or
    // cleared, but an existing deadline is never silently overwritten.
    let changed = c
        .execute(
            "UPDATE projects SET deadline=?2 WHERE id=?1 AND (deadline IS NULL OR ?2 IS NULL)",
            rusqlite::params![project_id, normalized],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        let existing: Option<Option<String>> = c
            .query_row(
                "SELECT deadline FROM projects WHERE id=?1",
                [project_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        return match existing {
            None => Err("That project does not exist".into()),
            Some(_) => Err("That project already has a deadline; clear it first".into()),
        };
    }
    project_on(c, project_id)?.ok_or_else(|| "That project does not exist".into())
}
/// Narrow *edit* of a deadline that already exists. `set_project_deadline` deliberately
/// refuses to overwrite (first-write law, so a quick-create from the calendar can never
/// stomp a date somebody else just chose); editing therefore needs its own door, and that
/// door is compare-and-set: the caller states the value it was looking at and the write
/// lands only while the row still holds it. A concurrent edit loses instead of silently
/// winning, and no other project column is reachable from here (H6).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_project_deadline(
    project_id: String,
    expected_deadline: Option<String>,
    deadline: Option<String>,
    actor_profile_id: Option<String>,
) -> Result<Project> {
    let c = db::conn()?;
    // Desktop passes its local identity; web passes none because the HTTP command
    // gate already authorized the session before dispatch.
    if let Some(actor) = actor_profile_id.as_deref() {
        authorize_project_deadline_on(&c, actor, &project_id)?;
    }
    update_project_deadline_on(
        &c,
        &project_id,
        expected_deadline.as_deref(),
        deadline.as_deref(),
    )
}

pub fn update_project_deadline_on(
    c: &Connection,
    project_id: &str,
    expected_deadline: Option<&str>,
    deadline: Option<&str>,
) -> Result<Project> {
    if project_id.trim().is_empty() {
        return Err("A project is required".into());
    }
    let normalize = |value: Option<&str>| -> Result<Option<String>> {
        match value.map(str::trim).filter(|date| !date.is_empty()) {
            Some(date) => Ok(Some(crate::personal::parse_day_key(date)?)),
            None => Ok(None),
        }
    };
    let expected = normalize(expected_deadline)?;
    let next = normalize(deadline)?;
    // One statement: the guard and the write cannot drift apart under concurrency.
    // `IS` compares NULLs, so "it was empty" is expressible without a second query.
    let changed = c
        .execute(
            "UPDATE projects SET deadline=?3 WHERE id=?1 AND deadline IS ?2",
            rusqlite::params![project_id, expected, next],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        // A missing project and a stale expectation must not be distinguishable by
        // anything the caller could mine for metadata: the web gate has already refused
        // unknown ids with the same 403 every non-owner gets.
        return match project_on(c, project_id)? {
            None => Err("project access denied".into()),
            Some(_) => {
                Err("That deadline changed since you loaded it; reload and try again".into())
            }
        };
    }
    project_on(c, project_id)?.ok_or_else(|| "project access denied".to_string())
}

pub fn project_on(c: &Connection, project_id: &str) -> Result<Option<Project>> {
    c.query_row(
        "SELECT id,name,key,description,created_by,archived,deadline FROM projects WHERE id=?1",
        [project_id],
        |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                key: r.get(2)?,
                description: r.get(3)?,
                created_by: r.get(4)?,
                archived: r.get(5)?,
                deadline: r.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}
// ---------------------------------------------------------------------------
// Custom Fields engine (generic across entity_type: issue/profile/team/membership/...)
// ---------------------------------------------------------------------------

/// Complete Circlet issue custom-field type catalog (§02).
const CF_TYPES: &[&str] = &[
    "text",
    "text_list",
    "int",
    "int_list",
    "enum",
    "enum_list",
    "open_enum",
    "open_enum_list",
    "bool",
    "date",
    "datetime",
    "percentage",
    "fraction",
    "profile",
    "profile_list",
    "team",
    "location",
    "project",
    "url",
    "contact",
    "contact_list",
    "autonumber",
    "issue",
    "issue_list",
];

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
    if matches!(cf_type, "enum" | "enum_list") {
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
fn validate_cf_value(
    cf_type: &str,
    constraints_json: Option<&str>,
    value_json: &str,
) -> Result<serde_json::Value> {
    let value: serde_json::Value =
        serde_json::from_str(value_json).map_err(|e| format!("Invalid JSON value: {e}"))?;
    let constraints: serde_json::Value = match constraints_json {
        Some(s) if !s.is_empty() => {
            serde_json::from_str(s).map_err(|e| format!("Invalid constraints JSON: {e}"))?
        }
        _ => serde_json::json!({}),
    };
    let strings = |v: &serde_json::Value| -> Result<Vec<String>> {
        if matches!(
            cf_type,
            "text_list"
                | "enum_list"
                | "open_enum_list"
                | "profile_list"
                | "contact_list"
                | "issue_list"
        ) {
            v.as_array()
                .ok_or_else(|| "Expected an array".to_string())?
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| "Expected an array of strings".to_string())
                })
                .collect()
        } else {
            Ok(vec![v
                .as_str()
                .ok_or("Expected a string value")?
                .to_owned()])
        }
    };
    match cf_type {
        "bool" => {
            if !value.is_boolean() {
                return Err("Expected a boolean value".into());
            }
        }
        "text" | "text_list" | "open_enum" | "open_enum_list" | "location" | "contact"
        | "contact_list" | "team" | "project" | "profile" | "profile_list" | "issue"
        | "issue_list" => {
            for s in strings(&value)? {
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
        }
        "url" => {
            let s = value.as_str().ok_or("Expected a URL string")?;
            if !(s.starts_with("http://") || s.starts_with("https://")) {
                return Err("Expected an http(s) URL".into());
            }
        }
        "int" | "autonumber" => {
            if value.as_i64().is_none() {
                return Err("Expected an integer value".into());
            }
        }
        "int_list" => {
            if !value
                .as_array()
                .map(|a| a.iter().all(|v| v.as_i64().is_some()))
                .unwrap_or(false)
            {
                return Err("Expected an array of integers".into());
            }
        }
        "percentage" | "fraction" => {
            let n = value.as_f64().ok_or("Expected a number")?;
            if !(0.0..=1.0).contains(&n) {
                return Err("Expected a value from 0 to 1".into());
            }
        }
        "date" => {
            let s = value
                .as_str()
                .ok_or("Expected an ISO date string (YYYY-MM-DD)")?;
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| format!("Invalid date '{s}', expected YYYY-MM-DD"))?;
        }
        "datetime" => {
            let s = value.as_str().ok_or("Expected an ISO datetime string")?;
            chrono::DateTime::parse_from_rfc3339(s)
                .map_err(|_| format!("Invalid datetime '{s}', expected RFC3339"))?;
        }
        "enum" | "enum_list" => {
            let options = constraints
                .get("options")
                .and_then(|v| v.as_array())
                .ok_or("Enum field is missing constraints.options")?;
            for s in strings(&value)? {
                if !options.iter().any(|o| o.as_str() == Some(s.as_str())) {
                    return Err(format!("'{s}' is not one of the allowed enum options"));
                }
            }
        }
        other => return Err(format!("Unsupported custom field type: {other}")),
    }
    Ok(value)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_cf_definitions(entity_type: Option<String>) -> Result<Vec<CfDefinition>> {
    let c = db::conn()?;
    let sql = format!("SELECT {CF_DEF_COLUMNS} FROM cf_definitions WHERE archived=0 AND (?1 IS NULL OR entity_type=?1) ORDER BY entity_type,ordering");
    let mut s = err(c.prepare(&sql))?;
    let rows = err(s.query_map([entity_type], read_cf_definition))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_cf_definition(input: CfDefinitionInput) -> Result<CfDefinition> {
    validate_cf_shape(&input.cf_type, input.constraints_json.as_deref())?;
    let c = db::conn()?;
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_cf_definition(definition: CfDefinition) -> Result<CfDefinition> {
    validate_cf_shape(&definition.cf_type, definition.constraints_json.as_deref())?;
    let c = db::conn()?;
    err(c.execute(
        "UPDATE cf_definitions SET entity_type=?2,cf_type=?3,name=?4,constraints_json=?5,default_json=?6,ordering=?7,archived=?8 WHERE id=?1",
        params![definition.id, definition.entity_type, definition.cf_type, definition.name, definition.constraints_json, definition.default_json, definition.ordering, definition.archived],
    ))?;
    let sql = format!("SELECT {CF_DEF_COLUMNS} FROM cf_definitions WHERE id=?1");
    err(c.query_row(&sql, [&definition.id], read_cf_definition))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_cf_definition(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    err(c.execute(
        "UPDATE cf_definitions SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}

fn cf_set_value_on(
    c: &Connection,
    definition_id: &str,
    entity_id: &str,
    value_json: &str,
) -> Result<()> {
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
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn cf_set_value(definition_id: String, entity_id: String, value_json: String) -> Result<()> {
    let c = db::conn()?;
    cf_set_value_on(&c, &definition_id, &entity_id, &value_json)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn cf_get_values(entity_type: String, entity_id: String) -> Result<Vec<CfValueEntry>> {
    let c = db::conn()?;
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
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c
    }
    fn insert_role_right(c: &Connection, role_id: &str, right_code: &str, right_type: &str) {
        c.execute("INSERT INTO roles(id,name) VALUES(?1,?1)", [role_id])
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

    /// Operational gates deny a configured right until its role grant reaches the caller.
    #[test]
    fn require_right_denies_without_a_grant_and_allows_the_granted_role() {
        let c = conn();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('gate-user','gate-user','Gate user',0)",
            [],
        )
        .unwrap();
        insert_role_right(&c, "gate-role", rights::Right::CreateIssue.code(), "Project");
        let denied = require_right_on(
            &c,
            "gate-user",
            rights::Right::CreateIssue,
            "project",
            Some("project-1"),
        )
        .unwrap_err();
        assert_eq!(denied, "missing right Project.CreateIssues");
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES('gate-assignment','gate-role','gate-user','project','project-1')",
            [],
        )
        .unwrap();
        require_right_on(
            &c,
            "gate-user",
            rights::Right::CreateIssue,
            "project",
            Some("project-1"),
        )
        .unwrap();
    }

    /// KB §2.1 `RightPropagation`. A global grant reaches a project scope for an
    /// ordinary right, and does not reach it for a right the catalog marks `NONE` —
    /// the difference has to come out of the persisted column, so the test writes the
    /// column directly instead of going through the catalog seed.
    #[test]
    fn a_non_propagating_right_is_not_reached_by_a_global_grant() {
        let c = conn();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','p','p',unixepoch())",
            [],
        )
        .unwrap();
        insert_role_right(&c, "snoop", "Channel.ViewDirectMessages", "Channel");
        insert_role_right(&c, "snoop", "Project.ViewProject", "Project");
        c.execute(
            "UPDATE rights SET propagation=?1 WHERE code='Channel.ViewDirectMessages'",
            [rights::PROPAGATION_NONE],
        )
        .unwrap();
        c.execute(
            "UPDATE rights SET propagation=?1 WHERE code='Project.ViewProject'",
            [rights::PROPAGATION_GLOBAL_TO_DESCENDANTS],
        )
        .unwrap();
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('a','snoop','p','global')",
            [],
        )
        .unwrap();
        assert!(
            check_right_on(&c, "p", "Project.ViewProject", "project", Some("x")).unwrap(),
            "a propagating right descends from the global grant"
        );
        assert!(
            !check_right_on(&c, "p", "Channel.ViewDirectMessages", "channel", Some("c")).unwrap(),
            "a NONE-propagation right must be granted on the channel itself"
        );
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES('b','snoop','p','channel','c')",
            [],
        )
        .unwrap();
        assert!(
            check_right_on(&c, "p", "Channel.ViewDirectMessages", "channel", Some("c")).unwrap(),
            "the exact-scope grant is what confers it"
        );
    }

    /// Seeding is the only writer of descriptor columns, so the columns a fresh
    /// database ends up with are asserted against the database, not against the catalog
    /// constants that produced them.
    #[test]
    fn seeding_writes_the_catalog_descriptor_columns() {
        let c = conn();
        seed_rights_on(&c).unwrap();
        let (group, propagation, gate, flags): (String, String, Option<String>, u32) = c
            .query_row(
                "SELECT right_group,propagation,feature_gate,flags FROM rights WHERE code='Project.CreateDevEnvironments'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(group, "DevEnvironments");
        assert_eq!(propagation, rights::PROPAGATION_GLOBAL_TO_DESCENDANTS);
        assert_eq!(gate.as_deref(), Some("dev-environments"));
        assert_eq!(flags, 0);
        let private: String = c
            .query_row(
                "SELECT propagation FROM rights WHERE code='Profile.EditCredentials'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(private, rights::PROPAGATION_NONE);
    }

    /// Every group code the catalog stores has to exist in the group registry, or the
    /// Admin matrix renders a heading it cannot title.
    #[test]
    fn every_catalog_group_is_registered_and_listed() {
        for (code, _, _, _, group) in rights::CATALOG {
            assert!(
                rights::is_right_group(group),
                "{code} names unregistered group {group}"
            );
        }
        let listed = list_right_groups().unwrap();
        assert_eq!(listed.len(), rights::RIGHT_GROUPS.len());
        assert!(
            listed.windows(2).all(|w| w[0].priority <= w[1].priority),
            "groups are returned in display order"
        );
    }

    /// The only implication resolver is this one, and it walks persisted descriptors.
    /// Seeding `Member` (which grants `Project.VcsWrite`, never `Project.VcsRead`) and
    /// then asking for `VcsRead` exercises the closure end to end, by a path that shares
    /// no code with `rights::default_implied_rights`.
    #[test]
    fn the_seeded_roles_resolve_implied_rights_through_the_persisted_closure() {
        let c = conn();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('ps','ps','PS',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('us','us','x','US','ps','member',0)",
            [],
        )
        .unwrap();
        assert_eq!(
            seed_default_roles_on(&c).unwrap(),
            3,
            "Admin, Member, Guest"
        );
        assert_eq!(
            seed_default_roles_on(&c).unwrap(),
            0,
            "re-seeding creates nothing"
        );
        let member: String = c
            .query_row("SELECT id FROM roles WHERE name='Member'", [], |r| r.get(0))
            .unwrap();
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES('as','?','ps','project','proj1')"
                .replace('?', &member)
                .as_str(),
            [],
        )
        .unwrap();
        assert!(
            check_right_on(&c, "ps", "Project.VcsWrite", "project", Some("proj1")).unwrap(),
            "the direct grant holds"
        );
        assert!(
            check_right_on(&c, "ps", "Project.VcsRead", "project", Some("proj1")).unwrap(),
            "VcsWrite implies VcsRead through the persisted descriptor"
        );
        assert!(
            !check_right_on(&c, "ps", "Project.VcsAdmin", "project", Some("proj1")).unwrap(),
            "implication points down, never up"
        );
        assert!(
            !check_right_on(&c, "ps", "Project.VcsRead", "project", Some("proj2")).unwrap(),
            "and it does not cross scopes"
        );
    }

    /// Admin holds `Global.Superadmin`, whose seeded descriptor is the whole catalog.
    #[test]
    fn the_seeded_admin_role_reaches_every_right() {
        let c = conn();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','pa','PA',0)",
            [],
        )
        .unwrap();
        seed_default_roles_on(&c).unwrap();
        let admin: String = c
            .query_row("SELECT id FROM roles WHERE name='Admin'", [], |r| r.get(0))
            .unwrap();
        c.execute(
            "INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('aa','?','pa','global')"
                .replace('?', &admin)
                .as_str(),
            [],
        )
        .unwrap();
        for (code, ..) in rights::CATALOG {
            assert!(
                check_right_on(&c, "pa", code, "project", Some("anything")).unwrap(),
                "Admin must reach {code}"
            );
        }
    }

    #[test]
    fn check_right_resolves_team_inherited_assignment() {
        let c = conn();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p1','p1','P1',0)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO teams(id,name) VALUES('t1','Team1')", [])
            .unwrap();
        c.execute(
            "INSERT INTO team_memberships(id,profile_id,team_id) VALUES('m1','p1','t1')",
            [],
        )
        .unwrap();
        insert_role_right(&c, "r1", "Project.ViewProject", "Project");
        c.execute(
            "INSERT INTO role_assignments(id,role_id,team_id,scope_type,scope_id) VALUES('a1','r1','t1','project','proj1')",
            [],
        )
        .unwrap();
        assert!(check_right_on(&c, "p1", "Project.ViewProject", "project", Some("proj1")).unwrap());
        // different project scope_id: must not match (no cross-scope leakage).
        assert!(
            !check_right_on(&c, "p1", "Project.ViewProject", "project", Some("proj2")).unwrap()
        );
        // profile with no membership at all: no right.
        assert!(!check_right_on(
            &c,
            "nobody",
            "Project.ViewProject",
            "project",
            Some("proj1")
        )
        .unwrap());
    }

    #[test]
    fn check_right_scope_isolation_project_vs_global() {
        let c = conn();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p2','p2','P2',0)",
            [],
        )
        .unwrap();
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
        assert!(
            check_right_on(&c, "p2", "Global.EditRoles", "project", Some("any-project")).unwrap()
        );
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
        assert_eq!(first, rights::CATALOG.len());
        let distinct_codes: i64 = c
            .query_row("SELECT count(DISTINCT code) FROM rights", [], |r| r.get(0))
            .unwrap();
        assert_eq!(distinct_codes as usize, rights::CATALOG.len());
    }

    #[test]
    fn role_assignment_requires_exactly_one_target() {
        let c = conn();
        c.execute("INSERT INTO roles(id,name) VALUES('r4','R4')", [])
            .unwrap();
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
        c.execute("INSERT INTO roles(id,name) VALUES('r5','R5')", [])
            .unwrap();
        seed_rights_on(&c).unwrap();
        let mut tx_conn = c;
        // emulate set_role_rights body against a plain Connection (no AppHandle in unit tests)
        let codes = vec!["Global.Superadmin".to_string()];
        {
            let tx = tx_conn.transaction().unwrap();
            tx.execute("DELETE FROM role_rights WHERE role_id=?1", ["r5"])
                .unwrap();
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

    #[test]
    fn desktop_project_creation_is_never_ownerless() {
        let c = conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1)", []).unwrap();
        let project = |owner: Option<&str>| Project {
            id: "pr".into(),
            name: "Project".into(),
            key: "PR".into(),
            description: None,
            created_by: owner.map(str::to_owned),
            archived: false,
            deadline: None,
        };
        // Desktop used to send no owner at all: the row landed with NULL `created_by`
        // and no owner-or-admin gate could ever pass for it again.
        let refused = create_project_on(&c, project(None)).unwrap_err();
        assert!(refused.contains("owner is required"), "{refused}");
        assert!(
            create_project_on(&c, project(Some("   "))).is_err(),
            "blank owner is no owner"
        );
        let rows: i64 = c
            .query_row("SELECT count(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0, "a refused create writes nothing");
        create_project_on(&c, project(Some("p"))).unwrap();
        let stored: Option<String> = c
            .query_row("SELECT created_by FROM projects WHERE id='pr'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored.as_deref(), Some("p"));
    }

    /// "Admin" had two parallel meanings that never met: the web session gate reads
    /// `users.role='admin'`, the desktop rights model reads the `Global.Superadmin`
    /// right. The same person was therefore admin on one transport and a stranger on
    /// the other. One predicate now answers for both.
    #[test]
    fn admin_means_the_same_thing_on_both_transports() {
        let c = conn();
        for id in ["webadmin", "deskboss", "plain", "retired"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,1)",
                [id],
            )
            .unwrap();
        }
        // A web admin: an account row with role='admin' and no rights grant at all.
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-web','webadmin','x','Web','webadmin','admin',1,1)", []).unwrap();
        // A desktop admin: the Global.Superadmin right and a plain member account.
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-desk','deskboss','x','Desk','deskboss','member',1,1)", []).unwrap();
        insert_role_right(&c, "admin-role", "Global.Superadmin", "global");
        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('ra','admin-role','deskboss','global')", []).unwrap();
        // A deactivated admin account confers nothing.
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-old','retired','x','Old','retired','admin',0,1)", []).unwrap();

        assert!(
            is_admin_on(&c, "webadmin").unwrap(),
            "an account-level admin is an admin everywhere"
        );
        assert!(
            is_admin_on(&c, "deskboss").unwrap(),
            "a Global.Superadmin is an admin everywhere"
        );
        assert!(
            !is_admin_on(&c, "plain").unwrap(),
            "an ordinary profile is never an admin"
        );
        assert!(
            !is_admin_on(&c, "retired").unwrap(),
            "a deactivated admin account confers nothing"
        );
        assert!(
            !is_admin_on(&c, "").unwrap(),
            "a blank identity is never an admin"
        );

        // ...and the desktop deadline gate accepts the web-minted admin, which is
        // exactly the mapping that did not exist before.
        c.execute("INSERT INTO projects(id,name,key,created_by,archived,created_at) VALUES('pr','Project','PR','plain',0,1)", []).unwrap();
        authorize_project_deadline_on(&c, "webadmin", "pr").unwrap();
        authorize_project_deadline_on(&c, "deskboss", "pr").unwrap();
        assert!(
            authorize_project_deadline_on(&c, "retired", "pr").is_err(),
            "a deactivated admin is refused"
        );
    }

    /// The hole this closes: `is_admin_on` refused a deactivated *account* admin,
    /// but fell through to the rights model, which never looked at `users.active`.
    /// A switched-off account holding Global.Superadmin therefore stayed an admin.
    #[test]
    fn a_deactivated_account_holds_no_right_and_no_admin() {
        let c = conn();
        for id in ["frozen", "live", "desktoponly"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,1)",
                [id],
            )
            .unwrap();
        }
        insert_role_right(&c, "admin-role", "Global.Superadmin", "global");
        for (n, profile) in ["frozen", "live", "desktoponly"].iter().enumerate() {
            c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES(?1,'admin-role',?2,'global')", params![format!("ra-{n}"), profile]).unwrap();
        }
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-frozen','frozen','x','Frozen','frozen','member',0,1)", []).unwrap();
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('u-live','live','x','Live','live','member',1,1)", []).unwrap();

        assert!(
            !check_right_on(&c, "frozen", "Global.Superadmin", "global", None).unwrap(),
            "a deactivated account holds no right"
        );
        assert!(
            !is_admin_on(&c, "frozen").unwrap(),
            "and therefore is not an admin by the rights path either"
        );
        assert!(
            check_right_on(&c, "live", "Global.Superadmin", "global", None).unwrap(),
            "an active account still holds its rights"
        );
        assert!(is_admin_on(&c, "live").unwrap());
        assert!(
            check_right_on(&c, "desktoponly", "Global.Superadmin", "global", None).unwrap(),
            "a profile with no account at all is a desktop-local identity, not a deactivated one"
        );
    }

    #[test]
    fn desktop_deadline_write_is_owner_or_superadmin_only() {
        let c = conn();
        for id in ["owner", "stranger", "boss"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,1)",
                [id],
            )
            .unwrap();
        }
        c.execute("INSERT INTO projects(id,name,key,created_by,archived,created_at) VALUES('pr','Project','PR','owner',0,1)", []).unwrap();
        insert_role_right(&c, "admin-role", "Global.Superadmin", "global");
        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('ra','admin-role','boss','global')", []).unwrap();

        // Owner and local superadmin pass; anybody else is refused by name.
        authorize_project_deadline_on(&c, "owner", "pr").unwrap();
        authorize_project_deadline_on(&c, "boss", "pr").unwrap();
        let refused = authorize_project_deadline_on(&c, "stranger", "pr").unwrap_err();
        assert!(
            refused.contains("only the project owner or an admin"),
            "{refused}"
        );
        // No identity, and unknown projects, are refused too (never leak existence).
        assert!(authorize_project_deadline_on(&c, "", "pr").is_err());
        assert!(authorize_project_deadline_on(&c, "owner", "ghost").is_err());

        // Authorization composes with the first-write law, it does not bypass it.
        set_project_deadline_on(&c, "pr", Some("2030-03-10")).unwrap();
        authorize_project_deadline_on(&c, "boss", "pr").unwrap();
        let occupied = set_project_deadline_on(&c, "pr", Some("2030-04-01")).unwrap_err();
        assert!(occupied.contains("already has a deadline"), "{occupied}");
        let held: Option<String> = c
            .query_row("SELECT deadline FROM projects WHERE id='pr'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(held.as_deref(), Some("2030-03-10"));
    }

    #[test]
    fn project_deadline_write_is_narrow_and_date_only() {
        let c = conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1)", []).unwrap();
        c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,created_at) VALUES('pr','Project','PR','Original','p',0,1)", []).unwrap();
        // First write sets the deadline and touches nothing else.
        let project = set_project_deadline_on(&c, "pr", Some("2030-03-10")).unwrap();
        assert_eq!(project.deadline.as_deref(), Some("2030-03-10"));
        assert_eq!(project.description.as_deref(), Some("Original"));
        assert_eq!(project.created_by.as_deref(), Some("p"));
        // First-write law: an occupied deadline column is never overwritten.
        let refused = set_project_deadline_on(&c, "pr", Some("2030-04-01")).unwrap_err();
        assert!(refused.contains("already has a deadline"), "{refused}");
        let held: Option<String> = c
            .query_row("SELECT deadline FROM projects WHERE id='pr'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            held.as_deref(),
            Some("2030-03-10"),
            "the stored deadline stands"
        );
        // Only after an explicit clear does a new first write land.
        assert_eq!(
            set_project_deadline_on(&c, "pr", None).unwrap().deadline,
            None
        );
        let project = set_project_deadline_on(&c, "pr", Some("2030-04-01")).unwrap();
        assert_eq!(project.deadline.as_deref(), Some("2030-04-01"));
        assert_eq!(project.name, "Project");
        // Clearing is explicit; blank normalizes to NULL.
        assert_eq!(
            set_project_deadline_on(&c, "pr", Some("  "))
                .unwrap()
                .deadline,
            None
        );
        assert_eq!(
            set_project_deadline_on(&c, "pr", None).unwrap().deadline,
            None
        );
        // Malformed dates and unknown projects fail loudly, leaving state untouched.
        assert!(set_project_deadline_on(&c, "pr", Some("10/03/2030")).is_err());
        assert!(set_project_deadline_on(&c, "pr", Some("2030-13-40")).is_err());
        assert!(set_project_deadline_on(&c, "ghost", Some("2030-03-10")).is_err());
        let stored: (String, Option<String>) = c
            .query_row(
                "SELECT name,deadline FROM projects WHERE id='pr'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored, ("Project".to_string(), None));
    }

    /// Editing an existing deadline is a *different* door from the first write, and it is
    /// compare-and-set: the caller says what it was looking at, and a value that moved in
    /// the meantime refuses the write instead of overwriting it.
    #[test]
    fn project_deadline_edit_is_compare_and_set_and_leaves_the_project_alone() {
        let c = conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p','person','Person',1)", []).unwrap();
        c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,created_at) VALUES('pr','Project','PR','Original','p',0,1)", []).unwrap();
        set_project_deadline_on(&c, "pr", Some("2030-03-10")).unwrap();

        // Edit against the value on screen: lands, and only the deadline column moves.
        let edited =
            update_project_deadline_on(&c, "pr", Some("2030-03-10"), Some("2030-04-01")).unwrap();
        assert_eq!(edited.deadline.as_deref(), Some("2030-04-01"));
        assert_eq!(
            (
                edited.name.as_str(),
                edited.description.as_deref(),
                edited.created_by.as_deref()
            ),
            ("Project", Some("Original"), Some("p"))
        );

        // Stale expectation: refused, and the stored date is untouched.
        let stale = update_project_deadline_on(&c, "pr", Some("2030-03-10"), Some("2031-01-01"))
            .unwrap_err();
        assert!(stale.contains("changed since you loaded it"), "{stale}");
        let held: Option<String> = c
            .query_row("SELECT deadline FROM projects WHERE id='pr'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(held.as_deref(), Some("2030-04-01"));

        // Clearing is an edit too, and the cleared column can then be filled again.
        assert_eq!(
            update_project_deadline_on(&c, "pr", Some("2030-04-01"), None)
                .unwrap()
                .deadline,
            None
        );
        assert_eq!(
            update_project_deadline_on(&c, "pr", None, Some("2030-05-05"))
                .unwrap()
                .deadline
                .as_deref(),
            Some("2030-05-05")
        );
        // Blank means clear, on both sides of the comparison.
        assert_eq!(
            update_project_deadline_on(&c, "pr", Some("2030-05-05"), Some("   "))
                .unwrap()
                .deadline,
            None
        );

        // Malformed input never reaches the row; an unknown project is refused in the
        // same words a non-owner gets, disclosing nothing about existence.
        assert!(update_project_deadline_on(&c, "pr", None, Some("01/01/2030")).is_err());
        assert!(update_project_deadline_on(&c, "pr", None, Some("2030-13-40")).is_err());
        let ghost = update_project_deadline_on(&c, "ghost", None, Some("2030-03-10")).unwrap_err();
        assert_eq!(ghost, "project access denied");
        let stored: (String, Option<String>) = c
            .query_row(
                "SELECT name,deadline FROM projects WHERE id='pr'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored, ("Project".to_string(), None));
    }
}
