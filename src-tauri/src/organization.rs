//! Organization record and plan settings (KB §05 §2.4).
use crate::db;
use rusqlite::params;
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;
const DEFAULT_ORG_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slogan: Option<String>,
    pub logo_id: Option<String>,
    pub timezone: String,
    pub onboarding_required: bool,
    pub allow_domains_edit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgSettings {
    pub org_id: String,
    pub available_right_codes: Vec<String>,
    pub is_space_code: bool,
    pub is_space_code_only: bool,
}

fn organization_on(c: &rusqlite::Connection) -> Result<Organization> {
    c.query_row("SELECT id,name,slogan,logo_id,timezone,onboarding_required,allow_domains_edit FROM organizations WHERE id=?1", [DEFAULT_ORG_ID], |r| Ok(Organization { id:r.get(0)?, name:r.get(1)?, slogan:r.get(2)?, logo_id:r.get(3)?, timezone:r.get(4)?, onboarding_required:r.get::<_,i64>(5)? != 0, allow_domains_edit:r.get::<_,i64>(6)? != 0 })).map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_organization() -> Result<Organization> {
    organization_on(&db::conn()?)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_organization(value: Organization) -> Result<Organization> {
    if value.name.trim().is_empty() || value.timezone.trim().is_empty() {
        return Err("organization name and timezone are required".into());
    }
    let c = db::conn()?;
    c.execute("UPDATE organizations SET name=?1,slogan=?2,logo_id=?3,timezone=?4,onboarding_required=?5,allow_domains_edit=?6 WHERE id=?7", params![value.name.trim(),value.slogan.filter(|s|!s.trim().is_empty()),value.logo_id.filter(|s|!s.trim().is_empty()),value.timezone.trim(),value.onboarding_required as i32,value.allow_domains_edit as i32,DEFAULT_ORG_ID]).map_err(|e|e.to_string())?;
    organization_on(&c)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_org_settings() -> Result<OrgSettings> {
    let c = db::conn()?;
    c.query_row("SELECT org_id,available_right_codes,is_space_code,is_space_code_only FROM org_settings WHERE org_id=?1", [DEFAULT_ORG_ID], |r| { let raw:String=r.get(1)?; Ok(OrgSettings { org_id:r.get(0)?, available_right_codes:serde_json::from_str(&raw).unwrap_or_default(),is_space_code:r.get::<_,i64>(2)? != 0,is_space_code_only:r.get::<_,i64>(3)? != 0 }) }).map_err(|e|e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_org_settings(value: OrgSettings) -> Result<OrgSettings> {
    let codes = serde_json::to_string(&value.available_right_codes).map_err(|e| e.to_string())?;
    let c = db::conn()?;
    c.execute("UPDATE org_settings SET available_right_codes=?1,is_space_code=?2,is_space_code_only=?3 WHERE org_id=?4",params![codes,value.is_space_code as i32,value.is_space_code_only as i32,DEFAULT_ORG_ID]).map_err(|e|e.to_string())?;
    get_org_settings()
}
