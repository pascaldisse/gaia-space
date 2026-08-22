//! Local application registry + repository devfile metadata.
//! No cloud VM lifecycle is implemented: Open in IDE returns a user-initiated deep link.
use crate::db;
use rusqlite::params;
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
    })
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_webhooks(application_id: String) -> Result<Vec<WebhookSubscription>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,application_id,event_type,filters_json,endpoint_uri,enabled FROM webhook_subscriptions WHERE application_id=?1 ORDER BY event_type").map_err(|e|e.to_string())?;
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
    app_exists(&value.application_id)?;
    let c = db::conn()?;
    c.execute("INSERT INTO webhook_subscriptions(id,application_id,event_type,filters_json,endpoint_uri,enabled) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET event_type=excluded.event_type,filters_json=excluded.filters_json,endpoint_uri=excluded.endpoint_uri,enabled=excluded.enabled",params![value.id,value.application_id,value.event_type,value.filters_json,value.endpoint_uri,value.enabled]).map_err(|e|e.to_string())?;
    Ok(value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_webhook(id: String) -> Result<()> {
    db::conn()?
        .execute("DELETE FROM webhook_subscriptions WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
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
