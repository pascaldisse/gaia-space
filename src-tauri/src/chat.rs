#![allow(dead_code)]
//! Native chat: channels, members, messages, reactions, threads and read state.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub content_type: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub project_id: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    pub author_id: Option<String>,
    pub text: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
    pub thread_of: Option<String>,
    pub archived: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Reaction {
    pub message_id: String,
    pub profile_id: String,
    pub emoji: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ReadState {
    pub channel_id: String,
    pub profile_id: String,
    pub message_id: Option<String>,
    pub read_at: i64,
}
#[tauri::command]
pub fn list_channels(app: AppHandle) -> Result<Vec<Channel>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,content_type,name,description,project_id,archived FROM channels ORDER BY name").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(Channel {
                id: r.get(0)?,
                content_type: r.get(1)?,
                name: r.get(2)?,
                description: r.get(3)?,
                project_id: r.get(4)?,
                archived: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_channel(app: AppHandle, id: String) -> Result<Option<Channel>> {
    Ok(list_channels(app)?.into_iter().find(|v| v.id == id))
}
#[tauri::command]
pub fn create_channel(app: AppHandle, channel: Channel) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO channels(id,content_type,name,description,project_id,archived)VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![channel.id,channel.content_type,channel.name,channel.description,channel.project_id,channel.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_channel(app: AppHandle, channel: Channel) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("UPDATE channels SET content_type=?2,name=?3,description=?4,project_id=?5,archived=?6 WHERE id=?1",rusqlite::params![channel.id,channel.content_type,channel.name,channel.description,channel.project_id,channel.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn list_messages(app: AppHandle, channel_id: Option<String>) -> Result<Vec<Message>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived FROM messages WHERE (?1 IS NULL OR channel_id=?1) ORDER BY created_at").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([channel_id], |r| {
            Ok(Message {
                id: r.get(0)?,
                channel_id: r.get(1)?,
                author_id: r.get(2)?,
                text: r.get(3)?,
                created_at: r.get(4)?,
                edited_at: r.get(5)?,
                thread_of: r.get(6)?,
                archived: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn create_message(app: AppHandle, message: Message) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO messages(id,channel_id,author_id,text,created_at,edited_at,thread_of,archived)VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",rusqlite::params![message.id,message.channel_id,message.author_id,message.text,message.created_at,message.edited_at,message.thread_of,message.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_message(app: AppHandle, message: Message) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute(
        "UPDATE messages SET text=?2,edited_at=unixepoch(),archived=?3 WHERE id=?1",
        rusqlite::params![message.id, message.text, message.archived],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
// TODO: capability-specific content, scheduled delivery, mentions, pinning and notification policies.
