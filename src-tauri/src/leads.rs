//! Paloptic landing-page contact entries. The Quest service owns writes; Space
//! receives an administrator-only view and erasure command through a host-provided
//! path. The browser never learns the storage path and ordinary Space members
//! never receive personal contact data.
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lead {
    pub id: String,
    pub bereich: String,
    pub interesse: String,
    pub name: String,
    pub business: String,
    pub address: String,
    pub phone: String,
    pub email: String,
    pub created_at: String,
}

fn read_from(path: &Path) -> Result<Vec<Lead>> {
    let bytes = fs::read(path).map_err(|_| "lead store unavailable".to_string())?;
    let mut leads: Vec<Lead> =
        serde_json::from_slice(&bytes).map_err(|_| "lead store is invalid".to_string())?;
    // The writer currently prepends. Sorting makes the contract explicit and
    // keeps the newest submission first if another writer changes that detail.
    leads.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(leads)
}

/// Deployment may override this path for a shared Quest store. The default sits next
/// to the Space database, where the service account already owns both the file and its
/// containing directory.
const DEFAULT_LEADS_PATH: &str = "/var/lib/gaia-space/leads.json";

fn lead_store_path(path: Option<PathBuf>) -> PathBuf {
    path.or_else(|| env::var_os("SPACE_LEADS_PATH").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from(DEFAULT_LEADS_PATH))
}

pub fn list_leads() -> Result<Vec<Lead>> {
    list_leads_from(None)
}

fn list_leads_from(path: Option<PathBuf>) -> Result<Vec<Lead>> {
    read_from(&lead_store_path(path))
}

/// Remove one entry from the Quest-managed store. Records are rewritten as raw
/// JSON values so fields Space does not model (consent, future columns) survive
/// the delete untouched. A staged replacement keeps the source intact until the new
/// JSON is durable; it requires write access to the containing directory.
fn delete_from(path: &Path, id: &str) -> Result<()> {
    let bytes = fs::read(path).map_err(|_| "lead store unavailable".to_string())?;
    let entries: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|_| "lead store is invalid".to_string())?;
    let kept: Vec<serde_json::Value> = entries
        .iter()
        .filter(|entry| entry.get("id").and_then(|value| value.as_str()) != Some(id))
        .cloned()
        .collect();
    if kept.len() == entries.len() {
        return Err("lead not found".to_string());
    }
    let encoded = serde_json::to_vec(&kept).map_err(|_| "lead store is invalid".to_string())?;
    let staged = path.with_extension("tmp");
    let mut store = fs::File::create(&staged)
        .map_err(|error| format!("lead store is not writable: {}: {error}", path.display()))?;
    store
        .write_all(&encoded)
        .map_err(|error| format!("lead store is not writable: {}: {error}", path.display()))?;
    store
        .sync_all()
        .map_err(|error| format!("lead store is not writable: {}: {error}", path.display()))?;
    drop(store);
    fs::rename(&staged, path)
        .map_err(|error| format!("lead store is not writable: {}: {error}", path.display()))
}

pub fn delete_lead(id: String) -> Result<()> {
    delete_lead_from(None, &id)
}

fn delete_lead_from(path: Option<PathBuf>, id: &str) -> Result<()> {
    delete_from(&lead_store_path(path), id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn reads_camel_case_dates_and_orders_newest_first() {
        let path =
            std::env::temp_dir().join(format!("gaia-space-leads-{}.json", std::process::id()));
        fs::write(&path, r#"[
          {"id":"old","bereich":"academy","interesse":"informationen","name":"Old","business":"Old GmbH","address":"A","phone":"1","email":"old@example.test","consent":true,"createdAt":"2026-08-01T00:00:00.000Z"},
          {"id":"new","bereich":"software","interesse":"vormerken","name":"New","business":"New GmbH","address":"B","phone":"2","email":"new@example.test","consent":true,"createdAt":"2026-08-02T00:00:00.000Z"}
        ]"#).unwrap();
        let leads = read_from(&path).unwrap();
        assert_eq!(
            leads
                .iter()
                .map(|lead| lead.id.as_str())
                .collect::<Vec<_>>(),
            ["new", "old"]
        );
        assert_eq!(leads[0].created_at, "2026-08-02T00:00:00.000Z");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn delete_removes_one_lead_and_preserves_unmodelled_fields() {
        let path = std::env::temp_dir().join(format!(
            "gaia-space-leads-delete-{}.json",
            std::process::id()
        ));
        fs::write(&path, r#"[
          {"id":"keep","bereich":"academy","interesse":"informationen","name":"Keep","business":"Keep GmbH","address":"A","phone":"1","email":"keep@example.test","consent":true,"createdAt":"2026-08-01T00:00:00.000Z"},
          {"id":"drop","bereich":"software","interesse":"vormerken","name":"Drop","business":"Drop GmbH","address":"B","phone":"2","email":"drop@example.test","consent":true,"createdAt":"2026-08-02T00:00:00.000Z"}
        ]"#).unwrap();

        delete_lead_from(Some(path.clone()), "drop").unwrap();

        let raw: Vec<serde_json::Value> =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0]["id"], "keep");
        assert_eq!(
            raw[0]["consent"], true,
            "fields Space does not model must survive"
        );
        assert_eq!(list_leads_from(Some(path.clone())).unwrap()[0].id, "keep");
        assert_eq!(
            delete_lead_from(Some(path.clone()), "drop"),
            Err("lead not found".to_string())
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn delete_from_read_only_directory_names_store_path_and_io_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("leads.json");
        fs::write(&path, r#"[{"id":"drop"}]"#).unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();

        let error = delete_from(&path, "drop").unwrap_err();

        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            error
                .strip_prefix("lead store is not writable: ")
                .and_then(|message| message.strip_prefix(&format!("{}: ", path.display())))
                .map(|message| !message.is_empty()),
            Some(true)
        );
    }
}
