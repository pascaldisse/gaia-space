#![allow(dead_code)]
//! Shared My Documents, project documents and KB containers with version snapshots.
//!
//! Container scoping (per docs/space-knowledge-base/04-collaboration.md §2.2/§2.3):
//! - "my-docs"  -> container_id = owning profile id (personal, private folder tree)
//! - "project"  -> container_id = project id
//! - "kb"       -> container_id = book id, where a "book" is simply the top-level
//!                 (parent_id IS NULL) document_folder in the 'kb' container; articles
//!                 are ordinary documents filed into folders under that book.
//!
//! Versioning: every content save (`save_document`) increments `documents.version` and
//! appends an immutable `doc_versions` row. Restoring an old version does not rewrite
//! history — it copies the old body forward as a new latest version, so the version list
//! only ever grows.
use crate::db;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
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

/// An explicit, document-scoped grant. Project documents retain their project
/// membership policy; these grants make a private document shareable by a person
/// or a whole team without widening the rest of its folder tree.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DocumentAccessRecipient {
    pub recipient_type: String,
    pub recipient_id: String,
    pub access_level: String,
}

fn row_to_document(r: &rusqlite::Row) -> rusqlite::Result<Document> {
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
}

const DOC_COLUMNS: &str =
    "id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by";

/// SQL scope used by the web gateway. Personal/unattached documents never inherit
/// access from a container: only `created_by` may read them. A project document is
/// readable by its creator or any member of the attached project.
const DOCUMENT_EXPLICIT_READ_SCOPE: &str = "EXISTS(SELECT 1 FROM document_permissions dp WHERE dp.document_id=d.id AND ((dp.recipient_type='profile' AND dp.recipient_id=?1) OR (dp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=dp.recipient_id AND tm.profile_id=?1 AND tm.archived=0))))";
const DOCUMENT_EXPLICIT_WRITE_SCOPE: &str = "EXISTS(SELECT 1 FROM document_permissions dp WHERE dp.document_id=d.id AND dp.access_level='editor' AND ((dp.recipient_type='profile' AND dp.recipient_id=?1) OR (dp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=dp.recipient_id AND tm.profile_id=?1 AND tm.archived=0))))";
/// The web gateway embeds these predicates into every document read/write query.
/// Explicit grants are additive for a private document; moving it to a project leaves
/// the rows behind but project membership remains the sole effective access policy.
const DOCUMENT_READ_SCOPE: &str = "(d.created_by=?1 OR (d.container_type='project' AND d.container_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1)))) OR (d.container_type='my-docs' AND ";
const DOCUMENT_WRITE_SCOPE: &str = "(d.created_by=?1 OR (d.container_type='project' AND d.container_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND p.created_by=?1) OR ?2=1)) OR (d.container_type='my-docs' AND ";
const DOCUMENT_OWNER_WRITE_SCOPE: &str = "(d.created_by=?1 OR (d.container_type='project' AND d.container_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND p.created_by=?1) OR ?2=1)))";

fn document_read_scope() -> String {
    format!("{DOCUMENT_READ_SCOPE}{DOCUMENT_EXPLICIT_READ_SCOPE}))")
}

fn document_write_scope() -> String {
    format!("{DOCUMENT_WRITE_SCOPE}{DOCUMENT_EXPLICIT_WRITE_SCOPE}))")
}

