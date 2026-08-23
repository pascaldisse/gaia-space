#![allow(dead_code)]
//! Native chat: channels, members, messages, reactions, threads and read state.
//!
//! Model reference: docs/space-knowledge-base/04-collaboration.md §1 (decompiled M2).
//! Threads are not a separate entity — a reply is just a `Message` with `thread_of`
//! set to its root message id (mirrors `M2ChannelContentThread`). Entity-bound
//! channels are addressed by a deterministic id `entity:{entity_type}:{entity_id}`
//! so any other domain module can attach a discussion channel without a schema
//! change (generic `entity_type` + `entity_id`, per M2's per-entity channel refs
//! e.g. `DTO_Meeting.channelRef`, `Review.channel_id`).
use crate::db;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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
pub struct ChannelSummary {
    #[serde(flatten)]
    pub channel: Channel,
    pub member_count: i64,
    pub unread_count: i64,
    pub last_message_at: Option<i64>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelMember {
    pub channel_id: String,
    pub profile_id: String,
    pub administrator: bool,
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
    #[serde(default = "default_message_content_kind")]
    pub content_kind: String,
    #[serde(default)]
    pub mention_ids: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct MessageAttachment {
    pub id: String,
    pub message_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_length: i64,
    pub data_url: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct NewMessageAttachment {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_length: i64,
    pub data_url: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ReactionSummary {
    pub emoji: String,
    pub count: i64,
    pub mine: bool,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct MessageView {
    #[serde(flatten)]
    pub message: Message,
    pub reply_count: i64,
    pub reactions: Vec<ReactionSummary>,
    pub attachments: Vec<MessageAttachment>,
}

fn entity_channel_id(entity_type: &str, entity_id: &str) -> String {
    format!("entity:{entity_type}:{entity_id}")
}

fn channel_row(r: &rusqlite::Row) -> rusqlite::Result<Channel> {
    Ok(Channel {
        id: r.get(0)?,
        content_type: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        project_id: r.get(4)?,
        archived: r.get(5)?,
    })
}
fn list_channels_impl(c: &Connection) -> Result<Vec<Channel>> {
    let mut s = c
        .prepare("SELECT id,content_type,name,description,project_id,archived FROM channels ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], channel_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
fn get_channel_impl(c: &Connection, id: &str) -> Result<Option<Channel>> {
    c.query_row(
        "SELECT id,content_type,name,description,project_id,archived FROM channels WHERE id=?1",
        [id],
        channel_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}
fn member_count_impl(c: &Connection, channel_id: &str) -> Result<i64> {
    c.query_row(
        "SELECT COUNT(*) FROM channel_members WHERE channel_id=?1",
        [channel_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn unread_count_impl(c: &Connection, channel_id: &str, profile_id: &str) -> Result<i64> {
    c.query_row(
        "SELECT COUNT(*) FROM messages WHERE channel_id=?1 AND archived=0 AND created_at > \
         COALESCE((SELECT read_at FROM read_state WHERE channel_id=?1 AND profile_id=?2), 0)",
        rusqlite::params![channel_id, profile_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn last_message_at_impl(c: &Connection, channel_id: &str) -> Result<Option<i64>> {
    c.query_row(
        "SELECT MAX(created_at) FROM messages WHERE channel_id=?1 AND archived=0",
        [channel_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn channel_allows_profile(c: &Connection, channel_id: &str, profile_id: &str) -> Result<bool> {
    let content_type: String = c
        .query_row(
            "SELECT content_type FROM channels WHERE id=?1 AND archived=0",
            [channel_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if matches!(content_type.as_str(), "public" | "entity-bound") {
        return Ok(true);
    }
    let count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id=?1 AND profile_id=?2",
            rusqlite::params![channel_id, profile_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}
fn channel_allows_actor(
    c: &Connection,
    channel_id: &str,
    profile_id: Option<&str>,
) -> Result<bool> {
    let content_type: String = c
        .query_row(
            "SELECT content_type FROM channels WHERE id=?1 AND archived=0",
            [channel_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if matches!(content_type.as_str(), "public" | "entity-bound") {
        return Ok(true);
    }
    match profile_id {
        Some(profile_id) => channel_allows_profile(c, channel_id, profile_id),
        None => Ok(false),
    }
}
fn list_channels_with_meta_impl(c: &Connection, profile_id: &str) -> Result<Vec<ChannelSummary>> {
    let channels = list_channels_impl(c)?;
    let visible: Result<Vec<Option<ChannelSummary>>> = channels
        .into_iter()
        .filter(|ch| !ch.archived)
        .map(|ch| {
            if !channel_allows_profile(c, &ch.id, profile_id)? {
                return Ok(None);
            }
            let member_count = member_count_impl(c, &ch.id)?;
            let unread_count = unread_count_impl(c, &ch.id, profile_id)?;
            let last_message_at = last_message_at_impl(c, &ch.id)?;
            Ok(Some(ChannelSummary {
                channel: ch,
                member_count,
                unread_count,
                last_message_at,
            }))
        })
        .collect();
    Ok(visible?.into_iter().flatten().collect())
}
fn create_channel_impl(c: &Connection, channel: &Channel, member_ids: &[String]) -> Result<()> {
    c.execute(
        "INSERT INTO channels(id,content_type,name,description,project_id,archived)VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![channel.id, channel.content_type, channel.name, channel.description, channel.project_id, channel.archived],
    )
    .map_err(|e| e.to_string())?;
    for (index, profile_id) in member_ids.iter().enumerate() {
        c.execute(
            "INSERT OR IGNORE INTO channel_members(channel_id,profile_id,administrator) VALUES(?1,?2,?3)",
            rusqlite::params![channel.id, profile_id, index == 0],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn add_channel_member_impl(
    c: &Connection,
    channel_id: &str,
    profile_id: &str,
    administrator: bool,
) -> Result<()> {
    c.execute(
        "INSERT INTO channel_members(channel_id,profile_id,administrator) VALUES(?1,?2,?3) \
         ON CONFLICT(channel_id,profile_id) DO UPDATE SET administrator=excluded.administrator",
        rusqlite::params![channel_id, profile_id, administrator],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn remove_channel_member_impl(c: &Connection, channel_id: &str, profile_id: &str) -> Result<()> {
    c.execute(
        "DELETE FROM channel_members WHERE channel_id=?1 AND profile_id=?2",
        rusqlite::params![channel_id, profile_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn list_channel_members_impl(c: &Connection, channel_id: &str) -> Result<Vec<ChannelMember>> {
    let mut s = c
        .prepare("SELECT channel_id,profile_id,administrator FROM channel_members WHERE channel_id=?1 ORDER BY profile_id")
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([channel_id], |r| {
            Ok(ChannelMember {
                channel_id: r.get(0)?,
                profile_id: r.get(1)?,
                administrator: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
fn create_entity_channel_impl(
    c: &Connection,
    entity_type: &str,
    entity_id: &str,
    name: Option<String>,
) -> Result<Channel> {
    let id = entity_channel_id(entity_type, entity_id);
    c.execute(
        "INSERT OR IGNORE INTO channels(id,content_type,name,description,archived) VALUES(?1,'entity-bound',?2,?3,0)",
        rusqlite::params![id, name, format!("{entity_type}:{entity_id}")],
    )
    .map_err(|e| e.to_string())?;
    get_channel_impl(c, &id)?.ok_or_else(|| "entity channel missing after insert".to_string())
}

fn default_message_content_kind() -> String { "text".into() }
/// Durable system card for an absence lifecycle event. The entity-bound channel is
/// intentionally public like other entity discussions; sensitive reasons are never put in it.
pub(crate) fn post_absence_card_on(c: &Connection, absence_id: &str, profile_id: &str, date_from: &str, date_to: &str, availability: &str, action: &str) -> Result<()> {
    let channel = create_entity_channel_impl(c, "absence", absence_id, Some(format!("Time off · {profile_id}")))?;
    let id = format!("absence-card:{absence_id}:{action}:{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
    let payload = serde_json::json!({"absence_id":absence_id,"profile_id":profile_id,"date_from":date_from,"date_to":date_to,"availability":availability,"action":action}).to_string();
    c.execute("INSERT INTO messages(id,channel_id,author_id,text,thread_of,archived,content_kind) VALUES(?1,?2,NULL,?3,NULL,0,'absence-card')", rusqlite::params![id, channel.id, payload]).map_err(|e| e.to_string())?;
    Ok(())
}
fn message_row(r: &rusqlite::Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: r.get(0)?,
        channel_id: r.get(1)?,
        author_id: r.get(2)?,
        text: r.get(3)?,
        created_at: r.get(4)?,
        edited_at: r.get(5)?,
        thread_of: r.get(6)?,
        archived: r.get(7)?,
        content_kind: r.get(8)?,
        mention_ids: Vec::new(),
    })
}
fn reply_count_impl(c: &Connection, message_id: &str) -> Result<i64> {
    c.query_row(
        "SELECT COUNT(*) FROM messages WHERE thread_of=?1 AND archived=0",
        [message_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn reactions_for_impl(
    c: &Connection,
    message_id: &str,
    acting_profile_id: Option<&str>,
) -> Result<Vec<ReactionSummary>> {
    let mut s = c
        .prepare(
            "SELECT emoji, COUNT(*), SUM(profile_id IS ?2) FROM reactions WHERE message_id=?1 GROUP BY emoji ORDER BY emoji",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(rusqlite::params![message_id, acting_profile_id], |r| {
            let mine: i64 = r.get(2)?;
            Ok(ReactionSummary {
                emoji: r.get(0)?,
                count: r.get(1)?,
                mine: mine > 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
fn attachments_for_impl(c: &Connection, message_id: &str) -> Result<Vec<MessageAttachment>> {
    let mut statement = c.prepare("SELECT id,message_id,file_name,mime_type,byte_length,data_url FROM message_attachments WHERE message_id=?1 ORDER BY created_at,id").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([message_id], |r| {
            Ok(MessageAttachment {
                id: r.get(0)?,
                message_id: r.get(1)?,
                file_name: r.get(2)?,
                mime_type: r.get(3)?,
                byte_length: r.get(4)?,
                data_url: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())
}
fn to_view(c: &Connection, m: Message, acting_profile_id: Option<&str>) -> Result<MessageView> {
    let reply_count = reply_count_impl(c, &m.id)?;
    let reactions = reactions_for_impl(c, &m.id, acting_profile_id)?;
    let attachments = attachments_for_impl(c, &m.id)?;
    Ok(MessageView {
        message: m,
        reply_count,
        reactions,
        attachments,
    })
}
fn list_messages_impl(
    c: &Connection,
    channel_id: &str,
    acting_profile_id: Option<&str>,
) -> Result<Vec<MessageView>> {
    let allowed = channel_allows_actor(c, channel_id, acting_profile_id)?;
    if !allowed {
        return Err("channel access denied".to_string());
    }
    let mut s = c
        .prepare(
            "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,content_kind FROM messages \
             WHERE channel_id=?1 AND thread_of IS NULL AND archived=0 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let msgs: Vec<Message> = s
        .query_map([channel_id], message_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    msgs.into_iter()
        .map(|m| to_view(c, m, acting_profile_id))
        .collect()
}
fn list_thread_replies_impl(
    c: &Connection,
    thread_of: &str,
    acting_profile_id: Option<&str>,
) -> Result<Vec<MessageView>> {
    let channel_id: String = c
        .query_row(
            "SELECT channel_id FROM messages WHERE id=?1",
            [thread_of],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let allowed = channel_allows_actor(c, &channel_id, acting_profile_id)?;
    if !allowed {
        return Err("channel access denied".to_string());
    }
    let mut s = c
        .prepare(
            "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,content_kind FROM messages \
             WHERE thread_of=?1 AND archived=0 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let msgs: Vec<Message> = s
        .query_map([thread_of], message_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    msgs.into_iter()
        .map(|m| to_view(c, m, acting_profile_id))
        .collect()
}
fn create_message_impl(c: &Connection, message: &Message) -> Result<()> {
    let allowed = message
        .author_id
        .as_deref()
        .map(|profile_id| channel_allows_profile(c, &message.channel_id, profile_id))
        .transpose()?
        .unwrap_or(false);
    if !allowed {
        return Err("channel access denied".to_string());
    }
    c.execute(
        "INSERT INTO messages(id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,content_kind)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        rusqlite::params![message.id, message.channel_id, message.author_id, message.text, message.created_at, message.edited_at, message.thread_of, message.archived, message.content_kind],
    )
    .map_err(|e| e.to_string())?;
    for profile_id in &message.mention_ids {
        if message.author_id.as_deref() == Some(profile_id.as_str()) {
            continue;
        }
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1)",
                [profile_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            continue;
        }
        c.execute(
            "INSERT OR IGNORE INTO message_mentions(message_id,profile_id) VALUES(?1,?2)",
            rusqlite::params![message.id, profile_id],
        )
        .map_err(|e| e.to_string())?;
        c.execute("INSERT OR IGNORE INTO notifications(id,recipient_id,event_type,title,body,entity_type,entity_id) VALUES(?1,?2,'chat.mention','You were mentioned',?3,'message',?4)", rusqlite::params![format!("mention:{}:{}", message.id, profile_id), profile_id, message.text, message.id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn update_message_impl(c: &Connection, id: &str, text: &str) -> Result<()> {
    c.execute(
        "UPDATE messages SET text=?2,edited_at=unixepoch() WHERE id=?1",
        rusqlite::params![id, text],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn delete_message_impl(c: &Connection, id: &str) -> Result<()> {
    c.execute(
        "UPDATE messages SET archived=1 WHERE id=?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn get_message_impl(c: &Connection, id: &str) -> Result<Option<Message>> {
    c.query_row(
        "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,content_kind FROM messages WHERE id=?1",
        [id],
        message_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}
fn add_reaction_impl(
    c: &Connection,
    message_id: &str,
    profile_id: &str,
    emoji: &str,
) -> Result<()> {
    c.execute(
        "INSERT OR IGNORE INTO reactions(message_id,profile_id,emoji) VALUES(?1,?2,?3)",
        rusqlite::params![message_id, profile_id, emoji],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn remove_reaction_impl(
    c: &Connection,
    message_id: &str,
    profile_id: &str,
    emoji: &str,
) -> Result<()> {
    c.execute(
        "DELETE FROM reactions WHERE message_id=?1 AND profile_id=?2 AND emoji=?3",
        rusqlite::params![message_id, profile_id, emoji],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn mark_channel_read_impl(
    c: &Connection,
    channel_id: &str,
    profile_id: &str,
    message_id: Option<String>,
) -> Result<()> {
    let resolved = match message_id {
        Some(m) => Some(m),
        None => c
            .query_row(
                "SELECT id FROM messages WHERE channel_id=?1 AND archived=0 ORDER BY created_at DESC LIMIT 1",
                [channel_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?,
    };
    c.execute(
        "INSERT INTO read_state(channel_id,profile_id,message_id,read_at) VALUES(?1,?2,?3,unixepoch()) \
         ON CONFLICT(channel_id,profile_id) DO UPDATE SET message_id=excluded.message_id, read_at=excluded.read_at",
        rusqlite::params![channel_id, profile_id, resolved],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Tauri command surface (thin wrappers over the _impl functions above, which
// are exercised directly in tests against an in-memory/temp-file connection). ----

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channels() -> Result<Vec<Channel>> {
    list_channels_impl(&db::conn()?)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_channel(id: String) -> Result<Option<Channel>> {
    get_channel_impl(&db::conn()?, &id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channels_with_meta(profile_id: String) -> Result<Vec<ChannelSummary>> {
    list_channels_with_meta_impl(&db::conn()?, &profile_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_channel(channel: Channel, member_ids: Vec<String>) -> Result<Channel> {
    let c = db::conn()?;
    create_channel_impl(&c, &channel, &member_ids)?;
    Ok(channel)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_channel(channel: Channel) -> Result<()> {
    let c = db::conn()?;
    c.execute("UPDATE channels SET content_type=?2,name=?3,description=?4,project_id=?5,archived=?6 WHERE id=?1",rusqlite::params![channel.id,channel.content_type,channel.name,channel.description,channel.project_id,channel.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn join_channel(channel_id: String, profile_id: String) -> Result<()> {
    add_channel_member_impl(&db::conn()?, &channel_id, &profile_id, false)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn leave_channel(channel_id: String, profile_id: String) -> Result<()> {
    remove_channel_member_impl(&db::conn()?, &channel_id, &profile_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_channel_member(
    channel_id: String,
    profile_id: String,
    administrator: bool,
) -> Result<()> {
    add_channel_member_impl(&db::conn()?, &channel_id, &profile_id, administrator)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_channel_member(channel_id: String, profile_id: String) -> Result<()> {
    remove_channel_member_impl(&db::conn()?, &channel_id, &profile_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channel_members(channel_id: String) -> Result<Vec<ChannelMember>> {
    list_channel_members_impl(&db::conn()?, &channel_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_entity_channel(
    entity_type: String,
    entity_id: String,
    name: Option<String>,
) -> Result<Channel> {
    create_entity_channel_impl(&db::conn()?, &entity_type, &entity_id, name)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_channel_by_entity(entity_type: String, entity_id: String) -> Result<Option<Channel>> {
    get_channel_impl(&db::conn()?, &entity_channel_id(&entity_type, &entity_id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_messages(
    channel_id: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<MessageView>> {
    list_messages_impl(&db::conn()?, &channel_id, acting_profile_id.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_thread_replies(
    thread_of: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<MessageView>> {
    list_thread_replies_impl(&db::conn()?, &thread_of, acting_profile_id.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_message(message: Message) -> Result<MessageView> {
    let c = db::conn()?;
    create_message_impl(&c, &message)?;
    to_view(&c, message, None)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_message_attachment(
    message_id: String,
    attachment: NewMessageAttachment,
) -> Result<MessageAttachment> {
    if !attachment.data_url.starts_with("data:")
        || !(0..=10 * 1024 * 1024).contains(&attachment.byte_length)
    {
        return Err("invalid attachment".into());
    }
    let c = db::conn()?;
    c.execute("INSERT INTO message_attachments(id,message_id,file_name,mime_type,byte_length,data_url) VALUES(?1,?2,?3,?4,?5,?6)", rusqlite::params![attachment.id, message_id, attachment.file_name, attachment.mime_type, attachment.byte_length, attachment.data_url]).map_err(|e| e.to_string())?;
    attachments_for_impl(&c, &message_id)?
        .into_iter()
        .find(|item| item.id == attachment.id)
        .ok_or_else(|| "attachment missing".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_message(id: String, text: String) -> Result<MessageView> {
    let c = db::conn()?;
    update_message_impl(&c, &id, &text)?;
    let m = get_message_impl(&c, &id)?.ok_or_else(|| "message not found".to_string())?;
    to_view(&c, m, None)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_message(id: String) -> Result<()> {
    delete_message_impl(&db::conn()?, &id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_reaction(
    message_id: String,
    profile_id: String,
    emoji: String,
) -> Result<Vec<ReactionSummary>> {
    let c = db::conn()?;
    add_reaction_impl(&c, &message_id, &profile_id, &emoji)?;
    reactions_for_impl(&c, &message_id, Some(&profile_id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_reaction(
    message_id: String,
    profile_id: String,
    emoji: String,
) -> Result<Vec<ReactionSummary>> {
    let c = db::conn()?;
    remove_reaction_impl(&c, &message_id, &profile_id, &emoji)?;
    reactions_for_impl(&c, &message_id, Some(&profile_id))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn mark_channel_read(
    channel_id: String,
    profile_id: String,
    message_id: Option<String>,
) -> Result<()> {
    mark_channel_read_impl(&db::conn()?, &channel_id, &profile_id, message_id)
}
// TODO: capability-specific content, scheduled delivery, mentions, pinning and notification policies.

#[cfg(test)]
mod tests {
    use super::*;

    /// The path is reserved by an atomic `create_dir` inside `TempDb`, so no other
    /// process or thread can hold the same database, and cleanup touches only our own
    /// directory (never another process's live file).
    fn conn() -> (Connection, db::TempDb) {
        let temp = db::TempDb::new("gaia-space-chat-test");
        let c = db::migrate_path(&temp).expect("migration");
        (c, temp)
    }

    fn seed_channel(c: &Connection, id: &str) {
        create_channel_impl(
            c,
            &Channel {
                id: id.to_string(),
                content_type: "public".to_string(),
                name: Some("General".to_string()),
                description: None,
                project_id: None,
                archived: false,
            },
            &["default-org".to_string()],
        )
        .unwrap();
    }

    #[test]
    fn thread_roundtrip() {
        let (c, path) = conn();
        seed_channel(&c, "chan-thread");
        let root = Message {
            id: "msg-root".into(),
            channel_id: "chan-thread".into(),
            author_id: Some("default-org".into()),
            text: "root message".into(),
            created_at: 100,
            edited_at: None,
            thread_of: None,
            archived: false,
            content_kind: "text".into(),
            mention_ids: Vec::new(),
        };
        create_message_impl(&c, &root).unwrap();
        let reply = Message {
            id: "msg-reply".into(),
            channel_id: "chan-thread".into(),
            author_id: Some("default-org".into()),
            text: "reply message".into(),
            created_at: 200,
            edited_at: None,
            thread_of: Some("msg-root".into()),
            archived: false,
            content_kind: "text".into(),
            mention_ids: Vec::new(),
        };
        create_message_impl(&c, &reply).unwrap();

        let roots = list_messages_impl(&c, "chan-thread", None).unwrap();
        assert_eq!(roots.len(), 1, "only the root shows in the channel pane");
        assert_eq!(
            roots[0].reply_count, 1,
            "root carries the reply badge count"
        );

        let replies = list_thread_replies_impl(&c, "msg-root", None).unwrap();
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].message.text, "reply message");
        assert_eq!(replies[0].message.thread_of.as_deref(), Some("msg-root"));
        drop(c);
        drop(path);
    }

    #[test]
    fn reaction_add_and_remove() {
        let (c, path) = conn();
        seed_channel(&c, "chan-react");
        create_message_impl(
            &c,
            &Message {
                id: "msg-react".into(),
                channel_id: "chan-react".into(),
                author_id: Some("default-org".into()),
                text: "react to me".into(),
                created_at: 100,
                edited_at: None,
                thread_of: None,
                archived: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
            },
        )
        .unwrap();

        add_reaction_impl(&c, "msg-react", "default-org", "\u{1F44D}").unwrap();
        let after_add = reactions_for_impl(&c, "msg-react", Some("default-org")).unwrap();
        assert_eq!(after_add.len(), 1);
        assert_eq!(after_add[0].count, 1);
        assert!(after_add[0].mine);

        remove_reaction_impl(&c, "msg-react", "default-org", "\u{1F44D}").unwrap();
        let after_remove = reactions_for_impl(&c, "msg-react", Some("default-org")).unwrap();
        assert!(after_remove.is_empty(), "reaction fully removed");
        drop(c);
        drop(path);
    }

    #[test]
    fn unread_count_after_send_and_mark_read() {
        let (c, path) = conn();
        seed_channel(&c, "chan-unread");
        create_message_impl(
            &c,
            &Message {
                id: "msg-unread".into(),
                channel_id: "chan-unread".into(),
                author_id: Some("default-org".into()),
                text: "hello".into(),
                created_at: 100,
                edited_at: None,
                thread_of: None,
                archived: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
            },
        )
        .unwrap();

        let before = list_channels_with_meta_impl(&c, "default-org").unwrap();
        let summary = before
            .iter()
            .find(|s| s.channel.id == "chan-unread")
            .unwrap();
        assert_eq!(
            summary.unread_count, 1,
            "unread before any read-state exists"
        );

        mark_channel_read_impl(&c, "chan-unread", "default-org", None).unwrap();
        let after = list_channels_with_meta_impl(&c, "default-org").unwrap();
        let summary = after
            .iter()
            .find(|s| s.channel.id == "chan-unread")
            .unwrap();
        assert_eq!(
            summary.unread_count, 0,
            "read-state clears the unread badge"
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn direct_channels_are_visible_only_to_members() {
        let (c, path) = conn();
        for (id, username) in [("other", "other-user"), ("stranger", "stranger-user")] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?2,unixepoch())",
                rusqlite::params![id, username],
            ).unwrap();
        }
        create_channel_impl(
            &c,
            &Channel {
                id: "dm-private".into(),
                content_type: "dm".into(),
                name: Some("Direct".into()),
                description: None,
                project_id: None,
                archived: false,
            },
            &["default-org".into(), "other".into()],
        )
        .unwrap();
        assert!(list_channels_with_meta_impl(&c, "default-org")
            .unwrap()
            .iter()
            .any(|x| x.channel.id == "dm-private"));
        assert!(list_channels_with_meta_impl(&c, "other")
            .unwrap()
            .iter()
            .any(|x| x.channel.id == "dm-private"));
        assert!(!list_channels_with_meta_impl(&c, "stranger")
            .unwrap()
            .iter()
            .any(|x| x.channel.id == "dm-private"));
        assert!(list_messages_impl(&c, "dm-private", Some("stranger")).is_err());
        assert!(create_message_impl(
            &c,
            &Message {
                id: "intrusion".into(),
                channel_id: "dm-private".into(),
                author_id: Some("stranger".into()),
                text: "nope".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
            }
        )
        .is_err());
        let members = list_channel_members_impl(&c, "dm-private").unwrap();
        assert!(members
            .iter()
            .any(|m| m.profile_id == "default-org" && m.administrator));
        drop(c);
        drop(path);
    }

    #[test]
    fn entity_channel_is_idempotent_and_generic() {
        let (c, path) = conn();
        let created =
            create_entity_channel_impl(&c, "issue", "issue-42", Some("Issue #42".into())).unwrap();
        assert_eq!(created.content_type, "entity-bound");
        assert_eq!(created.id, "entity:issue:issue-42");

        // calling again for the same entity must not fail and must resolve to the same row
        let again =
            create_entity_channel_impl(&c, "issue", "issue-42", Some("Issue #42".into())).unwrap();
        assert_eq!(again.id, created.id);

        let fetched = get_channel_impl(&c, &entity_channel_id("issue", "issue-42")).unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().name.as_deref(), Some("Issue #42"));
        drop(c);
        drop(path);
    }
}
