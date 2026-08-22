//! OAuth2 authorization-code flow with PKCE (RFC 6749 §4.1, RFC 7636).
//!
//! Registration reuses `applications` (client_id, code_flow_enabled, pkce_required);
//! this module adds the exact-match redirect-URI allowlist, single-use authorization
//! codes, and bearer access tokens. Every credential is Argon2-hashed at rest and its
//! plaintext leaves exactly once, at mint time. A code carries its own row id
//! (`<id>.<secret>`) so verification is a single indexed lookup, never a table scan.
use crate::db;
use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type Result<T> = std::result::Result<T, String>;

/// Lifetimes are policy, not constants: the defaults follow RFC 6749 §4.1.2
/// ("maximum authorization code lifetime of 10 minutes") and are overridable per
/// deployment through the environment.
#[derive(Clone, Copy, Debug)]
pub struct OAuthConfig {
    pub code_ttl_secs: i64,
    pub access_token_ttl_secs: i64,
}
pub const DEFAULT_CODE_TTL_SECS: i64 = 600;
pub const DEFAULT_ACCESS_TOKEN_TTL_SECS: i64 = 3600;
impl Default for OAuthConfig {
    fn default() -> Self {
        Self {
            code_ttl_secs: DEFAULT_CODE_TTL_SECS,
            access_token_ttl_secs: DEFAULT_ACCESS_TOKEN_TTL_SECS,
        }
    }
}
impl OAuthConfig {
    /// `SPACE_OAUTH_CODE_TTL` / `SPACE_OAUTH_TOKEN_TTL`, in seconds.
    pub fn from_env() -> Self {
        let read = |key: &str, fallback: i64| {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse::<i64>().ok())
                .filter(|v| *v > 0)
                .unwrap_or(fallback)
        };
        Self {
            code_ttl_secs: read("SPACE_OAUTH_CODE_TTL", DEFAULT_CODE_TTL_SECS),
            access_token_ttl_secs: read("SPACE_OAUTH_TOKEN_TTL", DEFAULT_ACCESS_TOKEN_TTL_SECS),
        }
    }
}

