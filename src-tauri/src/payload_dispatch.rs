//! Typed application payload dispatch (KB §3.2 #5, §2.2 payloads SDK).
//! Kept beside `applications.rs`: the payload family and the signing keys live there,
//! this file is the outbound path plus the tauri command surface.
use crate::applications::{
    app_signing_key_on, dispatch_body, rotate_app_signing_key_on, sign_app_payload, AppDispatch,
    AppSigningKey, ApplicationPayload,
};
use crate::db;
type Result<T> = std::result::Result<T, String>;

/// Public view of an application's current signing key; generated on first request.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn app_signing_key(application_id: String) -> Result<AppSigningKey> {
    app_signing_key_on(&db::conn()?, &application_id)
}

/// Rotate the pair; the retired public key stays readable for in-flight verification.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn rotate_app_signing_key(application_id: String) -> Result<AppSigningKey> {
    rotate_app_signing_key_on(&db::conn()?, &application_id)
}

/// Parse a payload into the closed family without dispatching it. The UI uses this to
/// reject a malformed payload before it ever reaches an external endpoint.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn parse_application_payload(payload_json: String) -> Result<String> {
    let payload: ApplicationPayload = serde_json::from_str(&payload_json)
        .map_err(|e| format!("unsupported application payload: {e}"))?;
    Ok(payload.class_name().to_string())
}

/// Every `className` this build accepts, for discovery in the UI and in an SDK.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn application_payload_classes() -> Result<Vec<&'static str>> {
    Ok(ApplicationPayload::CLASS_NAMES.to_vec())
}

/// Sign and POST one typed payload to the application's registered endpoint.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn dispatch_application_payload(
    application_id: String,
    payload_json: String,
) -> Result<AppDispatch> {
    dispatch_with(&db::conn()?, &application_id, &payload_json, post_payload)
}

type Transport = fn(&str, &Headers, &str) -> std::result::Result<(i64, String), String>;

/// Default freshness window for a signed payload, in seconds. Overridable per deployment
/// through `GAIA_APP_PAYLOAD_MAX_AGE_SECS` — never hard-coded at a call site.
pub const DEFAULT_PAYLOAD_MAX_AGE_SECS: i64 = 300;
/// Env switch: allow a dispatch to a loopback/private/link-local address. Off by default,
/// on only where a test or an on-prem deployment genuinely targets an internal host.
pub const ALLOW_PRIVATE_ENDPOINTS_ENV: &str = "GAIA_APP_DISPATCH_ALLOW_PRIVATE_ENDPOINTS";
/// Env switch: allow a plaintext `http://` endpoint at all. A secret-bearing payload is
/// refused over plaintext regardless of this switch.
pub const ALLOW_PLAINTEXT_ENDPOINTS_ENV: &str = "GAIA_APP_DISPATCH_ALLOW_PLAINTEXT";

/// Seconds a receiver should still accept a signed payload for.
pub fn payload_max_age_secs() -> i64 {
    std::env::var("GAIA_APP_PAYLOAD_MAX_AGE_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_PAYLOAD_MAX_AGE_SECS)
}

fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("TRUE") | Some("yes")
    )
}

/// The whole receiver-side check in one call, mirrored by the SDK guide: the signature
/// must verify AND the timestamp must sit inside the freshness window, so a captured
/// request cannot be replayed later under its own valid signature.
pub fn verify_fresh_app_payload(
    public_key: &str,
    timestamp: i64,
    body: &str,
    signature: &str,
    now: i64,
) -> Result<()> {
    let window = payload_max_age_secs();
    if timestamp > now + window {
        return Err("payload timestamp is too far in the future".into());
    }
    if now - timestamp > window {
        return Err(format!("payload is older than {window}s"));
    }
    if !crate::applications::verify_app_payload_signature(public_key, timestamp, body, signature) {
        return Err("payload signature does not verify".into());
    }
    Ok(())
}

/// Field names whose value is a credential. Matched on the JSON body of the payload, so a
/// nested `CustomPayload` carrying a token is caught as well as a top-level field.
const SECRET_FIELD_MARKERS: [&str; 6] = [
    "secret",
    "token",
    "password",
    "privatekey",
    "private_key",
    "credential",
];

/// Does this body carry something that must never cross a plaintext hop?
pub(crate) fn body_carries_secret(body: &str) -> bool {
    let value: serde_json::Value = match serde_json::from_str(body) {
        Ok(value) => value,
        // Unparseable body: treat as sensitive rather than guess.
        Err(_) => return true,
    };
    fn walk(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(map) => map.iter().any(|(key, child)| {
                let key = key.to_ascii_lowercase();
                SECRET_FIELD_MARKERS
                    .iter()
                    .any(|marker| key.contains(marker))
                    || walk(child)
            }),
            serde_json::Value::Array(items) => items.iter().any(walk),
            _ => false,
        }
    }
    walk(&value)
}

fn address_is_internal(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                // Carrier-grade NAT 100.64.0.0/10 and the 0.0.0.0/8 "this network".
                || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))
                || v4.octets()[0] == 0
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                // Unique-local fc00::/7 and link-local fe80::/10.
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().is_some_and(address_is_internal_v4)
        }
    }
}

