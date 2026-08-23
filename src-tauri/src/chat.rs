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
    #[serde(default)]
    pub mention_ids: Vec<String>,
}
/// Upload lifecycle of an attachment row (KB §04: LoadingAttachment /
/// AttachmentIsUploading / AttachmentUploadCompleted / AttachmentUploadFailed).
/// Stored as text so a reload can tell a finished attachment from a stalled one.
pub const ATTACHMENT_STATES: [&str; 4] = ["loading", "uploading", "completed", "failed"];
pub const MAX_ATTACHMENT_BYTES: i64 = 10 * 1024 * 1024;

fn validate_attachment_state(state: &str) -> Result<()> {
    if ATTACHMENT_STATES.contains(&state) {
        Ok(())
    } else {
        Err(format!("invalid attachment state: {state}"))
    }
}

/// The declared `byte_length` is a client claim; the payload is the fact. Decode the
/// data URL and measure it, so `{byte_length: 0, data_url: <10MB>}` cannot slip past
/// the size gate. Returns the measured length.
pub fn measure_data_url(data_url: &str, declared: i64) -> Result<i64> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| "invalid attachment: not a data URL".to_string())?;
    let comma = rest
        .find(',')
        .ok_or_else(|| "invalid attachment: data URL has no payload".to_string())?;
    let (meta, payload) = rest.split_at(comma);
    let payload = &payload[1..];
    let measured: i64 = if meta.ends_with(";base64") {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|_| "invalid attachment: bad base64 payload".to_string())?
            .len() as i64
    } else {
        // percent-encoded text payload: octets after decoding %XX escapes.
        let bytes = payload.as_bytes();
        let mut n = 0i64;
        let mut i = 0usize;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                if i + 2 >= bytes.len() || !bytes[i + 1..i + 3].iter().all(u8::is_ascii_hexdigit) {
                    return Err("invalid attachment: bad percent escape".into());
                }
                i += 3;
            } else {
                i += 1;
            }
            n += 1;
        }
        n
    };
    if measured > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "attachment too large: {measured} bytes exceeds {MAX_ATTACHMENT_BYTES}"
        ));
    }
    if measured != declared {
        return Err(format!(
            "attachment size mismatch: declared {declared}, measured {measured}"
        ));
    }
    Ok(measured)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageAttachment {
    pub id: String,
    pub message_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_length: i64,
    pub data_url: String,
    pub upload_state: String,
    pub error: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct NewMessageAttachment {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_length: i64,
    pub data_url: String,
    #[serde(default)]
    pub upload_state: Option<String>,
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
    let mut statement = c.prepare("SELECT id,message_id,file_name,mime_type,byte_length,data_url,upload_state,error FROM message_attachments WHERE message_id=?1 ORDER BY created_at,id").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([message_id], |r| {
            Ok(MessageAttachment {
                id: r.get(0)?,
                message_id: r.get(1)?,
                file_name: r.get(2)?,
                mime_type: r.get(3)?,
                byte_length: r.get(4)?,
                data_url: r.get(5)?,
                upload_state: r.get(6)?,
                error: r.get(7)?,
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
            "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived FROM messages \
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
            "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived FROM messages \
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
        "INSERT INTO messages(id,channel_id,author_id,text,created_at,edited_at,thread_of,archived)VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![message.id, message.channel_id, message.author_id, message.text, message.created_at, message.edited_at, message.thread_of, message.archived],
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
        "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived FROM messages WHERE id=?1",
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
fn add_message_attachment_impl(
    c: &Connection,
    message_id: &str,
    attachment: NewMessageAttachment,
) -> Result<MessageAttachment> {
    if attachment.byte_length < 0 {
        return Err("invalid attachment: negative length".into());
    }
    measure_data_url(&attachment.data_url, attachment.byte_length)?;
    let state = attachment.upload_state.as_deref().unwrap_or("completed");
    validate_attachment_state(state)?;
    c.execute("INSERT INTO message_attachments(id,message_id,file_name,mime_type,byte_length,data_url,upload_state,error) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL)", rusqlite::params![attachment.id, message_id, attachment.file_name, attachment.mime_type, attachment.byte_length, attachment.data_url, state]).map_err(|e| e.to_string())?;
    attachments_for_impl(c, message_id)?
        .into_iter()
        .find(|item| item.id == attachment.id)
        .ok_or_else(|| "attachment missing".into())
}

fn set_message_attachment_state_impl(
    c: &Connection,
    id: &str,
    state: &str,
    error: Option<&str>,
) -> Result<MessageAttachment> {
    validate_attachment_state(state)?;
    // An error string only carries meaning on a failed upload; clearing it on any other
    // transition keeps a retried attachment from displaying its previous failure.
    let error = if state == "failed" { error } else { None };
    let changed = c
        .execute(
            "UPDATE message_attachments SET upload_state=?2, error=?3 WHERE id=?1",
            rusqlite::params![id, state, error],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("attachment not found".into());
    }
    let message_id: String = c
        .query_row(
            "SELECT message_id FROM message_attachments WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    attachments_for_impl(c, &message_id)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "attachment missing".into())
}

fn remove_message_attachment_impl(c: &Connection, id: &str) -> Result<()> {
    let changed = c
        .execute("DELETE FROM message_attachments WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("attachment not found".into());
    }
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_message_attachment(
    message_id: String,
    attachment: NewMessageAttachment,
) -> Result<MessageAttachment> {
    add_message_attachment_impl(&db::conn()?, &message_id, attachment)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_message_attachment_state(
    id: String,
    state: String,
    error: Option<String>,
) -> Result<MessageAttachment> {
    set_message_attachment_state_impl(&db::conn()?, &id, &state, error.as_deref())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_message_attachment(id: String) -> Result<()> {
    remove_message_attachment_impl(&db::conn()?, &id)
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

    fn seed_message(c: &Connection, channel: &str, id: &str) {
        seed_channel(c, channel);
        create_message_impl(
            c,
            &Message {
                id: id.into(),
                channel_id: channel.into(),
                author_id: Some("default-org".into()),
                text: "with files".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                mention_ids: Vec::new(),
            },
        )
        .unwrap();
    }

    fn new_attachment(id: &str, data_url: &str, byte_length: i64, state: Option<&str>) -> NewMessageAttachment {
        NewMessageAttachment {
            id: id.into(),
            file_name: "f.txt".into(),
            mime_type: "text/plain".into(),
            byte_length,
            data_url: data_url.into(),
            upload_state: state.map(str::to_string),
        }
    }

    #[test]
    fn attachment_lifecycle_states_roundtrip() {
        let (c, path) = conn();
        seed_message(&c, "chan-att", "msg-att");
        let stored = add_message_attachment_impl(
            &c,
            "msg-att",
            new_attachment("att-1", "data:text/plain;base64,aGk=", 2, Some("uploading")),
        )
        .unwrap();
        assert_eq!(stored.upload_state, "uploading");
        assert!(stored.error.is_none());

        let failed =
            set_message_attachment_state_impl(&c, "att-1", "failed", Some("network down")).unwrap();
        assert_eq!(failed.upload_state, "failed");
        assert_eq!(failed.error.as_deref(), Some("network down"));

        // a retry clears the stale failure text, so the UI cannot show a cured error
        let retried = set_message_attachment_state_impl(&c, "att-1", "completed", None).unwrap();
        assert_eq!(retried.upload_state, "completed");
        assert!(retried.error.is_none());
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_defaults_to_completed_and_rejects_unknown_state() {
        let (c, path) = conn();
        seed_message(&c, "chan-att2", "msg-att2");
        let stored =
            add_message_attachment_impl(&c, "msg-att2", new_attachment("att-2", "data:,hi", 2, None))
                .unwrap();
        assert_eq!(stored.upload_state, "completed");
        assert!(add_message_attachment_impl(
            &c,
            "msg-att2",
            new_attachment("att-3", "data:,hi", 2, Some("teleporting"))
        )
        .is_err());
        assert!(set_message_attachment_state_impl(&c, "att-2", "teleporting", None).is_err());
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_size_is_measured_not_trusted() {
        let (c, path) = conn();
        seed_message(&c, "chan-att3", "msg-att3");
        use base64::Engine as _;
        let big = base64::engine::general_purpose::STANDARD.encode(vec![0u8; 11 * 1024 * 1024]);
        let url = format!("data:application/octet-stream;base64,{big}");
        // the historic hole: a zero declared length carrying an oversized payload
        let err = add_message_attachment_impl(&c, "msg-att3", new_attachment("att-big", &url, 0, None))
            .unwrap_err();
        assert!(err.contains("too large"), "{err}");
        // an honest-looking but wrong declaration is refused too
        let err = add_message_attachment_impl(
            &c,
            "msg-att3",
            new_attachment("att-lie", "data:text/plain;base64,aGk=", 999, None),
        )
        .unwrap_err();
        assert!(err.contains("mismatch"), "{err}");
        assert!(
            add_message_attachment_impl(&c, "msg-att3", new_attachment("att-nourl", "hi", 2, None))
                .is_err()
        );
        assert!(attachments_for_impl(&c, "msg-att3").unwrap().is_empty());
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_removal_is_scoped_and_reported() {
        let (c, path) = conn();
        seed_message(&c, "chan-att4", "msg-att4");
        add_message_attachment_impl(&c, "msg-att4", new_attachment("att-4", "data:,hi", 2, None))
            .unwrap();
        add_message_attachment_impl(&c, "msg-att4", new_attachment("att-5", "data:,hi", 2, None))
            .unwrap();
        remove_message_attachment_impl(&c, "att-4").unwrap();
        let left = attachments_for_impl(&c, "msg-att4").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "att-5");
        assert!(remove_message_attachment_impl(&c, "att-4").is_err());
        drop(c);
        drop(path);
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
