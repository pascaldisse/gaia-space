//! Paloptic landing-page contact entries. The Quest service owns writes; Space
//! receives a read-only, administrator-only view through a host-provided path.
//! The browser never learns the storage path and ordinary Space members never
//! receive personal contact data.
use serde::{Deserialize, Serialize};
use std::{env, fs, path::Path};

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

/// Read the Quest-managed lead store. Production supplies `SPACE_LEADS_PATH`;
/// requiring it means a desktop/local build cannot accidentally read an
/// unrelated developer file.
pub fn list_leads() -> Result<Vec<Lead>> {
    let path = env::var("SPACE_LEADS_PATH").map_err(|_| "lead store unavailable".to_string())?;
    read_from(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_camel_case_dates_and_orders_newest_first() {
        let path = std::env::temp_dir().join(format!("gaia-space-leads-{}.json", std::process::id()));
        fs::write(&path, r#"[
          {"id":"old","bereich":"academy","interesse":"informationen","name":"Old","business":"Old GmbH","address":"A","phone":"1","email":"old@example.test","consent":true,"createdAt":"2026-08-01T00:00:00.000Z"},
          {"id":"new","bereich":"software","interesse":"vormerken","name":"New","business":"New GmbH","address":"B","phone":"2","email":"new@example.test","consent":true,"createdAt":"2026-08-02T00:00:00.000Z"}
        ]"#).unwrap();
        let leads = read_from(&path).unwrap();
        assert_eq!(leads.iter().map(|lead| lead.id.as_str()).collect::<Vec<_>>(), ["new", "old"]);
        assert_eq!(leads[0].created_at, "2026-08-02T00:00:00.000Z");
        let _ = fs::remove_file(path);
    }
}
