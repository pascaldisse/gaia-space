//! Cloud dev environment lifecycle (KB `docs/space-knowledge-base/07-devenv-apps-api.md` §3.1 #5/#6).
//!
//! What this module owns is the *lifecycle record*, not a provisioner: no VM is started
//! and no container is run here. Space's observable behaviour that we do reproduce is
//! the state machine an operator can see and act on — an environment that idles past its
//! timeout hibernates while keeping its home and working trees, a hibernated environment
//! resumes from exactly those trees, and a standby ("hot pool") environment can be claimed
//! by a member who then becomes its owner. Provisioning a real machine remains out of
//! scope for this desktop/server split and is recorded as such in PARITY.md.

use crate::db;
use crate::platform::require_right_on;
use crate::rights::Right;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

type Result<T> = std::result::Result<T, String>;
static NEXT_POOL_ID: AtomicU64 = AtomicU64::new(0);
fn new_pool_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "standby-{nanos:x}-{:x}",
        NEXT_POOL_ID.fetch_add(1, Ordering::Relaxed)
    )
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StandbyPoolPolicy {
    pub project_id: String,
    pub ide: String,
    pub instance_type: String,
    pub target_size: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DevEnvironment {
    pub id: String,
    pub project_id: String,
    pub owner_id: Option<String>,
    pub name: String,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub ide: String,
    pub instance_type: String,
    pub state: String,
    pub idle_timeout_minutes: i64,
    pub last_activity_at: i64,
    pub hibernated_at: Option<i64>,
    pub persisted_home: Option<String>,
    pub persisted_worktree: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewDevEnvironment {
    pub id: String,
    pub project_id: String,
    pub owner_id: Option<String>,
    pub name: String,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub ide: Option<String>,
    pub instance_type: Option<String>,
    pub idle_timeout_minutes: Option<i64>,
    /// A standby environment is created unowned and pre-warmed, ready to be claimed.
    #[serde(default)]
    pub standby: bool,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn read(r: &rusqlite::Row<'_>) -> rusqlite::Result<DevEnvironment> {
    Ok(DevEnvironment {
        id: r.get(0)?,
        project_id: r.get(1)?,
        owner_id: r.get(2)?,
        name: r.get(3)?,
        repository: r.get(4)?,
        branch: r.get(5)?,
        ide: r.get(6)?,
        instance_type: r.get(7)?,
        state: r.get(8)?,
        idle_timeout_minutes: r.get(9)?,
        last_activity_at: r.get(10)?,
        hibernated_at: r.get(11)?,
        persisted_home: r.get(12)?,
        persisted_worktree: r.get(13)?,
    })
}

const COLUMNS: &str = "id,project_id,owner_id,name,repository,branch,ide,instance_type,state,idle_timeout_minutes,last_activity_at,hibernated_at,persisted_home,persisted_worktree";

fn get_tx(c: &Connection, id: &str) -> Result<DevEnvironment> {
    c.query_row(
        &format!("SELECT {COLUMNS} FROM dev_environments WHERE id=?1"),
        params![id],
        read,
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("dev environment '{id}' not found"))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_dev_environments(project_id: String) -> Result<Vec<DevEnvironment>> {
    let c = db::conn()?;
    list_dev_environments_tx(&c, &project_id)
}

fn list_dev_environments_tx(c: &Connection, project_id: &str) -> Result<Vec<DevEnvironment>> {
    let mut s = c
        .prepare(&format!(
            "SELECT {COLUMNS} FROM dev_environments WHERE project_id=?1 AND state<>'DELETED' ORDER BY created_at"
        ))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(params![project_id], read)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_dev_environment(input: NewDevEnvironment) -> Result<DevEnvironment> {
    let c = db::conn()?;
    create_dev_environment_tx(&c, input)
}

fn create_dev_environment_tx(c: &Connection, input: NewDevEnvironment) -> Result<DevEnvironment> {
    if let Some(owner) = &input.owner_id {
        require_right_on(
            c,
            owner,
            Right::CreateDevEnvironment,
            "Project",
            Some(&input.project_id),
        )?;
    }
    let state = if input.standby { "STANDBY" } else { "STARTING" };
    c.execute(
        "INSERT INTO dev_environments(id,project_id,owner_id,name,repository,branch,ide,instance_type,state,idle_timeout_minutes,last_activity_at) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            input.id,
            input.project_id,
            input.owner_id,
            input.name,
            input.repository,
            input.branch,
            input.ide.unwrap_or_else(|| "IntelliJ IDEA".into()),
            input.instance_type.unwrap_or_else(|| "regular".into()),
            state,
            input.idle_timeout_minutes.unwrap_or(30),
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    get_tx(c, &input.id)
}

/// The environment reports activity: an IDE keystroke, a terminal command, a sync. This is
/// the only thing that holds hibernation off, so it also brings a STARTING one to RUNNING.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn touch_dev_environment(id: String) -> Result<DevEnvironment> {
    let c = db::conn()?;
    touch_dev_environment_tx(&c, &id, now())
}

fn touch_dev_environment_tx(c: &Connection, id: &str, at: i64) -> Result<DevEnvironment> {
    let env = get_tx(c, id)?;
    if env.state == "DELETED" {
        return Err("a deleted dev environment cannot report activity".into());
    }
    c.execute(
        "UPDATE dev_environments SET last_activity_at=?2, state=CASE WHEN state IN ('STARTING','RUNNING') THEN 'RUNNING' ELSE state END WHERE id=?1",
        params![id, at],
    )
    .map_err(|e| e.to_string())?;
    get_tx(c, id)
}

/// Graceful hibernation: the home and working trees are recorded before the state flips, so
/// a resume has something to restore. Ordering matters — a crash between the two writes must
/// not leave a HIBERNATED row without its snapshot, hence one statement.
fn hibernate_tx(c: &Connection, id: &str, at: i64) -> Result<DevEnvironment> {
    let env = get_tx(c, id)?;
    if env.state != "RUNNING" && env.state != "STARTING" {
        return Err(format!(
            "dev environment '{id}' is {} and cannot hibernate",
            env.state
        ));
    }
    c.execute(
        "UPDATE dev_environments SET state='HIBERNATED', hibernated_at=?2, \
         persisted_home=COALESCE(persisted_home, '/home/' || id), \
         persisted_worktree=COALESCE(persisted_worktree, '/work/' || id) WHERE id=?1",
        params![id, at],
    )
    .map_err(|e| e.to_string())?;
    get_tx(c, id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn hibernate_dev_environment(id: String, actor_id: Option<String>) -> Result<DevEnvironment> {
    let c = db::conn()?;
    let env = get_tx(&c, &id)?;
    authorize_manage_tx(&c, &env, actor_id.as_deref())?;
    hibernate_tx(&c, &id, now())
}

/// Anyone but the owner needs the manage right for the project.
fn authorize_manage_tx(c: &Connection, env: &DevEnvironment, actor: Option<&str>) -> Result<()> {
    let Some(actor) = actor else { return Ok(()) };
    if env.owner_id.as_deref() == Some(actor) {
        return Ok(());
    }
    require_right_on(
        c,
        actor,
        Right::ManageDevEnvironmentsInProject,
        "Project",
        Some(&env.project_id),
    )
}

/// Idle sweep: every RUNNING environment whose last activity is older than its own timeout
/// hibernates. Returns the environments that were put to sleep.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn hibernate_idle_dev_environments() -> Result<Vec<DevEnvironment>> {
    let c = db::conn()?;
    hibernate_idle_dev_environments_tx(&c, now())
}

fn hibernate_idle_dev_environments_tx(c: &Connection, at: i64) -> Result<Vec<DevEnvironment>> {
    let due: Vec<String> = {
        let mut s = c
            .prepare(
                "SELECT id FROM dev_environments WHERE state IN ('STARTING','RUNNING') \
                 AND ?1 - last_activity_at >= idle_timeout_minutes * 60",
            )
            .map_err(|e| e.to_string())?;
        let rows = s
            .query_map(params![at], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    due.iter().map(|id| hibernate_tx(c, id, at)).collect()
}

/// Resume restores the preserved trees; an environment that never hibernated has none, and
/// resuming it is an error rather than a silent no-op that would hide a lost snapshot.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn resume_dev_environment(id: String, actor_id: Option<String>) -> Result<DevEnvironment> {
    let c = db::conn()?;
    let env = get_tx(&c, &id)?;
    authorize_manage_tx(&c, &env, actor_id.as_deref())?;
    resume_dev_environment_tx(&c, &id, now())
}

fn resume_dev_environment_tx(c: &Connection, id: &str, at: i64) -> Result<DevEnvironment> {
    let env = get_tx(c, id)?;
    if env.state != "HIBERNATED" {
        return Err(format!(
            "dev environment '{id}' is {} and cannot resume",
            env.state
        ));
    }
    if env.persisted_home.is_none() || env.persisted_worktree.is_none() {
        return Err(format!(
            "dev environment '{id}' hibernated without a preserved home/working tree"
        ));
    }
    c.execute(
        "UPDATE dev_environments SET state='RUNNING', hibernated_at=NULL, last_activity_at=?2 WHERE id=?1",
        params![id, at],
    )
    .map_err(|e| e.to_string())?;
    get_tx(c, id)
}

/// A target makes a standby pool durable: after every claim the same matching
/// pre-warmed record is replenished. `actor_id` is optional only for native/system callers.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_standby_pool_policy(
    policy: StandbyPoolPolicy,
    actor_id: Option<String>,
) -> Result<Vec<DevEnvironment>> {
    let c = db::conn()?;
    if let Some(actor) = actor_id.as_deref() {
        require_right_on(
            &c,
            actor,
            Right::ManageDevEnvironmentsInProject,
            "Project",
            Some(&policy.project_id),
        )?;
    }
    save_standby_pool_policy_tx(&c, &policy)?;
    refill_standby_pool_tx(&c, &policy.project_id, &policy.ide, &policy.instance_type)
}
fn save_standby_pool_policy_tx(c: &Connection, policy: &StandbyPoolPolicy) -> Result<()> {
    if policy.project_id.trim().is_empty()
        || policy.ide.trim().is_empty()
        || policy.instance_type.trim().is_empty()
        || policy.target_size < 0
    {
        return Err(
            "standby pool project, IDE and instance type are required; target must be non-negative"
                .into(),
        );
    }
    c.execute("INSERT INTO dev_environment_pool_policies(project_id,ide,instance_type,target_size,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(project_id,ide,instance_type) DO UPDATE SET target_size=excluded.target_size,updated_at=excluded.updated_at", params![policy.project_id, policy.ide, policy.instance_type, policy.target_size, now()]).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn refill_standby_pool(
    project_id: String,
    ide: String,
    instance_type: String,
) -> Result<Vec<DevEnvironment>> {
    let c = db::conn()?;
    refill_standby_pool_tx(&c, &project_id, &ide, &instance_type)
}
fn refill_standby_pool_tx(
    c: &Connection,
    project_id: &str,
    ide: &str,
    instance_type: &str,
) -> Result<Vec<DevEnvironment>> {
    let target: Option<i64> = c.query_row("SELECT target_size FROM dev_environment_pool_policies WHERE project_id=?1 AND ide=?2 AND instance_type=?3", params![project_id, ide, instance_type], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let Some(target) = target else {
        return Ok(Vec::new());
    };
    let mut added = Vec::new();
    while (c.query_row("SELECT count(*) FROM dev_environments WHERE project_id=?1 AND ide=?2 AND instance_type=?3 AND state='STANDBY'", params![project_id, ide, instance_type], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?) < target {
        let id = new_pool_id();
        c.execute("INSERT INTO dev_environments(id,project_id,owner_id,name,ide,instance_type,state,idle_timeout_minutes,last_activity_at) VALUES(?1,?2,NULL,?3,?4,?5,'STANDBY',30,?6)", params![id, project_id, format!("Standby {ide} ({instance_type})"), ide, instance_type, now()]).map_err(|e| e.to_string())?;
        added.push(get_tx(c, &id)?);
    }
    Ok(added)
}
/// Hot pool claim: the first STANDBY environment in the project becomes this member's own
/// RUNNING environment. The claim is a single conditional UPDATE, so two members racing for
/// the last pre-warmed environment cannot both win it.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn claim_standby_dev_environment(
    project_id: String,
    profile_id: String,
) -> Result<DevEnvironment> {
    let c = db::conn()?;
    claim_standby_dev_environment_tx(&c, &project_id, &profile_id, now())
}

fn claim_standby_dev_environment_tx(
    c: &Connection,
    project_id: &str,
    profile_id: &str,
    at: i64,
) -> Result<DevEnvironment> {
    require_right_on(
        c,
        profile_id,
        Right::JoinHotPoolDevEnvironments,
        "Project",
        Some(project_id),
    )?;
    let candidate: Option<String> = c
        .query_row(
            "SELECT id FROM dev_environments WHERE project_id=?1 AND state='STANDBY' ORDER BY created_at LIMIT 1",
            params![project_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let id = candidate.ok_or_else(|| "the standby pool is empty".to_string())?;
    let claimed = c
        .execute(
            "UPDATE dev_environments SET owner_id=?2,state='RUNNING',last_activity_at=?3 WHERE id=?1 AND state='STANDBY'",
            params![id, profile_id, at],
        )
        .map_err(|e| e.to_string())?;
    if claimed == 0 {
        return Err("the standby environment was claimed by someone else".into());
    }
    let env = get_tx(c, &id)?;
    refill_standby_pool_tx(c, project_id, &env.ide, &env.instance_type)?;
    Ok(env)
}

/// Soft delete: the row stays so the project keeps an audit trail of what existed, but the
/// preserved trees are dropped — a deleted environment must not keep storage alive.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_dev_environment(id: String, actor_id: Option<String>) -> Result<()> {
    let c = db::conn()?;
    let env = get_tx(&c, &id)?;
    authorize_manage_tx(&c, &env, actor_id.as_deref())?;
    c.execute(
        "UPDATE dev_environments SET state='DELETED',persisted_home=NULL,persisted_worktree=NULL WHERE id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().expect("memory db");
        db::migrate(&c).expect("migrate");
        db::seed(&c).expect("seed");
        c
    }

    fn new_env(id: &str, standby: bool) -> NewDevEnvironment {
        NewDevEnvironment {
            id: id.into(),
            project_id: "demo-project".into(),
            owner_id: if standby {
                None
            } else {
                Some("default-org".into())
            },
            name: format!("env {id}"),
            repository: None,
            branch: None,
            ide: None,
            instance_type: None,
            idle_timeout_minutes: Some(30),
            standby,
        }
    }

    #[test]
    fn idle_environment_hibernates_and_resumes_from_its_preserved_trees() {
        let c = conn();
        let start = 1_000_000;
        create_dev_environment_tx(&c, new_env("e1", false)).expect("create");
        touch_dev_environment_tx(&c, "e1", start).expect("touch");

        // 29 minutes of silence is still inside the 30-minute window.
        let early = hibernate_idle_dev_environments_tx(&c, start + 29 * 60).expect("sweep");
        assert!(
            early.is_empty(),
            "29 minutes must not hibernate a 30-minute environment"
        );

        let swept = hibernate_idle_dev_environments_tx(&c, start + 30 * 60).expect("sweep");
        assert_eq!(swept.len(), 1);
        assert_eq!(swept[0].state, "HIBERNATED");
        assert!(swept[0].persisted_home.is_some() && swept[0].persisted_worktree.is_some());

        let resumed = resume_dev_environment_tx(&c, "e1", start + 31 * 60).expect("resume");
        assert_eq!(resumed.state, "RUNNING");
        assert_eq!(resumed.hibernated_at, None);
        assert_eq!(resumed.persisted_home, swept[0].persisted_home);

        // Idempotence guard: resuming a running environment is an error, not a silent pass.
        assert!(resume_dev_environment_tx(&c, "e1", start + 32 * 60).is_err());
    }

    #[test]
    fn claiming_a_standby_environment_transfers_ownership_exactly_once() {
        let c = conn();
        create_dev_environment_tx(&c, new_env("pool-1", true)).expect("create");
        let claimed =
            claim_standby_dev_environment_tx(&c, "demo-project", "default-org", 42).expect("claim");
        assert_eq!(claimed.state, "RUNNING");
        assert_eq!(claimed.owner_id.as_deref(), Some("default-org"));

        let again = claim_standby_dev_environment_tx(&c, "demo-project", "default-org", 43);
        assert!(
            again.is_err(),
            "the pool is empty after the only member is claimed"
        );
    }

    #[test]
    fn pool_target_refills_after_a_claim_without_reassigning_the_claimed_environment() {
        let c = conn();
        let policy = StandbyPoolPolicy {
            project_id: "demo-project".into(),
            ide: "IntelliJ IDEA".into(),
            instance_type: "regular".into(),
            target_size: 2,
        };
        save_standby_pool_policy_tx(&c, &policy).expect("policy");
        assert_eq!(
            refill_standby_pool_tx(&c, &policy.project_id, &policy.ide, &policy.instance_type)
                .unwrap()
                .len(),
            2
        );
        assert!(
            refill_standby_pool_tx(&c, &policy.project_id, &policy.ide, &policy.instance_type)
                .unwrap()
                .is_empty(),
            "refill is idempotent at target"
        );
        let claimed =
            claim_standby_dev_environment_tx(&c, "demo-project", "default-org", 42).expect("claim");
        assert_eq!(claimed.owner_id.as_deref(), Some("default-org"));
        let free: i64 = c.query_row("SELECT count(*) FROM dev_environments WHERE project_id='demo-project' AND ide='IntelliJ IDEA' AND instance_type='regular' AND state='STANDBY'", [], |r| r.get(0)).unwrap();
        assert_eq!(free, 2, "claim replenishes the configured free pool");
    }

    #[test]
    fn deleting_an_environment_drops_its_preserved_storage_and_hides_it() {
        let c = conn();
        create_dev_environment_tx(&c, new_env("e2", false)).expect("create");
        touch_dev_environment_tx(&c, "e2", 100).expect("touch");
        hibernate_tx(&c, "e2", 200).expect("hibernate");

        c.execute(
            "UPDATE dev_environments SET state='DELETED',persisted_home=NULL,persisted_worktree=NULL WHERE id='e2'",
            [],
        )
        .unwrap();
        assert!(list_dev_environments_tx(&c, "demo-project")
            .unwrap()
            .is_empty());
        let env = get_tx(&c, "e2").unwrap();
        assert_eq!(env.persisted_home, None);
    }
}