fn address_is_internal_v4(v4: std::net::Ipv4Addr) -> bool {
    address_is_internal(std::net::IpAddr::V4(v4))
}

/// Re-validate the stored endpoint at dispatch time — the row may have been written long
/// before, by somebody else, and points the app's own signing key at whatever it names.
pub(crate) fn guard_endpoint(endpoint: &str, body: &str) -> Result<()> {
    guard_endpoint_with(
        endpoint,
        body,
        env_flag(ALLOW_PRIVATE_ENDPOINTS_ENV),
        env_flag(ALLOW_PLAINTEXT_ENDPOINTS_ENV),
    )
}

/// Same rules with the two switches passed in, so a test states the policy it exercises
/// instead of mutating process environment underneath its neighbours.
pub(crate) fn guard_endpoint_with(
    endpoint: &str,
    body: &str,
    allow_private: bool,
    allow_plaintext: bool,
) -> Result<()> {
    let url = reqwest::Url::parse(endpoint).map_err(|e| format!("invalid endpoint URI: {e}"))?;
    let scheme = url.scheme();
    if scheme != "https" && scheme != "http" {
        return Err(format!("endpoint scheme {scheme} is not dispatchable"));
    }
    if scheme == "http" {
        if body_carries_secret(body) {
            return Err("refusing to send a credential-bearing payload over plaintext http".into());
        }
        if !allow_plaintext {
            return Err("endpoint must use https".into());
        }
    }
    let host = url
        .host_str()
        .ok_or_else(|| "endpoint has no host".to_string())?;
    if allow_private {
        return Ok(());
    }
    // A literal address is judged directly; a name is resolved, because the name is what
    // an attacker controls and `internal.example` may well answer 127.0.0.1.
    // `host_str` keeps the brackets around an IPv6 literal; strip them before parsing.
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if address_is_internal(ip) {
            return Err(format!(
                "endpoint address {ip} is not routable off this host"
            ));
        }
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    use std::net::ToSocketAddrs;
    let resolved: Vec<std::net::SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("endpoint host does not resolve: {e}"))?
        .collect();
    if resolved.is_empty() {
        return Err("endpoint host does not resolve".into());
    }
    if let Some(bad) = resolved.iter().find(|addr| address_is_internal(addr.ip())) {
        return Err(format!(
            "endpoint host resolves to {}, which is not routable off this host",
            bad.ip()
        ));
    }
    Ok(())
}

/// Headers an app SDK reads to verify the payload.
pub struct Headers {
    pub class_name: String,
    pub key_id: String,
    pub signature: String,
    pub timestamp: i64,
    pub application_id: String,
}

fn post_payload(
    endpoint: &str,
    headers: &Headers,
    body: &str,
) -> std::result::Result<(i64, String), String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .post(endpoint)
        .header("content-type", "application/json")
        .header("x-gaia-space-application", &headers.application_id)
        .header("x-gaia-space-payload-class", &headers.class_name)
        .header("x-gaia-space-key-id", &headers.key_id)
        .header("x-gaia-space-timestamp", headers.timestamp.to_string())
        .header("x-gaia-space-signature", &headers.signature)
        .body(body.to_string())
        .send()
        .map_err(|e| e.to_string())?;
    let status = i64::from(response.status().as_u16());
    let text = response.text().unwrap_or_default();
    Ok((status, text))
}

/// Transport-injected core so tests exercise signing + dispatch without a socket.
pub(crate) fn dispatch_with(
    c: &rusqlite::Connection,
    application_id: &str,
    payload_json: &str,
    send: Transport,
) -> Result<AppDispatch> {
    let payload: ApplicationPayload = serde_json::from_str(payload_json)
        .map_err(|e| format!("unsupported application payload: {e}"))?;
    let endpoint: Option<String> = c
        .query_row(
            "SELECT endpoint_uri FROM applications WHERE id=?1",
            [application_id],
            |r| r.get(0),
        )
        .map_err(|_| "application not found".to_string())?;
    let endpoint = endpoint
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "application has no endpoint URI".to_string())?;
    let body = dispatch_body(&payload)?;
    guard_endpoint(&endpoint, &body)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let (key_id, signature) = sign_app_payload(c, application_id, timestamp, &body)?;
    let headers = Headers {
        class_name: payload.class_name().to_string(),
        key_id: key_id.clone(),
        signature: signature.clone(),
        timestamp,
        application_id: application_id.to_string(),
    };
    let mut result = AppDispatch {
        application_id: application_id.to_string(),
        class_name: payload.class_name().to_string(),
        endpoint_uri: endpoint.clone(),
        key_id,
        signature,
        timestamp,
        response_status: None,
        response_body: None,
        error: None,
    };
    match send(&endpoint, &headers, &body) {
        Ok((status, text)) => {
            result.response_status = Some(status);
            result.response_body = Some(text);
            if !(200..300).contains(&status) {
                result.error = Some(format!("HTTP {status}"));
            }
        }
        Err(error) => result.error = Some(error),
    }
    Ok(result)
}

#[cfg(test)]
#[path = "payload_dispatch_tests.rs"]
mod payload_dispatch_tests;