fn secret(bytes: usize) -> String {
    let mut raw = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut raw);
    hex::encode(raw)
}
fn id(prefix: &str) -> String {
    format!("{prefix}-{}", &secret(12))
}
fn hash(value: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(value.as_bytes(), &salt)
        .map(|v| v.to_string())
        .map_err(|e| e.to_string())
}
fn matches(value: &str, stored: &str) -> bool {
    PasswordHash::new(stored)
        .ok()
        .and_then(|p| Argon2::default().verify_password(value.as_bytes(), &p).ok())
        .is_some()
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Exact string match, per RFC 6749 §3.1.2.3 — no prefix or wildcard matching:
/// a loose comparison is the classic redirect-URI token-leak hole.
pub fn register_redirect_uri(application_id: &str, redirect_uri: &str) -> Result<()> {
    let uri = redirect_uri.trim();
    if uri.is_empty() {
        return Err("redirect_uri is required".into());
    }
    if uri.contains('#') {
        return Err("redirect_uri must not carry a fragment".into());
    }
    if !(uri.starts_with("https://") || uri.starts_with("http://localhost")) {
        return Err("redirect_uri must be https (http only for localhost)".into());
    }
    let c = db::conn()?;
    let known: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM applications WHERE id=?1)",
            [application_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !known {
        return Err("application not found".into());
    }
    c.execute(
        "INSERT OR IGNORE INTO oauth_redirect_uris(application_id,redirect_uri) VALUES(?1,?2)",
        params![application_id, uri],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn list_redirect_uris(application_id: &str) -> Result<Vec<String>> {
    let c = db::conn()?;
    let mut q = c
        .prepare("SELECT redirect_uri FROM oauth_redirect_uris WHERE application_id=?1 ORDER BY redirect_uri")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([application_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
pub fn delete_redirect_uri(application_id: &str, redirect_uri: &str) -> Result<bool> {
    Ok(db::conn()?
        .execute(
            "DELETE FROM oauth_redirect_uris WHERE application_id=?1 AND redirect_uri=?2",
            params![application_id, redirect_uri],
        )
        .map_err(|e| e.to_string())?
        > 0)
}

#[derive(Clone, Debug, Deserialize)]
pub struct AuthorizeRequest {
    pub client_id: String,
    pub redirect_uri: String,
    pub response_type: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub code_challenge: Option<String>,
    #[serde(default)]
    pub code_challenge_method: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct AuthorizeGrant {
    pub code: String,
    pub redirect_uri: String,
    pub state: Option<String>,
    pub expires_at: i64,
}
struct Client {
    id: String,
    pkce_required: bool,
}
fn code_client(client_id: &str) -> Result<Client> {
    let c = db::conn()?;
    let row: Option<(String, bool, bool)> = c
        .query_row(
            "SELECT id,code_flow_enabled,pkce_required FROM applications WHERE client_id=?1 AND archived=0",
            [client_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((id, code_flow_enabled, pkce_required)) = row else {
        return Err("unknown client_id".into());
    };
    if !code_flow_enabled {
        return Err("authorization-code flow is disabled for this application".into());
    }
    Ok(Client { id, pkce_required })
}
fn redirect_allowed(application_id: &str, redirect_uri: &str) -> Result<bool> {
    db::conn()?
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM oauth_redirect_uris WHERE application_id=?1 AND redirect_uri=?2)",
            params![application_id, redirect_uri],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
}

/// The resource owner has already consented at this point; this mints the code.
pub fn authorize(
    user_id: &str,
    req: &AuthorizeRequest,
    cfg: OAuthConfig,
) -> Result<AuthorizeGrant> {
    if req.response_type != "code" {
        return Err("unsupported response_type".into());
    }
    let client = code_client(&req.client_id)?;
    if !redirect_allowed(&client.id, &req.redirect_uri)? {
        return Err("redirect_uri is not registered for this application".into());
    }
    let challenge = match (&req.code_challenge, req.code_challenge_method.as_deref()) {
        (Some(challenge), method) if !challenge.trim().is_empty() => {
            // S256 only: `plain` re-exposes the verifier to whoever stole the code.
            if method.unwrap_or("plain") != "S256" {
                return Err("code_challenge_method must be S256".into());
            }
            Some(challenge.trim().to_string())
        }
        _ if client.pkce_required => {
            return Err("code_challenge is required for this application".into())
        }
        _ => None,
    };
    let (code_id, code_secret) = (id("ac"), secret(32));
    let raw = format!("{code_id}.{code_secret}");
    let issued = now();
    let expires_at = issued + cfg.code_ttl_secs;
    db::conn()?.execute(
        "INSERT INTO oauth_auth_codes(id,code_hash,application_id,user_id,redirect_uri,scope,code_challenge,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![code_id, hash(&code_secret)?, client.id, user_id, req.redirect_uri, req.scope.trim(), challenge, issued, expires_at],
    ).map_err(|e| e.to_string())?;
    Ok(AuthorizeGrant {
        code: raw,
        redirect_uri: req.redirect_uri.clone(),
        state: req.state.clone(),
        expires_at,
    })
}

#[derive(Clone, Debug, Deserialize)]
pub struct TokenRequest {
    pub grant_type: String,
    pub client_id: String,
    pub code: String,
    pub redirect_uri: String,
    #[serde(default)]
    pub code_verifier: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub scope: String,
}
fn s256(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Single use: the code row is consumed inside the same statement that claims it,
/// so a replay (or a race) finds nothing to claim.
pub fn exchange_code(req: &TokenRequest, cfg: OAuthConfig) -> Result<TokenResponse> {
    if req.grant_type != "authorization_code" {
        return Err("unsupported grant_type".into());
    }
    let client = code_client(&req.client_id)?;
    let (code_id, code_secret) = req
        .code
        .split_once('.')
        .ok_or_else(|| "invalid authorization code".to_string())?;
    let c = db::conn()?;
    let row: Option<(String, String, String, String, String, Option<String>, i64)> = c
        .query_row(
            "SELECT code_hash,application_id,user_id,redirect_uri,scope,code_challenge,expires_at FROM oauth_auth_codes WHERE id=?1 AND consumed_at IS NULL",
            [code_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((code_hash, application_id, user_id, redirect_uri, scope, challenge, expires_at)) =
        row
    else {
        return Err("invalid authorization code".into());
    };
    // Burn first, judge after: even a failed exchange must retire the code.
    let claimed = c
        .execute(
            "UPDATE oauth_auth_codes SET consumed_at=unixepoch() WHERE id=?1 AND consumed_at IS NULL",
            [code_id],
        )
        .map_err(|e| e.to_string())?;
    if claimed == 0 {
        return Err("invalid authorization code".into());
    }
    if !matches(code_secret, &code_hash) || application_id != client.id {
        return Err("invalid authorization code".into());
    }
    if now() > expires_at {
        return Err("authorization code has expired".into());
    }
    if redirect_uri != req.redirect_uri {
        return Err("redirect_uri does not match the authorization request".into());
    }
    if let Some(challenge) = challenge {
        let verifier = req
            .code_verifier
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "code_verifier is required".to_string())?;
        if !(43..=128).contains(&verifier.len()) {
            return Err("code_verifier length must be 43..=128".into());
        }
        if s256(verifier) != challenge {
            return Err("code_verifier does not match the code_challenge".into());
        }
    }
    let (token_id, token_secret) = (id("at"), secret(32));
    let issued = now();
    c.execute(
        "INSERT INTO oauth_access_tokens(id,token_hash,application_id,user_id,scope,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![token_id, hash(&token_secret)?, application_id, user_id, scope, issued, issued + cfg.access_token_ttl_secs],
    ).map_err(|e| e.to_string())?;
    Ok(TokenResponse {
        access_token: format!("spoa_{token_id}.{token_secret}"),
        token_type: "Bearer".into(),
        expires_in: cfg.access_token_ttl_secs,
        scope,
    })
}

/// Bearer resolution for the API surface: `(user_id, scope)` of a live token.
pub fn access_token_owner(raw: &str) -> Result<Option<(String, String)>> {
    let Some(rest) = raw.strip_prefix("spoa_") else {
        return Ok(None);
    };
    let Some((token_id, token_secret)) = rest.split_once('.') else {
        return Ok(None);
    };
    let c = db::conn()?;
    let row: Option<(String, String, String)> = c
        .query_row(
            "SELECT token_hash,user_id,scope FROM oauth_access_tokens WHERE id=?1 AND revoked_at IS NULL AND expires_at>unixepoch()",
            [token_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((stored, user_id, scope)) = row else {
        return Ok(None);
    };
    if !matches(token_secret, &stored) {
        return Ok(None);
    }
    c.execute(
        "UPDATE oauth_access_tokens SET last_used_at=unixepoch() WHERE id=?1",
        [token_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(Some((user_id, scope)))
}
pub fn revoke_access_token(user_id: &str, token_id: &str) -> Result<bool> {
    Ok(db::conn()?
        .execute(
            "UPDATE oauth_access_tokens SET revoked_at=unixepoch() WHERE id=?1 AND user_id=?2 AND revoked_at IS NULL",
            params![token_id, user_id],
        )
        .map_err(|e| e.to_string())?
        > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh database per case. `SPACE_DB` is process-global, so the serial guard is
    /// what keeps a parallel sibling from running against this one.
    fn with_db(body: impl FnOnce()) {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("oauth-tests");
        std::env::set_var("SPACE_DB", temp.path());
        let c = db::conn().expect("temp database");
        db::seed(&c).expect("seed");
        body()
    }

    const VERIFIER: &str = "verifier-0123456789012345678901234567890123456789";

    fn app(client_id: &str, pkce_required: bool) -> String {
        let app_id = format!("app-{client_id}");
        db::conn().unwrap().execute(
            "INSERT INTO applications(id,name,application_type,client_id,code_flow_enabled,pkce_required) VALUES(?1,?2,'Application',?3,1,?4)",
            params![app_id, client_id, client_id, pkce_required],
        ).unwrap();
        db::conn()
            .unwrap()
            .execute(
                "INSERT OR IGNORE INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('u1','u1','x','U','default-org','member',unixepoch())",
                [],
            )
            .unwrap();
        register_redirect_uri(&app_id, "https://client.example/cb").unwrap();
        app_id
    }
    fn request(client_id: &str, challenge: Option<&str>) -> AuthorizeRequest {
        AuthorizeRequest {
            client_id: client_id.into(),
            redirect_uri: "https://client.example/cb".into(),
            response_type: "code".into(),
            scope: "project:read".into(),
            state: Some("xyz".into()),
            code_challenge: challenge.map(str::to_string),
            code_challenge_method: challenge.map(|_| "S256".to_string()),
        }
    }
    fn token_request(client_id: &str, code: &str, verifier: Option<&str>) -> TokenRequest {
        TokenRequest {
            grant_type: "authorization_code".into(),
            client_id: client_id.into(),
            code: code.into(),
            redirect_uri: "https://client.example/cb".into(),
            code_verifier: verifier.map(str::to_string),
        }
    }

    #[test]
    fn pkce_code_exchanges_once_and_never_again() {
        with_db(|| {
            app("c1", true);
            let cfg = OAuthConfig::default();
            let grant = authorize("u1", &request("c1", Some(&s256(VERIFIER))), cfg).unwrap();
            assert_eq!(grant.state.as_deref(), Some("xyz"));
            let token =
                exchange_code(&token_request("c1", &grant.code, Some(VERIFIER)), cfg).unwrap();
            assert_eq!(token.token_type, "Bearer");
            assert_eq!(token.scope, "project:read");
            assert_eq!(
                access_token_owner(&token.access_token).unwrap(),
                Some(("u1".into(), "project:read".into())),
                "the minted bearer resolves to its resource owner"
            );
            assert!(
                exchange_code(&token_request("c1", &grant.code, Some(VERIFIER)), cfg).is_err(),
                "a replayed authorization code is refused"
            );
        });
    }

    #[test]
    fn a_wrong_verifier_burns_the_code_without_minting() {
        with_db(|| {
            let app_id = app("c2", true);
            let cfg = OAuthConfig::default();
            let grant = authorize("u1", &request("c2", Some(&s256(VERIFIER))), cfg).unwrap();
            let wrong = "wrong-000000000000000000000000000000000000000";
            assert!(exchange_code(&token_request("c2", &grant.code, Some(wrong)), cfg).is_err());
            assert!(
                exchange_code(&token_request("c2", &grant.code, Some(VERIFIER)), cfg).is_err(),
                "a failed exchange still retires the code"
            );
            let minted: i64 = db::conn()
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM oauth_access_tokens WHERE application_id=?1",
                    [&app_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(minted, 0);
        });
    }

    #[test]
    fn pkce_is_mandatory_when_the_application_demands_it() {
        with_db(|| {
            app("c3", true);
            assert!(authorize("u1", &request("c3", None), OAuthConfig::default()).is_err());
        });
    }

    #[test]
    fn an_unregistered_redirect_uri_is_refused() {
        with_db(|| {
            app("c4", false);
            let mut req = request("c4", None);
            req.redirect_uri = "https://client.example/cb/evil".into();
            assert!(
                authorize("u1", &req, OAuthConfig::default()).is_err(),
                "redirect_uri matching is exact, not prefix"
            );
        });
    }

    #[test]
    fn a_mismatched_redirect_uri_at_exchange_is_refused() {
        with_db(|| {
            app("c5", false);
            let cfg = OAuthConfig::default();
            let grant = authorize("u1", &request("c5", None), cfg).unwrap();
            let mut req = token_request("c5", &grant.code, None);
            req.redirect_uri = "https://client.example/other".into();
            assert!(exchange_code(&req, cfg).is_err());
        });
    }

    #[test]
    fn an_expired_code_is_refused() {
        with_db(|| {
            app("c6", false);
            let cfg = OAuthConfig {
                code_ttl_secs: 1,
                ..OAuthConfig::default()
            };
            let grant = authorize("u1", &request("c6", None), cfg).unwrap();
            db::conn()
                .unwrap()
                .execute(
                    "UPDATE oauth_auth_codes SET expires_at=unixepoch()-1 WHERE id=?1",
                    [grant.code.split_once('.').unwrap().0],
                )
                .unwrap();
            let err = exchange_code(&token_request("c6", &grant.code, None), cfg).unwrap_err();
            assert!(err.contains("expired"), "{err}");
        });
    }

    #[test]
    fn the_code_plaintext_is_never_stored() {
        with_db(|| {
            app("c7", false);
            let grant = authorize("u1", &request("c7", None), OAuthConfig::default()).unwrap();
            let secret = grant.code.split_once('.').unwrap().1;
            let hits: i64 = db::conn()
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM oauth_auth_codes WHERE code_hash LIKE '%' || ?1 || '%'",
                    [secret],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(hits, 0, "only the Argon2 digest is at rest");
        });
    }

    #[test]
    fn ttl_policy_comes_from_the_environment_with_defaults() {
        let cfg = OAuthConfig::default();
        assert_eq!(cfg.code_ttl_secs, DEFAULT_CODE_TTL_SECS);
        assert_eq!(cfg.access_token_ttl_secs, DEFAULT_ACCESS_TOKEN_TTL_SECS);
    }
}
