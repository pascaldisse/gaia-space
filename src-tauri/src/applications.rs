//! Local application registry and repository dev-setup metadata.
//!
//! This intentionally does not provision remote machines. Devfiles describe a
//! repository and `open_in_ide` produces a user-initiated JetBrains deep link.
use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
fn new_id(kind: &str) -> String {
    format!(
        "{kind}-{:x}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
fn err<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|e| e.to_string())
}
fn require_text(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}
fn optional_url(label: &str, value: &Option<String>) -> Result<()> {
    if let Some(url) = value.as_deref() {
        let valid = url.starts_with("https://") || url.starts_with("http://");
        if !valid {
            return Err(format!("{label} must use http:// or https://"));
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Devfile {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub content: String,
    pub generated: bool,
    pub updated_at: i64,
}
#[derive(Debug, Deserialize)]
pub struct DevfileInput {
    pub id: Option<String>,
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub content: String,
    pub generated: Option<bool>,
}
#[derive(Debug, Serialize)]
pub struct IdeLaunch {
    pub url: String,
    pub ide: String,
    pub repository: String,
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_devfiles(project_id: Option<String>) -> Result<Vec<Devfile>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,project_id,path,name,content,generated,updated_at FROM devfiles WHERE (?1 IS NULL OR project_id=?1) ORDER BY project_id,name"))?;
    let rows = err(s.query_map(params![project_id], |r| {
        Ok(Devfile {
            id: r.get(0)?,
            project_id: r.get(1)?,
            path: r.get(2)?,
            name: r.get(3)?,
            content: r.get(4)?,
            generated: r.get(5)?,
            updated_at: r.get(6)?,
        })
    }))?;
    err(rows.collect())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_devfile(input: DevfileInput) -> Result<Devfile> {
    require_text("project", &input.project_id)?;
    require_text("path", &input.path)?;
    require_text("name", &input.name)?;
    require_text("content", &input.content)?;
    if !input.path.starts_with(".space/") || !input.path.ends_with(".devfile.yaml") {
        return Err("devfile path must be under .space/ and end in .devfile.yaml".into());
    }
    let row = Devfile {
        id: input.id.unwrap_or_else(|| new_id("devfile")),
        project_id: input.project_id,
        path: input.path,
        name: input.name,
        content: input.content,
        generated: input.generated.unwrap_or(false),
        updated_at: chrono::Utc::now().timestamp(),
    };
    let c = db::conn()?;
    err(c.execute("INSERT INTO devfiles(id,project_id,path,name,content,generated,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(project_id,path) DO UPDATE SET name=excluded.name,content=excluded.content,generated=excluded.generated,updated_at=excluded.updated_at",params![row.id,row.project_id,row.path,row.name,row.content,row.generated,row.updated_at]))?;
    Ok(row)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_devfile(id: String) -> Result<()> {
    err(db::conn()?.execute("DELETE FROM devfiles WHERE id=?1", [id]))?;
    Ok(())
}
/// Returns a deep link only; the UI makes the browser/OS launch it after an explicit click.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn open_in_ide(repository: String, ide: String) -> Result<IdeLaunch> {
    require_text("repository", &repository)?;
    let ide = if ide.trim().is_empty() {
        "JetBrains Gateway".into()
    } else {
        ide.trim().to_string()
    };
    let path = repository.trim_start_matches('/').replace(' ', "%20");
    Ok(IdeLaunch {
        url: format!("jetbrains://idea/navigate/reference?project={path}"),
        ide,
        repository,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Application {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub application_type: String,
    pub endpoint_uri: Option<String>,
    pub endpoint_ssl_verification: bool,
    pub connection_status: String,
    pub archived: bool,
    pub created_at: i64,
}
#[derive(Debug, Deserialize)]
pub struct ApplicationInput {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub application_type: Option<String>,
    pub endpoint_uri: Option<String>,
    pub endpoint_ssl_verification: Option<bool>,
}
fn read_app(r: &rusqlite::Row<'_>) -> rusqlite::Result<Application> {
    Ok(Application {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        application_type: r.get(3)?,
        endpoint_uri: r.get(4)?,
        endpoint_ssl_verification: r.get(5)?,
        connection_status: r.get(6)?,
        archived: r.get(7)?,
        created_at: r.get(8)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_applications(include_archived: Option<bool>) -> Result<Vec<Application>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,name,description,application_type,endpoint_uri,endpoint_ssl_verification,connection_status,archived,created_at FROM applications WHERE (?1=1 OR archived=0) ORDER BY name"))?;
    let rows = err(s.query_map([include_archived.unwrap_or(false)], read_app))?;
    err(rows.collect())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_application(input: ApplicationInput) -> Result<Application> {
    require_text("application name", &input.name)?;
    optional_url("endpoint URI", &input.endpoint_uri)?;
    let typ = input
        .application_type
        .unwrap_or_else(|| "Application".into());
    if !matches!(
        typ.as_str(),
        "Application" | "InternalApp" | "MarketplaceApp" | "FeaturedIntegration"
    ) {
        return Err("invalid application type".into());
    };
    let app = Application {
        id: input.id.unwrap_or_else(|| new_id("app")),
        name: input.name.trim().into(),
        description: input.description,
        application_type: typ,
        endpoint_uri: input.endpoint_uri,
        endpoint_ssl_verification: input.endpoint_ssl_verification.unwrap_or(true),
        connection_status: "CONNECTING".into(),
        archived: false,
        created_at: chrono::Utc::now().timestamp(),
    };
    let c = db::conn()?;
    err(c.execute("INSERT INTO applications(id,name,description,application_type,endpoint_uri,endpoint_ssl_verification,connection_status,archived,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,application_type=excluded.application_type,endpoint_uri=excluded.endpoint_uri,endpoint_ssl_verification=excluded.endpoint_ssl_verification",params![app.id,app.name,app.description,app.application_type,app.endpoint_uri,app.endpoint_ssl_verification,app.connection_status,app.archived,app.created_at]))?;
    Ok(app)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_application_connection_status(id: String, status: String) -> Result<()> {
    if !matches!(
        status.as_str(),
        "CONNECTING" | "FAILED_TO_CONNECT" | "RECONNECTING" | "CONNECTED"
    ) {
        return Err("invalid connection status".into());
    };
    err(db::conn()?.execute(
        "UPDATE applications SET connection_status=?2 WHERE id=?1",
        params![id, status],
    ))?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_application(id: String, archived: bool) -> Result<()> {
    err(db::conn()?.execute(
        "UPDATE applications SET archived=?2 WHERE id=?1",
        params![id, archived],
    ))?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Webhook {
    pub id: String,
    pub application_id: String,
    pub event_type: String,
    pub filter_json: Option<String>,
    pub endpoint_url: String,
    pub enabled: bool,
}
#[derive(Debug, Deserialize)]
pub struct WebhookInput {
    pub id: Option<String>,
    pub application_id: String,
    pub event_type: String,
    pub filter_json: Option<String>,
    pub endpoint_url: String,
    pub enabled: Option<bool>,
}
fn read_webhook(r: &rusqlite::Row<'_>) -> rusqlite::Result<Webhook> {
    Ok(Webhook {
        id: r.get(0)?,
        application_id: r.get(1)?,
        event_type: r.get(2)?,
        filter_json: r.get(3)?,
        endpoint_url: r.get(4)?,
        enabled: r.get(5)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_webhooks(application_id: Option<String>) -> Result<Vec<Webhook>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,application_id,event_type,filter_json,endpoint_url,enabled FROM app_webhooks WHERE (?1 IS NULL OR application_id=?1) ORDER BY event_type"))?;
    let rows = err(s.query_map(params![application_id], read_webhook))?;
    err(rows.collect())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_webhook(input: WebhookInput) -> Result<Webhook> {
    require_text("application", &input.application_id)?;
    require_text("event type", &input.event_type)?;
    optional_url("webhook endpoint", &Some(input.endpoint_url.clone()))?;
    if let Some(f) = &input.filter_json {
        serde_json::from_str::<serde_json::Value>(f)
            .map_err(|_| "webhook filter must be JSON".to_string())?;
    }
    let row = Webhook {
        id: input.id.unwrap_or_else(|| new_id("webhook")),
        application_id: input.application_id,
        event_type: input.event_type,
        filter_json: input.filter_json,
        endpoint_url: input.endpoint_url,
        enabled: input.enabled.unwrap_or(true),
    };
    let c = db::conn()?;
    err(c.execute("INSERT INTO app_webhooks(id,application_id,event_type,filter_json,endpoint_url,enabled) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET event_type=excluded.event_type,filter_json=excluded.filter_json,endpoint_url=excluded.endpoint_url,enabled=excluded.enabled",params![row.id,row.application_id,row.event_type,row.filter_json,row.endpoint_url,row.enabled]))?;
    Ok(row)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_webhook(id: String) -> Result<()> {
    err(db::conn()?.execute("DELETE FROM app_webhooks WHERE id=?1", [id]))?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chatbot {
    pub id: String,
    pub application_id: String,
    pub channel_id: Option<String>,
    pub display_name: String,
    pub enabled: bool,
}
#[derive(Debug, Deserialize)]
pub struct ChatbotInput {
    pub id: Option<String>,
    pub application_id: String,
    pub channel_id: Option<String>,
    pub display_name: String,
    pub enabled: Option<bool>,
}
fn read_chatbot(r: &rusqlite::Row<'_>) -> rusqlite::Result<Chatbot> {
    Ok(Chatbot {
        id: r.get(0)?,
        application_id: r.get(1)?,
        channel_id: r.get(2)?,
        display_name: r.get(3)?,
        enabled: r.get(4)?,
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_chatbots(application_id: Option<String>) -> Result<Vec<Chatbot>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,application_id,channel_id,display_name,enabled FROM app_chatbots WHERE (?1 IS NULL OR application_id=?1) ORDER BY display_name"))?;
    let rows = err(s.query_map(params![application_id], read_chatbot))?;
    err(rows.collect())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_chatbot(input: ChatbotInput) -> Result<Chatbot> {
    require_text("application", &input.application_id)?;
    require_text("chatbot name", &input.display_name)?;
    let row = Chatbot {
        id: input.id.unwrap_or_else(|| new_id("chatbot")),
        application_id: input.application_id,
        channel_id: input.channel_id,
        display_name: input.display_name,
        enabled: input.enabled.unwrap_or(true),
    };
    let c = db::conn()?;
    err(c.execute("INSERT INTO app_chatbots(id,application_id,channel_id,display_name,enabled) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id,display_name=excluded.display_name,enabled=excluded.enabled",params![row.id,row.application_id,row.channel_id,row.display_name,row.enabled]))?;
    Ok(row)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_chatbot(id: String) -> Result<()> {
    err(db::conn()?.execute("DELETE FROM app_chatbots WHERE id=?1", [id]))?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UiExtension {
    pub id: String,
    pub application_id: String,
    pub extension_type: String,
    pub display_name: String,
    pub unique_code: String,
    pub iframe_url: Option<String>,
    pub enabled: bool,
}
#[derive(Debug, Deserialize)]
pub struct UiExtensionInput {
    pub id: Option<String>,
    pub application_id: String,
    pub extension_type: String,
    pub display_name: String,
    pub unique_code: String,
    pub iframe_url: Option<String>,
    pub enabled: Option<bool>,
}
fn read_extension(r: &rusqlite::Row<'_>) -> rusqlite::Result<UiExtension> {
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
pub fn list_ui_extensions(application_id: Option<String>) -> Result<Vec<UiExtension>> {
    let c = db::conn()?;
    let mut s=err(c.prepare("SELECT id,application_id,extension_type,display_name,unique_code,iframe_url,enabled FROM app_ui_extensions WHERE (?1 IS NULL OR application_id=?1) ORDER BY display_name"))?;
    let rows = err(s.query_map(params![application_id], read_extension))?;
    err(rows.collect())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_ui_extension(input: UiExtensionInput) -> Result<UiExtension> {
    require_text("application", &input.application_id)?;
    require_text("extension type", &input.extension_type)?;
    require_text("display name", &input.display_name)?;
    require_text("unique code", &input.unique_code)?;
    optional_url("iframe URL", &input.iframe_url)?;
    let row = UiExtension {
        id: input.id.unwrap_or_else(|| new_id("extension")),
        application_id: input.application_id,
        extension_type: input.extension_type,
        display_name: input.display_name,
        unique_code: input.unique_code,
        iframe_url: input.iframe_url,
        enabled: input.enabled.unwrap_or(true),
    };
    let c = db::conn()?;
    err(c.execute("INSERT INTO app_ui_extensions(id,application_id,extension_type,display_name,unique_code,iframe_url,enabled) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET extension_type=excluded.extension_type,display_name=excluded.display_name,unique_code=excluded.unique_code,iframe_url=excluded.iframe_url,enabled=excluded.enabled",params![row.id,row.application_id,row.extension_type,row.display_name,row.unique_code,row.iframe_url,row.enabled]))?;
    Ok(row)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_ui_extension(id: String) -> Result<()> {
    err(db::conn()?.execute("DELETE FROM app_ui_extensions WHERE id=?1", [id]))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_endpoints_must_be_http() {
        assert!(optional_url("endpoint", &Some("ftp://example.test".into())).is_err());
        assert!(optional_url("endpoint", &Some("https://example.test".into())).is_ok());
    }
    #[test]
    fn ide_links_are_user_initiated() {
        let link = open_in_ide("/work/hello world".into(), "".into()).unwrap();
        assert!(link.url.starts_with("jetbrains://"));
        assert_eq!(link.ide, "JetBrains Gateway");
    }
}
