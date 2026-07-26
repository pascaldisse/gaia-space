#![allow(dead_code)]
//! Shared My Documents, project documents and KB containers with version snapshots.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentFolder {
    pub id: String,
    pub container_type: String,
    pub container_id: Option<String>,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub container_type: String,
    pub container_id: Option<String>,
    pub folder_id: Option<String>,
    pub doc_type: String,
    pub title: String,
    pub body: Option<String>,
    pub version: i64,
    pub archived: bool,
    pub created_by: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct DocVersion {
    pub id: String,
    pub document_id: String,
    pub version: i64,
    pub body: Option<String>,
    pub created_by: Option<String>,
    pub created_at: i64,
}
#[tauri::command]
pub fn list_documents(app: AppHandle) -> Result<Vec<Document>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by FROM documents ORDER BY updated_at DESC").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Document {
                id: r.get(0)?,
                container_type: r.get(1)?,
                container_id: r.get(2)?,
                folder_id: r.get(3)?,
                doc_type: r.get(4)?,
                title: r.get(5)?,
                body: r.get(6)?,
                version: r.get(7)?,
                archived: r.get(8)?,
                created_by: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_document(app: AppHandle, id: String) -> Result<Option<Document>> {
    Ok(list_documents(app)?.into_iter().find(|v| v.id == id))
}
#[tauri::command]
pub fn create_document(app: AppHandle, document: Document) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![document.id,document.container_type,document.container_id,document.folder_id,document.doc_type,document.title,document.body,document.version,document.archived,document.created_by]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_document(app: AppHandle, document: Document) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("UPDATE documents SET container_type=?2,container_id=?3,folder_id=?4,doc_type=?5,title=?6,body=?7,version=?8,archived=?9,updated_at=unixepoch() WHERE id=?1",rusqlite::params![document.id,document.container_type,document.container_id,document.folder_id,document.doc_type,document.title,document.body,document.version,document.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_document_folders(app: AppHandle) -> Result<Vec<DocumentFolder>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,container_type,container_id,parent_id,name,description,archived FROM document_folders ORDER BY name").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(DocumentFolder {
                id: r.get(0)?,
                container_type: r.get(1)?,
                container_id: r.get(2)?,
                parent_id: r.get(3)?,
                name: r.get(4)?,
                description: r.get(5)?,
                archived: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
// TODO: access inheritance, archive/delete lifecycle and document restore snapshots.
