//! Local application registry + repository devfile metadata.
//! No cloud VM lifecycle is implemented: Open in IDE returns a user-initiated deep link.
use crate::db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
type Result<T> = std::result::Result<T, String>;
fn valid_http(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}
fn required(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Devfile {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub content: String,
    pub generated: bool,
    pub updated_at: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IdeLaunch {
    pub url: String,
    pub ide: String,
    pub repository: String,
}
fn read_devfile(r: &rusqlite::Row<'_>) -> rusqlite::Result<Devfile> {
    Ok(Devfile {
        id: r.get(0)?,
        project_id: r.get(1)?,
        path: r.get(2)?,
        name: r.get(3)?,
        content: r.get(4)?,
        generated: r.get(5)?,
        updated_at: r.get(6)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_devfiles(project_id: Option<String>) -> Result<Vec<Devfile>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,project_id,path,name,content,generated,updated_at FROM devfiles WHERE (?1 IS NULL OR project_id=?1) ORDER BY name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map(params![project_id], read_devfile)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_devfile(value: Devfile) -> Result<Devfile> {
    required("devfile id", &value.id)?;
    required("project", &value.project_id)?;
    required("path", &value.path)?;
    required("name", &value.name)?;
    required("content", &value.content)?;
    if !value.path.starts_with(".space/") || !value.path.ends_with(".devfile.yaml") {
        return Err("devfile path must be .space/*.devfile.yaml".into());
    }
    let c = db::conn()?;
    c.execute("INSERT INTO devfiles(id,project_id,path,name,content,generated,updated_at) VALUES(?1,?2,?3,?4,?5,?6,unixepoch()) ON CONFLICT(project_id,path) DO UPDATE SET name=excluded.name,content=excluded.content,generated=excluded.generated,updated_at=unixepoch()",params![value.id,value.project_id,value.path,value.name,value.content,value.generated]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_devfile(id: String) -> Result<()> {
    db::conn()?
        .execute("DELETE FROM devfiles WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn open_in_ide(repository: String, ide: String) -> Result<IdeLaunch> {
    required("repository", &repository)?;
    let ide = if ide.trim().is_empty() {
        "JetBrains Gateway".to_string()
    } else {
        ide.trim().to_string()
    };
    let project = repository.trim_start_matches('/').replace(' ', "%20");
    Ok(IdeLaunch {
        url: format!("jetbrains://idea/navigate/reference?project={project}"),
        ide,
        repository,
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Application {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub application_type: String,
    pub endpoint_uri: Option<String>,
    pub client_id: String,
    pub client_credentials_flow_enabled: bool,
    pub code_flow_enabled: bool,
    pub pkce_required: bool,
    pub connection_status: String,
    pub archived: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WebhookSubscription {
    pub id: String,
    pub application_id: String,
    pub event_type: String,
    pub filters_json: Option<String>,
    pub endpoint_uri: String,
    pub enabled: bool,
    /// Shared secret for the HMAC-SHA256 request signature. `None` = unsigned endpoint.
    #[serde(default)]
    pub secret: Option<String>,
    /// Attempts after which a delivery is dead-lettered (`next_attempt_at` cleared).
    #[serde(default = "default_max_attempts")]
    pub max_attempts: i64,
}
fn default_max_attempts() -> i64 {
    5
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WebhookDelivery {
    pub id: String,
    pub webhook_id: String,
    pub payload_json: String,
    pub status: String,
    pub attempts: i64,
    pub response_status: Option<i64>,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub delivered_at: Option<i64>,
    pub next_attempt_at: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChatbotRegistration {
    pub id: String,
    pub application_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub commands_json: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UiExtension {
    pub id: String,
    pub application_id: String,
    pub extension_type: String,
    pub display_name: String,
    pub unique_code: String,
    pub iframe_url: Option<String>,
    pub enabled: bool,
}
fn read_app(r: &rusqlite::Row<'_>) -> rusqlite::Result<Application> {
    Ok(Application {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        application_type: r.get(3)?,
        endpoint_uri: r.get(4)?,
        client_id: r.get(5)?,
        client_credentials_flow_enabled: r.get(6)?,
        code_flow_enabled: r.get(7)?,
        pkce_required: r.get(8)?,
        connection_status: r.get(9)?,
        archived: r.get(10)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_applications() -> Result<Vec<Application>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,name,description,application_type,endpoint_uri,client_id,client_credentials_flow_enabled,code_flow_enabled,pkce_required,connection_status,archived FROM applications ORDER BY name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], read_app)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_application(value: Application) -> Result<Application> {
    required("application id", &value.id)?;
    required("application name", &value.name)?;
    required("client id", &value.client_id)?;
    if !matches!(
        value.application_type.as_str(),
        "Application" | "InternalApp" | "MarketplaceApp" | "FeaturedIntegration"
    ) {
        return Err("invalid application type".into());
    }
    if !matches!(
        value.connection_status.as_str(),
        "CONNECTING" | "FAILED_TO_CONNECT" | "RECONNECTING" | "CONNECTED"
    ) {
        return Err("invalid connection status".into());
    }
    if value
        .endpoint_uri
        .as_deref()
        .is_some_and(|url| !valid_http(url))
    {
        return Err("endpoint URI must use HTTP(S)".into());
    }
    let c = db::conn()?;
    c.execute("INSERT INTO applications(id,name,description,application_type,endpoint_uri,client_id,client_credentials_flow_enabled,code_flow_enabled,pkce_required,connection_status,archived) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,application_type=excluded.application_type,endpoint_uri=excluded.endpoint_uri,client_id=excluded.client_id,client_credentials_flow_enabled=excluded.client_credentials_flow_enabled,code_flow_enabled=excluded.code_flow_enabled,pkce_required=excluded.pkce_required,connection_status=excluded.connection_status,archived=excluded.archived",params![value.id,value.name,value.description,value.application_type,value.endpoint_uri,value.client_id,value.client_credentials_flow_enabled,value.code_flow_enabled,value.pkce_required,value.connection_status,value.archived]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_application(id: String) -> Result<()> {
    db::conn()?
        .execute("DELETE FROM applications WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn app_exists(id: &str) -> Result<()> {
    let c = db::conn()?;
    let found: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM applications WHERE id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if found {
        Ok(())
    } else {
        Err("application not found".into())
    }
}
fn webhook(r: &rusqlite::Row<'_>) -> rusqlite::Result<WebhookSubscription> {
    Ok(WebhookSubscription {
        id: r.get(0)?,
        application_id: r.get(1)?,
        event_type: r.get(2)?,
        filters_json: r.get(3)?,
        endpoint_uri: r.get(4)?,
        enabled: r.get(5)?,
        secret: r.get(6)?,
        max_attempts: r.get(7)?,
    })
}
/// HMAC-SHA256 over `{timestamp}.{payload}` — the timestamp is inside the MAC so a
/// captured body cannot be replayed under a fresh header.
pub(crate) fn webhook_signature(secret: &str, timestamp: i64, payload: &str) -> String {
    use sha2::{Digest, Sha256};
    let key = secret.as_bytes();
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(k.map(|v| v ^ 0x36));
    inner.update(format!("{timestamp}.{payload}").as_bytes());
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(k.map(|v| v ^ 0x5c));
    outer.update(inner);
    format!("sha256={:x}", outer.finalize())
}
/// Metadata of one key-ring entry. The secret value itself is never returned: it is
/// shown exactly once, at rotation, and the ring is afterwards only describable.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WebhookSecretMeta {
    pub id: String,
    pub webhook_id: String,
    pub state: String,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}
/// Result of a rotation — the only moment `secret` crosses the boundary.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RotatedWebhookSecret {
    pub webhook_id: String,
    pub secret: String,
    /// When the superseded secret stops being co-signed. `None` = there was none.
    pub previous_expires_at: Option<i64>,
    pub overlap_seconds: i64,
}
/// Overlap window default: configurable, never hard-coded at a call site.
pub(crate) const DEFAULT_SECRET_OVERLAP_SECONDS: i64 = 86_400;
pub(crate) fn default_overlap_seconds() -> i64 {
    std::env::var("GAIA_SPACE_WEBHOOK_SECRET_OVERLAP_SECONDS")
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .filter(|v| *v >= 0)
        .unwrap_or(DEFAULT_SECRET_OVERLAP_SECONDS)
}
fn now_secs() -> Result<i64> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64)
}
fn webhook_exists(c: &rusqlite::Connection, webhook_id: &str) -> Result<()> {
    let found: i64 = c
        .query_row(
            "SELECT count(*) FROM webhook_subscriptions WHERE id=?1",
            [webhook_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if found == 0 {
        return Err("webhook not found".into());
    }
    Ok(())
}
/// Drops RETIRING rows whose overlap has elapsed. Cleanup happens on the delivery and
/// listing paths rather than on a timer: the ring is only ever wrong at the moment it
/// is read, so reading is the honest place to make it right.
pub(crate) fn prune_expired_secrets(c: &rusqlite::Connection, webhook_id: &str) -> Result<()> {
    c.execute(
        "DELETE FROM webhook_secrets WHERE webhook_id=?1 AND state='RETIRING' AND expires_at IS NOT NULL AND expires_at<=unixepoch()",
        [webhook_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
/// Every secret a receiver may legitimately still be validating against, ACTIVE first.
/// Falls back to the legacy `webhook_subscriptions.secret` when the ring is empty, so a
/// subscription that was never rotated keeps signing exactly as it did before V41.
pub fn signing_secrets(
    c: &rusqlite::Connection,
    webhook_id: &str,
    legacy: Option<&str>,
) -> Result<Vec<String>> {
    prune_expired_secrets(c, webhook_id)?;
    let mut q = c
        .prepare("SELECT secret FROM webhook_secrets WHERE webhook_id=?1 ORDER BY CASE state WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC")
        .map_err(|e| e.to_string())?;
    let ring = q
        .query_map([webhook_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if ring.is_empty() {
        return Ok(legacy
            .filter(|s| !s.is_empty())
            .map(|s| vec![s.to_string()])
            .unwrap_or_default());
    }
    Ok(ring)
}
pub(crate) fn rotate_webhook_secret_on(
    c: &rusqlite::Connection,
    webhook_id: &str,
    overlap_seconds: Option<i64>,
) -> Result<RotatedWebhookSecret> {
    webhook_exists(c, webhook_id)?;
    let overlap = overlap_seconds.unwrap_or_else(default_overlap_seconds);
    if overlap < 0 {
        return Err("webhook secret overlap must not be negative".into());
    }
    prune_expired_secrets(c, webhook_id)?;
    let now = now_secs()?;
    let expires_at = now + overlap;
    // The previous ACTIVE keeps signing for the overlap window; with overlap 0 it is
    // already expired the instant it is written and the next read prunes it.
    let retired = c
        .execute(
            "UPDATE webhook_secrets SET state='RETIRING',expires_at=?2 WHERE webhook_id=?1 AND state='ACTIVE'",
            params![webhook_id, expires_at],
        )
        .map_err(|e| e.to_string())?;
    // A subscription that predates the ring carries its only secret in the column; it
    // must join the ring as RETIRING or rotation would cut live receivers off.
    if retired == 0 {
        let legacy: Option<String> = c
            .query_row(
                "SELECT secret FROM webhook_subscriptions WHERE id=?1",
                [webhook_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        if let Some(legacy) = legacy.filter(|s| !s.is_empty()) {
            c.execute("INSERT OR IGNORE INTO webhook_secrets(id,webhook_id,secret,state,created_at,expires_at) VALUES(?1,?2,?3,'RETIRING',?4,?5)",params![format!("whsec-{}-legacy",webhook_id),webhook_id,legacy,now,expires_at]).map_err(|e|e.to_string())?;
        }
    }
    let secret = crate::auth_security::opaque("spwh_");
    c.execute("INSERT INTO webhook_secrets(id,webhook_id,secret,state,created_at,expires_at) VALUES(?1,?2,?3,'ACTIVE',?4,NULL)",params![format!("whsec-{}",crate::auth_security::opaque("")),webhook_id,secret,now]).map_err(|e|e.to_string())?;
    // Keep the legacy column pointing at the current signing key so any reader that
    // still consults it (older clients, `list_webhooks`) is not left on a dead secret.
    c.execute(
        "UPDATE webhook_subscriptions SET secret=?2 WHERE id=?1",
        params![webhook_id, secret],
    )
    .map_err(|e| e.to_string())?;
    let ring_had_previous = retired > 0
        || c.query_row::<i64, _, _>(
            "SELECT count(*) FROM webhook_secrets WHERE webhook_id=?1 AND state='RETIRING'",
            [webhook_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
            > 0;
    Ok(RotatedWebhookSecret {
        webhook_id: webhook_id.into(),
        secret,
        previous_expires_at: ring_had_previous.then_some(expires_at),
        overlap_seconds: overlap,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn rotate_webhook_secret(
    webhook_id: String,
    overlap_seconds: Option<i64>,
) -> Result<RotatedWebhookSecret> {
    rotate_webhook_secret_on(&db::conn()?, &webhook_id, overlap_seconds)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_webhook_secrets(webhook_id: String) -> Result<Vec<WebhookSecretMeta>> {
    let c = db::conn()?;
    webhook_exists(&c, &webhook_id)?;
    prune_expired_secrets(&c, &webhook_id)?;
    let mut q = c
        .prepare("SELECT id,webhook_id,state,created_at,expires_at FROM webhook_secrets WHERE webhook_id=?1 ORDER BY CASE state WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([webhook_id], |r| {
            Ok(WebhookSecretMeta {
                id: r.get(0)?,
                webhook_id: r.get(1)?,
                state: r.get(2)?,
                created_at: r.get(3)?,
                expires_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_webhooks(application_id: String) -> Result<Vec<WebhookSubscription>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,application_id,event_type,filters_json,endpoint_uri,enabled,secret,max_attempts FROM webhook_subscriptions WHERE application_id=?1 ORDER BY event_type").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([application_id], webhook)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_webhook(value: WebhookSubscription) -> Result<WebhookSubscription> {
    required("webhook id", &value.id)?;
    required("event type", &value.event_type)?;
    if !valid_http(&value.endpoint_uri) {
        return Err("webhook endpoint must use HTTP(S)".into());
    }
    // First half of the double defence: a filter that cannot be evaluated is never
    // stored. The second half is `webhook_filter_allows`, which refuses to deliver
    // legacy rows that predate this check.
    if let Some(filters) = &value.filters_json {
        parse_webhook_filter(filters)?;
    }
    if value.max_attempts < 1 {
        return Err("webhook max attempts must be at least 1".into());
    }
    app_exists(&value.application_id)?;
    let c = db::conn()?;
    c.execute("INSERT INTO webhook_subscriptions(id,application_id,event_type,filters_json,endpoint_uri,enabled,secret,max_attempts) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET event_type=excluded.event_type,filters_json=excluded.filters_json,endpoint_uri=excluded.endpoint_uri,enabled=excluded.enabled,secret=excluded.secret,max_attempts=excluded.max_attempts",params![value.id,value.application_id,value.event_type,value.filters_json,value.endpoint_uri,value.enabled,value.secret,value.max_attempts]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_webhook(id: String) -> Result<()> {
    db::conn()?
        .execute("DELETE FROM webhook_subscriptions WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
/// A webhook filter predicate: a flat JSON object.
///
/// * `"event"` — array of event names, matched as **OR**.
/// * every other key — a dot-path into the event envelope, matched by exact JSON
///   equality, all of them **AND**ed.
/// * `{}` matches everything; a path that is absent never matches (fail closed).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct WebhookFilter {
    events: Option<Vec<String>>,
    fields: Vec<(String, serde_json::Value)>,
}

/// Rejects anything the evaluator cannot answer honestly, so a stored filter is
/// always a decidable predicate rather than merely well-formed JSON.
pub(crate) fn parse_webhook_filter(raw: &str) -> Result<WebhookFilter> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "webhook filters must be JSON".to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| "webhook filters must be a JSON object".to_string())?;
    let mut filter = WebhookFilter::default();
    for (key, value) in object {
        if key == "event" {
            let names = value
                .as_array()
                .ok_or("webhook filter \"event\" must be an array of event names")?;
            let mut events = Vec::with_capacity(names.len());
            for name in names {
                let name = name.as_str().ok_or_else(|| {
                    "webhook filter \"event\" must be an array of event names".to_string()
                })?;
                events.push(name.to_string());
            }
            filter.events = Some(events);
        } else {
            if key.is_empty() || key.split('.').any(str::is_empty) {
                return Err(format!("webhook filter path \"{key}\" is not a dot-path"));
            }
            filter.fields.push((key.clone(), value.clone()));
        }
    }
    Ok(filter)
}

/// Object traversal only: a path segment never indexes into an array, and a miss
/// is a miss rather than a null.
fn dot_path<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut cursor = value;
    for segment in path.split('.') {
        cursor = cursor.as_object()?.get(segment)?;
    }
    Some(cursor)
}

impl WebhookFilter {
    pub(crate) fn matches(&self, event_type: &str, payload: &serde_json::Value) -> bool {
        if let Some(events) = &self.events {
            if !events.iter().any(|e| e == event_type) {
                return false;
            }
        }
        self.fields
            .iter()
            .all(|(path, expected)| dot_path(payload, path) == Some(expected))
    }
}

/// Delivery-side gate. No filter = deliver; an unparsable legacy filter is
/// **not** delivered, so a broken predicate can never widen a subscription.
pub(crate) fn webhook_filter_allows(
    filters_json: Option<&str>,
    event_type: &str,
    payload: &serde_json::Value,
) -> bool {
    match filters_json {
        None => true,
        Some(raw) => match parse_webhook_filter(raw) {
            Ok(filter) => filter.matches(event_type, payload),
            Err(_) => false,
        },
    }
}

fn read_delivery(r: &rusqlite::Row<'_>) -> rusqlite::Result<WebhookDelivery> {
    Ok(WebhookDelivery {
        id: r.get(0)?,
        webhook_id: r.get(1)?,
        payload_json: r.get(2)?,
        status: r.get(3)?,
        attempts: r.get(4)?,
        response_status: r.get(5)?,
        last_error: r.get(6)?,
        created_at: r.get(7)?,
        delivered_at: r.get(8)?,
        next_attempt_at: r.get(9)?,
    })
}
fn delivery_backoff(attempts: i64) -> i64 {
    30 * (1_i64 << attempts.clamp(0, 5))
}
/// `None` = dead letter: the budget is spent, so no future time is written and the
/// queue sweeper can never pick the row up again.
fn retry_schedule(attempts_done: i64, max_attempts: i64) -> Option<i64> {
    if attempts_done >= max_attempts {
        None
    } else {
        Some(delivery_backoff(attempts_done))
    }
}
fn deliver_delivery(id: &str) -> Result<WebhookDelivery> {
    let c = db::conn()?;
    let (webhook_id, endpoint_uri, enabled, payload, secret, max_attempts, attempt): (String,String,bool,String,Option<String>,i64,i64) = c.query_row("SELECT d.webhook_id,w.endpoint_uri,w.enabled,d.payload_json,w.secret,w.max_attempts,d.attempts FROM webhook_deliveries d JOIN webhook_subscriptions w ON w.id=d.webhook_id WHERE d.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).map_err(|_|"webhook delivery not found".to_string())?;
    if !enabled {
        return Err("webhook is disabled".into());
    }
    if attempt >= max_attempts {
        return Err("webhook delivery exhausted its attempts".into());
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    // Key ring: the ACTIVE secret owns the canonical signature header, every still-valid
    // RETIRING secret is co-signed into a second header. A receiver mid-rotation accepts
    // a match in either, so the cutover never drops a delivery.
    let ring = signing_secrets(&c, &webhook_id, secret.as_deref())?;
    let signatures: Vec<String> = ring
        .iter()
        .map(|s| webhook_signature(s, timestamp, &payload))
        .collect();
    let signature = signatures.first().cloned();
    let additional = signatures
        .get(1..)
        .map(|rest| rest.join(","))
        .unwrap_or_default();
    let result = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .post(&endpoint_uri)
        .header("content-type", "application/json")
        .header("x-gaia-space-webhook", &webhook_id)
        .header("x-gaia-space-delivery-id", id)
        .header("x-gaia-space-timestamp", timestamp.to_string())
        .header(
            "x-gaia-space-signature",
            signature.clone().unwrap_or_default(),
        )
        .header("x-gaia-space-signature-retiring", additional)
        .body(payload)
        .send();
    match result {
        Ok(response) if response.status().is_success() => {
            c.execute("UPDATE webhook_deliveries SET status='SUCCEEDED',attempts=?2,response_status=?3,last_error=NULL,delivered_at=unixepoch(),next_attempt_at=NULL WHERE id=?1",params![id,attempt+1,i64::from(response.status().as_u16())]).map_err(|e|e.to_string())?;
        }
        Ok(response) => {
            let next = retry_schedule(attempt + 1, max_attempts);
            c.execute("UPDATE webhook_deliveries SET status='FAILED',attempts=?2,response_status=?3,last_error=?4,next_attempt_at=CASE WHEN ?5 IS NULL THEN NULL ELSE unixepoch()+?5 END WHERE id=?1",params![id,attempt+1,i64::from(response.status().as_u16()),format!("HTTP {}",response.status()),next]).map_err(|e|e.to_string())?;
        }
        Err(error) => {
            let next = retry_schedule(attempt + 1, max_attempts);
            c.execute("UPDATE webhook_deliveries SET status='FAILED',attempts=?2,response_status=NULL,last_error=?3,next_attempt_at=CASE WHEN ?4 IS NULL THEN NULL ELSE unixepoch()+?4 END WHERE id=?1",params![id,attempt+1,error.to_string(),next]).map_err(|e|e.to_string())?;
        }
    }
    c.query_row("SELECT id,webhook_id,payload_json,status,attempts,response_status,last_error,created_at,delivered_at,next_attempt_at FROM webhook_deliveries WHERE id=?1",[id],read_delivery).map_err(|e|e.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn deliver_webhook(webhook_id: String, payload_json: String) -> Result<WebhookDelivery> {
    serde_json::from_str::<serde_json::Value>(&payload_json)
        .map_err(|_| "webhook payload must be JSON".to_string())?;
    let id = format!(
        "delivery-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let c = db::conn()?;
    c.execute("INSERT INTO webhook_deliveries(id,webhook_id,payload_json,status) VALUES(?1,?2,?3,'PENDING')",params![id,webhook_id,payload_json]).map_err(|e|e.to_string())?;
    drop(c);
    deliver_delivery(&id)
}
static NEXT_DELIVERY: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Unique within a process even when several deliveries are enqueued inside the
/// same nanosecond tick.
fn new_delivery_id() -> Result<String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let seq = NEXT_DELIVERY.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Ok(format!("delivery-{nanos:x}-{seq:x}"))
}

/// Domain fan-out seam: select the enabled subscriptions for `event_type`, keep the
/// ones whose filter accepts the payload, and make the delivery rows **durable**.
///
/// Enqueue only — no HTTP happens here, so a domain module can call this right
/// after its write without holding a transaction open across the network. The
/// existing queue/retry path (`retry_webhook_delivery`, the sweeper) does the send.
/// Returns the delivery IDs created.
pub(crate) fn enqueue_event(event_type: &str, payload: &serde_json::Value) -> Result<Vec<String>> {
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let c = db::conn()?;
    let subscriptions: Vec<(String, Option<String>)> = c
        .prepare(
            "SELECT id,filters_json FROM webhook_subscriptions WHERE event_type=?1 AND enabled=1 ORDER BY id",
        )
        .map_err(|e| e.to_string())?
        .query_map([event_type], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut created = Vec::new();
    for (webhook_id, filters) in subscriptions {
        if !webhook_filter_allows(filters.as_deref(), event_type, payload) {
            continue;
        }
        let id = new_delivery_id()?;
        c.execute(
            "INSERT INTO webhook_deliveries(id,webhook_id,payload_json,status) VALUES(?1,?2,?3,'PENDING')",
            params![id, webhook_id, body],
        )
        .map_err(|e| e.to_string())?;
        created.push(id);
    }
    Ok(created)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn retry_webhook_delivery(id: String) -> Result<WebhookDelivery> {
    if !claim_delivery(&id, false)? {
        // dead-lettered, already succeeded, or in flight elsewhere
        let c = db::conn()?;
        return c.query_row("SELECT id,webhook_id,payload_json,status,attempts,response_status,last_error,created_at,delivered_at,next_attempt_at FROM webhook_deliveries WHERE id=?1",[&id],read_delivery)
            .map_err(|_| "webhook delivery not found".to_string())
            .and_then(|d| Err(format!("webhook delivery {} is not retryable ({})", d.id, d.status)));
    }
    deliver_delivery(&id)
}
/// How long a claimed delivery stays invisible to other sweepers. A sweeper that
/// dies mid-POST loses the lease and the row becomes due again — no row is stranded.
const CLAIM_LEASE_SECS: i64 = 120;
/// Take exclusive ownership of a delivery. One UPDATE, so two concurrent sweepers
/// cannot both win: SQLite serialises the writes and the loser sees zero rows changed.
/// A row is claimable unless it already succeeded, is dead-lettered
/// (`next_attempt_at IS NULL`), or carries a live lease.
/// `respect_backoff=false` is the operator's "retry now": it skips the waiting time but
/// still refuses a row another worker is actively delivering.
fn claim_delivery(id: &str, respect_backoff: bool) -> Result<bool> {
    let c = db::conn()?;
    let changed = c
        .execute(
            "UPDATE webhook_deliveries SET status='PENDING',next_attempt_at=unixepoch()+?2 \
             WHERE id=?1 AND status<>'SUCCEEDED' AND next_attempt_at IS NOT NULL \
             AND ((?3 = 0 AND status<>'PENDING') OR next_attempt_at<=unixepoch())",
            params![id, CLAIM_LEASE_SECS, i64::from(respect_backoff)],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed == 1)
}
/// Deliveries that are due now: inside their attempt budget (`next_attempt_at` non-NULL
/// = not dead-lettered), past their backoff, and not held by a live claim lease.
pub fn due_webhook_deliveries(limit: i64) -> Result<Vec<String>> {
    let c = db::conn()?;
    let mut q = c
        .prepare("SELECT id FROM webhook_deliveries WHERE status IN ('FAILED','PENDING') AND next_attempt_at IS NOT NULL AND next_attempt_at<=unixepoch() ORDER BY next_attempt_at LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([limit], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
/// One sweep of the retry queue. Returns the deliveries it touched; a delivery whose
/// redelivery errors out is reported, not propagated — one bad endpoint must not stop
/// the sweep.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn process_webhook_queue(limit: i64) -> Result<Vec<WebhookDelivery>> {
    let limit = limit.clamp(1, 100);
    let mut out = Vec::new();
    for id in due_webhook_deliveries(limit)? {
        if !claim_delivery(&id, true)? {
            continue; // another sweeper owns it
        }
        if let Ok(delivery) = deliver_delivery(&id) {
            out.push(delivery);
        }
    }
    Ok(out)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_webhook_deliveries(webhook_id: String) -> Result<Vec<WebhookDelivery>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,webhook_id,payload_json,status,attempts,response_status,last_error,created_at,delivered_at,next_attempt_at FROM webhook_deliveries WHERE webhook_id=?1 ORDER BY created_at DESC").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([webhook_id], read_delivery)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
fn bot(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChatbotRegistration> {
    Ok(ChatbotRegistration {
        id: r.get(0)?,
        application_id: r.get(1)?,
        display_name: r.get(2)?,
        description: r.get(3)?,
        commands_json: r.get(4)?,
        enabled: r.get(5)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_chatbots(application_id: String) -> Result<Vec<ChatbotRegistration>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,application_id,display_name,description,commands_json,enabled FROM chatbot_registrations WHERE application_id=?1 ORDER BY display_name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([application_id], bot)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_chatbot(value: ChatbotRegistration) -> Result<ChatbotRegistration> {
    required("chatbot id", &value.id)?;
    required("chatbot name", &value.display_name)?;
    serde_json::from_str::<Vec<serde_json::Value>>(&value.commands_json)
        .map_err(|_| "commands must be a JSON list".to_string())?;
    app_exists(&value.application_id)?;
    let c = db::conn()?;
    c.execute("INSERT INTO chatbot_registrations(id,application_id,display_name,description,commands_json,enabled) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,description=excluded.description,commands_json=excluded.commands_json,enabled=excluded.enabled",params![value.id,value.application_id,value.display_name,value.description,value.commands_json,value.enabled]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_chatbot(id: String) -> Result<()> {
    db::conn()?
        .execute("DELETE FROM chatbot_registrations WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn extension(r: &rusqlite::Row<'_>) -> rusqlite::Result<UiExtension> {
    Ok(UiExtension {
        id: r.get(0)?,
        application_id: r.get(1)?,
        extension_type: r.get(2)?,
        display_name: r.get(3)?,
        unique_code: r.get(4)?,
        iframe_url: r.get(5)?,
        enabled: r.get(6)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_ui_extensions(application_id: String) -> Result<Vec<UiExtension>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,application_id,extension_type,display_name,unique_code,iframe_url,enabled FROM ui_extensions WHERE application_id=?1 ORDER BY display_name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([application_id], extension)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_ui_extension(value: UiExtension) -> Result<UiExtension> {
    required("extension id", &value.id)?;
    required("display name", &value.display_name)?;
    required("unique code", &value.unique_code)?;
    if !matches!(
        value.extension_type.as_str(),
        "TopLevelPage"
            | "ApplicationHomepage"
            | "GettingStarted"
            | "MenuItem"
            | "ChatMessageMenuItem"
            | "MeetingMenuItem"
            | "ExternalIssueTracker"
    ) {
        return Err("invalid extension type".into());
    }
    if value
        .iframe_url
        .as_deref()
        .is_some_and(|url| !valid_http(url))
    {
        return Err("iframe URL must use HTTP(S)".into());
    }
    app_exists(&value.application_id)?;
    let c = db::conn()?;
    c.execute("INSERT INTO ui_extensions(id,application_id,extension_type,display_name,unique_code,iframe_url,enabled) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET extension_type=excluded.extension_type,display_name=excluded.display_name,unique_code=excluded.unique_code,iframe_url=excluded.iframe_url,enabled=excluded.enabled",params![value.id,value.application_id,value.extension_type,value.display_name,value.unique_code,value.iframe_url,value.enabled]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_ui_extension(id: String) -> Result<()> {
    db::conn()?
        .execute("DELETE FROM ui_extensions WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
// ---- App OAuth (client_credentials) + marketplace installs -------------------
#[derive(Clone, Debug, Serialize)]
pub struct AppSecret {
    pub application_id: String,
    pub client_id: String,
    /// Plaintext, returned once at creation and never stored.
    pub client_secret: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct AppToken {
    pub id: String,
    pub application_id: String,
    pub scope: String,
    pub expires_at: Option<i64>,
    /// Plaintext bearer token; only present on issuance.
    pub access_token: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MarketplaceApp {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub description: Option<String>,
    pub capabilities_json: String,
    pub compatibility: Option<String>,
    pub listing_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppInstall {
    pub id: String,
    pub marketplace_app_id: Option<String>,
    pub application_id: String,
    pub install_kind: String,
    pub installed_by: Option<String>,
    pub installed_at: i64,
}
const INSTALL_KINDS: [&str; 5] = ["MARKETPLACE", "LINK", "MANUAL", "JENKINS", "TEAMCITY"];
pub(crate) fn rotate_app_secret_on(
    c: &rusqlite::Connection,
    application_id: &str,
) -> Result<AppSecret> {
    let client_id: String = c
        .query_row(
            "SELECT client_id FROM applications WHERE id=?1",
            [application_id],
            |r| r.get(0),
        )
        .map_err(|_| "application not found".to_string())?;
    let secret = crate::auth_security::opaque("spcs_");
    let hashed = crate::auth_security::hash(&secret)?;
    c.execute("INSERT INTO app_secrets(application_id,secret_hash,created_at) VALUES(?1,?2,unixepoch()) ON CONFLICT(application_id) DO UPDATE SET secret_hash=excluded.secret_hash,created_at=unixepoch()",params![application_id,hashed]).map_err(|e|e.to_string())?;
    // Rotation invalidates every outstanding credential of this application: an old
    // secret must not keep access through *either* grant. One secret (`app_secrets`)
    // backs both client_credentials (`app_tokens`) and the authorization-code flow
    // (`oauth_access_tokens`), so a single rotation retires both, plus authorization
    // codes that were minted under the old secret and not yet exchanged.
    c.execute("UPDATE app_tokens SET revoked_at=unixepoch() WHERE application_id=?1 AND revoked_at IS NULL", [application_id]).map_err(|e| e.to_string())?;
    c.execute("UPDATE oauth_access_tokens SET revoked_at=unixepoch() WHERE application_id=?1 AND revoked_at IS NULL", [application_id]).map_err(|e| e.to_string())?;
    c.execute("UPDATE oauth_auth_codes SET consumed_at=unixepoch() WHERE application_id=?1 AND consumed_at IS NULL", [application_id]).map_err(|e| e.to_string())?;
    Ok(AppSecret {
        application_id: application_id.into(),
        client_id,
        client_secret: secret,
    })
}
/// client_credentials grant: verifies the app secret and mints an opaque bearer token.
pub(crate) fn issue_app_token_on(
    c: &rusqlite::Connection,
    client_id: &str,
    client_secret: &str,
    scope: Option<String>,
    ttl_seconds: Option<i64>,
) -> Result<AppToken> {
    let row: Option<(String, bool, bool, String)> = c.query_row("SELECT a.id,a.client_credentials_flow_enabled,a.archived,coalesce(s.secret_hash,'') FROM applications a LEFT JOIN app_secrets s ON s.application_id=a.id WHERE a.client_id=?1",[client_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
    let Some((application_id, flow_enabled, archived, secret_hash)) = row else {
        return Err("invalid client credentials".into());
    };
    if archived {
        return Err("application is archived".into());
    }
    if !flow_enabled {
        return Err("client credentials flow is disabled for this application".into());
    }
    if secret_hash.is_empty() || !crate::auth_security::matches(client_secret, &secret_hash) {
        return Err("invalid client credentials".into());
    }
    let ttl = ttl_seconds.unwrap_or(3600);
    if ttl <= 0 {
        return Err("token lifetime must be positive".into());
    }
    let raw = crate::auth_security::opaque("spat_");
    let hashed = crate::auth_security::hash(&raw)?;
    let id = format!("apptok-{}", &crate::auth_security::opaque("")[..16]);
    let scope = scope.unwrap_or_default();
    let expires_at = chrono::Utc::now().timestamp() + ttl;
    c.execute("INSERT INTO app_tokens(id,application_id,token_hash,scope,created_at,expires_at) VALUES(?1,?2,?3,?4,unixepoch(),?5)",params![id,application_id,hashed,scope,expires_at]).map_err(|e|e.to_string())?;
    Ok(AppToken {
        id,
        application_id,
        scope,
        expires_at: Some(expires_at),
        access_token: Some(raw),
    })
}
/// Resolves a bearer token to its application; expired/revoked tokens resolve to None.
pub(crate) fn verify_app_token_on(
    c: &rusqlite::Connection,
    token: &str,
) -> Result<Option<AppToken>> {
    let mut q=c.prepare("SELECT id,application_id,token_hash,scope,expires_at FROM app_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch())").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (id, application_id, token_hash, scope, expires_at) in rows {
        if crate::auth_security::matches(token, &token_hash) {
            return Ok(Some(AppToken {
                id,
                application_id,
                scope,
                expires_at,
                access_token: None,
            }));
        }
    }
    Ok(None)
}
pub(crate) fn install_marketplace_app_on(
    c: &rusqlite::Connection,
    value: AppInstall,
) -> Result<AppInstall> {
    required("install id", &value.id)?;
    required("application", &value.application_id)?;
    if !INSTALL_KINDS.contains(&value.install_kind.as_str()) {
        return Err("invalid install kind".into());
    }
    if value.install_kind == "MARKETPLACE" && value.marketplace_app_id.is_none() {
        return Err("marketplace installs require a marketplace app".into());
    }
    c.execute("INSERT INTO app_installs(id,marketplace_app_id,application_id,install_kind,installed_by,installed_at) VALUES(?1,?2,?3,?4,?5,unixepoch()) ON CONFLICT(id) DO UPDATE SET install_kind=excluded.install_kind,installed_by=excluded.installed_by",params![value.id,value.marketplace_app_id,value.application_id,value.install_kind,value.installed_by]).map_err(|e|e.to_string())?;
    let installed_at: i64 = c
        .query_row(
            "SELECT installed_at FROM app_installs WHERE id=?1",
            [&value.id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(AppInstall {
        installed_at,
        ..value
    })
}
/// Issues a fresh client secret for an application; the plaintext is returned once.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn rotate_app_secret(application_id: String) -> Result<AppSecret> {
    rotate_app_secret_on(&db::conn()?, &application_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn issue_app_token(
    client_id: String,
    client_secret: String,
    scope: Option<String>,
    ttl_seconds: Option<i64>,
) -> Result<AppToken> {
    issue_app_token_on(&db::conn()?, &client_id, &client_secret, scope, ttl_seconds)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn verify_app_token(token: String) -> Result<Option<AppToken>> {
    verify_app_token_on(&db::conn()?, &token)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn revoke_app_token(id: String) -> Result<()> {
    let c = db::conn()?;
    if c.execute(
        "UPDATE app_tokens SET revoked_at=unixepoch() WHERE id=?1 AND revoked_at IS NULL",
        [id],
    )
    .map_err(|e| e.to_string())?
        == 0
    {
        return Err("token not found".into());
    }
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_app_tokens(application_id: String) -> Result<Vec<AppToken>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,application_id,scope,expires_at FROM app_tokens WHERE application_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([application_id], |r| {
            Ok(AppToken {
                id: r.get(0)?,
                application_id: r.get(1)?,
                scope: r.get(2)?,
                expires_at: r.get(3)?,
                access_token: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_marketplace_apps() -> Result<Vec<MarketplaceApp>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,name,vendor,description,capabilities_json,compatibility,listing_url FROM marketplace_apps ORDER BY name").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok(MarketplaceApp {
                id: r.get(0)?,
                name: r.get(1)?,
                vendor: r.get(2)?,
                description: r.get(3)?,
                capabilities_json: r.get(4)?,
                compatibility: r.get(5)?,
                listing_url: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_marketplace_app(value: MarketplaceApp) -> Result<MarketplaceApp> {
    required("marketplace app id", &value.id)?;
    required("name", &value.name)?;
    required("vendor", &value.vendor)?;
    if serde_json::from_str::<serde_json::Value>(&value.capabilities_json)
        .ok()
        .filter(|v| v.is_array())
        .is_none()
    {
        return Err("capabilities must be a JSON array".into());
    }
    if value
        .listing_url
        .as_deref()
        .is_some_and(|url| !valid_http(url))
    {
        return Err("listing URL must use HTTP(S)".into());
    }
    db::conn()?.execute("INSERT INTO marketplace_apps(id,name,vendor,description,capabilities_json,compatibility,listing_url) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,vendor=excluded.vendor,description=excluded.description,capabilities_json=excluded.capabilities_json,compatibility=excluded.compatibility,listing_url=excluded.listing_url",params![value.id,value.name,value.vendor,value.description,value.capabilities_json,value.compatibility,value.listing_url]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn install_marketplace_app(value: AppInstall) -> Result<AppInstall> {
    install_marketplace_app_on(&db::conn()?, value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_app_installs() -> Result<Vec<AppInstall>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,marketplace_app_id,application_id,install_kind,installed_by,installed_at FROM app_installs ORDER BY installed_at DESC").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok(AppInstall {
                id: r.get(0)?,
                marketplace_app_id: r.get(1)?,
                application_id: r.get(2)?,
                install_kind: r.get(3)?,
                installed_by: r.get(4)?,
                installed_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn uninstall_app(id: String) -> Result<()> {
    if db::conn()?
        .execute("DELETE FROM app_installs WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("install not found".into());
    }
    Ok(())
}
#[cfg(test)]
mod oauth_tests {
    use super::*;
    fn conn() -> rusqlite::Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app','App','MarketplaceApp','client-1',1)", []).unwrap();
        c.execute("INSERT INTO applications(id,name,application_type,client_id,client_credentials_flow_enabled) VALUES('app2','Off','Application','client-2',0)", []).unwrap();
        c
    }
    #[test]
    fn client_credentials_issue_and_verify() {
        let c = conn();
        let secret = rotate_app_secret_on(&c, "app").unwrap();
        let token = issue_app_token_on(
            &c,
            "client-1",
            &secret.client_secret,
            Some("read".into()),
            Some(60),
        )
        .unwrap();
        let raw = token.access_token.clone().unwrap();
        let verified = verify_app_token_on(&c, &raw)
            .unwrap()
            .expect("token verifies");
        assert_eq!(verified.application_id, "app");
        assert_eq!(verified.scope, "read");
        // Independent check: the plaintext is not what is stored.
        let stored: String = c
            .query_row(
                "SELECT token_hash FROM app_tokens WHERE id=?1",
                [&token.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(stored, raw);
        assert!(verify_app_token_on(&c, "spat_wrong").unwrap().is_none());
    }
    #[test]
    fn wrong_secret_disabled_flow_and_rotation_are_all_refused() {
        let c = conn();
        let secret = rotate_app_secret_on(&c, "app").unwrap();
        assert!(issue_app_token_on(&c, "client-1", "spcs_bogus", None, None).is_err());
        assert!(
            issue_app_token_on(&c, "client-2", &secret.client_secret, None, None).is_err(),
            "flow disabled"
        );
        let token = issue_app_token_on(&c, "client-1", &secret.client_secret, None, None).unwrap();
        let raw = token.access_token.unwrap();
        rotate_app_secret_on(&c, "app").unwrap();
        assert!(
            verify_app_token_on(&c, &raw).unwrap().is_none(),
            "rotation revokes old tokens"
        );
    }
    #[test]
    fn expired_token_does_not_verify() {
        let c = conn();
        let secret = rotate_app_secret_on(&c, "app").unwrap();
        let token =
            issue_app_token_on(&c, "client-1", &secret.client_secret, None, Some(60)).unwrap();
        let raw = token.access_token.unwrap();
        c.execute(
            "UPDATE app_tokens SET expires_at=unixepoch()-1 WHERE id=?1",
            [&token.id],
        )
        .unwrap();
        assert!(verify_app_token_on(&c, &raw).unwrap().is_none());
    }
    #[test]
    fn install_kinds_are_validated() {
        let c = conn();
        c.execute(
            "INSERT INTO marketplace_apps(id,name,vendor) VALUES('m','Market App','Vendor')",
            [],
        )
        .unwrap();
        let ok = install_marketplace_app_on(
            &c,
            AppInstall {
                id: "i1".into(),
                marketplace_app_id: Some("m".into()),
                application_id: "app".into(),
                install_kind: "MARKETPLACE".into(),
                installed_by: None,
                installed_at: 0,
            },
        )
        .unwrap();
        assert!(ok.installed_at > 0);
        assert!(install_marketplace_app_on(
            &c,
            AppInstall {
                id: "i2".into(),
                marketplace_app_id: None,
                application_id: "app".into(),
                install_kind: "MARKETPLACE".into(),
                installed_by: None,
                installed_at: 0
            }
        )
        .is_err());
        assert!(install_marketplace_app_on(
            &c,
            AppInstall {
                id: "i3".into(),
                marketplace_app_id: None,
                application_id: "app".into(),
                install_kind: "SMOKE".into(),
                installed_by: None,
                installed_at: 0
            }
        )
        .is_err());
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_http_endpoints_are_accepted() {
        assert!(valid_http("https://example.test"));
        assert!(!valid_http("file:///private"));
    }
    #[test]
    fn ide_link_is_a_deep_link() {
        assert!(open_in_ide("/work/demo".into(), "".into())
            .unwrap()
            .url
            .starts_with("jetbrains://"));
    }
}

#[cfg(test)]
mod secret_ring_tests {
    use super::*;
    use rusqlite::Connection;

    /// Minimal fixture: only the two tables the ring touches, so the test cannot pass
    /// by accident through some other subsystem's defaults.
    fn ring_db(legacy: Option<&str>) -> Connection {
        let c = Connection::open_in_memory().expect("memory db");
        c.execute_batch("CREATE TABLE webhook_subscriptions (id TEXT PRIMARY KEY, secret TEXT);")
            .unwrap();
        c.execute_batch(crate::db::SCHEMA_V41).unwrap();
        c.execute(
            "INSERT INTO webhook_subscriptions(id,secret) VALUES('w1',?1)",
            [legacy],
        )
        .unwrap();
        c
    }

    #[test]
    fn rotation_keeps_the_old_secret_valid_inside_the_overlap() {
        let c = ring_db(Some("old-secret"));
        let rotated = rotate_webhook_secret_on(&c, "w1", Some(3_600)).expect("rotate");
        let ring = signing_secrets(&c, "w1", None).expect("ring");
        assert_eq!(ring.first().map(String::as_str), Some(rotated.secret.as_str()));
        assert!(
            ring.iter().any(|s| s == "old-secret"),
            "the superseded secret co-signs during overlap: {ring:?}"
        );
        assert!(rotated.previous_expires_at.is_some());
    }

    #[test]
    fn an_elapsed_overlap_drops_the_old_secret() {
        let c = ring_db(Some("old-secret"));
        rotate_webhook_secret_on(&c, "w1", Some(0)).expect("rotate");
        // Independent path: assert against the stored rows, not against the same reader.
        c.execute(
            "UPDATE webhook_secrets SET expires_at=unixepoch()-1 WHERE state='RETIRING'",
            [],
        )
        .unwrap();
        let ring = signing_secrets(&c, "w1", None).expect("ring");
        assert_eq!(ring.len(), 1, "only the ACTIVE secret survives: {ring:?}");
        assert!(!ring.iter().any(|s| s == "old-secret"));
        let rows: i64 = c
            .query_row("SELECT count(*) FROM webhook_secrets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "expired rows are deleted, not merely hidden");
    }

    #[test]
    fn a_second_rotation_retires_the_first_rotated_secret() {
        let c = ring_db(None);
        let first = rotate_webhook_secret_on(&c, "w1", Some(3_600)).expect("first");
        let second = rotate_webhook_secret_on(&c, "w1", Some(3_600)).expect("second");
        assert_ne!(first.secret, second.secret);
        let ring = signing_secrets(&c, "w1", None).expect("ring");
        assert_eq!(ring[0], second.secret);
        assert!(ring.contains(&first.secret));
        let active: i64 = c
            .query_row(
                "SELECT count(*) FROM webhook_secrets WHERE state='ACTIVE'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(active, 1, "exactly one signing key at a time");
    }

    #[test]
    fn an_empty_ring_falls_back_to_the_legacy_column() {
        let c = ring_db(Some("legacy"));
        assert_eq!(
            signing_secrets(&c, "w1", Some("legacy")).unwrap(),
            vec!["legacy".to_string()]
        );
    }

    #[test]
    fn rotating_an_unknown_webhook_is_refused() {
        let c = ring_db(None);
        assert!(rotate_webhook_secret_on(&c, "nope", None).is_err());
    }

    #[test]
    fn the_overlap_default_is_configurable_not_hard_coded() {
        // No env var set in-process: the documented default answers.
        std::env::remove_var("GAIA_SPACE_WEBHOOK_SECRET_OVERLAP_SECONDS");
        assert_eq!(default_overlap_seconds(), DEFAULT_SECRET_OVERLAP_SECONDS);
    }
}

#[cfg(test)]
mod filter_tests {
    use super::*;
    use serde_json::json;

    fn envelope() -> serde_json::Value {
        json!({
            "event": "issue.created",
            "issue": {"id": "i1", "priority": "HIGH", "number": 7, "archived": false}
        })
    }

    #[test]
    fn an_empty_object_matches_everything() {
        let filter = parse_webhook_filter("{}").expect("empty filter");
        assert!(filter.matches("issue.created", &envelope()));
        assert!(filter.matches("anything.at.all", &json!({})));
    }

    #[test]
    fn event_names_are_ored() {
        let filter = parse_webhook_filter(r#"{"event":["issue.created","issue.updated"]}"#)
            .expect("event filter");
        assert!(filter.matches("issue.created", &envelope()));
        assert!(filter.matches("issue.updated", &envelope()));
        assert!(!filter.matches("issue.archived", &envelope()));
        // An empty name list can never be satisfied.
        let none = parse_webhook_filter(r#"{"event":[]}"#).expect("empty event list");
        assert!(!none.matches("issue.created", &envelope()));
    }

    #[test]
    fn field_paths_are_anded() {
        let both = parse_webhook_filter(r#"{"issue.priority":"HIGH","issue.id":"i1"}"#)
            .expect("two paths");
        assert!(both.matches("issue.created", &envelope()));
        let one_wrong = parse_webhook_filter(r#"{"issue.priority":"HIGH","issue.id":"i2"}"#)
            .expect("two paths");
        assert!(!one_wrong.matches("issue.created", &envelope()));
    }

    #[test]
    fn event_and_fields_must_both_hold() {
        let filter =
            parse_webhook_filter(r#"{"event":["issue.created"],"issue.priority":"HIGH"}"#)
                .expect("mixed filter");
        assert!(filter.matches("issue.created", &envelope()));
        assert!(!filter.matches("issue.updated", &envelope()));
        let other = parse_webhook_filter(r#"{"event":["issue.created"],"issue.priority":"LOW"}"#)
            .expect("mixed filter");
        assert!(!other.matches("issue.created", &envelope()));
    }

    #[test]
    fn an_absent_path_never_matches() {
        let missing = parse_webhook_filter(r#"{"issue.assignee_id":"nobody"}"#).expect("filter");
        assert!(!missing.matches("issue.created", &envelope()));
        // Not even against JSON null: absent is absent.
        let null = parse_webhook_filter(r#"{"issue.assignee_id":null}"#).expect("filter");
        assert!(!null.matches("issue.created", &envelope()));
        // A path that walks through a non-object also misses.
        let through_scalar = parse_webhook_filter(r#"{"issue.id.inner":"i1"}"#).expect("filter");
        assert!(!through_scalar.matches("issue.created", &envelope()));
    }

    #[test]
    fn equality_is_typed() {
        let string_seven = parse_webhook_filter(r#"{"issue.number":"7"}"#).expect("filter");
        assert!(!string_seven.matches("issue.created", &envelope()));
        let number_seven = parse_webhook_filter(r#"{"issue.number":7}"#).expect("filter");
        assert!(number_seven.matches("issue.created", &envelope()));
        let bool_false = parse_webhook_filter(r#"{"issue.archived":false}"#).expect("filter");
        assert!(bool_false.matches("issue.created", &envelope()));
        let string_false = parse_webhook_filter(r#"{"issue.archived":"false"}"#).expect("filter");
        assert!(!string_false.matches("issue.created", &envelope()));
    }

    #[test]
    fn malformed_filters_are_rejected_on_parse() {
        assert!(parse_webhook_filter("not json").is_err());
        assert!(parse_webhook_filter("[]").is_err());
        assert!(parse_webhook_filter("\"issue.created\"").is_err());
        assert!(parse_webhook_filter("null").is_err());
        assert!(parse_webhook_filter(r#"{"event":"issue.created"}"#).is_err());
        assert!(parse_webhook_filter(r#"{"event":[1,2]}"#).is_err());
        assert!(parse_webhook_filter(r#"{"":"x"}"#).is_err());
        assert!(parse_webhook_filter(r#"{"issue..id":"x"}"#).is_err());
    }

    #[test]
    fn delivery_side_is_fail_closed() {
        let payload = envelope();
        assert!(webhook_filter_allows(None, "issue.created", &payload));
        assert!(webhook_filter_allows(Some("{}"), "issue.created", &payload));
        // Legacy rows written before validation existed must not be delivered.
        assert!(!webhook_filter_allows(
            Some("[\"issue.created\"]"),
            "issue.created",
            &payload
        ));
        assert!(!webhook_filter_allows(Some("oops"), "issue.created", &payload));
    }
}

#[cfg(test)]
mod delivery_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[test]
    fn webhook_delivery_posts_then_retries_after_an_http_failure() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("webhook-delivery");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        let listener = TcpListener::bind("127.0.0.1:0").expect("ephemeral listener");
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let body = Arc::new(Mutex::new(String::new()));
        let captured = body.clone();
        let server = std::thread::spawn(move || {
            for status in ["500 Internal Server Error", "204 No Content"] {
                let (mut stream, _) = listener.accept().expect("webhook request");
                let mut request = [0_u8; 4096];
                let n = stream.read(&mut request).expect("read request");
                *captured.lock().unwrap() = String::from_utf8_lossy(&request[..n]).into_owned();
                stream
                    .write_all(
                        format!(
                            "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        )
                        .as_bytes(),
                    )
                    .expect("response");
            }
        });
        save_application(Application {
            id: "app-delivery".into(),
            name: "Delivery app".into(),
            description: None,
            application_type: "Application".into(),
            endpoint_uri: Some(endpoint.clone()),
            client_id: "delivery-client".into(),
            client_credentials_flow_enabled: true,
            code_flow_enabled: false,
            pkce_required: false,
            connection_status: "CONNECTED".into(),
            archived: false,
        })
        .expect("app");
        save_webhook(WebhookSubscription {
            id: "hook-delivery".into(),
            application_id: "app-delivery".into(),
            event_type: "IssueWebhookEvent".into(),
            filters_json: Some("{}".into()),
            endpoint_uri: endpoint,
            enabled: true,
            secret: Some("shhh".into()),
            max_attempts: 5,
        })
        .expect("hook");
        let failed = deliver_webhook("hook-delivery".into(), r#"{"issue":"GAIA-7"}"#.into())
            .expect("first delivery record");
        assert_eq!(failed.status, "FAILED");
        assert_eq!(failed.attempts, 1);
        let succeeded = retry_webhook_delivery(failed.id).expect("retry");
        assert_eq!(succeeded.status, "SUCCEEDED");
        assert_eq!(succeeded.attempts, 2);
        server.join().expect("server");
        let request = body.lock().unwrap().clone();
        assert!(request.contains("GAIA-7"));
        // signature is present and is the HMAC of the timestamp the server saw
        let timestamp: i64 = header(&request, "x-gaia-space-timestamp")
            .parse()
            .expect("ts");
        assert_eq!(
            header(&request, "x-gaia-space-signature"),
            webhook_signature("shhh", timestamp, r#"{"issue":"GAIA-7"}"#)
        );
        assert_eq!(
            header(&request, "x-gaia-space-delivery-id"),
            succeeded.id,
            "the receiver gets the durable delivery ID for idempotency"
        );
    }

    fn header(request: &str, name: &str) -> String {
        request
            .lines()
            .find_map(|l| {
                l.to_ascii_lowercase()
                    .starts_with(name)
                    .then(|| l.split_once(':').unwrap().1.trim().to_string())
            })
            .unwrap_or_default()
    }

    #[test]
    fn attempts_budget_dead_letters_and_the_sweeper_skips_dead_rows() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("webhook-deadletter");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        // a port nobody listens on: every attempt is a transport error
        let endpoint = {
            let l = TcpListener::bind("127.0.0.1:0").expect("port");
            let a = l.local_addr().unwrap();
            drop(l);
            format!("http://{a}")
        };
        save_application(Application {
            id: "app-dead".into(),
            name: "Dead app".into(),
            description: None,
            application_type: "Application".into(),
            endpoint_uri: Some(endpoint.clone()),
            client_id: "dead-client".into(),
            client_credentials_flow_enabled: true,
            code_flow_enabled: false,
            pkce_required: false,
            connection_status: "CONNECTED".into(),
            archived: false,
        })
        .expect("app");
        save_webhook(WebhookSubscription {
            id: "hook-dead".into(),
            application_id: "app-dead".into(),
            event_type: "IssueWebhookEvent".into(),
            filters_json: None,
            endpoint_uri: endpoint,
            enabled: true,
            secret: None,
            max_attempts: 1,
        })
        .expect("hook");
        let dead = deliver_webhook("hook-dead".into(), "{}".into()).expect("delivery");
        assert_eq!(dead.status, "FAILED");
        assert_eq!(dead.attempts, 1);
        assert!(dead.next_attempt_at.is_none(), "budget spent = dead letter");
        assert!(due_webhook_deliveries(10).unwrap().is_empty());
        assert!(process_webhook_queue(10).unwrap().is_empty());
        assert!(
            retry_webhook_delivery(dead.id).is_err(),
            "no retry past budget"
        );
    }

    #[test]
    fn two_sweepers_deliver_a_due_row_exactly_once() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("webhook-race");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        let listener = TcpListener::bind("127.0.0.1:0").expect("ephemeral listener");
        listener.set_nonblocking(false).ok();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(0_usize));
        let counted = hits.clone();
        let server = std::thread::spawn(move || {
            // first request = the initial delivery, then anything the sweepers send
            for _ in 0..3 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut buf = [0_u8; 2048];
                let _ = stream.read(&mut buf);
                *counted.lock().unwrap() += 1;
                let _ = stream.write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        save_application(Application {
            id: "app-race".into(),
            name: "Race app".into(),
            description: None,
            application_type: "Application".into(),
            endpoint_uri: Some(endpoint.clone()),
            client_id: "race-client".into(),
            client_credentials_flow_enabled: true,
            code_flow_enabled: false,
            pkce_required: false,
            connection_status: "CONNECTED".into(),
            archived: false,
        })
        .expect("app");
        save_webhook(WebhookSubscription {
            id: "hook-race".into(),
            application_id: "app-race".into(),
            event_type: "IssueWebhookEvent".into(),
            filters_json: None,
            endpoint_uri: endpoint,
            enabled: true,
            secret: None,
            max_attempts: 5,
        })
        .expect("hook");
        let failed = deliver_webhook("hook-race".into(), "{}".into()).expect("delivery");
        assert_eq!(failed.attempts, 1);
        // make it due right now
        db::conn()
            .unwrap()
            .execute(
                "UPDATE webhook_deliveries SET next_attempt_at=unixepoch()-1 WHERE id=?1",
                [&failed.id],
            )
            .unwrap();
        let sweepers: Vec<_> = (0..8)
            .map(|_| std::thread::spawn(|| process_webhook_queue(1)))
            .collect();
        let delivered: usize = sweepers.into_iter().map(JoinCount::unwrap_join).sum();
        assert_eq!(delivered, 1, "exactly one of eight sweepers may own a due delivery");
        drop(server);
        assert_eq!(*hits.lock().unwrap(), 2, "initial POST + one retry POST");
        let after = list_webhook_deliveries("hook-race".into()).expect("list");
        assert_eq!(after[0].attempts, 2);
    }

    trait JoinCount {
        fn unwrap_join(self) -> usize;
    }
    impl JoinCount for std::thread::JoinHandle<Result<Vec<WebhookDelivery>>> {
        fn unwrap_join(self) -> usize {
            self.join().expect("sweeper").expect("sweep").len()
        }
    }

    #[test]
    fn expired_claim_recovers_without_spending_an_attempt_and_terminal_rows_stay_unclaimable() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("webhook-lease");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        let c = db::conn().unwrap();
        c.pragma_update(None, "foreign_keys", "OFF").unwrap();
        c.execute("INSERT INTO webhook_deliveries(id,webhook_id,payload_json,status,attempts,next_attempt_at) VALUES ('lease','missing','{}','FAILED',3,unixepoch()-1)", []).unwrap();
        assert!(claim_delivery("lease", true).unwrap());
        let claimed: (String, i64, i64) = c.query_row("SELECT status,attempts,next_attempt_at FROM webhook_deliveries WHERE id='lease'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(claimed.0, "PENDING");
        assert_eq!(claimed.1, 3, "claiming cannot consume an attempt");
        c.execute("UPDATE webhook_deliveries SET next_attempt_at=unixepoch()-1 WHERE id='lease'", []).unwrap();
        assert!(claim_delivery("lease", true).unwrap(), "an abandoned lease becomes claimable");
        c.execute("UPDATE webhook_deliveries SET status='SUCCEEDED',next_attempt_at=NULL WHERE id='lease'", []).unwrap();
        assert!(!claim_delivery("lease", false).unwrap());
        c.execute("UPDATE webhook_deliveries SET status='FAILED',next_attempt_at=NULL WHERE id='lease'", []).unwrap();
        assert!(!claim_delivery("lease", false).unwrap(), "dead letter stays terminal");
    }

    #[test]
    fn max_attempts_must_be_positive() {
        assert!(save_webhook(WebhookSubscription {
            id: "h".into(),
            application_id: "a".into(),
            event_type: "E".into(),
            filters_json: None,
            endpoint_uri: "https://example.test".into(),
            enabled: true,
            secret: None,
            max_attempts: 0,
        })
        .is_err());
    }

    /// End to end: an issue write must produce a delivery row for the subscription
    /// whose filter accepts it, and none for the one that rejects it.
    #[test]
    fn an_issue_write_enqueues_only_the_matching_subscription() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("issue-fanout");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        save_application(Application {
            id: "app-fanout".into(),
            name: "Fan-out app".into(),
            description: None,
            application_type: "Application".into(),
            endpoint_uri: Some("https://example.test/hook".into()),
            client_id: "fanout-client".into(),
            client_credentials_flow_enabled: true,
            code_flow_enabled: false,
            pkce_required: false,
            connection_status: "CONNECTED".into(),
            archived: false,
        })
        .expect("app");
        let hook = |id: &str, filters: &str| WebhookSubscription {
            id: id.into(),
            application_id: "app-fanout".into(),
            event_type: "issue.created".into(),
            filters_json: Some(filters.into()),
            endpoint_uri: "https://example.test/hook".into(),
            enabled: true,
            secret: None,
            max_attempts: 5,
        };
        save_webhook(hook("hook-match", r#"{"issue.priority":"HIGH"}"#)).expect("matching hook");
        save_webhook(hook("hook-miss", r#"{"issue.priority":"LOW"}"#)).expect("other hook");

        let c = db::conn().expect("db");
        c.execute(
            "INSERT INTO projects(id,name,key,archived,created_at) VALUES('proj','Fan-out','FAN',0,0)",
            [],
        )
        .expect("project");
        drop(c);
        let issue = crate::issues::create_issue(crate::issues::IssueInput {
            id: Some("issue-fanout".into()),
            project_id: "proj".into(),
            title: "Urgent".into(),
            description: None,
            status_id: None,
            assignee_id: None,
            assignee_ids: vec![],
            created_by: None,
            due_date: None,
            priority: Some("HIGH".into()),
            archived: None,
        })
        .expect("issue");

        let c = db::conn().expect("db");
        let targets: Vec<String> = c
            .prepare("SELECT webhook_id FROM webhook_deliveries ORDER BY webhook_id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(targets, vec!["hook-match".to_string()]);
        let (payload, status): (String, String) = c
            .query_row(
                "SELECT payload_json,status FROM webhook_deliveries WHERE webhook_id='hook-match'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("delivery row");
        assert_eq!(status, "PENDING", "the row is durable before any send");
        let payload: serde_json::Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(payload["event"], "issue.created");
        assert_eq!(payload["issue"]["id"], issue.id);
        assert_eq!(payload["issue"]["priority"], "HIGH");
    }

    /// The taxonomy is cross-domain: a document write fans out on its own event name
    /// and must not land in an issue subscription's queue.
    #[test]
    fn a_document_write_enqueues_only_its_own_domain_subscription() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("doc-fanout");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        save_application(Application {
            id: "app-doc".into(),
            name: "Doc app".into(),
            description: None,
            application_type: "Application".into(),
            endpoint_uri: Some("https://example.test/hook".into()),
            client_id: "doc-client".into(),
            client_credentials_flow_enabled: true,
            code_flow_enabled: false,
            pkce_required: false,
            connection_status: "CONNECTED".into(),
            archived: false,
        })
        .expect("app");
        let hook = |id: &str, event: &str, filters: &str| WebhookSubscription {
            id: id.into(),
            application_id: "app-doc".into(),
            event_type: event.into(),
            filters_json: Some(filters.into()),
            endpoint_uri: "https://example.test/hook".into(),
            enabled: true,
            secret: None,
            max_attempts: 5,
        };
        save_webhook(hook(
            "hook-doc",
            "DocumentWebhookEvent",
            r#"{"document.doc_type":"text"}"#,
        ))
        .expect("doc hook");
        save_webhook(hook("hook-issue", "issue.created", "{}")).expect("issue hook");

        let c = db::conn().expect("db");
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,body,version) VALUES('doc-1','my-docs','p1','text','Draft','body',1)", []).expect("doc row");
        drop(c);
        crate::documents::save_document(
            "doc-1".into(),
            "Draft v2".into(),
            Some("body v2".into()),
            None,
        )
        .expect("save");

        let c = db::conn().expect("db");
        let targets: Vec<String> = c
            .prepare("SELECT webhook_id FROM webhook_deliveries ORDER BY webhook_id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(targets, vec!["hook-doc".to_string()]);
        let payload: String = c
            .query_row(
                "SELECT payload_json FROM webhook_deliveries WHERE webhook_id='hook-doc'",
                [],
                |r| r.get(0),
            )
            .expect("delivery row");
        let payload: serde_json::Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(payload["event"], "DocumentWebhookEvent");
        assert_eq!(payload["document"]["title"], "Draft v2");
    }

    /// Registers `app-fanout` plus the given subscriptions, all pointing at the same
    /// unreachable endpoint (nothing is sent in these tests — only the queue is read).
    fn register_hooks(app_id: &str, hooks: &[(&str, &str, Option<&str>)]) {
        save_application(Application {
            id: app_id.into(),
            name: "Fan-out app".into(),
            description: None,
            application_type: "Application".into(),
            endpoint_uri: Some("https://example.test/hook".into()),
            client_id: format!("{app_id}-client"),
            client_credentials_flow_enabled: true,
            code_flow_enabled: false,
            pkce_required: false,
            connection_status: "CONNECTED".into(),
            archived: false,
        })
        .expect("app");
        for (id, event_type, filters) in hooks {
            save_webhook(WebhookSubscription {
                id: (*id).into(),
                application_id: app_id.into(),
                event_type: (*event_type).into(),
                filters_json: filters.map(|f| f.to_string()),
                endpoint_uri: "https://example.test/hook".into(),
                enabled: true,
                secret: None,
                max_attempts: 5,
            })
            .expect("hook");
        }
    }

    fn queued_webhook_ids() -> Vec<String> {
        let c = db::conn().expect("db");
        let ids = c
            .prepare("SELECT webhook_id FROM webhook_deliveries ORDER BY webhook_id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        ids
    }

    fn queued_payload(webhook_id: &str) -> serde_json::Value {
        let c = db::conn().expect("db");
        let raw: String = c
            .query_row(
                "SELECT payload_json FROM webhook_deliveries WHERE webhook_id=?1",
                [webhook_id],
                |r| r.get(0),
            )
            .expect("delivery row");
        serde_json::from_str(&raw).expect("payload json")
    }

    /// Third domain, same contract: a review write enqueues for the subscription whose
    /// dot-path filter accepts the review, and for nobody else.
    #[test]
    fn a_review_write_enqueues_only_the_matching_subscription() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("review-fanout");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        register_hooks(
            "app-review",
            &[
                (
                    "hook-review",
                    crate::events::REVIEW_CREATED,
                    Some(r#"{"review.state":"Opened"}"#),
                ),
                (
                    "hook-review-miss",
                    crate::events::REVIEW_CREATED,
                    Some(r#"{"review.state":"Merged"}"#),
                ),
                ("hook-issue", crate::events::ISSUE_CREATED, None),
            ],
        );

        let c = db::conn().expect("db");
        c.execute(
            "INSERT INTO projects(id,name,key,archived,created_at) VALUES('proj','Fan-out','FAN',0,0)",
            [],
        )
        .expect("project");
        drop(c);
        crate::review::create_review(crate::review::Review {
            id: "rev-fanout".into(),
            project_id: "proj".into(),
            number: 1,
            kind: "MR".into(),
            state: "Opened".into(),
            source_branch: Some("feature".into()),
            target_branch: Some("main".into()),
            title: "Add fan-out".into(),
            turn_based: true,
            channel_id: None,
            repo_path: None,
        })
        .expect("review");

        assert_eq!(queued_webhook_ids(), vec!["hook-review".to_string()]);
        let payload = queued_payload("hook-review");
        assert_eq!(payload["event"], crate::events::REVIEW_CREATED);
        assert_eq!(payload["review"]["id"], "rev-fanout");
        assert_eq!(payload["review"]["title"], "Add fan-out");
    }

    /// A document save emits the taxonomy name and the pre-taxonomy alias, so both an
    /// old and a new subscription receive exactly one delivery.
    #[test]
    fn a_document_save_serves_both_the_taxonomy_name_and_the_legacy_alias() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("doc-alias-fanout");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        register_hooks(
            "app-doc-alias",
            &[
                ("hook-new", crate::events::DOCUMENT_UPDATED, None),
                ("hook-legacy", crate::events::LEGACY_DOCUMENT_EVENT, None),
            ],
        );
        let c = db::conn().expect("db");
        c.execute(
            "INSERT INTO documents(id,container_type,container_id,doc_type,title,body,version) VALUES('doc-alias','my-docs','p1','text','Draft','body',1)",
            [],
        )
        .expect("document");
        drop(c);

        crate::documents::save_document(
            "doc-alias".into(),
            "Draft v2".into(),
            Some("body".into()),
            None,
        )
        .expect("save");

        assert_eq!(
            queued_webhook_ids(),
            vec!["hook-legacy".to_string(), "hook-new".to_string()]
        );
        assert_eq!(
            queued_payload("hook-new")["event"],
            crate::events::DOCUMENT_UPDATED
        );
        assert_eq!(
            queued_payload("hook-legacy")["event"],
            crate::events::LEGACY_DOCUMENT_EVENT
        );
    }

    /// Fourth domain: a real `git::repo_commit` in a throwaway repo must enqueue for a
    /// `git.commit` subscription whose filter addresses the commit envelope.
    #[test]
    fn a_git_commit_enqueues_the_matching_subscription() {
        let _serial = db::test_serial();
        let temp = db::TempDb::new("git-fanout");
        db::migrate_path(&temp).expect("migration");
        std::env::set_var("SPACE_DB", temp.path());
        // Throwaway repo under target/, never a user-registered path; swept at both ends.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-repos")
            .join(format!("git-fanout-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("repo dir");
        let repo = git2::Repository::init(&dir).expect("init");
        {
            let mut config = repo.config().expect("config");
            config.set_str("user.name", "Fan Out").expect("name");
            config
                .set_str("user.email", "fanout@example.test")
                .expect("email");
        }
        std::fs::write(dir.join("a.txt"), "hello").expect("file");
        let path = dir.to_string_lossy().to_string();
        crate::git::repo_stage(path.clone(), vec!["a.txt".into()]).expect("stage");

        register_hooks(
            "app-git",
            &[
                (
                    "hook-git",
                    crate::events::GIT_COMMIT,
                    Some(&format!(r#"{{"commit.repo_path":"{path}"}}"#)),
                ),
                (
                    "hook-git-miss",
                    crate::events::GIT_COMMIT,
                    Some(r#"{"commit.repo_path":"/nowhere"}"#),
                ),
            ],
        );

        let oid = crate::git::repo_commit(path.clone(), "first".into()).expect("commit");

        let queued = queued_webhook_ids();
        let payload = queued_payload("hook-git");
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(queued, vec!["hook-git".to_string()]);
        assert_eq!(payload["event"], crate::events::GIT_COMMIT);
        assert_eq!(payload["commit"]["id"], oid);
        assert_eq!(payload["commit"]["message"], "first");
    }

    /// Validation runs before any DB access, so these need no database.
    #[test]
    fn undecidable_filters_are_refused_on_save() {
        let with_filter = |filters: &str| {
            save_webhook(WebhookSubscription {
                id: "h".into(),
                application_id: "a".into(),
                event_type: "issue.created".into(),
                filters_json: Some(filters.into()),
                endpoint_uri: "https://example.test".into(),
                enabled: true,
                secret: None,
                max_attempts: 5,
            })
        };
        assert!(with_filter("[]").is_err(), "an array is not a predicate");
        assert!(with_filter("7").is_err());
        assert!(with_filter("not json").is_err());
        assert!(
            with_filter(r#"{"event":"issue.created"}"#).is_err(),
            "event must be a list"
        );
        assert!(with_filter(r#"{"issue..id":"x"}"#).is_err());
    }
}
