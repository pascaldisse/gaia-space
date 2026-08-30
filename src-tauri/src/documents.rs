#![allow(dead_code)]
//! Shared My Documents, project documents and KB containers with version snapshots.
//!
//! Container scoping (per docs/space-knowledge-base/04-collaboration.md §2.2/§2.3):
//! - "my-docs"  -> container_id = owning profile id (personal, private folder tree)
//! - "project"  -> container_id = project id
//! - "kb"       -> container_id = book id, where a "book" is simply the top-level
//!   (parent_id IS NULL) document_folder in the 'kb' container; articles
//!   are ordinary documents filed into folders under that book.
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

/// A favourite carries the document it points at plus the two facts that belong to the
/// pointer alone: which shelf it was filed on, and where on that shelf it sits.
#[derive(Debug, Serialize, Deserialize)]
pub struct FavoriteDocument {
    #[serde(flatten)]
    pub document: Document,
    pub group_name: Option<String>,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub container_type: String,
    pub container_id: Option<String>,
    pub folder_id: Option<String>,
    pub doc_type: String,
    #[serde(default = "default_body_format")]
    pub body_format: String,
    pub title: String,
    pub body: Option<String>,
    pub version: i64,
    pub archived: bool,
    pub created_by: Option<String>,
    /// Where this document CAME FROM, when it was not typed here: the same anchor pair
    /// meetings and notes carry, resolvable through `chat::resolve_source_ref`. A chat
    /// attachment filed into a project library keeps `('message-attachment', <id>)`.
    #[serde(default)]
    pub source_entity_type: Option<String>,
    #[serde(default)]
    pub source_entity_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentDiscussion {
    pub document_id: String,
    pub channel_id: String,
    pub meeting_id: Option<String>,
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
    /// `member_id` survives the web identity binder; the response remains recipient_id.
    #[serde(alias = "member_id", alias = "memberId")]
    pub recipient_id: String,
    pub access_level: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DocumentSearchResult {
    pub id: String,
    pub title: String,
    pub snippet: String,
}
fn default_body_format() -> String {
    "text".into()
}
fn row_to_document(r: &rusqlite::Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: r.get(0)?,
        container_type: r.get(1)?,
        container_id: r.get(2)?,
        folder_id: r.get(3)?,
        doc_type: r.get(4)?,
        body_format: r.get(5)?,
        title: r.get(6)?,
        body: r.get(7)?,
        version: r.get(8)?,
        archived: r.get(9)?,
        created_by: r.get(10)?,
        source_entity_type: r.get(11)?,
        source_entity_id: r.get(12)?,
    })
}

const DOC_COLUMNS: &str =
    "id,container_type,container_id,folder_id,doc_type,body_format,title,body,version,archived,created_by,source_entity_type,source_entity_id";

/// SQL scope used by the web gateway. Personal/unattached documents never inherit
/// access from a container: only `created_by` may read them. A project document is
/// readable by its creator or any member of the attached project.
const DOCUMENT_EXPLICIT_READ_SCOPE: &str = "EXISTS(SELECT 1 FROM document_permissions dp WHERE dp.document_id=d.id AND ((dp.recipient_type='profile' AND dp.recipient_id=?1) OR (dp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=dp.recipient_id AND tm.profile_id=?1 AND tm.archived=0))))";
const DOCUMENT_EXPLICIT_WRITE_SCOPE: &str = "EXISTS(SELECT 1 FROM document_permissions dp WHERE dp.document_id=d.id AND dp.access_level='editor' AND ((dp.recipient_type='profile' AND dp.recipient_id=?1) OR (dp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=dp.recipient_id AND tm.profile_id=?1 AND tm.archived=0))))";
/// The web gateway embeds these predicates into every document read/write query.
/// Explicit grants are additive for a private document; moving it to a project leaves
/// the rows behind but project membership remains the sole effective access policy.
/// A KB document carries its book id in `container_id`, so a grant on the book folder
/// is the whole enforcement surface for "editor teams" on a book (§2.3).
/// A book owner is implicit reader/editor; grants can name profiles or teams.
const BOOK_READER: &str = "(EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=d.container_id AND bo.profile_id=?1) OR EXISTS(SELECT 1 FROM document_folder_permissions bp WHERE bp.folder_id=d.container_id AND ((bp.recipient_type='profile' AND bp.recipient_id=?1) OR (bp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=bp.recipient_id AND tm.profile_id=?1 AND tm.archived=0)))))";
const BOOK_EDITOR: &str = "(EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=d.container_id AND bo.profile_id=?1) OR EXISTS(SELECT 1 FROM document_folder_permissions bp WHERE bp.folder_id=d.container_id AND bp.access_level='editor' AND ((bp.recipient_type='profile' AND bp.recipient_id=?1) OR (bp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=bp.recipient_id AND tm.profile_id=?1 AND tm.archived=0)))))";
const BOOK_READ_SCOPE: &str = "(d.container_type='kb' AND ";
const BOOK_WRITE_SCOPE: &str = "(d.container_type='kb' AND ";
/// A published document is readable by anyone holding its public link; publishing is
/// the only way a document leaves its container's access policy.
const PUBLISHED_READ_SCOPE: &str = "d.published=1 OR ";

const DOCUMENT_READ_SCOPE: &str = "(d.created_by=?1 OR (d.container_type='project' AND d.container_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1)))) OR (d.container_type='my-docs' AND ";
const DOCUMENT_WRITE_SCOPE: &str = "(d.created_by=?1 OR (d.container_type='project' AND d.container_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND p.created_by=?1) OR ?2=1)) OR (d.container_type='my-docs' AND ";
const DOCUMENT_OWNER_WRITE_SCOPE: &str = "(d.created_by=?1 OR (d.container_type='kb' AND EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=d.container_id AND bo.profile_id=?1)) OR (d.container_type='project' AND d.container_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=d.container_id AND p.created_by=?1) OR ?2=1)))";

fn document_read_scope() -> String {
    format!("({PUBLISHED_READ_SCOPE}{BOOK_READ_SCOPE}{BOOK_READER}) OR {DOCUMENT_READ_SCOPE}{DOCUMENT_EXPLICIT_READ_SCOPE})))")
}

fn document_write_scope() -> String {
    format!("({BOOK_WRITE_SCOPE}{BOOK_EDITOR}) OR {DOCUMENT_WRITE_SCOPE}{DOCUMENT_EXPLICIT_WRITE_SCOPE})))")
}

pub fn document_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    document_readable_by_on(&db::conn()?, id, profile_id)
}

