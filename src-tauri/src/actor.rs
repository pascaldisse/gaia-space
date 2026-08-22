//! Native actor authority.
//!
//! The webview may name *what* to act on; it may never name *who is acting*.
//! Every privileged desktop command resolves the acting profile here, from
//! sources the renderer cannot reach:
//!
//! 1. `GAIA_SPACE_ACTOR_PROFILE` — the native process environment, set by the
//!    launcher/deployment. Must resolve to a live profile row or the call fails.
//! 2. The sole live profile in the local database. A single-profile desktop
//!    install has no ambiguity about who the local user is; that is a fact of
//!    the machine, not a claim of the page.
//!
//! Anything else (no profiles, several profiles and no environment binding) is
//! **unresolvable**, and unresolvable means refuse. The desktop shell has no
//! session cookie to fall back on, so guessing here would silently restore the
//! self-declaration hole this module exists to close.
use rusqlite::Connection;

type Result<T> = std::result::Result<T, String>;

/// Environment variable that pins the desktop actor. Deployment-configurable;
/// never a compiled-in profile id.
pub const ACTOR_PROFILE_ENV: &str = "GAIA_SPACE_ACTOR_PROFILE";

/// Where a resolved actor came from. Reported to the UI so the interface can
/// explain itself instead of pretending a control works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorSource {
    /// Pinned by the native process environment.
    Environment,
    /// The one live profile on this installation.
    SoleProfile,
}

/// Truthful answer to "can this machine say who I am?". `profile_id` is present
/// exactly when `available` is true; otherwise `reason` carries the refusal in
/// words a user can act on.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ActorStatus {
    pub available: bool,
    pub profile_id: Option<String>,
    pub source: Option<ActorSource>,
    pub reason: Option<String>,
}

fn live_profile_exists(connection: &Connection, profile_id: &str) -> Result<bool> {
    connection
        .query_row(
            "SELECT 1 FROM profiles WHERE id=?1 AND archived=0",
            rusqlite::params![profile_id],
            |_| Ok(()),
        )
        .map(|_| true)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other.to_string()),
        })
}

fn live_profile_ids(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection
        .prepare("SELECT id FROM profiles WHERE archived=0 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

fn env_actor() -> Option<String> {
    std::env::var(ACTOR_PROFILE_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Resolve the acting profile from trusted native state, or explain why not.
/// Never consults command arguments — that is the whole point.
pub fn resolve(connection: &Connection) -> Result<(String, ActorSource)> {
    if let Some(pinned) = env_actor() {
        return if live_profile_exists(connection, &pinned)? {
            Ok((pinned, ActorSource::Environment))
        } else {
            Err(format!(
                "{ACTOR_PROFILE_ENV} names profile {pinned:?}, which is not a live profile on this installation"
            ))
        };
    }
    let profiles = live_profile_ids(connection)?;
    match profiles.len() {
        1 => Ok((profiles[0].clone(), ActorSource::SoleProfile)),
        0 => Err("This installation has no profile, so the app cannot tell who is acting".into()),
        count => Err(format!(
            "This installation has {count} profiles, so the app cannot tell who is acting; set {ACTOR_PROFILE_ENV} to the profile that owns this desktop session"
        )),
    }
}

/// Non-throwing view of [`resolve`], for UI that must show the truth up front.
pub fn status(connection: &Connection) -> ActorStatus {
    match resolve(connection) {
        Ok((profile_id, source)) => ActorStatus {
            available: true,
            profile_id: Some(profile_id),
            source: Some(source),
            reason: None,
        },
        Err(reason) => ActorStatus {
            available: false,
            profile_id: None,
            source: None,
            reason: Some(reason),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE profiles (id TEXT PRIMARY KEY, archived INTEGER NOT NULL DEFAULT 0)",
            )
            .unwrap();
        connection
    }

    fn add(connection: &Connection, id: &str, archived: i64) {
        connection
            .execute(
                "INSERT INTO profiles (id, archived) VALUES (?1, ?2)",
                rusqlite::params![id, archived],
            )
            .unwrap();
    }

    // The variable is process-global state and `cargo test` runs threads, so every
    // test that touches it serialises on this lock and restores what it found.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_env<T>(pinned: Option<&str>, body: impl FnOnce() -> T) -> T {
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var(ACTOR_PROFILE_ENV).ok();
        match pinned {
            Some(value) => std::env::set_var(ACTOR_PROFILE_ENV, value),
            None => std::env::remove_var(ACTOR_PROFILE_ENV),
        }
        let out = body();
        match previous {
            Some(value) => std::env::set_var(ACTOR_PROFILE_ENV, value),
            None => std::env::remove_var(ACTOR_PROFILE_ENV),
        }
        drop(guard);
        out
    }

    fn without_env<T>(body: impl FnOnce() -> T) -> T {
        with_env(None, body)
    }

    #[test]
    fn sole_live_profile_is_the_actor() {
        without_env(|| {
            let connection = memory_db();
            add(&connection, "only-me", 0);
            add(&connection, "retired", 1);
            assert_eq!(
                resolve(&connection).unwrap(),
                ("only-me".to_string(), ActorSource::SoleProfile)
            );
        });
    }

    #[test]
    fn several_profiles_without_a_pin_fail_closed() {
        without_env(|| {
            let connection = memory_db();
            add(&connection, "a", 0);
            add(&connection, "b", 0);
            let error = resolve(&connection).unwrap_err();
            assert!(error.contains("cannot tell who is acting"), "{error}");
            let status = status(&connection);
            assert!(!status.available && status.profile_id.is_none());
        });
    }

    #[test]
    fn empty_installation_fails_closed() {
        without_env(|| {
            let connection = memory_db();
            assert!(resolve(&connection).is_err());
        });
    }

    #[test]
    fn environment_pin_must_name_a_live_profile() {
        let connection = memory_db();
        add(&connection, "a", 0);
        add(&connection, "b", 0);
        add(&connection, "gone", 1);
        with_env(Some("b"), || {
            assert_eq!(
                resolve(&connection).unwrap(),
                ("b".to_string(), ActorSource::Environment)
            );
        });
        // An archived or unknown pin is a misconfiguration, not a licence to guess.
        with_env(Some("gone"), || {
            assert!(resolve(&connection)
                .unwrap_err()
                .contains("not a live profile"));
        });
        with_env(Some("never-existed"), || {
            assert!(resolve(&connection).is_err());
        });
    }
}
