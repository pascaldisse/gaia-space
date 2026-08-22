//! Tests for the typed payload dispatcher and the per-app signing key ring.
#![cfg(test)]
use crate::applications::{
    app_signing_key_on, dispatch_body, rotate_app_signing_key_on, sign_app_payload,
    verify_app_payload_signature, ApplicationPayload,
};
use crate::db;
use crate::payload_dispatch::{dispatch_with, Headers};
use std::sync::{Mutex, OnceLock};

/// The egress guard reads process environment, which is global: every test that dispatches
/// holds this lock so the switches one test sets are never observed by another.
fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn conn() -> rusqlite::Connection {
    // The example endpoints below never resolve; these tests are about signing and the
    // dispatch path, so the egress guard is relaxed for them and exercised on its own in
    // `the_egress_guard_*` tests, which set the switches explicitly.
    std::env::set_var(crate::payload_dispatch::ALLOW_PRIVATE_ENDPOINTS_ENV, "1");
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

/// One captured outbound request: endpoint, class name, signature, body, timestamp.
struct Sent {
    endpoint: String,
    class_name: String,
    signature: String,
    body: String,
    timestamp: i64,
}

/// Captured outbound requests, so the transport stub can be a plain `fn`.
fn captured() -> &'static Mutex<Vec<Sent>> {
    static CAPTURED: OnceLock<Mutex<Vec<Sent>>> = OnceLock::new();
    CAPTURED.get_or_init(|| Mutex::new(Vec::new()))
}

fn record(endpoint: &str, headers: &Headers, body: &str) -> Result<(i64, String), String> {
    captured().lock().unwrap().push(Sent {
        endpoint: endpoint.to_string(),
        class_name: headers.class_name.clone(),
        signature: headers.signature.clone(),
        body: body.to_string(),
        timestamp: headers.timestamp,
    });
    Ok((200, "{\"ok\":true}".into()))
}

fn fail(_e: &str, _h: &Headers, _b: &str) -> Result<(i64, String), String> {
    Err("connection refused".into())
}

#[test]
fn every_payload_class_round_trips_and_dispatches_signed() {
    let _env = env_lock();
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
        assert_eq!(sent.endpoint, "https://app.example/endpoint");
        assert_eq!(sent.class_name, class_name);
        // Independent verification path: the public key alone validates what was sent.
        assert!(
            verify_app_payload_signature(
                &key.public_key,
                sent.timestamp,
                &sent.body,
                &sent.signature
            ),
            "{class_name} signature must verify under the published public key"
        );
        assert!(!verify_app_payload_signature(
            &key.public_key,
            sent.timestamp,
            &format!("{} ", sent.body),
            &sent.signature
        ));
    }
}

#[test]
fn an_unknown_class_name_never_reaches_the_endpoint() {
    let _env = env_lock();
    let c = conn();
    captured().lock().unwrap().clear();
    let error = dispatch_with(&c, "app", r#"{"className":"NopePayload"}"#, record).unwrap_err();
    assert!(error.contains("unsupported application payload"), "{error}");
    assert!(captured().lock().unwrap().is_empty());
}

#[test]
fn an_application_without_an_endpoint_cannot_be_dispatched_to() {
    let _env = env_lock();
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
    let _env = env_lock();
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

/// One captured HTTP request read off a real socket.
struct Received {
    method_and_path: String,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

/// A one-shot HTTP receiver on an ephemeral port (bind :0 — never a fixed port).
fn one_shot_receiver() -> (u16, std::thread::JoinHandle<Received>) {
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream);
        let mut request_line = String::new();
        reader.read_line(&mut request_line).unwrap();
        let mut headers = std::collections::HashMap::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let line = line.trim_end().to_string();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
            }
        }
        let length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut buffer = vec![0u8; length];
        reader.read_exact(&mut buffer).unwrap();
        let mut stream = reader.into_inner();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 13\r\ncontent-type: application/json\r\n\r\n{\"ok\":true}\r\n")
            .unwrap();
        stream.flush().unwrap();
        Received {
            method_and_path: request_line.trim_end().to_string(),
            headers,
            body: String::from_utf8(buffer).unwrap(),
        }
    });
    (port, handle)
}

/// End to end over a real socket: the production transport POSTs to a listener bound on
/// an ephemeral port, and the receiver verifies the five headers plus the Ed25519
/// signature by itself, from the published public key alone.
#[test]
fn a_real_post_carries_headers_a_receiver_can_verify_independently() {
    let _env = env_lock();
    let c = conn();
    std::env::set_var(crate::payload_dispatch::ALLOW_PLAINTEXT_ENDPOINTS_ENV, "1");
    let (port, receiver) = one_shot_receiver();
    let endpoint = format!("http://127.0.0.1:{port}/hook");
    c.execute(
        "UPDATE applications SET endpoint_uri=?1 WHERE id='app'",
        [&endpoint],
    )
    .unwrap();
    let key = app_signing_key_on(&c, "app").unwrap();

    let json = r#"{"className":"MessagePayload","userId":"u1","channelId":"c1","text":"/deploy"}"#;
    let result = dispatch_with(&c, "app", json, super::post_payload).expect("dispatch");
    assert_eq!(result.error, None);
    assert_eq!(result.response_status, Some(200));

    let sent = receiver.join().expect("receiver thread");
    assert_eq!(sent.method_and_path, "POST /hook HTTP/1.1");
    assert_eq!(
        sent.headers.get("x-gaia-space-application").map(String::as_str),
        Some("app")
    );
    assert_eq!(
        sent.headers.get("x-gaia-space-payload-class").map(String::as_str),
        Some("MessagePayload")
    );
    assert_eq!(
        sent.headers.get("x-gaia-space-key-id").map(String::as_str),
        Some(key.key_id.as_str())
    );
    let timestamp: i64 = sent.headers["x-gaia-space-timestamp"].parse().unwrap();
    let signature = sent.headers["x-gaia-space-signature"].clone();
    assert!(signature.starts_with("ed25519="));
    // Receiver-side check, independent of anything the dispatcher returned.
    crate::payload_dispatch::verify_fresh_app_payload(
        &key.public_key,
        timestamp,
        &sent.body,
        &signature,
        timestamp,
    )
    .expect("receiver verifies the payload it actually read off the wire");
    assert!(!verify_app_payload_signature(
        &key.public_key,
        timestamp,
        &format!("{} ", sent.body),
        &signature
    ));
    assert_eq!(
        serde_json::from_str::<ApplicationPayload>(&sent.body)
            .unwrap()
            .class_name(),
        "MessagePayload"
    );
}

