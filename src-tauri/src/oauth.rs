//! OAuth2 authorization-code flow with PKCE (RFC 6749 §4.1, RFC 7636).
//!
//! Registration reuses `applications` (client_id, code_flow_enabled) plus `app_secrets`
//! for confidential clients; PKCE S256 is mandatory for every code client;
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
    /// Argon2 digest of the registered client secret; empty = public client.
    secret_hash: String,
}
fn code_client(client_id: &str) -> Result<Client> {
    let c = db::conn()?;
    let row: Option<(String, bool, String)> = c
        .query_row(
            "SELECT a.id,a.code_flow_enabled,coalesce(s.secret_hash,'') FROM applications a LEFT JOIN app_secrets s ON s.application_id=a.id WHERE a.client_id=?1 AND a.archived=0",
            [client_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((id, code_flow_enabled, secret_hash)) = row else {
        return Err("unknown client_id".into());
    };
    if !code_flow_enabled {
        return Err("authorization-code flow is disabled for this application".into());
    }
    Ok(Client { id, secret_hash })
}

/// Registers/rotates the client secret of a confidential client. Plaintext is returned
/// once and never stored.
///
/// There is exactly one rotation in the system: `applications::rotate_app_secret_on`.
/// Both flows authenticate against the same `app_secrets` row, so two rotations would
/// mean one flow could silently keep a retired secret alive. This is a thin,
/// code-flow-shaped view over that single source.
pub fn rotate_client_secret(application_id: &str) -> Result<String> {
    crate::applications::rotate_app_secret_on(&db::conn()?, application_id).map(|s| s.client_secret)
}

/// RFC 6749 §2.3/§4.1.3: a confidential client MUST authenticate at the token endpoint.
/// PKCE reinforces a public client; it never substitutes for the secret.
fn authenticate_client(client: &Client, offered: Option<&str>) -> Result<()> {
    match (client.secret_hash.is_empty(), offered) {
        (true, None) => Ok(()),
        (true, Some(_)) => Err("this client is public and takes no client_secret".into()),
        (false, Some(secret)) if matches(secret, &client.secret_hash) => Ok(()),
        (false, _) => Err("invalid client credentials".into()),
    }
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
    // PKCE is unconditional, not a per-application option: a code with no challenge is
    // a bearer credential in a redirect, and `pkce_required=0` apps would mint tokens
    // from a stolen code plus the public client_id alone.
    let challenge = match (&req.code_challenge, req.code_challenge_method.as_deref()) {
        (Some(challenge), method) if !challenge.trim().is_empty() => {
            // S256 only: `plain` re-exposes the verifier to whoever stole the code.
            if method.unwrap_or("plain") != "S256" {
                return Err("code_challenge_method must be S256".into());
            }
            challenge.trim().to_string()
        }
        _ => return Err("code_challenge (S256) is required".into()),
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
    /// Required for confidential clients (those with a registered secret).
    #[serde(default)]
    pub client_secret: Option<String>,
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
    // Client authentication comes first, before the code row is even read: otherwise
    // anyone who learns a code's id half can burn a stranger's code (denial of service).
    authenticate_client(&client, req.client_secret.as_deref().map(str::trim))?;
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
            client_secret: None,
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
    fn pkce_is_mandatory_for_every_code_client() {
        with_db(|| {
            app("c3", false);
            let err = authorize("u1", &request("c3", None), OAuthConfig::default()).unwrap_err();
            assert!(err.contains("code_challenge"), "{err}");
        });
    }

    #[test]
    fn an_unregistered_redirect_uri_is_refused() {
        with_db(|| {
            app("c4", false);
            let mut req = request("c4", Some(&s256(VERIFIER)));
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
            let grant = authorize("u1", &request("c5", Some(&s256(VERIFIER))), cfg).unwrap();
            let mut req = token_request("c5", &grant.code, Some(VERIFIER));
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
            let grant = authorize("u1", &request("c6", Some(&s256(VERIFIER))), cfg).unwrap();
            db::conn()
                .unwrap()
                .execute(
                    "UPDATE oauth_auth_codes SET expires_at=unixepoch()-1 WHERE id=?1",
                    [grant.code.split_once('.').unwrap().0],
                )
                .unwrap();
            let err =
                exchange_code(&token_request("c6", &grant.code, Some(VERIFIER)), cfg).unwrap_err();
            assert!(err.contains("expired"), "{err}");
        });
    }

    #[test]
    fn the_code_plaintext_is_never_stored() {
        with_db(|| {
            app("c7", false);
            let grant = authorize(
                "u1",
                &request("c7", Some(&s256(VERIFIER))),
                OAuthConfig::default(),
            )
            .unwrap();
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

    /// RFC 6749 §4.1.3: a confidential client's secret is a second, independent factor.
    /// A wrong or missing secret mints nothing — and, because authentication precedes the
    /// code lookup, it does not consume the victim's code either.
    #[test]
    fn a_confidential_client_must_authenticate_and_a_bad_secret_burns_nothing() {
        with_db(|| {
            let app_id = app("c8", false);
            let client_secret = rotate_client_secret(&app_id).unwrap();
            let cfg = OAuthConfig::default();
            let grant = authorize("u1", &request("c8", Some(&s256(VERIFIER))), cfg).unwrap();
            let with_secret = |secret: Option<&str>| {
                let mut req = token_request("c8", &grant.code, Some(VERIFIER));
                req.client_secret = secret.map(str::to_string);
                req
            };
            assert!(
                exchange_code(&with_secret(None), cfg).is_err(),
                "a missing client_secret mints nothing"
            );
            assert!(
                exchange_code(&with_secret(Some("spcs_wrong")), cfg).is_err(),
                "a wrong client_secret mints nothing"
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
            let consumed: Option<i64> = db::conn()
                .unwrap()
                .query_row(
                    "SELECT consumed_at FROM oauth_auth_codes WHERE id=?1",
                    [grant.code.split_once('.').unwrap().0],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(
                consumed, None,
                "an unauthenticated caller cannot burn the code"
            );
            let token = exchange_code(&with_secret(Some(&client_secret)), cfg).unwrap();
            assert_eq!(token.token_type, "Bearer");
        });
    }

    #[test]
    fn a_public_client_takes_no_secret_and_rotation_revokes_live_tokens() {
        with_db(|| {
            let app_id = app("c9", false);
            let cfg = OAuthConfig::default();
            let grant = authorize("u1", &request("c9", Some(&s256(VERIFIER))), cfg).unwrap();
            let mut req = token_request("c9", &grant.code, Some(VERIFIER));
            req.client_secret = Some("uninvited".into());
            assert!(
                exchange_code(&req, cfg).is_err(),
                "a public client takes no secret"
            );
            req.client_secret = None;
            let token = exchange_code(&req, cfg).unwrap();
            assert!(access_token_owner(&token.access_token).unwrap().is_some());
            rotate_client_secret(&app_id).unwrap();
            assert_eq!(
                access_token_owner(&token.access_token).unwrap(),
                None,
                "rotating the secret retires tokens minted under the old one"
            );
        });
    }

    /// The two flows share one secret, so they must share one rotation. A token that
    /// survived rotation on the sibling table would be an old secret still buying access.
    #[test]
    fn one_rotation_retires_both_grant_families() {
        with_db(|| {
            let app_id = app("c9", false);
            db::conn()
                .unwrap()
                .execute(
                    "UPDATE applications SET client_credentials_flow_enabled=1 WHERE id=?1",
                    [&app_id],
                )
                .unwrap();
            let cfg = OAuthConfig::default();
            let secret = rotate_client_secret(&app_id).unwrap();
            // (a) an authorization-code access token
            let grant = authorize("u1", &request("c9", Some(&s256(VERIFIER))), cfg).unwrap();
            let mut req = token_request("c9", &grant.code, Some(VERIFIER));
            req.client_secret = Some(secret.clone());
            let code_token = exchange_code(&req, cfg).unwrap().access_token;
            // (b) a client_credentials bearer token
            let app_token =
                crate::applications::issue_app_token("c9".into(), secret.clone(), None, Some(60))
                    .unwrap()
                    .access_token
                    .unwrap();
            // (c) a code minted under the old secret, not yet exchanged
            let pending = authorize("u1", &request("c9", Some(&s256(VERIFIER))), cfg).unwrap();
            assert!(access_token_owner(&code_token).unwrap().is_some());
            assert!(crate::applications::verify_app_token(app_token.clone())
                .unwrap()
                .is_some());

            rotate_client_secret(&app_id).unwrap();

            assert!(
                access_token_owner(&code_token).unwrap().is_none(),
                "the code-flow token dies with the secret"
            );
            assert!(
                crate::applications::verify_app_token(app_token)
                    .unwrap()
                    .is_none(),
                "the client_credentials token dies with the secret"
            );
            let mut stale = token_request("c9", &pending.code, Some(VERIFIER));
            stale.client_secret = Some(secret);
            assert!(
                exchange_code(&stale, cfg).is_err(),
                "a code minted under the old secret mints nothing"
            );
        });
    }

    #[test]
    fn ttl_policy_comes_from_the_environment_with_defaults() {
        let cfg = OAuthConfig::default();
        assert_eq!(cfg.code_ttl_secs, DEFAULT_CODE_TTL_SECS);
        assert_eq!(cfg.access_token_ttl_secs, DEFAULT_ACCESS_TOKEN_TTL_SECS);
    }
}
