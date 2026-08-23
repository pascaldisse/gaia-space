//! Tests for the chatbot slash-command callback (KB §07 §2.2 `ListCommandsPayload`).
#![cfg(test)]
use crate::chatbot::{list_commands_on, CommandDetail};
use crate::payload_dispatch::Headers;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// The egress guard reads process environment, which is global.
fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The last outbound body, so a test can assert the payload really was a
/// `ListCommandsPayload` carrying the typed prefix.
fn last_body() -> &'static Mutex<Option<String>> {
    static BODY: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    BODY.get_or_init(|| Mutex::new(None))
}

fn conn() -> rusqlite::Connection {
    std::env::set_var(crate::payload_dispatch::ALLOW_PRIVATE_ENDPOINTS_ENV, "1");
    let c = crate::db::open_in_memory().unwrap();
    crate::db::migrate(&c).unwrap();
    c.execute(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES('u1','u1','User One',1)",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO applications(id,name,application_type,client_id,endpoint_uri) VALUES('app','App','Application','client-1','https://app.example/endpoint')", []).unwrap();
    c.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('bare','Bare','Application','client-2')", []).unwrap();
    c.execute("INSERT INTO chatbot_registrations(id,application_id,display_name,commands_json,enabled) VALUES('bot','app','Deploy bot','[{\"name\":\"deploy\",\"description\":\"declared\"},{\"name\":\"decommission\",\"description\":\"declared\"},{\"name\":\"help\",\"description\":\"declared\"}]',1)", []).unwrap();
    c.execute("INSERT INTO chatbot_registrations(id,application_id,display_name,commands_json,enabled) VALUES('off','app','Off bot','[]',0)", []).unwrap();
    c.execute("INSERT INTO chatbot_registrations(id,application_id,display_name,commands_json,enabled) VALUES('nobody','bare','Endpointless','[{\"name\":\"only\",\"description\":\"declared\"}]',1)", []).unwrap();
    c
}

fn answering(
    _endpoint: &str,
    _headers: &Headers,
    body: &str,
) -> std::result::Result<(i64, String), String> {
    *last_body().lock().unwrap() = Some(body.to_string());
    Ok((
        200,
        r#"{"className":"Commands","commands":[{"name":"status","description":"live"},{"name":"deploy","description":"live"},{"name":"deploy","description":"dup"}]}"#
            .to_string(),
    ))
}

fn bare_list(
    _endpoint: &str,
    _headers: &Headers,
    _body: &str,
) -> std::result::Result<(i64, String), String> {
    Ok((200, r#"[{"name":"run","description":"bare"}]"#.to_string()))
}

fn refusing(
    _endpoint: &str,
    _headers: &Headers,
    _body: &str,
) -> std::result::Result<(i64, String), String> {
    Err("connection refused".into())
}

fn garbage(
    _endpoint: &str,
    _headers: &Headers,
    _body: &str,
) -> std::result::Result<(i64, String), String> {
    Ok((200, "<html>not json</html>".to_string()))
}

fn names(commands: &[CommandDetail]) -> Vec<&str> {
    commands.iter().map(|c| c.name.as_str()).collect()
}

/// The live answer wins over the declared fallback, is de-duplicated and sorted, and the
/// dispatched body is the typed `ListCommandsPayload` with the user's prefix.
#[test]
fn a_typed_slash_prefix_reaches_the_app_and_its_answer_is_what_autocompletes() {
    let _guard = env_lock();
    let c = conn();
    let listing = list_commands_on(&c, "bot", "u1", Some("/de"), answering).unwrap();
    assert_eq!(listing.source, "app");
    assert_eq!(listing.error, None);
    assert_eq!(names(&listing.commands), vec!["deploy"]);
    assert_eq!(listing.commands[0].description, "live");
    let body = last_body().lock().unwrap().clone().unwrap();
    let sent: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(sent["className"], "ListCommandsPayload");
    assert_eq!(sent["userId"], "u1");
    assert_eq!(sent["prefix"], "/de");
}

/// An older SDK answers with a bare list rather than the wrapped `Commands` object.
#[test]
fn a_bare_command_list_is_accepted_as_well_as_the_wrapped_object() {
    let _guard = env_lock();
    let c = conn();
    let listing = list_commands_on(&c, "bot", "u1", None, bare_list).unwrap();
    assert_eq!(listing.source, "app");
    assert_eq!(names(&listing.commands), vec!["run"]);
}

/// A dead endpoint must not empty the slash menu: the declared list answers instead, and
/// the failure is reported rather than swallowed.
#[test]
fn a_dead_endpoint_falls_back_to_the_declared_commands_and_says_so() {
    let _guard = env_lock();
    let c = conn();
    let listing = list_commands_on(&c, "bot", "u1", Some("de"), refusing).unwrap();
    assert_eq!(listing.source, "registration");
    assert!(listing.error.unwrap().contains("connection refused"));
    assert_eq!(names(&listing.commands), vec!["decommission", "deploy"]);
}

/// An unreadable body is the same failure as no body at all.
#[test]
fn an_unreadable_commands_response_falls_back_too() {
    let _guard = env_lock();
    let c = conn();
    let listing = list_commands_on(&c, "bot", "u1", None, garbage).unwrap();
    assert_eq!(listing.source, "registration");
    assert!(listing.error.unwrap().contains("unreadable"));
    assert_eq!(
        names(&listing.commands),
        vec!["decommission", "deploy", "help"]
    );
}

/// An app with no endpoint can never be asked; the declared list still autocompletes.
#[test]
fn a_chatbot_whose_app_has_no_endpoint_still_autocompletes_from_its_registration() {
    let _guard = env_lock();
    let c = conn();
    let listing = list_commands_on(&c, "nobody", "u1", None, answering).unwrap();
    assert_eq!(listing.source, "registration");
    assert_eq!(names(&listing.commands), vec!["only"]);
}

/// A disabled bot is not a bot: it must not appear in the menu at all.
#[test]
fn a_disabled_chatbot_answers_nothing() {
    let _guard = env_lock();
    let c = conn();
    assert_eq!(
        list_commands_on(&c, "off", "u1", None, answering).unwrap_err(),
        "chatbot is disabled"
    );
    assert_eq!(
        list_commands_on(&c, "ghost", "u1", None, answering).unwrap_err(),
        "chatbot not found"
    );
}

/// ☎Kali-VIII A1: the desktop IPC caller has no session to be rebound from, so the
/// identity announced to a third-party endpoint is checked here — an invented profile
/// never reaches a bot, and no payload is dispatched for it.
#[test]
fn an_invented_typist_is_never_announced_to_a_bot() {
    let _guard = env_lock();
    let c = conn();
    *last_body().lock().unwrap() = None;
    assert_eq!(
        list_commands_on(&c, "bot", "not-a-profile", Some("/de"), answering).unwrap_err(),
        "unknown profile"
    );
    assert!(last_body().lock().unwrap().is_none());
}
