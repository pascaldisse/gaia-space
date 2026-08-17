use axum::{extract::Path, http::{header, HeaderMap, HeaderValue, StatusCode}, response::IntoResponse, routing::{get, patch, post}, Json, Router};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{SaltString, rand_core::OsRng};
use gaia_space_lib::{db, calls, chat, documents, issues, meetings, personal, pipelines, platform, review};
use rand::RngCore;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Clone)] struct App;
#[derive(Serialize)] struct User { id:String, username:String, display_name:String, profile_id:String, role:String }
#[derive(Deserialize)] struct Login { username:String, password:String }
#[derive(Deserialize)] struct Password { current:String, next:String }
#[derive(Deserialize)] struct CreateUser { username:String, password:String, display_name:String, role:String, profile_id:Option<String> }
#[derive(Deserialize)] struct PatchUser { display_name:Option<String>, role:Option<String>, active:Option<bool>, password:Option<String> }
fn err(code:StatusCode, s:&str)->(StatusCode,Json<Value>){(code,Json(json!({"ok":false,"error":s})))}
fn hash(password:&str)->Result<String,String>{ let salt=SaltString::generate(&mut OsRng); Argon2::default().hash_password(password.as_bytes(),&salt).map(|x|x.to_string()).map_err(|e|e.to_string()) }
fn token()->String { let mut b=[0u8;32]; rand::thread_rng().fill_bytes(&mut b); hex::encode(b) }
fn user_by_token(headers:&HeaderMap)->Result<User, (StatusCode,Json<Value>)> { let t=headers.get(header::COOKIE).and_then(|v|v.to_str().ok()).and_then(|s|s.split(';').find_map(|x|x.trim().strip_prefix("space_session="))).ok_or_else(||err(StatusCode::UNAUTHORIZED,"unauthorized"))?; let c=db::conn().map_err(|e|err(StatusCode::INTERNAL_SERVER_ERROR,&e))?; c.query_row("SELECT u.id,u.username,u.display_name,u.profile_id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?1 AND s.expires_at>unixepoch() AND u.active=1",[t],|r|Ok(User{id:r.get(0)?,username:r.get(1)?,display_name:r.get(2)?,profile_id:r.get(3)?,role:r.get(4)?})).map_err(|_|err(StatusCode::UNAUTHORIZED,"unauthorized")) }
fn admin(h:&HeaderMap)->Result<User,(StatusCode,Json<Value>)>{let u=user_by_token(h)?;if u.role=="admin" {Ok(u)}else{Err(err(StatusCode::FORBIDDEN,"admin required"))}}
async fn login(Json(x):Json<Login>)->impl IntoResponse { let c=match db::conn(){Ok(x)=>x,Err(e)=>return err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response()}; let row=c.query_row("SELECT id,username,password_hash,display_name,profile_id,role FROM users WHERE username=?1 AND active=1",[&x.username],|r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get(4)?,r.get(5)?))); let Ok((id,username,ph,display_name,profile_id,role))=row else { return err(StatusCode::UNAUTHORIZED,"invalid username or password").into_response() }; let ok=PasswordHash::new(&ph).ok().and_then(|p|Argon2::default().verify_password(x.password.as_bytes(),&p).ok()).is_some(); if !ok{return err(StatusCode::UNAUTHORIZED,"invalid username or password").into_response()} let t=token(); let _=c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?1,?2,unixepoch(),unixepoch()+2592000)",params![t,id]); let mut resp=Json(json!({"user":User{id,username,display_name,profile_id,role}})).into_response(); resp.headers_mut().insert(header::SET_COOKIE,match HeaderValue::from_str(&format!("space_session={t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000")){Ok(v)=>v,Err(_)=>return err(StatusCode::INTERNAL_SERVER_ERROR,"cookie").into_response()});resp }
async fn me(h:HeaderMap)->impl IntoResponse{match user_by_token(&h){Ok(u)=>Json(json!({"user":u})).into_response(),Err(e)=>e.into_response()}}
async fn logout(h:HeaderMap)->impl IntoResponse{if let Some(t)=h.get(header::COOKIE).and_then(|v|v.to_str().ok()).and_then(|s|s.split(';').find_map(|x|x.trim().strip_prefix("space_session="))){if let Ok(c)=db::conn(){let _=c.execute("DELETE FROM sessions WHERE token=?1",[t]);}}let mut r=Json(json!({"ok":true})).into_response();r.headers_mut().insert(header::SET_COOKIE,HeaderValue::from_static("space_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"));r}
async fn change_password(h: HeaderMap, Json(x): Json<Password>) -> impl IntoResponse {
    let u = match user_by_token(&h) { Ok(u) => u, Err(e) => return e.into_response() };
    if x.next.len() < 8 { return err(StatusCode::BAD_REQUEST, "password must be at least 8 characters").into_response(); }
    let c = match db::conn() { Ok(c) => c, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    let ph: String = match c.query_row("SELECT password_hash FROM users WHERE id=?1", [&u.id], |r| r.get(0)) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };
    if PasswordHash::new(&ph).ok().and_then(|p| Argon2::default().verify_password(x.current.as_bytes(), &p).ok()).is_none() {
        return err(StatusCode::UNAUTHORIZED, "invalid username or password").into_response();
    }
    let p = match hash(&x.next) { Ok(v) => v, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    if let Err(e) = c.execute("UPDATE users SET password_hash=?1 WHERE id=?2", params![p, u.id]) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    if let Err(e) = c.execute("DELETE FROM sessions WHERE user_id=?1", [&u.id]) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }
    Json(json!({"ok":true})).into_response()
}
async fn users(h:HeaderMap)->impl IntoResponse{if let Err(e)=admin(&h){return e.into_response()}let c=match db::conn(){Ok(c)=>c,Err(e)=>return err(StatusCode::INTERNAL_SERVER_ERROR,&e).into_response()};let mut q=match c.prepare("SELECT id,username,display_name,profile_id,role,active FROM users ORDER BY username"){Ok(q)=>q,Err(e)=>return err(StatusCode::INTERNAL_SERVER_ERROR,&e.to_string()).into_response()};let rows=match q.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"username":r.get::<_,String>(1)?,"display_name":r.get::<_,String>(2)?,"profile_id":r.get::<_,String>(3)?,"role":r.get::<_,String>(4)?,"active":r.get::<_,i64>(5)?==1}))){Ok(m)=>m,Err(e)=>return err(StatusCode::INTERNAL_SERVER_ERROR,&e.to_string()).into_response()};let v:Vec<Value>=rows.filter_map(Result::ok).collect();Json(v).into_response()}
async fn directory(h: HeaderMap) -> impl IntoResponse {
    if let Err(e) = user_by_token(&h) { return e.into_response(); }
    let c = match db::conn() { Ok(c) => c, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    let mut q = match c.prepare("SELECT username,display_name,profile_id FROM users WHERE active=1 ORDER BY display_name,username") {
        Ok(q) => q, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    let rows = match q.query_map([], |r| Ok(json!({"username":r.get::<_,String>(0)?,"display_name":r.get::<_,String>(1)?,"profile_id":r.get::<_,String>(2)?}))) {
        Ok(rows) => rows, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    Json(rows.filter_map(Result::ok).collect::<Vec<_>>()).into_response()
}
async fn create_user(h: HeaderMap, Json(x): Json<CreateUser>) -> impl IntoResponse {
    if let Err(e) = admin(&h) { return e.into_response(); }
    let username = x.username.trim();
    let display_name = x.display_name.trim();
    if username.is_empty() || display_name.is_empty() { return err(StatusCode::BAD_REQUEST, "username and display name are required").into_response(); }
    if x.password.len() < 8 { return err(StatusCode::BAD_REQUEST, "password must be at least 8 characters").into_response(); }
    if !matches!(x.role.as_str(), "admin" | "member") { return err(StatusCode::BAD_REQUEST, "invalid role").into_response(); }
    let c = match db::conn() { Ok(c) => c, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    let id = token();
    let pid = x.profile_id.unwrap_or_else(|| format!("profile-{}", &id[..12]));
    if let Err(e) = c.execute("INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?3,unixepoch())", params![pid, username, display_name]) {
        return err(StatusCode::BAD_REQUEST, &e.to_string()).into_response();
    }
    let password_hash = match hash(&x.password) { Ok(v) => v, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    match c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES(?1,?2,?3,?4,?5,?6,unixepoch())", params![id, username, password_hash, display_name, pid, x.role]) {
        Ok(_) => Json(json!({"id":id})).into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}
async fn delete_user(h: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    let me = match admin(&h) { Ok(u) => u, Err(e) => return e.into_response() };
    if id == me.id { return err(StatusCode::BAD_REQUEST, "cannot delete yourself").into_response(); }
    let c = match db::conn() { Ok(c) => c, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    let target: (String, bool) = match c.query_row("SELECT role,active FROM users WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1))) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return err(StatusCode::NOT_FOUND, "user not found").into_response(),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    let active_admins: i64 = c.query_row("SELECT count(*) FROM users WHERE role='admin' AND active=1", [], |r| r.get(0)).unwrap_or(0);
    if target.0 == "admin" && target.1 && active_admins <= 1 { return err(StatusCode::BAD_REQUEST, "cannot delete last active admin").into_response(); }
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
async fn patch_user(h: HeaderMap, Path(id): Path<String>, Json(x): Json<PatchUser>) -> impl IntoResponse {
    let me = match admin(&h) { Ok(u) => u, Err(e) => return e.into_response() };
    if let Some(role) = x.role.as_deref() {
        if !matches!(role, "admin" | "member") { return err(StatusCode::BAD_REQUEST, "invalid role").into_response(); }
    }
    if x.password.as_ref().is_some_and(|p| p.len() < 8) { return err(StatusCode::BAD_REQUEST, "password must be at least 8 characters").into_response(); }
    let c = match db::conn() { Ok(c) => c, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
    let target: (String, bool) = match c.query_row("SELECT role,active FROM users WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1))) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return err(StatusCode::NOT_FOUND, "user not found").into_response(),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    if id == me.id && x.active == Some(false) { return err(StatusCode::BAD_REQUEST, "cannot deactivate yourself").into_response(); }
    let removes_active_admin = target.0 == "admin" && target.1 && (x.role.as_deref() == Some("member") || x.active == Some(false));
    if removes_active_admin {
        let n: i64 = c.query_row("SELECT count(*) FROM users WHERE role='admin' AND active=1", [], |r| r.get(0)).unwrap_or(0);
        if n <= 1 { return err(StatusCode::BAD_REQUEST, "cannot remove the last active admin").into_response(); }
    }
    if let Some(v) = x.display_name {
        if v.trim().is_empty() { return err(StatusCode::BAD_REQUEST, "display name is required").into_response(); }
        if let Err(e) = c.execute("UPDATE users SET display_name=?1 WHERE id=?2", params![v.trim(), id]) { return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(); }
    }
    if let Some(v) = x.role { if let Err(e) = c.execute("UPDATE users SET role=?1 WHERE id=?2", params![v, id]) { return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(); } }
    if let Some(v) = x.active { if let Err(e) = c.execute("UPDATE users SET active=?1 WHERE id=?2", params![v as i32, id]) { return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(); } }
    if let Some(v) = x.password {
        let h = match hash(&v) { Ok(h) => h, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response() };
        if let Err(e) = c.execute("UPDATE users SET password_hash=?1 WHERE id=?2", params![h, id]) { return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(); }
        if let Err(e) = c.execute("DELETE FROM sessions WHERE user_id=?1", [&id]) { return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(); }
    }
    Json(json!({"ok":true})).into_response()
}
fn to_camel(s:&str)->String{let mut out=String::new();let mut up=false;for ch in s.chars(){if ch=='_'{up=true}else if up{out.extend(ch.to_uppercase());up=false}else{out.push(ch)}}out}
fn arg<T: serde::de::DeserializeOwned>(body:&Value, name:&str)->Result<T,String>{
    let camel=to_camel(name);
    let v=body.get(name).or_else(||body.get(camel.as_str())).cloned().unwrap_or(Value::Null);
    serde_json::from_value(v).map_err(|e|format!("invalid argument `{name}`: {e}"))
}
fn put_arg(body: &mut Value, name: &str, value: Value) {
    if let Some(object) = body.as_object_mut() { object.insert(name.to_string(), value); }
}
fn chat_channel_type(channel_id: &str) -> Option<String> {
    db::conn().ok()?.query_row("SELECT content_type FROM channels WHERE id=?1 AND archived=0", [channel_id], |r| r.get(0)).ok()
}
fn chat_channel_access(profile_id: &str, channel_id: &str) -> bool {
    let Some(content_type) = chat_channel_type(channel_id) else { return false };
    if matches!(content_type.as_str(), "public" | "entity-bound") { return true; }
    let Ok(c) = db::conn() else { return false };
    c.query_row("SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id=?1 AND profile_id=?2)", params![channel_id, profile_id], |r| r.get::<_, bool>(0)).unwrap_or(false)
}
/// Todo authorization policy (web mode), enforced entirely from the session:
/// * identity — `profile_id` on the request body is always overwritten with the session profile,
///   so a client can neither read as, nor create todos for, somebody else.
/// * read (`list_todos`, `dashboard_aggregate`) — owner **or** assignee, via the query itself.
/// * write/delete (`update_todo`, `delete_todo`) — owner only; assignees may not edit or delete.
///
/// A todo that exists but belongs to somebody else is answered with 403, exactly like a
/// missing one, so ownership is never disclosed.
fn todo_owned_by(profile_id: &str, todo_id: &str) -> bool {
    personal::todo_owner(todo_id).ok().flatten().is_some_and(|owner| owner == profile_id)
}
fn chat_message_channel(message_id: &str) -> Option<String> {
    db::conn().ok()?.query_row("SELECT channel_id FROM messages WHERE id=?1", [message_id], |r| r.get(0)).ok()
}
fn chat_message_owned(profile_id: &str, message_id: &str) -> bool {
    let Ok(c) = db::conn() else { return false };
    c.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1 AND author_id=?2)", params![message_id, profile_id], |r| r.get::<_, bool>(0)).unwrap_or(false)
}
fn chat_can_manage(profile_id: &str, channel_id: &str) -> bool {
    let Ok(c) = db::conn() else { return false };
    let member: Option<bool> = c.query_row("SELECT administrator FROM channel_members WHERE channel_id=?1 AND profile_id=?2", params![channel_id, profile_id], |r| r.get(0)).ok();
    let admins: i64 = c.query_row("SELECT COUNT(*) FROM channel_members WHERE channel_id=?1 AND administrator=1", [channel_id], |r| r.get(0)).unwrap_or(0);
    member.is_some_and(|administrator| administrator || admins == 0)
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
async fn cmd(h:HeaderMap,Path(name):Path<String>,Json(body):Json<Value>)->impl IntoResponse{
    let user = match user_by_token(&h) { Ok(user) => user, Err(e) => return e.into_response() };
    if name.starts_with("repo_") || matches!(name.as_str(),
        "app_info" | "join_meeting_call" | "start_livekit_server" |
        "trigger_pipeline_script" | "review_diff" | "dry_run_merge" |
        "attempt_merge" | "open_merge_request" | "list_channels"
    ) { return err(StatusCode::NOT_IMPLEMENTED, "not available in web mode").into_response(); }
    let profile_id = user.profile_id.clone();
    let mut body = body;
    match name.as_str() {
        "list_channels_with_meta" => put_arg(&mut body, "profile_id", json!(profile_id)),
        "list_messages" | "list_thread_replies" => put_arg(&mut body, "acting_profile_id", json!(profile_id)),
        "mark_channel_read" | "join_channel" | "leave_channel" | "add_reaction" | "remove_reaction" =>
            put_arg(&mut body, "profile_id", json!(profile_id)),
        "create_message" => {
            if let Some(message) = body.get_mut("message").and_then(Value::as_object_mut) {
                message.insert("author_id".into(), json!(profile_id));
            }
        }
        "list_todos" | "dashboard_aggregate" => put_arg(&mut body, "profile_id", json!(profile_id)),
        "create_todo" => {
            if let Some(input) = body.get_mut("input").and_then(Value::as_object_mut) {
                input.insert("profile_id".into(), json!(profile_id));
            }
        }
        "update_todo" => {
            if let Some(todo) = body.get_mut("todo").and_then(Value::as_object_mut) {
                todo.insert("profile_id".into(), json!(profile_id));
            }
        }
        "create_channel" => {
            let supplied: Vec<String> = arg(&body, "member_ids").unwrap_or_default();
            let mut members = vec![profile_id.clone()];
            for id in supplied { if id != profile_id && !members.contains(&id) { members.push(id); } }
            let content_type = body.get("channel").and_then(|v| v.get("content_type")).and_then(Value::as_str).unwrap_or("");
            if content_type == "dm" && members.len() != 2 {
                return err(StatusCode::BAD_REQUEST, "a direct message requires exactly one recipient").into_response();
            }
            put_arg(&mut body, "member_ids", json!(members));
        }
        _ => {}
    }
    if matches!(name.as_str(), "list_messages" | "list_channel_members" | "get_channel" | "mark_channel_read" | "join_channel" | "leave_channel") {
        let key = if name == "get_channel" { "id" } else { "channel_id" };
        let channel_id: String = match arg(&body, key) { Ok(id) => id, Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response() };
        if !chat_channel_access(&profile_id, &channel_id) {
            return err(StatusCode::FORBIDDEN, "channel access denied").into_response();
        }
    }
    if name == "list_thread_replies" {
        let thread_of: String = match arg(&body, "thread_of") { Ok(id) => id, Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response() };
        if !chat_message_channel(&thread_of).is_some_and(|channel_id| chat_channel_access(&profile_id, &channel_id)) {
            return err(StatusCode::FORBIDDEN, "channel access denied").into_response();
        }
    }
    if matches!(name.as_str(), "add_reaction" | "remove_reaction") {
        let message_id: String = match arg(&body, "message_id") { Ok(id) => id, Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response() };
        if !chat_message_channel(&message_id).is_some_and(|channel_id| chat_channel_access(&profile_id, &channel_id)) {
            return err(StatusCode::FORBIDDEN, "channel access denied").into_response();
        }
    }
    if matches!(name.as_str(), "update_message" | "delete_message") {
        let id: String = match arg(&body, "id") { Ok(id) => id, Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response() };
        if !chat_message_owned(&profile_id, &id) {
            return err(StatusCode::FORBIDDEN, "only the author can change this message").into_response();
        }
    }
    if matches!(name.as_str(), "update_todo" | "delete_todo") {
        let todo_id: Option<String> = if name == "update_todo" {
            body.get("todo").and_then(|todo| todo.get("id")).and_then(Value::as_str).map(str::to_string)
        } else {
            arg(&body, "id").ok()
        };
        let Some(todo_id) = todo_id else { return err(StatusCode::BAD_REQUEST, "invalid argument `id`").into_response() };
        if !todo_owned_by(&profile_id, &todo_id) {
            return err(StatusCode::FORBIDDEN, "only the owner can change this todo").into_response();
        }
    }
    if matches!(name.as_str(), "add_channel_member" | "remove_channel_member") {
        let channel_id: String = match arg(&body, "channel_id") { Ok(id) => id, Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response() };
        let target: String = match arg(&body, "profile_id") { Ok(id) => id, Err(e) => return err(StatusCode::BAD_REQUEST, &e).into_response() };
        let removing_self = name == "remove_channel_member" && target == profile_id;
        if chat_channel_type(&channel_id).as_deref() == Some("dm") || (!removing_self && !chat_can_manage(&profile_id, &channel_id)) {
            return err(StatusCode::FORBIDDEN, "channel membership is fixed or requires a channel administrator").into_response();
        }
    }
    dispatch!(name.as_str(), body, {
    "add_channel_member" => chat::add_channel_member(channel_id: String, profile_id: String, administrator: bool),
    "add_issue_child" => issues::add_issue_child(parent_id: String, child_id: String),
    "add_reaction" => chat::add_reaction(message_id: String, profile_id: String, emoji: String),
    "add_review_participant" => review::add_review_participant(participant: review::ReviewParticipant),
    "add_team_membership" => platform::add_team_membership(input: platform::TeamMembershipInput),
    "archive_cf_definition" => platform::archive_cf_definition(id: String, archived: bool),
    "archive_document" => documents::archive_document(id: String, archived: bool),
    "archive_issue" => issues::archive_issue(id: String, archived: bool),
    "archive_meeting" => meetings::archive_meeting(id: String, archived: bool),
    "archive_role" => platform::archive_role(id: String, archived: bool),
    "archive_sprint" => issues::archive_sprint(id: String, archived: bool),
    "archive_team" => platform::archive_team(id: String, archived: bool),
    "attempt_merge" => review::attempt_merge(id: String, repo_path: String, review_id: String, source_branch: String, target_branch: String),
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
    "create_message" => chat::create_message(message: chat::Message),
    "create_package_repository" => pipelines::create_package_repository(repo: pipelines::PackageRepository),
    "create_pipeline_script" => pipelines::create_pipeline_script(script: pipelines::PipelineScript),
    "create_profile" => platform::create_profile(profile: platform::Profile),
    "create_project" => platform::create_project(project: platform::Project),
    "create_quality_gate_rule" => review::create_quality_gate_rule(rule: review::QualityGateRule),
    "create_review" => review::create_review(review: review::Review),
    "create_review_discussion" => review::create_review_discussion(discussion: review::NewDiscussion),
    "create_role" => platform::create_role(input: platform::RoleInput),
    "create_role_assignment" => platform::create_role_assignment(input: platform::RoleAssignmentInput),
    "create_sprint" => issues::create_sprint(input: issues::SprintInput),
    "create_team" => platform::create_team(input: platform::TeamInput),
    "create_todo" => personal::create_todo(input: personal::TodoInput),
    "current_absences" => personal::current_absences(date: String),
    "dashboard_aggregate" => personal::dashboard_aggregate(profile_id: String),
    "delete_absence" => personal::delete_absence(id: String),
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
    "expand_meeting_occurrences" => meetings::expand_meeting_occurrences(range_start: i64, range_end: i64),
    "get_channel" => chat::get_channel(id: String),
    "get_channel_by_entity" => chat::get_channel_by_entity(entity_type: String, entity_id: String),
    "get_document" => documents::get_document(id: String),
    "get_issue" => issues::get_issue(id: String),
    "get_issue_detail" => issues::get_issue_detail(id: String),
    "get_meeting" => meetings::get_meeting(id: String),
    "get_profile" => platform::get_profile(id: String),
    "get_project" => platform::get_project(id: String),
    "get_review" => review::get_review(id: String),
    "get_role" => platform::get_role(id: String),
    "get_team" => platform::get_team(id: String),
    "goto_search" => personal::goto_search(query: String, limit: Option<i64>),
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
    "list_doc_versions" => documents::list_doc_versions(document_id: String),
    "list_document_folders" => documents::list_document_folders(),
    "list_documents" => documents::list_documents(),
    "list_issue_statuses" => issues::list_issue_statuses(project_id: Option<String>),
    "list_issues" => issues::list_issues(project_id: Option<String>, text: Option<String>, status_id: Option<String>, assignee_id: Option<String>, tag_id: Option<String>, include_archived: Option<bool>),
    "list_job_runs" => pipelines::list_job_runs(),
    "list_job_runs_for_script" => pipelines::list_job_runs_for_script(script_id: String),
    "list_jobs" => pipelines::list_jobs(),
    "list_jobs_for_script" => pipelines::list_jobs_for_script(script_id: String),
    "list_meeting_participants" => meetings::list_meeting_participants(meeting_id: String),
    "list_meetings" => meetings::list_meetings(),
    "list_messages" => chat::list_messages(channel_id: String, acting_profile_id: Option<String>),
    "list_notifications" => personal::list_notifications(recipient_id: String, unread_only: Option<bool>),
    "list_package_repositories" => pipelines::list_package_repositories(),
    "list_package_versions" => pipelines::list_package_versions(repository_id: String, query: Option<String>),
    "list_pipeline_scripts" => pipelines::list_pipeline_scripts(),
    "list_planning_tags" => issues::list_planning_tags(project_id: String),
    "list_profiles" => platform::list_profiles(),
    "list_projects" => platform::list_projects(),
    "list_quality_gate_rules" => review::list_quality_gate_rules(project_id: String),
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
    "livekit_server_status" => calls::livekit_server_status(config: Option<calls::LivekitConfig>),
    "mark_channel_read" => chat::mark_channel_read(channel_id: String, profile_id: String, message_id: Option<String>),
    "mark_notification_read" => personal::mark_notification_read(id: String),
    "move_document" => documents::move_document(id: String, container_type: String, container_id: Option<String>, folder_id: Option<String>),
    "move_document_folder" => documents::move_document_folder(id: String, parent_id: Option<String>),
    "move_issue_on_board" => issues::move_issue_on_board(board_id: String, issue_id: String, column_id: String, sprint_id: Option<String>, swimlane_id: Option<String>, position: Option<i64>),
    "open_merge_request" => review::open_merge_request(req: review::NewMergeRequest),
    "publish_package_version" => pipelines::publish_package_version(repository_id: String, package_name: String, version: String, metadata_json: Option<String>, payload_filename: Option<String>, payload_content: Option<String>),
    "remove_channel_member" => chat::remove_channel_member(channel_id: String, profile_id: String),
    "remove_issue_from_board" => issues::remove_issue_from_board(board_id: String, issue_id: String),
    "remove_issue_link" => issues::remove_issue_link(id: String),
    "remove_reaction" => chat::remove_reaction(message_id: String, profile_id: String, emoji: String),
    "remove_team_membership" => platform::remove_team_membership(id: String),
    "restore_doc_version" => documents::restore_doc_version(document_id: String, version: i64, actor: Option<String>),
    "review_diff" => review::review_diff(repo_path: String, source_branch: String, target_branch: String),
    "save_board_column" => issues::save_board_column(input: issues::ColumnInput),
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
    "set_meeting_participant_status" => meetings::set_meeting_participant_status(meeting_id: String, profile_id: String, status: String),
    "set_participant_state" => review::set_participant_state(review_id: String, profile_id: String, state: Option<String>),
    "set_role_rights" => platform::set_role_rights(role_id: String, right_codes: Vec<String>),
    "toggle_checklist_item" => issues::toggle_checklist_item(id: String, item_done: bool),
    "transition_deployment" => pipelines::transition_deployment(id: String, status: String),
    "trigger_pipeline_script" => pipelines::trigger_pipeline_script(script_id: String),
    "update_absence" => personal::update_absence(absence: personal::Absence),
    "update_board" => issues::update_board(board: issues::Board),
    "update_cf_definition" => platform::update_cf_definition(definition: platform::CfDefinition),
    "update_channel" => chat::update_channel(channel: chat::Channel),
    "update_deploy_target" => pipelines::update_deploy_target(target: pipelines::DeployTarget),
    "update_document" => documents::update_document(document: documents::Document),
    "update_document_folder" => documents::update_document_folder(folder: documents::DocumentFolder),
    "update_issue" => issues::update_issue(issue: issues::Issue),
    "update_issue_status" => issues::update_issue_status(status: issues::IssueStatus),
    "update_meeting" => meetings::update_meeting(meeting: meetings::Meeting),
    "update_message" => chat::update_message(id: String, text: String),
    "update_package_repository" => pipelines::update_package_repository(repo: pipelines::PackageRepository),
    "update_pipeline_script" => pipelines::update_pipeline_script(script: pipelines::PipelineScript),
    "update_profile" => platform::update_profile(profile: platform::Profile),
    "update_project" => platform::update_project(project: platform::Project),
    "update_quality_gate_rule" => review::update_quality_gate_rule(rule: review::QualityGateRule),
    "update_review" => review::update_review(review: review::Review),
    "update_role" => platform::update_role(role: platform::Role),
    "update_sprint" => issues::update_sprint(sprint: issues::Sprint),
    "update_team" => platform::update_team(team: platform::Team),
    "update_team_membership" => platform::update_team_membership(membership: platform::TeamMembership),
    "update_todo" => personal::update_todo(todo: personal::Todo),
    })
}
fn bootstrap(){let c=db::conn().expect("database");db::seed(&c).expect("seed");let _=platform::seed_rights();let n:i64=c.query_row("SELECT count(*) FROM users",[],|r|r.get(0)).unwrap();if n==0{let pw=env::var("SPACE_ADMIN_PASSWORD").unwrap_or_else(|_|{let p=token();println!("SPACE_ADMIN_PASSWORD={p}");p});c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('admin','admin',?1,'Administrator','default-org','admin',unixepoch())",[hash(&pw).unwrap()]).unwrap();}}
#[tokio::main] async fn main(){let p=env::var("SPACE_DB").unwrap_or_else(|_|"/var/lib/gaia-space/space.db".into());db::set_db_path(PathBuf::from(p));bootstrap();let app=Router::new().route("/api/auth/login",post(login)).route("/api/auth/logout",post(logout)).route("/api/auth/me",get(me)).route("/api/auth/password",post(change_password)).route("/api/users",get(users).post(create_user)).route("/api/users/{id}",patch(patch_user).delete(delete_user)).route("/api/directory",get(directory)).route("/api/cmd/{command}",post(cmd)).with_state(App);let port=env::var("SPACE_PORT").ok().and_then(|x|x.parse().ok()).unwrap_or(8090);axum::serve(tokio::net::TcpListener::bind(SocketAddr::from(([127,0,0,1],port))).await.unwrap(),app).await.unwrap();}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    fn cookie(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(&format!("space_session={token}")).unwrap());
        headers
    }
    async fn status_and_body(response: axum::response::Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }
    async fn call(headers: HeaderMap, command: &str, body: Value) -> (StatusCode, Value) {
        status_and_body(cmd(headers, Path(command.to_string()), Json(body)).await.into_response()).await
    }
    /// One database for the whole binary's test run: `db::set_db_path` is process-global,
    /// so the HTTP cases below run as a single sequential scenario.
    fn setup() {
        let path = env::temp_dir().join(format!("gaia-space-server-test-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        db::set_db_path(path);
        let c = db::conn().expect("database");
        db::seed(&c).expect("seed");
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','alice','Alice',1),('pb','bob','Bob',1)", []).unwrap();
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,active,created_at) VALUES('ua','alice','x','Alice','pa','member',1,1),('ub','bob','x','Bob','pb','member',1,1)", []).unwrap();
        c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES('ta','ua',unixepoch(),unixepoch()+3600),('tb','ub',unixepoch(),unixepoch()+3600)", []).unwrap();
    }

    #[tokio::test]
    async fn todo_endpoints_bind_the_session_profile_and_refuse_foreign_todos() {
        setup();
        // Unauthenticated access is rejected before any command runs.
        let (status, _) = call(HeaderMap::new(), "list_todos", json!({})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // Spoofed owner and spoofed assignee-owner are both replaced by the session profile.
        let (status, value) = call(cookie("ta"), "create_todo", json!({"input":{"profile_id":"pb","content":"Alice task","done":false,"assignee_ids":["pb"]}})).await;
        assert_eq!(status, StatusCode::OK, "{value}");
        let todo = value["value"].clone();
        assert_eq!(todo["profile_id"], json!("pa"), "client-supplied owner must be ignored");
        let todo_id = todo["id"].as_str().unwrap().to_string();

        // Reads are scoped to the caller: Bob asking for Alice's list gets his own view.
        let (status, value) = call(cookie("tb"), "list_todos", json!({"profile_id":"pa","include_done":true})).await;
        assert_eq!(status, StatusCode::OK);
        // Bob is an assignee of that todo, so he may read it — but owns nothing else.
        let ids: Vec<String> = value["value"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec![todo_id.clone()]);

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
        let content: String = c.query_row("SELECT content FROM todos WHERE id=?1", [&todo_id], |r| r.get(0)).unwrap();
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
        let orphans: i64 = c.query_row("SELECT count(*) FROM todo_assignees", [], |r| r.get(0)).unwrap();
        assert_eq!(orphans, 0);
    }
}
