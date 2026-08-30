use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{any, get, patch, post, put},
    Json, Router,
};
use gaia_space_lib::{
    app_rights, applications, blogs, calendar_feeds, calls, channel_feeds, channel_notes, chat,
    chatbot, db,
    devenv, documents, events, issues, leads, meetings, oauth, organization, package_registry,
    payload_dispatch, personal, pipelines, platform, review,
};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Digest;
use std::{
    collections::HashMap,
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const PARAMETER_SECRET_MASK: &str = "***";
const LOGIN_MAX_FAILED_ATTEMPTS: u32 = 5;
const LOGIN_LOCKOUT_WINDOW: Duration = Duration::from_secs(60);
#[derive(Clone)]
struct App {
    login_limiter: Arc<Mutex<LoginRateLimiter>>,
}
impl App {
    fn new() -> Self {
        Self {
            login_limiter: Arc::new(Mutex::new(LoginRateLimiter::default())),
        }
    }
}
#[derive(Default)]
struct LoginRateLimiter {
    accounts: HashMap<String, LoginFailures>,
    source_ips: HashMap<IpAddr, LoginFailures>,
}
#[derive(Default)]
struct LoginFailures {
    attempts: u32,
    locked_until: Option<Instant>,
}
impl LoginRateLimiter {
    fn key_is_locked<K: std::cmp::Eq + std::hash::Hash>(
        entries: &mut HashMap<K, LoginFailures>,
        key: &K,
        now: Instant,
    ) -> bool {
        let until = entries.get(key).and_then(|failure| failure.locked_until);
        if until.is_some_and(|until| until <= now) {
            entries.remove(key);
            false
        } else {
            until.is_some()
        }
    }
    fn is_locked(&mut self, account: &str, source_ip: IpAddr) -> bool {
        let now = Instant::now();
        Self::key_is_locked(&mut self.accounts, &account.to_string(), now)
            || Self::key_is_locked(&mut self.source_ips, &source_ip, now)
    }
    fn record_key_failure<K: std::cmp::Eq + std::hash::Hash>(
        entries: &mut HashMap<K, LoginFailures>,
        key: K,
        now: Instant,
    ) -> bool {
        let entry = entries.entry(key).or_default();
        entry.attempts = entry.attempts.saturating_add(1);
        if entry.attempts >= LOGIN_MAX_FAILED_ATTEMPTS {
            entry.locked_until = Some(now + LOGIN_LOCKOUT_WINDOW);
        }
        entry.locked_until.is_some_and(|until| until > now)
    }
    fn record_failure(&mut self, account: &str, source_ip: IpAddr) -> bool {
        let now = Instant::now();
        let account_locked = Self::record_key_failure(&mut self.accounts, account.to_string(), now);
        let source_ip_locked = Self::record_key_failure(&mut self.source_ips, source_ip, now);
        account_locked || source_ip_locked
    }
    fn reset(&mut self, account: &str, source_ip: IpAddr) {
        self.accounts.remove(account);
        self.source_ips.remove(&source_ip);
    }
}
fn login_source_ip(headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    // Loopback-only service: forwarded source is trusted only from the local reverse proxy.
    if peer.ip().is_loopback() {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok())
        {
            return ip;
        }
    }
    peer.ip()
}
#[derive(Serialize)]
struct User {
    id: String,
    username: String,
    display_name: String,
    profile_id: String,
    role: String,
    /// True only when `users.role='admin'` on this account. `role` above may have
    /// been widened to "admin" by the rights model; minting or promoting an admin
    /// account is gated on *this* flag, so the Superadmin right cannot mint the
    /// account role that grants it.
    #[serde(skip)]
    account_admin: bool,
}
#[derive(Deserialize)]
struct Login {
    username: String,
    password: String,
}
#[derive(Deserialize)]
struct Password {
    current: String,
    next: String,
}
#[derive(Deserialize)]
struct CreateUser {
    username: String,
    password: String,
    display_name: String,
    role: String,
    profile_id: Option<String>,
}
#[derive(Deserialize)]
struct SelfRegistration {
    username: String,
    password: String,
    display_name: String,
}
#[derive(Deserialize, Serialize)]
struct VerifiedDomain {
    domain: String,
    auto_join: bool,
    self_registration: bool,
    verified_at: i64,
}
#[derive(Deserialize)]
struct PatchUser {
    display_name: Option<String>,
    role: Option<String>,
    active: Option<bool>,
    password: Option<String>,
}
fn err(code: StatusCode, s: &str) -> (StatusCode, Json<Value>) {
    (code, Json(json!({"ok":false,"error":s})))
}
#[derive(Deserialize)]
struct PublicRoomQuery {
    username: Option<String>,
}
/// Token minting remains in calls; private, disabled, and unknown rooms are indistinguishable.
async fn public_room(
    Path(room): Path<String>,
    Query(query): Query<PublicRoomQuery>,
) -> axum::response::Response {
    match calls::join_public_meeting_call(room, query.username) {
        Ok(join) => Json(join).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn hash(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|x| x.to_string())
        .map_err(|e| e.to_string())
}
fn token() -> String {
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}
#[derive(Debug, Serialize)]
struct AppIdentity {
    application: applications::Application,
    scope: String,
    expires_at: Option<i64>,
}

/// RFC 6750 bearer authentication for the external application API. App bearer
/// tokens are deliberately distinct from browser session tokens and are resolved
/// only through the application token verifier.
///
/// Resolving the application here rather than per-handler is deliberate: a token
/// carries the authority of a live application, so an application that has been
/// archived (or deleted outright) must stop being an identity on the very next
/// request. Archiving does not revoke outstanding tokens, so this check — not the
/// token row — is what withdraws that authority.
#[allow(clippy::result_large_err)]
fn app_bearer(
    headers: &HeaderMap,
) -> Result<(applications::AppToken, applications::Application), axum::response::Response> {
    let token = app_bearer_token(headers)?;
    let application = applications::list_applications()
        .map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "application lookup failed",
            )
            .into_response()
        })?
        .into_iter()
        .find(|application| application.id == token.application_id && !application.archived)
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                [(
                    header::WWW_AUTHENTICATE,
                    "Bearer error=\"invalid_token\"".to_string(),
                )],
                Json(json!({"ok": false, "error": "invalid_token"})),
            )
                .into_response()
        })?;
    Ok((token, application))
}

/// Header parsing and token verification only — says nothing about the application.
#[allow(clippy::result_large_err)]
fn app_bearer_token(
    headers: &HeaderMap,
) -> Result<applications::AppToken, axum::response::Response> {
    let unauthorized = |error: &str| {
        (
            StatusCode::UNAUTHORIZED,
            [(
                header::WWW_AUTHENTICATE,
                format!("Bearer error=\"{error}\""),
            )],
            Json(json!({"ok": false, "error": error})),
        )
            .into_response()
    };
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| unauthorized("invalid_token"))?;
    let token = authorization
        .strip_prefix("Bearer ")
        .or_else(|| authorization.strip_prefix("bearer "))
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| unauthorized("invalid_request"))?;
    applications::verify_app_token(token.trim().to_string())
        .map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "app token verification failed",
            )
            .into_response()
        })?
        .ok_or_else(|| unauthorized("invalid_token"))
}

#[allow(clippy::result_large_err)]
fn app_read_scope(token: &applications::AppToken) -> Result<(), axum::response::Response> {
    if token
        .scope
        .split_whitespace()
        .any(|scope| scope == "read" || scope == "*")
    {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            [(
                header::WWW_AUTHENTICATE,
                "Bearer error=\"insufficient_scope\", scope=\"read\"",
            )],
            Json(json!({"ok": false, "error": "insufficient_scope"})),
        )
            .into_response())
    }
}

fn app_parameter_context(application_id: &str) -> String {
    format!("application:{application_id}")
}
#[allow(clippy::result_large_err)]
fn app_parameter_right(
    c: &rusqlite::Connection,
    application_id: &str,
    right: &str,
) -> Result<(), axum::response::Response> {
    if app_rights::app_has_right(
        c,
        application_id,
        &app_parameter_context(application_id),
        right,
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "rights lookup failed").into_response())?
    {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({"ok": false, "error": "right_not_authorized", "right": right})),
        )
            .into_response())
    }
}
async fn app_list_parameters(
    headers: HeaderMap,
) -> Result<Json<Vec<applications::AppParameter>>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_read_scope(&token)?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    app_parameter_right(&c, &application.id, "Project.ViewParameters")?;
    drop(c);
    applications::list_app_parameters(application.id)
        .map(|parameters| Json(parameters.into_iter().map(mask_parameter).collect()))
        .map_err(|_| {
            err(StatusCode::INTERNAL_SERVER_ERROR, "parameter lookup failed").into_response()
        })
}
/// A parameter value never leaves the API in clear text once marked secret:
/// writes echo the stored row back, so the same mask the list endpoint applies
/// must apply here too, or POST/PUT would become a secret read oracle.
fn mask_parameter(mut parameter: applications::AppParameter) -> applications::AppParameter {
    if parameter.is_secret {
        parameter.value = PARAMETER_SECRET_MASK.to_string();
    }
    parameter
}

/// The app parameter surface, split out of `main` so route wiring (method+path)
/// is testable, not just the handler bodies.
fn app_parameter_routes<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route(
            "/api/app/parameters",
            get(app_list_parameters)
                .post(app_create_parameter)
                .put(app_update_parameter),
        )
        .route(
            "/api/app/parameters/{key}",
            axum::routing::delete(app_delete_parameter),
        )
}

#[allow(clippy::result_large_err)]
fn app_parameter_lookup(
    application_id: &str,
    key: &str,
) -> Result<Option<applications::AppParameter>, axum::response::Response> {
    let parameters =
        applications::list_app_parameters(application_id.to_string()).map_err(|_| {
            err(StatusCode::INTERNAL_SERVER_ERROR, "parameter lookup failed").into_response()
        })?;
    Ok(parameters
        .into_iter()
        .find(|parameter| parameter.key == key))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppParameterInput {
    key: String,
    #[serde(default)]
    value: String,
    #[serde(default)]
    is_secret: bool,
}

/// An app writes only its *own* parameters: the context is derived from the
/// bearer identity, never from the request body, so a token cannot address
/// another application's parameter namespace.
async fn app_write_parameter(
    headers: HeaderMap,
    create_only: bool,
    input: AppParameterInput,
) -> Result<Json<applications::AppParameter>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_write_scope(&token)?;
    let key = input.key.trim().to_string();
    if key.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "parameter key required").into_response());
    }
    // Reads mask secrets as `***`; accepting that literal back on a write would let
    // a naive read-modify-write round trip silently overwrite the real secret with
    // the mask. Refuse the sentinel instead of guessing what was meant.
    if input.value == PARAMETER_SECRET_MASK {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "masked secret placeholder is not a parameter value",
        )
        .into_response());
    }
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    app_parameter_right(&c, &application.id, "Project.ModifyParameters")?;
    drop(c);
    let existing = app_parameter_lookup(&application.id, &key)?;
    if create_only && existing.is_some() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "error": "parameter_exists", "key": key})),
        )
            .into_response());
    }
    if !create_only && existing.is_none() {
        return Err(err(StatusCode::NOT_FOUND, "parameter not found").into_response());
    }
    applications::save_app_parameter(applications::AppParameter {
        application_id: application.id,
        key,
        value: input.value,
        is_secret: input.is_secret,
        updated_at: 0,
    })
    .map(|parameter| Json(mask_parameter(parameter)))
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "parameter save failed").into_response())
}

async fn app_create_parameter(
    headers: HeaderMap,
    Json(input): Json<AppParameterInput>,
) -> Result<Json<applications::AppParameter>, axum::response::Response> {
    app_write_parameter(headers, true, input).await
}

async fn app_update_parameter(
    headers: HeaderMap,
    Json(input): Json<AppParameterInput>,
) -> Result<Json<applications::AppParameter>, axum::response::Response> {
    app_write_parameter(headers, false, input).await
}

/// Deletion is a distinct right from modification in the taxonomy, so a token
/// authorized to edit values still cannot drop them.
async fn app_delete_parameter(
    headers: HeaderMap,
    Path(key): Path<String>,
) -> Result<Json<Value>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_write_scope(&token)?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    app_parameter_right(&c, &application.id, "Project.DeleteParameters")?;
    drop(c);
    if app_parameter_lookup(&application.id, &key)?.is_none() {
        return Err(err(StatusCode::NOT_FOUND, "parameter not found").into_response());
    }
    applications::delete_app_parameter(application.id, key)
        .map(|_| Json(json!({"ok": true})))
        .map_err(|_| {
            err(StatusCode::INTERNAL_SERVER_ERROR, "parameter delete failed").into_response()
        })
}

async fn app_me(headers: HeaderMap) -> Result<Json<AppIdentity>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    Ok(Json(AppIdentity {
        application,
        scope: token.scope,
        expires_at: token.expires_at,
    }))
}

/// OAuth scope is not authorization: a `read` token only says the *token* may read,
/// while the two-stage rights model says whether the *application* was authorized in
/// this context. Both must hold, so the external API answers with the projects the
/// app was actually granted `Project.ViewProject` in — not the whole instance.
async fn app_projects(
    headers: HeaderMap,
) -> Result<Json<Vec<platform::Project>>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_read_scope(&token)?;
    let all = platform::list_projects().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "project lookup failed").into_response()
    })?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    let mut visible = Vec::new();
    for project in all {
        let contexts = app_rights::app_project_contexts(&project.id);
        let granted = app_rights::app_has_right_anywhere(
            &c,
            &application.id,
            &contexts,
            "Project.ViewProject",
        )
        .map_err(|_| {
            err(StatusCode::INTERNAL_SERVER_ERROR, "rights lookup failed").into_response()
        })?;
        if granted {
            visible.push(project);
        }
    }
    Ok(Json(visible))
}

#[derive(Deserialize)]
struct AppIssueInput {
    title: String,
    #[serde(default)]
    description: Option<String>,
}

#[allow(clippy::result_large_err)]
fn app_write_scope(token: &applications::AppToken) -> Result<(), axum::response::Response> {
    if token
        .scope
        .split_whitespace()
        .any(|scope| scope == "write" || scope == "*")
    {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            [(
                header::WWW_AUTHENTICATE,
                "Bearer error=\"insufficient_scope\", scope=\"write\"",
            )],
            Json(json!({"ok": false, "error": "insufficient_scope"})),
        )
            .into_response())
    }
}

/// The first write the external app API offers, and the first consumer of the
/// stage-2 grant: without `Project.CreateIssues` authorized in this project (or
/// org-wide) the call is refused even with a `write` token.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppExternalCheckInput {
    status: String,
    #[serde(default)]
    details: Option<String>,
}

/// A configured application reports only its own reserved quality-gate check.
/// The bearer scope and stage-2 review right prevent a token from becoming a
/// cross-project CI approval oracle.
async fn app_record_external_check(
    headers: HeaderMap,
    Path(review_id): Path<String>,
    Json(input): Json<AppExternalCheckInput>,
) -> Result<Json<review::ExternalCheck>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_write_scope(&token)?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    let project_id: String = c
        .query_row(
            "SELECT project_id FROM reviews WHERE id=?1",
            params![review_id],
            |row| row.get(0),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "review not found").into_response())?;
    let contexts = app_rights::app_project_contexts(&project_id);
    let granted = app_rights::app_has_right_anywhere(
        &c,
        &application.id,
        &contexts,
        "Project.EditCodeReview",
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "rights lookup failed").into_response())?;
    drop(c);
    if !granted {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.EditCodeReview"})),
        )
            .into_response());
    }
    let check = review::ExternalCheck {
        review_id,
        check_name: format!("application:{}", application.id),
        status: input.status,
        details: input.details,
        updated_at: 0,
    };
    review::record_external_check(check.clone())
        .map_err(|message| err(StatusCode::BAD_REQUEST, &message).into_response())?;
    Ok(Json(check))
}

/// Read access to issues is separately scoped and authorized. A token's `read`
/// scope is only transport authority; the application also needs the project grant.
async fn app_list_project_issues(
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<issues::Issue>>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_read_scope(&token)?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    if !app_has_project_right(&c, &application.id, &project_id, "Project.ViewIssues")? {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.ViewIssues"})),
        )
        .into_response());
    }
    drop(c);
    issues::list_issues(
        Some(project_id),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(false),
    )
    .map(Json)
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "issue lookup failed").into_response())
}

/// An issue id alone must not bypass its project's application-rights boundary.
async fn app_get_issue(
    headers: HeaderMap,
    Path(issue_id): Path<String>,
) -> Result<Json<issues::Issue>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_read_scope(&token)?;
    let issue = issues::get_issue(issue_id)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "issue lookup failed").into_response())?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "issue not found").into_response())?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    if !app_has_project_right(&c, &application.id, &issue.project_id, "Project.ViewIssues")? {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.ViewIssues"})),
        )
        .into_response());
    }
    Ok(Json(issue))
}

async fn app_create_issue(
    headers: HeaderMap,
    Path(project_id): Path<String>,
    Json(input): Json<AppIssueInput>,
) -> Result<Json<issues::Issue>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_write_scope(&token)?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    let contexts = app_rights::app_project_contexts(&project_id);
    let granted =
        app_rights::app_has_right_anywhere(&c, &application.id, &contexts, "Project.CreateIssues")
            .map_err(|_| {
                err(StatusCode::INTERNAL_SERVER_ERROR, "rights lookup failed").into_response()
            })?;
    drop(c);
    if !granted {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.CreateIssues"})),
        )
            .into_response());
    }
    // SQLite's NOT NULL accepts "": an empty title is refused here, where the request is.
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "title_required"})),
        )
            .into_response());
    }
    issues::create_issue(issues::IssueInput {
        id: None,
        project_id,
        title,
        description: input.description,
        status_id: None,
        assignee_id: None,
        assignee_ids: Vec::new(),
        // No profile row belongs to an application, so authorship stays unattributed
        // rather than forging a person; the app identity is in the audit of the grant.
        created_by: None,
        due_date: None,
        priority: None,
        archived: None,
        // The application API has no conversation to point back at.
        source_entity_type: None,
        source_entity_id: None,
    })
    .map(Json)
    .map_err(|e| err(StatusCode::BAD_REQUEST, &e).into_response())
}

/// External room API scopes intentionally match the upstream Meet application API.
/// Generic `read`/`write` grants are not aliases: a token must explicitly carry the
/// capability for this endpoint (or `*`).
#[allow(clippy::result_large_err)]
fn app_room_scope(
    token: &applications::AppToken,
    required: &str,
) -> Result<(), axum::response::Response> {
    if token
        .scope
        .split_whitespace()
        .any(|scope| scope == required || scope == "*")
    {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            [(
                header::WWW_AUTHENTICATE,
                format!("Bearer error=\"insufficient_scope\", scope=\"{required}\""),
            )],
            Json(json!({"ok": false, "error": "insufficient_scope"})),
        )
            .into_response())
    }
}

#[allow(clippy::result_large_err)]
fn app_room_project_id(
    c: &rusqlite::Connection,
    room_id: &str,
) -> Result<String, axum::response::Response> {
    c.query_row(
        "SELECT ch.project_id FROM meetings m JOIN channels ch ON ch.id=m.channel_id WHERE m.id=?1 AND m.archived=0 AND ch.project_id IS NOT NULL",
        [room_id],
        |row| row.get(0),
    ).map_err(|_| err(StatusCode::NOT_FOUND, "room not found").into_response())
}

/// Lists must skip unscoped rooms rather than fail the entire authorized result set.
#[allow(clippy::result_large_err)]
fn app_room_project_id_if_scoped(
    c: &rusqlite::Connection,
    room_id: &str,
) -> Result<Option<String>, axum::response::Response> {
    c.query_row(
        "SELECT ch.project_id FROM meetings m JOIN channels ch ON ch.id=m.channel_id WHERE m.id=?1 AND m.archived=0 AND ch.project_id IS NOT NULL",
        [room_id],
        |row| row.get(0),
    ).optional().map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "room lookup failed").into_response())
}

#[allow(clippy::result_large_err)]
fn app_has_project_right(
    c: &rusqlite::Connection,
    application_id: &str,
    project_id: &str,
    right: &str,
) -> Result<bool, axum::response::Response> {
    app_rights::app_has_right_anywhere(
        c,
        application_id,
        &app_rights::app_project_contexts(project_id),
        right,
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "rights lookup failed").into_response())
}

async fn app_list_rooms(
    headers: HeaderMap,
) -> Result<Json<Vec<meetings::Meeting>>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_room_scope(&token, "rooms:list")?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    // Channel-less/public rooms have no project authorization context, so are never
    // exposed to applications. This is deliberately narrower than the human API.
    let mut rooms = Vec::new();
    for room in meetings::list_meetings_scoped_for_application(&c)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "room lookup failed").into_response())?
    {
        let Some(project_id) = app_room_project_id_if_scoped(&c, &room.id)? else {
            continue;
        };
        if app_has_project_right(&c, &application.id, &project_id, "Project.ViewMeetings")? {
            rooms.push(room);
        }
    }
    Ok(Json(rooms))
}

async fn app_get_room(
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> Result<Json<meetings::Meeting>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_room_scope(&token, "rooms:retrieve")?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    let project_id = app_room_project_id(&c, &room_id)?;
    if !app_has_project_right(&c, &application.id, &project_id, "Project.ViewMeetings")? {
        return Err((StatusCode::FORBIDDEN, Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.ViewMeetings"}))).into_response());
    }
    meetings::get_meeting_unscoped(&c, &room_id)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "room lookup failed").into_response())?
        .map(Json)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "room not found").into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppRoomInput {
    id: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
    starts_at: i64,
    ends_at: i64,
    #[serde(default)]
    rrule: Option<String>,
    #[serde(default)]
    location: Option<String>,
    project_id: String,
    channel_id: String,
    #[serde(default = "app_native_provider")]
    video_provider: String,
    #[serde(default = "app_scheduled_status")]
    video_status: String,
    #[serde(default = "app_private_access")]
    access_level: String,
}
fn app_native_provider() -> String {
    "livekit".into()
}
fn app_scheduled_status() -> String {
    "scheduled".into()
}
fn app_private_access() -> String {
    "PRIVATE".into()
}

async fn app_create_room(
    headers: HeaderMap,
    Json(input): Json<AppRoomInput>,
) -> Result<Json<meetings::Meeting>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_room_scope(&token, "rooms:create")?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    let channel_project: String = c
        .query_row(
            "SELECT project_id FROM channels WHERE id=?1 AND project_id IS NOT NULL",
            [&input.channel_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            err(StatusCode::BAD_REQUEST, "channel must belong to project").into_response()
        })?;
    if channel_project != input.project_id {
        return Err(err(StatusCode::BAD_REQUEST, "channel project mismatch").into_response());
    }
    if !app_has_project_right(
        &c,
        &application.id,
        &input.project_id,
        "Project.CreateMeetings",
    )? {
        return Err((StatusCode::FORBIDDEN, Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.CreateMeetings"}))).into_response());
    }
    drop(c);
    let room = meetings::Meeting {
        id: input.id,
        title: input.title,
        description: input.description,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        rrule: input.rrule,
        location: input.location,
        organizer_id: None,
        channel_id: Some(input.channel_id),
        visibility: if input.access_level == "PUBLIC" {
            "public".into()
        } else {
            "private".into()
        },
        modification_preference: "organizer-only".into(),
        archived: false,
        video_provider: Some(input.video_provider),
        video_room_id: None,
        join_url: None,
        meeting_url: None,
        video_status: input.video_status,
        video_started_at: None,
        video_ended_at: None,
        video_ended_by: None,
        source_entity_type: None,
        source_entity_id: None,
    };
    meetings::create_meeting(room.clone())
        .map_err(|message| err(StatusCode::BAD_REQUEST, &message).into_response())?;
    Ok(Json(room))
}

/// An application joins only as its own fixed, non-admin identity. Public access
/// needs both the persisted room flag and the server-wide anonymous-admission opt-in.
async fn app_join_room(
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> Result<Json<calls::CallJoin>, axum::response::Response> {
    let (token, application) = app_bearer(&headers)?;
    app_room_scope(&token, "rooms:join")?;
    let c = db::conn().map_err(|_| {
        err(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable").into_response()
    })?;
    let project_id = app_room_project_id(&c, &room_id)?;
    if !app_has_project_right(&c, &application.id, &project_id, "Project.JoinMeetings")? {
        return Err((StatusCode::FORBIDDEN, Json(json!({"ok": false, "error": "right_not_authorized", "right": "Project.JoinMeetings"}))).into_response());
    }
    drop(c);
    calls::join_application_public_meeting_call(room_id, application.id, application.name)
        .map(Json)
        .map_err(|_| err(StatusCode::FORBIDDEN, "room_join_denied").into_response())
}

/// Resolves either the browser session cookie or a script credential. Permanent
/// tokens carry the caller's existing account identity and consequently take the
/// same authorization path as an interactive session.
fn user_by_token(headers: &HeaderMap) -> Result<User, (StatusCode, Json<Value>)> {
    if let Some(session) = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|cookie| cookie.trim().strip_prefix("space_session="))
        })
    {
        if let Ok(user) = user_by_session_token(session) {
            return Ok(user);
        }
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    let user_id = gaia_space_lib::auth_security::permanent_token_user(bearer)
        .map_err(|error| err(StatusCode::INTERNAL_SERVER_ERROR, &error))?
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    user_by_id(&user_id)
}
/// Package clients (npm/bun/Maven) cannot send browser cookies: npm sends
/// `Authorization: Bearer <token>`, Maven sends HTTP Basic. Registry routes accept those two
/// in addition to the session cookie — same session/credential checks, no weaker path.
fn registry_user(headers: &HeaderMap) -> Result<User, (StatusCode, Json<Value>)> {
    if let Ok(user) = user_by_token(headers) {
        return Ok(user);
    }
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    if let Some(token) = authorization
        .strip_prefix("Bearer ")
        .or_else(|| authorization.strip_prefix("bearer "))
    {
        return user_by_session_token(token.trim());
    }
    let encoded = authorization
        .strip_prefix("Basic ")
        .or_else(|| authorization.strip_prefix("basic "))
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    use base64::Engine as _;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    let decoded =
        String::from_utf8(decoded).map_err(|_| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    let (username, password) = decoded
        .split_once(':')
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    // npm's Basic flavour puts the session token in the password field with any username.
    if let Ok(user) = user_by_session_token(password) {
        return Ok(user);
    }
    user_by_password(username, password)
}
/// Maven (and curl) only send credentials after a challenge, so registry 401s must carry
/// `WWW-Authenticate`. Wraps `registry_user` into a ready-to-return response on failure.
// The `Err` variant is an `axum::response::Response`, returned directly by every caller
// via `?` from a handler. Boxing it would only add an indirection before the same unwrap.
#[allow(clippy::result_large_err)]
fn registry_auth(headers: &HeaderMap) -> Result<User, axum::response::Response> {
    registry_user(headers).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            [(
                header::WWW_AUTHENTICATE,
                "Basic realm=\"gaia-space registry\"",
            )],
            Json(json!({"ok":false,"error":"unauthorized"})),
        )
            .into_response()
    })
}
/// Authentication says who is calling; it never said *which repository* they may reach.
/// A package repository that belongs to a project, or that carries its own ACL, is now
/// enforced on every registry protocol route (☎Kali-VIII B2):
/// - an account admin reaches everything;
/// - an ACL row decides: VIEWER reads, WRITER/MANAGER also writes;
/// - otherwise the owning project decides, through the same predicate the web UI uses;
/// - a repository with neither a project nor an ACL stays instance-wide, as before — that
///   is the legacy unowned repository, and narrowing it is a product decision, not a fix.
#[allow(clippy::result_large_err)]
fn registry_repo_auth(
    headers: &HeaderMap,
    repository_id: &str,
    write: bool,
) -> Result<User, axum::response::Response> {
    let user = registry_auth(headers)?;
    match repository_access(
        &user,
        repository_id,
        if write {
            RepoAccess::Write
        } else {
            RepoAccess::Read
        },
    ) {
        Ok(true) => Ok(user),
        Ok(false) => Err((
            StatusCode::FORBIDDEN,
            Json(json!({"ok":false,"error":"repository access denied"})),
        )
            .into_response()),
        Err(e) => Err(err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response()),
    }
}

/// How far into a package repository a caller is asking to reach.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum RepoAccess {
    /// list, resolve, download
    Read,
    /// publish, retention, pinning — the repository's contents
    Write,
    /// the repository itself: its settings, its ACL, destroying a version
    Admin,
}

/// The one answer to "may this account reach this package repository?", shared by the
/// registry protocol routes and by `/api/cmd` — those were two doors to the same room,
/// and only one of them was locked (☎Kali-VIII round 4).
fn repository_access(user: &User, repository_id: &str, level: RepoAccess) -> Result<bool, String> {
    let write = level != RepoAccess::Read;
    if user.role == "GlobalAdmin" {
        return Ok(true);
    }
    let c = db::conn()?;
    let role: Option<String> = c
        .query_row(
            "SELECT role FROM package_repository_acl WHERE repository_id=?1 AND profile_id=?2",
            params![repository_id, &user.profile_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(role) = role {
        // A WRITER publishes but does not hand out rights: granting is the MANAGER's, or
        // the owner's, otherwise a writer could quietly promote itself (☎Kali-VIII round 5).
        return Ok(match level {
            RepoAccess::Read => true,
            RepoAccess::Write => role != "VIEWER",
            RepoAccess::Admin => role == "MANAGER",
        });
    }
    let acl_exists: i64 = c
        .query_row(
            "SELECT count(*) FROM package_repository_acl WHERE repository_id=?1",
            params![repository_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let project_id: Option<String> = c
        .query_row(
            "SELECT project_id FROM package_repositories WHERE id=?1",
            params![repository_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    drop(c);
    match project_id {
        Some(project_id) => {
            if !project_readable(user, &project_id)? {
                return Ok(false);
            }
            // Reading a project's repository is membership; publishing into it is not: only
            // the owner (or an explicit WRITER/MANAGER grant) pushes a release.
            let owns = project_owner(&project_id)?.is_some_and(|owner| owner == user.profile_id);
            Ok(!write || owns)
        }
        // An explicit ACL that does not name this caller is a refusal, not a fallthrough.
        None if acl_exists > 0 => Ok(false),
        // A repository with neither a project nor an ACL stays instance-wide, as before.
        None => Ok(true),
    }
}

/// CalDAV deliberately accepts only HTTP Basic credentials. It reuses the same
/// active-user lookup and Argon2 verification as login and package registries;
/// calendar software cannot rely on browser cookies or interactive redirects.
#[allow(clippy::result_large_err)]
fn caldav_auth(headers: &HeaderMap) -> Result<User, axum::response::Response> {
    let denied = || {
        (
            StatusCode::UNAUTHORIZED,
            [(
                header::WWW_AUTHENTICATE,
                "Basic realm=\"gaia-space CalDAV\"".to_string(),
            )],
            "CalDAV authentication required",
        )
            .into_response()
    };
    let encoded = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .strip_prefix("Basic ")
                .or_else(|| value.strip_prefix("basic "))
        })
        .ok_or_else(denied)?;
    use base64::Engine as _;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| denied())?;
    let decoded = String::from_utf8(decoded).map_err(|_| denied())?;
    let (username, password) = decoded.split_once(':').ok_or_else(denied)?;
    user_by_password(username, password).map_err(|_| denied())
}
fn ics_escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
        .replace('\r', "")
}
fn ics_time(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH)
        .format("%Y%m%dT%H%M%SZ")
        .to_string()
}
fn caldav_unescape(value: &str) -> String {
    value
        .replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}
fn caldav_time(value: &str) -> Result<(i64, Option<String>), String> {
    let value = value.trim();
    if value.len() == 8 && value.as_bytes().iter().all(u8::is_ascii_digit) {
        let date =
            chrono::NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| "invalid DATE")?;
        return Ok((
            date.and_hms_opt(0, 0, 0)
                .ok_or("invalid DATE")?
                .and_utc()
                .timestamp(),
            Some(value.into()),
        ));
    }
    let value = value.strip_suffix('Z').unwrap_or(value);
    let parsed = chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S")
        .map_err(|_| "invalid DTSTART/DTEND")?;
    Ok((parsed.and_utc().timestamp(), None))
}
fn caldav_xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn caldav_multistatus(hrefs: impl IntoIterator<Item = String>) -> String {
    let responses = hrefs.into_iter().map(|href| format!(
        "<D:response><D:href>{}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/>{}</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
        caldav_xml_escape(&href), if href.ends_with('/') { "<C:calendar/>" } else { "" }
    )).collect::<String>();
    format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">{responses}</D:multistatus>")
}
fn caldav_calendar_owned(profile_id: &str, calendar_id: &str) -> Result<(), String> {
    let c = db::conn().map_err(|e| e.to_string())?;
    c.query_row(
        "SELECT 1 FROM calendars WHERE id=?1 AND profile_id=?2",
        params![calendar_id, profile_id],
        |_| Ok(()),
    )
    .map_err(|_| "calendar not found".into())
}
type CaldavStoredEvent = (String, String, String, i64, Option<i64>, Option<String>);
fn caldav_events(profile_id: &str, calendar_id: &str) -> Result<Vec<CaldavStoredEvent>, String> {
    caldav_calendar_owned(profile_id, calendar_id)?;
    let c = db::conn().map_err(|e| e.to_string())?;
    let mut events = Vec::new();
    let mut statement = c.prepare("SELECT e.href,e.uid,e.title,e.starts_at,e.ends_at,e.all_day_date FROM calendar_caldav_events e WHERE e.calendar_id=?1 ORDER BY e.starts_at,e.href").map_err(|e| e.to_string())?;
    for row in statement
        .query_map([calendar_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}
fn caldav_vevent(
    uid: &str,
    title: &str,
    starts_at: i64,
    ends_at: Option<i64>,
    all_day_date: Option<&str>,
) -> String {
    let start = all_day_date
        .map(|date| format!("DTSTART;VALUE=DATE:{date}\r\n"))
        .unwrap_or_else(|| format!("DTSTART:{}\r\n", ics_time(starts_at)));
    let end = ends_at
        .map(|time| format!("DTEND:{}\r\n", ics_time(time)))
        .unwrap_or_default();
    format!(
        "BEGIN:VEVENT\r\nUID:{}\r\nSUMMARY:{}\r\n{}{}END:VEVENT\r\n",
        ics_escape(uid),
        ics_escape(title),
        start,
        end
    )
}
fn caldav_ics(profile_id: &str, calendar_id: &str) -> Result<String, String> {
    let mut body =
        String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gaia Space//CalDAV//EN\r\n");
    let c = db::conn().map_err(|e| e.to_string())?;
    caldav_calendar_owned(profile_id, calendar_id)?;
    let mut feeds = c.prepare("SELECT e.uid,e.title,e.starts_at,e.ends_at,e.all_day_date FROM calendar_feed_events e JOIN calendar_feeds f ON f.id=e.feed_id WHERE f.calendar_id=?1 ORDER BY e.starts_at,e.uid").map_err(|e| e.to_string())?;
    for row in feeds
        .query_map([calendar_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (uid, title, start, end, date) = row.map_err(|e| e.to_string())?;
        body.push_str(&caldav_vevent(&uid, &title, start, end, date.as_deref()));
    }
    for (_, uid, title, start, end, date) in caldav_events(profile_id, calendar_id)? {
        body.push_str(&caldav_vevent(&uid, &title, start, end, date.as_deref()));
    }
    body.push_str("END:VCALENDAR\r\n");
    Ok(body)
}
fn caldav_event_ics(profile_id: &str, calendar_id: &str, href: &str) -> Result<String, String> {
    let event = caldav_events(profile_id, calendar_id)?
        .into_iter()
        .find(|event| event.0 == href)
        .ok_or("event not found")?;
    Ok(format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gaia Space//CalDAV//EN\r\n{}END:VCALENDAR\r\n",
        caldav_vevent(&event.1, &event.2, event.3, event.4, event.5.as_deref())
    ))
}
type CaldavParsedEvent = (String, String, i64, Option<i64>, Option<String>);
fn caldav_event(body: &str) -> Result<CaldavParsedEvent, String> {
    let unfolded = body.replace("\r\n ", "").replace("\n ", "");
    let mut uid = None;
    let mut title = None;
    let mut start = None;
    let mut end = None;
    let mut in_event = false;
    for line in unfolded.lines() {
        let line = line.trim_end_matches('\r');
        if line == "BEGIN:VEVENT" {
            in_event = true;
            continue;
        }
        if line == "END:VEVENT" {
            break;
        }
        if !in_event {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let name = key.split(';').next().unwrap_or(key);
        match name {
            "UID" => uid = Some(caldav_unescape(value)),
            "SUMMARY" => title = Some(caldav_unescape(value)),
            "DTSTART" => start = Some(caldav_time(value)?),
            "DTEND" => end = Some(caldav_time(value)?.0),
            _ => {}
        }
    }
    let uid = uid
        .filter(|value| !value.trim().is_empty())
        .ok_or("VEVENT needs UID")?;
    let title = title.unwrap_or_else(|| "Untitled".into());
    let (starts_at, all_day_date) = start.ok_or("VEVENT needs DTSTART")?;
    if end.is_some_and(|ends_at| ends_at < starts_at) {
        return Err("DTEND precedes DTSTART".into());
    }
    Ok((uid, title, starts_at, end, all_day_date))
}
async fn caldav_home(headers: HeaderMap) -> axum::response::Response {
    let user = match caldav_auth(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let c = match db::conn() {
        Ok(c) => c,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let calendars = match c
        .prepare("SELECT id FROM calendars WHERE profile_id=?1 ORDER BY name")
        .and_then(|mut q| {
            q.query_map([&user.profile_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()
        }) {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    (
        StatusCode::MULTI_STATUS,
        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
        caldav_multistatus(calendars.into_iter().map(|id| format!("/caldav/{id}/"))),
    )
        .into_response()
}
async fn caldav_collection(
    headers: HeaderMap,
    Path(calendar_id): Path<String>,
) -> axum::response::Response {
    let user = match caldav_auth(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    caldav_collection_for_user(&user.profile_id, &calendar_id)
}
async fn caldav_calendar(
    headers: HeaderMap,
    method: Method,
    Path(calendar_id): Path<String>,
) -> axum::response::Response {
    let user = match caldav_auth(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if method == Method::from_bytes(b"REPORT").unwrap()
        || method == Method::from_bytes(b"PROPFIND").unwrap()
    {
        return caldav_collection_for_user(&user.profile_id, &calendar_id);
    }
    if method == Method::OPTIONS {
        return (
            StatusCode::NO_CONTENT,
            [(header::ALLOW, "GET, OPTIONS, PROPFIND, REPORT")],
        )
            .into_response();
    }
    if method != Method::GET {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, "GET, OPTIONS, PROPFIND, REPORT")],
        )
            .into_response();
    }
    match caldav_ics(&user.profile_id, &calendar_id) {
        Ok(ics) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/calendar; charset=utf-8")],
            ics,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
fn caldav_collection_for_user(profile_id: &str, calendar_id: &str) -> axum::response::Response {
    match caldav_events(profile_id, calendar_id) {
        Ok(events) => {
            let mut hrefs = vec![
                format!("/caldav/{calendar_id}/"),
                format!("/caldav/{calendar_id}/calendar.ics"),
            ];
            hrefs.extend(
                events
                    .into_iter()
                    .map(|event| format!("/caldav/{calendar_id}/{}", event.0)),
            );
            (
                StatusCode::MULTI_STATUS,
                [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
                caldav_multistatus(hrefs),
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn caldav_get_event(
    headers: HeaderMap,
    Path((calendar_id, href)): Path<(String, String)>,
) -> axum::response::Response {
    let user = match caldav_auth(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !href.ends_with(".ics") || href == "calendar.ics" {
        return StatusCode::NOT_FOUND.into_response();
    }
    match caldav_event_ics(&user.profile_id, &calendar_id, &href) {
        Ok(ics) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/calendar; charset=utf-8")],
            ics,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn caldav_put_event(
    headers: HeaderMap,
    Path((calendar_id, href)): Path<(String, String)>,
    body: String,
) -> axum::response::Response {
    let user = match caldav_auth(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if !href.ends_with(".ics") || href == "calendar.ics" {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let (uid, title, starts_at, ends_at, all_day_date) = match caldav_event(&body) {
        Ok(event) => event,
        Err(reason) => return (StatusCode::BAD_REQUEST, reason).into_response(),
    };
    if caldav_calendar_owned(&user.profile_id, &calendar_id).is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match c.execute("INSERT INTO calendar_caldav_events(calendar_id,href,uid,title,starts_at,ends_at,all_day_date,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,unixepoch()) ON CONFLICT(calendar_id,href) DO UPDATE SET uid=excluded.uid,title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,all_day_date=excluded.all_day_date,updated_at=unixepoch()", params![calendar_id, href, uid, title, starts_at, ends_at, all_day_date]) { Ok(_) => StatusCode::NO_CONTENT.into_response(), Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response() }
}
async fn caldav_delete_event(
    headers: HeaderMap,
    Path((calendar_id, href)): Path<(String, String)>,
) -> axum::response::Response {
    let user = match caldav_auth(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    if caldav_calendar_owned(&user.profile_id, &calendar_id).is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match c.execute(
        "DELETE FROM calendar_caldav_events WHERE calendar_id=?1 AND href=?2",
        params![calendar_id, href],
    ) {
        Ok(0) => StatusCode::NOT_FOUND.into_response(),
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn user_by_password(username: &str, password: &str) -> Result<User, (StatusCode, Json<Value>)> {
    let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let row = c.query_row("SELECT id,username,password_hash,display_name,profile_id,CASE WHEN role='admin' THEN 'GlobalAdmin' ELSE global_role END FROM users WHERE username=?1 AND active=1", [username], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,String>(3)?, r.get::<_,String>(4)?, r.get::<_,String>(5)?))).map_err(|_| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    let (id, username, password_hash, display_name, profile_id, role) = row;
    let verified = PasswordHash::new(&password_hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some();
    if !verified {
        return Err(err(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    let mut user = User {
        id,
        username,
        display_name,
        profile_id,
        account_admin: role == "GlobalAdmin",
        role,
    };
    if user.role != "GlobalAdmin"
        && platform::is_admin_on(&c, &user.profile_id)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
    {
        user.role = "GlobalAdmin".into();
    }
    Ok(user)
}
fn user_by_session_token(t: &str) -> Result<User, (StatusCode, Json<Value>)> {
    let c = db::conn().map_err(|error| err(StatusCode::INTERNAL_SERVER_ERROR, &error))?;
    let user_id: String = c
        .query_row(
            "SELECT user_id FROM sessions WHERE token=?1 AND expires_at>unixepoch()",
            [t],
            |row| row.get(0),
        )
        .map_err(|_| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    user_by_id(&user_id)
}

fn user_by_id(user_id: &str) -> Result<User, (StatusCode, Json<Value>)> {
    let c = db::conn().map_err(|error| err(StatusCode::INTERNAL_SERVER_ERROR, &error))?;
    let mut user = c
        .query_row(
            "SELECT id,username,display_name,profile_id,CASE WHEN role='admin' THEN 'GlobalAdmin' ELSE global_role END FROM users WHERE id=?1 AND active=1",
            [user_id],
            |row| {
                let role: String = row.get(4)?;
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    display_name: row.get(2)?,
                    profile_id: row.get(3)?,
                    account_admin: role == "GlobalAdmin",
                    role,
                })
            },
        )
        .map_err(|_| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    if user.role != "GlobalAdmin"
        && platform::is_admin_on(&c, &user.profile_id)
            .map_err(|error| err(StatusCode::INTERNAL_SERVER_ERROR, &error))?
    {
        user.role = "GlobalAdmin".into();
    }
    Ok(user)
}
fn admin(h: &HeaderMap) -> Result<User, (StatusCode, Json<Value>)> {
    let u = user_by_token(h)?;
    if u.role == "GlobalAdmin" {
        Ok(u)
    } else {
        Err(err(StatusCode::FORBIDDEN, "admin required"))
    }
}
async fn capabilities() -> impl IntoResponse {
    Json(
        json!({"ok":true,"value":{"protocol":1,"features":{"mobile_qr_pairing":true,"project_role_templates":true,"membership_approval":true}}}),
    )
}
#[derive(Deserialize)]
struct PairConsume {
    code: String,
}
async fn create_mobile_pairing(h: HeaderMap) -> impl IntoResponse {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(error) => return error.into_response(),
    };
    let raw = token();
    let digest = format!("{:x}", sha2::Sha256::digest(raw.as_bytes()));
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    if let Err(e) = c.execute(
        "INSERT INTO mobile_pairings(code_hash,user_id,expires_at) VALUES(?1,?2,unixepoch()+120)",
        params![digest, user.id],
    ) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    Json(json!({"ok":true,"value":{"code":raw,"expires_in":120,"protocol":1}})).into_response()
}
async fn consume_mobile_pairing(Json(input): Json<PairConsume>) -> impl IntoResponse {
    if input.code.len() < 32 {
        return err(StatusCode::BAD_REQUEST, "invalid pairing code").into_response();
    }
    let digest = format!("{:x}", sha2::Sha256::digest(input.code.as_bytes()));
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let user_id: Option<String> = c.query_row("UPDATE mobile_pairings SET consumed_at=unixepoch() WHERE code_hash=?1 AND consumed_at IS NULL AND expires_at>unixepoch() RETURNING user_id", [&digest], |r| r.get(0)).optional().unwrap_or(None);
    let Some(user_id) = user_id else {
        return err(
            StatusCode::UNAUTHORIZED,
            "pairing code expired or already used",
        )
        .into_response();
    };
    let session = token();
    if let Err(e)=c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?1,?2,unixepoch(),unixepoch()+2592000)",params![session,user_id]) { return err(StatusCode::INTERNAL_SERVER_ERROR,&e.to_string()).into_response(); }
    let mut response = Json(json!({"ok":true,"value":{"paired":true}})).into_response();
    let cookie =
        format!("space_session={session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000");
    match HeaderValue::from_str(&cookie) {
        Ok(value) => {
            response.headers_mut().insert(header::SET_COOKIE, value);
            response
        }
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "cookie").into_response(),
    }
}
async fn login(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(x): Json<Login>,
) -> impl IntoResponse {
    let account = x.username.trim().to_string();
    let source_ip = login_source_ip(&headers, peer);
    {
        let mut limiter = match app.login_limiter.lock() {
            Ok(limiter) => limiter,
            Err(_) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "login limiter unavailable",
                )
                .into_response()
            }
        };
        if limiter.is_locked(&account, source_ip) {
            eprintln!("SECURITY: refused locked login username={account:?} source_ip={source_ip}");
            return err(
                StatusCode::TOO_MANY_REQUESTS,
                "too many failed login attempts; retry later",
            )
            .into_response();
        }
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let row=c.query_row("SELECT id,username,password_hash,display_name,profile_id,CASE WHEN role='admin' THEN 'GlobalAdmin' ELSE global_role END FROM users WHERE username=?1 AND active=1",[&account],|r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get(5)?)));
    let Ok((id, username, ph, display_name, profile_id, role)) = row else {
        let locked = app
            .login_limiter
            .lock()
            .map(|mut limiter| limiter.record_failure(&account, source_ip))
            .unwrap_or(true);
        eprintln!(
            "SECURITY: failed login username={account:?} source_ip={source_ip} locked={locked}"
        );
        return err(
            if locked {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::UNAUTHORIZED
            },
            if locked {
                "too many failed login attempts; retry later"
            } else {
                "invalid username or password"
            },
        )
        .into_response();
    };
    let ok = PasswordHash::new(&ph)
        .ok()
        .and_then(|p| {
            Argon2::default()
                .verify_password(x.password.as_bytes(), &p)
                .ok()
        })
        .is_some();
    if !ok {
        let locked = app
            .login_limiter
            .lock()
            .map(|mut limiter| limiter.record_failure(&account, source_ip))
            .unwrap_or(true);
        eprintln!(
            "SECURITY: failed login username={account:?} source_ip={source_ip} locked={locked}"
        );
        return err(
            if locked {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::UNAUTHORIZED
            },
            if locked {
                "too many failed login attempts; retry later"
            } else {
                "invalid username or password"
            },
        )
        .into_response();
    }
    if app
        .login_limiter
        .lock()
        .map(|mut limiter| limiter.reset(&account, source_ip))
        .is_err()
    {
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "login limiter unavailable",
        )
        .into_response();
    }
    let t = token();
    let _=c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?1,?2,unixepoch(),unixepoch()+2592000)",params![t,id]);
    let mut resp = Json(
        json!({"user":User{id,username,display_name,profile_id,account_admin:role=="GlobalAdmin",role}}),
    )
    .into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        match HeaderValue::from_str(&format!(
            "space_session={t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000"
        )) {
            Ok(v) => v,
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "cookie").into_response(),
        },
    );
    resp
}
fn registration_domain(username: &str) -> Option<String> {
    let (_, domain) = username.trim().rsplit_once('@')?;
    let domain = domain.trim().trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty() || domain.contains(['/', '@', ' ']) {
        None
    } else {
        Some(domain)
    }
}
async fn register(Json(x): Json<SelfRegistration>) -> impl IntoResponse {
    let username = x.username.trim();
    let display_name = x.display_name.trim();
    if username.is_empty() || display_name.is_empty() {
        return err(
            StatusCode::BAD_REQUEST,
            "username and display name are required",
        )
        .into_response();
    }
    if x.password.len() < 8 {
        return err(
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        )
        .into_response();
    }
    let Some(domain) = registration_domain(username) else {
        return err(
            StatusCode::BAD_REQUEST,
            "registration requires an email username",
        )
        .into_response();
    };
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let permitted: Option<i64> = match c
        .query_row(
            "SELECT 1 FROM verified_domains WHERE domain=?1 AND self_registration=1",
            [&domain],
            |r| r.get(0),
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    if permitted.is_none() {
        return err(
            StatusCode::FORBIDDEN,
            "self-registration is not enabled for this verified domain",
        )
        .into_response();
    }
    let id = token();
    let pid = format!("profile-{}", &id[..12]);
    let password_hash = match hash(&x.password) {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    if let Err(e) = c.execute(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?3,unixepoch())",
        params![pid, username, display_name],
    ) {
        return err(StatusCode::BAD_REQUEST, &e.to_string()).into_response();
    }
    match c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,global_role,created_at) VALUES(?1,?2,?3,?4,?5,'member','GlobalMember',unixepoch())",params![id,username,password_hash,display_name,pid]) { Ok(_)=>Json(json!({"id":id})).into_response(),Err(e)=>err(StatusCode::BAD_REQUEST,&e.to_string()).into_response() }
}
async fn domains(h: HeaderMap) -> impl IntoResponse {
    if let Err(e) = admin(&h) {
        return e.into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let mut q=match c.prepare("SELECT domain,auto_join,self_registration,verified_at FROM verified_domains WHERE org_id='default' ORDER BY domain"){Ok(q)=>q,Err(e)=>return err(StatusCode::INTERNAL_SERVER_ERROR,&e.to_string()).into_response()};
    let response = match q.query_map([], |r| {
        Ok(VerifiedDomain {
            domain: r.get(0)?,
            auto_join: r.get::<_, i64>(1)? != 0,
            self_registration: r.get::<_, i64>(2)? != 0,
            verified_at: r.get(3)?,
        })
    }) {
        Ok(rows) => Json(rows.filter_map(Result::ok).collect::<Vec<_>>()).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    response
}
async fn save_domain(h: HeaderMap, Json(mut x): Json<VerifiedDomain>) -> impl IntoResponse {
    if let Err(e) = admin(&h) {
        return e.into_response();
    }
    x.domain = x.domain.trim().trim_end_matches('.').to_ascii_lowercase();
    if x.domain.is_empty() || x.domain.contains(['/', '@', ' ']) {
        return err(StatusCode::BAD_REQUEST, "invalid domain").into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    match c.execute("INSERT INTO verified_domains(domain,org_id,auto_join,self_registration,verified_at) VALUES(?1,'default',?2,?3,unixepoch()) ON CONFLICT(domain) DO UPDATE SET auto_join=excluded.auto_join,self_registration=excluded.self_registration,verified_at=unixepoch()",params![x.domain,x.auto_join as i32,x.self_registration as i32]){Ok(_)=>Json(x).into_response(),Err(e)=>err(StatusCode::BAD_REQUEST,&e.to_string()).into_response()}
}
async fn delete_domain(h: HeaderMap, Path(domain): Path<String>) -> impl IntoResponse {
    if let Err(e) = admin(&h) {
        return e.into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    match c.execute(
        "DELETE FROM verified_domains WHERE domain=?1 AND org_id='default'",
        [domain],
    ) {
        Ok(_) => (StatusCode::NO_CONTENT).into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

async fn me(h: HeaderMap) -> impl IntoResponse {
    match user_by_token(&h) {
        Ok(u) => Json(json!({"user":u})).into_response(),
        Err(e) => e.into_response(),
    }
}
async fn logout(h: HeaderMap) -> impl IntoResponse {
    if let Some(t) = h
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';')
                .find_map(|x| x.trim().strip_prefix("space_session="))
        })
    {
        if let Ok(c) = db::conn() {
            let _ = c.execute("DELETE FROM sessions WHERE token=?1", [t]);
        }
    }
    let mut r = Json(json!({"ok":true})).into_response();
    r.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "space_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        ),
    );
    r
}
#[derive(Deserialize)]
struct CreatePermanentToken {
    name: String,
    expires_at: Option<i64>,
}

async fn permanent_tokens(h: HeaderMap) -> impl IntoResponse {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(error) => return error.into_response(),
    };
    match gaia_space_lib::auth_security::list_permanent_tokens(&user.id) {
        Ok(tokens) => Json(tokens).into_response(),
        Err(error) => err(StatusCode::INTERNAL_SERVER_ERROR, &error).into_response(),
    }
}

async fn create_permanent_token(
    h: HeaderMap,
    Json(input): Json<CreatePermanentToken>,
) -> impl IntoResponse {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(error) => return error.into_response(),
    };
    match gaia_space_lib::auth_security::create_permanent_token(
        &user.id,
        &input.name,
        input.expires_at,
    ) {
        Ok((record, token)) => Json(json!({"token": token, "record": record})).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}

async fn revoke_permanent_token(h: HeaderMap, Path(token_id): Path<String>) -> impl IntoResponse {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(error) => return error.into_response(),
    };
    match gaia_space_lib::auth_security::revoke_permanent_token(&user.id, &token_id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => err(StatusCode::NOT_FOUND, "token not found").into_response(),
        Err(error) => err(StatusCode::INTERNAL_SERVER_ERROR, &error).into_response(),
    }
}

async fn change_password(h: HeaderMap, Json(x): Json<Password>) -> impl IntoResponse {
    let u = match user_by_token(&h) {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    if x.next.len() < 8 {
        return err(
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        )
        .into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let ph: String = match c.query_row(
        "SELECT password_hash FROM users WHERE id=?1",
        [&u.id],
        |r| r.get(0),
    ) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };
    if PasswordHash::new(&ph)
        .ok()
        .and_then(|p| {
            Argon2::default()
                .verify_password(x.current.as_bytes(), &p)
                .ok()
        })
        .is_none()
    {
        return err(StatusCode::UNAUTHORIZED, "invalid username or password").into_response();
    }
    let p = match hash(&x.next) {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    if let Err(e) = c.execute(
        "UPDATE users SET password_hash=?1 WHERE id=?2",
        params![p, u.id],
    ) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    if let Err(e) = c.execute("DELETE FROM sessions WHERE user_id=?1", [&u.id]) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    Json(json!({"ok":true})).into_response()
}
async fn users(h: HeaderMap) -> impl IntoResponse {
    if let Err(e) = admin(&h) {
        return e.into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let mut q = match c.prepare(
        "SELECT id,username,display_name,profile_id,global_role,active FROM users ORDER BY username",
    ) {
        Ok(q) => q,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    let rows=match q.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"username":r.get::<_,String>(1)?,"display_name":r.get::<_,String>(2)?,"profile_id":r.get::<_,String>(3)?,"role":r.get::<_,String>(4)?,"active":r.get::<_,i64>(5)?==1}))){Ok(m)=>m,Err(e)=>return err(StatusCode::INTERNAL_SERVER_ERROR,&e.to_string()).into_response()};
    let v: Vec<Value> = rows.filter_map(Result::ok).collect();
    Json(v).into_response()
}
async fn directory(h: HeaderMap) -> impl IntoResponse {
    if let Err(e) = user_by_token(&h) {
        return e.into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let mut q = match c.prepare("SELECT username,display_name,profile_id FROM users WHERE active=1 ORDER BY display_name,username") {
        Ok(q) => q, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    let rows = match q.query_map([], |r| Ok(json!({"username":r.get::<_,String>(0)?,"display_name":r.get::<_,String>(1)?,"profile_id":r.get::<_,String>(2)?}))) {
        Ok(rows) => rows, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    Json(rows.filter_map(Result::ok).collect::<Vec<_>>()).into_response()
}
async fn create_user(h: HeaderMap, Json(x): Json<CreateUser>) -> impl IntoResponse {
    let me = match admin(&h) {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    let username = x.username.trim();
    let display_name = x.display_name.trim();
    if username.is_empty() || display_name.is_empty() {
        return err(
            StatusCode::BAD_REQUEST,
            "username and display name are required",
        )
        .into_response();
    }
    if x.password.len() < 8 {
        return err(
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        )
        .into_response();
    }
    // Legacy wire compat: pre-V90 clients say "admin"/"member"; they mean the
    // account-global pair. Unknown strings stay invalid.
    let role = match x.role.as_str() {
        "admin" => "GlobalAdmin",
        "member" => "GlobalMember",
        other => other,
    };
    if !matches!(
        role,
        "GlobalAdmin" | "GlobalMember" | "Guest" | "LightGuest"
    ) {
        return err(StatusCode::BAD_REQUEST, "invalid role").into_response();
    }
    if role == "GlobalAdmin" && !me.account_admin {
        return err(
            StatusCode::FORBIDDEN,
            "only a GlobalAdmin can grant GlobalAdmin",
        )
        .into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let id = token();
    let pid = x
        .profile_id
        .unwrap_or_else(|| format!("profile-{}", &id[..12]));
    // Identity law: a user account is a person, never the shared organization
    // profile, and never a profile another account already owns.
    if pid == "default-org" {
        return err(
            StatusCode::BAD_REQUEST,
            "the organization profile cannot be a user identity",
        )
        .into_response();
    }
    if c.query_row(
        "SELECT count(*) FROM users WHERE profile_id=?1",
        params![pid],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
    {
        return err(
            StatusCode::BAD_REQUEST,
            "that profile already belongs to another user",
        )
        .into_response();
    }
    if let Err(e) = c.execute("INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?3,unixepoch())", params![pid, username, display_name]) {
        return err(StatusCode::BAD_REQUEST, &e.to_string()).into_response();
    }
    let password_hash = match hash(&x.password) {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    match c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,global_role,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,unixepoch())", params![id, username, password_hash, display_name, pid, if role == "GlobalAdmin" { "admin" } else { "member" }, role]) {
        Ok(_) => Json(json!({"id":id})).into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}
async fn delete_user(h: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    let me = match admin(&h) {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    if id == me.id {
        return err(StatusCode::BAD_REQUEST, "cannot delete yourself").into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let target: (String, bool) = match c.query_row(
        "SELECT global_role,active FROM users WHERE id=?1",
        [&id],
        |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1)),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return err(StatusCode::NOT_FOUND, "user not found").into_response()
        }
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    let active_admins: i64 = c
        .query_row(
            "SELECT count(*) FROM users WHERE global_role='GlobalAdmin' AND active=1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if target.0 == "GlobalAdmin" && target.1 && active_admins <= 1 {
        return err(StatusCode::BAD_REQUEST, "cannot delete last active admin").into_response();
    }
    let tx = match c.unchecked_transaction() {
        Ok(tx) => tx,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    if let Err(e) = tx.execute("DELETE FROM sessions WHERE user_id=?1", [&id]) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    if let Err(e) = tx.execute("DELETE FROM users WHERE id=?1", [&id]) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    match tx.commit() {
        Ok(_) => Json(json!({"ok":true})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}
async fn patch_user(
    h: HeaderMap,
    Path(id): Path<String>,
    Json(x): Json<PatchUser>,
) -> impl IntoResponse {
    let me = match admin(&h) {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    // Legacy wire compat: pre-V90 clients say "admin"/"member"; they mean the
    // account-global pair. Unknown strings stay invalid.
    let normalized_role = x.role.as_deref().map(|r| match r {
        "admin" => "GlobalAdmin",
        "member" => "GlobalMember",
        other => other,
    });
    if let Some(role) = normalized_role {
        if !matches!(
            role,
            "GlobalAdmin" | "GlobalMember" | "Guest" | "LightGuest"
        ) {
            return err(StatusCode::BAD_REQUEST, "invalid role").into_response();
        }
        // Promotion gate: the account role is the thing that mints admins, so only
        // an account admin may hand it out. A Global.Superadmin is an admin
        // everywhere it matters, but it cannot promote itself into the column that
        // grants it — the rights model would otherwise be its own escalation path.
        if role == "GlobalAdmin" && !me.account_admin {
            return err(
                StatusCode::FORBIDDEN,
                "only a GlobalAdmin can grant GlobalAdmin",
            )
            .into_response();
        }
    }
    if x.password.as_ref().is_some_and(|p| p.len() < 8) {
        return err(
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters",
        )
        .into_response();
    }
    let c = match db::conn() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };
    let target: (String, bool) = match c.query_row(
        "SELECT global_role,active FROM users WHERE id=?1",
        [&id],
        |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1)),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return err(StatusCode::NOT_FOUND, "user not found").into_response()
        }
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    if id == me.id && x.active == Some(false) {
        return err(StatusCode::BAD_REQUEST, "cannot deactivate yourself").into_response();
    }
    let removes_active_admin = target.0 == "GlobalAdmin"
        && target.1
        && (normalized_role != Some("GlobalAdmin") || x.active == Some(false));
    if removes_active_admin {
        let n: i64 = c
            .query_row(
                "SELECT count(*) FROM users WHERE global_role='GlobalAdmin' AND active=1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n <= 1 {
            return err(
                StatusCode::BAD_REQUEST,
                "cannot remove the last active admin",
            )
            .into_response();
        }
    }
    if let Some(v) = x.display_name {
        if v.trim().is_empty() {
            return err(StatusCode::BAD_REQUEST, "display name is required").into_response();
        }
        if let Err(e) = c.execute(
            "UPDATE users SET display_name=?1 WHERE id=?2",
            params![v.trim(), id],
        ) {
            return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
        }
    }
    if let Some(v) = normalized_role {
        if let Err(e) = c.execute(
            "UPDATE users SET role=?1,global_role=?2 WHERE id=?3",
            params![
                if v == "GlobalAdmin" {
                    "admin"
                } else {
                    "member"
                },
                v,
                id
            ],
        ) {
            return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
        }
    }
    if let Some(v) = x.active {
        if let Err(e) = c.execute(
            "UPDATE users SET active=?1 WHERE id=?2",
            params![v as i32, id],
        ) {
            return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
        }
    }
    if let Some(v) = x.password {
        let h = match hash(&v) {
            Ok(h) => h,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
        };
        if let Err(e) = c.execute(
            "UPDATE users SET password_hash=?1 WHERE id=?2",
            params![h, id],
        ) {
            return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
        }
        if let Err(e) = c.execute("DELETE FROM sessions WHERE user_id=?1", [&id]) {
            return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
        }
    }
    Json(json!({"ok":true})).into_response()
}
fn to_camel(s: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for ch in s.chars() {
        if ch == '_' {
            up = true
        } else if up {
            out.extend(ch.to_uppercase());
            up = false
        } else {
            out.push(ch)
        }
    }
    out
}
fn arg<T: serde::de::DeserializeOwned>(body: &Value, name: &str) -> Result<T, String> {
    let camel = to_camel(name);
    let v = body
        .get(name)
        .or_else(|| body.get(camel.as_str()))
        .cloned()
        .unwrap_or(Value::Null);
    serde_json::from_value(v).map_err(|e| format!("invalid argument `{name}`: {e}"))
}
fn put_arg(body: &mut Value, name: &str, value: Value) {
    if let Some(object) = body.as_object_mut() {
        object.insert(name.to_string(), value);
    }
}
fn chat_channel_type(channel_id: &str) -> Option<String> {
    db::conn()
        .ok()?
        .query_row(
            "SELECT content_type FROM channels WHERE id=?1 AND archived=0",
            [channel_id],
            |r| r.get(0),
        )
        .ok()
}
fn chat_channel_access(profile_id: &str, channel_id: &str) -> bool {
    let Some(content_type) = chat_channel_type(channel_id) else {
        return false;
    };
    if matches!(content_type.as_str(), "public" | "entity-bound") {
        return true;
    }
    let Ok(c) = db::conn() else { return false };
    // A project-bound channel inherits the project's people (chat::EFFECTIVE_MEMBERS_SQL):
    // being in the project IS being in its conversations.
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id=?1 AND profile_id=?2) \
         OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id \
           WHERE ch.id=?1 AND (p.created_by=?2 OR EXISTS(SELECT 1 FROM project_members pm \
           WHERE pm.project_id=p.id AND pm.profile_id=?2)))",
        params![channel_id, profile_id],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}
/// Todo authorization policy (web mode), enforced entirely from the session:
/// * identity — `profile_id` on the request body is always overwritten with the session profile,
///   so a client can neither read as, nor create todos for, somebody else.
/// * owner/admin — create, full update, delete; group reads are additionally SQL-scoped to
///   project members and assignees.
/// * assignee — the dedicated completion-only command, never a wider todo payload.
///
/// A todo that exists but is not readable is answered with 403, exactly like a missing one.
fn todo_owned_by(profile_id: &str, todo_id: &str) -> bool {
    personal::todo_owner(todo_id)
        .ok()
        .flatten()
        .is_some_and(|owner| owner == profile_id)
}
/// A task filed in a project answers to that project's owner as well as its author.
fn todo_project_owned_by(profile_id: &str, todo_id: &str) -> bool {
    db::conn()
        .ok()
        .and_then(|c| {
            c.query_row(
                "SELECT EXISTS(SELECT 1 FROM todos t JOIN projects p ON p.id=t.project_id \
                 WHERE t.id=?1 AND p.created_by=?2)",
                rusqlite::params![todo_id, profile_id],
                |row| row.get::<_, bool>(0),
            )
            .ok()
        })
        .unwrap_or(false)
}
fn calendar_feed_owned_by(profile_id: &str, feed_id: &str) -> bool {
    calendar_feeds::feed_owner(feed_id)
        .ok()
        .flatten()
        .is_some_and(|owner| owner == profile_id)
}
fn notification_owned_by(profile_id: &str, notification_id: &str) -> bool {
    let Ok(c) = db::conn() else { return false };
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM notifications WHERE id=?1 AND recipient_id=?2)",
        params![notification_id, profile_id],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}
fn chat_message_channel(message_id: &str) -> Option<String> {
    db::conn()
        .ok()?
        .query_row(
            "SELECT channel_id FROM messages WHERE id=?1",
            [message_id],
            |r| r.get(0),
        )
        .ok()
}
/// The channel a poll lives in — the web chokepoint resolves it server-side instead of
/// trusting a `channel_id` the caller could pair with somebody else's poll.
fn chat_poll_channel(poll_id: &str) -> Option<String> {
    db::conn()
        .ok()?
        .query_row(
            "SELECT channel_id FROM message_polls WHERE id=?1",
            [poll_id],
            |r| r.get(0),
        )
        .ok()
}
fn chat_message_owned(profile_id: &str, message_id: &str) -> bool {
    let Ok(c) = db::conn() else { return false };
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1 AND author_id=?2)",
        params![message_id, profile_id],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}
fn chat_can_manage(profile_id: &str, channel_id: &str) -> bool {
    let Ok(c) = db::conn() else { return false };
    let member: Option<bool> = c
        .query_row(
            "SELECT administrator FROM channel_members WHERE channel_id=?1 AND profile_id=?2",
            params![channel_id, profile_id],
            |r| r.get(0),
        )
        .ok();
    let admins: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id=?1 AND administrator=1",
            [channel_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    member.is_some_and(|administrator| administrator || admins == 0)
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CommandPolicy {
    Session,
    MessageAttachmentWrite,
    PackageRepositoryRead,
    PackageRepositoryWrite,
    PackageRepositoryAdmin,
    TodoRead,
    TodoCreate,
    TodoOwnerWrite,
    /// Deleting a task: author, project owner or admin. The library owns the rule; the
    /// gate only binds `actor_id` to the session identity.
    TodoOwnerDelete,
    TodoCompletionWrite,
    /// The channel Notes & Decisions log. Read and write share one posture: the session
    /// identity is rebound onto the request (`bind_session_identity` already covers
    /// `profile_id`/`author_id`), and `channel_notes.rs` then applies project membership
    /// for reads and appends, authorship for edits and deletes. The chokepoint's own job
    /// is only to refuse an id-only write whose author cannot be resolved.
    ChannelNoteRead,
    ChannelNoteWrite,
    NotificationWrite,
    ProjectCreate,
    ProjectWrite,
    /// Destroying a project: owner or admin only, and the acting identity is bound to
    /// the session so nobody deletes under another person's name.
    ProjectDelete,
    ProjectRead,
    ProjectMemberWrite,
    PipelineScriptWrite,
    PipelineScriptExecute,
    BoardRead,
    IssueRead,
    IssueAssign,
    ProjectMemberAdmin,
    ProjectDeadlineWrite,
    CalendarRead,
    ProjectTodoRead,
    SessionIdentityWrite,
    DocumentCreate,
    DocumentReadList,
    DocumentRead,
    DocumentWrite,
    DocumentOwnerWrite,
    /// Deleting a document/folder: ownership, not write access, and the session decides
    /// who is acting.
    DocumentOwnerDelete,
    DocumentFolderDelete,
    DocumentAccessWrite,
    DocumentFolderCreate,
    DocumentFolderReadList,
    DocumentFolderWrite,
    BookRead,
    BookManage,
    MeetingReadList,
    MeetingRead,
    MeetingWrite,
    MeetingParticipantWrite,
    SearchRead,
    AbsenceWrite,
    CalendarFeedRead,
    CalendarUpsert,
    CalendarOwnerAction,
    CalendarFeedUpsert,
    CalendarFeedOwnerAction,
    DashboardPreferencesWrite,
    CalendarOptionsWrite,
    /// Contact leads contain private contact data; GlobalAdmin only.
    LeadRead,
    /// Application credentials: rotate/issue/verify/revoke/list plus marketplace
    /// installs. `applications` carries no owner column, so the only ownership
    /// resource available is the account role — administrators only.
    AppAdmin,
    Unavailable,
}

/// The web command allow-list. Every `/api/cmd/*` request must resolve here
/// before it can reach `dispatch!`; missing entries fail closed with 403.
fn command_policy(name: &str) -> Option<CommandPolicy> {
    Some(match name {
        "create_project" => CommandPolicy::ProjectCreate,
        "update_project" => CommandPolicy::ProjectWrite,
        "delete_project" => CommandPolicy::ProjectDelete,
        "create_board" | "create_issue" | "clone_issue" | "move_issue_to_project" | "create_issue_status" => {
            CommandPolicy::ProjectMemberWrite
        }
        "get_project" | "list_boards" | "list_issue_statuses" | "project_dashboard_aggregate" => CommandPolicy::ProjectRead,
        // The lead is informational, but *editing* the project field is the same
        // owner-or-admin door as the deadline. It grants the lead nothing.
        "set_project_deadline" | "update_project_deadline" | "set_project_lead" => {
            CommandPolicy::ProjectDeadlineWrite
        }
        "list_todos" | "dashboard_aggregate" | "get_dashboard_preferences" => CommandPolicy::TodoRead,
        "set_dashboard_preferences" => CommandPolicy::DashboardPreferencesWrite,
        "set_calendar_options" => CommandPolicy::CalendarOptionsWrite,
        "calendar_aggregate" | "get_calendar_options" => CommandPolicy::CalendarRead,
        "list_calendar_feeds" => CommandPolicy::CalendarFeedRead,
        "list_leads" => CommandPolicy::LeadRead,
        "list_calendars" => CommandPolicy::CalendarRead,
        "save_calendar" => CommandPolicy::CalendarUpsert,
        "delete_calendar" => CommandPolicy::CalendarOwnerAction,
        "save_calendar_feed" => CommandPolicy::CalendarFeedUpsert,
        "delete_calendar_feed" | "sync_calendar_feed" => CommandPolicy::CalendarFeedOwnerAction,
        "list_project_todos" | "list_team_todos" | "list_project_member_ids" => {
            CommandPolicy::ProjectTodoRead
        }
        "create_todo" => CommandPolicy::TodoCreate,
        "update_todo" | "postpone_todo" | "convert_todo_to_issue" => {
            CommandPolicy::TodoOwnerWrite
        }
        "delete_todo" => CommandPolicy::TodoOwnerDelete,
        "set_todo_completion" => CommandPolicy::TodoCompletionWrite,
        "list_channel_notes" => CommandPolicy::ChannelNoteRead,
        "create_channel_note" | "update_channel_note" | "delete_channel_note" => {
            CommandPolicy::ChannelNoteWrite
        }
        "mark_notification_read" => CommandPolicy::NotificationWrite,
        "create_absence" | "update_absence" | "delete_absence" => CommandPolicy::AbsenceWrite,
        "create_meeting" => CommandPolicy::SessionIdentityWrite,
        "save_document" | "restore_doc_version" => CommandPolicy::DocumentWrite,
        "list_document_access" => CommandPolicy::DocumentRead,
        "update_document_access" => CommandPolicy::DocumentAccessWrite,
        "create_document" => CommandPolicy::DocumentCreate,
        "app_info"
        | "join_meeting_call"
        | "end_meeting_call"
        | "start_livekit_server"
        | "trigger_pipeline_script"
        | "trigger_pipeline_on_push"
        | "review_diff"
        | "dry_run_merge"
        | "attempt_merge"
        | "open_merge_request"
        | "list_channels" => CommandPolicy::Unavailable,
        "add_channel_member"
        | "add_issue_child"
        | "add_reaction"
        | "add_review_participant"
        | "add_team_membership"
        | "archive_cf_definition" => CommandPolicy::Session,
        "archive_document" => CommandPolicy::DocumentOwnerWrite,
        "delete_document" => CommandPolicy::DocumentOwnerDelete,
        "archive_meeting" | "attach_meeting_channel" | "delete_meeting" => CommandPolicy::MeetingWrite,
        "archive_issue" | "archive_role" | "archive_sprint" | "archive_team" => {
            CommandPolicy::Session
        }
        // Reading the role catalog is a logged-in read; every *write* below also
        // passes RIGHTS_ADMIN_COMMANDS (EditRoles), so Session alone never grants one.
        "list_project_role_templates" | "list_project_roles" | "list_project_team_roles"
        | "create_project_role_template" | "archive_project_role_template"
        | "create_project_role" | "archive_project_role"
        | "assign_project_team_role" | "remove_project_team_role" => CommandPolicy::Session,
        "cf_get_values" | "cf_set_value" | "check_right" | "close_sprint"
        | "get_organization" | "get_org_settings" | "update_organization" | "update_org_settings" => CommandPolicy::Session,
        "create_cf_definition"
        | "create_channel"
        | "create_deploy_target"
        | "create_entity_channel" => CommandPolicy::Session,
        "create_document_folder" => CommandPolicy::DocumentFolderCreate,
        "create_job_artifact"
        | "create_message"
        | "create_package_repository"
        | "register_worker"
        | "save_test_report"
        | "ingest_teamcity_test_messages" => CommandPolicy::Session,
        "create_profile"
        | "create_quality_gate_rule"
        | "create_review_stack"
        | "create_review"
        | "create_review_discussion"
        | "set_suggested_edit_status"
        | "apply_suggested_edit"
        | "create_role"
        | "create_role_assignment" => CommandPolicy::Session,
        "create_sprint"
        | "create_team"
        | "current_absences"
        | "delete_board"
        | "delete_board_column" => CommandPolicy::Session,
        "delete_checklist"
        | "delete_checklist_item"
        | "delete_deploy_target"
        | "delete_issue_status"
        // `delete_channel` passes here and is then gated below by Channel.ManageChannel
        // at the channel's own scope, exactly like every other channel write.
        | "delete_message" | "set_message_pinned" | "delete_channel" => CommandPolicy::Session,
        // Drafts and typing beats are caller-scoped: `bind_session_identity` rewrites
        // `author_id`/`profile_id`, and the channel ACL check below still applies.
        "save_message_draft"
        | "get_message_draft"
        | "list_message_drafts"
        | "delete_message_draft"
        | "set_channel_typing"
        | "list_channel_typing" => CommandPolicy::Session,
        // A scheduled message is caller-owned: identity binding forces `author_id` to the
        // session, and chat.rs refuses any row authored by someone else.
        "schedule_message"
        | "list_scheduled_messages"
        | "get_scheduled_message"
        | "update_scheduled_message"
        | "cancel_scheduled_message" => CommandPolicy::Session,
        // Firing due intents is a server duty, not a client action.
        "deliver_due_scheduled_messages" => CommandPolicy::AppAdmin,
        // A poll is channel content: identity binding forces `author_id`/`voter_id` to
        // the session, the channel ACL check below applies, and creating one also needs
        // the right to post (the poll IS a message).
        "create_poll" | "get_poll" | "list_channel_polls" | "vote_poll" | "close_poll" => {
            CommandPolicy::Session
        }
        // Attachment lifecycle rides the message it belongs to: a session alone is not
        // enough, the caller must own that message (or administer its channel).
        "add_message_attachment" | "set_message_attachment_state" | "remove_message_attachment" => {
            CommandPolicy::MessageAttachmentWrite
        }
        "delete_planning_tag"
        | "delete_quality_gate_rule"
        | "delete_role_assignment"
        | "delete_sprint" => CommandPolicy::Session,
        "delete_subscription_setting"
        | "delete_swimlane"
        | "delete_time_tracking_entry"
        | "emit_notification"
        | "evaluate_quality_gate" => CommandPolicy::Session,
        "expand_meeting_occurrences" => CommandPolicy::MeetingReadList,
        "get_channel" | "get_channel_by_entity" | "ensure_thread_channel" | "get_profile_email_status" => CommandPolicy::Session,
        // Resolving a work item's source anchor reads channel/author/excerpt metadata
        // the caller already sees in the channel it points at; it creates nothing.
        "resolve_source_ref" => CommandPolicy::Session,
        "get_issue" | "get_issue_detail" | "list_issues" => CommandPolicy::IssueRead,
        "list_issue_assignees" | "set_issue_assignees" => CommandPolicy::IssueAssign,
        "add_project_member" | "remove_project_member" => CommandPolicy::ProjectMemberAdmin,
        "get_document" | "list_doc_versions" => CommandPolicy::DocumentRead,
        // Favourites are caller-scoped: `bind_session_identity` forces `profile_id` to
        // the session, and the read scope inside the query does the rest.
        "list_favorite_documents" | "set_document_favorite" | "move_favorite_document" => {
            CommandPolicy::Session
        }
        "get_meeting" | "list_meeting_participants" => CommandPolicy::MeetingRead,
        "get_profile" | "get_review" | "get_role" | "get_team" => CommandPolicy::Session,
        "goto_search" | "full_text_search" => CommandPolicy::SearchRead,
        "list_blog_posts" | "get_blog_post" | "publish_blog_draft" => CommandPolicy::Session,
        "issue_time_total" | "join_channel" | "launch_sprint" | "leave_channel"
        | "list_absences" => CommandPolicy::Session,
        "invite_meeting_participant" => CommandPolicy::MeetingWrite,
        "list_backlog_issues" | "list_board_columns" | "list_board_issues" | "get_board_card_settings" => {
            CommandPolicy::BoardRead
        }
        "list_cf_definitions" | "list_channel_members" | "list_locations" | "location_channel" | "list_desk_assignments" | "save_desk_assignment" | "remove_desk_assignment" | "list_meeting_rooms" | "reserve_meeting_room" | "save_location" | "meeting_availability" | "attach_document_discussion" | "get_document_discussion" | "import_document_folder" | "save_channel_subscription" | "list_channel_subscriptions" | "ensure_project_document_root" => CommandPolicy::Session,
        "search_book_documents" => CommandPolicy::BookRead,
        "list_book_access" | "update_book_access" => CommandPolicy::BookManage,
        "list_book_owners" => CommandPolicy::BookRead,
        "list_channels_with_meta"
        | "list_unread_threads"
        | "list_checklist_items"
        | "list_checklists"
        | "list_deploy_targets"
        | "list_deployments_for_target" => CommandPolicy::Session,
        "list_document_folders" => CommandPolicy::DocumentFolderReadList,
        "list_documents" => CommandPolicy::DocumentReadList,
        "list_job_artifacts"
        | "list_job_runs"
        | "list_job_runs_for_script"
        | "list_test_reports"
        | "list_workers" => CommandPolicy::Session,
        "list_jobs" | "list_jobs_for_script" | "list_messages" | "list_pinned_messages" | "list_notifications" => {
            CommandPolicy::Session
        }
        // Paging is reading: same policy as `list_messages`, and the channel ACL check
        // below runs on every page — a cursor is a position, never a capability.
        "list_messages_page" => CommandPolicy::Session,
        // Unfurling makes this server fetch a URL, so it is gated by the read ACL of the
        // channel the message lives in (resolved server-side from `message_id`).
        "unfurl_message_links" => CommandPolicy::Session,
        // Both are scoped to the caller by `bind_session_identity` rewriting `profile_id`,
        // so one session can never read another profile's mentions inbox or badge.
        "list_mentions_for_profile" | "count_unread_mentions" => CommandPolicy::Session,
        "list_meetings" => CommandPolicy::MeetingReadList,
        "list_package_repositories"
        | "list_pipeline_scripts"
        | "list_planning_tags"
        | "list_messenger_contacts"
        | "list_principals"
        | "list_profiles" => CommandPolicy::Session,
        "list_projects" => CommandPolicy::Session,
        "list_quality_gate_rules"
        | "list_dev_environments"
        | "create_dev_environment"
        | "touch_dev_environment"
        | "hibernate_dev_environment"
        | "hibernate_idle_dev_environments"
        | "resume_dev_environment"
        | "claim_standby_dev_environment"
        | "save_standby_pool_policy"
        | "refill_standby_pool"
        | "delete_dev_environment"
        | "list_review_stacks"
        | "list_my_review_stacks"
        | "remove_review_stack"
        | "list_review_discussions"
        | "list_review_participants"
        | "list_reviews"
        | "list_rights"
        | "list_right_groups"
        | "list_role_assignments" => CommandPolicy::Session,
        "list_role_rights"
        | "list_roles"
        | "list_safe_merge_runs"
        | "list_sprints"
        | "list_subscription_settings"
        | "list_subscription_scopes"
        | "list_subscription_deliveries"
        | "list_follows"
        | "get_channel_notification_preference"
        | "private_feed"
        | "list_marketplace_apps"
        | "list_app_installs"
        | "list_swimlanes" => CommandPolicy::Session,
        // Anything that mints, reads back, or spends an application credential.
        "rotate_app_secret"
        | "issue_app_token"
        | "verify_app_token"
        | "revoke_app_token"
        | "list_app_tokens"
        | "save_marketplace_app"
        | "install_marketplace_app"
        | "uninstall_app"
        // The redirect allowlist decides where a code is delivered: it is a credential
        // surface, so it answers to the same admin gate as the secrets themselves.
        | "register_redirect_uri"
        // A webhook secret is an application credential like any other: minting one or
        // enumerating the ring answers to the same admin gate.
        | "rotate_webhook_secret"
        | "list_webhook_secrets"
        // The app's Ed25519 pair signs everything the app's endpoint will trust, and a
        // dispatch spends that key against an arbitrary URL: same admin gate.
        | "app_signing_key"
        | "rotate_app_signing_key"
| "add_app_ssh_key" | "list_app_ssh_keys" | "delete_app_ssh_key"
| "add_app_gpg_key" | "list_app_gpg_keys" | "delete_app_gpg_key" | "revoke_app_gpg_key"
        | "dispatch_application_payload"
        | "parse_application_payload"
        | "application_payload_classes"
        | "list_redirect_uris"
        // Advanced Team Directory is an optional organization feature; its company
        // activity and absence overview are administrator-only, never a member feed.
        | "list_directory_feed"
        | "list_directory_calendar"
        | "list_app_parameters"
        | "save_app_parameter"
        | "delete_app_parameter" => CommandPolicy::AppAdmin,
        "list_team_memberships"
        | "list_teams"
        | "list_thread_replies"
        | "list_time_tracking_entries"
        | "livekit_server_status"
        | "mark_channel_read" => CommandPolicy::Session,
        // ☎Kali-VIII round 4: the registry HTTP routes were gated while `/api/cmd` still
        // reached the very same publish with a bare session, so the ACL was a front door
        // with an open back one. Every command that writes a repository's contents now
        // resolves that repository and asks the same question.
        "apply_package_retention"
        | "publish_package_version"
        | "set_package_version_pinned" => CommandPolicy::PackageRepositoryWrite,
        // The repository itself, its ACL and destroying a version are the manager's.
        "set_package_repository_acl"
        | "remove_package_repository_acl"
        | "update_package_repository"
        | "delete_package_repository"
        | "delete_package_version"
        | "add_package_vulnerability" => CommandPolicy::PackageRepositoryAdmin,
        "package_retention_candidates"
        | "package_version_detail"
        | "repository_vulnerability_report"
        | "list_package_versions"
        | "list_package_repository_acl"
        | "download_package_payload"
        | "dependency_overview" => CommandPolicy::PackageRepositoryRead,
        "move_issue_on_board" | "remove_channel_member" => CommandPolicy::Session,
        "move_document" => CommandPolicy::DocumentOwnerWrite,
        "move_document_folder" => CommandPolicy::DocumentFolderWrite,
        "delete_document_folder" => CommandPolicy::DocumentFolderDelete,
        "remove_issue_from_board"
        | "remove_issue_link"
        | "remove_reaction"
        | "delete_messenger_contact"
        | "remove_team_membership"
        | "request_membership_edit"
        | "decide_membership_edit"
        | "save_board_column"
        | "save_board_card_settings" => CommandPolicy::Session,
        "save_checklist"
        | "save_checklist_item"
        | "save_messenger_contact"
        | "save_planning_tag"
        | "save_subscription_setting"
        | "save_subscription_scope"
        | "delete_subscription_scope"
        | "save_subscription_delivery"
        | "delete_subscription_delivery"
        | "save_follow"
        | "delete_follow"
        | "save_channel_notification_preference"
        | "save_swimlane" => CommandPolicy::Session,
        "save_time_tracking_entry"
        | "schedule_deployment"
        | "seed_rights"
        | "set_discussion_resolved"
        | "set_issue_tags" => CommandPolicy::Session,
        "set_meeting_participant_status" => CommandPolicy::MeetingParticipantWrite,
        "set_participant_state"
        | "set_profile_email_status"
        | "set_role_rights"
        | "toggle_checklist_item"
        | "transition_deployment"
        | "update_board" => CommandPolicy::Session,
        "update_cf_definition" | "update_channel" | "update_deploy_target" | "update_issue" => {
            CommandPolicy::Session
        }
        "update_document" => CommandPolicy::DocumentOwnerWrite,
        "update_document_folder" => CommandPolicy::DocumentFolderWrite,
        "update_issue_status"
        | "update_message"
        | "update_profile" => CommandPolicy::Session,
        "create_pipeline_script" | "update_pipeline_script" | "delete_pipeline_script" => CommandPolicy::PipelineScriptWrite,
        // Event triggers operate on one repository-validated script. Its project membership
        // is checked before dispatch; repository equality alone is not authorization.
        "trigger_pipeline_event" => CommandPolicy::PipelineScriptExecute,
        "due_scheduled_runs" => CommandPolicy::AppAdmin,
        "update_meeting" => CommandPolicy::MeetingWrite,
        "update_quality_gate_rule"
        | "update_review"
        | "update_role"
        | "update_sprint"
        | "update_team"
        | "update_team_membership" => CommandPolicy::Session,
        "list_devfiles"
        | "list_applications"
        | "list_event_types"
        | "list_webhooks"
        | "list_webhook_deliveries"
        | "list_chatbots"
        | "list_chatbot_commands"
        | "get_required_rights"
        | "get_authorized_rights"
        | "scope_approval_status"
        | "application_right_catalog"
        | "update_required_rights"
        | "request_rights"
        | "update_authorized_rights"
        | "approve_scope"
        | "list_ui_extensions" => CommandPolicy::Session,
        "save_devfile"
        | "delete_devfile"
        | "open_in_ide"
        | "save_application"
        | "delete_application"
        | "save_webhook"
        | "delete_webhook"
        | "deliver_webhook"
        | "retry_webhook_delivery"
        | "process_webhook_queue"
        | "save_chatbot"
        | "delete_chatbot"
        | "save_ui_extension"
        | "delete_ui_extension" => CommandPolicy::Session,
        _ => return None,
    })
}

/// Stamp the session's profile onto every `created_by`-shaped field of a
/// create payload, inserting it when the client omitted it entirely.
fn force_session_owner(value: &mut Value, profile_id: &str) {
    match value {
        Value::Object(object) => {
            for alias in ["createdBy", "owner", "owner_id", "ownerId"] {
                object.remove(alias);
            }
            if object.contains_key("project") {
                if let Some(child) = object.get_mut("project") {
                    force_session_owner(child, profile_id);
                }
            } else {
                object.insert("created_by".into(), Value::String(profile_id.to_string()));
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                force_session_owner(item, profile_id);
            }
        }
        _ => {}
    }
}
fn bind_session_identity(value: &mut Value, profile_id: &str) {
    match value {
        Value::Object(object) => {
            for (key, child) in object.iter_mut() {
                if matches!(
                    key.as_str(),
                    "profile_id"
                        | "profileId"
                        | "created_by"
                        | "createdBy"
                        | "owner"
                        | "owner_id"
                        | "ownerId"
                        | "author_id"
                        | "authorId"
                        | "acting_profile_id"
                        | "actingProfileId"
                        // Only polls carry `voter_id`: a ballot is always cast by the
                        // session that sends it, never on somebody else's behalf.
                        | "voter_id"
                        | "voterId"
                        | "recipient_id"
                        | "recipientId"
                        | "organizer_id"
                        | "organizerId"
                        | "actor"
                ) {
                    *child = json!(profile_id);
                } else {
                    bind_session_identity(child, profile_id);
                }
            }
        }
        Value::Array(values) => {
            for child in values {
                bind_session_identity(child, profile_id);
            }
        }
        _ => {}
    }
}

fn bind_required_object_identity(
    body: &mut Value,
    object_name: &str,
    snake_key: &str,
    camel_key: &str,
    profile_id: &str,
) -> Result<(), String> {
    let object = body
        .get_mut(object_name)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!("invalid argument `{object_name}`"))?;
    if let Some(value) = object.get_mut(snake_key) {
        *value = json!(profile_id);
    } else if let Some(value) = object.get_mut(camel_key) {
        *value = json!(profile_id);
    } else {
        object.insert(snake_key.to_string(), json!(profile_id));
    }
    Ok(())
}

fn project_owner(project_id: &str) -> Result<Option<String>, String> {
    db::conn()
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT created_by FROM projects WHERE id=?1",
            [project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn issue_project(issue_id: &str) -> Result<Option<String>, String> {
    db::conn()
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT project_id FROM issues WHERE id=?1",
            [issue_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}
fn board_project(board_id: &str) -> Result<Option<String>, String> {
    db::conn()
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT project_id FROM boards WHERE id=?1",
            [board_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}
fn project_readable(user: &User, project_id: &str) -> Result<bool, String> {
    Ok(user.role == "GlobalAdmin"
        || project_owner(project_id)?.is_some_and(|owner| owner == user.profile_id)
        || personal::project_member_by(project_id, &user.profile_id)?)
}

/// Firing a pipeline executes shell commands on the server host. Unlike reading a project,
/// it therefore belongs only to its owner (or a platform administrator).
fn project_pipeline_executable(user: &User, project_id: &str) -> Result<bool, String> {
    Ok(user.role == "GlobalAdmin"
        || project_owner(project_id)?.is_some_and(|owner| owner == user.profile_id))
}
fn issue_id(body: &Value) -> Option<String> {
    arg(body, "id").ok()
}
fn project_from_body(body: &Value) -> Result<(String, Option<String>), String> {
    let project = body.get("project").ok_or("invalid argument `project`")?;
    Ok((arg(project, "id")?, arg(project, "created_by")?))
}
fn nested_id(body: &Value, key: &str) -> Option<String> {
    body.get(key)?.get("id")?.as_str().map(str::to_owned)
}
fn document_id(body: &Value, name: &str) -> Option<String> {
    if name == "update_document" {
        nested_id(body, "document")
    } else if matches!(
        name,
        "restore_doc_version"
            | "list_doc_versions"
            | "list_document_access"
            | "update_document_access"
    ) {
        arg(body, "document_id").ok()
    } else {
        arg(body, "id").ok()
    }
}
fn meeting_id(body: &Value, name: &str) -> Option<String> {
    if name == "update_meeting" {
        nested_id(body, "meeting")
    } else if matches!(
        name,
        "invite_meeting_participant"
            | "set_meeting_participant_status"
            | "list_meeting_participants"
    ) {
        arg(body, "meeting_id").ok()
    } else {
        arg(body, "id").ok()
    }
}
fn bind_document_create(user: &User, body: &mut Value) -> Result<(), String> {
    let d = body
        .get_mut("document")
        .and_then(Value::as_object_mut)
        .ok_or("invalid argument `document`")?;
    d.insert("created_by".into(), json!(user.profile_id));
    let t = d
        .get("container_type")
        .and_then(Value::as_str)
        .ok_or("document container_type is required")?
        .to_owned();
    if t == "my-docs" {
        d.insert("container_id".into(), json!(user.profile_id));
    }
    if t == "project" {
        let p = d
            .get("container_id")
            .and_then(Value::as_str)
            .ok_or("project document requires container_id")?;
        if user.role != "GlobalAdmin" && !personal::project_member_by(p, &user.profile_id)? {
            return Err("project access denied".into());
        }
    }
    if t == "kb" {
        let book_id = d
            .get("container_id")
            .and_then(Value::as_str)
            .ok_or("knowledge-base document requires book id")?;
        if !documents::book_writable_by(book_id, &user.profile_id, user.role == "GlobalAdmin")? {
            return Err("knowledge-base book write denied".into());
        }
    }
    Ok(())
}
fn bind_folder_create(user: &User, body: &mut Value) -> Result<(), String> {
    let f = body
        .get_mut("folder")
        .and_then(Value::as_object_mut)
        .ok_or("invalid argument `folder`")?;
    let t = f
        .get("container_type")
        .and_then(Value::as_str)
        .ok_or("folder container_type is required")?
        .to_owned();
    if t == "my-docs" {
        f.insert("container_id".into(), json!(user.profile_id));
    }
    if t == "project" {
        let p = f
            .get("container_id")
            .and_then(Value::as_str)
            .ok_or("project folder requires container_id")?;
        if user.role != "GlobalAdmin" && !personal::project_member_by(p, &user.profile_id)? {
            return Err("project access denied".into());
        }
    }
    if t == "kb" {
        let id = f
            .get("id")
            .and_then(Value::as_str)
            .ok_or("knowledge-base folder requires id")?;
        let book_id = f
            .get("container_id")
            .and_then(Value::as_str)
            .ok_or("knowledge-base folder requires book id")?;
        let is_book = f.get("parent_id").is_some_and(Value::is_null) && id == book_id;
        if is_book {
            f.insert("owner_id".into(), json!(user.profile_id));
        } else if !documents::book_writable_by(
            book_id,
            &user.profile_id,
            user.role == "GlobalAdmin",
        )? {
            return Err("knowledge-base book write denied".into());
        }
    }
    Ok(())
}

fn require_catalog_right(
    user: &User,
    right: gaia_space_lib::rights::Right,
    scope_type: &str,
    scope_id: Option<&str>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    platform::require_right_on(&c, &user.profile_id, right, scope_type, scope_id)
        .map_err(|_| err(StatusCode::FORBIDDEN, "right required"))
}

/// Commands whose effect is organization-wide administration of the rights model
/// itself, with the global right each one costs (KB §05 §1, §2.1). Before this table
/// the whole role↔right matrix was `CommandPolicy::Session`: every logged-in account
/// could grant itself any right by editing a role. An administrator passes without a
/// grant — `platform::is_admin_on` is the single definition of that — so bootstrapping
/// an organization does not require a right that only an administrator could hand out.
const RIGHTS_ADMIN_COMMANDS: &[(&str, gaia_space_lib::rights::Right)] = &[
    ("create_role", gaia_space_lib::rights::Right::EditRoles),
    ("update_role", gaia_space_lib::rights::Right::EditRoles),
    ("archive_role", gaia_space_lib::rights::Right::EditRoles),
    ("set_role_rights", gaia_space_lib::rights::Right::EditRoles),
    (
        "create_role_assignment",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    (
        "delete_role_assignment",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    ("seed_rights", gaia_space_lib::rights::Right::EditRoles),
    // Project role templates/roles/team bindings are the project-scoped half of the
    // same role model: minting one hands out access, so it costs the same right.
    (
        "create_project_role_template",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    (
        "archive_project_role_template",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    (
        "create_project_role",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    (
        "archive_project_role",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    (
        "assign_project_team_role",
        gaia_space_lib::rights::Right::EditRoles,
    ),
    (
        "remove_project_team_role",
        gaia_space_lib::rights::Right::EditRoles,
    ),
];
fn require_rights_administration(user: &User, name: &str) -> Result<(), (StatusCode, Json<Value>)> {
    let Some((_, right)) = RIGHTS_ADMIN_COMMANDS
        .iter()
        .find(|(command, _)| *command == name)
    else {
        return Ok(());
    };
    let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    if platform::is_admin_on(&c, &user.profile_id).unwrap_or(false) {
        return Ok(());
    }
    require_catalog_right(user, *right, "global", None)
}
/// Single authorization + identity-binding gate for the complete web command
/// surface. Domain dispatch is deliberately below this function.
fn authorize_command(
    user: &User,
    name: &str,
    body: &mut Value,
) -> Result<(), (StatusCode, Json<Value>)> {
    let policy =
        command_policy(name).ok_or_else(|| err(StatusCode::FORBIDDEN, "command denied"))?;
    // Slash-command discovery tells the bot who is typing. That identity is the
    // session's, never the body's: otherwise any logged-in caller could ask a bot for
    // another person's menu — and be announced to a third party as them.
    // `user_id` is not in `bind_session_identity` because elsewhere it legitimately
    // names someone else, so the rebinding is done here, for this command only.
    require_rights_administration(user, name)?;
    if name == "list_chatbot_commands" {
        if let Value::Object(object) = &mut *body {
            object.insert("userId".to_string(), json!(user.profile_id));
            object.insert("user_id".to_string(), json!(user.profile_id));
        }
    }
    if (!matches!(policy, CommandPolicy::AbsenceWrite) || user.role != "GlobalAdmin")
        && policy != CommandPolicy::DocumentAccessWrite
        && policy != CommandPolicy::MeetingParticipantWrite
    {
        // Access recipient ids intentionally name *other* people/teams; rebinding them
        // to the caller would turn every share into a self-grant.
        bind_session_identity(body, &user.profile_id);
    }
    match policy {
        CommandPolicy::Unavailable => Err(err(
            StatusCode::NOT_IMPLEMENTED,
            "not available in web mode",
        )),
        CommandPolicy::ProjectCreate => {
            // Ownership is minted from the session, never from the payload: any
            // client-supplied owner field on the new project is overwritten
            // (defence in depth behind `bind_session_identity`).
            force_session_owner(body, &user.profile_id);
            Ok(())
        }
        CommandPolicy::ProjectDeadlineWrite => {
            // Narrow deadline path: owner or admin only, project taken from the request
            // itself, and no other project column is reachable from this command.
            let project_id: String =
                arg(body, "project_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .ok_or_else(|| err(StatusCode::FORBIDDEN, "project access denied"))?;
            // One refusal for both halves: an id that does not exist and one you may not
            // touch must be indistinguishable, or the error text becomes an existence oracle.
            if user.role != "GlobalAdmin" && owner != user.profile_id {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            }
            Ok(())
        }
        CommandPolicy::ProjectDelete => {
            // Same owner-or-admin door as every other project write, and the acting
            // identity comes from the session: the body may name an `actor_id`, it is
            // overwritten before the library re-checks the very same rule.
            let project_id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .ok_or_else(|| err(StatusCode::FORBIDDEN, "project access denied"))?;
            if user.role != "GlobalAdmin" && owner != user.profile_id {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the project owner or an admin can delete this project",
                ));
            }
            put_arg(body, "actor_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::ProjectWrite => {
            let (project_id, _) =
                project_from_body(body).map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .ok_or_else(|| err(StatusCode::FORBIDDEN, "project access denied"))?;
            if user.role != "GlobalAdmin" && owner != user.profile_id {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the project owner or an admin can change this project",
                ));
            }
            // `created_by` is immutable after creation; never let an update transfer ownership.
            if let Some(project) = body.get_mut("project").and_then(Value::as_object_mut) {
                project.insert("created_by".into(), json!(owner));
            }
            Ok(())
        }
        // Same rule as the issue list: naming no project is a "what may I see" read,
        // answered per project below; naming one is checked against that project here.
        CommandPolicy::ProjectRead => {
            if matches!(name, "list_issue_statuses" | "list_boards")
                && arg::<Option<String>>(body, "project_id")
                    .ok()
                    .flatten()
                    .is_none()
            {
                return Ok(());
            }
            let project_id: Option<String> = arg(body, "id")
                .ok()
                .or_else(|| arg(body, "project_id").ok().flatten());
            let Some(project_id) = project_id else {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            };
            if project_readable(user, &project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "project access denied"))
            }
        }
        CommandPolicy::PipelineScriptWrite => {
            let payload = body.get("script");
            let payload_project = payload
                .and_then(|script| script.get("project_id").or_else(|| script.get("projectId")))
                .and_then(Value::as_str);
            let payload_id = payload
                .and_then(|script| script.get("id"))
                .and_then(Value::as_str);
            let script_id = arg::<Option<String>>(body, "script_id")
                .ok()
                .flatten()
                .or_else(|| arg::<Option<String>>(body, "id").ok().flatten())
                .or_else(|| payload_id.map(str::to_owned));
            let mut project_ids = Vec::new();
            if name == "create_pipeline_script" {
                project_ids.push(
                    payload_project
                        .ok_or_else(|| {
                            err(StatusCode::BAD_REQUEST, "script.project_id is required")
                        })?
                        .to_owned(),
                );
            } else {
                let script_id = script_id
                    .ok_or_else(|| err(StatusCode::BAD_REQUEST, "script id is required"))?;
                let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
                let stored: String = c
                    .query_row(
                        "SELECT project_id FROM pipeline_scripts WHERE id=?1 AND archived=0",
                        [&script_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| err(StatusCode::FORBIDDEN, "project access denied"))?;
                project_ids.push(stored);
                if name == "update_pipeline_script" {
                    project_ids.push(
                        payload_project
                            .ok_or_else(|| {
                                err(StatusCode::BAD_REQUEST, "script.project_id is required")
                            })?
                            .to_owned(),
                    );
                }
            }
            // Authoring is execution deferred: whoever writes a script body runs it later,
            // so writes take the execute-tier predicate (owner|admin), not `project_readable`.
            let allowed = project_ids
                .iter()
                .map(|project_id| project_pipeline_executable(user, project_id))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .into_iter()
                .all(|allowed| allowed);
            if allowed {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "project access denied"))
            }
        }
        CommandPolicy::PipelineScriptExecute => {
            let script_id = arg::<Option<String>>(body, "script_id")
                .ok()
                .flatten()
                .or_else(|| arg::<Option<String>>(body, "id").ok().flatten())
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "script id is required"))?;
            let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            let project_id: String = c
                .query_row(
                    "SELECT project_id FROM pipeline_scripts WHERE id=?1 AND archived=0",
                    [&script_id],
                    |row| row.get(0),
                )
                .map_err(|_| err(StatusCode::FORBIDDEN, "project access denied"))?;
            if project_pipeline_executable(user, &project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "project access denied"))
            }
        }
        CommandPolicy::ProjectMemberWrite => {
            let project_id = body
                .get("input")
                .and_then(|input| input.get("project_id").or_else(|| input.get("projectId")))
                .and_then(Value::as_str)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "project_id is required"))?;
            if !project_readable(user, project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            }
            if name == "create_issue" {
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::CreateIssue,
                    "project",
                    Some(project_id),
                )?;
            }
            Ok(())
        }
        // Contact leads are private PII, not a workspace-wide member feed.
        CommandPolicy::LeadRead => {
            if user.role == "GlobalAdmin" {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "only an administrator can view leads"))
            }
        }
        // App credentials are workspace-wide secrets with no per-app owner to fall
        // back on: an ordinary member must not rotate another app's secret, mint a
        // token, or probe one for validity.
        CommandPolicy::AppAdmin => {
            if user.role == "GlobalAdmin" {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "only an administrator can perform this command",
                ))
            }
        }
        // Only the owner or an admin decides who belongs to a project.
        CommandPolicy::ProjectMemberAdmin => {
            let project_id: String =
                arg(body, "project_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            // `member_id` deliberately escapes bind_session_identity: naming somebody
            // else is the whole point here, and the right to do it is checked below.
            if user.role == "GlobalAdmin" || owner.as_deref() == Some(user.profile_id.as_str()) {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "only the project owner or an administrator can change project members",
                ))
            }
        }
        // Assigning people is an issue write scoped to the project. Whoever may
        // change the project's membership (owner/admin) also brings somebody new
        // onto it by assigning them; everybody else can only pick existing members.
        CommandPolicy::IssueAssign => {
            let issue: String =
                arg(body, "issue_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let project_id = issue_project(&issue)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .ok_or_else(|| err(StatusCode::FORBIDDEN, "project access denied"))?;
            if !project_readable(user, &project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            }
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            let may_admit =
                user.role == "GlobalAdmin" || owner.as_deref() == Some(user.profile_id.as_str());
            let people: Vec<String> = arg(body, "profile_ids").unwrap_or_default();
            for profile in &people {
                let member = owner.as_deref() == Some(profile.as_str())
                    || personal::project_member_by(&project_id, profile)
                        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
                if member {
                    continue;
                }
                if !may_admit {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "only project members can be assigned",
                    ));
                }
                personal::add_project_member(project_id.clone(), profile.clone())
                    .map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            }
            Ok(())
        }
        // A list read without a project names no project, so it cannot be refused for one:
        // it is the caller asking "what may I see", and the answer is filtered per project
        // below (the same shape `list_projects` already uses). A list read that DOES name a
        // project is still refused outright when that project is not the caller's.
        CommandPolicy::IssueRead => {
            if name == "list_issues"
                && arg::<Option<String>>(body, "project_id")
                    .ok()
                    .flatten()
                    .is_none()
            {
                return Ok(());
            }
            let project_id = if name == "list_issues" {
                arg(body, "project_id").ok().flatten()
            } else {
                issue_id(body).and_then(|id| issue_project(&id).ok().flatten())
            };
            let Some(project_id) = project_id else {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            };
            if project_readable(user, &project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "project access denied"))
            }
        }
        CommandPolicy::BoardRead => {
            let board_id: String =
                arg(body, "board_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let Some(project_id) =
                board_project(&board_id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            else {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            };
            if project_readable(user, &project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "project access denied"))
            }
        }
        CommandPolicy::TodoRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::TodoCreate => {
            let project_id = body
                .get("input")
                .and_then(|input| input.get("project_id").or_else(|| input.get("projectId")))
                .and_then(Value::as_str);
            if let Some(project_id) = project_id.filter(|id| !id.trim().is_empty()) {
                if !project_readable(user, project_id)
                    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                {
                    return Err(err(StatusCode::FORBIDDEN, "project access denied"));
                }
            }
            Ok(())
        }
        CommandPolicy::DashboardPreferencesWrite => {
            body.as_object_mut()
                .and_then(|body| body.get_mut("preferences"))
                .and_then(Value::as_object_mut)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "preferences are required"))?
                .insert("profile_id".into(), json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::CalendarOptionsWrite => {
            body.as_object_mut()
                .and_then(|body| body.get_mut("options"))
                .and_then(Value::as_object_mut)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "options are required"))?
                .insert("profile_id".into(), json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::CalendarRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        // List: same shape as CalendarRead. `id` present in `input` (an existing
        // feed) is checked against the DB-recorded owner before profile_id is
        // stamped on — admin bypasses ownership but never authorship.
        CommandPolicy::CalendarUpsert => {
            let input = body
                .get_mut("input")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid argument `input`"))?;
            if let Some(id) = input.get("id").and_then(Value::as_str) {
                if user.role != "GlobalAdmin"
                    && calendar_feeds::calendar_owner(id).ok().flatten().as_deref()
                        != Some(&user.profile_id)
                {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "only the owner can change this calendar",
                    ));
                }
            }
            input.insert("profile_id".into(), json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::CalendarOwnerAction => {
            let id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if user.role != "GlobalAdmin"
                && calendar_feeds::calendar_owner(&id)
                    .ok()
                    .flatten()
                    .as_deref()
                    != Some(&user.profile_id)
            {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the owner can delete this calendar",
                ));
            }
            Ok(())
        }
        CommandPolicy::CalendarFeedRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::CalendarFeedUpsert => {
            let input = body
                .get_mut("input")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid argument `input`"))?;
            if let Some(id) = input.get("id").and_then(Value::as_str).map(str::to_owned) {
                if user.role != "GlobalAdmin" && !calendar_feed_owned_by(&user.profile_id, &id) {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "only the owner can change this calendar feed",
                    ));
                }
            }
            input.insert("profile_id".into(), json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::CalendarFeedOwnerAction => {
            let id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if user.role != "GlobalAdmin" && !calendar_feed_owned_by(&user.profile_id, &id) {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the owner can change this calendar feed",
                ));
            }
            Ok(())
        }
        CommandPolicy::ProjectTodoRead => {
            // SQL applies the row-level todo scope. Member-directory reads themselves
            // are limited to project members (or the global admin).
            if name == "list_project_member_ids" {
                let project_id: String =
                    arg(body, "project_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if user.role != "GlobalAdmin"
                    && !personal::project_member_by(&project_id, &user.profile_id)
                        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                {
                    return Err(err(StatusCode::FORBIDDEN, "project access denied"));
                }
            }
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        // Reads: the channel id is the scope and `channel_notes::list_channel_notes`
        // refuses a non-member outright, so there is nothing left to decide here beyond
        // pinning the reader to their own session — which the rebinding above already did.
        CommandPolicy::ChannelNoteRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        // Writes: membership (append) and authorship (edit/delete) are enforced in Rust
        // against the STORED row, never against the payload, so a forged `author_id`
        // cannot buy anything. A global admin gets no extra door: an entry in a log is
        // somebody's statement, and rewriting another person's statement is exactly what
        // the visible-edit rule exists to prevent.
        CommandPolicy::ChannelNoteWrite => {
            put_arg(body, "profile_id", json!(user.profile_id));
            if name == "delete_channel_note" {
                let note_id: String =
                    arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                let author = channel_notes::note_author(&note_id)
                    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
                // A note that exists but is not the caller's is answered exactly like a
                // missing one, so the endpoint cannot be used to probe for note ids.
                if author.as_deref() != Some(user.profile_id.as_str()) {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "only the author can delete this note",
                    ));
                }
            }
            Ok(())
        }
        CommandPolicy::MessageAttachmentWrite => {
            // The message id is the scope of the whole attachment family; without it an
            // attachment id alone would be a capability over every message in the space.
            let message_id: String =
                arg(body, "message_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if chat::message_attachment_writable_by(
                &message_id,
                &user.profile_id,
                user.role == "admin",
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "only the message author or a channel administrator can change its attachments",
                ))
            }
        }
        CommandPolicy::TodoOwnerWrite => {
            let todo_id: Option<String> = if name == "update_todo" {
                body.get("todo")
                    .and_then(|todo| todo.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            } else {
                arg(body, "id").ok()
            };
            let Some(todo_id) = todo_id else {
                return Err(err(StatusCode::BAD_REQUEST, "invalid argument `id`"));
            };
            if user.role != "GlobalAdmin" && !todo_owned_by(&user.profile_id, &todo_id) {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the owner can change this todo",
                ));
            }
            Ok(())
        }
        CommandPolicy::TodoOwnerDelete => {
            // Author, project owner or admin — the library holds the rule, so the gate
            // only refuses an unknown id and binds who is acting to the session.
            let todo_id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if user.role != "GlobalAdmin"
                && !todo_owned_by(&user.profile_id, &todo_id)
                && !todo_project_owned_by(&user.profile_id, &todo_id)
            {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the author, the project owner or an admin can delete this todo",
                ));
            }
            put_arg(body, "actor_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::TodoCompletionWrite => {
            let todo_id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if user.role == "GlobalAdmin" || todo_owned_by(&user.profile_id, &todo_id) {
                return Ok(());
            }
            let assigned = personal::todo_assigned_by(&todo_id, &user.profile_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            if assigned {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "only the owner or an assignee can complete this todo",
                ))
            }
        }
        CommandPolicy::NotificationWrite => {
            let notification_id: String =
                arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if notification_owned_by(&user.profile_id, &notification_id) {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "only the recipient can change this notification",
                ))
            }
        }
        CommandPolicy::AbsenceWrite => {
            // Admins manage any profile's absences, approval included; identity rebinding is
            // skipped for them upstream so the client-supplied `profile_id` survives.
            if user.role == "GlobalAdmin" {
                return Ok(());
            }
            // Members own their rows only, and may never move the `approved` flag.
            if name == "create_absence" {
                let input = body
                    .get_mut("input")
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid absence"))?;
                if input
                    .get("approved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "members cannot approve absences",
                    ));
                }
                input.insert("profile_id".into(), json!(user.profile_id));
                return Ok(());
            }
            let id: String = if name == "update_absence" {
                nested_id(body, "absence")
            } else {
                arg(body, "id").ok()
            }
            .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid absence id"))?;
            // Ownership is read from the database, never from the request payload.
            let owner = db::conn()
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .query_row("SELECT profile_id FROM absences WHERE id=?1", [&id], |r| {
                    r.get::<_, String>(0)
                })
                .ok();
            if owner.as_deref() != Some(user.profile_id.as_str()) {
                return Err(err(StatusCode::FORBIDDEN, "absence access denied"));
            }
            if name == "update_absence" {
                let stored_approval: bool = db::conn()
                    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                    .query_row("SELECT approved FROM absences WHERE id=?1", [&id], |r| {
                        r.get(0)
                    })
                    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
                let absence = body
                    .get_mut("absence")
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid absence"))?;
                // Any change of `approved`, in either direction, is an admin-only act.
                if absence
                    .get("approved")
                    .and_then(Value::as_bool)
                    .unwrap_or(stored_approval)
                    != stored_approval
                {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "members cannot change absence approval",
                    ));
                }
                absence.insert("profile_id".into(), json!(user.profile_id));
            }
            Ok(())
        }
        CommandPolicy::SessionIdentityWrite => match name {
            "create_meeting" => bind_required_object_identity(
                body,
                "meeting",
                "organizer_id",
                "organizerId",
                &user.profile_id,
            ),
            _ => unreachable!("identity-write policy must name an identity-write command"),
        }
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e)),
        CommandPolicy::DocumentCreate => {
            bind_document_create(user, body).map_err(|e| err(StatusCode::FORBIDDEN, &e))?;
            require_catalog_right(
                user,
                gaia_space_lib::rights::Right::CreateDocument,
                "global",
                None,
            )
        }
        CommandPolicy::DocumentReadList => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::DocumentRead => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if documents::document_readable_by(&id, &user.profile_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                put_arg(body, "profile_id", json!(user.profile_id));
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document access denied"))
            }
        }
        CommandPolicy::DocumentWrite => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if documents::document_writable_by(&id, &user.profile_id, user.role == "GlobalAdmin")
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                if matches!(name, "save_document" | "restore_doc_version") {
                    put_arg(body, "actor", json!(user.profile_id));
                }
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::EditDocument,
                    "document",
                    Some(&id),
                )
            } else {
                Err(err(StatusCode::FORBIDDEN, "document write denied"))
            }
        }
        CommandPolicy::DocumentOwnerWrite => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if documents::document_owner_writable_by(
                &id,
                &user.profile_id,
                user.role == "GlobalAdmin",
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document owner access denied"))
            }
        }
        CommandPolicy::DocumentOwnerDelete => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if !documents::document_deletable_by(&id, &user.profile_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                return Err(err(StatusCode::FORBIDDEN, "document owner access denied"));
            }
            put_arg(body, "actor_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::DocumentFolderDelete => {
            let id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if !documents::document_folder_deletable_by(&id, &user.profile_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "document folder owner access denied",
                ));
            }
            put_arg(body, "actor_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::DocumentAccessWrite => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if documents::document_access_manageable_by(
                &id,
                &user.profile_id,
                user.role == "GlobalAdmin",
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document sharing access denied"))
            }
        }
        CommandPolicy::DocumentFolderCreate => {
            bind_folder_create(user, body).map_err(|e| err(StatusCode::FORBIDDEN, &e))
        }
        CommandPolicy::DocumentFolderReadList => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::DocumentFolderWrite => {
            let id = if name == "update_document_folder" {
                nested_id(body, "folder")
            } else {
                arg(body, "id").ok()
            }
            .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid folder id"))?;
            if documents::document_folder_writable_by(
                &id,
                &user.profile_id,
                user.role == "GlobalAdmin",
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document folder write denied"))
            }
        }
        CommandPolicy::BookRead => {
            let book_id: String =
                arg(body, "book_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if documents::book_readable_by(&book_id, &user.profile_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "knowledge-base book access denied",
                ))
            }
        }
        CommandPolicy::BookManage => {
            let book_id: String =
                arg(body, "book_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if documents::book_manageable_by(&book_id, &user.profile_id, user.role == "GlobalAdmin")
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "knowledge-base book management denied",
                ))
            }
        }
        CommandPolicy::MeetingReadList => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        CommandPolicy::MeetingRead => {
            let id = meeting_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid meeting id"))?;
            if meetings::meeting_readable_by(&id, &user.profile_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                put_arg(body, "profile_id", json!(user.profile_id));
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "meeting access denied"))
            }
        }
        CommandPolicy::MeetingWrite => {
            let id = meeting_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid meeting id"))?;
            if !meetings::meeting_writable_by(&id, &user.profile_id, user.role == "GlobalAdmin")
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                return Err(err(StatusCode::FORBIDDEN, "meeting write denied"));
            }
            if name == "update_meeting" {
                let organizer = meetings::get_meeting_scoped(id, user.profile_id.clone())
                    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                    .and_then(|m| m.organizer_id)
                    .ok_or_else(|| err(StatusCode::FORBIDDEN, "meeting write denied"))?;
                body.get_mut("meeting")
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid argument `meeting`"))?
                    .insert("organizer_id".into(), json!(organizer));
            }
            Ok(())
        }
        CommandPolicy::MeetingParticipantWrite => {
            let id = meeting_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid meeting id"))?;
            let target: String =
                arg(body, "profile_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            let self_rsvp: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM meeting_participants WHERE meeting_id=?1 AND profile_id=?2)", params![&id, user.profile_id], |r| r.get(0)).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            let organizer: bool = c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM meetings WHERE id=?1 AND organizer_id=?2)",
                    params![id, user.profile_id],
                    |r| r.get(0),
                )
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            if (target == user.profile_id && self_rsvp) || organizer || user.role == "GlobalAdmin" {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "only a participant may change their RSVP; organizer access is required for another participant"))
            }
        }
        CommandPolicy::SearchRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            put_arg(body, "allow_all", json!(user.role == "GlobalAdmin"));
            Ok(())
        }
        CommandPolicy::PackageRepositoryRead
        | CommandPolicy::PackageRepositoryWrite
        | CommandPolicy::PackageRepositoryAdmin => {
            let level = match policy {
                CommandPolicy::PackageRepositoryRead => RepoAccess::Read,
                CommandPolicy::PackageRepositoryWrite => RepoAccess::Write,
                _ => RepoAccess::Admin,
            };
            // The repository is named differently by each command; a write whose target
            // cannot be identified is refused rather than allowed.
            let repository_id = arg::<String>(body, "repository_id")
                .ok()
                .or_else(|| {
                    body.get("entry")
                        .and_then(|entry| arg::<String>(entry, "repository_id").ok())
                })
                .or_else(|| {
                    body.get("repo")
                        .and_then(|repo| arg::<String>(repo, "id").ok())
                })
                .or_else(|| {
                    body.get("vulnerability")
                        .and_then(|v| arg::<String>(v, "version_id").ok())
                        .and_then(|id| id.split("::").next().map(str::to_string))
                })
                .or_else(|| {
                    // A version id is `repository::package::version`.
                    arg::<String>(body, "version_id")
                        .ok()
                        .or_else(|| arg::<String>(body, "id").ok())
                        .and_then(|id| id.split("::").next().map(str::to_string))
                })
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid argument `repository_id`"))?;
            if repository_access(user, &repository_id, level)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "repository access denied"))
            }
        }
        CommandPolicy::Session => {
            if name == "create_message" {
                let message = body
                    .get("message")
                    .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid message"))?;
                let channel_id: String =
                    arg(message, "channel_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_channel_access(&user.profile_id, &channel_id) {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::PostMessage,
                    "channel",
                    Some(&channel_id),
                )?;
            }
            if matches!(
                name,
                "list_messages"
                    | "list_messages_page"
                    | "list_pinned_messages"
                    | "save_message_draft"
                    | "get_message_draft"
                    | "delete_message_draft"
                    | "set_channel_typing"
                    | "list_channel_typing"
                    | "list_channel_members"
                    | "get_channel"
                    | "mark_channel_read"
                    | "join_channel"
                    | "leave_channel"
            ) {
                let key = if name == "get_channel" {
                    "id"
                } else {
                    "channel_id"
                };
                let channel_id: String =
                    arg(body, key).map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_channel_access(&user.profile_id, &channel_id) {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if name == "schedule_message" {
                let channel_id: String =
                    arg(body, "channel_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_channel_access(&user.profile_id, &channel_id) {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
                // Postponing a message is still posting it: same right, earlier click.
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::PostMessage,
                    "channel",
                    Some(&channel_id),
                )?;
            }
            if name == "create_poll" {
                let channel_id: String =
                    arg(body, "channel_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_channel_access(&user.profile_id, &channel_id) {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
                // A poll is posted as a message, so it needs the posting right.
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::PostMessage,
                    "channel",
                    Some(&channel_id),
                )?;
            }
            if name == "list_channel_polls" {
                let channel_id: String =
                    arg(body, "channel_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_channel_access(&user.profile_id, &channel_id) {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if matches!(name, "vote_poll" | "close_poll" | "get_poll") {
                let key = if name == "get_poll" { "id" } else { "poll_id" };
                let poll_id: String =
                    arg(body, key).map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                // A poll is readable/votable only from inside its channel; chat.rs still
                // owns the author-only close and the closed/ownership rules.
                if !chat_poll_channel(&poll_id)
                    .is_some_and(|channel_id| chat_channel_access(&user.profile_id, &channel_id))
                {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if name == "unfurl_message_links" {
                let message_id: String =
                    arg(body, "message_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                // The caller's `channel_id` is never consulted: the channel is whatever
                // the message actually belongs to.
                if !chat_message_channel(&message_id)
                    .is_some_and(|channel_id| chat_channel_access(&user.profile_id, &channel_id))
                {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if name == "list_thread_replies" {
                let thread_of: String =
                    arg(body, "thread_of").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_message_channel(&thread_of)
                    .is_some_and(|channel_id| chat_channel_access(&user.profile_id, &channel_id))
                {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if name == "ensure_thread_channel" {
                let root_message_id: String =
                    arg(body, "root_message_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_message_channel(&root_message_id)
                    .is_some_and(|channel_id| chat_channel_access(&user.profile_id, &channel_id))
                {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if matches!(name, "add_reaction" | "remove_reaction") {
                let message_id: String =
                    arg(body, "message_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_message_channel(&message_id)
                    .is_some_and(|channel_id| chat_channel_access(&user.profile_id, &channel_id))
                {
                    return Err(err(StatusCode::FORBIDDEN, "channel access denied"));
                }
            }
            if matches!(
                name,
                "update_message" | "delete_message" | "set_message_pinned"
            ) {
                let id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_message_owned(&user.profile_id, &id) {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "only the author can change this message",
                    ));
                }
            }
            if matches!(name, "create_channel" | "create_entity_channel") {
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::ManageChannel,
                    "global",
                    None,
                )?;
            }
            if matches!(
                name,
                "update_channel"
                    | "add_channel_member"
                    | "remove_channel_member"
                    | "delete_channel"
            ) {
                let channel_id: String = if name == "update_channel" {
                    body.get("channel")
                        .and_then(|channel| arg(channel, "id").ok())
                        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid channel"))?
                } else if name == "delete_channel" {
                    arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?
                } else {
                    arg(body, "channel_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?
                };
                require_catalog_right(
                    user,
                    gaia_space_lib::rights::Right::ManageChannel,
                    "channel",
                    Some(&channel_id),
                )?;
                if name == "delete_channel" {
                    // The library re-checks the same right; who is acting is the
                    // session, never a name the caller typed into the body.
                    put_arg(body, "actor_id", json!(user.profile_id));
                }
            }
            if name == "create_channel" {
                let supplied: Vec<String> = arg(body, "member_ids").unwrap_or_default();
                let mut members = vec![user.profile_id.clone()];
                for id in supplied {
                    if id != user.profile_id && !members.contains(&id) {
                        members.push(id);
                    }
                }
                let content_type = body
                    .get("channel")
                    .and_then(|v| v.get("content_type").or_else(|| v.get("contentType")))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if content_type == "dm" && members.len() != 2 {
                    return Err(err(
                        StatusCode::BAD_REQUEST,
                        "a direct message requires exactly one recipient",
                    ));
                }
                put_arg(body, "member_ids", json!(members));
            }
            if matches!(name, "add_channel_member" | "remove_channel_member") {
                let channel_id: String =
                    arg(body, "channel_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                let target: String =
                    arg(body, "member_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                let removing_self = name == "remove_channel_member" && target == user.profile_id;
                if chat_channel_type(&channel_id).as_deref() == Some("dm")
                    || (!removing_self && !chat_can_manage(&user.profile_id, &channel_id))
                {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "channel membership is fixed or requires a channel administrator",
                    ));
                }
            }
            Ok(())
        }
    }
}

macro_rules! dispatch {
    ($name:expr, $body:expr, { $($cmd:literal => $m:ident :: $f:ident ( $($a:ident : $t:ty),* $(,)? )),* $(,)? }) => {
        match $name {
            $($cmd => {
                let __body = &$body;
                $(let $a: $t = match arg(__body, stringify!($a)) { Ok(v)=>v, Err(e)=>return err(StatusCode::BAD_REQUEST,&e).into_response() };)*
                match $m::$f($($a),*) {
                    Ok(v)=>Json(json!({"ok":true,"value":v})).into_response(),
                    Err(e)=>err(StatusCode::BAD_REQUEST,&e).into_response(),
                }
            })*
            n if n.starts_with("repo_") || matches!(n,
                "app_info" | "join_meeting_call" | "end_meeting_call" | "start_livekit_server" |
                "trigger_pipeline_script" | "review_diff" | "dry_run_merge" |
                "attempt_merge" | "open_merge_request"
            ) => err(StatusCode::NOT_IMPLEMENTED,"not available in web mode").into_response(),
            _ => err(StatusCode::NOT_FOUND,"unknown command").into_response(),
        }
    };
}
/// Absence updates leave the generic dispatch table: the write itself depends on the caller's
/// role, because only an admin write may reach the `approved` column at all.
fn absence_update(user: &User, body: &Value) -> axum::response::Response {
    let absence: personal::Absence = match arg(body, "absence") {
        Ok(v) => v,
        Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response(),
    };
    if user.role == "GlobalAdmin" {
        return match personal::update_absence(absence) {
            Ok(v) => Json(json!({"ok":true,"value":v})).into_response(),
            Err(e) => err(StatusCode::BAD_REQUEST, &e).into_response(),
        };
    }
    match personal::update_absence_details(absence, &user.profile_id) {
        Ok(Some(v)) => Json(json!({"ok":true,"value":v})).into_response(),
        Ok(None) => err(StatusCode::FORBIDDEN, "absence access denied").into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e).into_response(),
    }
}
/// Deletes leave the generic dispatch table for the same reason updates do: a member delete
/// must carry its ownership predicate into the statement, an admin delete must not.
fn absence_delete(user: &User, body: &Value) -> axum::response::Response {
    let id: String = match arg(body, "id") {
        Ok(v) => v,
        Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response(),
    };
    if user.role == "GlobalAdmin" {
        return match personal::delete_absence(id) {
            Ok(()) => Json(json!({"ok":true,"value":null})).into_response(),
            Err(e) => err(StatusCode::BAD_REQUEST, &e).into_response(),
        };
    }
    match personal::delete_absence_owned(&id, &user.profile_id) {
        Ok(true) => Json(json!({"ok":true,"value":null})).into_response(),
        Ok(false) => err(StatusCode::FORBIDDEN, "absence access denied").into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e).into_response(),
    }
}
/// Generic registry protocol: binary upload/download plus a server-normalized metadata
/// endpoint. It deliberately shares `pipelines` validation and ownership of filesystem paths.
async fn registry_generic_upload(
    headers: HeaderMap,
    Path((repository_id, package_name, version, filename)): Path<(String, String, String, String)>,
    payload: Bytes,
) -> axum::response::Response {
    if let Err(error) = user_by_token(&headers) {
        return error.into_response();
    }
    let metadata = headers
        .get("x-package-metadata")
        .and_then(|v| v.to_str().ok());
    match pipelines::publish_registry_bytes(
        &repository_id,
        &package_name,
        &version,
        metadata,
        Some(&filename),
        Some(&payload),
    ) {
        Ok(value) => (StatusCode::CREATED, Json(json!(value))).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}
async fn registry_generic_download(
    headers: HeaderMap,
    Path((repository_id, package_name, version, filename)): Path<(String, String, String, String)>,
) -> axum::response::Response {
    if let Err(error) = user_by_token(&headers) {
        return error.into_response();
    }
    match pipelines::download_registry_bytes(&repository_id, &package_name, &version, &filename) {
        Ok(payload) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            payload,
        )
            .into_response(),
        Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
    }
}
async fn registry_generic_metadata(
    headers: HeaderMap,
    Path((repository_id, package_name, version)): Path<(String, String, String)>,
) -> axum::response::Response {
    if let Err(error) = user_by_token(&headers) {
        return error.into_response();
    }
    match pipelines::generic_registry_metadata(&repository_id, &package_name, &version) {
        Ok(value) => Json(value).into_response(),
        Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
    }
}
/// npm-compatible package document endpoint. A PUT stores a version manifest; GET returns
/// the `versions` and `dist-tags.latest` shape clients use for resolution.
/// npm wire protocol entry point. One wildcard route because npm addresses both the packument
/// (`/{name}`, scoped names arriving as `@scope%2Fname`) and tarballs (`/{name}/-/{file}`).
async fn registry_npm_put(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
    body: Bytes,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, true) {
        return response;
    }
    let package_name = path.trim_matches('/').to_string();
    let document: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return err(
                StatusCode::BAD_REQUEST,
                &format!("invalid npm document: {error}"),
            )
            .into_response()
        }
    };
    // Real `npm publish`/`bun publish` bodies carry `versions` + `_attachments`; the legacy
    // single-manifest body (top-level `version`) stays supported for existing callers.
    if document.get("versions").is_some() {
        return match pipelines::npm_publish_document(&repository_id, &package_name, &document) {
            Ok(published) => (
                StatusCode::CREATED,
                Json(json!({"ok": true, "id": package_name, "versions": published})),
            )
                .into_response(),
            Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
        };
    }
    registry_npm_publish_manifest(repository_id, package_name, document).await
}
async fn registry_npm_get(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, false) {
        return response;
    }
    let path = path.trim_matches('/').to_string();
    if let Some((package_name, filename)) = path.split_once("/-/") {
        let version =
            match pipelines::npm_version_for_tarball(&repository_id, package_name, filename) {
                Ok(version) => version,
                Err(error) => return err(StatusCode::NOT_FOUND, &error).into_response(),
            };
        return match pipelines::registry_asset(&repository_id, package_name, &version, filename) {
            Ok(payload) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/octet-stream")],
                payload,
            )
                .into_response(),
            Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
        };
    }
    let base = registry_base_url(&headers, &repository_id, "npm");
    match pipelines::npm_packument(&repository_id, &path, &base) {
        Ok(value) => Json(value).into_response(),
        Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
    }
}
/// Absolute URL of one repository's format root, as the client reached it — npm requires
/// absolute `dist.tarball` values.
fn registry_base_url(headers: &HeaderMap, repository_id: &str, format: &str) -> String {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    format!("{scheme}://{host}/api/registry/{repository_id}/{format}")
}
/// Maven repository-layout endpoint: `PUT`/`GET` of
/// `/api/registry/{repo}/maven/{groupPath}/{artifactId}/{version}/{file}`, plus generated
/// `maven-metadata.xml` and on-demand `.sha1` companions.
async fn registry_maven_put(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
    payload: Bytes,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, true) {
        return response;
    }
    let (package_name, version, filename) = match pipelines::maven_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    let Some(version) = version else {
        // Clients upload their own maven-metadata.xml; the server generates it instead.
        return (StatusCode::OK, Json(json!({"ok": true}))).into_response();
    };
    let (group_id, artifact_id) = package_name.split_once('/').unwrap_or(("", &package_name));
    let metadata = json!({
        "formatMetadata": {
            "groupId": group_id,
            "artifactId": artifact_id,
            "version": version,
            "snapshot": version.ends_with("-SNAPSHOT"),
        }
    });
    match pipelines::publish_registry_bytes(
        &repository_id,
        &package_name,
        &version,
        Some(&metadata.to_string()),
        Some(&filename),
        Some(&payload),
    ) {
        Ok(_) => (StatusCode::CREATED, Json(json!({"ok": true}))).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}
async fn registry_maven_get(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, false) {
        return response;
    }
    let (package_name, version, filename) = match pipelines::maven_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    let Some(version) = version else {
        return match pipelines::maven_metadata_xml(&repository_id, &package_name) {
            Ok(xml) => {
                let body = if let Some(kind) = filename.strip_prefix("maven-metadata.xml.") {
                    match kind {
                        "sha1" => pipelines::sha1_hex(xml.as_bytes()),
                        _ => {
                            return err(StatusCode::NOT_FOUND, "unsupported checksum")
                                .into_response()
                        }
                    }
                } else {
                    xml
                };
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/xml")],
                    body,
                )
                    .into_response()
            }
            Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
        };
    };
    match pipelines::registry_asset(&repository_id, &package_name, &version, &filename) {
        Ok(payload) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            payload,
        )
            .into_response(),
        Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
    }
}
/// NuGet V3: `GET .../nuget/index.json` service index, `GET .../nuget/{id}/index.json`
/// version list, `GET|PUT .../nuget/{id}/{version}/{file}` flat-container assets.
async fn registry_nuget_get(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, false) {
        return response;
    }
    if path.trim_matches('/') == "index.json" {
        let base = registry_base_url(&headers, &repository_id, "nuget");
        return (
            StatusCode::OK,
            Json(package_registry::nuget_service_index(&base)),
        )
            .into_response();
    }
    let (package_name, version, filename) = match package_registry::nuget_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    let Some(version) = version else {
        return match package_registry::nuget_version_index(&repository_id, &package_name) {
            Ok(document) => (StatusCode::OK, Json(document)).into_response(),
            Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
        };
    };
    match pipelines::registry_asset(&repository_id, &package_name, &version, &filename) {
        Ok(payload) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            payload,
        )
            .into_response(),
        Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
    }
}
async fn registry_nuget_put(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
    payload: Bytes,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, true) {
        return response;
    }
    let (package_name, version, filename) = match package_registry::nuget_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    let Some(version) = version else {
        return err(
            StatusCode::BAD_REQUEST,
            "nuget upload needs {id}/{version}/{file}",
        )
        .into_response();
    };
    let metadata = json!({"formatMetadata": {"id": package_name, "version": version}});
    match pipelines::publish_registry_bytes(
        &repository_id,
        &package_name,
        &version,
        Some(&metadata.to_string()),
        Some(&filename),
        Some(&payload),
    ) {
        Ok(_) => (StatusCode::CREATED, Json(json!({"ok": true}))).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}
/// PyPI simple API (PEP 503): `GET .../pypi/{name}/` project page, `GET .../pypi/{name}/{file}`
/// distribution download. Uploads keep the legacy generic route — PEP 694 upload is not built.
async fn registry_pypi_get(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, false) {
        return response;
    }
    let (package_name, filename) = match package_registry::pypi_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    let Some(filename) = filename else {
        return match package_registry::pypi_simple_project(&repository_id, &package_name) {
            Ok(html) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                html,
            )
                .into_response(),
            Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
        };
    };
    // A distribution filename does not carry the stored version reliably, so the version that
    // actually holds this file is resolved from storage rather than parsed out of the name.
    let versions = match package_registry::stored_versions("pypi", &repository_id, &package_name) {
        Ok(rows) => rows,
        Err(error) => return err(StatusCode::NOT_FOUND, &error).into_response(),
    };
    for row in versions {
        // Storage keeps the publisher's spelling; the request carries the normalized name.
        if let Ok(payload) =
            pipelines::registry_asset(&repository_id, &row.package_name, &row.version, &filename)
        {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/octet-stream")],
                payload,
            )
                .into_response();
        }
    }
    err(StatusCode::NOT_FOUND, "pypi distribution not found").into_response()
}
/// Composer: `GET .../composer/packages.json` root document and
/// `GET .../composer/p2/{vendor}/{package}.json` version metadata.
async fn registry_composer_get(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, false) {
        return response;
    }
    match package_registry::composer_coordinates(&path) {
        Ok(None) => {
            let base = registry_base_url(&headers, &repository_id, "composer");
            (
                StatusCode::OK,
                Json(package_registry::composer_packages_json(
                    &base,
                    &repository_id,
                )),
            )
                .into_response()
        }
        Ok(Some(package_name)) => {
            match package_registry::composer_package_metadata(&repository_id, &package_name) {
                Ok(document) => (StatusCode::OK, Json(document)).into_response(),
                Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
            }
        }
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}
/// `Docker-Content-Digest` — the header clients read to confirm what they just fetched or
/// pushed is the content they addressed.
const DOCKER_CONTENT_DIGEST: axum::http::HeaderName =
    axum::http::HeaderName::from_static("docker-content-digest");
const DOCKER_UPLOAD_UUID: axum::http::HeaderName =
    axum::http::HeaderName::from_static("docker-upload-uuid");
/// `POST /v2/{name}/blobs/uploads/` — monolithic upload when `?digest=` carries the digest and
/// the body carries the blob, otherwise a session start whose `Location` the client PUTs to.
async fn registry_oci_post(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    payload: Bytes,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, true) {
        return response;
    }
    let (package_name, target) = match package_registry::oci_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    if !matches!(target, package_registry::OciTarget::BlobUploadStart) {
        return err(StatusCode::BAD_REQUEST, "POST is only for blobs/uploads/").into_response();
    }
    let uploads_base = format!("/api/registry/{repository_id}/v2/{package_name}/blobs/uploads");
    match query.get("digest") {
        // Monolithic POST: the whole blob arrives with its digest, so it is stored now.
        Some(digest) if !payload.is_empty() => {
            match package_registry::store_blob(
                &pipelines::package_base_dir(),
                &repository_id,
                &payload,
                Some(digest),
            ) {
                Ok(stored) => blob_created(&repository_id, &package_name, &stored),
                Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
            }
        }
        // Session start. The session id is opaque and carries no state: the PUT that closes it
        // supplies the bytes and the digest, and content addressing decides where they land.
        _ => {
            let session = new_upload_session();
            (
                StatusCode::ACCEPTED,
                [
                    (header::LOCATION, format!("{uploads_base}/{session}")),
                    (DOCKER_UPLOAD_UUID, session.clone()),
                    (header::RANGE, "0-0".to_string()),
                ],
            )
                .into_response()
        }
    }
}
/// A random, opaque upload session id. It is not a key into anything — see `registry_oci_post`.
fn new_upload_session() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
/// The 201 every accepted blob push answers with, per distribution-spec.
fn blob_created(repository_id: &str, package_name: &str, digest: &str) -> axum::response::Response {
    (
        StatusCode::CREATED,
        [
            (
                header::LOCATION,
                format!("/api/registry/{repository_id}/v2/{package_name}/blobs/{digest}"),
            ),
            (DOCKER_CONTENT_DIGEST, digest.to_string()),
        ],
    )
        .into_response()
}
/// OCI distribution spec v2 (read side): tag list, tag-addressed manifest, referrers and
/// digest-addressed blobs out of the content-addressed store.
async fn registry_oci_get(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, false) {
        return response;
    }
    let (package_name, target) = match package_registry::oci_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    match target {
        package_registry::OciTarget::TagList => {
            match package_registry::oci_tag_list(&repository_id, &package_name) {
                Ok(document) => (StatusCode::OK, Json(document)).into_response(),
                Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
            }
        }
        package_registry::OciTarget::Referrers { digest } => {
            match package_registry::oci_referrers(&repository_id, &package_name, &digest) {
                Ok(document) => (StatusCode::OK, Json(document)).into_response(),
                Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
            }
        }
        package_registry::OciTarget::Manifest { reference } => {
            match pipelines::registry_asset(
                &repository_id,
                &package_name,
                &reference,
                "manifest.json",
            ) {
                Ok(payload) => (
                    StatusCode::OK,
                    [(
                        header::CONTENT_TYPE,
                        "application/vnd.oci.image.manifest.v1+json",
                    )],
                    payload,
                )
                    .into_response(),
                Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
            }
        }
        package_registry::OciTarget::Blob { digest } => {
            match package_registry::read_blob(
                &pipelines::package_base_dir(),
                &repository_id,
                &digest,
            ) {
                Ok(bytes) => (
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, "application/octet-stream".to_string()),
                        (DOCKER_CONTENT_DIGEST, digest.clone()),
                    ],
                    bytes,
                )
                    .into_response(),
                Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
            }
        }
        package_registry::OciTarget::BlobUploadStart
        | package_registry::OciTarget::BlobUpload { .. } => err(
            StatusCode::METHOD_NOT_ALLOWED,
            "blob uploads are POST/PUT, not GET",
        )
        .into_response(),
    }
}
/// `PUT /v2/{name}/manifests/{tag}` stores one tagged manifest as a package version;
/// `PUT /v2/{name}/blobs/uploads/{session}?digest=` closes a blob upload into the store.
async fn registry_oci_put(
    headers: HeaderMap,
    Path((repository_id, path)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    payload: Bytes,
) -> axum::response::Response {
    if let Err(response) = registry_repo_auth(&headers, &repository_id, true) {
        return response;
    }
    let (package_name, target) = match package_registry::oci_coordinates(&path) {
        Ok(value) => value,
        Err(error) => return err(StatusCode::BAD_REQUEST, &error).into_response(),
    };
    if matches!(
        target,
        package_registry::OciTarget::BlobUpload { .. }
            | package_registry::OciTarget::BlobUploadStart
    ) {
        let Some(digest) = query.get("digest") else {
            return err(
                StatusCode::BAD_REQUEST,
                "blob upload must close with ?digest={algorithm}:{hex}",
            )
            .into_response();
        };
        return match package_registry::store_blob(
            &pipelines::package_base_dir(),
            &repository_id,
            &payload,
            Some(digest),
        ) {
            Ok(stored) => blob_created(&repository_id, &package_name, &stored),
            Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
        };
    }
    let package_registry::OciTarget::Manifest { reference } = target else {
        return err(
            StatusCode::NOT_IMPLEMENTED,
            "only tagged manifest and blob upload are supported",
        )
        .into_response();
    };
    let manifest: Value = match serde_json::from_slice(&payload) {
        Ok(value) => value,
        Err(error) => {
            return err(
                StatusCode::BAD_REQUEST,
                &format!("invalid oci manifest: {error}"),
            )
            .into_response()
        }
    };
    let subject = manifest
        .get("subject")
        .and_then(|s| s.get("digest"))
        .cloned()
        .unwrap_or(Value::Null);
    let metadata = json!({
        "formatMetadata": {
            "ociManifest": manifest,
            "subject": subject,
        }
    });
    match pipelines::publish_registry_bytes(
        &repository_id,
        &package_name,
        &reference,
        Some(&metadata.to_string()),
        Some("manifest.json"),
        Some(&payload),
    ) {
        Ok(_) => (StatusCode::CREATED, Json(json!({"ok": true}))).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}
async fn registry_npm_publish_manifest(
    repository_id: String,
    package_name: String,
    mut manifest: Value,
) -> axum::response::Response {
    let version = match manifest.get("version").and_then(Value::as_str) {
        Some(value) => value.to_string(),
        None => {
            return err(
                StatusCode::BAD_REQUEST,
                "npm manifest requires string version",
            )
            .into_response()
        }
    };
    if let Some(name) = manifest.get("name").and_then(Value::as_str) {
        if name != package_name {
            return err(
                StatusCode::BAD_REQUEST,
                "npm manifest name must match URL package",
            )
            .into_response();
        }
    }
    if let Some(object) = manifest.as_object_mut() {
        object.insert("name".into(), json!(package_name));
    }
    match pipelines::publish_registry_bytes(
        &repository_id,
        &package_name,
        &version,
        Some(&manifest.to_string()),
        None,
        None,
    ) {
        Ok(value) => (StatusCode::CREATED, Json(json!(value))).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}

const DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES: usize = 50 * 1024 * 1024;

fn document_upload_max_bytes(value: Option<&str>) -> usize {
    value
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES)
}

#[derive(Deserialize)]
struct WebDocumentUpload {
    filename: String,
    container_type: String,
    container_id: Option<String>,
    folder_id: Option<String>,
    title: Option<String>,
}

/// Binary document ingress for browser clients. Metadata is query-encoded and the
/// payload remains raw bytes, avoiding base64/JSON expansion and desktop paths.
async fn document_upload(
    h: HeaderMap,
    Query(upload): Query<WebDocumentUpload>,
    payload: Bytes,
) -> axum::response::Response {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(e) => return e.into_response(),
    };
    let mut auth_body = json!({"document": {
        "container_type": upload.container_type,
        "container_id": upload.container_id,
        "folder_id": upload.folder_id,
        "created_by": user.profile_id,
    }});
    if let Err(e) = authorize_command(&user, "create_document", &mut auth_body) {
        return e.into_response();
    }
    let document = auth_body["document"].as_object().expect("document object");
    let request = documents::UploadDocumentFileBytesRequest {
        filename: upload.filename,
        container_type: document["container_type"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        container_id: document["container_id"].as_str().map(str::to_owned),
        folder_id: document["folder_id"].as_str().map(str::to_owned),
        title: upload.title,
        created_by: document["created_by"].as_str().map(str::to_owned),
    };
    match documents::upload_document_file_bytes(
        request,
        &payload,
        document_upload_max_bytes(env::var("SPACE_DOCUMENT_UPLOAD_MAX_BYTES").ok().as_deref())
            as u64,
    ) {
        Ok(file) => Json(json!({"ok":true,"value":file})).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error).into_response(),
    }
}

async fn document_download(
    h: HeaderMap,
    Path(document_id): Path<String>,
) -> axum::response::Response {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(e) => return e.into_response(),
    };
    match documents::document_readable_by(&document_id, &user.profile_id) {
        Ok(true) => match documents::read_document_file_bytes(&document_id) {
            Ok((file, payload)) => (
                [(
                    header::CONTENT_TYPE,
                    HeaderValue::from_str(&file.mime)
                        .unwrap_or(HeaderValue::from_static("application/octet-stream")),
                )],
                payload,
            )
                .into_response(),
            Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
        },
        Ok(false) => err(StatusCode::FORBIDDEN, "document access denied").into_response(),
        Err(error) => err(StatusCode::INTERNAL_SERVER_ERROR, &error).into_response(),
    }
}

async fn cmd(
    h: HeaderMap,
    Path(name): Path<String>,
    Json(mut body): Json<Value>,
) -> impl IntoResponse {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(e) => return e.into_response(),
    };
    if let Err(e) = authorize_command(&user, &name, &mut body) {
        return e.into_response();
    }
    if name == "list_projects" {
        return match platform::list_projects() { Ok(projects) => Json(json!({"ok":true,"value":projects.into_iter().filter(|project| project_readable(&user,&project.id).unwrap_or(false)).collect::<Vec<_>>() })).into_response(), Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response() };
    }
    // An unscoped issue list is answered per project the caller may read: one round trip
    // for a whole portfolio, and never a row from a project that is not theirs.
    if name == "list_issue_statuses"
        && arg::<Option<String>>(&body, "project_id")
            .ok()
            .flatten()
            .is_none()
    {
        return match issues::list_issue_statuses(None) {
            Ok(rows) => Json(json!({"ok":true,"value":rows.into_iter().filter(|status| project_readable(&user,&status.project_id).unwrap_or(false)).collect::<Vec<_>>()})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response(),
        };
    }
    if name == "list_boards"
        && arg::<Option<String>>(&body, "project_id")
            .ok()
            .flatten()
            .is_none()
    {
        return match issues::list_boards(None) {
            Ok(rows) => Json(json!({"ok":true,"value":rows.into_iter().filter(|board| project_readable(&user,&board.project_id).unwrap_or(false)).collect::<Vec<_>>()})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response(),
        };
    }
    if name == "list_issues"
        && arg::<Option<String>>(&body, "project_id")
            .ok()
            .flatten()
            .is_none()
    {
        // Every OTHER filter of the request still applies — dropping them here would
        // answer a search for "needle" with the whole haystack, silently.
        let include_archived = arg::<Option<bool>>(&body, "include_archived")
            .ok()
            .flatten();
        let text = arg::<Option<String>>(&body, "text").ok().flatten();
        let status_id = arg::<Option<String>>(&body, "status_id").ok().flatten();
        let assignee_id = arg::<Option<String>>(&body, "assignee_id").ok().flatten();
        let tag_id = arg::<Option<String>>(&body, "tag_id").ok().flatten();
        return match issues::list_issues(None, text, status_id, assignee_id, tag_id, None, None, include_archived) {
            Ok(rows) => Json(json!({"ok":true,"value":rows.into_iter().filter(|issue| project_readable(&user,&issue.project_id).unwrap_or(false)).collect::<Vec<_>>()})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response(),
        };
    }
    // A confidential absence reason never leaves the process for a reader who is not
    // the person themselves or an administrator: redaction happens here, at the one
    // chokepoint every web read passes through, not in the view.
    if name == "list_absences" || name == "current_absences" {
        let admin = user.role == "GlobalAdmin";
        let rows = if name == "list_absences" {
            personal::list_absences(arg::<Option<String>>(&body, "profile_id").ok().flatten())
        } else {
            match arg::<String>(&body, "date") {
                Ok(date) => personal::current_absences(date),
                Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response(),
            }
        };
        return match rows {
            Ok(rows) => {
                Json(json!({"ok":true,"value":personal::redact_all(rows,&user.profile_id,admin)}))
                    .into_response()
            }
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
        };
    }
    if name == "list_directory_calendar" {
        return match platform::list_directory_calendar() {
            Ok(rows) => Json(json!({"ok":true,"value":platform::redact_directory_calendar_for(rows,&user.profile_id,user.role == "GlobalAdmin")})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response(),
        };
    }
    if name == "update_absence" {
        return absence_update(&user, &body);
    }
    if name == "delete_absence" {
        return absence_delete(&user, &body);
    }
    dispatch!(name.as_str(), body, {
    "list_devfiles" => applications::list_devfiles(project_id: Option<String>),
    "save_devfile" => applications::save_devfile(value: applications::Devfile),
    "delete_devfile" => applications::delete_devfile(id: String),
    "open_in_ide" => applications::open_in_ide(repository: String, ide: String),
    "list_ide_sessions" => applications::list_ide_sessions(),
    "report_ide_session" => applications::report_ide_session(value: applications::IdeSession),
    "list_applications" => applications::list_applications(),
    "list_app_parameters" => applications::list_app_parameters(application_id: String),
    "save_app_parameter" => applications::save_app_parameter(value: applications::AppParameter),
    "delete_app_parameter" => applications::delete_app_parameter(application_id: String, key: String),
    "register_redirect_uri" => oauth::register_redirect_uri_cmd(application_id: String, redirect_uri: String),
    "list_redirect_uris" => oauth::list_redirect_uris_cmd(application_id: String),
    "save_application" => applications::save_application(value: applications::Application),
    "delete_application" => applications::delete_application(id: String),
    "list_event_types" => events::list_event_types(),
    "list_webhooks" => applications::list_webhooks(application_id: String),
    "save_webhook" => applications::save_webhook(value: applications::WebhookSubscription),
    "delete_webhook" => applications::delete_webhook(id: String),
    "deliver_webhook" => applications::deliver_webhook(webhook_id: String, payload_json: String),
    "retry_webhook_delivery" => applications::retry_webhook_delivery(id: String),
    "process_webhook_queue" => applications::process_webhook_queue(limit: i64),
    "list_webhook_deliveries" => applications::list_webhook_deliveries(webhook_id: String),
    "rotate_webhook_secret" => applications::rotate_webhook_secret(webhook_id: String, overlap_seconds: Option<i64>),
    "list_webhook_secrets" => applications::list_webhook_secrets(webhook_id: String),
    "app_signing_key" => payload_dispatch::app_signing_key(application_id: String),
    "rotate_app_signing_key" => payload_dispatch::rotate_app_signing_key(application_id: String),
    "add_app_ssh_key" => applications::add_app_ssh_key(application_id: String, public_key: String, comment: Option<String>),
    "list_app_ssh_keys" => applications::list_app_ssh_keys(application_id: String),
    "delete_app_ssh_key" => applications::delete_app_ssh_key(application_id: String, fingerprint: String),
    "add_app_gpg_key" => applications::add_app_gpg_key(application_id: String, public_key: String),
    "list_app_gpg_keys" => applications::list_app_gpg_keys(application_id: String),
    "delete_app_gpg_key" => applications::delete_app_gpg_key(application_id: String, fingerprint: String),
    "revoke_app_gpg_key" => applications::revoke_app_gpg_key(application_id: String, fingerprint: String),
    "parse_application_payload" => payload_dispatch::parse_application_payload(payload_json: String),
    "application_payload_classes" => payload_dispatch::application_payload_classes(),
    "dispatch_application_payload" => payload_dispatch::dispatch_application_payload(application_id: String, payload_json: String),
    "list_chatbots" => applications::list_chatbots(application_id: String),
    "list_chatbot_commands" => chatbot::list_chatbot_commands(chatbot_id: String, user_id: String, prefix: Option<String>),
    "get_required_rights" => app_rights::get_required_rights(application_id: String),
    "update_required_rights" => app_rights::update_required_rights(application_id: String, right_codes_to_add: Vec<String>, right_codes_to_remove: Vec<String>, request_rights_in_authorized_contexts: Option<bool>),
    "request_rights" => app_rights::request_rights(application_id: String, right_codes: Vec<String>),
    "get_authorized_rights" => app_rights::get_authorized_rights(application_id: String, context_identifier: String),
    "update_authorized_rights" => app_rights::update_authorized_rights(application_id: String, context_identifier: String, rights: Vec<String>, actor: Option<String>, comment: Option<String>),
    "scope_approval_status" => app_rights::scope_approval_status(application_id: String, context_identifier: String),
    "approve_scope" => app_rights::approve_scope(application_id: String, context_identifier: String, actor: Option<String>, comment: Option<String>),
    "application_right_catalog" => app_rights::application_right_catalog(),
    "save_chatbot" => applications::save_chatbot(value: applications::ChatbotRegistration),
    "delete_chatbot" => applications::delete_chatbot(id: String),
    "list_ui_extensions" => applications::list_ui_extensions(application_id: String),
    "save_ui_extension" => applications::save_ui_extension(value: applications::UiExtension),
    "delete_ui_extension" => applications::delete_ui_extension(id: String),
    "add_channel_member" => chat::add_channel_member(channel_id: String, member_id: String, administrator: bool),
    "add_issue_child" => issues::add_issue_child(parent_id: String, child_id: String),
    "add_message_attachment" => chat::add_message_attachment(message_id: String, attachment: chat::NewMessageAttachment),
    "set_message_attachment_state" => chat::set_message_attachment_state(message_id: String, id: String, state: String, error: Option<String>),
    "remove_message_attachment" => chat::remove_message_attachment(message_id: String, id: String),
    "add_reaction" => chat::add_reaction(message_id: String, profile_id: String, emoji: String),
    "add_review_participant" => review::add_review_participant(participant: review::ReviewParticipant),
    "add_team_membership" => platform::add_team_membership(input: platform::TeamMembershipInput),
    "archive_cf_definition" => platform::archive_cf_definition(id: String, archived: bool),
    "archive_document" => documents::archive_document(id: String, archived: bool),
    "delete_document" => documents::delete_document(id: String, actor_id: String),
    "archive_issue" => issues::archive_issue(id: String, archived: bool),
    "archive_meeting" => meetings::archive_meeting(id: String, archived: bool),
    "attach_meeting_channel" => meetings::attach_meeting_channel(id: String),
    "delete_meeting" => meetings::delete_meeting(id: String),
    "archive_role" => platform::archive_role(id: String, archived: bool),
    "archive_sprint" => issues::archive_sprint(id: String, archived: bool),
    "archive_team" => platform::archive_team(id: String, archived: bool),
    "attempt_merge" => review::attempt_merge(id: String, repo_path: String, review_id: String, source_branch: String, target_branch: String, actor_id: String),
    "cf_get_values" => platform::cf_get_values(entity_type: String, entity_id: String),
    "cf_set_value" => platform::cf_set_value(definition_id: String, entity_id: String, value_json: String),
    "check_right" => platform::check_right(profile_id: String, right_code: String, scope_type: String, scope_id: Option<String>),
    "close_sprint" => issues::close_sprint(id: String),
    "create_absence" => personal::create_absence(input: personal::AbsenceInput),
    "create_board" => issues::create_board(input: issues::BoardInput),
    "create_cf_definition" => platform::create_cf_definition(input: platform::CfDefinitionInput),
    "create_channel" => chat::create_channel(channel: chat::Channel, member_ids: Vec<String>),
    "create_deploy_target" => pipelines::create_deploy_target(target: pipelines::DeployTarget),
    "ensure_project_document_root" => documents::ensure_project_document_root(project_id: String),
    "create_document" => documents::create_document(document: documents::Document),
    "create_document_folder" => documents::create_document_folder(folder: documents::DocumentFolder, owner_id: Option<String>),
    "create_entity_channel" => chat::create_entity_channel(entity_type: String, entity_id: String, name: Option<String>),
    "ensure_thread_channel" => chat::ensure_thread_channel(root_message_id: String, title: Option<String>, acting_profile_id: Option<String>),
    "create_issue" => issues::create_issue(input: issues::IssueInput),
    "clone_issue" => issues::clone_issue(input: issues::IssueTransferInput),
    "move_issue_to_project" => issues::move_issue_to_project(input: issues::IssueTransferInput),
    "create_issue_status" => issues::create_issue_status(input: issues::StatusInput),
    "create_meeting" => meetings::create_meeting(meeting: meetings::Meeting),
    "create_job_artifact" => pipelines::create_job_artifact(input: pipelines::JobArtifactInput),
    "create_message" => chat::create_message(message: chat::Message),
    "create_package_repository" => pipelines::create_package_repository(repo: pipelines::PackageRepository),
    "create_pipeline_script" => pipelines::create_pipeline_script(script: pipelines::PipelineScript),
    "create_profile" => platform::create_profile(profile: platform::Profile),
    "create_project" => platform::create_project(project: platform::Project),
    "create_quality_gate_rule" => review::create_quality_gate_rule(rule: review::QualityGateRule),
    "create_review_stack" => review::create_review_stack(input: review::NewReviewStack),
    "create_review" => review::create_review(review: review::Review),
    "create_review_discussion" => review::create_review_discussion(discussion: review::NewDiscussion),
    "create_role" => platform::create_role(input: platform::RoleInput),
    "create_role_assignment" => platform::create_role_assignment(input: platform::RoleAssignmentInput),
    "create_sprint" => issues::create_sprint(input: issues::SprintInput),
    "create_team" => platform::create_team(input: platform::TeamInput),
    "create_todo" => personal::create_todo(input: personal::TodoInput),
    "current_absences" => personal::current_absences(date: String),
    "dashboard_aggregate" => personal::dashboard_aggregate(profile_id: String),
    "project_dashboard_aggregate" => personal::project_dashboard_aggregate(project_id: String),
    "list_follows" => personal::list_follows(profile_id: String),
    "save_follow" => personal::save_follow(follow: personal::Follow),
    "delete_follow" => personal::delete_follow(follow: personal::Follow),
    "list_subscription_deliveries" => personal::list_subscription_deliveries(profile_id: String),
    "save_subscription_delivery" => personal::save_subscription_delivery(d: personal::SubscriptionDeliveryTarget),
    "delete_subscription_delivery" => personal::delete_subscription_delivery(profile_id: String, event_type: String, target_kind: String, target_id: String),
    "get_dashboard_preferences" => personal::get_dashboard_preferences_http(profile_id: String),
    "set_dashboard_preferences" => personal::set_dashboard_preferences_http(preferences: personal::DashboardPreferences),
    "get_calendar_options" => personal::get_calendar_options_http(profile_id: String),
    "set_calendar_options" => personal::set_calendar_options_http(options: personal::CalendarOptions),
    "delete_board" => issues::delete_board(id: String),
    "delete_board_column" => issues::delete_board_column(id: String),
    "delete_checklist" => issues::delete_checklist(id: String),
    "delete_checklist_item" => issues::delete_checklist_item(id: String),
    "delete_deploy_target" => pipelines::delete_deploy_target(id: String),
    "delete_issue_status" => issues::delete_issue_status(id: String),
    "delete_issue_attachment" => issues::delete_issue_attachment(id: String),
    "delete_message" => chat::delete_message(id: String),
    "delete_messenger_contact" => platform::delete_messenger_contact(id: String, profile_id: String),
    "delete_package_repository" => pipelines::delete_package_repository(id: String),
    "delete_package_version" => pipelines::delete_package_version(id: String),
    "delete_pipeline_script" => pipelines::delete_pipeline_script(id: String),
    "delete_planning_tag" => issues::delete_planning_tag(id: String),
    "delete_quality_gate_rule" => review::delete_quality_gate_rule(id: String),
    "delete_role_assignment" => platform::delete_role_assignment(id: String),
    "delete_sprint" => issues::delete_sprint(id: String),
    "delete_subscription_scope" => personal::delete_subscription_scope(profile_id: String, event_type: String, target_type: String, target_id: String),
    "delete_subscription_setting" => personal::delete_subscription_setting(profile_id: String, event_type: String),
    "delete_swimlane" => issues::delete_swimlane(id: String),
    "delete_time_tracking_entry" => issues::delete_time_tracking_entry(id: String),
    "delete_todo" => personal::delete_todo(id: String, actor_id: String),
    "list_channel_notes" => channel_notes::list_channel_notes(channel_id: String, profile_id: String),
    "create_channel_note" => channel_notes::create_channel_note(input: channel_notes::ChannelNoteInput),
    "update_channel_note" => channel_notes::update_channel_note(note: channel_notes::ChannelNote),
    "delete_channel_note" => channel_notes::delete_channel_note(id: String, profile_id: String),
    "dry_run_merge" => review::dry_run_merge(id: String, repo_path: String, review_id: String, source_branch: String, target_branch: String),
    "emit_notification" => personal::emit_notification(input: personal::NotificationInput),
    "evaluate_quality_gate" => review::evaluate_quality_gate(review_id: String),
    "expand_meeting_occurrences" => meetings::expand_meeting_occurrences_scoped(range_start: i64, range_end: i64, profile_id: String),
    "get_channel" => chat::get_channel(id: String),
    "private_feed" => chat::private_feed(profile_id: String),
    "get_channel_notification_preference" => chat::get_channel_notification_preference(profile_id: String, channel_id: String),
    "save_channel_notification_preference" => chat::save_channel_notification_preference(preference: chat::ChannelNotificationPreference),
    "get_channel_by_entity" => chat::get_channel_by_entity(entity_type: String, entity_id: String),
    "resolve_source_ref" => chat::resolve_source_ref(entity_type: String, entity_id: String),
    "get_document" => documents::get_document_scoped(id: String, profile_id: String),
    "get_issue" => issues::get_issue(id: String),
    "get_issue_detail" => issues::get_issue_detail(id: String),
    "get_meeting" => meetings::get_meeting_scoped(id: String, profile_id: String),
    "get_profile" => platform::get_profile(id: String),
    "get_profile_email_status" => platform::get_profile_email_status(profile_id: String),
    "get_project" => platform::get_project(id: String),
    "get_review" => review::get_review(id: String),
    "get_role" => platform::get_role(id: String),
    "get_team" => platform::get_team(id: String),
    "goto_search" => personal::goto_search_scoped(query: String, limit: Option<i64>, profile_id: String, allow_all: bool),
    "full_text_search" => personal::full_text_search_scoped(query: String, limit: Option<i64>, profile_id: String, allow_all: bool),
    "list_blog_posts" => blogs::list_blog_posts_scoped(filter: Option<blogs::BlogFilter>, profile_id: String, allow_all: bool),
    "get_blog_post" => blogs::get_blog_post_scoped(id: String, profile_id: String, allow_all: bool),
    "publish_blog_draft" => blogs::publish_blog_draft_scoped(input: blogs::PublishBlogDraftInput, profile_id: String, allow_all: bool),
    "invite_meeting_participant" => meetings::invite_meeting_participant(meeting_id: String, profile_id: String),
    "issue_time_total" => issues::issue_time_total(issue_id: String),
    "join_channel" => chat::join_channel(channel_id: String, profile_id: String),
    "launch_sprint" => issues::launch_sprint(id: String),
    "leave_channel" => chat::leave_channel(channel_id: String, profile_id: String),
    "list_absences" => personal::list_absences(profile_id: Option<String>),
    "list_backlog_issues" => issues::list_backlog_issues(board_id: String),
    "list_board_columns" => issues::list_board_columns(board_id: String),
    "list_board_issues" => issues::list_board_issues(board_id: String, sprint_id: Option<String>),
    "get_board_card_settings" => issues::get_board_card_settings(board_id: String),
    "list_boards" => issues::list_boards(project_id: Option<String>),
    "list_cf_definitions" => platform::list_cf_definitions(entity_type: Option<String>),
    "list_membership_edit_requests" => platform::list_membership_edit_requests(membership_id: Option<String>),
    "request_membership_edit" => platform::request_membership_edit(membership: platform::TeamMembership, requested_by: String),
    "decide_membership_edit" => platform::decide_membership_edit(id: String, approver_id: String, approve: bool),
    "list_channel_members" => chat::list_channel_members(channel_id: String),
    "list_channels" => chat::list_channels(),
    "list_channels_with_meta" => chat::list_channels_with_meta(profile_id: String),
    "list_unread_threads" => chat::list_unread_threads(profile_id: String),
    "list_checklist_items" => issues::list_checklist_items(checklist_id: String),
    "list_checklists" => issues::list_checklists(issue_id: String),
    "list_deploy_targets" => pipelines::list_deploy_targets(),
    "list_deployments_for_target" => pipelines::list_deployments_for_target(target_id: String),
    "list_doc_versions" => documents::list_doc_versions_scoped(document_id: String, profile_id: String),
    "list_document_access" => documents::list_document_access(document_id: String),
    "update_document_access" => documents::update_document_access(document_id: String, permissions: Vec<documents::DocumentAccessRecipient>),
    "list_document_folders" => documents::list_document_folders_scoped(profile_id: String),
    "list_documents" => documents::list_documents_scoped(profile_id: String),
    "list_favorite_documents" => documents::list_favorite_documents(profile_id: String),
    "set_document_favorite" => documents::set_document_favorite(profile_id: String, document_id: String, favorite: bool),
    "move_favorite_document" => documents::move_favorite_document(profile_id: String, document_id: String, group_name: Option<String>, position: i64),
    "list_issue_statuses" => issues::list_issue_statuses(project_id: Option<String>),
    "list_issues" => issues::list_issues(project_id: Option<String>, text: Option<String>, status_id: Option<String>, assignee_id: Option<String>, tag_id: Option<String>, custom_field_id: Option<String>, custom_field_value_json: Option<String>, include_archived: Option<bool>),
    "list_issue_attachments" => issues::list_issue_attachments(issue_id: String),
    "add_issue_attachment" => issues::add_issue_attachment(issue_id: String, attachment: issues::IssueAttachmentInput),
    "list_job_runs" => pipelines::list_job_runs(),
    "list_job_runs_for_script" => pipelines::list_job_runs_for_script(script_id: String),
    "list_job_artifacts" => pipelines::list_job_artifacts(job_run_id: String),
    "list_test_reports" => pipelines::list_test_reports(job_run_id: String),
    "list_workers" => pipelines::list_workers(),
    "list_jobs" => pipelines::list_jobs(),
    "list_jobs_for_script" => pipelines::list_jobs_for_script(script_id: String),
    "list_meeting_participants" => meetings::list_meeting_participants_scoped(meeting_id: String, profile_id: String),
    "list_meeting_rooms" => meetings::list_meeting_rooms(),
    "meeting_availability" => meetings::meeting_availability(starts_at: i64, ends_at: i64, profile_ids: Vec<String>, meeting_id: Option<String>),
    "attach_document_discussion" => documents::attach_document_discussion(document_id: String, meeting_id: Option<String>),
    "get_document_discussion" => documents::get_document_discussion(document_id: String),
    "import_document_folder" => documents::import_document_folder(request: documents::DocumentImportRequest),
    "search_book_documents" => documents::search_book_documents(book_id: String, query: String),
    "list_book_access" => documents::list_book_access(book_id: String),
    "list_book_owners" => documents::list_book_owners(book_id: String),
    "update_book_access" => documents::update_book_access(book_id: String, permissions: Vec<documents::DocumentAccessRecipient>),
    "save_channel_subscription" => channel_feeds::save_channel_subscription(value: channel_feeds::ChannelSubscription),
    "list_channel_subscriptions" => channel_feeds::list_channel_subscriptions(profile_id: String),
    "reserve_meeting_room" => meetings::reserve_meeting_room(meeting_id: String, room_id: String),
    "list_meetings" => meetings::list_meetings_scoped(profile_id: String),
    "list_locations" => platform::list_locations(),
    "list_leads" => leads::list_leads(),
    "save_location" => platform::save_location(location: platform::Location),
    "location_channel" => platform::location_channel(location_id: String),
    "list_desk_assignments" => platform::list_desk_assignments(profile_id: Option<String>, location_id: Option<String>),
    "save_desk_assignment" => platform::save_desk_assignment(value: platform::DeskAssignment),
    "remove_desk_assignment" => platform::remove_desk_assignment(id: String),
    "list_messages" => chat::list_messages(channel_id: String, acting_profile_id: Option<String>),
    "list_pinned_messages" => chat::list_pinned_messages(channel_id: String, acting_profile_id: Option<String>),
    "list_messages_page" => chat::list_messages_page(channel_id: String, thread_of: Option<String>, cursor: Option<String>, limit: Option<i64>, acting_profile_id: Option<String>),
    "list_message_drafts" => chat::list_message_drafts(author_id: String),
    "get_message_draft" => chat::get_message_draft(channel_id: String, author_id: String, thread_key: Option<String>),
    "list_channel_typing" => chat::list_channel_typing(channel_id: String, acting_profile_id: Option<String>, ttl_secs: Option<i64>),
    "list_scheduled_messages" => chat::list_scheduled_messages(author_id: String, channel_id: Option<String>, status: Option<String>),
    "get_scheduled_message" => chat::get_scheduled_message(id: String, author_id: String),
    "get_poll" => chat::get_poll(id: String, acting_profile_id: Option<String>),
    "list_channel_polls" => chat::list_channel_polls(channel_id: String, acting_profile_id: Option<String>),
    "list_notifications" => personal::list_notifications(recipient_id: String, unread_only: Option<bool>),
    "list_package_repositories" => pipelines::list_package_repositories(),
    "list_package_repository_acl" => pipelines::list_package_repository_acl(repository_id: String),
    "list_package_versions" => pipelines::list_package_versions(repository_id: String, query: Option<String>),
    "list_pipeline_scripts" => pipelines::list_pipeline_scripts(),
    "list_planning_tags" => issues::list_planning_tags(project_id: String),
    "get_organization" => organization::get_organization(),
    "update_organization" => organization::update_organization(value: organization::Organization),
    "get_org_settings" => organization::get_org_settings(),
    "update_org_settings" => organization::update_org_settings(value: organization::OrgSettings),
    "list_messenger_contacts" => platform::list_messenger_contacts(profile_id: String),
    "list_principals" => platform::list_principals(),
    "list_profiles" => platform::list_profiles(),
    "list_directory_feed" => platform::list_directory_feed(limit: Option<usize>),
    "list_projects" => platform::list_projects(),
    "list_protected_branch_rules" => review::list_protected_branch_rules(project_id: String),
    "get_merge_policy" => review::get_merge_policy(project_id: String),
    "save_merge_policy" => review::save_merge_policy(policy: review::MergePolicy),
    "save_merge_preferences" => review::save_merge_preferences(preferences: review::MergePreferences),
    "save_protected_branch_rule" => review::save_protected_branch_rule(rule: review::ProtectedBranchRule),
    "delete_protected_branch_rule" => review::delete_protected_branch_rule(id: String),
    "list_quality_gate_rules" => review::list_quality_gate_rules(project_id: String),
    "list_dev_environments" => devenv::list_dev_environments(project_id: String),
    "create_dev_environment" => devenv::create_dev_environment(input: devenv::NewDevEnvironment),
    "touch_dev_environment" => devenv::touch_dev_environment(id: String),
    "hibernate_dev_environment" => devenv::hibernate_dev_environment(id: String, actor_id: Option<String>),
    "hibernate_idle_dev_environments" => devenv::hibernate_idle_dev_environments(),
    "resume_dev_environment" => devenv::resume_dev_environment(id: String, actor_id: Option<String>),
    "claim_standby_dev_environment" => devenv::claim_standby_dev_environment(project_id: String, profile_id: String),
    "save_standby_pool_policy" => devenv::save_standby_pool_policy(policy: devenv::StandbyPoolPolicy, actor_id: Option<String>),
    "refill_standby_pool" => devenv::refill_standby_pool(project_id: String, ide: String, instance_type: String),
    "delete_dev_environment" => devenv::delete_dev_environment(id: String, actor_id: Option<String>),
    "list_review_stacks" => review::list_review_stacks(project_id: String),
    "list_my_review_stacks" => review::list_my_review_stacks(profile_id: String),
    "remove_review_stack" => review::remove_review_stack(stack_id: String),
    "list_review_discussions" => review::list_review_discussions(review_id: String),
    "set_suggested_edit_status" => review::set_suggested_edit_status(id: String, status: String, actor_id: String),
    "apply_suggested_edit" => review::apply_suggested_edit(id: String, actor_id: String),
    "list_review_participants" => review::list_review_participants(review_id: String),
    "review_aggregated_status" => review::review_aggregated_status(review_id: String, profile_id: String),
    "list_owned_review_files" => review::list_owned_review_files(review_id: String, profile_id: String),
    "list_review_file_states" => review::list_review_file_states(review_id: String, profile_id: String),
    "save_review_file_state" => review::save_review_file_state(state: review::ReviewFileState),
    "list_reviews" => review::list_reviews(),
    "list_rights" => platform::list_rights(),
    "list_right_groups" => platform::list_right_groups(),
    "list_role_assignments" => platform::list_role_assignments(profile_id: Option<String>, team_id: Option<String>),
    "list_role_rights" => platform::list_role_rights(role_id: String),
    "list_roles" => platform::list_roles(),
    "list_project_role_templates" => platform::list_project_role_templates(),
    "create_project_role_template" => platform::create_project_role_template(input: platform::ProjectRoleTemplateInput),
    "archive_project_role_template" => platform::archive_project_role_template(id: String, archived: bool),
    "list_project_roles" => platform::list_project_roles(project_id: Option<String>),
    "create_project_role" => platform::create_project_role(input: platform::ProjectRoleInput),
    "archive_project_role" => platform::archive_project_role(id: String, archived: bool),
    "list_project_team_roles" => platform::list_project_team_roles(project_id: Option<String>),
    "assign_project_team_role" => platform::assign_project_team_role(project_id: String, team_id: String, project_role_id: String),
    "remove_project_team_role" => platform::remove_project_team_role(project_id: String, team_id: String, project_role_id: String),
    "list_safe_merge_runs" => review::list_safe_merge_runs(review_id: String),
    "list_sprints" => issues::list_sprints(board_id: Option<String>),
    "list_app_installs" => applications::list_app_installs(),
    "list_app_tokens" => applications::list_app_tokens(application_id: String),
    "list_marketplace_apps" => applications::list_marketplace_apps(),
    "rotate_app_secret" => applications::rotate_app_secret(application_id: String),
    "issue_app_token" => applications::issue_app_token(client_id: String, client_secret: String, scope: Option<String>, ttl_seconds: Option<i64>),
    "verify_app_token" => applications::verify_app_token(token: String),
    "revoke_app_token" => applications::revoke_app_token(id: String),
    "save_marketplace_app" => applications::save_marketplace_app(value: applications::MarketplaceApp),
    "install_marketplace_app" => applications::install_marketplace_app(value: applications::AppInstall),
    "uninstall_app" => applications::uninstall_app(id: String),
    "list_subscription_scopes" => personal::list_subscription_scopes(profile_id: String),
    "list_subscription_settings" => personal::list_subscription_settings(profile_id: String),
    "list_swimlanes" => issues::list_swimlanes(board_id: String, sprint_id: Option<String>),
    "list_team_memberships" => platform::list_team_memberships(team_id: Option<String>, profile_id: Option<String>),
    "list_teams" => platform::list_teams(),
    "list_thread_replies" => chat::list_thread_replies(thread_of: String, acting_profile_id: Option<String>),
    "list_time_tracking_entries" => issues::list_time_tracking_entries(issue_id: String),
    "list_todos" => personal::list_todos(profile_id: String, include_done: Option<bool>),
    "list_project_todos" => personal::list_project_todos(project_id: String, profile_id: String, include_done: Option<bool>),
    "list_team_todos" => personal::list_team_todos(profile_id: String, include_done: Option<bool>),
    "list_project_member_ids" => personal::project_member_ids(project_id: String),
    "calendar_aggregate" => personal::calendar_aggregate(profile_id: String, range_start: i64, range_end: i64, range_start_date: Option<String>, range_end_date: Option<String>, target_profile_id: Option<String>, target_location: Option<String>),
    "list_calendar_feeds" => calendar_feeds::list_calendar_feeds(profile_id: String),
    "list_calendars" => calendar_feeds::list_calendars(profile_id: String),
    "save_calendar" => calendar_feeds::save_calendar(input: calendar_feeds::CalendarInput),
    "delete_calendar" => calendar_feeds::delete_calendar(id: String),
    "save_calendar_feed" => calendar_feeds::save_calendar_feed(input: calendar_feeds::CalendarFeedInput),
    "delete_calendar_feed" => calendar_feeds::delete_calendar_feed(id: String),
    "sync_calendar_feed" => calendar_feeds::sync_calendar_feed(id: String),
    "livekit_server_status" => calls::livekit_server_status(),
    "mark_channel_read" => chat::mark_channel_read(channel_id: String, profile_id: String, message_id: Option<String>),
    "mark_notification_read" => personal::mark_notification_read(id: String),
    "move_document" => documents::move_document(id: String, container_type: String, container_id: Option<String>, folder_id: Option<String>),
    "move_document_folder" => documents::move_document_folder(id: String, parent_id: Option<String>),
    "delete_document_folder" => documents::delete_document_folder(id: String, actor_id: String),
    "move_issue_on_board" => issues::move_issue_on_board(board_id: String, issue_id: String, column_id: String, sprint_id: Option<String>, swimlane_id: Option<String>, position: Option<i64>),
    "open_merge_request" => review::open_merge_request(req: review::NewMergeRequest),
    "apply_package_retention" => pipelines::apply_package_retention(repository_id: String),
    "package_retention_candidates" => pipelines::package_retention_candidates(repository_id: String),
    "package_version_detail" => package_registry::package_version_detail(repository_id: String, package_name: String, version: String),
    "repository_vulnerability_report" => pipelines::repository_vulnerability_report(repository_id: String, min_severity: Option<String>),
    "publish_package_version" => pipelines::publish_package_version(repository_id: String, package_name: String, version: String, metadata_json: Option<String>, payload_filename: Option<String>, payload_content: Option<String>, immutable: Option<bool>),
    "add_package_vulnerability" => pipelines::add_package_vulnerability(vulnerability: pipelines::PackageVulnerability),
    "dependency_overview" => pipelines::dependency_overview(version_id: String),
    "download_package_payload" => pipelines::download_package_payload(repository_id: String, package_name: String, version: String, filename: String),
    "remove_channel_member" => chat::remove_channel_member(channel_id: String, member_id: String),
    "remove_package_repository_acl" => pipelines::remove_package_repository_acl(repository_id: String, profile_id: String),
    "remove_issue_from_board" => issues::remove_issue_from_board(board_id: String, issue_id: String),
    "remove_issue_link" => issues::remove_issue_link(id: String),
    "remove_reaction" => chat::remove_reaction(message_id: String, profile_id: String, emoji: String),
    "remove_team_membership" => platform::remove_team_membership(id: String),
    "restore_doc_version" => documents::restore_doc_version(document_id: String, version: i64, actor: Option<String>),
    "review_diff" => review::review_diff(repo_path: String, source_branch: String, target_branch: String),
    "register_worker" => pipelines::register_worker(worker: pipelines::Worker),
    "save_board_column" => issues::save_board_column(input: issues::ColumnInput),
    "save_board_card_settings" => issues::save_board_card_settings(settings: issues::BoardCardSettings),
    "save_test_report" => pipelines::save_test_report(report: pipelines::TestReport),
    "ingest_teamcity_test_messages" => pipelines::ingest_teamcity_test_messages(input: pipelines::TeamCityTestReportInput),
    "save_checklist" => issues::save_checklist(input: issues::ChecklistInput),
    "save_checklist_item" => issues::save_checklist_item(input: issues::ChecklistItemInput),
    "save_document" => documents::save_document(id: String, title: String, body: Option<String>, actor: Option<String>),
    "save_messenger_contact" => platform::save_messenger_contact(value: platform::MessengerContact),
    "save_planning_tag" => issues::save_planning_tag(input: issues::TagInput),
    "save_subscription_scope" => personal::save_subscription_scope(scope: personal::SubscriptionScope),
    "save_subscription_setting" => personal::save_subscription_setting(setting: personal::SubscriptionSetting),
    "save_swimlane" => issues::save_swimlane(input: issues::SwimlaneInput),
    "save_time_tracking_entry" => issues::save_time_tracking_entry(input: issues::TimeEntryInput),
    "schedule_deployment" => pipelines::schedule_deployment(req: pipelines::ScheduleDeploymentRequest),
    "seed_rights" => platform::seed_rights(),
    "set_discussion_resolved" => review::set_discussion_resolved(id: String, resolved: bool),
    "set_issue_tags" => issues::set_issue_tags(issue_id: String, tag_ids: Vec<String>),
    "set_message_pinned" => chat::set_message_pinned(id: String, pinned: bool),
    "save_message_draft" => chat::save_message_draft(channel_id: String, author_id: String, thread_key: Option<String>, text: String),
    "delete_message_draft" => chat::delete_message_draft(channel_id: String, author_id: String, thread_key: Option<String>),
    "set_channel_typing" => chat::set_channel_typing(channel_id: String, profile_id: String, typing: bool),
    "schedule_message" => chat::schedule_message(id: String, channel_id: String, author_id: String, text: String, thread_of: Option<String>, scheduled_at: i64),
    "update_scheduled_message" => chat::update_scheduled_message(id: String, author_id: String, text: Option<String>, scheduled_at: Option<i64>),
    "cancel_scheduled_message" => chat::cancel_scheduled_message(id: String, author_id: String),
    "deliver_due_scheduled_messages" => chat::deliver_due_scheduled_messages(now: Option<i64>, limit: Option<i64>),
    "create_poll" => chat::create_poll(id: String, channel_id: String, author_id: String, question: String, options: Vec<String>, multiple_choice: Option<bool>, anonymous: Option<bool>),
    "vote_poll" => chat::vote_poll(poll_id: String, voter_id: String, option_ids: Vec<String>),
    "close_poll" => chat::close_poll(poll_id: String, author_id: String),
    "unfurl_message_links" => chat::unfurl_message_links(message_id: String, acting_profile_id: Option<String>),
    "set_package_repository_acl" => pipelines::set_package_repository_acl(entry: pipelines::PackageRepositoryAcl),
    "set_package_version_pinned" => pipelines::set_package_version_pinned(id: String, pinned: bool),
    "set_meeting_participant_status" => meetings::set_meeting_participant_status(meeting_id: String, profile_id: String, status: String),
    "set_participant_state" => review::set_participant_state(review_id: String, profile_id: String, state: Option<String>),
    "set_profile_email_status" => platform::set_profile_email_status(value: platform::ProfileEmailStatus),
    "set_role_rights" => platform::set_role_rights(role_id: String, right_codes: Vec<String>),
    "toggle_checklist_item" => issues::toggle_checklist_item(id: String, item_done: bool),
    "transition_deployment" => pipelines::transition_deployment(id: String, status: String),
    "trigger_pipeline_script" => pipelines::trigger_pipeline_script(script_id: String),
    "trigger_pipeline_on_push" => pipelines::trigger_pipeline_on_push(script_id: String, repository: String, branch: String),
    "trigger_pipeline_event" => pipelines::trigger_pipeline_event(script_id: String, event: pipelines::TriggerEvent),
    "due_scheduled_runs" => pipelines::due_scheduled_runs(now: i64),
    "update_board" => issues::update_board(board: issues::Board),
    "update_cf_definition" => platform::update_cf_definition(definition: platform::CfDefinition),
    "update_channel" => chat::update_channel(channel: chat::Channel),
    "delete_channel" => chat::delete_channel(id: String, actor_id: String),
    "update_deploy_target" => pipelines::update_deploy_target(target: pipelines::DeployTarget),
    "update_document" => documents::update_document(document: documents::Document),
    "update_document_folder" => documents::update_document_folder(folder: documents::DocumentFolder),
    "add_project_member" => personal::add_project_member(project_id: String, member_id: String),
    "remove_project_member" => personal::remove_project_member(project_id: String, member_id: String),
    "set_issue_assignees" => issues::set_issue_assignees(issue_id: String, profile_ids: Vec<String>),
    "list_issue_assignees" => issues::list_issue_assignees(issue_id: String),
    "update_issue" => issues::update_issue(issue: issues::Issue),
    "update_issue_status" => issues::update_issue_status(status: issues::IssueStatus),
    "update_meeting" => meetings::update_meeting(meeting: meetings::Meeting),
    "update_message" => chat::update_message(id: String, text: String, mention_ids: Option<Vec<String>>, mention_team_ids: Option<Vec<String>>, mention_targets: Option<Vec<chat::MentionTarget>>),
    "list_mentions_for_profile" => chat::list_mentions_for_profile(profile_id: String, unread_only: Option<bool>),
    "count_unread_mentions" => chat::count_unread_mentions(profile_id: String),
    "update_package_repository" => pipelines::update_package_repository(repo: pipelines::PackageRepository),
    "update_pipeline_script" => pipelines::update_pipeline_script(script: pipelines::PipelineScript),
    "update_profile" => platform::update_profile(profile: platform::Profile),
    "update_project" => platform::update_project(project: platform::Project),
    "delete_project" => platform::delete_project(id: String, actor_id: String),
    "set_project_deadline" => platform::set_project_deadline(project_id: String, deadline: Option<String>, actor_profile_id: Option<String>),
    "update_project_deadline" => platform::update_project_deadline(project_id: String, expected_deadline: Option<String>, deadline: Option<String>, actor_profile_id: Option<String>),
    "set_project_lead" => platform::set_project_lead(project_id: String, lead_id: Option<String>, actor_profile_id: Option<String>),
    "update_quality_gate_rule" => review::update_quality_gate_rule(rule: review::QualityGateRule),
    "update_review" => review::update_review(review: review::Review),
    "update_role" => platform::update_role(role: platform::Role),
    "update_sprint" => issues::update_sprint(sprint: issues::Sprint),
    "update_team" => platform::update_team(team: platform::Team),
    "update_team_membership" => platform::update_team_membership(membership: platform::TeamMembership),
    "update_todo" => personal::update_todo(todo: personal::Todo),
    "set_todo_completion" => personal::set_todo_completion(id: String, done: bool),
    "postpone_todo" => personal::postpone_todo(id: String, days: i64),
    "convert_todo_to_issue" => personal::convert_todo_to_issue(id: String, project_id: String, status_id: Option<String>),
    })
}
/// OAuth2 authorization endpoint (RFC 6749 §3.1). The resource owner is the caller's
/// own session — consent is the act of POSTing here — and the answer is the redirect
/// target the client must be sent to, never a token.
async fn oauth_authorize(
    h: HeaderMap,
    Json(req): Json<oauth::AuthorizeRequest>,
) -> impl IntoResponse {
    let user = match user_by_token(&h) {
        Ok(user) => user,
        Err(e) => return e.into_response(),
    };
    match oauth::authorize(&user.id, &req, oauth::OAuthConfig::from_env()) {
        Ok(grant) => {
            let mut location = format!(
                "{}{}code={}",
                grant.redirect_uri,
                if grant.redirect_uri.contains('?') {
                    "&"
                } else {
                    "?"
                },
                grant.code
            );
            if let Some(state) = grant.state.as_deref() {
                location.push_str(&format!("&state={state}"));
            }
            Json(json!({"ok":true,"value":{"redirect_to":location,"expires_at":grant.expires_at}}))
                .into_response()
        }
        Err(e) => err(StatusCode::BAD_REQUEST, &e).into_response(),
    }
}
/// Token endpoint (RFC 6749 §3.2): unauthenticated by session — the code plus, when
/// registered, the PKCE verifier is the credential.
/// Failures here — and only here — speak RFC 6749 §5.2 instead of the house
/// `{"ok":false,"error":...}` envelope: an OAuth client parses §5.2 or nothing.
/// Every other endpoint keeps the house shape, which the UIs depend on.
async fn oauth_token(Json(req): Json<oauth::TokenRequest>) -> impl IntoResponse {
    // §5.1/§5.2: token responses must never be cached — they carry a credential.
    let no_store = [
        (header::CACHE_CONTROL, "no-store"),
        (header::PRAGMA, "no-cache"),
    ];
    match oauth::exchange_code(&req, oauth::OAuthConfig::from_env()) {
        Ok(token) => (no_store, Json(json!({"ok":true,"value":token}))).into_response(),
        Err(e) => {
            let status = StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::BAD_REQUEST);
            let body = Json(json!({"error":e.error,"error_description":e.error_description}));
            if status == StatusCode::UNAUTHORIZED {
                // §5.2: a 401 from the token endpoint MUST carry a challenge.
                (
                    status,
                    [
                        (header::CACHE_CONTROL, "no-store"),
                        (header::PRAGMA, "no-cache"),
                        (header::WWW_AUTHENTICATE, "Basic realm=\"oauth\""),
                    ],
                    body,
                )
                    .into_response()
            } else {
                (status, no_store, body).into_response()
            }
        }
    }
}
fn bootstrap() {
    let c = db::conn().expect("database");
    db::seed(&c).expect("seed");
    let _ = platform::seed_rights();
    let n: i64 = c
        .query_row("SELECT count(*) FROM users", [], |r| r.get(0))
        .unwrap();
    if n == 0 {
        let pw = env::var("SPACE_ADMIN_PASSWORD").unwrap_or_else(|_| {
            let p = token();
            println!("SPACE_ADMIN_PASSWORD={p}");
            p
        });
        c.execute("INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES('profile-admin','admin','Administrator',unixepoch())",[]).unwrap();
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,global_role,created_at) VALUES('admin','admin',?1,'Administrator','profile-admin','admin','GlobalAdmin',unixepoch())",[hash(&pw).unwrap()]).unwrap();
    }
}
/// Background delivery ticker configuration, read from the environment.
///
/// `None` = ticker disabled. Kept pure (env values in, config out) so the policy is
/// unit-testable without spawning anything: no hardcoded behaviour, only defaults.
fn webhook_ticker_config(secs: Option<&str>, batch: Option<&str>) -> Option<(u64, i64)> {
    let secs = secs
        .and_then(|x| x.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_WEBHOOK_TICK_SECS);
    if secs == 0 {
        return None; // explicit opt-out
    }
    let batch = batch
        .and_then(|x| x.trim().parse::<i64>().ok())
        .filter(|x| *x > 0)
        .unwrap_or(DEFAULT_WEBHOOK_TICK_BATCH)
        .clamp(1, 100);
    Some((secs, batch))
}
const DEFAULT_WEBHOOK_TICK_SECS: u64 = 15;
const DEFAULT_WEBHOOK_TICK_BATCH: i64 = 20;

/// Spawns the retry-queue sweeper. Delivery is blocking (rusqlite + blocking HTTP), so
/// each sweep runs on the blocking pool; a failing sweep is logged, never fatal.
const DEFAULT_PIPELINE_SCHEDULE_TICK_SECS: u64 = 60;
/// Schedule dispatch remains an opt-in server lifecycle task: an absent enable flag starts
/// nothing, its cadence defaults to sixty seconds, and zero or an invalid value disables it.
fn pipeline_schedule_ticker_config(enabled: Option<&str>, secs: Option<&str>) -> Option<u64> {
    let enabled = enabled
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    match secs {
        None => Some(DEFAULT_PIPELINE_SCHEDULE_TICK_SECS),
        Some(value) => value.trim().parse::<u64>().ok().filter(|secs| *secs > 0),
    }
}
/// Calls the existing poll-driven schedule entry point from the server's lifecycle only.
/// It creates no separate daemon; deployment operators opt in with
/// `SPACE_PIPELINE_SCHEDULE_TICK_ENABLED=1`, and may tune or disable the cadence via
/// `SPACE_PIPELINE_SCHEDULE_TICK_SECS` (default 60; zero or invalid values disable).
fn spawn_pipeline_schedule_ticker() {
    let enabled = env::var("SPACE_PIPELINE_SCHEDULE_TICK_ENABLED").ok();
    let configured_secs = env::var("SPACE_PIPELINE_SCHEDULE_TICK_SECS").ok();
    let Some(secs) =
        pipeline_schedule_ticker_config(enabled.as_deref(), configured_secs.as_deref())
    else {
        if enabled
            .as_deref()
            .map(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false)
            && configured_secs.as_deref().is_some_and(|value| {
                value
                    .trim()
                    .parse::<u64>()
                    .ok()
                    .filter(|secs| *secs > 0)
                    .is_none()
            })
        {
            eprintln!("pipeline schedule ticker: disabled; SPACE_PIPELINE_SCHEDULE_TICK_SECS must be a positive integer");
        }
        return;
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match tokio::task::spawn_blocking(|| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| error.to_string())?
                    .as_secs() as i64;
                pipelines::due_scheduled_runs(now)
            })
            .await
            {
                Ok(Ok(runs)) if !runs.is_empty() => {
                    eprintln!("pipeline schedule ticker: started {} run(s)", runs.len())
                }
                Ok(Ok(_)) => {}
                Ok(Err(error)) => eprintln!("pipeline schedule ticker: tick failed: {error}"),
                Err(error) => eprintln!("pipeline schedule ticker: task panicked: {error}"),
            }
        }
    });
}

const DEFAULT_CHAT_SCHEDULE_TICK_SECS: u64 = 30;

/// Cadence + batch of the scheduled-message ticker. Pure so the policy is unit-testable;
/// `None` = disabled (zero or invalid cadence), and the batch bounds one tick's work.
fn chat_schedule_ticker_config(secs: Option<&str>, batch: Option<&str>) -> Option<(u64, i64)> {
    let secs = match secs.map(str::trim) {
        None | Some("") => DEFAULT_CHAT_SCHEDULE_TICK_SECS,
        Some(raw) => raw.parse::<u64>().ok()?,
    };
    if secs == 0 {
        return None;
    }
    let batch = match batch.map(str::trim) {
        None | Some("") => chat::SCHEDULED_TICK_LIMIT_DEFAULT,
        Some(raw) => raw.parse::<i64>().ok().filter(|b| *b > 0)?,
    };
    Some((secs, batch))
}

/// Delivers due scheduled messages in bounded batches. Each tick leases rows one by one,
/// so a slow or failing channel costs one row, not the run.
fn spawn_chat_schedule_ticker() {
    let Some((secs, batch)) = chat_schedule_ticker_config(
        env::var("SPACE_CHAT_SCHEDULE_TICK_SECS").ok().as_deref(),
        env::var("SPACE_CHAT_SCHEDULE_TICK_BATCH").ok().as_deref(),
    ) else {
        eprintln!("chat schedule ticker: disabled");
        return;
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match tokio::task::spawn_blocking(move || {
                chat::deliver_due_scheduled_messages(None, Some(batch))
            })
            .await
            {
                Ok(Ok(sent)) if !sent.is_empty() => {
                    eprintln!("chat schedule ticker: delivered {} message(s)", sent.len())
                }
                Ok(Ok(_)) => {}
                Ok(Err(e)) => eprintln!("chat schedule ticker: tick failed: {e}"),
                Err(e) => eprintln!("chat schedule ticker: task panicked: {e}"),
            }
        }
    });
}

fn spawn_webhook_ticker() {
    let Some((secs, batch)) = webhook_ticker_config(
        env::var("SPACE_WEBHOOK_TICK_SECS").ok().as_deref(),
        env::var("SPACE_WEBHOOK_TICK_BATCH").ok().as_deref(),
    ) else {
        return;
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(secs));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match tokio::task::spawn_blocking(move || applications::process_webhook_queue(batch))
                .await
            {
                Ok(Ok(done)) if !done.is_empty() => {
                    eprintln!("webhook ticker: swept {} deliveries", done.len());
                }
                Ok(Ok(_)) => {}
                Ok(Err(e)) => eprintln!("webhook ticker: sweep failed: {e}"),
                Err(e) => eprintln!("webhook ticker: sweep task panicked: {e}"),
            }
        }
    });
}

#[tokio::main]
async fn main() {
    let p = env::var("SPACE_DB").unwrap_or_else(|_| "/var/lib/gaia-space/space.db".into());
    db::set_db_path(PathBuf::from(p));
    bootstrap();
    spawn_webhook_ticker();
    spawn_pipeline_schedule_ticker();
    spawn_chat_schedule_ticker();
    let app = Router::new()
        .route("/caldav/", any(caldav_home))
        .route("/caldav/{calendar_id}/", any(caldav_collection))
        .route("/caldav/{calendar_id}/calendar.ics", any(caldav_calendar))
        .route(
            "/caldav/{calendar_id}/{href}",
            get(caldav_get_event)
                .put(caldav_put_event)
                .delete(caldav_delete_event),
        )
        .route("/api/rooms/{room}", get(public_room))
        .route("/api/capabilities", get(capabilities))
        .route("/api/auth/mobile-pairings", post(create_mobile_pairing))
        .route(
            "/api/auth/mobile-pairings/consume",
            post(consume_mobile_pairing),
        )
        .route("/api/auth/login", post(login))
        .route("/api/auth/register", post(register))
        .route("/api/domains", get(domains).post(save_domain))
        .route(
            "/api/domains/{domain}",
            axum::routing::delete(delete_domain),
        )
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/auth/password", post(change_password))
        .route(
            "/api/auth/tokens",
            get(permanent_tokens).post(create_permanent_token),
        )
        .route(
            "/api/auth/tokens/{token_id}",
            axum::routing::delete(revoke_permanent_token),
        )
        .route("/api/users", get(users).post(create_user))
        .route("/api/users/{id}", patch(patch_user).delete(delete_user))
        .route("/api/directory", get(directory))
        .route("/api/documents/upload", post(document_upload))
        .route("/api/documents/files/{document_id}", get(document_download))
        .route("/api/app/me", get(app_me))
        .merge(app_parameter_routes())
        .route("/api/app/projects", get(app_projects))
        .route("/api/app/rooms", get(app_list_rooms).post(app_create_room))
        .route("/api/app/rooms/{room_id}", get(app_get_room))
        .route("/api/app/rooms/{room_id}/join", post(app_join_room))
        .route(
            "/api/app/projects/{project_id}/issues",
            get(app_list_project_issues).post(app_create_issue),
        )
        .route("/api/app/issues/{issue_id}", get(app_get_issue))
        .route(
            "/api/app/reviews/{review_id}/checks",
            post(app_record_external_check),
        )
        .route(
            "/api/registry/{repository_id}/generic/{package_name}/{version}/metadata",
            get(registry_generic_metadata),
        )
        .route(
            "/api/registry/{repository_id}/generic/{package_name}/{version}/{filename}",
            put(registry_generic_upload).get(registry_generic_download),
        )
        .route(
            "/api/registry/{repository_id}/npm/{*path}",
            put(registry_npm_put).get(registry_npm_get),
        )
        .route(
            "/api/registry/{repository_id}/maven/{*path}",
            put(registry_maven_put).get(registry_maven_get),
        )
        .route(
            "/api/registry/{repository_id}/nuget/{*path}",
            put(registry_nuget_put).get(registry_nuget_get),
        )
        .route(
            "/api/registry/{repository_id}/pypi/{*path}",
            get(registry_pypi_get),
        )
        .route(
            "/api/registry/{repository_id}/composer/{*path}",
            get(registry_composer_get),
        )
        .route(
            "/api/registry/{repository_id}/v2/{*path}",
            put(registry_oci_put)
                .post(registry_oci_post)
                .get(registry_oci_get),
        )
        .route("/oauth/authorize", post(oauth_authorize))
        .route("/oauth/token", post(oauth_token))
        .route("/api/cmd/{command}", post(cmd))
        .layer(DefaultBodyLimit::max(document_upload_max_bytes(
            env::var("SPACE_DOCUMENT_UPLOAD_MAX_BYTES").ok().as_deref(),
        )))
        .with_state(App::new());
    let port = env::var("SPACE_PORT")
        .ok()
        .and_then(|x| x.parse().ok())
        .unwrap_or(8090);
    axum::serve(
        tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
            .await
            .unwrap(),
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

// `test_lock()` deliberately holds a `MutexGuard` for the whole async test body: these
// tests share one process-global DB and must run serially, so the guard has to outlive
// every `.await` in the test. This is the intent, not an accident.
#[allow(clippy::await_holding_lock)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_schedule_ticker_defaults_and_disables() {
        assert_eq!(
            chat_schedule_ticker_config(None, None),
            Some((
                DEFAULT_CHAT_SCHEDULE_TICK_SECS,
                chat::SCHEDULED_TICK_LIMIT_DEFAULT
            ))
        );
        assert_eq!(
            chat_schedule_ticker_config(Some("5"), Some("7")),
            Some((5, 7))
        );
        assert_eq!(chat_schedule_ticker_config(Some("0"), None), None);
        assert_eq!(chat_schedule_ticker_config(Some("nope"), None), None);
        assert_eq!(chat_schedule_ticker_config(None, Some("0")), None);
    }

    #[test]
    fn poll_commands_are_session_scoped_and_a_ballot_is_bound_to_its_sender() {
        for name in [
            "create_poll",
            "get_poll",
            "list_channel_polls",
            "vote_poll",
            "close_poll",
        ] {
            assert!(
                matches!(command_policy(name), Some(CommandPolicy::Session)),
                "{name}"
            );
        }
        // A client naming another voter/author is rewritten to the session identity, so
        // no ballot can be cast — and no poll closed — on somebody else's behalf.
        let mut body =
            json!({"poll_id": "p-1", "voter_id": "someone-else", "option_ids": ["p-1-o0"]});
        bind_session_identity(&mut body, "me");
        assert_eq!(body["voter_id"], json!("me"));
        let mut close = json!({"poll_id": "p-1", "author_id": "someone-else"});
        bind_session_identity(&mut close, "me");
        assert_eq!(close["author_id"], json!("me"));
    }

    #[test]
    fn profile_communication_writes_are_bound_to_the_session() {
        for name in [
            "save_messenger_contact",
            "delete_messenger_contact",
            "set_profile_email_status",
        ] {
            assert!(
                matches!(command_policy(name), Some(CommandPolicy::Session)),
                "{name}"
            );
        }
        let mut body = json!({"value":{"profile_id":"someone-else"},"profile_id":"someone-else"});
        bind_session_identity(&mut body, "me");
        assert_eq!(body["value"]["profile_id"], json!("me"));
        assert_eq!(body["profile_id"], json!("me"));
    }

    #[test]
    fn advanced_directory_commands_are_admin_gated() {
        for name in ["list_directory_feed", "list_directory_calendar"] {
            assert!(
                matches!(command_policy(name), Some(CommandPolicy::AppAdmin)),
                "{name}"
            );
        }
    }

    #[test]
    fn paging_and_unfurl_are_session_scoped_and_read_as_the_session() {
        for name in ["list_messages_page", "unfurl_message_links"] {
            assert!(
                matches!(command_policy(name), Some(CommandPolicy::Session)),
                "{name}"
            );
        }
        // The reader is always the session: a client cannot page or unfurl "as" someone
        // whose channel membership it does not have.
        let mut body =
            json!({"channel_id": "c-1", "cursor": "abc", "acting_profile_id": "someone-else"});
        bind_session_identity(&mut body, "me");
        assert_eq!(body["acting_profile_id"], json!("me"));
        // The cursor is untouched data, never an identity.
        assert_eq!(body["cursor"], json!("abc"));
    }

    #[test]
    fn scheduled_message_commands_are_session_scoped() {
        for name in [
            "schedule_message",
            "list_scheduled_messages",
            "get_scheduled_message",
            "update_scheduled_message",
            "cancel_scheduled_message",
        ] {
            assert!(
                matches!(command_policy(name), Some(CommandPolicy::Session)),
                "{name}"
            );
        }
        assert!(matches!(
            command_policy("deliver_due_scheduled_messages"),
            Some(CommandPolicy::AppAdmin)
        ));
    }

    #[test]
    fn pipeline_schedule_ticker_is_opt_in_and_configurable() {
        assert_eq!(pipeline_schedule_ticker_config(None, None), None);
        assert_eq!(
            pipeline_schedule_ticker_config(Some("true"), None),
            Some(DEFAULT_PIPELINE_SCHEDULE_TICK_SECS)
        );
        assert_eq!(
            pipeline_schedule_ticker_config(Some("1"), Some("15")),
            Some(15)
        );
        assert_eq!(
            pipeline_schedule_ticker_config(Some("yes"), Some("0")),
            None
        );
        assert_eq!(
            pipeline_schedule_ticker_config(Some("true"), Some("abc")),
            None
        );
        assert_eq!(
            pipeline_schedule_ticker_config(Some("false"), Some("15")),
            None
        );
    }

    #[test]
    fn webhook_ticker_config_defaults_and_optout() {
        assert_eq!(
            webhook_ticker_config(None, None),
            Some((DEFAULT_WEBHOOK_TICK_SECS, DEFAULT_WEBHOOK_TICK_BATCH))
        );
        // explicit 0 seconds = disabled, the only way to turn the sweeper off
        assert_eq!(webhook_ticker_config(Some("0"), Some("5")), None);
        assert_eq!(webhook_ticker_config(Some(" 5 "), Some("7")), Some((5, 7)));
        // garbage falls back to defaults rather than disabling delivery silently
        assert_eq!(
            webhook_ticker_config(Some("nope"), Some("-3")),
            Some((DEFAULT_WEBHOOK_TICK_SECS, DEFAULT_WEBHOOK_TICK_BATCH))
        );
        // batch is clamped to the same bound process_webhook_queue enforces
        assert_eq!(
            webhook_ticker_config(Some("30"), Some("9999")),
            Some((30, 100))
        );
    }
    use axum::{body::{to_bytes, Body}, http::Request};
    use std::sync::{Mutex, OnceLock};
    use tower::ServiceExt;
    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn cookie(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("space_session={token}")).unwrap(),
        );
        headers
    }
    async fn status_and_body(response: axum::response::Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    async fn call(headers: HeaderMap, command: &str, body: Value) -> (StatusCode, Value) {
        status_and_body(
            cmd(headers, Path(command.to_string()), Json(body))
                .await
                .into_response(),
        )
        .await
    }
    #[tokio::test]
    async fn permanent_tokens_are_minted_listed_and_owner_revocable_over_http() {
        let _serial = test_lock();
        setup();
        let app = Router::new()
            .route(
                "/api/auth/tokens",
                get(permanent_tokens).post(create_permanent_token),
            )
            .route(
                "/api/auth/tokens/{token_id}",
                axum::routing::delete(revoke_permanent_token),
            );
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/tokens")
            .header(header::COOKIE, "space_session=ta")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"name":"deploy"}"#))
            .unwrap();
        let (status, minted) = status_and_body(app.clone().oneshot(request).await.unwrap()).await;
        assert_eq!(status, StatusCode::OK, "{minted}");
        let raw = minted["token"].as_str().unwrap();
        assert!(raw.starts_with("spat_"), "opaque token returned once");
        let id = minted["record"]["id"].as_str().unwrap().to_string();
        assert_eq!(minted["record"]["name"], json!("deploy"));

        let request = Request::builder()
            .uri("/api/auth/tokens")
            .header(header::COOKIE, "space_session=ta")
            .body(Body::empty())
            .unwrap();
        let (status, listed) = status_and_body(app.clone().oneshot(request).await.unwrap()).await;
        assert_eq!(status, StatusCode::OK, "{listed}");
        assert_eq!(listed[0]["id"], json!(id));
        assert!(listed[0].get("token").is_none(), "plaintext is never listed");

        let request = Request::builder()
            .method("DELETE")
            .uri(format!("/api/auth/tokens/{id}"))
            .header(header::COOKIE, "space_session=tb")
            .body(Body::empty())
            .unwrap();
        let (status, _) = status_and_body(app.clone().oneshot(request).await.unwrap()).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "another user cannot revoke it");

        let request = Request::builder()
            .method("DELETE")
            .uri(format!("/api/auth/tokens/{id}"))
            .header(header::COOKIE, "space_session=ta")
            .body(Body::empty())
            .unwrap();
        assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn permanent_bearer_token_authenticates_command_api_as_its_owner() {
        let _serial = test_lock();
        setup();
        let (record, raw) = gaia_space_lib::auth_security::create_permanent_token(
            "ua",
            "script",
            None,
        )
        .unwrap();

        let (status, body) = call(bearer(&raw), "list_projects", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["ok"], json!(true));
        assert_eq!(
            gaia_space_lib::auth_security::revoke_permanent_token("ua", &record.id),
            Ok(true)
        );
        let (status, _) = call(bearer(&raw), "list_projects", json!({})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "a revoked script token is unusable");
    }

    async fn login_call(
        app: App,
        source_ip: &str,
        username: &str,
        password: &str,
    ) -> (StatusCode, Value) {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_str(source_ip).unwrap());
        status_and_body(
            login(
                State(app),
                ConnectInfo("127.0.0.1:9000".parse().unwrap()),
                headers,
                Json(Login {
                    username: username.into(),
                    password: password.into(),
                }),
            )
            .await
            .into_response(),
        )
        .await
    }
    fn set_password(username: &str, password: &str) {
        db::conn()
            .unwrap()
            .execute(
                "UPDATE users SET password_hash=?1 WHERE username=?2",
                params![hash(password).unwrap(), username],
            )
            .unwrap();
    }
    /// One database for the whole binary's test run: `db::set_db_path` is process-global,
    /// so the HTTP cases below run as a single sequential scenario.
    fn setup() {
        let path = env::temp_dir().join(format!(
            "gaia-space-server-test-{}.sqlite",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        db::set_db_path(path);
        let c = db::conn().expect("database");
        db::seed(&c).expect("seed");
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','alice','Alice',1),('pb','bob','Bob',1),('pc','server-admin','Server Admin',1),('pd','dora','Dora',1)", []).unwrap();
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('ua','alice','x','Alice','pa','member',1,1),('ub','bob','x','Bob','pb','member',1,1),('uc','server-admin','x','Server Admin','pc','admin',1,1),('ud','dora','x','Dora','pd','member',1,1)", []).unwrap();
        c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES('ta','ua',unixepoch(),unixepoch()+3600),('tb','ub',unixepoch(),unixepoch()+3600),('tc','uc',unixepoch(),unixepoch()+3600),('td','ud',unixepoch(),unixepoch()+3600)", []).unwrap();
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        headers
    }
    fn basic(username: &str, password: &str) -> HeaderMap {
        use base64::Engine as _;
        let mut headers = HeaderMap::new();
        let value =
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Basic {value}")).unwrap(),
        );
        headers
    }

    #[tokio::test]
    async fn leads_are_an_admin_only_read_over_the_real_command_route() {
        let _serial = test_lock();
        setup();
        let path = env::temp_dir().join(format!("gaia-space-leads-http-{}.json", std::process::id()));
        std::fs::write(&path, r#"[{"id":"lead-1","bereich":"software","interesse":"vormerken","name":"Ada","business":"Analytical Engines","address":"1 Logic Lane","phone":"+49","email":"ada@example.test","consent":true,"createdAt":"2026-08-25T13:00:22.544Z"}]"#).unwrap();
        env::set_var("SPACE_LEADS_PATH", &path);

        let (status, _) = call(cookie("ta"), "list_leads", json!({})).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "a member must not receive lead PII");
        let (status, body) = call(cookie("tc"), "list_leads", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["value"][0]["email"], "ada@example.test");

        env::remove_var("SPACE_LEADS_PATH");
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn mention_edits_belong_to_the_author_and_the_inbox_to_its_owner() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO channels(id,content_type,name,archived) VALUES('ch-men','public','Talk',0)", []).unwrap();
        c.execute("INSERT INTO channel_members(channel_id,profile_id,administrator) VALUES('ch-men','pa',0),('ch-men','pb',0)", []).unwrap();
        drop(c);

        // alice posts and names bob
        let (status, body) = call(
            cookie("ta"),
            "create_message",
            json!({"message": {"id":"m-men","channel_id":"ch-men","author_id":"pa","text":"hi @bob","created_at":1,"edited_at":null,"thread_of":null,"archived":false,"mention_ids":["pb"]}}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["value"]["mention_ids"], json!(["pb"]), "{body}");

        // bob sees it in his inbox and in his badge
        let (status, body) = call(
            cookie("tb"),
            "count_unread_mentions",
            json!({"profile_id":"pb"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["value"], json!(1), "{body}");
        let (status, body) = call(
            cookie("tb"),
            "list_mentions_for_profile",
            json!({"profile_id":"pb","unread_only":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["value"].as_array().unwrap().len(), 1, "{body}");
        assert_eq!(body["value"][0]["channel_name"], json!("Talk"));

        // alice asking for bob's inbox gets her own: the session binds `profile_id`
        let (status, body) = call(
            cookie("ta"),
            "list_mentions_for_profile",
            json!({"profile_id":"pb"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["value"].as_array().unwrap().is_empty(), "{body}");

        // bob cannot rewrite the mentions of alice's message
        let (status, _) = call(
            cookie("tb"),
            "update_message",
            json!({"id":"m-men","text":"hijacked","mention_ids":[]}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            call(
                cookie("tb"),
                "count_unread_mentions",
                json!({"profile_id":"pb"})
            )
            .await
            .1["value"],
            json!(1)
        );

        // the author may, and dropping bob clears his unread alert
        let (status, body) = call(
            cookie("ta"),
            "update_message",
            json!({"id":"m-men","text":"never mind","mention_ids":[]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["value"]["mention_ids"], json!([]));
        assert_eq!(
            call(
                cookie("tb"),
                "count_unread_mentions",
                json!({"profile_id":"pb"})
            )
            .await
            .1["value"],
            json!(0)
        );
    }

    #[tokio::test]
    async fn message_attachment_writes_answer_to_the_message_author() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO channels(id,content_type,name,archived) VALUES('ch-att','public','Files',0)", []).unwrap();
        // bob is a plain member of the channel; dora administers it
        c.execute("INSERT INTO channel_members(channel_id,profile_id,administrator) VALUES('ch-att','pa',0),('ch-att','pb',0),('ch-att','pd',1)", []).unwrap();
        c.execute("INSERT INTO messages(id,channel_id,author_id,text,created_at,archived) VALUES('m-att','ch-att','pa','alice writes',1,0)", []).unwrap();
        drop(c);

        let payload = |id: &str| {
            json!({
                "message_id": "m-att",
                "attachment": {
                    "id": id,
                    "file_name": "f.txt",
                    "mime_type": "text/plain",
                    "byte_length": 2,
                    "data_url": "data:,hi",
                    "upload_state": "uploading"
                }
            })
        };

        // a session is no longer a licence to write on someone else's message
        let (status, _) = call(cookie("tb"), "add_message_attachment", payload("att-bob")).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, _) = call(cookie("ta"), "add_message_attachment", payload("att-alice")).await;
        assert_eq!(status, StatusCode::OK);

        // the state machine is enforced across the wire too
        let (status, _) = call(
            cookie("tb"),
            "set_message_attachment_state",
            json!({"message_id": "m-att", "id": "att-alice", "state": "completed"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, body) = call(
            cookie("ta"),
            "set_message_attachment_state",
            json!({"message_id": "m-att", "id": "att-alice", "state": "completed"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let (status, body) = call(
            cookie("ta"),
            "set_message_attachment_state",
            json!({"message_id": "m-att", "id": "att-alice", "state": "uploading"}),
        )
        .await;
        assert_ne!(status, StatusCode::OK, "completed must not reopen: {body}");

        // the channel administrator may clean up; the plain member may not
        let (status, _) = call(
            cookie("tb"),
            "remove_message_attachment",
            json!({"message_id": "m-att", "id": "att-alice"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, body) = call(
            cookie("td"),
            "remove_message_attachment",
            json!({"message_id": "m-att", "id": "att-alice"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    #[tokio::test]
    async fn app_external_check_requires_review_right_and_reports_only_its_own_name() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-check','Check App','Application','client-check',1)", []).unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('p-check','Checks','CHK','pa',1)", []).unwrap();
        c.execute("INSERT INTO reviews(id,project_id,number,kind,state,title,target_branch) VALUES('r-check','p-check',1,'MR','Opened','Check','main')", []).unwrap();
        c.execute("INSERT INTO quality_gate_rules(id,project_id,branch_pattern,applications_json) VALUES('check-gate','p-check','main','[\"app-check\"]')", []).unwrap();
        drop(c);
        platform::seed_rights().unwrap();
        let secret = applications::rotate_app_secret("app-check".into()).unwrap();
        let token = applications::issue_app_token(
            "client-check".into(),
            secret.client_secret,
            Some("write".into()),
            Some(60),
        )
        .unwrap()
        .access_token
        .unwrap();
        let denied = app_record_external_check(
            bearer(&token),
            Path("r-check".into()),
            Json(AppExternalCheckInput {
                status: "SUCCEEDED".into(),
                details: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        assert!(
            !review::evaluate_quality_gate("r-check".into())
                .unwrap()
                .satisfied
        );
        app_rights::update_required_rights(
            "app-check".into(),
            vec!["Project.EditCodeReview".into()],
            vec![],
            Some(true),
        )
        .unwrap();
        app_rights::approve_scope(
            "app-check".into(),
            "project:p-check".into(),
            Some("uc".into()),
            None,
        )
        .unwrap();
        let recorded = app_record_external_check(
            bearer(&token),
            Path("r-check".into()),
            Json(AppExternalCheckInput {
                status: "SUCCEEDED".into(),
                details: Some("green".into()),
            }),
        )
        .await
        .unwrap();
        assert_eq!(recorded.0.check_name, "application:app-check");
        assert_eq!(
            review::list_external_checks("r-check".into()).unwrap()[0].status,
            "SUCCEEDED"
        );
        assert!(
            review::evaluate_quality_gate("r-check".into())
                .unwrap()
                .satisfied
        );
    }

    /// The external app API consumes the stage-2 grant: a valid token with the right
    /// OAuth scope still sees nothing and writes nothing until an admin authorized the
    /// application in that context, and the grant scopes to exactly that project.
    #[tokio::test]
    async fn the_app_api_shows_and_writes_only_what_the_rights_model_authorized() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-rights','Rights App','Application','client-rights',1)", []).unwrap();
        c.execute_batch("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('p-granted','Granted','GRA','pa',1),('p-other','Other','OTH','pa',1);").unwrap();
        drop(c);
        platform::seed_rights().unwrap();
        let secret = applications::rotate_app_secret("app-rights".into()).unwrap();
        let token = applications::issue_app_token(
            "client-rights".into(),
            secret.client_secret,
            Some("read write".into()),
            Some(60),
        )
        .unwrap()
        .access_token
        .unwrap();

        // Stage 0: nothing declared, nothing approved.
        let (status, body) =
            status_and_body(app_projects(bearer(&token)).await.unwrap().into_response()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.as_array().unwrap().len(), 0);
        let denied = app_create_issue(
            bearer(&token),
            Path("p-granted".to_string()),
            Json(AppIssueInput {
                title: "from app".into(),
                description: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);

        // Stage 1 + 2 in one project only.
        app_rights::update_required_rights(
            "app-rights".into(),
            vec![
                "Project.ViewProject".to_string(),
                "Project.CreateIssues".to_string(),
            ],
            vec![],
            Some(true),
        )
        .unwrap();
        app_rights::approve_scope(
            "app-rights".into(),
            "project:p-granted".into(),
            Some("uc".into()),
            None,
        )
        .unwrap();

        let (status, body) =
            status_and_body(app_projects(bearer(&token)).await.unwrap().into_response()).await;
        assert_eq!(status, StatusCode::OK);
        let ids: Vec<&str> = body
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["p-granted"]);

        let created = app_create_issue(
            bearer(&token),
            Path("p-granted".to_string()),
            Json(AppIssueInput {
                title: "from app".into(),
                description: None,
            }),
        )
        .await
        .unwrap();
        assert_eq!(created.0.title, "from app");
        let empty_title = app_create_issue(
            bearer(&token),
            Path("p-granted".to_string()),
            Json(AppIssueInput {
                title: "   ".into(),
                description: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(empty_title.status(), StatusCode::BAD_REQUEST);
        let still_denied = app_create_issue(
            bearer(&token),
            Path("p-other".to_string()),
            Json(AppIssueInput {
                title: "leak".into(),
                description: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(still_denied.status(), StatusCode::FORBIDDEN);
    }

    /// ☎Kali-VIII finding: the bot is told who is typing, so that identity must be the
    /// session's. A logged-in caller naming someone else would have a third-party bot
    /// announced to as — and answered for — that other person.
    #[tokio::test]
    async fn slash_command_discovery_speaks_for_the_session_and_never_a_named_stranger() {
        let _serial = test_lock();
        setup();
        let mut body = json!({"chatbotId": "bot-1", "userId": "pb", "prefix": "/dep"});
        let alice = user_by_session_token("ta").unwrap();
        authorize_command(&alice, "list_chatbot_commands", &mut body).unwrap();
        assert_eq!(body["userId"], "pa");
        assert_eq!(body["user_id"], "pa");
        assert_eq!(body["prefix"], "/dep");
    }

    /// ☎Kali-VIII round 5: a WRITER publishes; it does not hand out rights. Granting is the
    /// MANAGER's or the owner's, or a writer could quietly promote itself.
    #[tokio::test]
    async fn a_writer_cannot_promote_itself_or_delete_the_repository() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-grant','grant','npm','HOSTING')", []).unwrap();
        c.execute("INSERT INTO package_repository_acl(repository_id,profile_id,role) VALUES('repo-grant','pb','WRITER'),('repo-grant','pd','MANAGER')", []).unwrap();
        drop(c);
        let promote = json!({"entry": {"repository_id": "repo-grant", "profile_id": "pb", "role": "MANAGER"}});
        let (status, _) = call(cookie("tb"), "set_package_repository_acl", promote.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(
            cookie("tb"),
            "delete_package_repository",
            json!({"id": "repo-grant"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(
            cookie("tb"),
            "remove_package_repository_acl",
            json!({"repository_id": "repo-grant", "profile_id": "pd"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        // The manager may do what the writer may not.
        let (status, _) = call(cookie("td"), "set_package_repository_acl", promote).await;
        assert_eq!(status, StatusCode::OK);
        // Reading stays open to the writer.
        let (status, _) = call(
            cookie("tb"),
            "list_package_versions",
            json!({"repository_id": "repo-grant", "query": null}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    /// ☎Kali-VIII round 4: the registry routes were gated while `/api/cmd` reached the same
    /// publish with a bare session. Both doors now ask the same question.
    #[tokio::test]
    async fn the_command_endpoint_cannot_publish_into_a_repository_the_caller_may_not_write() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('proj-cmd','Cmd','CMD','pa',1)", []).unwrap();
        c.execute("INSERT INTO package_repositories(id,project_id,name,format,mode) VALUES('repo-cmd','proj-cmd','cmd','npm','HOSTING')", []).unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('proj-cmd','pb')",
            [],
        )
        .unwrap();
        drop(c);
        let publish = json!({
            "repositoryId": "repo-cmd",
            "packageName": "left-pad",
            "version": "1.0.0",
            "metadataJson": null,
            "payloadFilename": null,
            "payloadContent": null,
            "immutable": null
        });
        // A member of the project may read it, but publishing is the owner's or a grantee's.
        let (status, _) = call(cookie("tb"), "publish_package_version", publish.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(
            cookie("td"),
            "package_retention_candidates",
            json!({"repositoryId": "repo-cmd"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(cookie("ta"), "publish_package_version", publish).await;
        assert_eq!(status, StatusCode::OK);
    }

    /// ☎Kali-VIII B2: authentication answered "who", never "which repository". A project's
    /// package repository is now closed to a logged-in stranger, and an ACL that names a
    /// reader does not also make them a publisher.
    #[tokio::test]
    async fn a_registry_repository_is_not_open_to_every_logged_in_account() {
        let _serial = test_lock();
        setup();
        let package_dir =
            env::temp_dir().join(format!("gaia-space-registry-acl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&package_dir);
        env::set_var("SPACE_PACKAGE_DIR", &package_dir);
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('proj-pkg','Packaged','PKG','pa',1)", []).unwrap();
        c.execute("INSERT INTO package_repositories(id,project_id,name,format,mode) VALUES('repo-owned','proj-pkg','owned','nuget','HOSTING')", []).unwrap();
        c.execute("INSERT INTO package_repositories(id,name,format,mode) VALUES('repo-acl','acl','nuget','HOSTING')", []).unwrap();
        c.execute("INSERT INTO package_repository_acl(repository_id,profile_id,role) VALUES('repo-acl','pb','VIEWER')", []).unwrap();
        drop(c);

        // The project's owner reaches it; a logged-in stranger does not.
        assert_eq!(
            registry_nuget_get(
                bearer("ta"),
                Path(("repo-owned".into(), "index.json".into()))
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert_eq!(
            registry_nuget_get(
                bearer("tb"),
                Path(("repo-owned".into(), "index.json".into()))
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );

        // A VIEWER reads but cannot publish; someone the ACL does not name reads nothing.
        assert_eq!(
            registry_nuget_get(bearer("tb"), Path(("repo-acl".into(), "index.json".into())))
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            registry_nuget_put(
                bearer("tb"),
                Path(("repo-acl".into(), "Pkg/1.0.0/Pkg.1.0.0.nupkg".into())),
                Bytes::from_static(b"nupkg"),
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            registry_nuget_get(bearer("td"), Path(("repo-acl".into(), "index.json".into())))
                .await
                .status(),
            StatusCode::FORBIDDEN
        );

        // Membership reads the project's repository; publishing into it needs the owner or
        // an explicit WRITER/MANAGER grant, so a plain member cannot push a release.
        let c = db::conn().unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('proj-pkg','pb')",
            [],
        )
        .unwrap();
        drop(c);
        assert_eq!(
            registry_nuget_get(
                bearer("tb"),
                Path(("repo-owned".into(), "index.json".into()))
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert_eq!(
            registry_nuget_put(
                bearer("tb"),
                Path(("repo-owned".into(), "Pkg/1.0.0/Pkg.1.0.0.nupkg".into())),
                Bytes::from_static(b"nupkg"),
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            registry_nuget_put(
                bearer("ta"),
                Path(("repo-owned".into(), "Pkg/1.0.0/Pkg.1.0.0.nupkg".into())),
                Bytes::from_static(b"nupkg"),
            )
            .await
            .status(),
            StatusCode::CREATED
        );

        // An account admin still reaches both, and the unowned legacy repository is unchanged.
        assert_eq!(
            registry_nuget_get(
                bearer("tc"),
                Path(("repo-owned".into(), "index.json".into()))
            )
            .await
            .status(),
            StatusCode::OK
        );
        let _ = std::fs::remove_dir_all(&package_dir);
    }

    /// NuGet/PyPI/Composer/OCI protocol endpoints, end to end over HTTP: publish through the
    /// format's own upload path where it has one, then resolve through the document the real
    /// client fetches. Unauthenticated access must be refused on the same paths.
    #[tokio::test]
    async fn format_registry_protocols_are_reachable_over_http() {
        let _serial = test_lock();
        setup();
        let package_dir =
            env::temp_dir().join(format!("gaia-space-registry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&package_dir);
        env::set_var("SPACE_PACKAGE_DIR", &package_dir);
        let c = db::conn().unwrap();
        for (id, format) in [
            ("repo-nuget", "nuget"),
            ("repo-pypi", "pypi"),
            ("repo-composer", "composer"),
            ("repo-oci", "container"),
        ] {
            c.execute(
                "INSERT INTO package_repositories(id,name,format,mode) VALUES(?1,?1,?2,'HOSTING')",
                params![id, format],
            )
            .unwrap();
        }
        drop(c);

        // NuGet: flat-container upload → service index → version list.
        let put = registry_nuget_put(
            bearer("ta"),
            Path((
                "repo-nuget".into(),
                "Newtonsoft.Json/13.0.1/Newtonsoft.Json.13.0.1.nupkg".into(),
            )),
            Bytes::from_static(b"nupkg-bytes"),
        )
        .await;
        assert_eq!(put.status(), StatusCode::CREATED);
        let (status, body) = status_and_body(
            registry_nuget_get(
                bearer("ta"),
                Path(("repo-nuget".into(), "index.json".into())),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["version"], "3.0.0");
        let (status, body) = status_and_body(
            registry_nuget_get(
                bearer("ta"),
                Path(("repo-nuget".into(), "newtonsoft.json/index.json".into())),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["versions"], json!(["13.0.1"]));
        assert_eq!(
            registry_nuget_get(
                HeaderMap::new(),
                Path(("repo-nuget".into(), "index.json".into()))
            )
            .await
            .status(),
            StatusCode::UNAUTHORIZED
        );

        let nupkg = registry_nuget_get(
            bearer("ta"),
            Path((
                "repo-nuget".into(),
                "Newtonsoft.Json/13.0.1/Newtonsoft.Json.13.0.1.nupkg".into(),
            )),
        )
        .await;
        assert_eq!(nupkg.status(), StatusCode::OK);

        // PyPI: publish through the shared registry writer, resolve through the simple index.
        pipelines::publish_registry_bytes(
            "repo-pypi",
            "Flask-Login",
            "0.6.3",
            Some(r#"{"formatMetadata":{"files":["flask_login-0.6.3.tar.gz"]}}"#),
            Some("flask_login-0.6.3.tar.gz"),
            Some(b"sdist"),
        )
        .unwrap();
        let simple = registry_pypi_get(
            bearer("ta"),
            Path(("repo-pypi".into(), "flask.login/".into())),
        )
        .await;
        assert_eq!(simple.status(), StatusCode::OK);
        let html = String::from_utf8(
            to_bytes(simple.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(html.contains("flask_login-0.6.3.tar.gz"), "{html}");
        let file = registry_pypi_get(
            bearer("ta"),
            Path((
                "repo-pypi".into(),
                "flask-login/flask_login-0.6.3.tar.gz".into(),
            )),
        )
        .await;
        assert_eq!(file.status(), StatusCode::OK);

        // Composer: root document points at p2, p2 lists the stored version.
        pipelines::publish_registry_bytes(
            "repo-composer",
            "monolog/monolog",
            "3.5.0",
            Some(r#"{"formatMetadata":{"description":"logging"}}"#),
            None,
            None,
        )
        .unwrap();
        let (status, body) = status_and_body(
            registry_composer_get(
                bearer("ta"),
                Path(("repo-composer".into(), "packages.json".into())),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["metadata-url"]
            .as_str()
            .unwrap()
            .ends_with("/p2/%package%.json"));
        let (status, body) = status_and_body(
            registry_composer_get(
                bearer("ta"),
                Path(("repo-composer".into(), "p2/Monolog/Monolog.json".into())),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["packages"]["monolog/monolog"][0]["version"], "3.5.0");
        assert_eq!(
            body["packages"]["monolog/monolog"][0]["description"],
            "logging"
        );

        // OCI: tagged manifest upload, tag list, referrers by subject digest.
        let manifest =
            json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json"});
        assert_eq!(
            registry_oci_put(
                bearer("ta"),
                Path(("repo-oci".into(), "Library/Nginx/manifests/1.25".into())),
                Query(HashMap::new()),
                Bytes::from(manifest.to_string()),
            )
            .await
            .status(),
            StatusCode::CREATED
        );
        let signature = json!({"schemaVersion":2,"subject":{"digest":"sha256:deadbeef"}});
        assert_eq!(
            registry_oci_put(
                bearer("ta"),
                Path(("repo-oci".into(), "library/nginx/manifests/sig-1".into())),
                Query(HashMap::new()),
                Bytes::from(signature.to_string()),
            )
            .await
            .status(),
            StatusCode::CREATED
        );
        let (status, body) = status_and_body(
            registry_oci_get(
                bearer("ta"),
                Path(("repo-oci".into(), "library/nginx/tags/list".into())),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["name"], "library/nginx");
        assert_eq!(body["tags"], json!(["1.25", "sig-1"]));
        let (status, body) = status_and_body(
            registry_oci_get(
                bearer("ta"),
                Path((
                    "repo-oci".into(),
                    "library/nginx/referrers/sha256:deadbeef".into(),
                )),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["manifests"][0]["reference"], "sig-1");
        let stored_manifest = registry_oci_get(
            bearer("ta"),
            Path(("repo-oci".into(), "library/nginx/manifests/1.25".into())),
        )
        .await;
        assert_eq!(stored_manifest.status(), StatusCode::OK);

        // Blob addressing: monolithic POST, session PUT, digest-addressed GET.
        let layer = b"layer-content-bytes".to_vec();
        let digest = package_registry::compute_digest(&layer);
        let posted = registry_oci_post(
            bearer("ta"),
            Path(("repo-oci".into(), "library/nginx/blobs/uploads".into())),
            Query(HashMap::from([("digest".to_string(), digest.clone())])),
            Bytes::from(layer.clone()),
        )
        .await;
        assert_eq!(posted.status(), StatusCode::CREATED);
        assert_eq!(
            posted.headers().get("docker-content-digest").unwrap(),
            digest.as_str()
        );
        let fetched = registry_oci_get(
            bearer("ta"),
            Path(("repo-oci".into(), format!("library/nginx/blobs/{digest}"))),
        )
        .await;
        assert_eq!(fetched.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(fetched.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
            layer
        );
        // Session start hands out a Location the client PUTs the blob to.
        let started = registry_oci_post(
            bearer("ta"),
            Path(("repo-oci".into(), "library/nginx/blobs/uploads".into())),
            Query(HashMap::new()),
            Bytes::new(),
        )
        .await;
        assert_eq!(started.status(), StatusCode::ACCEPTED);
        let location = started
            .headers()
            .get(header::LOCATION)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let session_path = location.split("/v2/").nth(1).unwrap().to_string();
        let config = b"{\"config\":true}".to_vec();
        let config_digest = package_registry::compute_digest(&config);
        assert_eq!(
            registry_oci_put(
                bearer("ta"),
                Path(("repo-oci".into(), session_path.clone())),
                Query(HashMap::from([(
                    "digest".to_string(),
                    config_digest.clone()
                )])),
                Bytes::from(config.clone()),
            )
            .await
            .status(),
            StatusCode::CREATED
        );
        // A digest that does not describe the bytes is refused, not stored.
        assert_eq!(
            registry_oci_put(
                bearer("ta"),
                Path(("repo-oci".into(), session_path)),
                Query(HashMap::from([("digest".to_string(), digest.clone())])),
                Bytes::from(b"different".to_vec()),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        // Unknown digest is a 404; a malformed one is a 400.
        assert_eq!(
            registry_oci_get(
                bearer("ta"),
                Path((
                    "repo-oci".into(),
                    format!("library/nginx/blobs/sha256:{}", "0".repeat(64))
                )),
            )
            .await
            .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            registry_oci_get(
                bearer("ta"),
                Path(("repo-oci".into(), "library/nginx/blobs/sha256:cafe".into())),
            )
            .await
            .status(),
            StatusCode::NOT_FOUND
        );
        env::remove_var("SPACE_PACKAGE_DIR");
        let _ = std::fs::remove_dir_all(&package_dir);
    }

    #[tokio::test]
    async fn app_issue_reads_require_read_scope_and_project_view_right() {
        let _serial = test_lock();
        setup();
        platform::seed_rights().unwrap();
        let c = db::conn().unwrap();
        c.execute_batch("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-issues','Issue App','Application','client-issues',1); INSERT INTO projects(id,name,key,created_by,created_at) VALUES('issues-project','Issues','ISSUE','pa',1); INSERT INTO issues(id,project_id,number,title,archived) VALUES('issue-visible','issues-project',1,'Visible',0);").unwrap();
        drop(c);
        let secret = applications::rotate_app_secret("app-issues".into()).unwrap();
        let mint = |scope: &str| {
            applications::issue_app_token(
                "client-issues".into(),
                secret.client_secret.clone(),
                Some(scope.into()),
                Some(60),
            )
            .unwrap()
            .access_token
            .unwrap()
        };
        let readable = mint("read");
        assert_eq!(
            app_list_project_issues(bearer(&readable), Path("issues-project".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN,
            "read scope does not replace the project grant"
        );
        app_rights::update_authorized_rights(
            "app-issues".into(),
            "project:issues-project".into(),
            vec!["Project.ViewIssues".into()],
            None,
            Some("test".into()),
        )
        .unwrap();
        let issues = app_list_project_issues(bearer(&readable), Path("issues-project".into()))
            .await
            .unwrap()
            .0;
        assert_eq!(
            issues
                .iter()
                .map(|issue| issue.id.as_str())
                .collect::<Vec<_>>(),
            vec!["issue-visible"]
        );
        assert_eq!(
            app_get_issue(bearer(&readable), Path("issue-visible".into()))
                .await
                .unwrap()
                .0
                .title,
            "Visible"
        );
        assert_eq!(
            app_get_issue(bearer(&mint("write")), Path("issue-visible".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN,
            "write is not an issue-read scope"
        );
    }

    #[tokio::test]
    async fn app_parameters_need_scope_and_context_right_and_mask_secrets() {
        let _serial = test_lock();
        setup();
        platform::seed_rights().unwrap();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-params','Parameters','Application','client-params',1)", []).unwrap();
        drop(c);
        applications::save_app_parameter(applications::AppParameter {
            application_id: "app-params".into(),
            key: "secret".into(),
            value: "do-not-return".into(),
            is_secret: true,
            updated_at: 0,
        })
        .unwrap();
        let secret = applications::rotate_app_secret("app-params".into()).unwrap();
        let token = applications::issue_app_token(
            "client-params".into(),
            secret.client_secret,
            Some("read".into()),
            Some(60),
        )
        .unwrap()
        .access_token
        .unwrap();
        assert_eq!(
            app_list_parameters(bearer(&token))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
        app_rights::update_authorized_rights(
            "app-params".into(),
            "application:app-params".into(),
            vec!["Project.ViewParameters".into()],
            None,
            Some("test".into()),
        )
        .unwrap();
        let parameters = app_list_parameters(bearer(&token)).await.unwrap().0;
        assert_eq!(parameters[0].value, "***");
        assert_eq!(
            command_policy("save_app_parameter"),
            Some(CommandPolicy::AppAdmin)
        );
    }

    #[tokio::test]
    async fn app_parameter_writes_need_write_scope_and_separate_modify_and_delete_rights() {
        let _serial = test_lock();
        setup();
        platform::seed_rights().unwrap();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-pw','Parameters RW','Application','client-pw',1)", []).unwrap();
        drop(c);
        let mint = |scope: &str| {
            let secret = applications::rotate_app_secret("app-pw".into()).unwrap();
            applications::issue_app_token(
                "client-pw".into(),
                secret.client_secret,
                Some(scope.into()),
                Some(60),
            )
            .unwrap()
            .access_token
            .unwrap()
        };
        let readable = mint("read");
        let input = || AppParameterInput {
            key: "api-key".into(),
            value: "v1".into(),
            is_secret: true,
        };
        assert_eq!(
            app_create_parameter(bearer(&readable), Json(input()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN,
            "read scope must not create parameters"
        );
        let writable = mint("read write");
        assert_eq!(
            app_create_parameter(bearer(&writable), Json(input()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN,
            "write scope alone is not a context right"
        );
        app_rights::update_authorized_rights(
            "app-pw".into(),
            "application:app-pw".into(),
            vec![
                "Project.ViewParameters".into(),
                "Project.ModifyParameters".into(),
            ],
            None,
            Some("test".into()),
        )
        .unwrap();
        let created = app_create_parameter(bearer(&writable), Json(input()))
            .await
            .unwrap()
            .0;
        assert_eq!(created.key, "api-key");
        assert_eq!(
            created.value, "***",
            "secret writes are masked in responses"
        );
        assert_eq!(
            app_create_parameter(bearer(&writable), Json(input()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::CONFLICT
        );
        let updated = app_update_parameter(
            bearer(&writable),
            Json(AppParameterInput {
                key: "api-key".into(),
                value: "v2".into(),
                is_secret: false,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(updated.value, "v2");
        assert_eq!(
            app_update_parameter(
                bearer(&writable),
                Json(AppParameterInput {
                    key: "missing".into(),
                    value: "v".into(),
                    is_secret: false,
                }),
            )
            .await
            .unwrap_err()
            .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            app_delete_parameter(bearer(&writable), Path("api-key".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN,
            "modify right does not imply delete right"
        );
        app_rights::update_authorized_rights(
            "app-pw".into(),
            "application:app-pw".into(),
            vec![
                "Project.ViewParameters".into(),
                "Project.ModifyParameters".into(),
                "Project.DeleteParameters".into(),
            ],
            None,
            Some("test".into()),
        )
        .unwrap();
        let _ = app_delete_parameter(bearer(&writable), Path("api-key".into()))
            .await
            .unwrap();
        assert!(app_list_parameters(bearer(&writable))
            .await
            .unwrap()
            .0
            .is_empty());
        assert_eq!(
            app_delete_parameter(bearer(&writable), Path("api-key".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::NOT_FOUND,
            "deleting an unknown key is 404, not a silent success"
        );
        assert_eq!(
            app_create_parameter(
                bearer(&writable),
                Json(AppParameterInput {
                    key: "  ".into(),
                    value: "v".into(),
                    is_secret: false,
                }),
            )
            .await
            .unwrap_err()
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            app_create_parameter(
                bearer(&writable),
                Json(AppParameterInput {
                    key: "masked".into(),
                    value: PARAMETER_SECRET_MASK.into(),
                    is_secret: true,
                }),
            )
            .await
            .unwrap_err()
            .status(),
            StatusCode::BAD_REQUEST,
            "the mask sentinel must not be storable as a value"
        );
    }

    /// Route wiring, not handler bodies: the body carries no application id, so a
    /// forged `applicationId` cannot retarget another app's namespace, and the
    /// mutation verbs must actually be mounted on the documented paths.
    #[tokio::test]
    async fn app_parameter_router_mounts_mutations_and_ignores_body_application_id() {
        use tower::ServiceExt;
        let _serial = test_lock();
        setup();
        platform::seed_rights().unwrap();
        let c = db::conn().unwrap();
        c.execute_batch("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-router','Router','Application','client-router',1),('app-victim','Victim','Application','client-victim',1);").unwrap();
        drop(c);
        let secret = applications::rotate_app_secret("app-router".into()).unwrap();
        let token = applications::issue_app_token(
            "client-router".into(),
            secret.client_secret,
            Some("read write".into()),
            Some(60),
        )
        .unwrap()
        .access_token
        .unwrap();
        app_rights::update_authorized_rights(
            "app-router".into(),
            "application:app-router".into(),
            vec![
                "Project.ViewParameters".into(),
                "Project.ModifyParameters".into(),
                "Project.DeleteParameters".into(),
            ],
            None,
            Some("test".into()),
        )
        .unwrap();
        let call = |method: Method, uri: &str, body: Value| {
            let token = token.clone();
            let request = axum::http::Request::builder()
                .method(method)
                .uri(uri.to_string())
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap();
            async move {
                app_parameter_routes::<()>()
                    .oneshot(request)
                    .await
                    .unwrap()
                    .into_response()
            }
        };
        let created = call(
            Method::POST,
            "/api/app/parameters",
            json!({"key": "k", "value": "v", "isSecret": false, "applicationId": "app-victim"}),
        )
        .await;
        let (status, body) = status_and_body(created).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["application_id"], "app-router",
            "body app id is ignored"
        );
        assert!(
            applications::list_app_parameters("app-victim".into())
                .unwrap()
                .is_empty(),
            "no cross-application write"
        );
        let updated = call(
            Method::PUT,
            "/api/app/parameters",
            json!({"key": "k", "value": "v2", "isSecret": false}),
        )
        .await;
        assert_eq!(updated.status(), StatusCode::OK);
        let deleted = call(Method::DELETE, "/api/app/parameters/k", json!({})).await;
        assert_eq!(deleted.status(), StatusCode::OK);
        let missing = call(Method::DELETE, "/api/app/parameters/k", json!({})).await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn app_bearer_api_resolves_identity_and_enforces_read_scope() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-api','API App','Application','client-api',1)", []).unwrap();
        drop(c);
        let secret = applications::rotate_app_secret("app-api".into()).unwrap();
        let readable = applications::issue_app_token(
            "client-api".into(),
            secret.client_secret,
            Some("read".into()),
            Some(60),
        )
        .unwrap()
        .access_token
        .unwrap();
        let identity = app_me(bearer(&readable)).await.unwrap().into_response();
        let (status, body) = status_and_body(identity).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["application"]["id"], "app-api");
        assert_eq!(body["scope"], "read");
        let projects = app_projects(bearer(&readable))
            .await
            .unwrap()
            .into_response();
        assert_eq!(projects.status(), StatusCode::OK);

        let unscoped = applications::issue_app_token(
            "client-api".into(),
            applications::rotate_app_secret("app-api".into())
                .unwrap()
                .client_secret,
            None,
            Some(60),
        )
        .unwrap()
        .access_token
        .unwrap();
        let denied = app_projects(bearer(&unscoped)).await.unwrap_err();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            denied.headers()[header::WWW_AUTHENTICATE],
            "Bearer error=\"insufficient_scope\", scope=\"read\""
        );

        let invalid = app_me(bearer("spat_not-a-token")).await.unwrap_err();
        assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            invalid.headers()[header::WWW_AUTHENTICATE],
            "Bearer error=\"invalid_token\""
        );
    }

    #[tokio::test]
    async fn app_room_api_requires_room_scope_and_project_rights_before_join() {
        let _serial = test_lock();
        setup();
        platform::seed_rights().unwrap();
        let c = db::conn().unwrap();
        c.execute_batch("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-room','Room App','Application','client-room',1); INSERT INTO projects(id,name,key,created_by,created_at) VALUES('room-project','Rooms','ROOM','pa',1); INSERT INTO channels(id,content_type,name,project_id) VALUES('room-channel','entity-bound','Rooms','room-project'); INSERT INTO meetings(id,title,starts_at,ends_at,channel_id,video_provider,video_status,access_level) VALUES('room-live','Live',1,2,'room-channel','native','scheduled','PUBLIC'),('room-ended','Ended',1,2,'room-channel','native','ended','PUBLIC'),('room-archived','Archived',1,2,'room-channel','native','scheduled','PUBLIC'); UPDATE meetings SET archived=1 WHERE id='room-archived';").unwrap();
        c.execute("INSERT INTO meetings(id,title,starts_at,ends_at,video_provider,video_status,access_level) VALUES('room-unscoped','Unscoped',1,2,'native','scheduled','PUBLIC')", []).unwrap();
        drop(c);
        let secret = applications::rotate_app_secret("app-room".into()).unwrap();
        let mint = |scope: &str| {
            applications::issue_app_token(
                "client-room".into(),
                secret.client_secret.clone(),
                Some(scope.into()),
                Some(60),
            )
            .unwrap()
            .access_token
            .unwrap()
        };
        // Generic read is never a room-join capability.
        assert_eq!(
            app_join_room(bearer(&mint("read")), Path("room-live".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
        let join = mint("rooms:join");
        // A declared/issued scope is still insufficient without the dedicated stage-2 grant.
        assert_eq!(
            app_join_room(bearer(&join), Path("room-live".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
        app_rights::update_authorized_rights(
            "app-room".into(),
            "project:room-project".into(),
            vec!["Project.JoinMeetings".into()],
            None,
            Some("test".into()),
        )
        .unwrap();
        // Lifecycle and archival both fail before a non-admin LiveKit token can be minted.
        assert_eq!(
            app_join_room(bearer(&join), Path("room-ended".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app_join_room(bearer(&join), Path("room-archived".into()))
                .await
                .unwrap_err()
                .status(),
            StatusCode::NOT_FOUND
        );
        let list = mint("rooms:list");
        let rooms = app_list_rooms(bearer(&list)).await.unwrap().0;
        assert!(
            rooms.is_empty(),
            "join authority must not imply list authority"
        );
        app_rights::update_authorized_rights(
            "app-room".into(),
            "project:room-project".into(),
            vec!["Project.ViewMeetings".into(), "Project.JoinMeetings".into()],
            None,
            Some("test".into()),
        )
        .unwrap();
        let rooms = app_list_rooms(bearer(&list)).await.unwrap().0;
        assert_eq!(
            rooms
                .iter()
                .map(|room| room.id.as_str())
                .collect::<Vec<_>>(),
            vec!["room-live", "room-ended"],
            "channel-less rooms are skipped; they cannot poison an authorized list"
        );
    }

    /// Adversarial sweep (☠Bhairava) over the bearer path: every way a token could
    /// outlive its authority. Each case is attacked over the real handler, not the
    /// verifier, because the handler is what an attacker can reach.
    #[tokio::test]
    async fn app_bearer_refuses_expired_revoked_rotated_and_archived_authority() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-1','One','Application','client-1',1),('app-2','Two','Application','client-2',1)", []).unwrap();
        drop(c);
        let mint = |client: &str, app: &str, scope: &str, ttl: i64| {
            let secret = applications::rotate_app_secret(app.to_string()).unwrap();
            applications::issue_app_token(
                client.to_string(),
                secret.client_secret,
                Some(scope.to_string()),
                Some(ttl),
            )
            .unwrap()
        };

        // 1. Expiry is enforced, not merely recorded.
        let expiring = mint("client-1", "app-1", "read", 60);
        let expiring_token = expiring.access_token.clone().unwrap();
        let c = db::conn().unwrap();
        c.execute(
            "UPDATE app_tokens SET expires_at=unixepoch()-1 WHERE id=?1",
            [&expiring.id],
        )
        .unwrap();
        drop(c);
        let denied = app_me(bearer(&expiring_token)).await.unwrap_err();
        assert_eq!(
            denied.status(),
            StatusCode::UNAUTHORIZED,
            "an expired token is not an identity"
        );
        assert_eq!(
            app_projects(bearer(&expiring_token))
                .await
                .unwrap_err()
                .status(),
            StatusCode::UNAUTHORIZED
        );

        // 2. Explicit revocation takes effect immediately.
        let revoked = mint("client-1", "app-1", "read", 3600);
        let revoked_token = revoked.access_token.clone().unwrap();
        assert_eq!(
            app_me(bearer(&revoked_token))
                .await
                .unwrap()
                .into_response()
                .status(),
            StatusCode::OK
        );
        applications::revoke_app_token(revoked.id).unwrap();
        assert_eq!(
            app_me(bearer(&revoked_token)).await.unwrap_err().status(),
            StatusCode::UNAUTHORIZED,
            "revocation must be honoured on the very next request"
        );

        // 3. Secret rotation invalidates tokens minted under the old secret.
        let pre_rotation = mint("client-1", "app-1", "read", 3600)
            .access_token
            .unwrap();
        applications::rotate_app_secret("app-1".into()).unwrap();
        assert_eq!(
            app_me(bearer(&pre_rotation)).await.unwrap_err().status(),
            StatusCode::UNAUTHORIZED,
            "rotating the secret must strand outstanding tokens"
        );

        // 4. A token is bound to the application that minted it: presenting app-2's
        //    token never yields app-1's identity.
        let foreign = mint("client-2", "app-2", "read", 3600)
            .access_token
            .unwrap();
        let (status, body) =
            status_and_body(app_me(bearer(&foreign)).await.unwrap().into_response()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["application"]["id"], "app-2",
            "a token may only ever speak for its own application"
        );

        // 5. Scope strings are matched as whole tokens, so no prefix or substring
        //    lookalike is mistaken for the `read` grant.
        for lookalike in ["readonly", "read:none", "noread", "READ", ""] {
            let sneaky = mint("client-2", "app-2", lookalike, 3600)
                .access_token
                .unwrap();
            assert_eq!(
                app_projects(bearer(&sneaky)).await.unwrap_err().status(),
                StatusCode::FORBIDDEN,
                "scope {lookalike:?} must not pass for `read`"
            );
        }

        // 6. Archiving an application withdraws its API authority. Archiving does not
        //    revoke outstanding tokens, so the handler itself must refuse them.
        let archived_token = mint("client-2", "app-2", "read", 3600)
            .access_token
            .unwrap();
        let c = db::conn().unwrap();
        c.execute("UPDATE applications SET archived=1 WHERE id='app-2'", [])
            .unwrap();
        drop(c);
        assert_eq!(
            app_me(bearer(&archived_token)).await.unwrap_err().status(),
            StatusCode::UNAUTHORIZED,
            "an archived application has no identity to present"
        );
        assert_eq!(
            app_projects(bearer(&archived_token))
                .await
                .unwrap_err()
                .status(),
            StatusCode::UNAUTHORIZED,
            "an archived application must not keep reading projects"
        );
    }

    /// Regression (☾Kali): app credential commands were `Session`, so any logged-in
    /// member could rotate another application's secret or mint/verify its tokens.
    /// The dev environment lifecycle must be drivable over `/api/cmd`, not only in-process:
    /// create → activity → idle sweep → resume, with the session gate in front of it.
    #[tokio::test]
    async fn dev_environment_lifecycle_is_reachable_over_http() {
        let _serial = test_lock();
        setup();

        let (status, created) = call(
            cookie("ta"),
            "create_dev_environment",
            json!({"input":{"id":"env-http","project_id":"demo-project","owner_id":"pa","name":"HTTP env","idle_timeout_minutes":0}}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "create: {created}");
        assert_eq!(created["value"]["state"], "STARTING");

        let (status, touched) = call(
            cookie("ta"),
            "touch_dev_environment",
            json!({"id":"env-http"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "touch: {touched}");
        assert_eq!(touched["value"]["state"], "RUNNING");

        // Timeout 0 means the sweep must take it immediately.
        let (status, swept) =
            call(cookie("ta"), "hibernate_idle_dev_environments", json!({})).await;
        assert_eq!(status, StatusCode::OK, "sweep: {swept}");
        assert_eq!(swept["value"][0]["id"], "env-http");
        assert_eq!(swept["value"][0]["state"], "HIBERNATED");
        assert!(swept["value"][0]["persisted_worktree"].is_string());

        let (status, resumed) = call(
            cookie("ta"),
            "resume_dev_environment",
            json!({"id":"env-http","actor_id":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "resume: {resumed}");
        assert_eq!(resumed["value"]["state"], "RUNNING");

        // Independent check: the listing agrees with the command results.
        let (_, listed) = call(
            cookie("ta"),
            "list_dev_environments",
            json!({"project_id":"demo-project"}),
        )
        .await;
        assert_eq!(listed["value"][0]["state"], "RUNNING");

        // No session, no lifecycle.
        let (status, _) = call(
            HeaderMap::new(),
            "list_dev_environments",
            json!({"project_id":"demo-project"}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// The two-stage rights model is reachable over the HTTP command route, and a
    /// declaration alone still grants nothing until the scope is approved.
    #[tokio::test]
    async fn application_rights_are_two_stage_over_http() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('app-r','App R','Application','client-r')", []).unwrap();
        drop(c);
        let (status, seeded) = call(cookie("ta"), "seed_rights", json!({})).await;
        assert_eq!(status, StatusCode::OK, "seed: {seeded}");

        let (status, declared) = call(
            cookie("ta"),
            "update_required_rights",
            json!({"application_id":"app-r","right_codes_to_add":["Project.CreateIssues"],"right_codes_to_remove":[]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "declare: {declared}");
        assert_eq!(declared["value"][0]["right_code"], "Project.CreateIssues");

        let (_, pending) = call(
            cookie("ta"),
            "scope_approval_status",
            json!({"application_id":"app-r","context_identifier":"project:demo-project"}),
        )
        .await;
        assert_eq!(pending["value"]["status"], "PENDING");

        let (status, approved) = call(
            cookie("ta"),
            "approve_scope",
            json!({"application_id":"app-r","context_identifier":"project:demo-project","actor":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "approve: {approved}");
        assert_eq!(approved["value"]["status"], "APPROVED");

        // Independent check: the grant listing agrees with the approval result.
        let (_, granted) = call(
            cookie("ta"),
            "get_authorized_rights",
            json!({"application_id":"app-r","context_identifier":"project:demo-project"}),
        )
        .await;
        assert_eq!(granted["value"][0]["right_code"], "Project.CreateIssues");
        assert_eq!(granted["value"][0]["granted_by"], "pa");

        // No session, no rights editor.
        let (status, _) = call(
            HeaderMap::new(),
            "get_required_rights",
            json!({"application_id":"app-r"}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn app_credentials_are_admin_only() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app-x','App X','Application','client-x',1)", []).unwrap();
        drop(c);
        // Member: every credential command is refused before it reaches the handler.
        for (command, body) in [
            ("rotate_app_secret", json!({"application_id":"app-x"})),
            (
                "issue_app_token",
                json!({"client_id":"client-x","client_secret":"guess"}),
            ),
            ("verify_app_token", json!({"token":"spat_guess"})),
            ("revoke_app_token", json!({"id":"apptok-x"})),
            ("list_app_tokens", json!({"application_id":"app-x"})),
            // Signing-key + typed dispatch surface: same credential gate.
            ("app_signing_key", json!({"application_id":"app-x"})),
            ("rotate_app_signing_key", json!({"application_id":"app-x"})),
            ("application_payload_classes", json!({})),
            (
                "parse_application_payload",
                json!({"payload_json":"{\"className\":\"CustomPayload\",\"data\":{}}"}),
            ),
            (
                "dispatch_application_payload",
                json!({"application_id":"app-x","payload_json":"{\"className\":\"CustomPayload\",\"data\":{}}"}),
            ),
            (
                "install_marketplace_app",
                json!({"value":{"id":"i-x","marketplace_app_id":null,"application_id":"app-x","install_kind":"MANUAL","installed_by":null,"installed_at":0}}),
            ),
        ] {
            let (status, _) = call(cookie("ta"), command, body).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{command} must be admin-only"
            );
        }
        // Independent check: nothing was created by those attempts.
        let c = db::conn().unwrap();
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM app_secrets", [], |r| r.get(0))
                .unwrap(),
            0
        );
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM app_tokens", [], |r| r.get(0))
                .unwrap(),
            0
        );
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM app_installs", [], |r| r.get(0))
                .unwrap(),
            0
        );
        drop(c);
        // Admin: the typed payload surface is reachable in the web build, not just tauri.
        let (status, classes) = call(cookie("tc"), "application_payload_classes", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{classes}");
        assert!(classes["value"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str() == Some("CustomPayload")));
        let (status, class_name) = call(
            cookie("tc"),
            "parse_application_payload",
            json!({"payload_json":"{\"className\":\"CustomPayload\",\"data\":{}}"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{class_name}");
        assert_eq!(class_name["value"].as_str(), Some("CustomPayload"));
        let (status, key) = call(
            cookie("tc"),
            "app_signing_key",
            json!({"application_id":"app-x"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{key}");
        let first_key_id = key["value"]["key_id"].as_str().unwrap().to_string();
        let (status, rotated) = call(
            cookie("tc"),
            "rotate_app_signing_key",
            json!({"application_id":"app-x"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{rotated}");
        assert_ne!(
            rotated["value"]["key_id"].as_str(),
            Some(first_key_id.as_str())
        );
        assert_eq!(
            rotated["value"]["previous_key_id"].as_str(),
            Some(first_key_id.as_str())
        );
        // Admin: the same flow works end to end.
        let (status, secret) = call(
            cookie("tc"),
            "rotate_app_secret",
            json!({"application_id":"app-x"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{secret}");
        let client_secret = secret["value"]["client_secret"]
            .as_str()
            .unwrap()
            .to_string();
        let (status, token) = call(cookie("tc"), "issue_app_token", json!({"client_id":"client-x","client_secret":client_secret,"scope":"read","ttl_seconds":60})).await;
        assert_eq!(status, StatusCode::OK, "{token}");
        let access = token["value"]["access_token"].as_str().unwrap().to_string();
        let (status, verified) =
            call(cookie("tc"), "verify_app_token", json!({"token":access})).await;
        assert_eq!(status, StatusCode::OK, "{verified}");
        assert_eq!(verified["value"]["application_id"].as_str(), Some("app-x"));
        // And a member still cannot read the tokens that now exist.
        assert_eq!(
            call(
                cookie("ta"),
                "list_app_tokens",
                json!({"application_id":"app-x"})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    /// ☀Agni (V41): the webhook key ring is a credential surface. A member must not be
    /// able to mint a signing secret or enumerate the ring, and the ring itself must
    /// never hand back a secret value after the one-time presentation at rotation.
    #[tokio::test]
    async fn webhook_secret_rotation_is_admin_only_and_shows_the_secret_once() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('app-w','App W','Application','client-w')", []).unwrap();
        c.execute("INSERT INTO webhook_subscriptions(id,application_id,event_type,endpoint_uri,secret,max_attempts) VALUES('wh-1','app-w','IssueWebhookEvent','https://example.test/hook','old-secret',5)", []).unwrap();
        drop(c);
        for command in ["rotate_webhook_secret", "list_webhook_secrets"] {
            let (status, body) = call(cookie("ta"), command, json!({"webhook_id":"wh-1"})).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{command}: {body}");
        }
        // Nothing was minted by the refused calls.
        let c = db::conn().unwrap();
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM webhook_secrets", [], |r| r.get(0))
                .unwrap(),
            0
        );
        drop(c);
        // Admin rotates: the new secret is presented exactly once.
        let (status, rotated) = call(
            cookie("tc"),
            "rotate_webhook_secret",
            json!({"webhook_id":"wh-1","overlap_seconds":3600}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{rotated}");
        let fresh = rotated["value"]["secret"].as_str().unwrap().to_string();
        assert!(fresh.starts_with("spwh_"));
        // The listing describes the ring without ever repeating a secret value.
        let (status, listed) = call(
            cookie("tc"),
            "list_webhook_secrets",
            json!({"webhook_id":"wh-1"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{listed}");
        let rows = listed["value"].as_array().unwrap();
        assert_eq!(rows.len(), 2, "active + retiring during overlap: {listed}");
        assert_eq!(rows[0]["state"].as_str(), Some("ACTIVE"));
        assert_eq!(rows[1]["state"].as_str(), Some("RETIRING"));
        let serialised = listed.to_string();
        assert!(!serialised.contains(&fresh), "secret leaked into listing");
        assert!(
            !serialised.contains("old-secret"),
            "secret leaked into listing"
        );
        // Independent path: the superseded secret is still on the ring, so a receiver
        // that has not switched over yet still verifies inside the overlap.
        let c = db::conn().unwrap();
        let ring: Vec<String> = applications::signing_secrets(&c, "wh-1", None).unwrap();
        assert_eq!(ring.first().map(String::as_str), Some(fresh.as_str()));
        assert!(ring.iter().any(|s| s == "old-secret"));
        // Outside the overlap it is gone.
        c.execute(
            "UPDATE webhook_secrets SET expires_at=unixepoch()-1 WHERE state='RETIRING'",
            [],
        )
        .unwrap();
        let ring: Vec<String> = applications::signing_secrets(&c, "wh-1", None).unwrap();
        assert_eq!(ring, vec![fresh]);
    }
    /// ☀Ganga: one secret, one rotation. Over HTTP there is a single rotate command, and
    /// it must retire the authorization-code grants too — not just `app_tokens`.
    #[tokio::test]
    async fn rotating_over_http_retires_both_grant_families() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled,code_flow_enabled) VALUES('app-y','App Y','Application','client-y',1,1)", []).unwrap();
        drop(c);
        oauth::register_redirect_uri("app-y", "https://client.example/cb").unwrap();
        let (status, secret) = call(
            cookie("tc"),
            "rotate_app_secret",
            json!({"application_id":"app-y"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{secret}");
        let client_secret = secret["value"]["client_secret"]
            .as_str()
            .unwrap()
            .to_string();

        // A live token from each flow, minted under that secret.
        let (status, token) = call(
            cookie("tc"),
            "issue_app_token",
            json!({"client_id":"client-y","client_secret":client_secret,"ttl_seconds":60}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{token}");
        let app_token = token["value"]["access_token"].as_str().unwrap().to_string();
        let verifier = "verifier-0123456789012345678901234567890123456789";
        let challenge = {
            use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
            use sha2::{Digest, Sha256};
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        };
        let grant = oauth::authorize(
            "ua",
            &oauth::AuthorizeRequest {
                client_id: "client-y".into(),
                redirect_uri: "https://client.example/cb".into(),
                response_type: "code".into(),
                scope: "project:read".into(),
                state: None,
                code_challenge: Some(challenge),
                code_challenge_method: Some("S256".into()),
            },
            oauth::OAuthConfig::default(),
        )
        .unwrap();
        let code_token = oauth::exchange_code(
            &oauth::TokenRequest {
                grant_type: "authorization_code".into(),
                client_id: "client-y".into(),
                code: grant.code,
                redirect_uri: "https://client.example/cb".into(),
                code_verifier: Some(verifier.into()),
                client_secret: Some(client_secret),
            },
            oauth::OAuthConfig::default(),
        )
        .unwrap()
        .access_token;
        assert!(oauth::access_token_owner(&code_token).unwrap().is_some());

        let (status, rotated) = call(
            cookie("tc"),
            "rotate_app_secret",
            json!({"application_id":"app-y"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{rotated}");

        let (status, verified) =
            call(cookie("tc"), "verify_app_token", json!({"token":app_token})).await;
        assert_eq!(status, StatusCode::OK, "{verified}");
        assert!(
            verified["value"].is_null(),
            "the client_credentials token died with the secret: {verified}"
        );
        assert!(
            oauth::access_token_owner(&code_token).unwrap().is_none(),
            "the code-flow token died with the secret"
        );
    }

    #[tokio::test]
    async fn login_limiter_refuses_correct_password_during_lockout() {
        let _serial = test_lock();
        setup();
        set_password("alice", "correct-password");
        let app = App::new();
        for _ in 0..(LOGIN_MAX_FAILED_ATTEMPTS - 1) {
            assert_eq!(
                login_call(app.clone(), "198.51.100.10", "alice", "wrong-password")
                    .await
                    .0,
                StatusCode::UNAUTHORIZED
            );
        }
        assert_eq!(
            login_call(app.clone(), "198.51.100.10", "alice", "wrong-password")
                .await
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            login_call(app, "198.51.100.10", "alice", "correct-password")
                .await
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    #[tokio::test]
    async fn successful_login_resets_login_limiter() {
        let _serial = test_lock();
        setup();
        set_password("alice", "correct-password");
        let app = App::new();
        for _ in 0..2 {
            assert_eq!(
                login_call(app.clone(), "198.51.100.11", "alice", "wrong-password")
                    .await
                    .0,
                StatusCode::UNAUTHORIZED
            );
        }
        assert_eq!(
            login_call(app.clone(), "198.51.100.11", "alice", "correct-password")
                .await
                .0,
            StatusCode::OK
        );
        for _ in 0..(LOGIN_MAX_FAILED_ATTEMPTS - 1) {
            assert_eq!(
                login_call(app.clone(), "198.51.100.11", "alice", "wrong-password")
                    .await
                    .0,
                StatusCode::UNAUTHORIZED
            );
        }
        assert_eq!(
            login_call(app, "198.51.100.11", "alice", "wrong-password")
                .await
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    #[tokio::test]
    async fn login_limiter_enforces_each_key_without_locking_other_account_and_ip() {
        let _serial = test_lock();
        setup();
        set_password("alice", "alice-password");
        set_password("bob", "bob-password");
        let app = App::new();
        for _ in 0..LOGIN_MAX_FAILED_ATTEMPTS {
            let _ = login_call(app.clone(), "198.51.100.12", "alice", "wrong-password").await;
        }
        assert_eq!(
            login_call(app.clone(), "198.51.100.13", "alice", "alice-password")
                .await
                .0,
            StatusCode::TOO_MANY_REQUESTS,
            "account lock must survive an IP change"
        );
        assert_eq!(
            login_call(app.clone(), "198.51.100.12", "bob", "bob-password")
                .await
                .0,
            StatusCode::TOO_MANY_REQUESTS,
            "source IP lock must span accounts"
        );
        assert_eq!(
            login_call(app, "198.51.100.13", "bob", "bob-password")
                .await
                .0,
            StatusCode::OK,
            "different account and IP must remain available"
        );
    }

    /// The rights model and the account role are one admin notion, over HTTP too:
    /// a member account holding `Global.Superadmin` reaches the admin-only surface,
    /// and an ordinary member still does not.
    #[tokio::test]
    async fn superadmin_right_is_admin_over_http_as_well() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        // Bob is a plain `member` account, granted the global superadmin right.
        c.execute(
            "INSERT INTO roles(id,name) VALUES('r-super','Superadmin')",
            [],
        )
        .unwrap();
        c.execute("INSERT OR IGNORE INTO rights(id,code,title,right_type) VALUES('right-super','Global.Superadmin','Superadmin','Global')", []).unwrap();
        c.execute("INSERT INTO role_rights(role_id,right_id) SELECT 'r-super',id FROM rights WHERE code='Global.Superadmin'", []).unwrap();
        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type) VALUES('ra-super','r-super','pb','global')", []).unwrap();
        let role: String = c
            .query_row("SELECT role FROM users WHERE id='ub'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(role, "member", "the account column stays a plain member");

        let (status, _) = status_and_body(users(cookie("tb")).await.into_response()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "a Global.Superadmin is an admin on the HTTP path too"
        );
        // Alice holds no right and no admin role: still refused.
        let (status, _) = status_and_body(users(cookie("ta")).await.into_response()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "an ordinary member is never promoted"
        );

        // ...but being an admin is not the same as being allowed to mint one. The
        // account role is what grants the Superadmin right in the first place, so a
        // rights-only admin promoting an account would be its own escalation path.
        let (status, body) = status_and_body(
            patch_user(
                cookie("tb"),
                Path("ud".into()),
                Json(PatchUser {
                    display_name: None,
                    role: Some("admin".into()),
                    active: None,
                    password: None,
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "a rights-only admin cannot promote an account to admin: {body}"
        );
        let (status, _) = status_and_body(
            create_user(
                cookie("tb"),
                Json(CreateUser {
                    username: "mole".into(),
                    password: "mole-password".into(),
                    display_name: "Mole".into(),
                    role: "admin".into(),
                    profile_id: None,
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "nor create one");
        let role: String = c
            .query_row("SELECT role FROM users WHERE id='ud'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(role, "member", "dora was not promoted");

        // A rights-only admin keeps every other admin power, including member writes.
        let (status, _) = status_and_body(
            patch_user(
                cookie("tb"),
                Path("ud".into()),
                Json(PatchUser {
                    display_name: Some("Dora Renamed".into()),
                    role: Some("member".into()),
                    active: None,
                    password: None,
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "non-promoting admin writes still pass"
        );

        // An account admin mints admins as before.
        let (status, _) = status_and_body(
            patch_user(
                cookie("tc"),
                Path("ud".into()),
                Json(PatchUser {
                    display_name: None,
                    role: Some("admin".into()),
                    active: None,
                    password: None,
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "an account admin may still grant the role"
        );
    }

    #[tokio::test]
    async fn caldav_basic_auth_exports_only_the_requested_named_calendar() {
        let _serial = test_lock();
        setup();
        set_password("alice", "correct-horse-battery-staple");
        let c = db::conn().unwrap();
        c.execute("INSERT INTO calendars(id,profile_id,name,color,visible,created_at) VALUES('work','pa','Work','#2563eb',1,1),('private','pa','Private','#dc2626',1,1)", []).unwrap();
        c.execute("INSERT INTO calendar_feeds(id,profile_id,label,ics_url_sealed,calendar_id,created_at,event_count) VALUES('work-feed','pa','Work feed','sealed','work',1,1),('private-feed','pa','Private feed','sealed','private',1,1)", []).unwrap();
        c.execute("INSERT INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES('work-feed','work-uid','1704067200','Work planning',1704067200,1704070800,NULL),('private-feed','private-uid','1704153600','Private event',1704153600,NULL,NULL)", []).unwrap();
        drop(c);

        let denied = caldav_calendar(HeaderMap::new(), Method::GET, Path("work".into())).await;
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            denied.headers()[header::WWW_AUTHENTICATE],
            "Basic realm=\"gaia-space CalDAV\""
        );
        let collection = caldav_collection(
            basic("alice", "correct-horse-battery-staple"),
            Path("work".into()),
        )
        .await;
        assert_eq!(collection.status(), StatusCode::MULTI_STATUS);
        let collection_text = String::from_utf8(
            to_bytes(collection.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(collection_text.contains("/caldav/work/calendar.ics"));
        let calendar = caldav_calendar(
            basic("alice", "correct-horse-battery-staple"),
            Method::GET,
            Path("work".into()),
        )
        .await;
        assert_eq!(calendar.status(), StatusCode::OK);
        assert_eq!(
            calendar.headers()[header::CONTENT_TYPE],
            "text/calendar; charset=utf-8"
        );
        let ics = String::from_utf8(
            to_bytes(calendar.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(ics.contains("BEGIN:VCALENDAR\r\n") && ics.contains("BEGIN:VEVENT\r\n"));
        assert!(ics.contains("SUMMARY:Work planning"));
        assert!(
            !ics.contains("Private event"),
            "named calendar exports must stay separated"
        );
        let wrong_password =
            caldav_calendar(basic("alice", "wrong"), Method::GET, Path("work".into())).await;
        assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn caldav_put_delete_and_collection_discovery_are_profile_scoped() {
        let _serial = test_lock();
        setup();
        set_password("alice", "correct-horse-battery-staple");
        let c = db::conn().unwrap();
        c.execute("INSERT INTO calendars(id,profile_id,name,color,visible,created_at) VALUES('work','pa','Work','#2563eb',1,1),('private','pa','Private','#dc2626',1,1)", []).unwrap();
        drop(c);
        let auth = basic("alice", "correct-horse-battery-staple");
        let home = caldav_home(auth.clone()).await;
        let home_text =
            String::from_utf8(to_bytes(home.into_body(), 1 << 20).await.unwrap().to_vec()).unwrap();
        assert!(home_text.contains("/caldav/work/") && home_text.contains("/caldav/private/"));
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:write-1\r\nSUMMARY:Writable event\r\nDTSTART:20300102T030405Z\r\nDTEND:20300102T040405Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert_eq!(
            caldav_put_event(
                auth.clone(),
                Path(("work".into(), "write-1.ics".into())),
                ics.into()
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        let report = caldav_calendar(
            auth.clone(),
            Method::from_bytes(b"REPORT").unwrap(),
            Path("work".into()),
        )
        .await;
        let report = String::from_utf8(
            to_bytes(report.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(report.contains("/caldav/work/write-1.ics") && report.contains("<C:calendar/>"));
        let item =
            caldav_get_event(auth.clone(), Path(("work".into(), "write-1.ics".into()))).await;
        assert_eq!(item.status(), StatusCode::OK);
        let item =
            String::from_utf8(to_bytes(item.into_body(), 1 << 20).await.unwrap().to_vec()).unwrap();
        assert!(item.contains("UID:write-1\r\n") && item.contains("SUMMARY:Writable event"));
        let options = caldav_calendar(auth.clone(), Method::OPTIONS, Path("work".into())).await;
        assert_eq!(options.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            options.headers()[header::ALLOW],
            "GET, OPTIONS, PROPFIND, REPORT"
        );
        let exported = caldav_calendar(auth.clone(), Method::GET, Path("work".into())).await;
        let exported = String::from_utf8(
            to_bytes(exported.into_body(), 1 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(exported.contains("SUMMARY:Writable event") && !exported.contains("Private"));
        assert_eq!(
            caldav_delete_event(auth, Path(("work".into(), "write-1.ics".into())))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert!(!caldav_ics("pa", "work").unwrap().contains("Writable event"));
    }
    #[tokio::test]
    async fn calendar_feed_endpoints_bind_the_session_profile_and_refuse_foreign_feeds() {
        let _serial = test_lock();
        setup();
        // A real key is required to seal anything; a test-only constant is fine
        // here — this process' test binary never runs `secretbox::tests` (that
        // module lives in the separate `--lib` test binary), so there is no
        // cross-test race on the env var.
        std::env::set_var(gaia_space_lib::secretbox::KEY_ENV, "11".repeat(32));
        // Unauthenticated access is rejected before any command runs.
        let (status, _) = call(HeaderMap::new(), "list_calendar_feeds", json!({})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        // A malformed address is refused before anything is stored.
        let (status, value) = call(
            cookie("ta"),
            "save_calendar_feed",
            json!({"input":{"label":"Mine","ics_url":"not-a-url"}}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{value}");
        // Alice creates a feed; the server binds it to her own profile regardless
        // of what the client sends, and syncs it immediately. The address is
        // guaranteed (RFC 2606) never to resolve, so the fetch fails
        // deterministically — which must surface as a loud `last_error` on the
        // still-created row, never a hard command failure and never a silent one.
        let (status, value) = call(cookie("ta"), "save_calendar_feed", json!({"input":{"profile_id":"pb","label":"Mine","ics_url":"https://calendar.example.invalid/basic.ics"}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let feed = value["value"].clone();
        assert_eq!(
            feed["profile_id"],
            json!("pa"),
            "client-supplied owner must be ignored"
        );
        assert!(
            feed["last_error"].as_str().is_some(),
            "an unreachable address must fail loudly, not silently: {feed}"
        );
        let feed_id = feed["id"].as_str().unwrap().to_string();
        // The URL itself is never handed back to any client, sealed or otherwise.
        assert!(feed.get("ics_url").is_none());
        assert!(feed.get("ics_url_sealed").is_none());
        // Another profile cannot see, sync, or delete Alice's feed.
        let (status, value) = call(
            cookie("tb"),
            "list_calendar_feeds",
            json!({"profile_id":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            value["value"].as_array().unwrap().is_empty(),
            "a forged profile_id must not reveal another profile's feeds"
        );
        let (status, _) = call(cookie("tb"), "sync_calendar_feed", json!({"id":feed_id})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(cookie("tb"), "delete_calendar_feed", json!({"id":feed_id})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        // Unknown ids are answered identically, disclosing nothing.
        let (status, _) = call(
            cookie("tb"),
            "delete_calendar_feed",
            json!({"id":"no-such-feed"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        // The owner may sync and delete her own feed.
        let (status, value) = call(cookie("ta"), "sync_calendar_feed", json!({"id":feed_id})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let (status, _) = call(cookie("ta"), "delete_calendar_feed", json!({"id":feed_id})).await;
        assert_eq!(status, StatusCode::OK);
        let c = db::conn().unwrap();
        let left: i64 = c
            .query_row(
                "SELECT count(*) FROM calendar_feeds WHERE id=?1",
                [&feed_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
    }
    /// The notes log over HTTP: a member appends and reads, an outsider gets nothing, and
    /// a forged author buys nothing because the session identity is rebound before dispatch.
    #[tokio::test]
    async fn channel_note_endpoints_bind_the_author_and_refuse_outsiders() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('pr-n','Notes','NOTE','pa',1)", []).unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('pr-n','pb')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO channels(id,content_type,name,project_id,archived) VALUES('ch-n','public','Notes','pr-n',0)", []).unwrap();
        drop(c);

        let (status, _) = call(HeaderMap::new(), "list_channel_notes", json!({"channel_id":"ch-n"})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // Alice writes a decision while claiming Bob wrote it. The session wins.
        let (status, value) = call(
            cookie("ta"),
            "create_channel_note",
            json!({"input":{"channel_id":"ch-n","kind":"decision","body":"Ship on Friday","author_id":"pb"}}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let note = value["value"].clone();
        assert_eq!(note["author_id"], json!("pa"), "a forged author is replaced by the session");
        assert_eq!(note["project_id"], json!("pr-n"), "the project is read off the channel");
        assert!(note["edited_at"].is_null());
        let note_id = note["id"].as_str().unwrap().to_string();

        // A member reads the log; a non-member is refused, not given an empty list.
        let (status, value) =
            call(cookie("tb"), "list_channel_notes", json!({"channel_id":"ch-n"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"].as_array().unwrap().len(), 1);
        let (_, value) =
            call(cookie("td"), "list_channel_notes", json!({"channel_id":"ch-n"})).await;
        assert_eq!(value["ok"], json!(false), "an outsider is refused: {value}");

        // Only the author edits, and the edit is stamped.
        let mut foreign = note.clone();
        foreign["body"] = json!("Bob overrules");
        let (_, value) = call(cookie("tb"), "update_channel_note", json!({"note":foreign})).await;
        assert_eq!(value["ok"], json!(false), "a member is not an author: {value}");
        let mut own = note.clone();
        own["body"] = json!("Ship on Monday");
        let (status, value) = call(cookie("ta"), "update_channel_note", json!({"note":own})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["body"], json!("Ship on Monday"));
        assert!(
            value["value"]["edited_at"].as_i64().is_some(),
            "an edit is never silent: {value}"
        );

        // Deletion is the author's alone, and an unknown id is answered identically.
        let (status, _) =
            call(cookie("tb"), "delete_channel_note", json!({"id":&note_id})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) =
            call(cookie("tb"), "delete_channel_note", json!({"id":"no-such-note"})).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "an unknown id discloses nothing");
        let (status, value) =
            call(cookie("ta"), "delete_channel_note", json!({"id":&note_id})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let c = db::conn().unwrap();
        let left: i64 = c
            .query_row("SELECT count(*) FROM channel_notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn todo_endpoints_bind_the_session_profile_and_refuse_foreign_todos() {
        let _serial = test_lock();
        setup();
        // Unauthenticated access is rejected before any command runs.
        let (status, _) = call(HeaderMap::new(), "list_todos", json!({})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // Spoofed owner is replaced by the session profile; personal assignments are rejected.
        let (status, value) = call(cookie("ta"), "create_todo", json!({"input":{"profile_id":"pb","content":"Alice task","done":false,"assignee_ids":[]}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let todo = value["value"].clone();
        assert_eq!(
            todo["profile_id"],
            json!("pa"),
            "client-supplied owner must be ignored"
        );
        let todo_id = todo["id"].as_str().unwrap().to_string();

        // A forged profile id cannot reveal Alice's personal todo, even to an assignee.
        let (status, value) = call(
            cookie("tb"),
            "list_todos",
            json!({"profile_id":"pa","include_done":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["value"].as_array().unwrap().is_empty());
        let (status, value) = call(
            cookie("tb"),
            "dashboard_aggregate",
            json!({"profile_id":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["value"]["open_todos"].as_array().unwrap().is_empty());

        // Assignee is not an owner: no write, no delete.
        let mut foreign = todo.clone();
        foreign["content"] = json!("Hijacked");
        let (status, _) = call(cookie("tb"), "update_todo", json!({"todo":foreign})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(cookie("tb"), "delete_todo", json!({"id":todo_id})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        // Unknown ids are answered identically, disclosing nothing.
        let (status, _) = call(cookie("tb"), "delete_todo", json!({"id":"no-such-todo"})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        // Independent check: the row is untouched on disk.
        let c = db::conn().unwrap();
        let content: String = c
            .query_row("SELECT content FROM todos WHERE id=?1", [&todo_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(content, "Alice task");

        // The owner may edit, but cannot hand ownership to somebody else.
        let mut mine = todo.clone();
        mine["content"] = json!("Alice task v2");
        mine["profile_id"] = json!("pb");
        let (status, value) = call(cookie("ta"), "update_todo", json!({"todo":mine})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["profile_id"], json!("pa"));

        // Owner delete succeeds and leaves no junction rows behind.
        let (status, _) = call(cookie("ta"), "delete_todo", json!({"id":todo_id})).await;
        assert_eq!(status, StatusCode::OK);
        let orphans: i64 = c
            .query_row("SELECT count(*) FROM todo_assignees", [], |r| r.get(0))
            .unwrap();
        assert_eq!(orphans, 0);
    }

    #[tokio::test]
    async fn todo_scope_matrix_blocks_spoofs_and_allows_assignee_completion_only() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute_batch("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('group','Group','GROUP','pa',1); INSERT INTO project_members(project_id,profile_id) VALUES('group','pb');").unwrap();

        let (status, value) = call(cookie("ta"), "create_todo", json!({"input":{"profile_id":"pd","content":"Shared task","due_date":"2030-01-02","project_id":"group","done":false,"source_entity_type":null,"source_entity_id":null,"assignee_ids":["pb"]}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let shared = value["value"].clone();
        let id = shared["id"].as_str().unwrap().to_string();
        assert_eq!(
            shared["profile_id"],
            json!("pa"),
            "owner spoof must be bound to the session"
        );
        let (status, _) = call(cookie("td"), "create_todo", json!({"input":{"profile_id":"td","content":"Injected task","project_id":"group","done":false,"assignee_ids":[]}})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let count: i64 = c
            .query_row(
                "SELECT count(*) FROM todos WHERE project_id='group'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "denied project task creation must not persist a row"
        );

        // Legacy personal assignments stay private; the next write will reject them.
        c.execute_batch("INSERT INTO todos(id,profile_id,content) VALUES('legacy-personal','pa','Private legacy'); INSERT INTO todo_assignees(todo_id,profile_id) VALUES('legacy-personal','pb');").unwrap();

        // Non-member: neither a list nor dashboard/calendar aggregate exposes the task.
        let (status, value) = call(
            cookie("td"),
            "list_todos",
            json!({"profile_id":"pa","include_done":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["value"].as_array().unwrap().is_empty());
        let (status, value) = call(
            cookie("td"),
            "dashboard_aggregate",
            json!({"profile_id":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["value"]["open_todos"].as_array().unwrap().is_empty());
        let (status, value) = call(
            cookie("td"),
            "calendar_aggregate",
            json!({"profile_id":"pa","range_start":1893456000,"range_end":1893715200}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["value"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["id"].as_str() != Some(id.as_str())));
        let (status, value) = call(
            cookie("td"),
            "list_project_todos",
            json!({"project_id":"group","include_done":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["value"].as_array().unwrap().is_empty());

        // Assignee reads the group task, never the other user's personal todo, and can
        // only use the explicit completion path.
        let (status, value) = call(
            cookie("tb"),
            "list_todos",
            json!({"profile_id":"pa","include_done":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["value"][0]["id"], json!(id));
        assert!(value["value"]
            .as_array()
            .unwrap()
            .iter()
            .all(|todo| todo["id"].as_str() != Some("legacy-personal")));
        let (status, value) = call(
            cookie("tb"),
            "list_project_todos",
            json!({"project_id":"group","include_done":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["value"][0]["id"], json!(id));
        let (status, value) = call(
            cookie("tb"),
            "set_todo_completion",
            json!({"id":id,"done":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let mut forged = shared.clone();
        forged["content"] = json!("Bob rewrote this");
        let (status, _) = call(cookie("tb"), "update_todo", json!({"todo":forged})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        // New personal assignments and non-member group assignments fail loudly.
        let (status, value) = call(cookie("ta"), "create_todo", json!({"input":{"profile_id":"pd","content":"Private","done":false,"assignee_ids":["pb"]}})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            value["error"]
                .as_str()
                .unwrap_or_default()
                .contains("assignment requires a project todo"),
            "{value}"
        );
        let (status, value) = call(cookie("ta"), "create_todo", json!({"input":{"profile_id":"pd","content":"Bad assignment","project_id":"group","done":false,"assignee_ids":["pd"]}})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(value["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Assignee must be a project member"));
    }

    #[tokio::test]
    async fn notification_endpoints_bind_the_recipient_and_refuse_foreign_writes() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO notifications(id,recipient_id,event_type,title) VALUES('alice-notification','pa','todo.due','Alice only')", []).unwrap();
        let (status, value) = call(
            cookie("tb"),
            "list_notifications",
            json!({"recipient_id":"pa","unread_only":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["value"].as_array().unwrap().is_empty());
        let (status, _) = call(
            cookie("tb"),
            "mark_notification_read",
            json!({"id":"alice-notification"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let read_at: Option<i64> = c
            .query_row(
                "SELECT read_at FROM notifications WHERE id='alice-notification'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(read_at, None);
    }

    #[tokio::test]
    async fn document_sharing_grants_person_view_and_team_editor_without_acl_delegation() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO teams(id,name) VALUES('design','Design')", [])
            .unwrap();
        c.execute("INSERT INTO team_memberships(id,profile_id,team_id) VALUES('design-dora','pd','design')", []).unwrap();
        let document = json!({"id":"shared-private-doc","container_type":"my-docs","container_id":"pa","folder_id":null,"doc_type":"text","title":"Shared plan","body":"first","version":1,"archived":false,"created_by":"pa"});
        let (status, value) = call(
            cookie("ta"),
            "create_document",
            json!({"document":document}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");

        let grants = json!({"document_id":"shared-private-doc","permissions":[
            {"recipient_type":"profile","member_id":"pb","access_level":"viewer"},
            {"recipient_type":"team","recipient_id":"design","access_level":"editor"}
        ]});
        let (status, value) = call(cookie("ta"), "update_document_access", grants).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let grant_count: i64 = c
            .query_row(
                "SELECT count(*) FROM document_permissions WHERE document_id='shared-private-doc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(grant_count, 2, "shares persisted");
        let (stored_container, stored_creator, grant_profile): (String, String, String) = c.query_row("SELECT d.container_type,d.created_by,dp.recipient_id FROM documents d JOIN document_permissions dp ON dp.document_id=d.id WHERE d.id='shared-private-doc' AND dp.recipient_type='profile'", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert_eq!(
            (
                stored_container.as_str(),
                stored_creator.as_str(),
                grant_profile.as_str()
            ),
            ("my-docs", "pa", "pb")
        );
        assert!(
            documents::document_readable_by("shared-private-doc", "pb").unwrap(),
            "direct viewer grant resolves"
        );

        let (status, value) = call(cookie("tb"), "list_documents", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            value["value"][0]["id"],
            json!("shared-private-doc"),
            "{value}"
        );
        let (status, value) = call(
            cookie("tb"),
            "list_document_access",
            json!({"document_id":"shared-private-doc"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"].as_array().unwrap().len(), 2);
        let (status, _) = call(
            cookie("tb"),
            "save_document",
            json!({"id":"shared-private-doc","title":"stolen","body":"no","actor":"pb"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "a viewer cannot edit");
        let (status, _) = call(
            cookie("tb"),
            "update_document_access",
            json!({"document_id":"shared-private-doc","permissions":[]}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "an editor/viewer cannot delegate sharing"
        );

        let (status, value) = call(
            cookie("td"),
            "save_document",
            json!({"id":"shared-private-doc","title":"Team plan","body":"edited","actor":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["body"], json!("edited"));
        let (status, _) = call(cookie("td"), "move_document", json!({"id":"shared-private-doc","container_type":"my-docs","container_id":"pd","folder_id":null})).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "an editor cannot move a shared document"
        );
        let actor: String = c.query_row("SELECT created_by FROM doc_versions WHERE document_id='shared-private-doc' AND version=2", [], |row| row.get(0)).unwrap();
        assert_eq!(actor, "pd", "the web gateway binds the editor identity");
    }

    #[tokio::test]
    async fn document_and_meeting_scopes_block_private_leaks_and_rebind_identity() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        let private_document = json!({"id":"alice-private-doc","container_type":"my-docs","container_id":"pb","folder_id":null,"doc_type":"text","title":"Alice private","body":"secret","version":1,"archived":false,"created_by":"pd"});
        let (status, value) = call(
            cookie("ta"),
            "create_document",
            json!({"document":private_document}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let stored: (String, String) = c
            .query_row(
                "SELECT created_by,container_id FROM documents WHERE id='alice-private-doc'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            ("pa".into(), "pa".into()),
            "creator and personal container are session-bound"
        );

        // Every private-document read/write surface gives Bob no access.
        let (status, value) = call(cookie("tb"), "list_documents", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["value"].as_array().unwrap().is_empty());
        let (status, value) = call(
            cookie("tb"),
            "goto_search",
            json!({"query":"Alice private","limit":10}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            value["value"].as_array().unwrap().is_empty(),
            "search must not leak private documents"
        );
        for (command, body) in [
            ("get_document", json!({"id":"alice-private-doc"})),
            (
                "list_doc_versions",
                json!({"document_id":"alice-private-doc"}),
            ),
            (
                "update_document",
                json!({"document":{"id":"alice-private-doc","container_type":"my-docs","container_id":"pb","folder_id":null,"doc_type":"text","title":"stolen","body":"secret","version":1,"archived":false,"created_by":"pb"}}),
            ),
            (
                "move_document",
                json!({"id":"alice-private-doc","container_type":"my-docs","container_id":"pb","folder_id":null}),
            ),
            (
                "archive_document",
                json!({"id":"alice-private-doc","archived":true}),
            ),
            (
                "save_document",
                json!({"id":"alice-private-doc","title":"stolen","body":"stolen","actor":"pb"}),
            ),
            (
                "restore_doc_version",
                json!({"document_id":"alice-private-doc","version":1,"actor":"pb"}),
            ),
            ("delete_document", json!({"id":"alice-private-doc"})),
        ] {
            let (status, _) = call(cookie("tb"), command, body).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{command}");
        }
        let unchanged: (String, bool) = c
            .query_row(
                "SELECT body,archived FROM documents WHERE id='alice-private-doc'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(unchanged, ("secret".into(), false));

        // Owner save works; a forged actor becomes the session profile in the immutable version row.
        let (status, value) = call(cookie("ta"), "save_document", json!({"id":"alice-private-doc","title":"Alice private v2","body":"secret v2","actor":"pb"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let actor: String = c.query_row("SELECT created_by FROM doc_versions WHERE document_id='alice-private-doc' AND version=2", [], |row| row.get(0)).unwrap();
        assert_eq!(actor, "pa");
        let (status, _) = call(
            cookie("ta"),
            "delete_document",
            json!({"id":"alice-private-doc"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "owner can delete private document");

        let private_meeting = json!({"id":"alice-private-meeting","title":"Alice private","description":null,"starts_at":100,"ends_at":200,"rrule":null,"location":null,"organizer_id":"pd","channel_id":null,"archived":false});
        let (status, value) = call(
            cookie("ta"),
            "create_meeting",
            json!({"meeting":private_meeting}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let organizer: String = c
            .query_row(
                "SELECT organizer_id FROM meetings WHERE id='alice-private-meeting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(organizer, "pa", "forged organizer must never persist");
        let (status, value) = call(cookie("tb"), "list_meetings", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["value"].as_array().unwrap().is_empty());
        let (status, value) = call(
            cookie("tb"),
            "goto_search",
            json!({"query":"Alice private","limit":10}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            value["value"].as_array().unwrap().is_empty(),
            "search must not leak private meetings"
        );
        for (command, body) in [
            ("get_meeting", json!({"id":"alice-private-meeting"})),
            (
                "list_meeting_participants",
                json!({"meeting_id":"alice-private-meeting"}),
            ),
            (
                "update_meeting",
                json!({"meeting":{"id":"alice-private-meeting","title":"stolen","description":null,"starts_at":100,"ends_at":200,"rrule":null,"location":null,"organizer_id":"pb","channel_id":null,"archived":false}}),
            ),
            (
                "archive_meeting",
                json!({"id":"alice-private-meeting","archived":true}),
            ),
            ("delete_meeting", json!({"id":"alice-private-meeting"})),
            (
                "invite_meeting_participant",
                json!({"meeting_id":"alice-private-meeting","profile_id":"pa"}),
            ),
            (
                "set_meeting_participant_status",
                json!({"meeting_id":"alice-private-meeting","profile_id":"pa","status":"accepted"}),
            ),
        ] {
            let (status, _) = call(cookie("tb"), command, body).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{command}");
        }
        c.execute_batch("INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,archived) VALUES('shared-rsvp','Shared RSVP',100,200,'pa',0); INSERT INTO meeting_participants(meeting_id,profile_id,status) VALUES('shared-rsvp','pb','invited')").unwrap();
        let (status, _) = call(
            cookie("tb"),
            "set_meeting_participant_status",
            json!({"meeting_id":"shared-rsvp","profile_id":"pa","status":"accepted"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "an attendee cannot alter another RSVP"
        );
        let (status, _) = call(
            cookie("tb"),
            "set_meeting_participant_status",
            json!({"meeting_id":"shared-rsvp","profile_id":"pb","status":"accepted"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "an attendee may accept their own RSVP"
        );
        let (status, _) = call(
            cookie("ta"),
            "set_meeting_participant_status",
            json!({"meeting_id":"shared-rsvp","profile_id":"pb","status":"declined"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "the organizer may moderate another RSVP"
        );
        c.execute(
            "DELETE FROM meeting_participants WHERE meeting_id='shared-rsvp'",
            [],
        )
        .unwrap();
        c.execute("DELETE FROM meetings WHERE id='shared-rsvp'", [])
            .unwrap();
        let unchanged: (String, bool) = c
            .query_row(
                "SELECT title,archived FROM meetings WHERE id='alice-private-meeting'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(unchanged, ("Alice private".into(), false));
        let (status, _) = call(
            cookie("ta"),
            "delete_meeting",
            json!({"id":"alice-private-meeting"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "organizer can delete private meeting"
        );

        // Project attachment grants Bob read access, while writes stay with the document
        // owner / project creator. The meeting derives its group scope from its channel.
        c.execute_batch("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('group','Group','GROUP','pa',1); INSERT INTO project_members(project_id,profile_id) VALUES('group','pb'); INSERT INTO channels(id,content_type,name,project_id) VALUES('group-channel','entity-bound','Group channel','group');").unwrap();
        let group_document = json!({"id":"group-doc","container_type":"project","container_id":"group","folder_id":null,"doc_type":"text","title":"Group document","body":"shared","version":1,"archived":false,"created_by":"pd"});
        let (status, _) = call(
            cookie("ta"),
            "create_document",
            json!({"document":group_document}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, value) = call(cookie("tb"), "list_documents", json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["value"][0]["id"], json!("group-doc"));
        let (status, _) = call(cookie("tb"), "get_document", json!({"id":"group-doc"})).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "project member can read project document"
        );
        let (status, _) = call(
            cookie("tb"),
            "archive_document",
            json!({"id":"group-doc","archived":true}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "member is not the project admin or document owner"
        );

        let group_meeting = json!({"id":"group-meeting","title":"Group meeting","description":null,"starts_at":300,"ends_at":400,"rrule":null,"location":null,"organizer_id":"pd","channel_id":"group-channel","archived":false});
        let (status, _) = call(
            cookie("ta"),
            "create_meeting",
            json!({"meeting":group_meeting}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, value) = call(cookie("tb"), "list_meetings", json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["value"][0]["id"], json!("group-meeting"));
        let (status, _) = call(cookie("tb"), "get_meeting", json!({"id":"group-meeting"})).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "project member can read project meeting"
        );
        let (status, value) = call(cookie("ta"), "update_meeting", json!({"meeting":{"id":"group-meeting","title":"Updated group meeting","description":null,"starts_at":300,"ends_at":400,"rrule":null,"location":null,"organizer_id":"pb","channel_id":"group-channel","archived":false}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let organizer: String = c
            .query_row(
                "SELECT organizer_id FROM meetings WHERE id='group-meeting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            organizer, "pa",
            "updates cannot transfer organizer identity"
        );
    }

    #[tokio::test]
    async fn command_policy_binds_project_identity_and_enforces_ownership() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,created_at) VALUES('admin-project','Admin project','ADMIN',NULL,'pc',0,1)", []).unwrap();

        let (status, value) = call(cookie("ta"), "create_project", json!({"project":{"id":"alice-project","name":"Alice project","key":"ALICE","description":null,"created_by":"pc","archived":false}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let owner: String = c
            .query_row(
                "SELECT created_by FROM projects WHERE id='alice-project'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, "pa");

        for archived in [false, true] {
            let (status, _) = call(cookie("ta"), "update_project", json!({"project":{"id":"admin-project","name":"Hijacked","key":"ADMIN","description":null,"created_by":"pa","archived":archived}})).await;
            assert_eq!(status, StatusCode::FORBIDDEN);
        }
        let unchanged: (String, bool) = c
            .query_row(
                "SELECT name,archived FROM projects WHERE id='admin-project'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(unchanged, ("Admin project".into(), false));

        let (status, value) = call(cookie("ta"), "update_project", json!({"project":{"id":"alice-project","name":"Alice renamed","key":"ALICE","description":null,"created_by":"pc","archived":true}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let changed: (String, String, bool) = c
            .query_row(
                "SELECT name,created_by,archived FROM projects WHERE id='alice-project'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(changed, ("Alice renamed".into(), "pa".into(), true));

        // Calendar session identity is injected at the chokepoint; callers cannot
        // enumerate another profile's todos by supplying a forged profile id.
        c.execute("INSERT INTO todos(id,profile_id,content,due_date) VALUES('alice-calendar','pa','Private','2030-01-02')", []).unwrap();
        let (status, value) = call(
            cookie("tb"),
            "calendar_aggregate",
            json!({"profile_id":"pa","range_start":1893456000,"range_end":1893715200}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["value"].as_array().unwrap().is_empty());
        let (status, value) = call(
            cookie("tb"),
            "list_project_todos",
            json!({"project_id":"alice-project","include_done":false}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            value["value"].as_array().unwrap().is_empty(),
            "non-members receive no project todos"
        );
        let (status, _) = call(cookie("ta"), "invent_a_backdoor", json!({})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn dashboard_preferences_http_binds_profile_to_session() {
        let _serial = test_lock();
        setup();
        let (status, value) = call(
            cookie("ta"),
            "set_dashboard_preferences",
            json!({"preferences":{"profile_id":"pb","hidden_widgets":["calendar"],"initialized":true}}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["profile_id"], json!("pa"));
        let (status, value) = call(
            cookie("tb"),
            "get_dashboard_preferences",
            json!({"profile_id":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["profile_id"], json!("pb"));
        assert_eq!(value["value"]["hidden_widgets"], json!([]));
    }

    #[tokio::test]
    async fn created_projects_are_owned_by_the_session_never_by_the_payload() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();

        // Bob forges Alice as owner; the server mints ownership from his session.
        let (status, value) = call(cookie("tb"), "create_project", json!({"project":{"id":"forged-p","name":"Forged","key":"FRG","description":null,"created_by":"pa","archived":false,"deadline":null}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let owner: Option<String> = c
            .query_row(
                "SELECT created_by FROM projects WHERE id='forged-p'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            owner.as_deref(),
            Some("pb"),
            "the session owns the project, not the payload"
        );

        // A payload with no owner at all is still owned by its creator.
        let (status, value) = call(cookie("tb"), "create_project", json!({"project":{"id":"plain-p","name":"Plain","key":"PLN","description":null,"archived":false,"deadline":null}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let owner: Option<String> = c
            .query_row(
                "SELECT created_by FROM projects WHERE id='plain-p'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(owner.as_deref(), Some("pb"));

        // And the forged owner cannot then drive the narrow deadline path.
        let (status, _) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"forged-p","deadline":"2030-01-01"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    /// The other half of the forgery: whoever actually created the row owns it,
    /// and ownership is what the narrow deadline gate reads. A member who claims
    /// the admin as owner keeps the first write; the named admin gains nothing.
    #[tokio::test]
    async fn the_forging_creator_keeps_the_first_deadline_write_and_the_named_owner_gains_nothing()
    {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();

        // Bob (member) creates, naming Alice (another member) as owner.
        let (status, value) = call(cookie("tb"), "create_project", json!({"project":{"id":"claimed-p","name":"Claimed","key":"CLM","description":null,"created_by":"pa","archived":false,"deadline":null}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");

        // 2. The real creator drives the deadline path he could not have reached
        //    had the payload owner been believed.
        let (status, value) = call(
            cookie("tb"),
            "set_project_deadline",
            json!({"project_id":"claimed-p","deadline":"2030-05-05"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!("2030-05-05"));

        // 3. The impersonated profile owns nothing: not this project, not any.
        let owned: i64 = c
            .query_row(
                "SELECT count(*) FROM projects WHERE created_by='pa'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(owned, 0, "the named owner was never made an owner");
        let (status, _) = call(cookie("ta"), "update_project", json!({"project":{"id":"claimed-p","name":"Stolen","key":"CLM","description":null,"created_by":"pa","archived":false}})).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "an impersonated owner cannot write the project"
        );
        let name: String = c
            .query_row("SELECT name FROM projects WHERE id='claimed-p'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(name, "Claimed");
    }

    /// 4. The admin route, stated separately: an admin's own creations are minted
    /// from the admin session exactly like anyone else's — the role widens what
    /// may be *written*, never who is recorded as the *creator*.
    #[tokio::test]
    async fn the_admin_route_mints_ownership_from_the_admin_session_too() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();

        let (status, value) = call(cookie("tc"), "create_project", json!({"project":{"id":"admin-made","name":"Admin made","key":"AMD","description":null,"created_by":"pb","archived":false,"deadline":null}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let owner: Option<String> = c
            .query_row(
                "SELECT created_by FROM projects WHERE id='admin-made'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            owner.as_deref(),
            Some("pc"),
            "the admin session owns it, not the payload's member"
        );

        // The member named in the payload is not an owner and cannot write it.
        let (status, _) = call(cookie("tb"), "update_project", json!({"project":{"id":"admin-made","name":"Taken","key":"AMD","description":null,"created_by":"pb","archived":false}})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        // The admin reaches a member's project by role, not by ownership.
        let (status, value) = call(cookie("tb"), "create_project", json!({"project":{"id":"bob-made","name":"Bob made","key":"BMD","description":null,"archived":false,"deadline":null}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let (status, value) = call(
            cookie("tc"),
            "set_project_deadline",
            json!({"project_id":"bob-made","deadline":"2031-01-01"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let owner: Option<String> = c
            .query_row(
                "SELECT created_by FROM projects WHERE id='bob-made'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            owner.as_deref(),
            Some("pb"),
            "an admin write does not transfer ownership"
        );
    }
    #[tokio::test]
    async fn project_deadline_writes_are_owner_or_admin_only_and_never_overwrite_the_project() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,created_at) VALUES('alice-p','Alice project','ALICE','Keep me','pa',0,1)", []).unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('alice-p','pb')",
            [],
        )
        .unwrap();

        // First write: the owner sets a deadline that was never set before.
        let (status, value) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":"2030-03-10"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!("2030-03-10"));

        // A project member is not an owner: refused, and the stored row is untouched.
        let (status, _) = call(
            cookie("tb"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":"2031-01-01"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(
            cookie("td"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":"2031-01-01"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let stored: (String, Option<String>, String) = c
            .query_row(
                "SELECT name,deadline,created_by FROM projects WHERE id='alice-p'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            (
                "Alice project".into(),
                Some("2030-03-10".into()),
                "pa".into()
            )
        );

        // Malformed dates never reach the column.
        let (status, _) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":"10/03/2030"}),
        )
        .await;
        assert_ne!(status, StatusCode::OK);

        // First-write law: an existing deadline is never overwritten, not even by
        // the owner, and a stale payload cannot ride other columns along with it.
        let (status, value) = call(cookie("ta"), "set_project_deadline", json!({"project_id":"alice-p","deadline":"2030-04-02","name":"Hijacked","created_by":"pb","description":null})).await;
        assert_ne!(
            status,
            StatusCode::OK,
            "overwriting an existing deadline must be refused: {value}"
        );
        let after: (String, Option<String>, Option<String>, String) = c
            .query_row(
                "SELECT name,description,deadline,created_by FROM projects WHERE id='alice-p'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            after,
            (
                "Alice project".into(),
                Some("Keep me".into()),
                Some("2030-03-10".into()),
                "pa".into()
            ),
            "only the deadline column may move, and only into an empty one"
        );

        // Not even the admin may overwrite a deadline that is already there.
        let (status, value) = call(
            cookie("tc"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":"2030-04-03"}),
        )
        .await;
        assert_ne!(
            status,
            StatusCode::OK,
            "admins obey the first-write law too: {value}"
        );

        // The member sees the owner's deadline on the calendar.
        let (status, value) = call(cookie("tb"), "calendar_aggregate", json!({"profile_id":"pb","range_start":1900000000,"range_end":1902000000,"range_start_date":"2030-03-01","range_end_date":"2030-04-01"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            value["value"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == json!("deadline-alice-p")
                    && item["kind"] == json!("deadline")),
            "member calendar shows the project deadline: {value}"
        );

        // Clearing is explicit and allowed for the owner, and only after clearing
        // does the column accept a new first write.
        let (status, value) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":null}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!(null));
        let (status, value) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"alice-p","deadline":"2030-04-02"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!("2030-04-02"));
    }

    /// Editing an existing deadline over HTTP: same owner-or-admin gate, compare-and-set
    /// body, and an unknown project answers exactly like a project you may not touch.
    #[tokio::test]
    async fn project_deadline_edits_are_owner_or_admin_only_and_refuse_stale_expectations() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,description,created_by,archived,created_at) VALUES('edit-p','Edit project','EDT','Keep me','pa',0,1)", []).unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('edit-p','pb')",
            [],
        )
        .unwrap();
        let (status, _) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"edit-p","deadline":"2030-03-10"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        // The owner edits against what the screen showed: it lands, nothing else moves.
        let (status, value) = call(cookie("ta"), "update_project_deadline", json!({"project_id":"edit-p","expected_deadline":"2030-03-10","deadline":"2030-06-01","name":"Hijacked","created_by":"pb"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!("2030-06-01"));
        let row: (String, Option<String>, String) = c
            .query_row(
                "SELECT name,description,created_by FROM projects WHERE id='edit-p'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            ("Edit project".into(), Some("Keep me".into()), "pa".into()),
            "a stale payload rides nothing along"
        );

        // A member and a stranger are both refused, and the row stands.
        for who in ["tb", "td"] {
            let (status, value) = call(cookie(who), "update_project_deadline", json!({"project_id":"edit-p","expected_deadline":"2030-06-01","deadline":"2031-01-01"})).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{who} may not edit this deadline: {value}"
            );
        }
        let held: Option<String> = c
            .query_row("SELECT deadline FROM projects WHERE id='edit-p'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(held.as_deref(), Some("2030-06-01"));

        // A stale expectation is refused for the owner too — the concurrent value wins.
        let (status, value) = call(
            cookie("ta"),
            "update_project_deadline",
            json!({"project_id":"edit-p","expected_deadline":"2030-03-10","deadline":"2031-02-02"}),
        )
        .await;
        assert_ne!(status, StatusCode::OK, "a stale edit must not win: {value}");
        let held: Option<String> = c
            .query_row("SELECT deadline FROM projects WHERE id='edit-p'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(held.as_deref(), Some("2030-06-01"));

        // An unknown project is indistinguishable from one you may not touch: same 403,
        // same words, no hint about whether the row exists.
        let (ghost_status, ghost_value) = call(cookie("ta"), "update_project_deadline", json!({"project_id":"no-such-project","expected_deadline":null,"deadline":"2030-01-01"})).await;
        let (foreign_status, foreign_value) = call(
            cookie("tb"),
            "update_project_deadline",
            json!({"project_id":"edit-p","expected_deadline":null,"deadline":"2030-01-01"}),
        )
        .await;
        assert_eq!(ghost_status, StatusCode::FORBIDDEN);
        assert_eq!(ghost_status, foreign_status);
        assert_eq!(
            ghost_value["error"], foreign_value["error"],
            "an unknown id must not read differently from a forbidden one"
        );

        // The admin may edit, and clearing is an edit like any other.
        let (status, value) = call(
            cookie("tc"),
            "update_project_deadline",
            json!({"project_id":"edit-p","expected_deadline":"2030-06-01","deadline":null}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!(null));
        // The first-write law still holds on the other door after a clear.
        let (status, value) = call(
            cookie("ta"),
            "set_project_deadline",
            json!({"project_id":"edit-p","deadline":"2030-07-07"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["deadline"], json!("2030-07-07"));
    }

    #[tokio::test]
    async fn meeting_and_document_identity_writes_rebind_the_session_profile() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();

        let (status, value) = call(cookie("ta"), "create_meeting", json!({"meeting":{"id":"identity-meeting","title":"Alice meeting","description":null,"starts_at":1893456000,"ends_at":1893459600,"rrule":null,"location":null,"organizer_id":"pb","channel_id":null,"archived":false}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let organizer: Option<String> = c
            .query_row(
                "SELECT organizer_id FROM meetings WHERE id='identity-meeting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(organizer.as_deref(), Some("pa"));

        let (status, value) = call(cookie("ta"), "create_document", json!({"document":{"id":"identity-document","container_type":"my-docs","container_id":"pa","folder_id":null,"doc_type":"text","title":"Alice document","body":"first","version":1,"archived":false,"created_by":"pb"}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let creator: Option<String> = c
            .query_row(
                "SELECT created_by FROM documents WHERE id='identity-document'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(creator.as_deref(), Some("pa"));

        let (status, value) = call(
            cookie("ta"),
            "save_document",
            json!({"id":"identity-document","title":"Alice document","body":"second","actor":"pb"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let (status, value) = call(
            cookie("ta"),
            "restore_doc_version",
            json!({"document_id":"identity-document","version":1,"actor":"pb"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let authors: Vec<Option<String>> = c.prepare("SELECT created_by FROM doc_versions WHERE document_id='identity-document' ORDER BY version").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(
            authors,
            vec![Some("pa".into()), Some("pa".into()), Some("pa".into())]
        );
    }

    /// Reads the stored row as an independent check: assertions above run through the HTTP
    /// surface, this one goes straight to SQLite, so a policy bug cannot hide behind the
    /// same code path twice.
    fn stored_absence(id: &str) -> Option<(String, String, bool)> {
        db::conn()
            .unwrap()
            .query_row(
                "SELECT profile_id,reason_type,approved FROM absences WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .unwrap()
    }

    fn seed_absence(id: &str, profile_id: &str, approved: bool) {
        db::conn().unwrap().execute(
            "INSERT INTO absences(id,profile_id,reason_type,date_from,date_to,approved) VALUES(?1,?2,'vacation','2031-03-01','2031-03-05',?3)",
            params![id, profile_id, approved],
        ).unwrap();
    }

    fn absence_payload(id: &str, profile_id: &str, reason_type: &str, approved: bool) -> Value {
        json!({"id":id,"profile_id":profile_id,"reason_type":reason_type,"date_from":"2031-03-01","date_to":"2031-03-05","approved":approved})
    }

    #[tokio::test]
    async fn member_absence_creation_is_bound_to_the_session_and_lands_unapproved() {
        let _serial = test_lock();
        setup();
        // Alice forges Bob's profile and pre-approval is absent: the row must still be hers.
        let (status, value) = call(
            cookie("ta"),
            "create_absence",
            json!({"input":absence_payload("absence-alice-own", "pb", "parental leave", false)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            value["value"]["profile_id"],
            json!("pa"),
            "client-supplied owner must be replaced by the session profile"
        );
        assert_eq!(value["value"]["approved"], json!(false));
        assert_eq!(
            stored_absence("absence-alice-own"),
            Some(("pa".into(), "parental leave".into(), false))
        );
    }

    #[tokio::test]
    async fn member_cannot_self_approve_on_create_or_update_and_the_row_is_untouched() {
        let _serial = test_lock();
        setup();
        // Creating an already-approved absence is an approval act, so it is refused outright.
        let (status, _) = call(
            cookie("ta"),
            "create_absence",
            json!({"input":absence_payload("absence-self-approved", "pa", "sick", true)}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored_absence("absence-self-approved"),
            None,
            "a refused create must write nothing"
        );
        // Flipping the flag on an existing own row is refused as well, with the row intact.
        seed_absence("absence-alice-pending", "pa", false);
        let (status, _) = call(
            cookie("ta"),
            "update_absence",
            json!({"absence":absence_payload("absence-alice-pending", "pa", "vacation", true)}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored_absence("absence-alice-pending"),
            Some(("pa".into(), "vacation".into(), false)),
            "database must be unchanged after a refused approval"
        );
        // The same row remains editable as long as `approved` keeps its stored value.
        let (status, value) = call(cookie("ta"), "update_absence", json!({"absence":absence_payload("absence-alice-pending", "pa", "unpaid leave", false)})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            stored_absence("absence-alice-pending"),
            Some(("pa".into(), "unpaid leave".into(), false))
        );
    }

    /// Check and write are two moments. A member request authorized while the row was still
    /// pending must not be able to un-approve it when an admin approves inside that window:
    /// the member write must never touch the `approved` column at all.
    #[tokio::test]
    async fn audit_member_stale_update_cannot_revoke_concurrent_admin_approval() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-race", "pa", false);
        let member = user_by_token(&cookie("ta")).unwrap();
        let mut body = json!({"absence": absence_payload("absence-race", "pa", "vacation", false)});
        authorize_command(&member, "update_absence", &mut body)
            .expect("a member may edit their own pending row");
        // Window: the admin approves after the check passed, before the member write lands.
        let (status, value) = call(
            cookie("tc"),
            "update_absence",
            json!({"absence":absence_payload("absence-race", "pa", "vacation", true)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            stored_absence("absence-race"),
            Some(("pa".into(), "vacation".into(), true))
        );
        // The already-authorized member write now executes with its stale payload.
        let status = absence_update(&member, &body).status();
        assert_eq!(status, StatusCode::OK);
        assert!(
            stored_absence("absence-race").unwrap().2,
            "a member write must not revoke an approval"
        );
    }

    /// Ownership is a two-moment problem too. A member update authorized while it still owned
    /// the row must not land after an admin moved that row to another profile: the write itself
    /// carries `AND profile_id=?`, so the transferred row is untouched and the answer is 403.
    #[tokio::test]
    async fn audit_member_stale_update_cannot_follow_an_admin_owner_transfer() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-transfer", "pa", false);
        let member = user_by_token(&cookie("ta")).unwrap();
        let mut body =
            json!({"absence": absence_payload("absence-transfer", "pa", "vacation", false)});
        authorize_command(&member, "update_absence", &mut body)
            .expect("a member may edit their own row");
        // Window: the admin transfers the row to Bob after the member's check passed.
        let (status, value) = call(
            cookie("tc"),
            "update_absence",
            json!({"absence":absence_payload("absence-transfer", "pb", "admin moved", false)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            stored_absence("absence-transfer"),
            Some(("pb".into(), "admin moved".into(), false))
        );
        // The stale member write now executes and must refuse against the foreign row.
        let status = absence_update(&member, &body).status();
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "a stale member write must not reach a transferred row"
        );
        assert_eq!(
            stored_absence("absence-transfer"),
            Some(("pb".into(), "admin moved".into(), false)),
            "the transferred row must stay byte-identical"
        );
    }

    /// The same window around a delete: the id a member was authorized for can be destroyed and
    /// recreated for somebody else inside it. Identity of the id is not identity of the row.
    #[tokio::test]
    async fn audit_member_stale_delete_cannot_hit_a_recreated_foreign_row() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-recreated", "pa", false);
        let member = user_by_token(&cookie("ta")).unwrap();
        let mut body = json!({"id":"absence-recreated"});
        authorize_command(&member, "delete_absence", &mut body)
            .expect("a member may delete their own row");
        // Window: the admin deletes the row and recreates the same id for Bob.
        let (status, value) = call(
            cookie("tc"),
            "delete_absence",
            json!({"id":"absence-recreated"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        seed_absence("absence-recreated", "pb", true);
        // The stale member delete now executes against an id that is no longer theirs.
        let status = absence_delete(&member, &body).status();
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "a stale member delete must not hit a recreated row"
        );
        assert_eq!(
            stored_absence("absence-recreated"),
            Some(("pb".into(), "vacation".into(), true)),
            "the recreated foreign row must survive"
        );
    }

    /// Third moment: the response. Even an ownership-scoped write leaks if the row it answers
    /// with is read back by id alone, because an admin transfer can land between write and
    /// readback. The trigger below is that window made deterministic — it transfers the row to
    /// Bob the instant the member's UPDATE touches it, with no threads involved. The member
    /// must still see only its own written data, never the now-foreign row.
    #[tokio::test]
    async fn audit_member_update_response_cannot_leak_a_row_transferred_after_the_write() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-readback", "pa", false);
        db::conn().unwrap().execute(
            "CREATE TRIGGER absence_readback_race AFTER UPDATE ON absences WHEN NEW.id='absence-readback' AND NEW.profile_id='pa' \
             BEGIN UPDATE absences SET profile_id='pb',reason_type='bob secret' WHERE id=NEW.id; END",
            [],
        ).unwrap();
        let (status, value) = call(
            cookie("ta"),
            "update_absence",
            json!({"absence":absence_payload("absence-readback", "pa", "member edit", false)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        // The transfer really happened inside the window — the stored row is Bob's now.
        assert_eq!(
            stored_absence("absence-readback"),
            Some(("pb".into(), "bob secret".into(), false)),
            "the trigger must have transferred the row"
        );
        // ...but the response may only carry what the member itself wrote.
        assert_eq!(
            value["value"]["profile_id"],
            json!("pa"),
            "the response must not disclose the new owner"
        );
        assert_eq!(
            value["value"]["reason_type"],
            json!("member edit"),
            "the response must not disclose foreign row data"
        );
        assert!(
            !value.to_string().contains("bob secret"),
            "no foreign data may reach the member: {value}"
        );
    }

    #[tokio::test]
    async fn admin_approves_a_foreign_absence_without_stealing_its_owner() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-admin-approves", "pb", false);
        let (status, value) = call(
            cookie("tc"),
            "update_absence",
            json!({"absence":absence_payload("absence-admin-approves", "pb", "vacation", true)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["approved"], json!(true));
        assert_eq!(
            stored_absence("absence-admin-approves"),
            Some(("pb".into(), "vacation".into(), true)),
            "admin writes must not rebind the row to the admin profile"
        );
    }

    #[tokio::test]
    async fn admin_revokes_an_approval_it_previously_granted() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-admin-revokes", "pd", true);
        let (status, value) = call(
            cookie("tc"),
            "update_absence",
            json!({"absence":absence_payload("absence-admin-revokes", "pd", "vacation", false)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            stored_absence("absence-admin-revokes"),
            Some(("pd".into(), "vacation".into(), false)),
            "unapproval must reach the stored row"
        );
        // The owner may not put the approval back.
        let (status, _) = call(
            cookie("td"),
            "update_absence",
            json!({"absence":absence_payload("absence-admin-revokes", "pd", "vacation", true)}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored_absence("absence-admin-revokes"),
            Some(("pd".into(), "vacation".into(), false))
        );
    }

    #[tokio::test]
    async fn member_writes_against_a_foreign_absence_leave_no_trace() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-bob-private", "pb", false);
        // Update of somebody else's row: refused, regardless of the payload's claimed owner.
        let (status, _) = call(
            cookie("ta"),
            "update_absence",
            json!({"absence":absence_payload("absence-bob-private", "pa", "hijacked", false)}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored_absence("absence-bob-private"),
            Some(("pb".into(), "vacation".into(), false)),
            "a refused update must leave the row byte-identical"
        );
        // Delete of the same row: refused, row still present.
        let (status, _) = call(
            cookie("ta"),
            "delete_absence",
            json!({"id":"absence-bob-private"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored_absence("absence-bob-private"),
            Some(("pb".into(), "vacation".into(), false)),
            "a refused delete must keep the row"
        );
        // An unknown id answers identically, disclosing nothing about existence.
        let (status, _) = call(
            cookie("ta"),
            "delete_absence",
            json!({"id":"absence-does-not-exist"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn member_deletes_its_own_absence() {
        let _serial = test_lock();
        setup();
        seed_absence("absence-dora-own", "pd", false);
        seed_absence("absence-dora-neighbour", "pb", false);
        let (status, value) = call(
            cookie("td"),
            "delete_absence",
            json!({"id":"absence-dora-own"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(stored_absence("absence-dora-own"), None);
        assert!(
            stored_absence("absence-dora-neighbour").is_some(),
            "the delete must not spill onto neighbouring rows"
        );
    }

    #[tokio::test]
    async fn issue_reads_deny_nonmembers_and_allow_owner() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('private','Private','PRIVATE','pa',1)",[]).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived) VALUES('secret','private',1,'Confidential',0)",[]).unwrap();
        assert_eq!(
            call(cookie("tb"), "list_issues", json!({"project_id":"private"}))
                .await
                .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(cookie("tb"), "get_issue_detail", json!({"id":"secret"}))
                .await
                .0,
            StatusCode::FORBIDDEN
        );
        let (status, value) =
            call(cookie("ta"), "list_issues", json!({"project_id":"private"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
    }

    /// An issue is worked by PEOPLE: several at once, sub-issues included, and only
    /// people who belong to the project. Outsiders can neither read nor assign.
    #[tokio::test]
    async fn issue_assignment_takes_several_project_members_and_refuses_outsiders() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('team','Team','TEAM','pa',1)", []).unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('team','pb')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived) VALUES('team-issue','team',1,'Shared work',0)", []).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived) VALUES('team-child','team',2,'Sub work',0)", []).unwrap();
        c.execute("INSERT INTO issue_links(id,issue_id,linked_issue_id,link_type) VALUES('l1','team-issue','team-child','PARENT_CHILD')", []).unwrap();

        // Two people on one issue — the owner and a member.
        let (status, value) = call(
            cookie("ta"),
            "set_issue_assignees",
            json!({"issue_id":"team-issue","profile_ids":["pa","pb"]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"].as_array().unwrap().len(), 2, "{value}");
        // A sub-issue is just an issue: it takes its own people.
        let (status, value) = call(
            cookie("ta"),
            "set_issue_assignees",
            json!({"issue_id":"team-child","profile_ids":["pb"]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        // Reads carry the whole list, and the parent's child carries its own.
        let (status, value) =
            call(cookie("ta"), "get_issue_detail", json!({"id":"team-issue"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            value["value"]["assignee_ids"].as_array().unwrap().len(),
            2,
            "{value}"
        );
        assert_eq!(
            value["value"]["children"][0]["assignee_ids"][0], "pb",
            "{value}"
        );
        // `assignee_id` still points at the first person, so legacy filters keep working.
        assert_eq!(value["value"]["assignee_id"], "pa", "{value}");

        // A plain member cannot put an outsider on the project's work …
        let (status, _) = call(
            cookie("tb"),
            "set_issue_assignees",
            json!({"issue_id":"team-issue","profile_ids":["pd"]}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let smuggled: i64 = db::conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM project_members WHERE project_id='team' AND profile_id='pd'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            smuggled, 0,
            "a refused assignment must not create membership"
        );
        // … and the refused write leaves the existing people untouched.
        let people: i64 = db::conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM issue_assignees WHERE issue_id='team-issue'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(people, 2);
        // An outsider cannot assign on the project at all.
        let (status, _) = call(
            cookie("td"),
            "set_issue_assignees",
            json!({"issue_id":"team-issue","profile_ids":["pd"]}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = call(
            cookie("td"),
            "list_issue_assignees",
            json!({"issue_id":"team-issue"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    /// A project used to be stuck with whoever was inserted by hand: nothing in
    /// the app could add a member, so nobody else could ever be assigned.
    #[tokio::test]
    async fn project_membership_is_editable_and_the_owner_can_assign_anybody() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('crew','Crew','CREW','pa',1)", []).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,archived) VALUES('crew-issue','crew',1,'Work',0)", []).unwrap();

        // The owner puts somebody on the project, and the directory says so.
        let (status, value) = call(
            cookie("ta"),
            "add_project_member",
            json!({"project_id":"crew","member_id":"pb"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            value["value"]
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id == "pb"),
            "{value}"
        );

        // A member cannot change who belongs to the project.
        let (status, _) = call(
            cookie("tb"),
            "add_project_member",
            json!({"project_id":"crew","member_id":"pd"}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        // … and cannot smuggle an outsider in by assigning them either.
        let (status, _) = call(
            cookie("tb"),
            "set_issue_assignees",
            json!({"issue_id":"crew-issue","profile_ids":["pd"]}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let outsiders: i64 = db::conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM project_members WHERE project_id='crew' AND profile_id='pd'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            outsiders, 0,
            "a refused assignment must not create membership"
        );

        // The owner assigning a non-member brings that person onto the project.
        let (status, value) = call(
            cookie("ta"),
            "set_issue_assignees",
            json!({"issue_id":"crew-issue","profile_ids":["pa","pd"]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let admitted: i64 = db::conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM project_members WHERE project_id='crew' AND profile_id='pd'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(admitted, 1, "assigning somebody puts them on the project");

        // Removing works, except for the owner — a project without its owner is unreachable.
        let (status, value) = call(
            cookie("ta"),
            "remove_project_member",
            json!({"project_id":"crew","member_id":"pd"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            !value["value"]
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id == "pd"),
            "{value}"
        );
        let (status, _) = call(
            cookie("ta"),
            "remove_project_member",
            json!({"project_id":"crew","member_id":"pa"}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        // An admin governs any project's membership.
        assert_eq!(
            call(
                cookie("tc"),
                "add_project_member",
                json!({"project_id":"crew","member_id":"pd"})
            )
            .await
            .0,
            StatusCode::OK
        );
        // The named person is honoured verbatim: `member_id` must not be rewritten
        // to the caller by the session-identity bind (that silently added *me* before).
        let self_add: i64 = db::conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM project_members WHERE project_id='crew' AND profile_id='pc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            self_add, 0,
            "adding somebody else must not add the caller instead"
        );
    }

    #[tokio::test]
    async fn board_and_search_reads_do_not_leak_private_project_metadata() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('private-board','Private board','PRIVATEBOARD','pa',1)",[]).unwrap();
        c.execute("INSERT INTO boards(id,project_id,name,backlog_type,archived) VALUES('private-board-id','private-board','Private board','NONE',0)",[]).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,description,archived) VALUES('private-board-issue','private-board',1,'BOARD-SECRET','board secret body',0)",[]).unwrap();
        c.execute("INSERT INTO issue_board_positions(issue_id,board_id,position) VALUES('private-board-issue','private-board-id',0)",[]).unwrap();
        for command in [
            "list_backlog_issues",
            "list_board_columns",
            "list_board_issues",
        ] {
            let (status, value) = call(
                cookie("td"),
                command,
                json!({"board_id":"private-board-id"}),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{command}: {value}");
            assert!(value.get("value").is_none(), "{command}: {value}");
        }
        assert_eq!(
            call(
                cookie("ta"),
                "list_board_issues",
                json!({"board_id":"private-board-id"})
            )
            .await
            .0,
            StatusCode::OK
        );
        let (status, value) = call(
            cookie("td"),
            "goto_search",
            json!({"query":"BOARD-SECRET","limit":10}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(
            value["value"].as_array().unwrap().is_empty(),
            "private issue leaked through search: {value}"
        );
        let (status, value) = call(
            cookie("ta"),
            "goto_search",
            json!({"query":"BOARD-SECRET","limit":10}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["value"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hit| hit["id"] == "private-board-issue"));
    }

    /// A portfolio shows the open-issue count of every project at once, so it asks for
    /// issues without naming a project. That read must stay a peephole into the caller's
    /// own projects: it answers with their rows only, while naming a foreign project is
    /// still refused outright.
    #[tokio::test]
    async fn unscoped_list_reads_answer_with_readable_projects_only() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('mine','Mine','MINE','pa',1),('theirs','Theirs','THEIRS','pb',1)", []).unwrap();
        c.execute("INSERT INTO issue_statuses(id,project_id,name,resolved,color,ordering) VALUES('s-mine','mine','Open',0,'#fff',0),('s-theirs','theirs','Open',0,'#fff',0)", []).unwrap();
        c.execute("INSERT INTO issues(id,project_id,number,title,status_id,archived) VALUES('i-mine','mine',1,'Mine','s-mine',0),('i-theirs','theirs',1,'Theirs','s-theirs',0)", []).unwrap();
        c.execute("INSERT INTO boards(id,project_id,name,backlog_type,archived) VALUES('b-mine','mine','Mine','MANUAL',0),('b-theirs','theirs','Theirs','MANUAL',0)", []).unwrap();

        for (command, own, foreign) in [
            ("list_issues", "i-mine", "i-theirs"),
            ("list_issue_statuses", "s-mine", "s-theirs"),
            ("list_boards", "b-mine", "b-theirs"),
        ] {
            let (status, value) = call(cookie("ta"), command, json!({})).await;
            assert_eq!(status, StatusCode::OK, "{command}: {value}");
            let rows = value["value"].as_array().unwrap();
            assert!(
                rows.iter().any(|row| row["id"] == own),
                "{command} hides the caller's own row: {value}"
            );
            assert!(
                !rows.iter().any(|row| row["id"] == foreign),
                "{command} leaked a foreign row: {value}"
            );
            // Naming somebody else's project is still a refusal, not a filtered empty list.
            assert_eq!(
                call(cookie("ta"), command, json!({"project_id":"theirs"}))
                    .await
                    .0,
                StatusCode::FORBIDDEN,
                "{command}"
            );
        }

        // Scoping by readability must not swallow the REST of the request: a text,
        // status, assignee or tag filter still selects, or a search answers with rows
        // it was never asked for.
        c.execute("INSERT INTO issues(id,project_id,number,title,status_id,archived) VALUES('i-needle','mine',2,'needle here','s-mine',0)", []).unwrap();
        let (status, value) = call(cookie("ta"), "list_issues", json!({"text":"needle"})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let titles: Vec<String> = value["value"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["title"].as_str().unwrap_or_default().to_owned())
            .collect();
        assert_eq!(
            titles,
            vec!["needle here".to_string()],
            "an unscoped list must still honour its own filters"
        );
        let (_, value) = call(cookie("ta"), "list_issues", json!({"status_id":"s-mine"})).await;
        assert_eq!(
            value["value"].as_array().unwrap().len(),
            2,
            "status filter must select, not be dropped"
        );
        let (_, value) = call(cookie("ta"), "list_issues", json!({"status_id":"s-theirs"})).await;
        assert!(
            value["value"].as_array().unwrap().is_empty(),
            "a foreign status must select nothing readable: {value}"
        );
    }

    #[tokio::test]
    async fn project_reads_are_centrally_scoped_for_owner_member_and_nonmember() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute("INSERT INTO projects(id,name,key,description,created_by,created_at) VALUES('private','Private','PRIVATE','confidential','pa',1)",[]).unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('private','pb')",
            [],
        )
        .unwrap();
        let (status, value) = call(cookie("td"), "list_projects", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(!value["value"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == "private"));
        let (status, value) = call(cookie("td"), "get_project", json!({"id":"private"})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(value.get("value").is_none(), "{value}");
        for token in ["ta", "tb"] {
            assert_eq!(
                call(cookie(token), "get_project", json!({"id":"private"}))
                    .await
                    .0,
                StatusCode::OK
            );
        }
        assert_eq!(
            call(
                cookie("td"),
                "list_issue_statuses",
                json!({"project_id":"private"})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(
                cookie("tb"),
                "list_issue_statuses",
                json!({"project_id":"private"})
            )
            .await
            .0,
            StatusCode::OK
        );
    }

    /// Document *folders* are a second container surface, and the create binder is the
    /// only thing standing between a client and somebody else's personal tree. Forged
    /// `container_type` / `container_id` on create, and every read/write on a foreign
    /// private folder, are checked here directly (SPEC §Knowledge workspace).
    #[tokio::test]
    async fn document_folder_containers_are_bound_to_the_session_and_foreign_trees_stay_shut() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();

        // 1 · a forged personal container id is overwritten with the session profile.
        let (status, value) = call(cookie("ta"), "create_document_folder", json!({"folder":{"id":"alice-folder","container_type":"my-docs","container_id":"pb","parent_id":null,"name":"Alice private","description":null,"archived":false}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let owner: Option<String> = c
            .query_row(
                "SELECT container_id FROM document_folders WHERE id='alice-folder'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            owner.as_deref(),
            Some("pa"),
            "the client-supplied personal container must be ignored"
        );

        // 2 · a project container the caller is not a member of is refused outright,
        //     and a kb folder has no web-mode creation path at all.
        c.execute_batch("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('folder-proj','Folder Project','FP','pa',1);").unwrap();
        let (status, value) = call(cookie("tb"), "create_document_folder", json!({"folder":{"id":"forged-project-folder","container_type":"project","container_id":"folder-proj","parent_id":null,"name":"Trespass","description":null,"archived":false}})).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "a non-member may not create in a project container: {value}"
        );
        let (status, value) = call(cookie("tb"), "create_document_folder", json!({"folder":{"id":"forged-kb-folder","container_type":"kb","container_id":"book","parent_id":null,"name":"Trespass","description":null,"archived":false}})).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "kb folders are not creatable over the web transport: {value}"
        );
        let leaked: i64 = c.query_row("SELECT count(*) FROM document_folders WHERE id IN('forged-project-folder','forged-kb-folder')", [], |r| r.get(0)).unwrap();
        assert_eq!(leaked, 0, "a refused create writes nothing");

        // 3 · Bob cannot see Alice's private folder, by list or by forged profile id.
        for body in [json!({}), json!({"profile_id":"pa"})] {
            let (status, value) = call(cookie("tb"), "list_document_folders", body).await;
            assert_eq!(status, StatusCode::OK, "{value}");
            assert!(
                value["value"].as_array().unwrap().is_empty(),
                "a foreign personal tree is invisible: {value}"
            );
        }

        // 4 · nor write it: rename, re-parent, or re-point its container.
        for (command, body) in [
            (
                "update_document_folder",
                json!({"folder":{"id":"alice-folder","container_type":"my-docs","container_id":"pb","parent_id":null,"name":"Stolen","description":null,"archived":true}}),
            ),
            (
                "move_document_folder",
                json!({"id":"alice-folder","parent_id":null}),
            ),
        ] {
            let (status, value) = call(cookie("tb"), command, body).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{command} must be refused: {value}"
            );
        }
        // Independent check: the row on disk never moved.
        let (name, container, archived): (String, Option<String>, bool) = c
            .query_row(
                "SELECT name,container_id,archived FROM document_folders WHERE id='alice-folder'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (name.as_str(), container.as_deref(), archived),
            ("Alice private", Some("pa"), false)
        );

        // 5 · the owner still reaches her own tree.
        let (status, value) = call(cookie("ta"), "list_document_folders", json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["value"][0]["id"], json!("alice-folder"), "{value}");
    }

    /// The knowledge base is write-through-documents only: books are seeded (or made on the
    /// desktop), never created from the web. The contract under test is that authoring an
    /// article makes its book *navigable to its author and to nobody else* -- the creator must
    /// not own a document it cannot reach, and the visibility must not spill one row wider.
    #[tokio::test]
    async fn a_kb_book_becomes_navigable_to_the_author_of_an_article_and_to_no_one_else() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute_batch(
            "INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES('book-handbook','kb','book-handbook',NULL,'Handbook');\
             INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES('book-secret','kb','book-secret',NULL,'Secret book');",
        )
        .unwrap();

        // Before authoring anything, the books are invisible to everyone on the web.
        for who in ["ta", "tb"] {
            let (status, value) = call(cookie(who), "list_document_folders", json!({})).await;
            assert_eq!(status, StatusCode::OK, "{value}");
            assert!(
                value["value"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|f| f["container_type"] != json!("kb")),
                "an unrelated profile must see no kb folder: {value}"
            );
        }

        // Alice authors an article in the handbook; `created_by` is minted from her session.
        let (status, value) = call(cookie("ta"), "create_document", json!({"document":{"id":"kb-article","container_type":"kb","container_id":"book-handbook","folder_id":"book-handbook","doc_type":"text","title":"House rules","body":"body","version":1,"archived":false,"created_by":"pb"}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let author: Option<String> = c
            .query_row(
                "SELECT created_by FROM documents WHERE id='kb-article'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            author.as_deref(),
            Some("pa"),
            "the payload author must be overwritten by the session"
        );

        // Alice can now navigate the book that holds her article -- and only that one.
        let (status, value) = call(cookie("ta"), "list_document_folders", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let kb: Vec<String> = value["value"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["container_type"] == json!("kb"))
            .map(|f| f["id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            kb,
            vec!["book-handbook".to_string()],
            "the author must reach her article's container, and no further: {value}"
        );

        // Bob authored nothing: both books stay invisible, by list and by forged profile id.
        for body in [json!({}), json!({"profile_id":"pa"})] {
            let (status, value) = call(cookie("tb"), "list_document_folders", body).await;
            assert_eq!(status, StatusCode::OK, "{value}");
            assert!(
                value["value"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|f| f["container_type"] != json!("kb")),
                "a stranger must see no kb folder: {value}"
            );
            let (status, value) = call(cookie("tb"), "list_documents", json!({})).await;
            assert_eq!(status, StatusCode::OK, "{value}");
            assert!(
                value["value"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|d| d["id"] != json!("kb-article")),
                "a stranger must not see the article either: {value}"
            );
        }
        let (status, _) = call(cookie("tb"), "get_document", json!({"id":"kb-article"})).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "a stranger may not fetch the article by id"
        );
    }

    /// The two HTTP endpoints end to end: consent answers with a redirect carrying the
    /// code, and the token endpoint trades that code (plus the PKCE verifier) exactly once.
    /// Book viewers may navigate/search, editors may author, and only the owner manages grants.
    #[tokio::test]
    async fn kb_book_permissions_bind_reads_writes_and_grant_management_to_the_session() {
        let _serial = test_lock();
        setup();
        let c = db::conn().unwrap();
        c.execute_batch("INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES('book-perms','kb','book-perms',NULL,'Permissions'); INSERT INTO kb_book_owners(book_id,profile_id) VALUES('book-perms','pa');").unwrap();
        let (status, value) = call(cookie("ta"), "update_book_access", json!({"book_id":"book-perms","permissions":[{"recipient_type":"profile","member_id":"pb","access_level":"viewer"}]})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let grants: Vec<(String, String, String)> = c.prepare("SELECT recipient_type,recipient_id,access_level FROM document_folder_permissions WHERE folder_id='book-perms'").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<std::result::Result<_, _>>().unwrap();
        assert_eq!(
            grants,
            vec![("profile".into(), "pb".into(), "viewer".into())],
            "grant persistence"
        );
        assert!(
            documents::book_readable_by("book-perms", "pb").unwrap(),
            "grant must make pb readable"
        );
        assert_eq!(
            call(
                cookie("tb"),
                "list_book_access",
                json!({"book_id":"book-perms"})
            )
            .await
            .0,
            StatusCode::FORBIDDEN,
            "a viewer cannot enumerate grants"
        );
        let (status, value) = call(
            cookie("tb"),
            "search_book_documents",
            json!({"book_id":"book-perms","query":"rules"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "a viewer can search its book: {value}"
        );
        let (status, _) = call(cookie("tb"), "create_document", json!({"document":{"id":"viewer-kb-write","container_type":"kb","container_id":"book-perms","folder_id":"book-perms","doc_type":"text","title":"Denied","body":"","version":1,"archived":false}})).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "viewer cannot author");
        let (status, value) = call(cookie("ta"), "update_book_access", json!({"book_id":"book-perms","permissions":[{"recipient_type":"profile","member_id":"pb","access_level":"editor"}]})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let (status, value) = call(cookie("tb"), "create_document", json!({"document":{"id":"editor-kb-write","container_type":"kb","container_id":"book-perms","folder_id":"book-perms","doc_type":"text","title":"Allowed","body":"","version":1,"archived":false}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(
            c.query_row(
                "SELECT created_by FROM documents WHERE id='editor-kb-write'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "pb"
        );
    }

    #[tokio::test]
    async fn oauth_authorization_code_round_trips_over_http_and_refuses_a_replay() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use sha2::{Digest, Sha256};
        let _serial = test_lock();
        setup();
        let verifier = "http-verifier-01234567890123456789012345678901";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        db::conn().unwrap().execute("INSERT INTO applications(id,name,application_type,client_id,code_flow_enabled,pkce_required) VALUES('app-http','HTTP App','Application','client-http',1,1)",[]).unwrap();
        oauth::register_redirect_uri("app-http", "https://client.example/cb").unwrap();

        let (status, value) = status_and_body(
            oauth_authorize(
                cookie("ta"),
                Json(
                    serde_json::from_value(json!({
                        "client_id":"client-http",
                        "redirect_uri":"https://client.example/cb",
                        "response_type":"code",
                        "scope":"project:read",
                        "state":"s1",
                        "code_challenge":challenge,
                        "code_challenge_method":"S256"
                    }))
                    .unwrap(),
                ),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let redirect = value["value"]["redirect_to"].as_str().unwrap().to_string();
        assert!(redirect.ends_with("&state=s1"), "{redirect}");
        let code = redirect
            .split("code=")
            .nth(1)
            .unwrap()
            .split('&')
            .next()
            .unwrap()
            .to_string();

        let exchange = |code: String| async move {
            status_and_body(
                oauth_token(Json(
                    serde_json::from_value(json!({
                        "grant_type":"authorization_code",
                        "client_id":"client-http",
                        "code":code,
                        "redirect_uri":"https://client.example/cb",
                        "code_verifier":verifier
                    }))
                    .unwrap(),
                ))
                .await
                .into_response(),
            )
            .await
        };
        let (status, value) = exchange(code.clone()).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"]["token_type"], json!("Bearer"));
        assert_eq!(value["value"]["scope"], json!("project:read"));
        let (status, value) = exchange(code).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "a replay is refused: {value}"
        );
    }

    /// RFC 6749 §5.1/§5.2 on the wire: the standard error object (never the house
    /// `ok:false` envelope), 401 + `WWW-Authenticate` for a client-auth failure,
    /// 400 otherwise, and `Cache-Control: no-store` on every answer.
    #[tokio::test]
    async fn oauth_token_errors_speak_rfc6749_section_5_2() {
        let _serial = test_lock();
        setup();
        db::conn().unwrap().execute("INSERT INTO applications(id,name,application_type,client_id,code_flow_enabled,pkce_required) VALUES('app-e52','E52','Application','client-e52',1,1)",[]).unwrap();

        let post = |body: Value| async move {
            let response = oauth_token(Json(serde_json::from_value(body).unwrap()))
                .await
                .into_response();
            let status = response.status();
            let headers = response.headers().clone();
            let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
            let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            (status, headers, value)
        };

        let (status, headers, value) = post(json!({
            "grant_type":"password",
            "client_id":"client-e52",
            "code":"ac-x.y",
            "redirect_uri":"https://client.example/cb"
        }))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value["error"], json!("unsupported_grant_type"));
        assert!(value["error_description"].is_string(), "{value}");
        assert!(value.get("ok").is_none(), "§5.2 shape, not the house one");
        assert_eq!(
            headers.get(header::CACHE_CONTROL).unwrap(),
            "no-store",
            "§5.1: a token answer is never cached"
        );

        let (status, headers, value) = post(json!({
            "grant_type":"authorization_code",
            "client_id":"client-unknown",
            "code":"ac-x.y",
            "redirect_uri":"https://client.example/cb"
        }))
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{value}");
        assert_eq!(value["error"], json!("invalid_client"));
        assert!(
            headers.contains_key(header::WWW_AUTHENTICATE),
            "§5.2: a 401 carries a challenge"
        );

        let (status, _, value) = post(json!({
            "grant_type":"authorization_code",
            "client_id":"client-e52",
            "code":"ac-nope.deadbeef",
            "redirect_uri":"https://client.example/cb"
        }))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value["error"], json!("invalid_grant"), "{value}");
    }

    /// The redirect allowlist is reachable over HTTP — a server-only deployment can
    /// register a code client without the desktop app — and only for an app admin.
    #[tokio::test]
    async fn register_redirect_uri_is_an_admin_only_command() {
        let _serial = test_lock();
        setup();
        db::conn().unwrap().execute("INSERT INTO applications(id,name,application_type,client_id,code_flow_enabled,pkce_required) VALUES('app-reg','Reg','Application','client-reg',1,1)",[]).unwrap();
        let args = json!({"application_id":"app-reg","redirect_uri":"https://client.example/cb"});

        let (status, _) = call(HeaderMap::new(), "register_redirect_uri", args.clone()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "no session, no write");
        let (status, _) = call(cookie("ta"), "register_redirect_uri", args.clone()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "a member is not an app admin"
        );

        let (status, value) = call(cookie("tc"), "register_redirect_uri", args).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let (status, value) = call(
            cookie("tc"),
            "list_redirect_uris",
            json!({"application_id":"app-reg"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["value"], json!(["https://client.example/cb"]));

        let (status, value) = call(
            cookie("tc"),
            "register_redirect_uri",
            json!({"application_id":"app-reg","redirect_uri":"http://evil.example/cb"}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "plain http off localhost stays out: {value}"
        );
    }

    /// Without a session there is no resource owner to consent.
    #[tokio::test]
    async fn oauth_authorize_requires_a_session() {
        let _serial = test_lock();
        setup();
        let (status, _) = status_and_body(
            oauth_authorize(
                HeaderMap::new(),
                Json(
                    serde_json::from_value(json!({
                        "client_id":"client-http",
                        "redirect_uri":"https://client.example/cb",
                        "response_type":"code"
                    }))
                    .unwrap(),
                ),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
