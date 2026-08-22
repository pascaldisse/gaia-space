//! Organization blog articles: private document drafts promoted into a distinct article record.
use crate::db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{kind}-{nanos:x}-{:x}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlogPost {
    pub id: String,
    pub draft_id: Option<String>,
    pub title: String,
    pub body: String,
    pub author_id: String,
    pub aliases: Vec<String>,
    pub team_id: Option<String>,
    pub project_id: Option<String>,
    pub location_id: Option<String>,
    pub created_at: i64,
    pub published_at: i64,
    pub archived: bool,
    pub archived_by: Option<String>,
    pub archived_at: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct PublishBlogDraftInput {
    pub draft_id: String,
    pub author_id: String,
    pub team_id: Option<String>,
    pub project_id: Option<String>,
    pub location_id: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct BlogFilter {
    pub term: Option<String>,
    pub author_id: Option<String>,
    pub team_id: Option<String>,
    pub project_id: Option<String>,
    pub location_id: Option<String>,
    pub include_archived: Option<bool>,
}
fn slug(title: &str) -> String {
    let value = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let value = value
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if value.is_empty() {
        "article".into()
    } else {
        value
    }
}
fn aliases(c: &rusqlite::Connection, id: &str) -> Result<Vec<String>> {
    let mut s = c
        .prepare("SELECT alias FROM blog_aliases WHERE post_id=?1 ORDER BY created_at,alias")
        .map_err(|e| e.to_string())?;
    let values = s
        .query_map([id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<String>, _>>()
        .map_err(|e| e.to_string());
    values
}
fn row(c: &rusqlite::Connection, r: &rusqlite::Row<'_>) -> rusqlite::Result<BlogPost> {
    let id: String = r.get(0)?;
    Ok(BlogPost {
        id: id.clone(),
        draft_id: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        author_id: r.get(4)?,
        aliases: aliases(c, &id).unwrap_or_default(),
        team_id: r.get(5)?,
        project_id: r.get(6)?,
        location_id: r.get(7)?,
        created_at: r.get(8)?,
        published_at: r.get(9)?,
        archived: r.get(10)?,
        archived_by: r.get(11)?,
        archived_at: r.get(12)?,
    })
}
const COLUMNS: &str = "id,draft_id,title,body,author_id,team_id,project_id,location_id,created_at,published_at,archived,archived_by,archived_at";
fn list_on(
    c: &rusqlite::Connection,
    filter: &BlogFilter,
    profile_id: Option<&str>,
    allow_all: bool,
) -> Result<Vec<BlogPost>> {
    let term = filter.term.as_deref().unwrap_or("").trim().to_lowercase();
    let pattern = format!("%{term}%");
    let mut s = c.prepare(&format!("SELECT {COLUMNS} FROM blog_posts b WHERE (?1='' OR lower(b.title) LIKE ?2 OR lower(b.body) LIKE ?2) AND (?3='' OR b.author_id=?3) AND (?4='' OR b.team_id=?4) AND (?5='' OR b.project_id=?5) AND (?6='' OR b.location_id=?6) AND (?7 OR b.archived=0) AND (?8 OR b.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=b.project_id AND (p.created_by=?9 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?9)))) ORDER BY b.published_at DESC" )).map_err(|e| e.to_string())?;
    let profile = profile_id.unwrap_or("");
    let posts = s
        .query_map(
            params![
                term,
                pattern,
                filter.author_id.as_deref().unwrap_or(""),
                filter.team_id.as_deref().unwrap_or(""),
                filter.project_id.as_deref().unwrap_or(""),
                filter.location_id.as_deref().unwrap_or(""),
                filter.include_archived.unwrap_or(false),
                allow_all,
                profile
            ],
            |r| row(c, r),
        )
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    posts
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_blog_posts(filter: Option<BlogFilter>) -> Result<Vec<BlogPost>> {
    let c = db::conn()?;
    list_on(
        &c,
        &filter.unwrap_or(BlogFilter {
            term: None,
            author_id: None,
            team_id: None,
            project_id: None,
            location_id: None,
            include_archived: None,
        }),
        None,
        true,
    )
}
pub fn list_blog_posts_scoped(
    filter: Option<BlogFilter>,
    profile_id: String,
    allow_all: bool,
) -> Result<Vec<BlogPost>> {
    let c = db::conn()?;
    list_on(
        &c,
        &filter.unwrap_or(BlogFilter {
            term: None,
            author_id: None,
            team_id: None,
            project_id: None,
            location_id: None,
            include_archived: None,
        }),
        Some(&profile_id),
        allow_all,
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_blog_post(id: String) -> Result<Option<BlogPost>> {
    let c = db::conn()?;
    c.query_row(
        &format!("SELECT {COLUMNS} FROM blog_posts WHERE id=?1"),
        [&id],
        |r| row(&c, r),
    )
    .optional()
    .map_err(|e| e.to_string())
}
pub fn get_blog_post_scoped(
    id: String,
    profile_id: String,
    allow_all: bool,
) -> Result<Option<BlogPost>> {
    Ok(list_blog_posts_scoped(
        Some(BlogFilter {
            term: None,
            author_id: None,
            team_id: None,
            project_id: None,
            location_id: None,
            include_archived: Some(true),
        }),
        profile_id,
        allow_all,
    )?
    .into_iter()
    .find(|p| p.id == id))
}
/// Web transport supplies the session profile + privilege bit, preventing a draft
/// author from publishing an article into a project they cannot see.
pub fn publish_blog_draft_scoped(
    mut input: PublishBlogDraftInput,
    profile_id: String,
    allow_all: bool,
) -> Result<BlogPost> {
    input.author_id = profile_id.clone();
    if let Some(project_id) = input.project_id.as_deref() {
        let c = db::conn()?;
        let allowed: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM projects p WHERE p.id=?1 AND (?2 OR p.created_by=?3 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?3)))", params![project_id,allow_all,profile_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !allowed {
            return Err("blog project target access denied".into());
        }
    }
    publish_blog_draft(input)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn publish_blog_draft(input: PublishBlogDraftInput) -> Result<BlogPost> {
    let c = db::conn()?;
    let (title, body, created_by): (String, String, Option<String>) = c
        .query_row(
            "SELECT title,coalesce(body,''),created_by FROM documents WHERE id=?1 AND archived=0",
            [&input.draft_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "draft document not found".to_string())?;
    if created_by.as_deref() != Some(input.author_id.as_str()) {
        return Err("only the draft author can publish it".into());
    }
    if input.project_id.as_deref().is_some_and(|project| {
        c.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            [project],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(false)
            == false
    }) {
        return Err("blog project target not found".into());
    }
    let id = new_id("blog");
    let alias = slug(&title);
    c.execute("INSERT INTO blog_posts(id,draft_id,title,body,author_id,team_id,project_id,location_id,created_at,published_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,unixepoch(),unixepoch())",params![id,input.draft_id,title,body,input.author_id,input.team_id,input.project_id,input.location_id]).map_err(|e|e.to_string())?;
    c.execute(
        "INSERT INTO blog_aliases(post_id,alias) VALUES(?1,?2)",
        params![id, alias],
    )
    .map_err(|e| e.to_string())?;
    get_blog_post(id)?.ok_or_else(|| "published article vanished".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_blog_post(id: String, archived: bool, actor_id: Option<String>) -> Result<BlogPost> {
    let c = db::conn()?;
    let n=c.execute("UPDATE blog_posts SET archived=?2,archived_by=CASE WHEN ?2 THEN ?3 ELSE NULL END,archived_at=CASE WHEN ?2 THEN unixepoch() ELSE NULL END WHERE id=?1",params![id,archived,actor_id]).map_err(|e|e.to_string())?;
    if n == 0 {
        return Err("blog post not found".into());
    };
    get_blog_post(id)?.ok_or_else(|| "blog post vanished".into())
}
