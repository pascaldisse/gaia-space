//! Login modules and session TTL policy (KB §05 §3.2 `circlet.client.api.auth.modules`).
//!
//! The login page is not one password form: an org runs several modules at once
//! (local password, LDAP/AD external password, OAuth2/OIDC identity providers),
//! orders them, hides internal-only ones, and gives admins a shorter remember-me
//! lifetime than regular members. Module settings stay opaque JSON here — each
//! kind carries different fields (`serverUrl` for LDAP, `clientId` for OAuth2)
//! and the server only owns their identity, order and enablement.
use crate::db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
type Result<T> = std::result::Result<T, String>;

pub const KINDS: [&str; 4] = ["password", "external-password", "oauth2", "saml"];
/// Defaults match a "stay signed in for a month, admins for a day" policy; every
/// value is configurable, none is compiled in as the only possibility.
pub const DEFAULT_DONT_REMEMBER_ME_TTL_SECS: i64 = 60 * 60 * 12;
pub const DEFAULT_ADMIN_REMEMBER_ME_TTL_SECS: i64 = 60 * 60 * 24;
pub const DEFAULT_USER_REMEMBER_ME_TTL_SECS: i64 = 60 * 60 * 24 * 30;

#[derive(Serialize, Deserialize, Clone)]
pub struct AuthModule {
    pub id: String,
    pub key: String,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    pub hidden: bool,
    pub position: i64,
    /// Opaque per-kind settings blob, stored verbatim.
    pub settings: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct AuthConfig {
    pub dont_remember_me_ttl_secs: i64,
    pub admin_remember_me_ttl_secs: i64,
    pub user_remember_me_ttl_secs: i64,
}
impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            dont_remember_me_ttl_secs: DEFAULT_DONT_REMEMBER_ME_TTL_SECS,
            admin_remember_me_ttl_secs: DEFAULT_ADMIN_REMEMBER_ME_TTL_SECS,
            user_remember_me_ttl_secs: DEFAULT_USER_REMEMBER_ME_TTL_SECS,
        }
    }
}

fn parse_settings(raw: &str) -> serde_json::Value {
    serde_json::from_str(raw).unwrap_or_else(|_| serde_json::json!({}))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_module(
    key: &str,
    name: &str,
    kind: &str,
    enabled: bool,
    hidden: bool,
    settings: Option<serde_json::Value>,
) -> Result<AuthModule> {
    let (key, name) = (key.trim(), name.trim());
    if key.is_empty() || name.is_empty() {
        return Err("module key and name are required".into());
    }
    if !KINDS.contains(&kind) {
        return Err(format!("unknown auth module kind {kind:?}"));
    }
    let settings = settings.unwrap_or_else(|| serde_json::json!({}));
    let c = db::conn()?;
    let position: i64 = c
        .query_row(
            "SELECT coalesce(max(position),-1)+1 FROM auth_modules",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let id = format!("authmod-{}", &crate::auth_security::opaque("")[..16]);
    c.execute(
        "INSERT INTO auth_modules(id,key,name,kind,enabled,hidden,position,settings) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, key, name, kind, enabled as i32, hidden as i32, position, settings.to_string()],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(_, Some(ref m)) if m.contains("UNIQUE") => {
            format!("an auth module with key {key:?} already exists")
        }
        other => other.to_string(),
    })?;
    Ok(AuthModule {
        id,
        key: key.into(),
        name: name.into(),
        kind: kind.into(),
        enabled,
        hidden,
        position,
        settings,
    })
}

