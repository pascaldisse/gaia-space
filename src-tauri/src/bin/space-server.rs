use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    body::Bytes,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post, put},
    Json, Router,
};
use gaia_space_lib::{
    applications, blogs, calendar_feeds, calls, chat, db, documents, issues, meetings, personal,
    pipelines, platform, review,
};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

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
struct PatchUser {
    display_name: Option<String>,
    role: Option<String>,
    active: Option<bool>,
    password: Option<String>,
}
fn err(code: StatusCode, s: &str) -> (StatusCode, Json<Value>) {
    (code, Json(json!({"ok":false,"error":s})))
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
fn user_by_token(headers: &HeaderMap) -> Result<User, (StatusCode, Json<Value>)> {
    let t = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';')
                .find_map(|x| x.trim().strip_prefix("space_session="))
        })
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    let mut user=c.query_row("SELECT u.id,u.username,u.display_name,u.profile_id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?1 AND s.expires_at>unixepoch() AND u.active=1",[t],|r|{let role:String=r.get(4)?;Ok(User{id:r.get(0)?,username:r.get(1)?,display_name:r.get(2)?,profile_id:r.get(3)?,account_admin:role=="admin",role})}).map_err(|_|err(StatusCode::UNAUTHORIZED,"unauthorized"))?;
    // Every `user.role=="admin"` test below is the *unified* admin predicate
    // (platform::is_admin_on): the account role or the Global.Superadmin right, one
    // meaning on both transports. The raw column alone would leave a rights-model
    // admin powerless over HTTP.
    if user.role != "admin"
        && platform::is_admin_on(&c, &user.profile_id)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
    {
        user.role = "admin".into();
    }
    Ok(user)
}
fn admin(h: &HeaderMap) -> Result<User, (StatusCode, Json<Value>)> {
    let u = user_by_token(h)?;
    if u.role == "admin" {
        Ok(u)
    } else {
        Err(err(StatusCode::FORBIDDEN, "admin required"))
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
    let row=c.query_row("SELECT id,username,password_hash,display_name,profile_id,role FROM users WHERE username=?1 AND active=1",[&account],|r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get(5)?)));
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
        json!({"user":User{id,username,display_name,profile_id,account_admin:role=="admin",role}}),
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
        "SELECT id,username,display_name,profile_id,role,active FROM users ORDER BY username",
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
    if !matches!(x.role.as_str(), "admin" | "member") {
        return err(StatusCode::BAD_REQUEST, "invalid role").into_response();
    }
    if x.role == "admin" && !me.account_admin {
        return err(
            StatusCode::FORBIDDEN,
            "only an account admin can grant the admin role",
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
    match c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES(?1,?2,?3,?4,?5,?6,unixepoch())", params![id, username, password_hash, display_name, pid, x.role]) {
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
    let target: (String, bool) =
        match c.query_row("SELECT role,active FROM users WHERE id=?1", [&id], |r| {
            Ok((r.get(0)?, r.get::<_, i64>(1)? == 1))
        }) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return err(StatusCode::NOT_FOUND, "user not found").into_response()
            }
            Err(e) => {
                return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
            }
        };
    let active_admins: i64 = c
        .query_row(
            "SELECT count(*) FROM users WHERE role='admin' AND active=1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if target.0 == "admin" && target.1 && active_admins <= 1 {
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
    if let Some(role) = x.role.as_deref() {
        if !matches!(role, "admin" | "member") {
            return err(StatusCode::BAD_REQUEST, "invalid role").into_response();
        }
        // Promotion gate: the account role is the thing that mints admins, so only
        // an account admin may hand it out. A Global.Superadmin is an admin
        // everywhere it matters, but it cannot promote itself into the column that
        // grants it — the rights model would otherwise be its own escalation path.
        if role == "admin" && !me.account_admin {
            return err(
                StatusCode::FORBIDDEN,
                "only an account admin can grant the admin role",
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
    let target: (String, bool) =
        match c.query_row("SELECT role,active FROM users WHERE id=?1", [&id], |r| {
            Ok((r.get(0)?, r.get::<_, i64>(1)? == 1))
        }) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return err(StatusCode::NOT_FOUND, "user not found").into_response()
            }
            Err(e) => {
                return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
            }
        };
    if id == me.id && x.active == Some(false) {
        return err(StatusCode::BAD_REQUEST, "cannot deactivate yourself").into_response();
    }
    let removes_active_admin = target.0 == "admin"
        && target.1
        && (x.role.as_deref() == Some("member") || x.active == Some(false));
    if removes_active_admin {
        let n: i64 = c
            .query_row(
                "SELECT count(*) FROM users WHERE role='admin' AND active=1",
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
    if let Some(v) = x.role {
        if let Err(e) = c.execute("UPDATE users SET role=?1 WHERE id=?2", params![v, id]) {
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
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id=?1 AND profile_id=?2)",
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
    TodoRead,
    TodoCreate,
    TodoOwnerWrite,
    TodoCompletionWrite,
    NotificationWrite,
    ProjectCreate,
    ProjectWrite,
    ProjectRead,
    ProjectMemberWrite,
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
    DocumentAccessWrite,
    DocumentFolderCreate,
    DocumentFolderReadList,
    DocumentFolderWrite,
    MeetingReadList,
    MeetingRead,
    MeetingWrite,
    MeetingParticipantWrite,
    SearchRead,
    AbsenceWrite,
    CalendarFeedRead,
    CalendarFeedUpsert,
    CalendarFeedOwnerAction,
    Unavailable,
}

/// The web command allow-list. Every `/api/cmd/*` request must resolve here
/// before it can reach `dispatch!`; missing entries fail closed with 403.
fn command_policy(name: &str) -> Option<CommandPolicy> {
    Some(match name {
        "create_project" => CommandPolicy::ProjectCreate,
        "update_project" => CommandPolicy::ProjectWrite,
        "create_board" | "create_issue" | "create_issue_status" => {
            CommandPolicy::ProjectMemberWrite
        }
        "get_project" | "list_boards" | "list_issue_statuses" => CommandPolicy::ProjectRead,
        "set_project_deadline" | "update_project_deadline" => CommandPolicy::ProjectDeadlineWrite,
        "list_todos" | "dashboard_aggregate" => CommandPolicy::TodoRead,
        "calendar_aggregate" => CommandPolicy::CalendarRead,
        "list_calendar_feeds" => CommandPolicy::CalendarFeedRead,
        "save_calendar_feed" => CommandPolicy::CalendarFeedUpsert,
        "delete_calendar_feed" | "sync_calendar_feed" => CommandPolicy::CalendarFeedOwnerAction,
        "list_project_todos" | "list_project_member_ids" => CommandPolicy::ProjectTodoRead,
        "create_todo" => CommandPolicy::TodoCreate,
        "update_todo" | "delete_todo" => CommandPolicy::TodoOwnerWrite,
        "set_todo_completion" => CommandPolicy::TodoCompletionWrite,
        "mark_notification_read" => CommandPolicy::NotificationWrite,
        "create_absence" | "update_absence" | "delete_absence" => CommandPolicy::AbsenceWrite,
        "create_meeting" => CommandPolicy::SessionIdentityWrite,
        "save_document" | "restore_doc_version" => CommandPolicy::DocumentWrite,
        "list_document_access" => CommandPolicy::DocumentRead,
        "update_document_access" => CommandPolicy::DocumentAccessWrite,
        "create_document" => CommandPolicy::DocumentCreate,
        "app_info"
        | "join_meeting_call"
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
        "archive_document" | "delete_document" => CommandPolicy::DocumentOwnerWrite,
        "archive_meeting" | "delete_meeting" => CommandPolicy::MeetingWrite,
        "archive_issue" | "archive_role" | "archive_sprint" | "archive_team" => {
            CommandPolicy::Session
        }
        "cf_get_values" | "cf_set_value" | "check_right" | "close_sprint" => CommandPolicy::Session,
        "create_cf_definition"
        | "create_channel"
        | "create_deploy_target"
        | "create_entity_channel" => CommandPolicy::Session,
        "create_document_folder" => CommandPolicy::DocumentFolderCreate,
        "create_job_artifact"
        | "create_message"
        | "create_package_repository"
        | "create_pipeline_script"
        | "register_worker"
        | "save_test_report" => CommandPolicy::Session,
        "create_profile"
        | "create_quality_gate_rule"
        | "create_review_stack"
        | "create_review"
        | "create_review_discussion"
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
        | "delete_message"
        | "delete_package_repository" => CommandPolicy::Session,
        "delete_package_version"
        | "remove_package_repository_acl"
        | "download_package_payload"
        | "delete_pipeline_script"
        | "delete_planning_tag"
        | "delete_quality_gate_rule"
        | "delete_role_assignment"
        | "delete_sprint" => CommandPolicy::Session,
        "delete_subscription_setting"
        | "delete_swimlane"
        | "delete_time_tracking_entry"
        | "emit_notification"
        | "evaluate_quality_gate" => CommandPolicy::Session,
        "expand_meeting_occurrences" => CommandPolicy::MeetingReadList,
        "get_channel" | "get_channel_by_entity" => CommandPolicy::Session,
        "get_issue" | "get_issue_detail" | "list_issues" => CommandPolicy::IssueRead,
        "list_issue_assignees" | "set_issue_assignees" => CommandPolicy::IssueAssign,
        "add_project_member" | "remove_project_member" => CommandPolicy::ProjectMemberAdmin,
        "get_document" | "list_doc_versions" => CommandPolicy::DocumentRead,
        "get_meeting" | "list_meeting_participants" => CommandPolicy::MeetingRead,
        "get_profile" | "get_review" | "get_role" | "get_team" => CommandPolicy::Session,
        "goto_search" | "full_text_search" => CommandPolicy::SearchRead,
        "list_blog_posts" | "get_blog_post" | "publish_blog_draft" => CommandPolicy::Session,
        "issue_time_total" | "join_channel" | "launch_sprint" | "leave_channel"
        | "list_absences" => CommandPolicy::Session,
        "invite_meeting_participant" => CommandPolicy::MeetingWrite,
        "list_backlog_issues" | "list_board_columns" | "list_board_issues" => {
            CommandPolicy::BoardRead
        }
        "list_cf_definitions" | "list_channel_members" => CommandPolicy::Session,
        "list_channels_with_meta"
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
        "list_jobs" | "list_jobs_for_script" | "list_messages" | "list_notifications" => {
            CommandPolicy::Session
        }
        "list_meetings" => CommandPolicy::MeetingReadList,
        "list_package_repositories"
        | "list_package_repository_acl"
        | "list_package_versions"
        | "list_pipeline_scripts"
        | "list_planning_tags"
        | "list_profiles" => CommandPolicy::Session,
        "list_projects" => CommandPolicy::Session,
        "list_quality_gate_rules"
        | "list_review_stacks"
        | "list_review_discussions"
        | "list_review_participants"
        | "list_reviews"
        | "list_rights"
        | "list_role_assignments" => CommandPolicy::Session,
        "list_role_rights"
        | "list_roles"
        | "list_safe_merge_runs"
        | "list_sprints"
        | "list_subscription_settings"
        | "list_swimlanes" => CommandPolicy::Session,
        "list_team_memberships"
        | "list_teams"
        | "list_thread_replies"
        | "list_time_tracking_entries"
        | "livekit_server_status"
        | "mark_channel_read" => CommandPolicy::Session,
        "apply_package_retention"
        | "move_issue_on_board"
        | "publish_package_version"
        | "remove_channel_member"
        | "set_package_repository_acl"
        | "set_package_version_pinned" => CommandPolicy::Session,
        "move_document" => CommandPolicy::DocumentOwnerWrite,
        "move_document_folder" => CommandPolicy::DocumentFolderWrite,
        "remove_issue_from_board"
        | "remove_issue_link"
        | "remove_reaction"
        | "remove_team_membership"
        | "save_board_column" => CommandPolicy::Session,
        "save_checklist"
        | "save_checklist_item"
        | "save_planning_tag"
        | "save_subscription_setting"
        | "save_swimlane" => CommandPolicy::Session,
        "save_time_tracking_entry"
        | "schedule_deployment"
        | "seed_rights"
        | "set_discussion_resolved"
        | "set_issue_tags" => CommandPolicy::Session,
        "set_meeting_participant_status" => CommandPolicy::MeetingParticipantWrite,
        "set_participant_state"
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
        | "update_package_repository"
        | "update_pipeline_script"
        | "update_profile" => CommandPolicy::Session,
        "update_meeting" => CommandPolicy::MeetingWrite,
        "update_quality_gate_rule"
        | "update_review"
        | "update_role"
        | "update_sprint"
        | "update_team"
        | "update_team_membership" => CommandPolicy::Session,
        "list_devfiles"
        | "list_applications"
        | "list_webhooks"
        | "list_webhook_deliveries"
        | "list_chatbots"
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
    Ok(user.role == "admin"
        || project_owner(project_id)?.is_some_and(|owner| owner == user.profile_id)
        || personal::project_member_by(project_id, &user.profile_id)?)
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
        if user.role != "admin" && !personal::project_member_by(p, &user.profile_id)? {
            return Err("project access denied".into());
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
        if user.role != "admin" && !personal::project_member_by(p, &user.profile_id)? {
            return Err("project access denied".into());
        }
    }
    if t == "kb" {
        return Err("knowledge-base folders require a project attachment in web mode".into());
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
/// Single authorization + identity-binding gate for the complete web command
/// surface. Domain dispatch is deliberately below this function.
fn authorize_command(
    user: &User,
    name: &str,
    body: &mut Value,
) -> Result<(), (StatusCode, Json<Value>)> {
    let policy =
        command_policy(name).ok_or_else(|| err(StatusCode::FORBIDDEN, "command denied"))?;
    if (!matches!(policy, CommandPolicy::AbsenceWrite) || user.role != "admin")
        && policy != CommandPolicy::DocumentAccessWrite
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
            if user.role != "admin" && owner != user.profile_id {
                return Err(err(StatusCode::FORBIDDEN, "project access denied"));
            }
            Ok(())
        }
        CommandPolicy::ProjectWrite => {
            let (project_id, _) =
                project_from_body(body).map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                .ok_or_else(|| err(StatusCode::FORBIDDEN, "project access denied"))?;
            if user.role != "admin" && owner != user.profile_id {
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
        // Only the owner or an admin decides who belongs to a project.
        CommandPolicy::ProjectMemberAdmin => {
            let project_id: String =
                arg(body, "project_id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            let owner = project_owner(&project_id)
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            // `member_id` deliberately escapes bind_session_identity: naming somebody
            // else is the whole point here, and the right to do it is checked below.
            if user.role == "admin" || owner.as_deref() == Some(user.profile_id.as_str()) {
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
                user.role == "admin" || owner.as_deref() == Some(user.profile_id.as_str());
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
        CommandPolicy::TodoCreate => Ok(()),
        CommandPolicy::CalendarRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
        }
        // List: same shape as CalendarRead. `id` present in `input` (an existing
        // feed) is checked against the DB-recorded owner before profile_id is
        // stamped on — admin bypasses ownership but never authorship.
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
                if user.role != "admin" && !calendar_feed_owned_by(&user.profile_id, &id) {
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
            if user.role != "admin" && !calendar_feed_owned_by(&user.profile_id, &id) {
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
                if user.role != "admin"
                    && !personal::project_member_by(&project_id, &user.profile_id)
                        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
                {
                    return Err(err(StatusCode::FORBIDDEN, "project access denied"));
                }
            }
            put_arg(body, "profile_id", json!(user.profile_id));
            Ok(())
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
            if user.role != "admin" && !todo_owned_by(&user.profile_id, &todo_id) {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "only the owner can change this todo",
                ));
            }
            Ok(())
        }
        CommandPolicy::TodoCompletionWrite => {
            let todo_id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
            if user.role == "admin" || todo_owned_by(&user.profile_id, &todo_id) {
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
            if user.role == "admin" {
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
            if documents::document_writable_by(&id, &user.profile_id, user.role == "admin")
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                if matches!(name, "save_document" | "restore_doc_version") {
                    put_arg(body, "actor", json!(user.profile_id));
                }
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document write denied"))
            }
        }
        CommandPolicy::DocumentOwnerWrite => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if documents::document_owner_writable_by(&id, &user.profile_id, user.role == "admin")
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document owner access denied"))
            }
        }
        CommandPolicy::DocumentAccessWrite => {
            let id = document_id(body, name)
                .ok_or_else(|| err(StatusCode::BAD_REQUEST, "invalid document id"))?;
            if documents::document_access_manageable_by(&id, &user.profile_id, user.role == "admin")
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
            if documents::document_folder_writable_by(&id, &user.profile_id, user.role == "admin")
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?
            {
                Ok(())
            } else {
                Err(err(StatusCode::FORBIDDEN, "document folder write denied"))
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
            if !meetings::meeting_writable_by(&id, &user.profile_id, user.role == "admin")
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
            let c = db::conn().map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
            let allowed:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM meeting_participants WHERE meeting_id=?1 AND profile_id=?2)",params![id,user.profile_id],|r|r.get(0)).map_err(|e|err(StatusCode::INTERNAL_SERVER_ERROR,&e.to_string()))?;
            if allowed {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "meeting participant access denied",
                ))
            }
        }
        CommandPolicy::SearchRead => {
            put_arg(body, "profile_id", json!(user.profile_id));
            put_arg(body, "allow_all", json!(user.role == "admin"));
            Ok(())
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
            if name == "list_thread_replies" {
                let thread_of: String =
                    arg(body, "thread_of").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_message_channel(&thread_of)
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
            if matches!(name, "update_message" | "delete_message") {
                let id: String = arg(body, "id").map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
                if !chat_message_owned(&user.profile_id, &id) {
                    return Err(err(
                        StatusCode::FORBIDDEN,
                        "only the author can change this message",
                    ));
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
                "app_info" | "join_meeting_call" | "start_livekit_server" |
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
    if user.role == "admin" {
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
    if user.role == "admin" {
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
async fn registry_npm_publish(
    headers: HeaderMap,
    Path((repository_id, package_name)): Path<(String, String)>,
    Json(mut manifest): Json<Value>,
) -> axum::response::Response {
    if let Err(error) = user_by_token(&headers) {
        return error.into_response();
    }
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
async fn registry_npm_metadata(
    headers: HeaderMap,
    Path((repository_id, package_name)): Path<(String, String)>,
) -> axum::response::Response {
    if let Err(error) = user_by_token(&headers) {
        return error.into_response();
    }
    match pipelines::npm_registry_metadata(&repository_id, &package_name) {
        Ok(value) => Json(value).into_response(),
        Err(error) => err(StatusCode::NOT_FOUND, &error).into_response(),
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
    "list_applications" => applications::list_applications(),
    "save_application" => applications::save_application(value: applications::Application),
    "delete_application" => applications::delete_application(id: String),
    "list_webhooks" => applications::list_webhooks(application_id: String),
    "save_webhook" => applications::save_webhook(value: applications::WebhookSubscription),
    "delete_webhook" => applications::delete_webhook(id: String),
    "deliver_webhook" => applications::deliver_webhook(webhook_id: String, payload_json: String),
    "retry_webhook_delivery" => applications::retry_webhook_delivery(id: String),
    "list_webhook_deliveries" => applications::list_webhook_deliveries(webhook_id: String),
    "list_chatbots" => applications::list_chatbots(application_id: String),
    "save_chatbot" => applications::save_chatbot(value: applications::ChatbotRegistration),
    "delete_chatbot" => applications::delete_chatbot(id: String),
    "list_ui_extensions" => applications::list_ui_extensions(application_id: String),
    "save_ui_extension" => applications::save_ui_extension(value: applications::UiExtension),
    "delete_ui_extension" => applications::delete_ui_extension(id: String),
    "add_channel_member" => chat::add_channel_member(channel_id: String, member_id: String, administrator: bool),
    "add_issue_child" => issues::add_issue_child(parent_id: String, child_id: String),
    "add_reaction" => chat::add_reaction(message_id: String, profile_id: String, emoji: String),
    "add_review_participant" => review::add_review_participant(participant: review::ReviewParticipant),
    "add_team_membership" => platform::add_team_membership(input: platform::TeamMembershipInput),
    "archive_cf_definition" => platform::archive_cf_definition(id: String, archived: bool),
    "archive_document" => documents::archive_document(id: String, archived: bool),
    "delete_document" => documents::delete_document(id: String),
    "archive_issue" => issues::archive_issue(id: String, archived: bool),
    "archive_meeting" => meetings::archive_meeting(id: String, archived: bool),
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
    "create_document" => documents::create_document(document: documents::Document),
    "create_document_folder" => documents::create_document_folder(folder: documents::DocumentFolder),
    "create_entity_channel" => chat::create_entity_channel(entity_type: String, entity_id: String, name: Option<String>),
    "create_issue" => issues::create_issue(input: issues::IssueInput),
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
    "delete_board" => issues::delete_board(id: String),
    "delete_board_column" => issues::delete_board_column(id: String),
    "delete_checklist" => issues::delete_checklist(id: String),
    "delete_checklist_item" => issues::delete_checklist_item(id: String),
    "delete_deploy_target" => pipelines::delete_deploy_target(id: String),
    "delete_issue_status" => issues::delete_issue_status(id: String),
    "delete_message" => chat::delete_message(id: String),
    "delete_package_repository" => pipelines::delete_package_repository(id: String),
    "delete_package_version" => pipelines::delete_package_version(id: String),
    "delete_pipeline_script" => pipelines::delete_pipeline_script(id: String),
    "delete_planning_tag" => issues::delete_planning_tag(id: String),
    "delete_quality_gate_rule" => review::delete_quality_gate_rule(id: String),
    "delete_role_assignment" => platform::delete_role_assignment(id: String),
    "delete_sprint" => issues::delete_sprint(id: String),
    "delete_subscription_setting" => personal::delete_subscription_setting(profile_id: String, event_type: String),
    "delete_swimlane" => issues::delete_swimlane(id: String),
    "delete_time_tracking_entry" => issues::delete_time_tracking_entry(id: String),
    "delete_todo" => personal::delete_todo(id: String),
    "dry_run_merge" => review::dry_run_merge(id: String, repo_path: String, review_id: String, source_branch: String, target_branch: String),
    "emit_notification" => personal::emit_notification(input: personal::NotificationInput),
    "evaluate_quality_gate" => review::evaluate_quality_gate(review_id: String),
    "expand_meeting_occurrences" => meetings::expand_meeting_occurrences_scoped(range_start: i64, range_end: i64, profile_id: String),
    "get_channel" => chat::get_channel(id: String),
    "get_channel_by_entity" => chat::get_channel_by_entity(entity_type: String, entity_id: String),
    "get_document" => documents::get_document_scoped(id: String, profile_id: String),
    "get_issue" => issues::get_issue(id: String),
    "get_issue_detail" => issues::get_issue_detail(id: String),
    "get_meeting" => meetings::get_meeting_scoped(id: String, profile_id: String),
    "get_profile" => platform::get_profile(id: String),
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
    "list_boards" => issues::list_boards(project_id: Option<String>),
    "list_cf_definitions" => platform::list_cf_definitions(entity_type: Option<String>),
    "list_channel_members" => chat::list_channel_members(channel_id: String),
    "list_channels" => chat::list_channels(),
    "list_channels_with_meta" => chat::list_channels_with_meta(profile_id: String),
    "list_checklist_items" => issues::list_checklist_items(checklist_id: String),
    "list_checklists" => issues::list_checklists(issue_id: String),
    "list_deploy_targets" => pipelines::list_deploy_targets(),
    "list_deployments_for_target" => pipelines::list_deployments_for_target(target_id: String),
    "list_doc_versions" => documents::list_doc_versions_scoped(document_id: String, profile_id: String),
    "list_document_access" => documents::list_document_access(document_id: String),
    "update_document_access" => documents::update_document_access(document_id: String, permissions: Vec<documents::DocumentAccessRecipient>),
    "list_document_folders" => documents::list_document_folders_scoped(profile_id: String),
    "list_documents" => documents::list_documents_scoped(profile_id: String),
    "list_issue_statuses" => issues::list_issue_statuses(project_id: Option<String>),
    "list_issues" => issues::list_issues(project_id: Option<String>, text: Option<String>, status_id: Option<String>, assignee_id: Option<String>, tag_id: Option<String>, custom_field_id: Option<String>, custom_field_value_json: Option<String>, include_archived: Option<bool>),
    "list_job_runs" => pipelines::list_job_runs(),
    "list_job_runs_for_script" => pipelines::list_job_runs_for_script(script_id: String),
    "list_job_artifacts" => pipelines::list_job_artifacts(job_run_id: String),
    "list_test_reports" => pipelines::list_test_reports(job_run_id: String),
    "list_workers" => pipelines::list_workers(),
    "list_jobs" => pipelines::list_jobs(),
    "list_jobs_for_script" => pipelines::list_jobs_for_script(script_id: String),
    "list_meeting_participants" => meetings::list_meeting_participants_scoped(meeting_id: String, profile_id: String),
    "list_meetings" => meetings::list_meetings_scoped(profile_id: String),
    "list_messages" => chat::list_messages(channel_id: String, acting_profile_id: Option<String>),
    "list_notifications" => personal::list_notifications(recipient_id: String, unread_only: Option<bool>),
    "list_package_repositories" => pipelines::list_package_repositories(),
    "list_package_repository_acl" => pipelines::list_package_repository_acl(repository_id: String),
    "list_package_versions" => pipelines::list_package_versions(repository_id: String, query: Option<String>),
    "list_pipeline_scripts" => pipelines::list_pipeline_scripts(),
    "list_planning_tags" => issues::list_planning_tags(project_id: String),
    "list_profiles" => platform::list_profiles(),
    "list_projects" => platform::list_projects(),
    "list_protected_branch_rules" => review::list_protected_branch_rules(project_id: String),
    "save_protected_branch_rule" => review::save_protected_branch_rule(rule: review::ProtectedBranchRule),
    "delete_protected_branch_rule" => review::delete_protected_branch_rule(id: String),
    "list_quality_gate_rules" => review::list_quality_gate_rules(project_id: String),
    "list_review_stacks" => review::list_review_stacks(project_id: String),
    "list_review_discussions" => review::list_review_discussions(review_id: String),
    "list_review_participants" => review::list_review_participants(review_id: String),
    "list_reviews" => review::list_reviews(),
    "list_rights" => platform::list_rights(),
    "list_role_assignments" => platform::list_role_assignments(profile_id: Option<String>, team_id: Option<String>),
    "list_role_rights" => platform::list_role_rights(role_id: String),
    "list_roles" => platform::list_roles(),
    "list_safe_merge_runs" => review::list_safe_merge_runs(review_id: String),
    "list_sprints" => issues::list_sprints(board_id: Option<String>),
    "list_subscription_settings" => personal::list_subscription_settings(profile_id: String),
    "list_swimlanes" => issues::list_swimlanes(board_id: String, sprint_id: Option<String>),
    "list_team_memberships" => platform::list_team_memberships(team_id: Option<String>, profile_id: Option<String>),
    "list_teams" => platform::list_teams(),
    "list_thread_replies" => chat::list_thread_replies(thread_of: String, acting_profile_id: Option<String>),
    "list_time_tracking_entries" => issues::list_time_tracking_entries(issue_id: String),
    "list_todos" => personal::list_todos(profile_id: String, include_done: Option<bool>),
    "list_project_todos" => personal::list_project_todos(project_id: String, profile_id: String, include_done: Option<bool>),
    "list_project_member_ids" => personal::project_member_ids(project_id: String),
    "calendar_aggregate" => personal::calendar_aggregate(profile_id: String, range_start: i64, range_end: i64, range_start_date: Option<String>, range_end_date: Option<String>),
    "list_calendar_feeds" => calendar_feeds::list_calendar_feeds(profile_id: String),
    "save_calendar_feed" => calendar_feeds::save_calendar_feed(input: calendar_feeds::CalendarFeedInput),
    "delete_calendar_feed" => calendar_feeds::delete_calendar_feed(id: String),
    "sync_calendar_feed" => calendar_feeds::sync_calendar_feed(id: String),
    "livekit_server_status" => calls::livekit_server_status(config: Option<calls::LivekitConfig>),
    "mark_channel_read" => chat::mark_channel_read(channel_id: String, profile_id: String, message_id: Option<String>),
    "mark_notification_read" => personal::mark_notification_read(id: String),
    "move_document" => documents::move_document(id: String, container_type: String, container_id: Option<String>, folder_id: Option<String>),
    "move_document_folder" => documents::move_document_folder(id: String, parent_id: Option<String>),
    "move_issue_on_board" => issues::move_issue_on_board(board_id: String, issue_id: String, column_id: String, sprint_id: Option<String>, swimlane_id: Option<String>, position: Option<i64>),
    "open_merge_request" => review::open_merge_request(req: review::NewMergeRequest),
    "apply_package_retention" => pipelines::apply_package_retention(repository_id: String),
    "publish_package_version" => pipelines::publish_package_version(repository_id: String, package_name: String, version: String, metadata_json: Option<String>, payload_filename: Option<String>, payload_content: Option<String>),
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
    "save_test_report" => pipelines::save_test_report(report: pipelines::TestReport),
    "save_checklist" => issues::save_checklist(input: issues::ChecklistInput),
    "save_checklist_item" => issues::save_checklist_item(input: issues::ChecklistItemInput),
    "save_document" => documents::save_document(id: String, title: String, body: Option<String>, actor: Option<String>),
    "save_planning_tag" => issues::save_planning_tag(input: issues::TagInput),
    "save_subscription_setting" => personal::save_subscription_setting(setting: personal::SubscriptionSetting),
    "save_swimlane" => issues::save_swimlane(input: issues::SwimlaneInput),
    "save_time_tracking_entry" => issues::save_time_tracking_entry(input: issues::TimeEntryInput),
    "schedule_deployment" => pipelines::schedule_deployment(req: pipelines::ScheduleDeploymentRequest),
    "seed_rights" => platform::seed_rights(),
    "set_discussion_resolved" => review::set_discussion_resolved(id: String, resolved: bool),
    "set_issue_tags" => issues::set_issue_tags(issue_id: String, tag_ids: Vec<String>),
    "set_package_repository_acl" => pipelines::set_package_repository_acl(entry: pipelines::PackageRepositoryAcl),
    "set_package_version_pinned" => pipelines::set_package_version_pinned(id: String, pinned: bool),
    "set_meeting_participant_status" => meetings::set_meeting_participant_status(meeting_id: String, profile_id: String, status: String),
    "set_participant_state" => review::set_participant_state(review_id: String, profile_id: String, state: Option<String>),
    "set_role_rights" => platform::set_role_rights(role_id: String, right_codes: Vec<String>),
    "toggle_checklist_item" => issues::toggle_checklist_item(id: String, item_done: bool),
    "transition_deployment" => pipelines::transition_deployment(id: String, status: String),
    "trigger_pipeline_script" => pipelines::trigger_pipeline_script(script_id: String),
    "trigger_pipeline_on_push" => pipelines::trigger_pipeline_on_push(script_id: String, repository: String, branch: String),
    "update_board" => issues::update_board(board: issues::Board),
    "update_cf_definition" => platform::update_cf_definition(definition: platform::CfDefinition),
    "update_channel" => chat::update_channel(channel: chat::Channel),
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
    "update_message" => chat::update_message(id: String, text: String),
    "update_package_repository" => pipelines::update_package_repository(repo: pipelines::PackageRepository),
    "update_pipeline_script" => pipelines::update_pipeline_script(script: pipelines::PipelineScript),
    "update_profile" => platform::update_profile(profile: platform::Profile),
    "update_project" => platform::update_project(project: platform::Project),
    "set_project_deadline" => platform::set_project_deadline(project_id: String, deadline: Option<String>, actor_profile_id: Option<String>),
    "update_project_deadline" => platform::update_project_deadline(project_id: String, expected_deadline: Option<String>, deadline: Option<String>, actor_profile_id: Option<String>),
    "update_quality_gate_rule" => review::update_quality_gate_rule(rule: review::QualityGateRule),
    "update_review" => review::update_review(review: review::Review),
    "update_role" => platform::update_role(role: platform::Role),
    "update_sprint" => issues::update_sprint(sprint: issues::Sprint),
    "update_team" => platform::update_team(team: platform::Team),
    "update_team_membership" => platform::update_team_membership(membership: platform::TeamMembership),
    "update_todo" => personal::update_todo(todo: personal::Todo),
    "set_todo_completion" => personal::set_todo_completion(id: String, done: bool),
    })
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
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('admin','admin',?1,'Administrator','profile-admin','admin',unixepoch())",[hash(&pw).unwrap()]).unwrap();
    }
}
#[tokio::main]
async fn main() {
    let p = env::var("SPACE_DB").unwrap_or_else(|_| "/var/lib/gaia-space/space.db".into());
    db::set_db_path(PathBuf::from(p));
    bootstrap();
    let app = Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/auth/password", post(change_password))
        .route("/api/users", get(users).post(create_user))
        .route("/api/users/{id}", patch(patch_user).delete(delete_user))
        .route("/api/directory", get(directory))
        .route(
            "/api/registry/{repository_id}/generic/{package_name}/{version}/metadata",
            get(registry_generic_metadata),
        )
        .route(
            "/api/registry/{repository_id}/generic/{package_name}/{version}/{filename}",
            put(registry_generic_upload).get(registry_generic_download),
        )
        .route(
            "/api/registry/{repository_id}/npm/{package_name}",
            put(registry_npm_publish).get(registry_npm_metadata),
        )
        .route("/api/cmd/{command}", post(cmd))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use std::sync::{Mutex, OnceLock};
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
            {"recipient_type":"profile","recipient_id":"pb","access_level":"viewer"},
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
        assert_eq!(
            stored_absence("absence-race").unwrap().2,
            true,
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
}
