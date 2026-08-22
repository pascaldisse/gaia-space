//! Typed application payload dispatch (KB §3.2 #5, §2.2 payloads SDK).
//! Kept beside `applications.rs`: the payload family and the signing keys live there,
//! this file is the outbound path plus the tauri command surface.
use crate::applications::{
    app_signing_key_on, dispatch_body, rotate_app_signing_key_on, sign_app_payload,
    AppDispatch, AppSigningKey, ApplicationPayload,
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
pub fn application_payload_classes() -> Vec<&'static str> {
    ApplicationPayload::CLASS_NAMES.to_vec()
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