/// `with_disabled=false` is the login-page view: enabled and not hidden.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_modules(with_disabled: bool) -> Result<Vec<AuthModule>> {
    let c = db::conn()?;
    let sql = if with_disabled {
        "SELECT id,key,name,kind,enabled,hidden,position,settings FROM auth_modules ORDER BY position, key"
    } else {
        "SELECT id,key,name,kind,enabled,hidden,position,settings FROM auth_modules WHERE enabled=1 AND hidden=0 ORDER BY position, key"
    };
    let mut q = c.prepare(sql).map_err(|e| e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok(AuthModule {
                id: r.get(0)?,
                key: r.get(1)?,
                name: r.get(2)?,
                kind: r.get(3)?,
                enabled: r.get::<_, i64>(4)? == 1,
                hidden: r.get::<_, i64>(5)? == 1,
                position: r.get(6)?,
                settings: parse_settings(&r.get::<_, String>(7)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_module(
    id: &str,
    name: Option<String>,
    enabled: Option<bool>,
    hidden: Option<bool>,
    settings: Option<serde_json::Value>,
) -> Result<bool> {
    let c = db::conn()?;
    let mut touched = false;
    if let Some(name) = name {
        if name.trim().is_empty() {
            return Err("module name is required".into());
        }
        touched |= c
            .execute(
                "UPDATE auth_modules SET name=?1 WHERE id=?2",
                params![name.trim(), id],
            )
            .map_err(|e| e.to_string())?
            > 0;
    }
    if let Some(enabled) = enabled {
        touched |= c
            .execute(
                "UPDATE auth_modules SET enabled=?1 WHERE id=?2",
                params![enabled as i32, id],
            )
            .map_err(|e| e.to_string())?
            > 0;
    }
    if let Some(hidden) = hidden {
        touched |= c
            .execute(
                "UPDATE auth_modules SET hidden=?1 WHERE id=?2",
                params![hidden as i32, id],
            )
            .map_err(|e| e.to_string())?
            > 0;
    }
    if let Some(settings) = settings {
        touched |= c
            .execute(
                "UPDATE auth_modules SET settings=?1 WHERE id=?2",
                params![settings.to_string(), id],
            )
            .map_err(|e| e.to_string())?
            > 0;
    }
    Ok(touched)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_module(id: &str) -> Result<bool> {
    Ok(db::conn()?
        .execute("DELETE FROM auth_modules WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        > 0)
}

/// Reorders the login-page buttons. Ids absent from `order` keep their relative
/// place behind the listed ones.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn reorder_modules(order: Vec<String>) -> Result<()> {
    let c = db::conn()?;
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    for (position, id) in order.iter().enumerate() {
        tx.execute(
            "UPDATE auth_modules SET position=?1 WHERE id=?2",
            params![position as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE auth_modules SET position=position+?1 WHERE id NOT IN (SELECT value FROM json_each(?2))",
        params![order.len() as i64, serde_json::to_string(&order).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn config() -> Result<AuthConfig> {
    let stored = db::conn()?
        .query_row(
            "SELECT dont_remember_me_ttl_secs,admin_remember_me_ttl_secs,user_remember_me_ttl_secs FROM auth_config WHERE id=1",
            [],
            |r| {
                Ok(AuthConfig {
                    dont_remember_me_ttl_secs: r.get(0)?,
                    admin_remember_me_ttl_secs: r.get(1)?,
                    user_remember_me_ttl_secs: r.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(stored.unwrap_or_default())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_config(value: AuthConfig) -> Result<AuthConfig> {
    for ttl in [
        value.dont_remember_me_ttl_secs,
        value.admin_remember_me_ttl_secs,
        value.user_remember_me_ttl_secs,
    ] {
        if ttl <= 0 {
            return Err("remember-me lifetimes must be positive".into());
        }
    }
    db::conn()?
        .execute(
            "INSERT INTO auth_config(id,dont_remember_me_ttl_secs,admin_remember_me_ttl_secs,user_remember_me_ttl_secs) VALUES(1,?1,?2,?3) ON CONFLICT(id) DO UPDATE SET dont_remember_me_ttl_secs=excluded.dont_remember_me_ttl_secs,admin_remember_me_ttl_secs=excluded.admin_remember_me_ttl_secs,user_remember_me_ttl_secs=excluded.user_remember_me_ttl_secs",
            params![
                value.dont_remember_me_ttl_secs,
                value.admin_remember_me_ttl_secs,
                value.user_remember_me_ttl_secs
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(value)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn reset_config() -> Result<AuthConfig> {
    db::conn()?
        .execute("DELETE FROM auth_config WHERE id=1", [])
        .map_err(|e| e.to_string())?;
    Ok(AuthConfig::default())
}

/// Session lifetime for one sign-in: an unchecked "remember me" is the short
/// lifetime, and an admin session never outlives the admin policy.
pub fn session_ttl_secs(cfg: AuthConfig, remember_me: bool, is_admin: bool) -> i64 {
    if !remember_me {
        cfg.dont_remember_me_ttl_secs
    } else if is_admin {
        cfg.admin_remember_me_ttl_secs
    } else {
        cfg.user_remember_me_ttl_secs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_remember_me_never_borrows_the_longer_member_lifetime() {
        let cfg = AuthConfig::default();
        assert_eq!(
            session_ttl_secs(cfg, false, true),
            cfg.dont_remember_me_ttl_secs
        );
        assert_eq!(
            session_ttl_secs(cfg, true, true),
            cfg.admin_remember_me_ttl_secs
        );
        assert_eq!(
            session_ttl_secs(cfg, true, false),
            cfg.user_remember_me_ttl_secs
        );
        assert!(cfg.admin_remember_me_ttl_secs < cfg.user_remember_me_ttl_secs);
    }
}