#[test]
fn a_stale_or_future_timestamp_is_refused_even_with_a_valid_signature() {
    use crate::payload_dispatch::{payload_max_age_secs, verify_fresh_app_payload};
    let c = conn();
    let key = app_signing_key_on(&c, "app").unwrap();
    let window = payload_max_age_secs();
    assert!(window > 0);
    let timestamp = 1_700_000_000;
    let body = r#"{"className":"CustomPayload","data":{}}"#;
    let (_, signature) = sign_app_payload(&c, "app", timestamp, body).unwrap();

    verify_fresh_app_payload(&key.public_key, timestamp, body, &signature, timestamp).unwrap();
    verify_fresh_app_payload(
        &key.public_key,
        timestamp,
        body,
        &signature,
        timestamp + window,
    )
    .unwrap();
    // A replay one second past the window is refused although the signature still verifies.
    assert!(verify_app_payload_signature(
        &key.public_key,
        timestamp,
        body,
        &signature
    ));
    let error = verify_fresh_app_payload(
        &key.public_key,
        timestamp,
        body,
        &signature,
        timestamp + window + 1,
    )
    .unwrap_err();
    assert!(error.contains("older than"), "{error}");
    let error = verify_fresh_app_payload(
        &key.public_key,
        timestamp,
        body,
        &signature,
        timestamp - window - 1,
    )
    .unwrap_err();
    assert!(error.contains("future"), "{error}");
}

#[test]
fn the_egress_guard_refuses_internal_addresses_and_plaintext_secrets() {
    use crate::payload_dispatch::guard_endpoint_with;
    let plain = r#"{"className":"CustomPayload","data":{"k":1}}"#;
    let secretive = r#"{"className":"InitPayload","serverUrl":"https://s","clientId":"c","data":{"clientSecret":"shh"}}"#;

    // Public https host: allowed.
    guard_endpoint_with("https://93.184.216.34/hook", plain, false, false).unwrap();
    // Loopback, private, link-local, CGNAT, IPv6 loopback/ULA: all refused.
    for endpoint in [
        "https://127.0.0.1/hook",
        "https://10.1.2.3/hook",
        "https://192.168.0.5/hook",
        "https://172.16.9.9/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://100.64.1.1/hook",
        "https://[::1]/hook",
        "https://[fd00::1]/hook",
        "https://0.0.0.0/hook",
    ] {
        let error = guard_endpoint_with(endpoint, plain, false, false).unwrap_err();
        assert!(error.contains("not routable"), "{endpoint}: {error}");
        // ...unless the deployment (or a test) opts in explicitly.
        guard_endpoint_with(endpoint, plain, true, false).unwrap();
    }
    // Plaintext: refused by default, allowed by the switch, never for a secret.
    assert_eq!(
        guard_endpoint_with("http://93.184.216.34/hook", plain, false, false).unwrap_err(),
        "endpoint must use https"
    );
    guard_endpoint_with("http://93.184.216.34/hook", plain, false, true).unwrap();
    let error = guard_endpoint_with("http://93.184.216.34/hook", secretive, true, true).unwrap_err();
    assert!(error.contains("credential-bearing"), "{error}");
    // The same secret over https is fine: the objection is the plaintext hop.
    guard_endpoint_with("https://93.184.216.34/hook", secretive, false, false).unwrap();
    // Non-HTTP schemes never dispatch.
    for endpoint in ["file:///etc/passwd", "gopher://x/1", "ftp://x/y"] {
        assert!(guard_endpoint_with(endpoint, plain, true, true).is_err(), "{endpoint}");
    }
}

#[test]
fn a_dispatch_to_an_internal_endpoint_never_leaves_the_process() {
    // A listener is bound so a request WOULD succeed if the guard let it through; the
    // check is that nothing is ever accepted.
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let _env = env_lock();
    let c = conn();
    std::env::remove_var(crate::payload_dispatch::ALLOW_PRIVATE_ENDPOINTS_ENV);
    c.execute(
        "UPDATE applications SET endpoint_uri=?1 WHERE id='app'",
        [&format!("https://127.0.0.1:{port}/hook")],
    )
    .unwrap();
    let error = dispatch_with(
        &c,
        "app",
        r#"{"className":"CustomPayload","data":{}}"#,
        super::post_payload,
    )
    .unwrap_err();
    assert!(error.contains("not routable"), "{error}");
    assert!(listener.accept().is_err(), "nothing may have connected");
    std::env::set_var(crate::payload_dispatch::ALLOW_PRIVATE_ENDPOINTS_ENV, "1");
}

#[test]
fn a_signing_key_requires_a_real_application() {
    let c = conn();
    assert_eq!(
        app_signing_key_on(&c, "ghost").unwrap_err(),
        "application not found"
    );
}