pub fn document_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM documents d WHERE d.id=?2 AND {})",
            document_read_scope()
        ),
        rusqlite::params![profile_id, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn document_writable_by(id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM documents d WHERE d.id=?3 AND {})",
            document_write_scope()
        ),
        rusqlite::params![profile_id, is_admin, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn list_documents_scoped(profile_id: String) -> Result<Vec<Document>> {
    let c = db::conn()?;
    let mut s = c
        .prepare(&format!(
            "SELECT {DOC_COLUMNS} FROM documents d WHERE {} ORDER BY d.updated_at DESC",
            document_read_scope()
        ))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([profile_id], row_to_document)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

pub fn get_document_scoped(id: String, profile_id: String) -> Result<Option<Document>> {
    let c = db::conn()?;
    c.query_row(
        &format!(
            "SELECT {DOC_COLUMNS} FROM documents d WHERE d.id=?2 AND {}",
            document_read_scope()
        ),
        rusqlite::params![profile_id, id],
        row_to_document,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Content editors may save versions, but placement/lifecycle changes remain with
/// the owner (or the project owner/admin). A shared document can never be moved or
/// archived by the person it was shared with.
pub fn document_owner_writable_by(id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM documents d WHERE d.id=?3 AND {DOCUMENT_OWNER_WRITE_SCOPE})"),
        rusqlite::params![profile_id, is_admin, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn document_access_manageable_by(id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    if is_admin {
        return Ok(true);
    }
    let c = db::conn()?;
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1 AND created_by=?2)",
        rusqlite::params![id, profile_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_document_access(document_id: String) -> Result<Vec<DocumentAccessRecipient>> {
    let c = db::conn()?;
    let mut s = c
        .prepare("SELECT recipient_type,recipient_id,access_level FROM document_permissions WHERE document_id=?1 ORDER BY recipient_type,recipient_id")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([document_id], |r| {
            Ok(DocumentAccessRecipient {
                recipient_type: r.get(0)?,
                recipient_id: r.get(1)?,
                access_level: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Replaces a document's explicit share list atomically. Only private documents use
/// these rows at authorization time; project containers deliberately retain inherited
/// project access (§2.1 move semantics).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_document_access(
    document_id: String,
    permissions: Vec<DocumentAccessRecipient>,
) -> Result<()> {
    for permission in &permissions {
        if !matches!(permission.recipient_type.as_str(), "profile" | "team")
            || !matches!(permission.access_level.as_str(), "viewer" | "editor")
            || permission.recipient_id.trim().is_empty()
        {
            return Err("invalid document access recipient".into());
        }
    }
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let private: bool = tx
        .query_row(
            "SELECT container_type='my-docs' FROM documents WHERE id=?1",
            [&document_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Document not found".to_string())?;
    if !private {
        return Err("only private documents can have explicit sharing".into());
    }
    tx.execute(
        "DELETE FROM document_permissions WHERE document_id=?1",
        [&document_id],
    )
    .map_err(|e| e.to_string())?;
    for permission in permissions {
        tx.execute(
            "INSERT INTO document_permissions(document_id,recipient_type,recipient_id,access_level) VALUES(?1,?2,?3,?4)",
            rusqlite::params![document_id, permission.recipient_type, permission.recipient_id, permission.access_level],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_documents() -> Result<Vec<Document>> {
    let c = db::conn()?;
    let mut s = c
        .prepare(&format!(
            "SELECT {DOC_COLUMNS} FROM documents ORDER BY updated_at DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], row_to_document)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_document(id: String) -> Result<Option<Document>> {
    Ok(list_documents()?.into_iter().find(|v| v.id == id))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_document(document: Document) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        rusqlite::params![
            document.id,
            document.container_type,
            document.container_id,
            document.folder_id,
            document.doc_type,
            document.title,
            document.body,
            document.version,
            document.archived,
            document.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    // seed initial version snapshot so history is never empty for a saved document
    c.execute(
        "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![
            format!("{}-v{}", document.id, document.version),
            document.id,
            document.version,
            document.body,
            document.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Metadata-only update: title, container/folder placement (move), doc_type, archived.
/// Does NOT touch body/version — content saves go through `save_document` so every
/// content change is versioned.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_document(document: Document) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE documents SET container_type=?2,container_id=?3,folder_id=?4,doc_type=?5,title=?6,archived=?7,updated_at=unixepoch() WHERE id=?1",
        rusqlite::params![
            document.id,
            document.container_type,
            document.container_id,
            document.folder_id,
            document.doc_type,
            document.title,
            document.archived
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Move a document to a different folder (and/or container) without altering content.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn move_document(
    id: String,
    container_type: String,
    container_id: Option<String>,
    folder_id: Option<String>,
) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE documents SET container_type=?2,container_id=?3,folder_id=?4,updated_at=unixepoch() WHERE id=?1",
        rusqlite::params![id, container_type, container_id, folder_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_document(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE documents SET archived=?2,updated_at=unixepoch() WHERE id=?1",
        rusqlite::params![id, archived],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_document(id: String) -> Result<()> {
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM doc_versions WHERE document_id=?1", [&id])
        .map_err(|e| e.to_string())?;
    if tx
        .execute("DELETE FROM documents WHERE id=?1", [&id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("Document not found".into());
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Save editor content: bumps `version` and appends an immutable `doc_versions` row.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_document(
    id: String,
    title: String,
    body: Option<String>,
    actor: Option<String>,
) -> Result<Document> {
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let current_version: i64 = tx
        .query_row("SELECT version FROM documents WHERE id=?1", [&id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let next_version = current_version + 1;
    tx.execute(
        "UPDATE documents SET title=?2,body=?3,version=?4,updated_at=unixepoch() WHERE id=?1",
        rusqlite::params![id, title, body, next_version],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![
            format!("{id}-v{next_version}"),
            id,
            next_version,
            body,
            actor
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_document(id)?.ok_or_else(|| "document vanished after save".to_string())
}

fn row_to_doc_version(r: &rusqlite::Row) -> rusqlite::Result<DocVersion> {
    Ok(DocVersion {
        id: r.get(0)?,
        document_id: r.get(1)?,
        version: r.get(2)?,
        body: r.get(3)?,
        created_by: r.get(4)?,
        created_at: r.get(5)?,
    })
}

pub fn list_doc_versions_scoped(
    document_id: String,
    profile_id: String,
) -> Result<Vec<DocVersion>> {
    let c = db::conn()?;
    let mut s = c.prepare(&format!("SELECT v.id,v.document_id,v.version,v.body,v.created_by,v.created_at FROM doc_versions v JOIN documents d ON d.id=v.document_id WHERE v.document_id=?2 AND {DOCUMENT_READ_SCOPE} ORDER BY v.version DESC")).map_err(|e| e.to_string())?;
    let rows = s
        .query_map(
            rusqlite::params![profile_id, document_id],
            row_to_doc_version,
        )
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_doc_versions(document_id: String) -> Result<Vec<DocVersion>> {
    let c = db::conn()?;
    let mut s = c.prepare("SELECT id,document_id,version,body,created_by,created_at FROM doc_versions WHERE document_id=?1 ORDER BY version DESC").map_err(|e| e.to_string())?;
    let rows = s
        .query_map([document_id], row_to_doc_version)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Restore an earlier version: copies its body forward as a brand-new latest version
/// (history is append-only — nothing is deleted or rewritten).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn restore_doc_version(
    document_id: String,
    version: i64,
    actor: Option<String>,
) -> Result<Document> {
    let restored_body: Option<String> = {
        let c = db::conn()?;
        c.query_row(
            "SELECT body FROM doc_versions WHERE document_id=?1 AND version=?2",
            rusqlite::params![document_id, version],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    let title: String = {
        let c = db::conn()?;
        c.query_row(
            "SELECT title FROM documents WHERE id=?1",
            [&document_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    save_document(document_id, title, restored_body, actor)
}

/// Read scope for folders. The `kb` branch is deliberately derived, not granted:
/// a knowledge-base folder becomes navigable only to a profile that already owns a
/// readable document filed in that exact folder or in the book it belongs to
/// (`DOCUMENT_READ_SCOPE` admits `created_by`). This closes the invisibility defect
/// -- a creator could read their own kb article but never see its container -- without
/// widening anything: a profile with no readable document in the book still sees nothing.
const FOLDER_READ_SCOPE: &str = "((f.container_type='my-docs' AND f.container_id=?1) OR (f.container_type='project' AND f.container_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=f.container_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1)))) OR (f.container_type='kb' AND EXISTS(SELECT 1 FROM documents d WHERE d.container_type='kb' AND d.created_by=?1 AND (d.folder_id=f.id OR d.container_id=f.id))))";
const FOLDER_WRITE_SCOPE: &str = "((f.container_type='my-docs' AND f.container_id=?1) OR (f.container_type='project' AND f.container_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=f.container_id AND p.created_by=?1) OR ?2=1)))";

fn row_to_folder(r: &rusqlite::Row) -> rusqlite::Result<DocumentFolder> {
    Ok(DocumentFolder {
        id: r.get(0)?,
        container_type: r.get(1)?,
        container_id: r.get(2)?,
        parent_id: r.get(3)?,
        name: r.get(4)?,
        description: r.get(5)?,
        archived: r.get(6)?,
    })
}

pub fn document_folder_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM document_folders f WHERE f.id=?2 AND {FOLDER_READ_SCOPE})"
        ),
        rusqlite::params![profile_id, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn document_folder_writable_by(id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(&format!("SELECT EXISTS(SELECT 1 FROM document_folders f WHERE f.id=?3 AND {FOLDER_WRITE_SCOPE})"), rusqlite::params![profile_id, is_admin, id], |row| row.get(0)).map_err(|e| e.to_string())
}

pub fn list_document_folders_scoped(profile_id: String) -> Result<Vec<DocumentFolder>> {
    let c = db::conn()?;
    let mut s = c.prepare(&format!("SELECT id,container_type,container_id,parent_id,name,description,archived FROM document_folders f WHERE {FOLDER_READ_SCOPE} ORDER BY name")).map_err(|e|e.to_string())?;
    let rows = s
        .query_map([profile_id], row_to_folder)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_document_folders() -> Result<Vec<DocumentFolder>> {
    let c = db::conn()?;
    let mut s=c.prepare("SELECT id,container_type,container_id,parent_id,name,description,archived FROM document_folders ORDER BY name").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], row_to_folder)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_document_folder(folder: DocumentFolder) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,description,archived) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            folder.id,
            folder.container_type,
            folder.container_id,
            folder.parent_id,
            folder.name,
            folder.description,
            folder.archived
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Full-replace update: rename, edit description, move to a new parent (children follow
/// automatically since they merely reference this folder's id), toggle archived.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_document_folder(folder: DocumentFolder) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE document_folders SET container_type=?2,container_id=?3,parent_id=?4,name=?5,description=?6,archived=?7 WHERE id=?1",
        rusqlite::params![
            folder.id,
            folder.container_type,
            folder.container_id,
            folder.parent_id,
            folder.name,
            folder.description,
            folder.archived
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Move a folder under a new parent (or to root with `None`). Subfolders/documents keep
/// referencing this folder's id, so they move along transparently.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn move_document_folder(id: String, parent_id: Option<String>) -> Result<()> {
    let c = db::conn()?;
    c.execute(
        "UPDATE document_folders SET parent_id=?2 WHERE id=?1",
        rusqlite::params![id, parent_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_conn() -> rusqlite::Connection {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "gaia-space-documents-test-{}-{}.sqlite",
            std::process::id(),
            n
        ));
        let _ = std::fs::remove_file(&path);
        db::migrate_path(&path).expect("migration")
    }

    fn insert_doc(
        c: &rusqlite::Connection,
        id: &str,
        container_type: &str,
        container_id: Option<&str>,
        folder_id: Option<&str>,
        body: &str,
    ) {
        c.execute(
            "INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by) VALUES(?1,?2,?3,?4,'text',?5,?6,1,0,NULL)",
            rusqlite::params![id, container_type, container_id, folder_id, format!("Doc {id}"), body],
        )
        .unwrap();
        c.execute(
            "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,1,?3,NULL)",
            rusqlite::params![format!("{id}-v1"), id, body],
        )
        .unwrap();
    }

    #[test]
    fn version_save_and_restore_roundtrip() {
        let c = test_conn();
        insert_doc(&c, "doc1", "project", Some("demo-project"), None, "v1 body");

        // simulate save_document's core SQL directly against the shared connection
        // (save_document itself opens its own AppHandle-scoped connection in prod).
        let bump = |c: &rusqlite::Connection, body: &str| {
            let cur: i64 = c
                .query_row("SELECT version FROM documents WHERE id='doc1'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let next = cur + 1;
            c.execute(
                "UPDATE documents SET body=?1,version=?2 WHERE id='doc1'",
                rusqlite::params![body, next],
            )
            .unwrap();
            c.execute(
                "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,'doc1',?2,?3,NULL)",
                rusqlite::params![format!("doc1-v{next}"), next, body],
            )
            .unwrap();
            next
        };
        bump(&c, "v2 body");
        bump(&c, "v3 body");

        let versions: i64 = c
            .query_row(
                "SELECT count(*) FROM doc_versions WHERE document_id='doc1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(versions, 3);

        // restore v1: copy its body forward as a new v4
        let v1_body: String = c
            .query_row(
                "SELECT body FROM doc_versions WHERE document_id='doc1' AND version=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v1_body, "v1 body");
        let restored_version = bump(&c, &v1_body);
        assert_eq!(restored_version, 4);

        let (final_body, final_version): (String, i64) = c
            .query_row(
                "SELECT body,version FROM documents WHERE id='doc1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(final_body, "v1 body");
        assert_eq!(final_version, 4);
        let versions_after: i64 = c
            .query_row(
                "SELECT count(*) FROM doc_versions WHERE document_id='doc1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            versions_after, 4,
            "restore appends, never overwrites history"
        );
    }

    #[test]
    fn container_scoping_isolation() {
        let c = test_conn();
        insert_doc(
            &c,
            "my1",
            "my-docs",
            Some("profile-a"),
            None,
            "personal note",
        );
        insert_doc(
            &c,
            "proj1",
            "project",
            Some("demo-project"),
            None,
            "project doc",
        );
        insert_doc(&c, "kb1", "kb", Some("book-1"), None, "kb article");

        let mut stmt = c
            .prepare(&format!("SELECT {DOC_COLUMNS} FROM documents ORDER BY id"))
            .unwrap();
        let docs: Vec<Document> = stmt
            .query_map([], row_to_document)
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(docs.len(), 3);

        let my_docs: Vec<_> = docs
            .iter()
            .filter(|d| d.container_type == "my-docs")
            .collect();
        assert_eq!(my_docs.len(), 1);
        assert_eq!(my_docs[0].container_id.as_deref(), Some("profile-a"));

        let proj_docs: Vec<_> = docs
            .iter()
            .filter(|d| d.container_type == "project")
            .collect();
        assert_eq!(proj_docs.len(), 1);
        assert_eq!(proj_docs[0].container_id.as_deref(), Some("demo-project"));

        let kb_docs: Vec<_> = docs.iter().filter(|d| d.container_type == "kb").collect();
        assert_eq!(kb_docs.len(), 1);
        assert_eq!(kb_docs[0].container_id.as_deref(), Some("book-1"));

        // isolation: a container-scoped query for one container never returns another's rows
        assert!(!my_docs.iter().any(|d| d.id == "proj1" || d.id == "kb1"));
        assert!(!proj_docs.iter().any(|d| d.id == "my1" || d.id == "kb1"));
        assert!(!kb_docs.iter().any(|d| d.id == "my1" || d.id == "proj1"));
    }

    #[test]
    fn folder_move_with_children() {
        let c = test_conn();
        c.execute(
            "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('book-1','kb','book-1',NULL,'Book One',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('folder-a','kb','book-1',NULL,'Folder A',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('child-1','kb','book-1','folder-a','Child One',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('child-2','kb','book-1','folder-a','Child Two',0)",
            [],
        )
        .unwrap();

        // move folder-a under book-1's sibling structure (simulate move_document_folder)
        c.execute(
            "UPDATE document_folders SET parent_id=?2 WHERE id=?1",
            rusqlite::params!["folder-a", Some("book-1")],
        )
        .unwrap();

        let parent_of_a: Option<String> = c
            .query_row(
                "SELECT parent_id FROM document_folders WHERE id='folder-a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(parent_of_a.as_deref(), Some("book-1"));

        // children still reference folder-a — they moved along with it, no orphaning
        let mut stmt = c
            .prepare("SELECT id FROM document_folders WHERE parent_id='folder-a' ORDER BY id")
            .unwrap();
        let children: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(children, vec!["child-1".to_string(), "child-2".to_string()]);
    }

    fn readable_folders(c: &rusqlite::Connection, profile: &str) -> Vec<String> {
        let sql =
            format!("SELECT f.id FROM document_folders f WHERE {FOLDER_READ_SCOPE} ORDER BY f.id");
        let mut s = c.prepare(&sql).unwrap();
        s.query_map([profile], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap()
    }

    fn scoped_doc_ids(c: &rusqlite::Connection, profile: &str, write: bool) -> Vec<String> {
        let scope = if write {
            document_write_scope()
        } else {
            document_read_scope()
        };
        let sql = format!("SELECT d.id FROM documents d WHERE {scope} ORDER BY d.id");
        let mut statement = c.prepare(&sql).unwrap();
        let params: &[&dyn rusqlite::ToSql] = if write {
            &[&profile, &false]
        } else {
            &[&profile]
        };
        statement
            .query_map(params, |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn explicit_document_grants_are_scoped_and_editor_only_for_writes() {
        let c = test_conn();
        for id in ["owner", "viewer", "editor", "stranger"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,0)",
                [id],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO teams(id,name) VALUES('team-editors','Editors')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO team_memberships(id,profile_id,team_id) VALUES('membership-editor','editor','team-editors')",
            [],
        )
        .unwrap();
        for id in ["shared-view", "shared-edit"] {
            c.execute(
                "INSERT INTO documents(id,container_type,doc_type,title,version,archived,created_by) VALUES(?1,'my-docs','text',?1,1,0,'owner')",
                [id],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO document_permissions(document_id,recipient_type,recipient_id,access_level) VALUES('shared-view','profile','viewer','viewer'),('shared-edit','team','team-editors','editor')",
            [],
        )
        .unwrap();

        assert_eq!(scoped_doc_ids(&c, "viewer", false), vec!["shared-view"]);
        assert!(
            scoped_doc_ids(&c, "viewer", true).is_empty(),
            "a viewer cannot write"
        );
        assert_eq!(scoped_doc_ids(&c, "editor", false), vec!["shared-edit"]);
        assert_eq!(scoped_doc_ids(&c, "editor", true), vec!["shared-edit"]);
        assert!(
            scoped_doc_ids(&c, "stranger", false).is_empty(),
            "ungranted profiles see nothing"
        );
    }

    /// A knowledge-base book is navigable to the profile that owns an article inside it,
    /// and to nobody else. Guards both halves of the contract at once: no invisibility for
    /// the owner, no broadening for a stranger.
    #[test]
    fn kb_book_is_visible_only_to_a_profile_owning_an_article_in_it() {
        let c = test_conn();
        for p in ["profile-a", "profile-b"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,0)",
                rusqlite::params![p],
            )
            .unwrap();
        }
        for (id, parent) in [
            ("book-1", None),
            ("book-chapter", Some("book-1")),
            ("book-2", None),
        ] {
            c.execute(
                "INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES(?1,'kb',?2,?3,?1)",
                rusqlite::params![id, if parent.is_some() { "book-1" } else { id }, parent],
            )
            .unwrap();
        }
        // profile-a authored one article, filed in the chapter of book-1.
        c.execute(
            "INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by) VALUES('kb-art','kb','book-1','book-chapter','text','Article','b',1,0,'profile-a')",
            [],
        )
        .unwrap();

        // owner: sees the chapter it is filed in and the book that owns it — nothing else.
        assert_eq!(
            readable_folders(&c, "profile-a"),
            vec!["book-1".to_string(), "book-chapter".to_string()],
            "the author of a kb article must be able to navigate its container"
        );
        // stranger: the book, the chapter and the unrelated book stay invisible.
        assert!(
            readable_folders(&c, "profile-b").is_empty(),
            "a profile with no readable article in a book must see no kb folder at all"
        );
    }
}
