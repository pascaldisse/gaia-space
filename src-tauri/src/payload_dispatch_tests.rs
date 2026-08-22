//! Tests for the typed payload dispatcher and the per-app signing key ring.
#![cfg(test)]
use crate::applications::{
    app_signing_key_on, dispatch_body, rotate_app_signing_key_on, sign_app_payload,
    verify_app_payload_signature, ApplicationPayload,
};
use crate::db;
use crate::payload_dispatch::{dispatch_with, Headers};
use std::sync::{Mutex, OnceLock};

fn conn() -> rusqlite::Connection {
    let c = db::open_in_memory().unwrap();
    db::migrate(&c).unwrap();
    c.execute("INSERT INTO applications(id,name,application_type,client_id,endpoint_uri) VALUES('app','App','Application','client-1','https://app.example/endpoint')", []).unwrap();
    c.execute("INSERT INTO applications(id,name,application_type,client_id) VALUES('bare','Bare','Application','client-2')", []).unwrap();
    c
}

/// Every payload of the family, in wire form.
fn samples() -> Vec<(&'static str, String)> {
    vec![
        ("InitPayload", r#"{"className":"InitPayload","serverUrl":"https://space.example","clientId":"client-1"}"#.into()),
        ("WebhookRequestPayload", r#"{"className":"WebhookRequestPayload","webhookId":"w1","eventType":"issue.created","payload":{"id":"i1"}}"#.into()),
        ("MessagePayload", r#"{"className":"MessagePayload","userId":"u1","channelId":"c1","text":"/deploy"}"#.into()),
        ("ListCommandsPayload", r#"{"className":"ListCommandsPayload","userId":"u1"}"#.into()),
        ("MenuActionPayload", r#"{"className":"MenuActionPayload","actionId":"a1","userId":"u1"}"#.into()),
        ("UnfurlActionPayload", r#"{"className":"UnfurlActionPayload","userId":"u1","links":["https://x.example/1"]}"#.into()),
        ("CustomPayload", r#"{"className":"CustomPayload","data":{"k":1}}"#.into()),
        ("ApplicationUninstalledPayload", r#"{"className":"ApplicationUninstalledPayload","serverUrl":"https://space.example"}"#.into()),
        ("ExternalIssuePayload", r#"{"className":"ExternalIssuePayload","issueIds":["E-1"],"action":"IMPORT"}"#.into()),
    ]
}

/// Captured outbound request, so the transport stub can be a plain `fn`.
fn captured() -> &'static Mutex<Vec<(String, String, String, String, i64)>> {
    static CAPTURED: OnceLock<Mutex<Vec<(String, String, String, String, i64)>>> = OnceLock::new();
    CAPTURED.get_or_init(|| Mutex::new(Vec::new()))
}

fn record(endpoint: &str, headers: &Headers, body: &str) -> Result<(i64, String), String> {
    captured().lock().unwrap().push((
        endpoint.to_string(),
        headers.class_name.clone(),
        headers.signature.clone(),
        body.to_string(),
        headers.timestamp,
    ));
    Ok((200, "{\"ok\":true}".into()))
}

fn fail(_e: &str, _h: &Headers, _b: &str) -> Result<(i64, String), String> {
    Err("connection refused".into())
}

#[test]
fn every_payload_class_round_trips_and_dispatches_signed() {
    let c = conn();
    let key = app_signing_key_on(&c, "app").unwrap();
    for (class_name, json) in samples() {
        let parsed: ApplicationPayload = serde_json::from_str(&json).expect(class_name);
        assert_eq!(parsed.class_name(), class_name);
        // Re-parsing the canonical body yields the same value: the tag survives a trip.
        let body = dispatch_body(&parsed).unwrap();
        assert_eq!(
            serde_json::from_str::<ApplicationPayload>(&body).unwrap(),
            parsed
        );

        captured().lock().unwrap().clear();
        let result = dispatch_with(&c, "app", &json, record).expect("dispatch");
        assert_eq!(result.class_name, class_name);
        assert_eq!(result.response_status, Some(200));
        assert!(result.error.is_none(), "{class_name}: {:?}", result.error);
        let sent = captured().lock().unwrap().pop().expect("one request");
        assert_eq!(sent.0, "https://app.example/endpoint");
        assert_eq!(sent.1, class_name);
        // Independent verification path: the public key alone validates what was sent.
        assert!(
            verify_app_payload_signature(&key.public_key, sent.4, &sent.3, &sent.2),
            "{class_name} signature must verify under the published public key"
        );
        assert!(!verify_app_payload_signature(
            &key.public_key,
            sent.4,
            &format!("{} ", sent.3),
            &sent.2
        ));
    }
}

#[test]
fn an_unknown_class_name_never_reaches_the_endpoint() {
    let c = conn();
    captured().lock().unwrap().clear();
    let error = dispatch_with(&c, "app", r#"{"className":"NopePayload"}"#, record).unwrap_err();
    assert!(error.contains("unsupported application payload"), "{error}");
    assert!(captured().lock().unwrap().is_empty());
}

#[test]
fn an_application_without_an_endpoint_cannot_be_dispatched_to() {
    let c = conn();
    let json = samples()[0].1.clone();
    assert_eq!(
        dispatch_with(&c, "bare", &json, record).unwrap_err(),
        "application has no endpoint URI"
    );
    assert_eq!(
        dispatch_with(&c, "ghost", &json, record).unwrap_err(),
        "application not found"
    );
}

#[test]
fn a_transport_failure_is_recorded_rather_than_raised() {
    let c = conn();
    let json = samples()[0].1.clone();
    let result = dispatch_with(&c, "app", &json, fail).expect("dispatch result");
    assert_eq!(result.error.as_deref(), Some("connection refused"));
    assert!(result.response_status.is_none());
}

#[test]
fn rotation_publishes_a_new_key_and_keeps_the_previous_public_key() {
    let c = conn();
    let first = app_signing_key_on(&c, "app").unwrap();
    assert!(first.previous_public_key.is_none());
    // Reading twice must not regenerate: the key is stable until rotated.
    assert_eq!(app_signing_key_on(&c, "app").unwrap(), first);

    let second = rotate_app_signing_key_on(&c, "app").unwrap();
    assert_ne!(second.key_id, first.key_id);
    assert_ne!(second.public_key, first.public_key);
    assert_eq!(second.previous_key_id.as_deref(), Some(first.key_id.as_str()));
    assert_eq!(
        second.previous_public_key.as_deref(),
        Some(first.public_key.as_str())
    );

    // Signatures now verify under the new key and not under the retired one.
    let (key_id, signature) = sign_app_payload(&c, "app", 1_700_000_000, "body").unwrap();
    assert_eq!(key_id, second.key_id);
    assert!(verify_app_payload_signature(
        &second.public_key,
        1_700_000_000,
        "body",
        &signature
    ));
    assert!(!verify_app_payload_signature(
        &first.public_key,
        1_700_000_000,
        "body",
        &signature
    ));
}

#[test]
fn the_private_key_is_never_exposed_through_the_public_view() {
    let c = conn();
    let key = app_signing_key_on(&c, "app").unwrap();
    let stored: String = c
        .query_row(
            "SELECT private_key FROM app_signing_keys WHERE application_id='app'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let json = serde_json::to_string(&key).unwrap();
    assert!(!json.contains(&stored));
    assert!(!json.contains("private"));
}

#[test]
fn a_signing_key_requires_a_real_application() {
    let c = conn();
    assert_eq!(
        app_signing_key_on(&c, "ghost").unwrap_err(),
        "application not found"
    );
}
