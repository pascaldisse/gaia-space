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
    if let Some(filters) = &value.filters_json {
        serde_json::from_str::<serde_json::Value>(filters)
            .map_err(|_| "webhook filters must be JSON".to_string())?;
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
    let signature = secret
        .as_deref()
        .map(|s| webhook_signature(s, timestamp, &payload));
    let result = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .post(&endpoint_uri)
        .header("content-type", "application/json")
        .header("x-gaia-space-webhook", &webhook_id)
        .header("x-gaia-space-timestamp", timestamp.to_string())
        .header(
            "x-gaia-space-signature",
            signature.clone().unwrap_or_default(),
        )
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
        let a = std::thread::spawn(|| process_webhook_queue(1));
        let b = std::thread::spawn(|| process_webhook_queue(1));
        let delivered = a.unwrap_join() + b.unwrap_join();
        assert_eq!(delivered, 1, "exactly one sweeper may own a due delivery");
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
}