pub(crate) fn document_readable_by_on(
    c: &rusqlite::Connection,
    id: &str,
    profile_id: &str,
) -> Result<bool> {
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

/// Searches titles and bodies inside exactly one KB book. The caller supplies a book
/// id, never a free container scope, so result navigation cannot escape the book.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn search_book_documents(book_id: String, query: String) -> Result<Vec<DocumentSearchResult>> {
    let term = query.trim();
    if term.is_empty() {
        return Ok(Vec::new());
    }
    let c = db::conn()?;
    let pattern = format!("%{}%", term.replace('%', "\\%").replace('_', "\\_"));
    let mut s = c.prepare("SELECT id,title,substr(coalesce(body,''),1,180) FROM documents WHERE container_type='kb' AND container_id=?1 AND archived=0 AND (title LIKE ?2 ESCAPE '\\' OR coalesce(body,'') LIKE ?2 ESCAPE '\\') ORDER BY updated_at DESC LIMIT 50").map_err(|e| e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![book_id, pattern], |r| {
            Ok(DocumentSearchResult {
                id: r.get(0)?,
                title: r.get(1)?,
                snippet: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
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

// ---- favourites -------------------------------------------------------------
// A favourite is a pointer, so "My Documents" can show a project's document without
// that document leaving the project. Reads are scoped: a starred document you have
// since lost access to disappears from your list instead of leaking its title.

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_favorite_documents(profile_id: String) -> Result<Vec<FavoriteDocument>> {
    list_favorite_documents_on(&db::conn()?, profile_id)
}

pub(crate) fn list_favorite_documents_on(
    c: &rusqlite::Connection,
    profile_id: String,
) -> Result<Vec<FavoriteDocument>> {
    // Ordered by shelf, then by the position the owner chose. Unfiled favourites
    // (`group_name IS NULL`) come first: they are the ones nobody has sorted yet.
    let mut s = c
        .prepare(&format!(
            "SELECT {DOC_COLUMNS}, f.group_name, f.position FROM documents d \
             JOIN document_favorites f ON f.document_id=d.id AND f.profile_id=?1 \
             WHERE ({}) \
             ORDER BY (f.group_name IS NOT NULL), f.group_name COLLATE NOCASE, f.position, d.updated_at DESC",
            document_read_scope()
        ))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([profile_id], |row| {
            let document = row_to_document(row)?;
            Ok(FavoriteDocument {
                group_name: row.get("group_name")?,
                position: row.get("position")?,
                document,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Moves a favourite to `group_name` (NULL = unfiled) at `position`, and renumbers the
/// shelf it lands on so the stored order is always 0..n-1 with no gaps or ties. The
/// document itself is never touched: this reorders a person's pointers, nothing else.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn move_favorite_document(
    profile_id: String,
    document_id: String,
    group_name: Option<String>,
    position: i64,
) -> Result<()> {
    move_favorite_document_on(&db::conn()?, profile_id, document_id, group_name, position)
}

pub(crate) fn move_favorite_document_on(
    c: &rusqlite::Connection,
    profile_id: String,
    document_id: String,
    group_name: Option<String>,
    position: i64,
) -> Result<()> {
    let group = group_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let previous: Option<Option<String>> = c
        .query_row(
            "SELECT group_name FROM document_favorites WHERE profile_id=?1 AND document_id=?2",
            rusqlite::params![profile_id, document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(previous) = previous else {
        return Err("not a favourite".into());
    };
    c.execute(
        "UPDATE document_favorites SET group_name=?3, position=?4 WHERE profile_id=?1 AND document_id=?2",
        rusqlite::params![profile_id, document_id, group, position],
    )
    .map_err(|e| e.to_string())?;
    // Both shelves are renumbered: the one it left would otherwise keep a hole where the
    // row used to be, and a hole is how stored order drifts from read order.
    if previous != group {
        renumber_favorites(c, &profile_id, previous.as_deref(), &document_id)?;
    }
    renumber_favorites(c, &profile_id, group.as_deref(), &document_id)
}

/// One pass over a shelf: the moved row keeps its requested slot, everything else keeps
/// its relative order around it. Called after every insert/move, so read order and
/// stored order can never drift apart.
fn renumber_favorites(
    c: &rusqlite::Connection,
    profile_id: &str,
    group: Option<&str>,
    pinned: &str,
) -> Result<()> {
    let sql = match group {
        Some(_) => "SELECT document_id FROM document_favorites WHERE profile_id=?1 AND group_name=?2 ORDER BY position, created_at",
        None => "SELECT document_id FROM document_favorites WHERE profile_id=?1 AND group_name IS NULL ORDER BY position, created_at",
    };
    let mut s = c.prepare(sql).map_err(|e| e.to_string())?;
    let ids: Vec<String> = match group {
        Some(name) => s
            .query_map(rusqlite::params![profile_id, name], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| e.to_string())?,
        None => s
            .query_map(rusqlite::params![profile_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| e.to_string())?,
    };
    drop(s);
    // The pinned row is placed first among equals: SQLite's ORDER BY already put it at
    // (or next to) the slot the caller asked for, so a stable renumber is enough.
    let _ = pinned;
    for (index, id) in ids.iter().enumerate() {
        c.execute(
            "UPDATE document_favorites SET position=?3 WHERE profile_id=?1 AND document_id=?2",
            rusqlite::params![profile_id, id, index as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_document_favorite(
    profile_id: String,
    document_id: String,
    favorite: bool,
) -> Result<()> {
    set_document_favorite_on(&db::conn()?, profile_id, document_id, favorite)
}

pub(crate) fn set_document_favorite_on(
    c: &rusqlite::Connection,
    profile_id: String,
    document_id: String,
    favorite: bool,
) -> Result<()> {
    // Starring is a read-level act: you may bookmark what you may read, nothing more.
    if favorite && !document_readable_by_on(c, &document_id, &profile_id)? {
        return Err("document not readable".into());
    }
    if favorite {
        // New favourites land at the end of the unfiled shelf, not on top of position 0.
        let next: i64 = c
            .query_row(
                "SELECT COALESCE(MAX(position)+1,0) FROM document_favorites WHERE profile_id=?1 AND group_name IS NULL",
                [&profile_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        c.execute(
            "INSERT OR IGNORE INTO document_favorites(profile_id,document_id,position) VALUES(?1,?2,?3)",
            rusqlite::params![profile_id, document_id, next],
        )
        .map_err(|e| e.to_string())?;
    } else {
        c.execute(
            "DELETE FROM document_favorites WHERE profile_id=?1 AND document_id=?2",
            rusqlite::params![profile_id, document_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The one canonical root per project. It is deterministic, so concurrent first
/// opens race safely through `INSERT OR IGNORE` without requiring a new table.
fn project_root_id(project_id: &str) -> String {
    format!("project-doc-root-{project_id}")
}

fn validate_document_placement(
    c: &rusqlite::Connection,
    container_type: &str,
    container_id: Option<&str>,
    folder_id: Option<&str>,
) -> Result<()> {
    let container_id = container_id.filter(|id| !id.trim().is_empty());
    if container_type == "project" && folder_id.is_none() {
        return Err("project documents must be filed in a project root folder".into());
    }
    if let Some(folder_id) = folder_id {
        let container_id =
            container_id.ok_or_else(|| "a foldered document needs a container".to_string())?;
        let found: bool = c.query_row(
"SELECT EXISTS(SELECT 1 FROM document_folders WHERE id=?1 AND container_type=?2 AND container_id=?3)",
rusqlite::params![folder_id, container_type, container_id],
|row| row.get(0),
).map_err(|e| e.to_string())?;
        if !found {
            return Err("document folder does not belong to its container".into());
        }
    }
    Ok(())
}

fn ensure_project_document_root_tx(
    c: &mut rusqlite::Connection,
    project_id: &str,
) -> Result<DocumentFolder> {
    if project_id.trim().is_empty() {
        return Err("project id is required".into());
    }
    let root_id = project_root_id(project_id);
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let project_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            [project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !project_exists {
        return Err("project not found".into());
    }
    tx.execute(
"INSERT OR IGNORE INTO document_folders(id,container_type,container_id,parent_id,name,description,archived) VALUES(?1,'project',?2,NULL,'Documents',NULL,0)",
rusqlite::params![root_id, project_id],
).map_err(|e| e.to_string())?;
    // A pre-prerequisite project may have direct rows. Preserve them by making this
    // newly canonical root their parent rather than leaving content inaccessible.
    tx.execute(
"UPDATE document_folders SET parent_id=?1 WHERE container_type='project' AND container_id=?2 AND parent_id IS NULL AND id<>?1",
rusqlite::params![root_id, project_id],
).map_err(|e| e.to_string())?;
    tx.execute(
"UPDATE documents SET folder_id=?1 WHERE container_type='project' AND container_id=?2 AND folder_id IS NULL",
rusqlite::params![root_id, project_id],
).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    c.query_row(
"SELECT id,container_type,container_id,parent_id,name,description,archived FROM document_folders WHERE id=?1",
[root_id], row_to_folder,
).map_err(|e| e.to_string())
}

/// Creates/selects the project's required root folder and repairs legacy direct rows.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn ensure_project_document_root(project_id: String) -> Result<DocumentFolder> {
    let mut c = db::conn()?;
    ensure_project_document_root_tx(&mut c, &project_id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_document(mut document: Document) -> Result<()> {
    let mut c = db::conn()?;
    // Callers from an older client may still submit `folder_id = null`. The row never
    // stays direct: select/create the project root first, then persist into that folder.
    if document.container_type == "project" && document.folder_id.is_none() {
        let project_id = document
            .container_id
            .as_deref()
            .ok_or_else(|| "project documents need a project id".to_string())?;
        document.folder_id = Some(ensure_project_document_root_tx(&mut c, project_id)?.id);
    }
    validate_document_placement(
        &c,
        &document.container_type,
        document.container_id.as_deref(),
        document.folder_id.as_deref(),
    )?;
    c.execute(
"INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,body_format,title,body,version,archived,created_by,source_entity_type,source_entity_id)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
rusqlite::params![&document.id, &document.container_type, &document.container_id, &document.folder_id, &document.doc_type, &document.body_format, &document.title, &document.body, document.version, document.archived, &document.created_by, &document.source_entity_type, &document.source_entity_id],
).map_err(|e| e.to_string())?;
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
    validate_document_placement(
        &c,
        &document.container_type,
        document.container_id.as_deref(),
        document.folder_id.as_deref(),
    )?;
    c.execute(
        "UPDATE documents SET container_type=?2,container_id=?3,folder_id=?4,doc_type=?5,body_format=?6,title=?7,archived=?8,updated_at=unixepoch() WHERE id=?1",
        rusqlite::params![
            document.id,
            document.container_type,
            document.container_id,
            document.folder_id,
            document.doc_type,
            document.body_format,
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
    validate_document_placement(
        &c,
        &container_type,
        container_id.as_deref(),
        folder_id.as_deref(),
    )?;
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

/// Who may destroy a document. Deletion is the one act that cannot be taken back, so
/// it is bound to ownership, never to write access: a personal document belongs to its
/// own container, a project document to its author or the project owner, and a book
/// page in the organization library to a book *owner* — an editor writes, an owner
/// destroys. Admins keep the break-glass path they have everywhere else.
pub(crate) fn document_deletable_by_on(
    c: &rusqlite::Connection,
    id: &str,
    actor_id: &str,
) -> Result<bool> {
    if actor_id.trim().is_empty() {
        return Ok(false);
    }
    if crate::platform::is_admin_on(c, actor_id)? {
        return Ok(true);
    }
    c.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM documents d WHERE d.id=?3 AND ({DOCUMENT_OWNER_WRITE_SCOPE} \
             OR (d.container_type='my-docs' AND d.container_id=?1)))"
        ),
        rusqlite::params![actor_id, false, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn document_deletable_by(id: &str, actor_id: &str) -> Result<bool> {
    document_deletable_by_on(&db::conn()?, id, actor_id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_document(id: String, actor_id: String) -> Result<()> {
    let mut c = db::conn()?;
    delete_document_on(&mut c, &id, &actor_id)
}
fn delete_document_on(c: &mut rusqlite::Connection, id: &str, actor_id: &str) -> Result<()> {
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1)",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Document not found".into());
    }
    if !document_deletable_by_on(c, id, actor_id)? {
        return Err("only the owner of this document can delete it".into());
    }
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
    let doc = get_document(id)?.ok_or_else(|| "document vanished after save".to_string())?;
    // Taxonomy name first; the pre-taxonomy alias is re-emitted so subscriptions
    // stored before `events.rs` existed keep firing.
    document_event(crate::events::DOCUMENT_UPDATED, &doc);
    document_event(crate::events::LEGACY_DOCUMENT_EVENT, &doc);
    Ok(doc)
}

/// Webhook fan-out envelope: `{"event": …, "document": …}`; subscription filters address
/// it by dot-path, e.g. `"document.title"`. Second domain in the cross-domain taxonomy
/// (issues being the first). Best effort after commit — a subscriber problem must never
/// undo a user's document edit.
fn document_event(event_type: &str, doc: &Document) {
    let payload = serde_json::json!({ "event": event_type, "document": doc });
    if let Err(e) = crate::applications::enqueue_event(event_type, &payload) {
        eprintln!("webhook fan-out for {event_type} failed: {e}");
    }
}

fn discussion_row(r: &rusqlite::Row) -> rusqlite::Result<DocumentDiscussion> {
    Ok(DocumentDiscussion {
        document_id: r.get(0)?,
        channel_id: r.get(1)?,
        meeting_id: r.get(2)?,
    })
}
fn document_discussion_on(
    c: &rusqlite::Connection,
    document_id: &str,
) -> Result<Option<DocumentDiscussion>> {
    c.query_row(
        "SELECT document_id,channel_id,meeting_id FROM document_discussions WHERE document_id=?1",
        [document_id],
        discussion_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}
fn attach_document_discussion_on(
    c: &rusqlite::Connection,
    document_id: &str,
    meeting_id: Option<&str>,
) -> Result<DocumentDiscussion> {
    let title: String = c
        .query_row(
            "SELECT title FROM documents WHERE id=?1",
            [document_id],
            |r| r.get(0),
        )
        .map_err(|_| "document not found".to_string())?;
    let channel_id = format!("entity:document:{document_id}");
    if let Some(meeting_id) = meeting_id {
        let bound_channel: Option<String> = c
            .query_row(
                "SELECT channel_id FROM meetings WHERE id=?1 AND archived=0",
                [meeting_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "meeting not found".to_string())?;
        if bound_channel.as_deref().is_some_and(|id| id != channel_id) {
            return Err("meeting already has a different discussion channel".into());
        }
    }
    let channel = crate::chat::create_entity_channel_impl(
        c,
        "document",
        document_id,
        Some(format!("{title} discussion")),
    )?;
    let previous = document_discussion_on(c, document_id)?;
    c.execute("INSERT INTO document_discussions(document_id,channel_id,meeting_id) VALUES(?1,?2,?3) ON CONFLICT(document_id) DO UPDATE SET meeting_id=excluded.meeting_id", rusqlite::params![document_id, channel.id, meeting_id]).map_err(|e| e.to_string())?;
    if let Some(previous_meeting_id) = previous.and_then(|item| item.meeting_id) {
        if Some(previous_meeting_id.as_str()) != meeting_id {
            c.execute(
                "UPDATE meetings SET channel_id=NULL WHERE id=?1 AND channel_id=?2",
                rusqlite::params![previous_meeting_id, channel.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if let Some(meeting_id) = meeting_id {
        c.execute(
            "UPDATE meetings SET channel_id=?2 WHERE id=?1",
            rusqlite::params![meeting_id, channel.id],
        )
        .map_err(|e| e.to_string())?;
    }
    document_discussion_on(c, document_id)?.ok_or_else(|| "discussion missing after attach".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn attach_document_discussion(
    document_id: String,
    meeting_id: Option<String>,
) -> Result<DocumentDiscussion> {
    attach_document_discussion_on(&db::conn()?, &document_id, meeting_id.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_document_discussion(document_id: String) -> Result<Option<DocumentDiscussion>> {
    document_discussion_on(&db::conn()?, &document_id)
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
const FOLDER_READ_SCOPE: &str = "((f.container_type='my-docs' AND f.container_id=?1) OR (f.container_type='project' AND f.container_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=f.container_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1)))) OR (f.container_type='kb' AND (EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=f.container_id AND bo.profile_id=?1) OR EXISTS(SELECT 1 FROM document_folder_permissions bp WHERE bp.folder_id=f.container_id AND ((bp.recipient_type='profile' AND bp.recipient_id=?1) OR (bp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=bp.recipient_id AND tm.profile_id=?1 AND tm.archived=0)))) OR EXISTS(SELECT 1 FROM documents d WHERE d.container_type='kb' AND d.created_by=?1 AND (d.folder_id=f.id OR d.container_id=f.id)))))";
const FOLDER_WRITE_SCOPE: &str = "((f.container_type='my-docs' AND f.container_id=?1) OR (f.container_type='project' AND f.container_id IS NOT NULL AND (EXISTS(SELECT 1 FROM projects p WHERE p.id=f.container_id AND p.created_by=?1) OR ?2=1)) OR (f.container_type='kb' AND (EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=f.container_id AND bo.profile_id=?1) OR EXISTS(SELECT 1 FROM document_folder_permissions bp WHERE bp.folder_id=f.container_id AND bp.access_level='editor' AND ((bp.recipient_type='profile' AND bp.recipient_id=?1) OR (bp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=bp.recipient_id AND tm.profile_id=?1 AND tm.archived=0)))))))";
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

// ---------- publication (public links) and KB book grants ----------

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DocumentPublication {
    pub document_id: String,
    pub published: bool,
    pub published_at: Option<i64>,
    pub public_slug: Option<String>,
}

/// Lowercase, hyphen-joined, ASCII-alphanumeric only — a link that survives copy/paste.
fn slugify(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').to_string()
}

fn publication_row(c: &rusqlite::Connection, document_id: &str) -> Result<DocumentPublication> {
    c.query_row(
        "SELECT id,published,published_at,public_slug FROM documents WHERE id=?1",
        [document_id],
        |r| {
            Ok(DocumentPublication {
                document_id: r.get(0)?,
                published: r.get(1)?,
                published_at: r.get(2)?,
                public_slug: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Document not found".to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_document_publication(document_id: String) -> Result<DocumentPublication> {
    let c = db::conn()?;
    publication_row(&c, &document_id)
}

/// Publishes or unpublishes a document. Unpublishing keeps the slug so the same link
/// works again if the document is republished; only `published` gates public reads.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn publish_document(
    document_id: String,
    published: bool,
    slug: Option<String>,
) -> Result<DocumentPublication> {
    let c = db::conn()?;
    publish_document_tx(&c, document_id, published, slug)
}

fn publish_document_tx(
    c: &rusqlite::Connection,
    document_id: String,
    published: bool,
    slug: Option<String>,
) -> Result<DocumentPublication> {
    let current = publication_row(c, &document_id)?;
    let mut slug = match slug.map(|s| slugify(&s)).filter(|s| !s.is_empty()) {
        Some(slug) => slug,
        None => match current.public_slug.clone() {
            Some(existing) => existing,
            None => {
                let title: String = c
                    .query_row(
                        "SELECT title FROM documents WHERE id=?1",
                        [&document_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                let base = slugify(&title);
                if base.is_empty() {
                    "document".to_string()
                } else {
                    base
                }
            }
        },
    };
    // Slugs are globally unique: suffix the base until the index accepts it.
    let base = slug.clone();
    let mut suffix = 1;
    loop {
        let taken: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE public_slug=?1 AND id<>?2)",
                rusqlite::params![slug, document_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !taken {
            break;
        }
        suffix += 1;
        slug = format!("{base}-{suffix}");
    }
    c.execute(
        "UPDATE documents SET published=?2, published_at=CASE WHEN ?2=1 THEN coalesce(published_at,unixepoch()) ELSE published_at END, public_slug=?3 WHERE id=?1",
        rusqlite::params![document_id, published, slug],
    )
    .map_err(|e| e.to_string())?;
    publication_row(c, &document_id)
}

/// Resolves a public link. Archived or unpublished documents are not public.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_public_document(slug: String) -> Result<Option<Document>> {
    let c = db::conn()?;
    get_public_document_tx(&c, slug)
}

fn get_public_document_tx(c: &rusqlite::Connection, slug: String) -> Result<Option<Document>> {
    c.query_row(
        &format!("SELECT {DOC_COLUMNS} FROM documents d WHERE d.public_slug=?1 AND d.published=1 AND d.archived=0"),
        [slug],
        row_to_document,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// A book owner alone manages grants; content editors cannot widen access.
pub fn book_manageable_by(book_id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    if is_admin {
        return Ok(true);
    }
    let c = db::conn()?;
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM kb_book_owners WHERE book_id=?1 AND profile_id=?2)",
        rusqlite::params![book_id, profile_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}
pub fn book_readable_by(book_id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    c.query_row("SELECT EXISTS(SELECT 1 FROM document_folders f WHERE f.id=?1 AND f.container_type='kb' AND f.parent_id IS NULL AND (EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=f.id AND bo.profile_id=?2) OR EXISTS(SELECT 1 FROM document_folder_permissions bp WHERE bp.folder_id=f.id AND ((bp.recipient_type='profile' AND bp.recipient_id=?2) OR (bp.recipient_type='team' AND EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id=bp.recipient_id AND tm.profile_id=?2 AND tm.archived=0)))) OR EXISTS(SELECT 1 FROM documents d WHERE d.container_type='kb' AND d.container_id=f.id AND d.created_by=?2)))", rusqlite::params![book_id, profile_id], |row| row.get(0)).map_err(|e| e.to_string())
}
pub fn book_writable_by(book_id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    if is_admin {
        return Ok(true);
    }
    let c = db::conn()?;
    // Pre-owner legacy books were historically open to authors. Keep them writable until
    // a first owner/grant is recorded; newly created books always have an owner row.
    c.query_row(&format!("SELECT EXISTS(SELECT 1 FROM document_folders f WHERE f.id=?3 AND f.container_type='kb' AND f.parent_id IS NULL AND ({FOLDER_WRITE_SCOPE} OR (NOT EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=f.id) AND NOT EXISTS(SELECT 1 FROM document_folder_permissions bp WHERE bp.folder_id=f.id))))"), rusqlite::params![profile_id, false, book_id], |row| row.get(0)).map_err(|e| e.to_string())
}
/// The owners of one library book, so a reader can *see* who may delete in it instead
/// of discovering the rule by being refused. Names only — no grants, no book contents.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_book_owners(book_id: String) -> Result<Vec<String>> {
    list_book_owners_on(&db::conn()?, &book_id)
}
pub(crate) fn list_book_owners_on(c: &rusqlite::Connection, book_id: &str) -> Result<Vec<String>> {
    let mut s = c
        .prepare("SELECT profile_id FROM kb_book_owners WHERE book_id=?1 ORDER BY profile_id")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([book_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}


#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_book_access(book_id: String) -> Result<Vec<DocumentAccessRecipient>> {
    let c = db::conn()?;
    let mut s = c
        .prepare("SELECT recipient_type,recipient_id,access_level FROM document_folder_permissions WHERE folder_id=?1 ORDER BY recipient_type,recipient_id")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([book_id], |r| {
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

/// Replaces a book's grant list atomically (same shape as document sharing).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_book_access(
    book_id: String,
    permissions: Vec<DocumentAccessRecipient>,
) -> Result<()> {
    for permission in &permissions {
        if !matches!(permission.recipient_type.as_str(), "profile" | "team")
            || !matches!(permission.access_level.as_str(), "viewer" | "editor")
            || permission.recipient_id.trim().is_empty()
        {
            return Err("invalid book access recipient".into());
        }
    }
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let is_book: bool = tx
        .query_row(
            "SELECT container_type='kb' AND parent_id IS NULL FROM document_folders WHERE id=?1",
            [&book_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Book not found".to_string())?;
    if !is_book {
        return Err("only a top-level knowledge-base folder is a book".into());
    }
    tx.execute(
        "DELETE FROM document_folder_permissions WHERE folder_id=?1",
        [&book_id],
    )
    .map_err(|e| e.to_string())?;
    for permission in permissions {
        tx.execute(
            "INSERT INTO document_folder_permissions(folder_id,recipient_type,recipient_id,access_level) VALUES(?1,?2,?3,?4)",
            rusqlite::params![book_id, permission.recipient_type, permission.recipient_id, permission.access_level],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

// ---------- local-folder / Confluence-export import ----------
// A Confluence space export and a plain notes directory are the same shape on disk: a
// tree of directories holding .md/.txt files. Import mirrors that tree into
// document_folders and files each page as an ordinary document, so imported pages get
// versioning, permissions and search for free.

fn default_import_extensions() -> Vec<String> {
    vec!["md".into(), "txt".into()]
}
fn default_max_file_bytes() -> u64 {
    2 * 1024 * 1024
}
fn default_max_depth() -> u32 {
    16
}

#[derive(Debug, Deserialize)]
pub struct DocumentImportRequest {
    pub source_path: String,
    pub container_type: String,
    pub container_id: Option<String>,
    /// Folder the import tree is grafted under; None imports into the container root.
    pub parent_folder_id: Option<String>,
    pub created_by: Option<String>,
    #[serde(default = "default_import_extensions")]
    pub extensions: Vec<String>,
    #[serde(default = "default_max_file_bytes")]
    pub max_file_bytes: u64,
    #[serde(default = "default_max_depth")]
    pub max_depth: u32,
}

#[derive(Debug, Serialize, Default)]
pub struct DocumentImportSummary {
    pub folders_created: i64,
    pub documents_created: i64,
    /// Path + reason for every file the walk refused, so nothing vanishes silently.
    pub skipped: Vec<String>,
}

fn generated_id(prefix: &str) -> String {
    format!(
        "{prefix}-{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    )
}

/// Minimal HTML flattening: drops script/style bodies and tags, decodes the five
/// entities a Confluence export actually emits, and collapses runs of blank lines.
/// It is deliberately not a full parser — the original markup stays recoverable from
/// the source file, and the body remains searchable text.
fn html_to_text(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '<' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let closing = chars.get(i + 1) == Some(&'/');
        let mut j = if closing { i + 2 } else { i + 1 };
        let mut tag = String::new();
        while j < chars.len() && chars[j].is_ascii_alphanumeric() {
            tag.push(chars[j].to_ascii_lowercase());
            j += 1;
        }
        let mut end = j;
        while end < chars.len() && chars[end] != '>' {
            end += 1;
        }
        if !closing && (tag == "script" || tag == "style") {
            let needle: Vec<char> = format!("</{tag}>").chars().collect();
            let mut k = end.saturating_add(1);
            while k < chars.len() && !chars[k..].starts_with(&needle[..]) {
                k += 1;
            }
            i = if k >= chars.len() {
                chars.len()
            } else {
                k + needle.len()
            };
            continue;
        }
        if matches!(
            tag.as_str(),
            "p" | "br" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
        ) {
            out.push('\n');
        }
        i = end + 1;
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let mut lines: Vec<&str> = Vec::new();
    for line in decoded.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() && lines.last().map(|l: &&str| l.is_empty()).unwrap_or(true) {
            continue;
        }
        lines.push(trimmed);
    }
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}

/// Title precedence: markdown `# heading` / HTML `<h1>` / HTML `<title>`, else file stem.
fn imported_title(raw: &str, text: &str, stem: &str) -> String {
    let lower = raw.to_lowercase();
    for (open, close) in [("<h1", "</h1>"), ("<title", "</title>")] {
        if let Some(start) = lower.find(open) {
            if let Some(gt) = lower[start..].find('>') {
                let from = start + gt + 1;
                if let Some(end) = lower[from..].find(close) {
                    let title = html_to_text(&raw[from..from + end]).trim().to_string();
                    if !title.is_empty() {
                        return title;
                    }
                }
            }
        }
    }
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("# ") {
            if !heading.trim().is_empty() {
                return heading.trim().to_string();
            }
        }
        if !trimmed.is_empty() {
            break;
        }
    }
    stem.to_string()
}

/// Imports a directory tree: Markdown and plain-text pages stay editable; all other files stay files.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn import_document_folder(request: DocumentImportRequest) -> Result<DocumentImportSummary> {
    let c = db::conn()?;
    import_document_folder_tx(&c, request)
}

fn import_document_folder_tx(
    c: &rusqlite::Connection,
    request: DocumentImportRequest,
) -> Result<DocumentImportSummary> {
    let root = std::path::PathBuf::from(&request.source_path);
    validate_document_placement(
        c,
        &request.container_type,
        request.container_id.as_deref(),
        request.parent_folder_id.as_deref(),
    )?;
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory", request.source_path));
    }
    let extensions: Vec<String> = request
        .extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();
    let mut summary = DocumentImportSummary::default();
    let mut stack = vec![(root.clone(), request.parent_folder_id.clone(), 0u32)];
    while let Some((dir, parent_id, depth)) = stack.pop() {
        let mut entries: Vec<std::fs::DirEntry> = std::fs::read_dir(&dir)
            .map_err(|e| format!("read {}: {e}", dir.display()))?
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| e.to_string())?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(e) => {
                    summary.skipped.push(format!("{}: {e}", path.display()));
                    continue;
                }
            };
            // Symlinks are never followed: an export can contain a cycle back to its root.
            if meta.file_type().is_symlink() {
                summary.skipped.push(format!("{}: symlink", path.display()));
                continue;
            }
            if meta.is_dir() {
                if depth + 1 > request.max_depth {
                    summary.skipped.push(format!(
                        "{}: deeper than max_depth {}",
                        path.display(),
                        request.max_depth
                    ));
                    continue;
                }
                let folder_id = generated_id("docfolder");
                c.execute(
                    "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,description,archived) VALUES(?1,?2,?3,?4,?5,NULL,0)",
                    rusqlite::params![folder_id, request.container_type, request.container_id, parent_id, name],
                )
                .map_err(|e| e.to_string())?;
                summary.folders_created += 1;
                stack.push((path, Some(folder_id), depth + 1));
                continue;
            }
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if meta.len() > request.max_file_bytes {
                summary.skipped.push(format!(
                    "{}: {} bytes exceeds max_file_bytes {}",
                    path.display(),
                    meta.len(),
                    request.max_file_bytes
                ));
                continue;
            }
            if extensions.contains(&ext) {
                let raw = match std::fs::read_to_string(&path) {
                    Ok(raw) => raw,
                    Err(e) => {
                        summary.skipped.push(format!("{}: {e}", path.display()));
                        continue;
                    }
                };
                let stem = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(name);
                let title = imported_title(&raw, &raw, &stem);
                let doc_id = generated_id("doc");
                c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,body,version,archived,created_by) VALUES(?1,?2,?3,?4,'text',?5,?6,1,0,?7)", rusqlite::params![doc_id, request.container_type, request.container_id, parent_id, title, raw, request.created_by]).map_err(|e| e.to_string())?;
                c.execute("INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,1,?3,?4)", rusqlite::params![format!("{doc_id}-v1"), doc_id, raw, request.created_by]).map_err(|e| e.to_string())?;
            } else {
                // KB §2.1: everything but .md remains an uneditable file document.
                upload_document_file_tx(
                    c,
                    &db::data_dir()
                        .map(|dir| dir.join("document_files"))
                        // Unit-test connections deliberately have no global data path; a
                        // hidden source sibling remains outside the traversed import tree.
                        .unwrap_or_else(|_| root.join(".gaia-import-files")),
                    UploadDocumentFileRequest {
                        source_path: path.to_string_lossy().to_string(),
                        container_type: request.container_type.clone(),
                        container_id: request.container_id.clone(),
                        folder_id: parent_id.clone(),
                        title: Some(name),
                        created_by: request.created_by.clone(),
                        max_file_bytes: request.max_file_bytes,
                    },
                )?;
            }
            summary.documents_created += 1;
        }
    }
    c.execute("INSERT INTO document_imports(id,source_path,container_type,container_id,parent_folder_id,created_by,folders_created,documents_created,skipped_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", rusqlite::params![generated_id("docimport"), request.source_path, request.container_type, request.container_id, request.parent_folder_id, request.created_by, summary.folders_created, summary.documents_created, summary.skipped.len() as i64]).map_err(|e| e.to_string())?;
    Ok(summary)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_document_folder(folder: DocumentFolder, owner_id: Option<String>) -> Result<()> {
    let c = db::conn()?;
    let is_book = folder.container_type == "kb"
        && folder.parent_id.is_none()
        && folder.container_id.as_deref() == Some(&folder.id);
    if folder.container_type == "kb" && !is_book {
        let book_id = folder
            .container_id
            .as_deref()
            .ok_or_else(|| "knowledge-base folder requires book id".to_string())?;
        let parent_ok: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM document_folders WHERE id=?1 AND container_type='kb' AND container_id=?2)", rusqlite::params![folder.parent_id, book_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !parent_ok {
            return Err("knowledge-base folder parent does not belong to its book".into());
        }
    }
    c.execute("INSERT INTO document_folders(id,container_type,container_id,parent_id,name,description,archived) VALUES(?1,?2,?3,?4,?5,?6,?7)", rusqlite::params![folder.id,folder.container_type,folder.container_id,folder.parent_id,folder.name,folder.description,folder.archived]).map_err(|e| e.to_string())?;
    if is_book {
        let owner_id = owner_id.ok_or_else(|| "knowledge-base book requires owner".to_string())?;
        c.execute(
            "INSERT INTO kb_book_owners(book_id,profile_id) VALUES(?1,?2)",
            rusqlite::params![folder.id, owner_id],
        )
        .map_err(|e| e.to_string())?;
    }
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

/// Delete a folder — only when nothing is inside it. A folder is a container, so deleting
/// one may never silently take documents or subfolders with it: the caller must empty it
/// first (or move the content), which keeps the deletion a decision about the folder
/// alone. Archived children still count as content; they are hidden, not gone.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_document_folder(id: String, actor_id: String) -> Result<()> {
    delete_document_folder_on(&db::conn()?, &id, &actor_id)
}
/// Same ownership rule as a document, read off the folder's container: your own
/// `my-docs` shelf, the owner of the project the folder belongs to, or an owner of the
/// book (a folder that *is* a book root is checked against its own owner rows).
pub(crate) fn document_folder_deletable_by_on(
    c: &rusqlite::Connection,
    id: &str,
    actor_id: &str,
) -> Result<bool> {
    if actor_id.trim().is_empty() {
        return Ok(false);
    }
    if crate::platform::is_admin_on(c, actor_id)? {
        return Ok(true);
    }
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM document_folders f WHERE f.id=?2 AND ( \
           (f.container_type='my-docs' AND f.container_id=?1) \
           OR (f.container_type='project' AND f.container_id IS NOT NULL \
               AND EXISTS(SELECT 1 FROM projects p WHERE p.id=f.container_id AND p.created_by=?1)) \
           OR (f.container_type='kb' AND (EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=f.container_id AND bo.profile_id=?1) \
               OR EXISTS(SELECT 1 FROM kb_book_owners bo WHERE bo.book_id=f.id AND bo.profile_id=?1)))))",
        rusqlite::params![actor_id, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}
pub fn document_folder_deletable_by(id: &str, actor_id: &str) -> Result<bool> {
    document_folder_deletable_by_on(&db::conn()?, id, actor_id)
}
fn delete_document_folder_on(c: &rusqlite::Connection, id: &str, actor_id: &str) -> Result<()> {
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM document_folders WHERE id=?1)",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Folder not found".into());
    }
    if !document_folder_deletable_by_on(c, id, actor_id)? {
        return Err("only the owner of this folder can delete it".into());
    }
    let occupied: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM document_folders WHERE parent_id=?1) \
             OR EXISTS(SELECT 1 FROM documents WHERE folder_id=?1)",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if occupied {
        return Err("Folder is not empty".into());
    }
    c.execute("DELETE FROM kb_book_owners WHERE book_id=?1", [&id])
        .map_err(|e| e.to_string())?;
    c.execute("DELETE FROM document_folders WHERE id=?1", [&id])
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

// ---------------------------------------------------------------------------
// Uploaded files (V43)
//
// An upload is an ordinary document with `doc_type='file'`: it lives in the same folder
// tree, obeys the same container scoping and access rules, and shows up in the same
// listings. Only the payload is different — the bytes are copied beside the database and
// referenced by a `document_files` row, so a 50 MB attachment never enters SQLite or a
// version snapshot. `documents.body` holds a human-readable descriptor, nothing binary.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DocumentFile {
    pub document_id: String,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub uploaded_by: Option<String>,
    pub uploaded_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct UploadDocumentFileRequest {
    pub source_path: String,
    pub container_type: String,
    pub container_id: Option<String>,
    pub folder_id: Option<String>,
    /// Defaults to the file name when omitted.
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    /// Upload ceiling, a parameter rather than a constant so a deployment can raise it.
    #[serde(default = "default_max_upload_bytes")]
    pub max_file_bytes: u64,
}

fn default_max_upload_bytes() -> u64 {
    25 * 1024 * 1024
}

/// Web-upload metadata. The HTTP transport supplies bytes separately, never a
/// server filesystem path.
#[derive(Debug, Deserialize)]
pub struct UploadDocumentFileBytesRequest {
    pub filename: String,
    pub container_type: String,
    pub container_id: Option<String>,
    pub folder_id: Option<String>,
    pub title: Option<String>,
    pub created_by: Option<String>,
}

/// Preview payload: base64 for binary types, decoded text for textual ones. Capped, so
/// opening a huge upload in the UI transfers a preview instead of the whole file.
#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentFilePreview {
    pub document_id: String,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub truncated: bool,
    pub text: Option<String>,
    pub data_base64: Option<String>,
}

fn default_preview_bytes() -> u64 {
    1024 * 1024
}

/// Content type from the extension only. The file is never executed or interpreted by
/// the backend; the type exists so the UI can pick a preview, and defaults to the
/// deliberately inert `application/octet-stream`.
pub fn mime_for(filename: &str) -> String {
    let ext = std::path::Path::new(filename)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

pub(crate) fn upload_dir() -> Result<std::path::PathBuf> {
    let dir = db::data_dir()?.join("document_files");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create upload directory: {e}"))?;
    Ok(dir)
}

/// The stored name is generated, never the user's: an upload called `../../space.db`
/// must not be able to address anything outside the upload directory.
fn stored_name(document_id: &str, filename: &str) -> String {
    let ext = std::path::Path::new(filename)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()) && e.len() <= 12);
    match ext {
        Some(ext) => format!("{document_id}.{ext}"),
        None => document_id.to_string(),
    }
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn upload_document_file(request: UploadDocumentFileRequest) -> Result<DocumentFile> {
    let c = db::conn()?;
    upload_document_file_tx(&c, &upload_dir()?, request)
}

/// Stores bytes accepted by the web transport. The server passes its configured
/// ceiling so transport and persistence policy cannot silently diverge.
pub fn upload_document_file_bytes(
    request: UploadDocumentFileBytesRequest,
    bytes: &[u8],
    max_file_bytes: u64,
) -> Result<DocumentFile> {
    if bytes.len() as u64 > max_file_bytes {
        return Err(format!(
            "file is {} bytes, over the {} byte upload limit",
            bytes.len(),
            max_file_bytes
        ));
    }
    let source = std::path::Path::new(&request.filename);
    let filename = source
        .file_name()
        .filter(|_| source.components().count() == 1)
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "filename must be a plain file name".to_string())?;
    let c = db::conn()?;
    validate_document_placement(
        &c,
        &request.container_type,
        request.container_id.as_deref(),
        request.folder_id.as_deref(),
    )?;
    let store = upload_dir()?;
    let document_id = generated_id("doc");
    let mime = mime_for(&filename);
    let target = store.join(stored_name(&document_id, &filename));
    std::fs::write(&target, bytes).map_err(|e| format!("store upload: {e}"))?;
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(&filename)
        .to_string();
    let body = format!("{filename} ({} bytes, {mime})", bytes.len());
    let inserted = c.execute(
        "INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,body_format,title,body,version,archived,created_by) VALUES(?1,?2,?3,?4,'file','text',?5,?6,1,0,?7)",
        rusqlite::params![document_id, request.container_type, request.container_id, request.folder_id, title, body, request.created_by],
    );
    if let Err(e) = inserted {
        let _ = std::fs::remove_file(&target);
        return Err(e.to_string());
    }
    c.execute(
        "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,1,?3,?4)",
        rusqlite::params![
            generated_id("docver"),
            document_id,
            body,
            request.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    c.execute("INSERT INTO document_files(document_id,filename,mime,size,stored_path,uploaded_by) VALUES(?1,?2,?3,?4,?5,?6)", rusqlite::params![document_id, filename, mime, bytes.len() as i64, target.to_string_lossy().to_string(), request.created_by]).map_err(|e| e.to_string())?;
    get_document_file_tx(&c, &document_id)?.ok_or_else(|| "stored upload vanished".into())
}

/// The anchor a library document filed out of a chat upload carries. One attachment,
/// one document: the partial UNIQUE index on `(source_entity_type, source_entity_id)`
/// is what makes the second attempt a no-op instead of a duplicate shelf entry.
pub const CHAT_ATTACHMENT_SOURCE: &str = "message-attachment";

/// Everything the library needs to know about one chat upload. The BYTES are passed
/// separately and decoded by the caller (`chat::decode_data_url`), because the chat row
/// stores a data URL and the library stores a file — the translation happens once,
/// server side, and the blob is written exactly once, here.
pub(crate) struct ChatAttachmentFiling<'a> {
    pub attachment_id: &'a str,
    pub project_id: &'a str,
    pub channel_id: &'a str,
    pub channel_name: &'a str,
    pub file_name: &'a str,
    pub created_by: Option<&'a str>,
}

/// The shelf a channel's uploads land on. Keyed by CHANNEL ID, not by name, so renaming
/// `#general` moves the shelf's label instead of splitting its contents into two.
pub(crate) fn chat_shelf_id(project_id: &str, channel_id: &str) -> String {
    format!("project-doc-chat-{project_id}-{channel_id}")
}

/// The project's canonical root, created if missing, on a plain connection.
///
/// `ensure_project_document_root_tx` opens its own transaction and therefore needs
/// `&mut Connection`; the chat write path already holds a borrowed connection. Same
/// three idempotent statements, no nested transaction.
pub(crate) fn ensure_project_root_folder_conn(
    c: &rusqlite::Connection,
    project_id: &str,
) -> Result<String> {
    let root_id = project_root_id(project_id);
    let project_exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            [project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !project_exists {
        return Err("project not found".into());
    }
    c.execute(
"INSERT OR IGNORE INTO document_folders(id,container_type,container_id,parent_id,name,description,archived) VALUES(?1,'project',?2,NULL,'Documents',NULL,0)",
rusqlite::params![root_id, project_id],
).map_err(|e| e.to_string())?;
    c.execute(
"UPDATE document_folders SET parent_id=?1 WHERE container_type='project' AND container_id=?2 AND parent_id IS NULL AND id<>?1",
rusqlite::params![root_id, project_id],
).map_err(|e| e.to_string())?;
    c.execute(
"UPDATE documents SET folder_id=?1 WHERE container_type='project' AND container_id=?2 AND folder_id IS NULL",
rusqlite::params![root_id, project_id],
).map_err(|e| e.to_string())?;
    Ok(root_id)
}

/// FILE A CHAT UPLOAD INTO THE PROJECT'S LIBRARY.
///
/// A library is CURATED. Screenshots pasted into a conversation must be findable there
/// without burying the written documents, so they land on their own shelf — `From
/// #general`, one per channel, created on first use — under the project root, never in
/// the root itself.
///
/// Returns the document id, existing or new. Called only for channels that HAVE a
/// project: a channel without one has no library to file into and nothing happens.
pub(crate) fn file_chat_attachment_tx(
    c: &rusqlite::Connection,
    store: &std::path::Path,
    filing: ChatAttachmentFiling<'_>,
    bytes: &[u8],
) -> Result<String> {
    // Already filed? Then this is a retried upload, not a second document.
    if let Some(existing) = c
        .query_row(
            "SELECT id FROM documents WHERE source_entity_type=?1 AND source_entity_id=?2",
            rusqlite::params![CHAT_ATTACHMENT_SOURCE, filing.attachment_id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(existing);
    }
    let root_id = ensure_project_root_folder_conn(c, filing.project_id)?;
    let shelf_id = chat_shelf_id(filing.project_id, filing.channel_id);
    let shelf_name = format!("From #{}", filing.channel_name);
    c.execute(
"INSERT OR IGNORE INTO document_folders(id,container_type,container_id,parent_id,name,description,archived) VALUES(?1,'project',?2,?3,?4,'Files shared in this channel',0)",
rusqlite::params![shelf_id, filing.project_id, root_id, shelf_name],
).map_err(|e| e.to_string())?;
    // A renamed channel renames its shelf; the documents on it stay put.
    c.execute(
        "UPDATE document_folders SET name=?2 WHERE id=?1 AND name<>?2",
        rusqlite::params![shelf_id, shelf_name],
    )
    .map_err(|e| e.to_string())?;

    let source = std::path::Path::new(filing.file_name);
    let filename = source
        .file_name()
        .filter(|_| source.components().count() == 1)
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "attachment".to_string());
    let document_id = generated_id("doc");
    let mime = mime_for(&filename);
    let target = store.join(stored_name(&document_id, &filename));
    std::fs::create_dir_all(store).map_err(|e| format!("create upload directory: {e}"))?;
    std::fs::write(&target, bytes).map_err(|e| format!("store upload: {e}"))?;
    let body = format!(
        "{filename} ({} bytes, {mime})\nFrom #{}",
        bytes.len(),
        filing.channel_name
    );
    let insert = c.execute(
        "INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,body_format,title,body,version,archived,created_by,source_entity_type,source_entity_id) VALUES(?1,'project',?2,?3,'file','text',?4,?5,1,0,?6,?7,?8)",
        rusqlite::params![
            document_id,
            filing.project_id,
            shelf_id,
            filename,
            body,
            filing.created_by,
            CHAT_ATTACHMENT_SOURCE,
            filing.attachment_id
        ],
    );
    if let Err(e) = insert {
        let _ = std::fs::remove_file(&target);
        return Err(e.to_string());
    }
    c.execute(
        "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,1,?3,?4)",
        rusqlite::params![
            generated_id("docver"),
            document_id,
            body,
            filing.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO document_files(document_id,filename,mime,size,stored_path,uploaded_by) VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![
            document_id,
            filename,
            mime,
            bytes.len() as i64,
            target.to_string_lossy().to_string(),
            filing.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(document_id)
}

pub fn read_document_file_bytes(document_id: &str) -> Result<(DocumentFile, Vec<u8>)> {
    let c = db::conn()?;
    let file = get_document_file_tx(&c, document_id)?
        .ok_or_else(|| "uploaded file not found".to_string())?;
    let stored_path: String = c
        .query_row(
            "SELECT stored_path FROM document_files WHERE document_id=?1",
            [document_id],
            |r| r.get(0),
        )
        .map_err(|_| "uploaded file not found".to_string())?;
    let bytes = std::fs::read(stored_path).map_err(|e| format!("read upload: {e}"))?;
    Ok((file, bytes))
}

/// SAVE A COPY WHERE THE PERSON ASKED FOR IT.
///
/// An uploaded file lives beside the database (`document_files/…`), reachable by the
/// app and by nothing else — which is why a document could be READ in the window but
/// never used anywhere: no path a person owns ever held it. This copies the stored
/// bytes to a path the caller chose (the native save dialog picks it), leaving the
/// stored file untouched.
///
/// The web build needs nothing here: it already serves `/api/documents/files/{id}`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn export_document_file(document_id: String, target_path: String) -> Result<()> {
    let (_file, bytes) = read_document_file_bytes(&document_id)?;
    std::fs::write(&target_path, bytes).map_err(|e| format!("write copy: {e}"))?;
    Ok(())
}

pub(crate) fn upload_document_file_tx(
    c: &rusqlite::Connection,
    store: &std::path::Path,
    request: UploadDocumentFileRequest,
) -> Result<DocumentFile> {
    validate_document_placement(
        c,
        &request.container_type,
        request.container_id.as_deref(),
        request.folder_id.as_deref(),
    )?;
    let source = std::path::PathBuf::from(&request.source_path);
    let meta = std::fs::metadata(&source).map_err(|e| format!("{}: {e}", source.display()))?;
    if !meta.is_file() {
        return Err(format!("'{}' is not a file", request.source_path));
    }
    if meta.len() > request.max_file_bytes {
        return Err(format!(
            "file is {} bytes, over the {} byte upload limit",
            meta.len(),
            request.max_file_bytes
        ));
    }
    let filename = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "source path has no file name".to_string())?;
    let document_id = generated_id("doc");
    let mime = mime_for(&filename);
    let target = store.join(stored_name(&document_id, &filename));
    std::fs::create_dir_all(store).map_err(|e| format!("create upload directory: {e}"))?;
    std::fs::copy(&source, &target).map_err(|e| format!("store upload: {e}"))?;
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(&filename)
        .to_string();
    let body = format!("{filename} ({} bytes, {mime})", meta.len());
    // Row first, blob already on disk: an orphaned blob is recoverable, a row pointing
    // at a missing file is not, so the copy happens before the insert.
    let insert = c.execute(
        "INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,body_format,title,body,version,archived,created_by) VALUES(?1,?2,?3,?4,'file','text',?5,?6,1,0,?7)",
        rusqlite::params![
            document_id,
            request.container_type,
            request.container_id,
            request.folder_id,
            title,
            body,
            request.created_by
        ],
    );
    if let Err(e) = insert {
        let _ = std::fs::remove_file(&target);
        return Err(e.to_string());
    }
    c.execute(
        "INSERT INTO doc_versions(id,document_id,version,body,created_by) VALUES(?1,?2,1,?3,?4)",
        rusqlite::params![
            generated_id("docver"),
            document_id,
            body,
            request.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO document_files(document_id,filename,mime,size,stored_path,uploaded_by) VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![
            document_id,
            filename,
            mime,
            meta.len() as i64,
            target.to_string_lossy().to_string(),
            request.created_by
        ],
    )
    .map_err(|e| e.to_string())?;
    get_document_file_tx(c, &document_id)?.ok_or_else(|| "stored upload vanished".into())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_document_file(document_id: String) -> Result<Option<DocumentFile>> {
    let c = db::conn()?;
    get_document_file_tx(&c, &document_id)
}

pub(crate) fn get_document_file_tx(
    c: &rusqlite::Connection,
    document_id: &str,
) -> Result<Option<DocumentFile>> {
    c.query_row(
        "SELECT document_id,filename,mime,size,uploaded_by,uploaded_at FROM document_files WHERE document_id=?1",
        [document_id],
        |r| {
            Ok(DocumentFile {
                document_id: r.get(0)?,
                filename: r.get(1)?,
                mime: r.get(2)?,
                size: r.get(3)?,
                uploaded_by: r.get(4)?,
                uploaded_at: r.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn read_document_file(
    document_id: String,
    max_bytes: Option<u64>,
) -> Result<DocumentFilePreview> {
    let c = db::conn()?;
    read_document_file_tx(
        &c,
        &document_id,
        max_bytes.unwrap_or_else(default_preview_bytes),
    )
}

pub(crate) fn read_document_file_tx(
    c: &rusqlite::Connection,
    document_id: &str,
    max_bytes: u64,
) -> Result<DocumentFilePreview> {
    let (filename, mime, size, stored_path): (String, String, i64, String) = c
        .query_row(
            "SELECT filename,mime,size,stored_path FROM document_files WHERE document_id=?1",
            [document_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "uploaded file not found".to_string())?;
    let bytes = std::fs::read(&stored_path).map_err(|e| format!("read upload: {e}"))?;
    let truncated = bytes.len() as u64 > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes as usize)];
    // Text previews stay text (readable, diffable); everything else is base64 so the
    // frontend can hand it straight to an <img>/<object> data URL.
    let textual = mime.starts_with("text/") || mime == "application/json";
    let (text, data_base64) = if textual {
        (Some(String::from_utf8_lossy(slice).to_string()), None)
    } else {
        use base64::Engine as _;
        (
            None,
            Some(base64::engine::general_purpose::STANDARD.encode(slice)),
        )
    };
    Ok(DocumentFilePreview {
        document_id: document_id.to_string(),
        filename,
        mime,
        size,
        truncated,
        text,
        data_base64,
    })
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

    /// Throwaway import source under src-tauri/target/, never a user directory.
    fn import_dir(name: &str) -> std::path::PathBuf {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-imports")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn document_discussion_binds_and_rebinds_the_meeting_channel() {
        let c = test_conn();
        c.execute("INSERT INTO documents(id,container_type,doc_type,title) VALUES('d1','my-docs','text','Article')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,doc_type,title) VALUES('d2','my-docs','text','Other')", []).unwrap();
        for id in ["m1", "m2"] {
            c.execute(
                "INSERT INTO meetings(id,title,starts_at,ends_at) VALUES(?1,'Meeting',1,2)",
                [id],
            )
            .unwrap();
        }

        let first = attach_document_discussion_on(&c, "d1", Some("m1")).unwrap();
        assert_eq!(first.channel_id, "entity:document:d1");
        let m1: Option<String> = c
            .query_row("SELECT channel_id FROM meetings WHERE id='m1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(m1.as_deref(), Some("entity:document:d1"));

        let rebound = attach_document_discussion_on(&c, "d1", Some("m2")).unwrap();
        assert_eq!(rebound.meeting_id.as_deref(), Some("m2"));
        let m1: Option<String> = c
            .query_row("SELECT channel_id FROM meetings WHERE id='m1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let m2: Option<String> = c
            .query_row("SELECT channel_id FROM meetings WHERE id='m2'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(m1, None);
        assert_eq!(m2.as_deref(), Some("entity:document:d1"));
        assert!(attach_document_discussion_on(&c, "d2", Some("m2")).is_err());
        let channels: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM channels WHERE id='entity:document:d2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(channels, 0, "a rejected binding must not create a channel");
    }

    #[test]
    fn a_favourite_is_a_pointer_scoped_by_read_access() {
        let c = test_conn();
        for id in ["pa", "pb"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,strftime('%s','now'))",
                [id],
            )
            .unwrap();
        }
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('p1','Orbital','ORB','pa',strftime('%s','now'))", []).unwrap();
        // A project document (readable by its members) and somebody else's private one.
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,created_by) VALUES('shared','project','p1','text','Spec','pa')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,created_by) VALUES('private','my-docs','pb','text','Diary','pb')", []).unwrap();

        set_document_favorite_on(&c, "pa".into(), "shared".into(), true).expect("own project doc");
        let mine = list_favorite_documents_on(&c, "pa".into()).unwrap();
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].document.id, "shared");
        // The pointer does not move the document out of its project.
        assert_eq!(mine[0].document.container_type, "project");
        assert_eq!(mine[0].document.container_id.as_deref(), Some("p1"));

        // Starring is bounded by read access, so it cannot be used to peek at titles.
        assert!(set_document_favorite_on(&c, "pa".into(), "private".into(), true).is_err());
        assert_eq!(
            list_favorite_documents_on(&c, "pa".into()).unwrap().len(),
            1
        );

        // Un-starring removes the pointer only: the document survives.
        set_document_favorite_on(&c, "pa".into(), "shared".into(), false).unwrap();
        assert!(list_favorite_documents_on(&c, "pa".into())
            .unwrap()
            .is_empty());
        let still_there: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM documents WHERE id='shared'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 1);
    }

    #[test]
    fn favourites_keep_a_chosen_order_and_can_be_filed_on_shelves() {
        let c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','pa','pa',strftime('%s','now'))", []).unwrap();
        for id in ["d1", "d2", "d3"] {
            c.execute(
                "INSERT INTO documents(id,container_type,container_id,doc_type,title,created_by) VALUES(?1,'my-docs','pa','text',?1,'pa')",
                [id],
            )
            .unwrap();
            set_document_favorite_on(&c, "pa".into(), id.to_string(), true).unwrap();
        }
        // Starring appends: the order is the order they were added, not all-zero ties.
        let order = |list: &[FavoriteDocument]| {
            list.iter()
                .map(|f| f.document.id.clone())
                .collect::<Vec<_>>()
        };
        let all = list_favorite_documents_on(&c, "pa".into()).unwrap();
        assert_eq!(order(&all), ["d1", "d2", "d3"]);

        // Filing one away must not leave a hole in the shelf it left.
        // Move the last one to the top of the unfiled shelf.
        move_favorite_document_on(&c, "pa".into(), "d3".into(), None, -1).unwrap();
        let all = list_favorite_documents_on(&c, "pa".into()).unwrap();
        assert_eq!(order(&all), ["d3", "d1", "d2"]);
        // Stored positions are renumbered dense, so a later read cannot drift.
        assert_eq!(
            all.iter().map(|f| f.position).collect::<Vec<_>>(),
            [0, 1, 2]
        );

        // File one on a named shelf: unfiled favourites still come first, and the
        // document itself is untouched by the filing.
        move_favorite_document_on(&c, "pa".into(), "d1".into(), Some("  Reading  ".into()), 0)
            .unwrap();
        let all = list_favorite_documents_on(&c, "pa".into()).unwrap();
        assert_eq!(order(&all), ["d3", "d2", "d1"]);
        assert_eq!(all[2].group_name.as_deref(), Some("Reading"), "trimmed");
        assert_eq!(all[0].group_name, None);
        assert_eq!(
            all.iter()
                .filter(|f| f.group_name.is_none())
                .map(|f| f.position)
                .collect::<Vec<_>>(),
            [0, 1],
            "the shelf a favourite left is renumbered dense"
        );
        let container: String = c
            .query_row(
                "SELECT container_type FROM documents WHERE id='d1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            container, "my-docs",
            "filing a pointer must not move a document"
        );

        // Moving something that is not a favourite is refused, not silently created.
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,created_by) VALUES('d4','my-docs','pa','text','d4','pa')", []).unwrap();
        assert!(move_favorite_document_on(&c, "pa".into(), "d4".into(), None, 0).is_err());
    }

    #[test]
    fn a_favourite_disappears_when_its_document_does() {
        let c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','pa','pa',strftime('%s','now'))", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,created_by) VALUES('d1','my-docs','pa','text','Note','pa')", []).unwrap();
        set_document_favorite_on(&c, "pa".into(), "d1".into(), true).unwrap();
        c.execute("DELETE FROM documents WHERE id='d1'", [])
            .unwrap();
        let rows: i64 = c
            .query_row("SELECT COUNT(*) FROM document_favorites", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0, "the pointer must cascade with its target");
    }

    #[test]
    fn publishing_mints_a_unique_slug_and_only_published_docs_resolve_publicly() {
        let c = test_conn();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,body) VALUES('d1','my-docs','p1','text','My First Page!','a')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,body) VALUES('d2','my-docs','p1','text','My First Page!','b')", []).unwrap();

        let first = publish_document_tx(&c, "d1".into(), true, None).expect("publish");
        assert!(first.published);
        assert_eq!(first.public_slug.as_deref(), Some("my-first-page"));
        assert!(first.published_at.is_some());
        let second = publish_document_tx(&c, "d2".into(), true, None).expect("publish");
        assert_eq!(
            second.public_slug.as_deref(),
            Some("my-first-page-2"),
            "slug collision"
        );

        let public = get_public_document_tx(&c, "my-first-page".into()).unwrap();
        assert_eq!(public.map(|d| d.id), Some("d1".to_string()));

        // Unpublishing keeps the slug but closes the link.
        let closed = publish_document_tx(&c, "d1".into(), false, None).expect("unpublish");
        assert!(!closed.published);
        assert_eq!(closed.public_slug.as_deref(), Some("my-first-page"));
        assert!(get_public_document_tx(&c, "my-first-page".into())
            .unwrap()
            .is_none());

        // Archived documents are never public either.
        c.execute("UPDATE documents SET archived=1 WHERE id='d2'", [])
            .unwrap();
        assert!(get_public_document_tx(&c, "my-first-page-2".into())
            .unwrap()
            .is_none());
    }

    #[test]
    fn book_grants_and_publication_widen_the_read_scope() {
        let c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('reader','reader','Reader',unixepoch())", []).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('owner','owner','Owner',unixepoch())", []).unwrap();
        c.execute("INSERT INTO document_folders(id,container_type,container_id,name) VALUES('book','kb',NULL,'Handbook')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,created_by) VALUES('kbdoc','kb','book','book','text','Article','owner')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,created_by) VALUES('priv','my-docs','owner','text','Private','owner')", []).unwrap();

        let readable = |id: &str| -> bool {
            c.query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM documents d WHERE d.id=?2 AND {})",
                    document_read_scope()
                ),
                rusqlite::params!["reader", id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(!readable("kbdoc"), "kb doc readable without a grant");
        assert!(!readable("priv"));

        c.execute("INSERT INTO document_folder_permissions(folder_id,recipient_type,recipient_id,access_level) VALUES('book','profile','reader','viewer')", []).unwrap();
        assert!(readable("kbdoc"), "book grant not honoured");
        assert!(!readable("priv"), "book grant leaked outside the book");

        publish_document_tx(&c, "priv".into(), true, None).unwrap();
        assert!(readable("priv"), "published doc not readable");
    }

    #[test]
    fn project_root_is_idempotent_repairs_legacy_rows_and_blocks_direct_documents() {
        let mut c = test_conn();
        c.execute("INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES('legacy-folder','project','demo-project',NULL,'Legacy')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title) VALUES('legacy-doc','project','demo-project',NULL,'text','Legacy doc')", []).unwrap();
        let root = ensure_project_document_root_tx(&mut c, "demo-project").expect("create root");
        let same = ensure_project_document_root_tx(&mut c, "demo-project").expect("reuse root");
        assert_eq!(root.id, same.id);
        let legacy_parent: String = c
            .query_row(
                "SELECT parent_id FROM document_folders WHERE id='legacy-folder'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let legacy_doc_folder: String = c
            .query_row(
                "SELECT folder_id FROM documents WHERE id='legacy-doc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy_parent, root.id);
        assert_eq!(legacy_doc_folder, root.id);
        assert!(validate_document_placement(&c, "project", Some("demo-project"), None).is_err());
        validate_document_placement(&c, "project", Some("demo-project"), Some(&root.id))
            .expect("root accepts document");
    }

    #[test]
    fn import_mirrors_tree_and_classifies_markdown_and_text_pages() {
        let mut c = test_conn();
        let root = ensure_project_document_root_tx(&mut c, "demo-project").expect("project root");
        let dir = import_dir("docs-import");
        std::fs::write(dir.join("root.md"), "# Root Page\n\nbody\n").unwrap();
        std::fs::write(dir.join("skip.txt"), "not imported").unwrap();
        std::fs::create_dir_all(dir.join("space/child")).unwrap();
        std::fs::write(
            dir.join("space/page.html"),
            "<html><head><title>Ignored</title></head><body><h1>HTML Page</h1><p>a &amp; b</p><script>var x=1;</script></body></html>",
        )
        .unwrap();
        std::fs::write(dir.join("space/child/deep.md"), "deep body\n").unwrap();

        let summary = import_document_folder_tx(
            &c,
            DocumentImportRequest {
                source_path: dir.to_string_lossy().to_string(),
                container_type: "project".into(),
                container_id: Some("demo-project".into()),
                parent_folder_id: Some(root.id.clone()),
                created_by: None,
                extensions: default_import_extensions(),
                max_file_bytes: default_max_file_bytes(),
                max_depth: default_max_depth(),
            },
        )
        .expect("import");
        assert_eq!(
            summary.documents_created, 4,
            "skipped: {:?}",
            summary.skipped
        );
        assert_eq!(summary.folders_created, 2);

        let html_type: String = c
            .query_row(
                "SELECT doc_type FROM documents WHERE title='page.html'",
                [],
                |r| r.get(0),
            )
            .expect("html file imported");
        assert_eq!(html_type, "file");
        let (txt_type, txt_format): (String, String) = c
            .query_row(
                "SELECT doc_type,body_format FROM documents WHERE title='skip'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("text page imported");
        assert_eq!((txt_type.as_str(), txt_format.as_str()), ("text", "text"));

        // Markdown heading wins over the file stem; the tree is mirrored, not flattened.
        let deep_folder: String = c
            .query_row(
                "SELECT f.name FROM documents d JOIN document_folders f ON f.id=d.folder_id WHERE d.title='deep'",
                [],
                |r| r.get(0),
            )
            .expect("deep doc filed");
        assert_eq!(deep_folder, "child");
        let root_titles: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM documents WHERE title='Root Page' AND folder_id=?1",
                [&root.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(root_titles, 1);
        // Every imported page starts its version history.
        let versions: i64 = c
            .query_row("SELECT COUNT(*) FROM doc_versions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(versions, 4);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_reports_oversize_files_instead_of_dropping_them() {
        let c = test_conn();
        let dir = import_dir("docs-import-limit");
        std::fs::write(dir.join("big.md"), "x".repeat(200)).unwrap();
        let summary = import_document_folder_tx(
            &c,
            DocumentImportRequest {
                source_path: dir.to_string_lossy().to_string(),
                container_type: "my-docs".into(),
                container_id: Some("default-org".into()),
                parent_folder_id: None,
                created_by: None,
                extensions: default_import_extensions(),
                max_file_bytes: 100,
                max_depth: default_max_depth(),
            },
        )
        .expect("import");
        assert_eq!(summary.documents_created, 0);
        assert_eq!(summary.skipped.len(), 1);
        assert!(
            summary.skipped[0].contains("max_file_bytes"),
            "{:?}",
            summary.skipped
        );
        let _ = std::fs::remove_dir_all(&dir);
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

    /// A folder is a container, so its deletion is a decision about the folder alone:
    /// an empty one goes, a populated one refuses by name, and nothing inside it is ever
    /// removed on the way. Archived content still counts — hidden is not gone.
    #[test]
    fn a_folder_is_deleted_only_when_it_is_empty() {
        let c = test_conn();
        c.execute(
            "INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('f-empty','my-docs','ada',NULL,'Empty',0),('f-full','my-docs','ada',NULL,'Full',0),('f-parent','my-docs','ada',NULL,'Parent',0),('f-child','my-docs','ada','f-parent','Child',0)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO documents(id,container_type,folder_id,doc_type,title,archived) VALUES('d-in','my-docs','f-full','text','Inside',1)", []).unwrap();

        delete_document_folder_on(&c, "f-empty", "ada").unwrap();
        let empty_gone: i64 = c
            .query_row(
                "SELECT count(*) FROM document_folders WHERE id='f-empty'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(empty_gone, 0);

        assert_eq!(
            delete_document_folder_on(&c, "f-full", "ada").unwrap_err(),
            "Folder is not empty",
            "an archived document is still content"
        );
        assert_eq!(
            delete_document_folder_on(&c, "f-parent", "ada").unwrap_err(),
            "Folder is not empty",
            "a subfolder is content too"
        );
        assert_eq!(
            delete_document_folder_on(&c, "f-ghost", "ada").unwrap_err(),
            "Folder not found"
        );
        let survivors: i64 = c
            .query_row(
                "SELECT (SELECT count(*) FROM documents WHERE id='d-in') + (SELECT count(*) FROM document_folders WHERE id IN ('f-full','f-parent','f-child'))",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(survivors, 4, "a refused delete removes nothing at all");
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

    #[test]
    fn kb_book_grants_make_the_whole_book_navigable_and_editors_writable() {
        let c = test_conn();
        for p in ["book-owner", "book-viewer", "book-editor", "book-stranger"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,0)",
                [p],
            )
            .unwrap();
        }
        c.execute(
            "INSERT INTO teams(id,name) VALUES('book-editors','Book editors')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO team_memberships(id,profile_id,team_id) VALUES('book-editor-membership','book-editor','book-editors')", []).unwrap();
        c.execute("INSERT INTO document_folders(id,container_type,container_id,parent_id,name) VALUES('book-grants','kb','book-grants',NULL,'Handbook'),('book-grants-folder','kb','book-grants','book-grants','Chapter')", []).unwrap();
        c.execute(
            "INSERT INTO kb_book_owners(book_id,profile_id) VALUES('book-grants','book-owner')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO document_folder_permissions(folder_id,recipient_type,recipient_id,access_level) VALUES('book-grants','profile','book-viewer','viewer'),('book-grants','team','book-editors','editor')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,version,archived,created_by) VALUES('book-grants-doc','kb','book-grants','book-grants-folder','text','Rules',1,0,'book-owner')", []).unwrap();
        assert_eq!(
            scoped_doc_ids(&c, "book-viewer", false),
            vec!["book-grants-doc"]
        );
        assert!(
            scoped_doc_ids(&c, "book-viewer", true).is_empty(),
            "viewers cannot edit"
        );
        assert_eq!(
            scoped_doc_ids(&c, "book-editor", true),
            vec!["book-grants-doc"]
        );
        for profile in ["book-owner", "book-viewer", "book-editor"] {
            assert_eq!(
                readable_folders(&c, profile),
                vec!["book-grants".to_string(), "book-grants-folder".to_string()]
            );
        }
        assert!(readable_folders(&c, "book-stranger").is_empty());
        let folder_write = |profile: &str| {
            c.query_row(&format!("SELECT EXISTS(SELECT 1 FROM document_folders f WHERE f.id='book-grants-folder' AND {FOLDER_WRITE_SCOPE})"), rusqlite::params![profile, false], |r| r.get::<_, bool>(0)).unwrap()
        };
        assert!(folder_write("book-owner"));
        assert!(folder_write("book-editor"));
        assert!(!folder_write("book-viewer"));
    }

    fn upload_source(name: &str, bytes: &[u8]) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = import_dir(name);
        let file = dir.join(name);
        std::fs::write(&file, bytes).unwrap();
        let store = dir.join("store");
        std::fs::create_dir_all(&store).unwrap();
        (file, store)
    }

    #[test]
    fn an_upload_becomes_a_document_whose_bytes_live_outside_the_database() {
        let c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p1','p1','P1',unixepoch())", []).unwrap();
        let (file, store) = upload_source("notes.txt", b"hello upload");
        let uploaded = upload_document_file_tx(
            &c,
            &store,
            UploadDocumentFileRequest {
                source_path: file.to_string_lossy().to_string(),
                container_type: "my-docs".into(),
                container_id: Some("p1".into()),
                folder_id: None,
                title: None,
                created_by: Some("p1".into()),
                max_file_bytes: default_max_upload_bytes(),
            },
        )
        .expect("upload");

        assert_eq!(uploaded.filename, "notes.txt");
        assert_eq!(uploaded.mime, "text/plain");
        assert_eq!(uploaded.size, 12);
        // It is an ordinary document: same table, same folder tree, seeded history.
        let (doc_type, title, versions): (String, String, i64) = c
            .query_row(
                "SELECT d.doc_type,d.title,(SELECT count(*) FROM doc_versions v WHERE v.document_id=d.id) FROM documents d WHERE d.id=?1",
                [&uploaded.document_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(doc_type, "file");
        assert_eq!(title, "notes.txt");
        assert_eq!(versions, 1);
        // The payload is on disk, not in the row.
        let stored: String = c
            .query_row(
                "SELECT stored_path FROM document_files WHERE document_id=?1",
                [&uploaded.document_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(std::fs::read(&stored).unwrap(), b"hello upload");
        assert!(
            std::path::Path::new(&stored).starts_with(&store),
            "uploads stay inside the store directory"
        );
    }

    #[test]
    fn a_traversal_filename_cannot_address_anything_outside_the_store() {
        // The stored name is derived from the generated document id, so a hostile source
        // file name can only ever contribute an extension.
        let name = stored_name("doc-abc", "../../space.db");
        assert_eq!(name, "doc-abc.db");
        assert!(!stored_name("doc-abc", "../../evil").contains('/'));
    }

    #[test]
    fn an_oversized_upload_is_refused_and_stores_nothing() {
        let c = test_conn();
        let (file, store) = upload_source("big.bin", &[0u8; 64]);
        let err = upload_document_file_tx(
            &c,
            &store,
            UploadDocumentFileRequest {
                source_path: file.to_string_lossy().to_string(),
                container_type: "my-docs".into(),
                container_id: Some("p1".into()),
                folder_id: None,
                title: None,
                created_by: None,
                max_file_bytes: 16,
            },
        )
        .expect_err("over limit");
        assert!(err.contains("upload limit"), "{err}");
        assert_eq!(std::fs::read_dir(&store).unwrap().count(), 0);
        let docs: i64 = c
            .query_row("SELECT count(*) FROM documents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(docs, 0, "a refused upload creates no document");
    }

    #[test]
    fn previews_return_text_for_text_and_base64_for_binary_and_mark_truncation() {
        let c = test_conn();
        let (file, store) = upload_source("notes.txt", b"hello upload");
        let text_doc = upload_document_file_tx(
            &c,
            &store,
            UploadDocumentFileRequest {
                source_path: file.to_string_lossy().to_string(),
                container_type: "my-docs".into(),
                container_id: Some("p1".into()),
                folder_id: None,
                title: Some("Notes".into()),
                created_by: None,
                max_file_bytes: default_max_upload_bytes(),
            },
        )
        .expect("upload");
        let preview = read_document_file_tx(&c, &text_doc.document_id, 1024).expect("preview");
        assert_eq!(preview.text.as_deref(), Some("hello upload"));
        assert!(preview.data_base64.is_none());
        assert!(!preview.truncated);

        let short = read_document_file_tx(&c, &text_doc.document_id, 5).expect("preview");
        assert_eq!(short.text.as_deref(), Some("hello"));
        assert!(short.truncated, "a capped preview says so");
        assert_eq!(short.size, 12, "size stays the full file size");

        let (png, store2) = upload_source("pixel.png", &[0x89, 0x50, 0x4e, 0x47]);
        let binary_doc = upload_document_file_tx(
            &c,
            &store2,
            UploadDocumentFileRequest {
                source_path: png.to_string_lossy().to_string(),
                container_type: "my-docs".into(),
                container_id: Some("p1".into()),
                folder_id: None,
                title: None,
                created_by: None,
                max_file_bytes: default_max_upload_bytes(),
            },
        )
        .expect("upload");
        let preview = read_document_file_tx(&c, &binary_doc.document_id, 1024).expect("preview");
        assert_eq!(preview.mime, "image/png");
        assert_eq!(preview.data_base64.as_deref(), Some("iVBORw=="));
        assert!(preview.text.is_none());
    }

    #[test]
    fn an_unknown_extension_previews_as_inert_octet_stream() {
        assert_eq!(mime_for("thing.weird"), "application/octet-stream");
        assert_eq!(mime_for("page.html"), "text/html");
        assert_eq!(mime_for("IMAGE.JPG"), "image/jpeg");
    }

    /// Deletion follows OWNERSHIP, not write access. Your own shelf is yours; a project
    /// document answers to its author and the project owner; and in the organization
    /// library only a book owner may destroy — an editor writes, an owner deletes.
    #[test]
    fn deleting_a_document_asks_who_owns_it_not_who_may_write_it() {
        let mut c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('ada','ada','Ada',1),('bea','bea','Bea',1),('cid','cid','Cid',1)", []).unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('pr','Project','PR','ada',1)", []).unwrap();
        c.execute("INSERT INTO project_members(project_id,profile_id) VALUES('pr','bea')", []).unwrap();
        c.execute("INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('root','project','pr',NULL,'Documents',0),('book','kb',NULL,NULL,'Handbook',0)", []).unwrap();
        c.execute("INSERT INTO kb_book_owners(book_id,profile_id) VALUES('book','ada')", []).unwrap();
        c.execute("INSERT INTO document_folder_permissions(folder_id,recipient_type,recipient_id,access_level) VALUES('book','profile','bea','editor')", []).unwrap();
        c.execute("INSERT INTO documents(id,container_type,container_id,folder_id,doc_type,title,created_by) VALUES \
                   ('mine','my-docs','ada',NULL,'text','Private','ada'), \
                   ('proj','project','pr','root','text','Spec','bea'), \
                   ('page','kb','book',NULL,'text','Chapter','bea')", []).unwrap();

        // Personal: only the container's own person.
        assert!(delete_document_on(&mut c, "mine", "bea").is_err());
        assert_eq!(
            count(&c, "SELECT count(*) FROM documents WHERE id='mine'"),
            1,
            "a refused delete leaves the document"
        );
        // Organization library: the editor writes but must not destroy; the owner may.
        let refused = delete_document_on(&mut c, "page", "cid").unwrap_err();
        assert_eq!(refused, "only the owner of this document can delete it");
        assert!(
            document_writable_by_on(&c, "page", "bea"),
            "the editor still has write access"
        );
        delete_document_on(&mut c, "page", "ada").unwrap();
        // Project: the author and the project owner both qualify, a plain member does not.
        assert!(delete_document_on(&mut c, "proj", "cid").is_err());
        delete_document_on(&mut c, "proj", "ada").unwrap();
        delete_document_on(&mut c, "mine", "ada").unwrap();
        assert_eq!(count(&c, "SELECT count(*) FROM documents"), 0);
        assert_eq!(
            delete_document_on(&mut c, "ghost", "ada").unwrap_err(),
            "Document not found"
        );
    }

    /// The same rule for the container: an empty folder still only goes for its owner.
    #[test]
    fn deleting_a_folder_asks_the_same_owner_question() {
        let c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('ada','ada','Ada',1),('bea','bea','Bea',1)", []).unwrap();
        c.execute("INSERT INTO projects(id,name,key,created_by,created_at) VALUES('pr','Project','PR','ada',1)", []).unwrap();
        c.execute("INSERT INTO project_members(project_id,profile_id) VALUES('pr','bea')", []).unwrap();
        c.execute("INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES \
                   ('mine','my-docs','ada',NULL,'Shelf',0),('sub','project','pr',NULL,'Notes',0),('book','kb',NULL,NULL,'Handbook',0)", []).unwrap();
        c.execute("INSERT INTO kb_book_owners(book_id,profile_id) VALUES('book','ada')", []).unwrap();
        c.execute("INSERT INTO document_folder_permissions(folder_id,recipient_type,recipient_id,access_level) VALUES('book','profile','bea','editor')", []).unwrap();

        for (folder, stranger) in [("mine", "bea"), ("sub", "bea"), ("book", "bea")] {
            let refused = delete_document_folder_on(&c, folder, stranger).unwrap_err();
            assert_eq!(refused, "only the owner of this folder can delete it");
        }
        assert_eq!(count(&c, "SELECT count(*) FROM document_folders"), 3);
        for folder in ["mine", "sub", "book"] {
            delete_document_folder_on(&c, folder, "ada").unwrap();
        }
        assert_eq!(count(&c, "SELECT count(*) FROM document_folders"), 0);
    }

    /// The library shows the owner rule instead of letting people discover it by refusal.
    #[test]
    fn list_book_owners_names_exactly_the_owners_of_that_book() {
        let c = test_conn();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('ada','ada','Ada',1),('bea','bea','Bea',1)", []).unwrap();
        c.execute("INSERT INTO document_folders(id,container_type,container_id,parent_id,name,archived) VALUES('book','kb',NULL,NULL,'Handbook',0),('other','kb',NULL,NULL,'Other',0)", []).unwrap();
        c.execute("INSERT INTO kb_book_owners(book_id,profile_id) VALUES('book','ada'),('other','bea')", []).unwrap();
        c.execute("INSERT INTO document_folder_permissions(folder_id,recipient_type,recipient_id,access_level) VALUES('book','profile','bea','editor')", []).unwrap();

        assert_eq!(
            list_book_owners_on(&c, "book").unwrap(),
            vec!["ada".to_string()],
            "owners only — never an editor, and never another book's owner"
        );
        assert!(list_book_owners_on(&c, "no-such-book").unwrap().is_empty());
    }

    fn count(c: &rusqlite::Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }
    fn document_writable_by_on(c: &rusqlite::Connection, id: &str, profile_id: &str) -> bool {
        c.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM documents d WHERE d.id=?3 AND {})", document_write_scope()),
            rusqlite::params![profile_id, false, id],
            |row| row.get(0),
        )
        .unwrap()
    }
}
