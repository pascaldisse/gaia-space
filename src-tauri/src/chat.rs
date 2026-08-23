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
    #[serde(default)]
    pub read_only: bool,
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
pub struct ChannelNotificationPreference {
    pub profile_id: String,
    pub channel_id: String,
    pub email_enabled: bool,
    pub push_enabled: bool,
    pub thread_scope: String,
}
fn read_notification_preference(
    r: &rusqlite::Row<'_>,
) -> rusqlite::Result<ChannelNotificationPreference> {
    Ok(ChannelNotificationPreference {
        profile_id: r.get(0)?,
        channel_id: r.get(1)?,
        email_enabled: r.get(2)?,
        push_enabled: r.get(3)?,
        thread_scope: r.get(4)?,
    })
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
    pub pinned: bool,
    #[serde(default = "default_message_content_kind")]
    pub content_kind: String,
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

/// Upload lifecycle is a one-way road: `loading -> uploading -> {completed|failed}`,
/// with `failed -> uploading` for a retry. A finished upload never walks backwards, so
/// a late/duplicated client message cannot reopen an attachment that already landed.
/// Same-state writes stay legal (idempotent retries of the same notification).
fn attachment_transition_sources(target: &str) -> Result<&'static [&'static str]> {
    match target {
        "loading" => Ok(&["loading"]),
        "uploading" => Ok(&["loading", "uploading", "failed"]),
        "completed" => Ok(&["uploading", "completed"]),
        "failed" => Ok(&["uploading", "failed"]),
        other => Err(format!("invalid attachment state: {other}")),
    }
}

/// Who may touch the attachments of a message: its author, an administrator of the
/// channel it lives in, or the global admin. Read membership alone is not enough —
/// attachments are message content, and content belongs to whoever wrote it.
/// The same rule governs add, state change and removal (including the removal that
/// an archived/soft-deleted message leaves behind: the rows are retained, so their
/// deletion stays under the author/channel-admin gate).
pub fn message_attachment_writable_by(
    message_id: &str,
    profile_id: &str,
    is_admin: bool,
) -> Result<bool> {
    message_attachment_writable_by_impl(&db::conn()?, message_id, profile_id, is_admin)
}

fn message_attachment_writable_by_impl(
    c: &Connection,
    message_id: &str,
    profile_id: &str,
    is_admin: bool,
) -> Result<bool> {
    if is_admin {
        return Ok(true);
    }
    let row: Option<(Option<String>, String)> = c
        .query_row(
            "SELECT author_id, channel_id FROM messages WHERE id=?1",
            [message_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((author_id, channel_id)) = row else {
        return Ok(false);
    };
    if author_id.as_deref() == Some(profile_id) {
        return Ok(true);
    }
    let channel_admin: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM channel_members WHERE channel_id=?1 AND profile_id=?2 AND administrator=1",
            rusqlite::params![channel_id, profile_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(channel_admin > 0)
}

/// The message an attachment row belongs to, for scoping an id-only request.
pub fn message_id_of_attachment(id: &str) -> Result<Option<String>> {
    db::conn()?
        .query_row(
            "SELECT message_id FROM message_attachments WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
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
    // Bound the *encoded* input before decoding: a 10 GiB base64 blob must be refused
    // by arithmetic on its length, never by allocating its decoded bytes first.
    let encoded_len = payload.len() as i64;
    let lower_bound = if meta.ends_with(";base64") {
        // 4 encoded chars -> at most 3 bytes, and never fewer than 3*(n/4 - 1).
        (encoded_len / 4).saturating_sub(1).saturating_mul(3)
    } else {
        // percent-decoding shrinks by at most 3x.
        encoded_len / 3
    };
    if lower_bound > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "attachment too large: encoded payload of {encoded_len} chars exceeds {MAX_ATTACHMENT_BYTES} bytes"
        ));
    }
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
        read_only: r.get(6)?,
    })
}
fn list_channels_impl(c: &Connection) -> Result<Vec<Channel>> {
    let mut s = c
        .prepare("SELECT id,content_type,name,description,project_id,archived,EXISTS(SELECT 1 FROM private_feeds pf WHERE pf.channel_id=channels.id) FROM channels ORDER BY name")
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
        "SELECT id,content_type,name,description,project_id,archived,EXISTS(SELECT 1 FROM private_feeds pf WHERE pf.channel_id=channels.id) FROM channels WHERE id=?1",
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
pub(crate) fn channel_readable_by(channel_id: &str, profile_id: &str) -> Result<bool> {
    channel_allows_profile(&db::conn()?, channel_id, profile_id)
}
pub(crate) fn channel_allows_profile(
    c: &Connection,
    channel_id: &str,
    profile_id: &str,
) -> Result<bool> {
    // Entity-bound meetings inherit the meeting's privacy predicate. Other entity
    // channels stay generic/public as before; this avoids exposing a private agenda
    // merely because its discussion is implemented by the shared channel primitive.
    if let Some(meeting_id) = channel_id.strip_prefix("entity:meeting:") {
        return crate::meetings::meeting_readable_on(c, meeting_id, profile_id);
    }
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
    // Meeting discussions retain their meeting visibility boundary even though
    // generic entity-bound channels are otherwise public.
    if channel_id.strip_prefix("entity:meeting:").is_some() {
        return profile_id
            .map(|profile_id| channel_allows_profile(c, channel_id, profile_id))
            .transpose()
            .map(|allowed| allowed.unwrap_or(false));
    }
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
/// Private feeds retain the normal private-channel ACL and add a durable owner map;
/// this avoids rebuilding the original `channels.content_type` constraint.
pub(crate) fn ensure_private_feed_on(c: &Connection, profile_id: &str) -> Result<Channel> {
    if profile_id.trim().is_empty() {
        return Err("Private feed profile is required".into());
    }
    if let Some(channel_id) = c
        .query_row(
            "SELECT channel_id FROM private_feeds WHERE profile_id=?1",
            [profile_id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return get_channel_impl(c, &channel_id)?
            .ok_or_else(|| "Private feed channel is missing".into());
    }
    let channel = Channel {
        id: format!("private-feed:{profile_id}"),
        content_type: "private".into(),
        name: Some("Private feed".into()),
        description: Some("Your read-only notification feed".into()),
        project_id: None,
        archived: false,
        read_only: true,
    };
    create_channel_impl(c, &channel, &[profile_id.to_string()])?;
    c.execute(
        "INSERT INTO private_feeds(profile_id,channel_id) VALUES(?1,?2)",
        rusqlite::params![profile_id, channel.id],
    )
    .map_err(|e| e.to_string())?;
    Ok(channel)
}
pub(crate) fn private_feed_for_on(c: &Connection, profile_id: &str) -> Result<Channel> {
    ensure_private_feed_on(c, profile_id)
}
fn is_read_only_channel_on(c: &Connection, channel_id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM private_feeds WHERE channel_id=?1)",
        [channel_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
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
    // A generic notifications view otherwise retains the private message body after exit.
    if !channel_allows_profile(c, channel_id, profile_id)? {
        c.execute(
            "DELETE FROM notifications WHERE recipient_id=?1 AND event_type='chat.mention' \
             AND entity_type='message' AND entity_id IN (SELECT id FROM messages WHERE channel_id=?2)",
            rusqlite::params![profile_id, channel_id],
        )
        .map_err(|e| e.to_string())?;
    }
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
pub(crate) fn create_entity_channel_impl(
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

fn default_message_content_kind() -> String {
    "text".into()
}
/// Durable system card for an absence lifecycle event. The entity-bound channel is
/// intentionally public like other entity discussions; sensitive reasons are never put in it.
pub(crate) fn post_absence_card_on(
    c: &Connection,
    absence_id: &str,
    profile_id: &str,
    date_from: &str,
    date_to: &str,
    availability: &str,
    action: &str,
) -> Result<()> {
    let channel = create_entity_channel_impl(
        c,
        "absence",
        absence_id,
        Some(format!("Time off · {profile_id}")),
    )?;
    let id = format!(
        "absence-card:{absence_id}:{action}:{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
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
        pinned: r.get(8)?,
        content_kind: r.get(9)?,
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
/// Mentions are message content, so a view of a message carries them: the stored
/// `message_mentions` rows are the fact, not the `@name` spelling inside the text
/// (a display name can change without rewriting every message that named it).
fn mentions_for_impl(c: &Connection, message_id: &str) -> Result<Vec<String>> {
    let mut s = c
        .prepare("SELECT profile_id FROM message_mentions WHERE message_id=?1 ORDER BY profile_id")
        .map_err(|e| e.to_string())?;
    let ids = s
        .query_map([message_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

fn to_view(c: &Connection, m: Message, acting_profile_id: Option<&str>) -> Result<MessageView> {
    let reply_count = reply_count_impl(c, &m.id)?;
    let reactions = reactions_for_impl(c, &m.id, acting_profile_id)?;
    let attachments = attachments_for_impl(c, &m.id)?;
    let mut m = m;
    m.mention_ids = mentions_for_impl(c, &m.id)?;
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
            "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,pinned,content_kind FROM messages \
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
/// Pinned roots are a channel-level index: archived messages never surface and newest pins
/// lead, while the stable id makes equally-timed imports deterministic.
fn list_pinned_messages_impl(
    c: &Connection,
    channel_id: &str,
    acting_profile_id: Option<&str>,
) -> Result<Vec<MessageView>> {
    if !channel_allows_actor(c, channel_id, acting_profile_id)? {
        return Err("channel access denied".into());
    }
    let mut s = c.prepare("SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,pinned,content_kind FROM messages WHERE channel_id=?1 AND thread_of IS NULL AND archived=0 AND pinned=1 ORDER BY created_at DESC,id DESC").map_err(|e| e.to_string())?;
    let messages = s
        .query_map([channel_id], message_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    messages
        .into_iter()
        .map(|m| to_view(c, m, acting_profile_id))
        .collect()
}

/// Pinning is idempotent; a caller may retry a lost response without changing history.
fn set_message_pinned_impl(c: &Connection, id: &str, pinned: bool) -> Result<MessageView> {
    let changed = c
        .execute(
            "UPDATE messages SET pinned=?2 WHERE id=?1 AND archived=0",
            rusqlite::params![id, pinned],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("message not found or archived".into());
    }
    let message = get_message_impl(c, id)?.ok_or_else(|| "message not found".to_string())?;
    to_view(c, message, None)
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
            "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,pinned,content_kind FROM messages \
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
const MAX_MENTION_TARGETS: usize = 100;

fn validate_mention_count(mention_ids: &[String]) -> Result<()> {
    if mention_ids.len() > MAX_MENTION_TARGETS {
        return Err(format!(
            "at most {MAX_MENTION_TARGETS} mention targets are allowed"
        ));
    }
    Ok(())
}

fn create_message_impl(c: &Connection, message: &Message) -> Result<()> {
    validate_mention_count(&message.mention_ids)?;
    if is_read_only_channel_on(c, &message.channel_id)? {
        return Err("Private feeds are read-only".into());
    }
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
        "INSERT INTO messages(id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,pinned,content_kind)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        rusqlite::params![message.id, message.channel_id, message.author_id, message.text, message.created_at, message.edited_at, message.thread_of, message.archived, message.pinned, message.content_kind],
    )
    .map_err(|e| e.to_string())?;
    sync_mentions_impl(
        c,
        &message.id,
        &message.channel_id,
        message.author_id.as_deref(),
        &message.text,
        &message.mention_ids,
    )?;
    crate::channel_feeds::route_message_on(
        c,
        &message.channel_id,
        message.author_id.as_deref(),
        &message.text,
    )?;
    Ok(())
}

/// A mention target must be a real profile that may actually read the channel, and it
/// is never the author naming themselves. Filtering here rather than at the UI keeps a
/// hand-written command from notifying someone about a private channel they cannot open.
fn mention_target_allowed(
    c: &Connection,
    channel_id: &str,
    author_id: Option<&str>,
    profile_id: &str,
) -> Result<bool> {
    if author_id == Some(profile_id) {
        return Ok(false);
    }
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1)",
            [profile_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(false);
    }
    channel_allows_profile(c, channel_id, profile_id)
}

/// Set the mention rows of a message to exactly `mention_ids` (an edit is a diff, not an
/// append): dropped targets lose both their row and their unread mention notification,
/// added targets get both. A target that survives the edit keeps its existing
/// notification, read or unread — re-notifying someone for a typo fix would be noise.
fn sync_mentions_impl(
    c: &Connection,
    message_id: &str,
    channel_id: &str,
    author_id: Option<&str>,
    text: &str,
    mention_ids: &[String],
) -> Result<()> {
    let mut wanted: Vec<String> = Vec::new();
    for profile_id in mention_ids {
        if wanted.iter().any(|id| id == profile_id) {
            continue;
        }
        if mention_target_allowed(c, channel_id, author_id, profile_id)? {
            wanted.push(profile_id.clone());
        }
    }
    let existing = mentions_for_impl(c, message_id)?;
    for stale in existing.iter().filter(|id| !wanted.contains(id)) {
        c.execute(
            "DELETE FROM message_mentions WHERE message_id=?1 AND profile_id=?2",
            rusqlite::params![message_id, stale],
        )
        .map_err(|e| e.to_string())?;
        // The mention is gone, so its unread alert must go too; an already-read
        // notification is history and stays.
        c.execute(
            "DELETE FROM notifications WHERE id=?1 AND read_at IS NULL",
            [format!("mention:{message_id}:{stale}")],
        )
        .map_err(|e| e.to_string())?;
    }
    for profile_id in wanted.iter().filter(|id| !existing.contains(id)) {
        c.execute(
            "INSERT OR IGNORE INTO message_mentions(message_id,profile_id) VALUES(?1,?2)",
            rusqlite::params![message_id, profile_id],
        )
        .map_err(|e| e.to_string())?;
        c.execute("INSERT OR IGNORE INTO notifications(id,recipient_id,event_type,title,body,entity_type,entity_id) VALUES(?1,?2,'chat.mention','You were mentioned',?3,'message',?4)", rusqlite::params![format!("mention:{message_id}:{profile_id}"), profile_id, text, message_id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn update_message_impl(
    c: &Connection,
    id: &str,
    text: &str,
    mention_ids: Option<&[String]>,
) -> Result<()> {
    if let Some(mention_ids) = mention_ids {
        validate_mention_count(mention_ids)?;
    }
    let changed = c
        .execute(
            "UPDATE messages SET text=?2,edited_at=unixepoch() WHERE id=?1",
            rusqlite::params![id, text],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("message not found".to_string());
    }
    // Omitting `mention_ids` leaves the mentions untouched: an old client that only
    // knows how to edit text must not silently strip everyone off the message.
    if let Some(mention_ids) = mention_ids {
        let message = get_message_impl(c, id)?.ok_or_else(|| "message not found".to_string())?;
        sync_mentions_impl(
            c,
            id,
            &message.channel_id,
            message.author_id.as_deref(),
            text,
            mention_ids,
        )?;
    }
    Ok(())
}

/// One mention as its recipient sees it: the message, where it was said, and whether the
/// alert is still unread (KB §04 `MentionsFolderVM` / `getTotalUnreadMentions`).
#[derive(Debug, Serialize, Deserialize)]
pub struct MentionView {
    #[serde(flatten)]
    pub message: MessageView,
    pub channel_name: Option<String>,
    pub notification_id: String,
    pub read: bool,
}

fn list_mentions_for_profile_impl(
    c: &Connection,
    profile_id: &str,
    unread_only: bool,
) -> Result<Vec<MentionView>> {
    let mut s = c
        .prepare(
            "SELECT m.id,m.channel_id,m.author_id,m.text,m.created_at,m.edited_at,m.thread_of,m.archived,m.pinned,m.content_kind \
             FROM message_mentions mm JOIN messages m ON m.id=mm.message_id \
             WHERE mm.profile_id=?1 AND m.archived=0 ORDER BY m.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let msgs: Vec<Message> = s
        .query_map([profile_id], message_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for m in msgs {
        // Access is re-checked at read time: leaving a private channel must hide its
        // mentions, even though the mention row survives for the message's own history.
        if !channel_allows_profile(c, &m.channel_id, profile_id)? {
            continue;
        }
        let notification_id = format!("mention:{}:{}", m.id, profile_id);
        let read_at: Option<Option<i64>> = c
            .query_row(
                "SELECT read_at FROM notifications WHERE id=?1",
                [&notification_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let read = matches!(read_at, Some(Some(_)));
        if unread_only && read {
            continue;
        }
        let channel_name: Option<String> = c
            .query_row(
                "SELECT name FROM channels WHERE id=?1",
                [&m.channel_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        out.push(MentionView {
            message: to_view(c, m, Some(profile_id))?,
            channel_name,
            notification_id,
            read,
        });
    }
    Ok(out)
}

fn count_unread_mentions_impl(c: &Connection, profile_id: &str) -> Result<i64> {
    Ok(list_mentions_for_profile_impl(c, profile_id, true)?.len() as i64)
}
/// Deletion is soft, and attachments are retained on purpose: the message can be
/// restored with its files, and the record of what was posted survives the hiding of
/// the post. A payload leaves only through an explicit `remove_message_attachment`,
/// which answers to the same author/channel-admin gate as every other attachment write
/// (see `message_attachment_writable_by`) — archiving a message must never become a
/// side door for stripping files off it. Documented in
/// docs/space-knowledge-base/04-collaboration.md.
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
        "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,pinned,content_kind FROM messages WHERE id=?1",
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
pub fn private_feed(profile_id: String) -> Result<Channel> {
    ensure_private_feed_on(&db::conn()?, &profile_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_channel_notification_preference(
    profile_id: String,
    channel_id: String,
) -> Result<ChannelNotificationPreference> {
    let c = db::conn()?;
    let row=c.query_row("SELECT profile_id,channel_id,email_enabled,push_enabled,thread_scope FROM channel_notification_preferences WHERE profile_id=?1 AND channel_id=?2", rusqlite::params![&profile_id,&channel_id], read_notification_preference).optional().map_err(|e|e.to_string())?;
    Ok(row.unwrap_or(ChannelNotificationPreference {
        profile_id,
        channel_id,
        email_enabled: true,
        push_enabled: true,
        thread_scope: "all".into(),
    }))
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_channel_notification_preference(
    preference: ChannelNotificationPreference,
) -> Result<ChannelNotificationPreference> {
    if preference.profile_id.trim().is_empty() || preference.channel_id.trim().is_empty() {
        return Err("Channel preference needs a profile and channel".into());
    }
    if !matches!(
        preference.thread_scope.as_str(),
        "all" | "followed" | "none"
    ) {
        return Err("Thread scope must be all, followed, or none".into());
    }
    let c = db::conn()?;
    if !channel_allows_profile(&c, &preference.channel_id, &preference.profile_id)? {
        return Err("channel access denied".into());
    }
    c.execute("INSERT INTO channel_notification_preferences(profile_id,channel_id,email_enabled,push_enabled,thread_scope) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id,channel_id) DO UPDATE SET email_enabled=excluded.email_enabled,push_enabled=excluded.push_enabled,thread_scope=excluded.thread_scope", rusqlite::params![preference.profile_id,preference.channel_id,preference.email_enabled,preference.push_enabled,preference.thread_scope]).map_err(|e|e.to_string())?;
    Ok(preference)
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
pub fn list_pinned_messages(
    channel_id: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<MessageView>> {
    list_pinned_messages_impl(&db::conn()?, &channel_id, acting_profile_id.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_message_pinned(id: String, pinned: bool) -> Result<MessageView> {
    set_message_pinned_impl(&db::conn()?, &id, pinned)
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
    // Idempotent add: a retried upload of the identical payload returns the stored row
    // instead of a UNIQUE violation, so a client that lost the answer can repeat itself.
    // A different payload under the same id is a real conflict and stays an error.
    if let Some(existing) = attachment_by_id_impl(c, &attachment.id)? {
        let same = existing.message_id == message_id
            && existing.file_name == attachment.file_name
            && existing.mime_type == attachment.mime_type
            && existing.byte_length == attachment.byte_length
            && existing.data_url == attachment.data_url;
        return if same {
            Ok(existing)
        } else {
            Err(format!(
                "attachment id conflict: {} already stores a different payload",
                attachment.id
            ))
        };
    }
    c.execute("INSERT INTO message_attachments(id,message_id,file_name,mime_type,byte_length,data_url,upload_state,error) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL)", rusqlite::params![attachment.id, message_id, attachment.file_name, attachment.mime_type, attachment.byte_length, attachment.data_url, state]).map_err(|e| e.to_string())?;
    attachments_for_impl(c, message_id)?
        .into_iter()
        .find(|item| item.id == attachment.id)
        .ok_or_else(|| "attachment missing".into())
}

fn attachment_by_id_impl(c: &Connection, id: &str) -> Result<Option<MessageAttachment>> {
    c.query_row(
        "SELECT id,message_id,file_name,mime_type,byte_length,data_url,upload_state,error FROM message_attachments WHERE id=?1",
        [id],
        |r| {
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
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn set_message_attachment_state_impl(
    c: &Connection,
    message_id: &str,
    id: &str,
    state: &str,
    error: Option<&str>,
) -> Result<MessageAttachment> {
    validate_attachment_state(state)?;
    let sources = attachment_transition_sources(state)?;
    // An error string only carries meaning on a failed upload; clearing it on any other
    // transition keeps a retried attachment from displaying its previous failure.
    let error = if state == "failed" { error } else { None };
    // Compare-and-swap: the legal predecessor states ride in the WHERE clause, so two
    // concurrent writers cannot interleave read-then-write into an illegal transition.
    // ?1 id, ?2 message_id, ?3 state, ?4 error; the legal source states start at ?5.
    let placeholders = (0..sources.len())
        .map(|i| format!("?{}", i + 5))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "UPDATE message_attachments SET upload_state=?3, error=?4 WHERE id=?1 AND message_id=?2 AND upload_state IN ({placeholders})"
    );
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&id, &message_id, &state, &error];
    for source in sources {
        params.push(source);
    }
    let changed = c
        .execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(match attachment_by_id_impl(c, id)? {
            Some(existing) if existing.message_id != message_id => {
                "attachment does not belong to this message".to_string()
            }
            Some(existing) => format!(
                "invalid attachment transition: {} -> {state}",
                existing.upload_state
            ),
            None => "attachment not found".to_string(),
        });
    }
    attachments_for_impl(c, message_id)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "attachment missing".into())
}

fn remove_message_attachment_impl(c: &Connection, message_id: &str, id: &str) -> Result<()> {
    let changed = c
        .execute(
            "DELETE FROM message_attachments WHERE id=?1 AND message_id=?2",
            rusqlite::params![id, message_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(match attachment_by_id_impl(c, id)? {
            Some(_) => "attachment does not belong to this message".to_string(),
            None => "attachment not found".to_string(),
        });
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
    message_id: String,
    id: String,
    state: String,
    error: Option<String>,
) -> Result<MessageAttachment> {
    set_message_attachment_state_impl(&db::conn()?, &message_id, &id, &state, error.as_deref())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_message_attachment(message_id: String, id: String) -> Result<()> {
    remove_message_attachment_impl(&db::conn()?, &message_id, &id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_message(
    id: String,
    text: String,
    mention_ids: Option<Vec<String>>,
) -> Result<MessageView> {
    let c = db::conn()?;
    update_message_impl(&c, &id, &text, mention_ids.as_deref())?;
    let m = get_message_impl(&c, &id)?.ok_or_else(|| "message not found".to_string())?;
    to_view(&c, m, None)
}
/// Mentions inbox of one profile (KB §04 `MentionsFolderVM`).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_mentions_for_profile(
    profile_id: String,
    unread_only: Option<bool>,
) -> Result<Vec<MentionView>> {
    list_mentions_for_profile_impl(&db::conn()?, &profile_id, unread_only.unwrap_or(false))
}

/// Badge count (KB §04 `getTotalUnreadMentions`).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn count_unread_mentions(profile_id: String) -> Result<i64> {
    count_unread_mentions_impl(&db::conn()?, &profile_id)
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
                read_only: false,
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
                pinned: false,
                mention_ids: Vec::new(),
                content_kind: "text".into(),
            },
        )
        .unwrap();
    }

    fn new_attachment(
        id: &str,
        data_url: &str,
        byte_length: i64,
        state: Option<&str>,
    ) -> NewMessageAttachment {
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

        let failed = set_message_attachment_state_impl(
            &c,
            "msg-att",
            "att-1",
            "failed",
            Some("network down"),
        )
        .unwrap();
        assert_eq!(failed.upload_state, "failed");
        assert_eq!(failed.error.as_deref(), Some("network down"));

        // a retry clears the stale failure text, so the UI cannot show a cured error
        set_message_attachment_state_impl(&c, "msg-att", "att-1", "uploading", None).unwrap();
        let retried =
            set_message_attachment_state_impl(&c, "msg-att", "att-1", "completed", None).unwrap();
        assert_eq!(retried.upload_state, "completed");
        assert!(retried.error.is_none());
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_defaults_to_completed_and_rejects_unknown_state() {
        let (c, path) = conn();
        seed_message(&c, "chan-att2", "msg-att2");
        let stored = add_message_attachment_impl(
            &c,
            "msg-att2",
            new_attachment("att-2", "data:,hi", 2, None),
        )
        .unwrap();
        assert_eq!(stored.upload_state, "completed");
        assert!(add_message_attachment_impl(
            &c,
            "msg-att2",
            new_attachment("att-3", "data:,hi", 2, Some("teleporting"))
        )
        .is_err());
        assert!(
            set_message_attachment_state_impl(&c, "msg-att2", "att-2", "teleporting", None)
                .is_err()
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_state_transitions_are_one_way() {
        let (c, path) = conn();
        seed_message(&c, "chan-att6", "msg-att6");
        add_message_attachment_impl(
            &c,
            "msg-att6",
            new_attachment("att-6", "data:,hi", 2, Some("loading")),
        )
        .unwrap();
        // loading cannot jump straight to completed
        let err = set_message_attachment_state_impl(&c, "msg-att6", "att-6", "completed", None)
            .unwrap_err();
        assert!(err.contains("invalid attachment transition"), "{err}");
        set_message_attachment_state_impl(&c, "msg-att6", "att-6", "uploading", None).unwrap();
        set_message_attachment_state_impl(&c, "msg-att6", "att-6", "completed", None).unwrap();
        // a finished upload never walks backwards
        let err = set_message_attachment_state_impl(&c, "msg-att6", "att-6", "uploading", None)
            .unwrap_err();
        assert!(err.contains("invalid attachment transition"), "{err}");
        // and the same-state write stays idempotent
        set_message_attachment_state_impl(&c, "msg-att6", "att-6", "completed", None).unwrap();
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_writes_are_scoped_to_their_message() {
        let (c, path) = conn();
        seed_message(&c, "chan-att7", "msg-att7");
        create_message_impl(
            &c,
            &Message {
                id: "msg-att7b".into(),
                channel_id: "chan-att7".into(),
                author_id: Some("default-org".into()),
                text: "other".into(),
                created_at: 2,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                mention_ids: Vec::new(),
                content_kind: "text".into(),
            },
        )
        .unwrap();
        add_message_attachment_impl(
            &c,
            "msg-att7",
            new_attachment("att-7", "data:,hi", 2, Some("uploading")),
        )
        .unwrap();
        // another message's id must not reach this attachment
        let err = set_message_attachment_state_impl(&c, "msg-att7b", "att-7", "completed", None)
            .unwrap_err();
        assert!(err.contains("does not belong"), "{err}");
        let err = remove_message_attachment_impl(&c, "msg-att7b", "att-7").unwrap_err();
        assert!(err.contains("does not belong"), "{err}");
        assert_eq!(attachments_for_impl(&c, "msg-att7").unwrap().len(), 1);
        remove_message_attachment_impl(&c, "msg-att7", "att-7").unwrap();
        assert!(attachments_for_impl(&c, "msg-att7").unwrap().is_empty());
        drop(c);
        drop(path);
    }

    #[test]
    fn v76_migrated_completed_attachment_accepts_its_lost_answer_retry() {
        let (c, path) = conn();
        seed_message(&c, "chan-att-v76", "msg-att-v76");
        // Rebuild the exact V74 table shape over a real message, then let V76 stamp
        // its existing row completed. A client retry after that upgrade must recover
        // the row rather than hit the attachment id's UNIQUE constraint.
        c.execute_batch(
            "DROP TABLE message_attachments;
             CREATE TABLE message_attachments (
                 id TEXT PRIMARY KEY,
                 message_id TEXT NOT NULL,
                 file_name TEXT NOT NULL,
                 mime_type TEXT NOT NULL,
                 byte_length INTEGER NOT NULL,
                 data_url TEXT NOT NULL,
                 created_at INTEGER NOT NULL DEFAULT (unixepoch())
             );",
        )
        .unwrap();
        c.execute(
            "INSERT INTO message_attachments(id,message_id,file_name,mime_type,byte_length,data_url)
             VALUES('att-v75','msg-att-v76','f.txt','text/plain',2,'data:,hi')",
            [],
        )
        .unwrap();
        c.pragma_update(None, "user_version", 74).unwrap();
        db::migrate(&c).unwrap();

        let retried = add_message_attachment_impl(
            &c,
            "msg-att-v76",
            new_attachment("att-v75", "data:,hi", 2, Some("uploading")),
        )
        .unwrap();
        assert_eq!(retried.upload_state, "completed");
        assert!(retried.error.is_none());
        assert_eq!(attachments_for_impl(&c, "msg-att-v76").unwrap().len(), 1);
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_add_is_idempotent_but_refuses_a_different_payload() {
        let (c, path) = conn();
        seed_message(&c, "chan-att8", "msg-att8");
        let first = add_message_attachment_impl(
            &c,
            "msg-att8",
            new_attachment("att-8", "data:,hi", 2, Some("uploading")),
        )
        .unwrap();
        // the lost-answer retry returns the stored row, state untouched
        let again = add_message_attachment_impl(
            &c,
            "msg-att8",
            new_attachment("att-8", "data:,hi", 2, Some("uploading")),
        )
        .unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(again.upload_state, "uploading");
        assert_eq!(attachments_for_impl(&c, "msg-att8").unwrap().len(), 1);
        let err = add_message_attachment_impl(
            &c,
            "msg-att8",
            new_attachment("att-8", "data:,ho", 2, None),
        )
        .unwrap_err();
        assert!(err.contains("conflict"), "{err}");
        drop(c);
        drop(path);
    }

    fn seed_profiles(c: &Connection, ids: &[&str]) {
        for id in ids {
            c.execute(
                "INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?2,unixepoch())",
                rusqlite::params![id, format!("{id}-user")],
            )
            .unwrap();
        }
    }

    fn post(
        c: &Connection,
        channel: &str,
        id: &str,
        author: &str,
        mentions: &[&str],
    ) -> Result<()> {
        create_message_impl(
            c,
            &Message {
                id: id.into(),
                channel_id: channel.into(),
                author_id: Some(author.into()),
                text: "hey".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                mention_ids: mentions.iter().map(|s| s.to_string()).collect(),
                content_kind: "text".into(),
            },
        )
    }

    #[test]
    fn pinning_is_idempotent_and_excludes_archived_messages() {
        let (c, path) = conn();
        seed_message(&c, "chan-pin", "older");
        c.execute("INSERT INTO messages(id,channel_id,author_id,text,created_at,thread_of,archived,pinned,content_kind) VALUES('newer','chan-pin','default-org','new',2,NULL,0,0,'text')", []).unwrap();
        assert!(
            set_message_pinned_impl(&c, "older", true)
                .unwrap()
                .message
                .pinned
        );
        assert!(
            set_message_pinned_impl(&c, "older", true)
                .unwrap()
                .message
                .pinned
        );
        set_message_pinned_impl(&c, "newer", true).unwrap();
        assert_eq!(
            list_pinned_messages_impl(&c, "chan-pin", Some("default-org"))
                .unwrap()
                .iter()
                .map(|m| m.message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["newer", "older"]
        );
        delete_message_impl(&c, "newer").unwrap();
        assert_eq!(
            list_pinned_messages_impl(&c, "chan-pin", Some("default-org"))
                .unwrap()
                .len(),
            1
        );
        drop(c);
        drop(path);
    }
    #[test]
    fn mentions_are_stored_and_read_back_on_the_view() {
        let (c, path) = conn();
        seed_channel(&c, "chan-m1");
        seed_profiles(&c, &["alice", "bob"]);
        post(
            &c,
            "chan-m1",
            "msg-m1",
            "alice",
            &["bob", "bob", "alice", "ghost"],
        )
        .unwrap();
        // duplicates collapse, the author naming themselves is dropped, an unknown id is ignored
        assert_eq!(
            mentions_for_impl(&c, "msg-m1").unwrap(),
            vec!["bob".to_string()]
        );
        let view = list_messages_impl(&c, "chan-m1", Some("alice")).unwrap();
        assert_eq!(view[0].message.mention_ids, vec!["bob".to_string()]);
        // the mention raised exactly one unread notification for bob
        let unread: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM notifications WHERE recipient_id='bob' AND event_type='chat.mention' AND read_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unread, 1);
        drop(c);
        drop(path);
    }

    #[test]
    fn a_mention_target_must_be_able_to_read_the_channel() {
        let (c, path) = conn();
        seed_profiles(&c, &["alice", "bob"]);
        create_channel_impl(
            &c,
            &Channel {
                id: "chan-m2".into(),
                content_type: "private".into(),
                name: Some("Secret".into()),
                description: None,
                project_id: None,
                archived: false,
                read_only: false,
            },
            &["alice".to_string()],
        )
        .expect("channel");
        add_channel_member_impl(&c, "chan-m2", "alice", true).unwrap();
        post(&c, "chan-m2", "msg-m2", "alice", &["bob"]).unwrap();
        // bob cannot open the channel, so naming him neither stores a row nor alerts him
        assert!(mentions_for_impl(&c, "msg-m2").unwrap().is_empty());
        assert!(list_mentions_for_profile_impl(&c, "bob", false)
            .unwrap()
            .is_empty());
        // Leaving after a valid private mention removes the notification too: the generic
        // notifications endpoint must not retain the secret message body.
        add_channel_member_impl(&c, "chan-m2", "bob", false).unwrap();
        post(&c, "chan-m2", "msg-m2b", "alice", &["bob"]).unwrap();
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 1);
        remove_channel_member_impl(&c, "chan-m2", "bob").unwrap();
        assert!(list_mentions_for_profile_impl(&c, "bob", false)
            .unwrap()
            .is_empty());
        let leaked: i64 = c.query_row(
            "SELECT COUNT(*) FROM notifications WHERE recipient_id='bob' AND event_type='chat.mention'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(leaked, 0);
        drop(c);
        drop(path);
    }

    #[test]
    fn mention_target_count_is_bounded_before_message_or_edit_writes() {
        let (c, path) = conn();
        seed_channel(&c, "chan-m-limit");
        let too_many = (0..=MAX_MENTION_TARGETS)
            .map(|n| format!("p{n}"))
            .collect::<Vec<_>>();
        let message = Message {
            id: "msg-m-limit".into(),
            channel_id: "chan-m-limit".into(),
            author_id: Some("default-org".into()),
            text: "flood".into(),
            created_at: 1,
            edited_at: None,
            thread_of: None,
            archived: false,
            pinned: false,
            mention_ids: too_many.clone(),
            content_kind: "text".into(),
        };
        assert!(create_message_impl(&c, &message)
            .unwrap_err()
            .contains("at most"));
        let stored: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE id='msg-m-limit'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, 0);
        post(&c, "chan-m-limit", "msg-m-limit-ok", "default-org", &[]).unwrap();
        assert!(update_message_impl(&c, "msg-m-limit-ok", "flood", Some(&too_many)).is_err());
        let text: String = c
            .query_row(
                "SELECT text FROM messages WHERE id='msg-m-limit-ok'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(text, "hey");
        drop(c);
        drop(path);
    }
    #[test]
    fn editing_a_message_diffs_its_mentions() {
        let (c, path) = conn();
        seed_channel(&c, "chan-m3");
        seed_profiles(&c, &["alice", "bob", "carol"]);
        post(&c, "chan-m3", "msg-m3", "alice", &["bob"]).unwrap();
        c.execute(
            "UPDATE notifications SET read_at=unixepoch() WHERE id='mention:msg-m3:bob'",
            [],
        )
        .unwrap();
        // text-only edit keeps the mentions untouched
        update_message_impl(&c, "msg-m3", "typo fixed", None).unwrap();
        assert_eq!(
            mentions_for_impl(&c, "msg-m3").unwrap(),
            vec!["bob".to_string()]
        );
        // an explicit list is the whole truth: bob leaves, carol arrives
        update_message_impl(&c, "msg-m3", "now carol", Some(&["carol".to_string()])).unwrap();
        assert_eq!(
            mentions_for_impl(&c, "msg-m3").unwrap(),
            vec!["carol".to_string()]
        );
        // bob's alert was already read, so it stays as history; carol gets a fresh one
        let bob_kept: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM notifications WHERE id='mention:msg-m3:bob'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bob_kept, 1);
        assert_eq!(count_unread_mentions_impl(&c, "carol").unwrap(), 1);
        // a target dropped while still unread loses the alert too
        update_message_impl(&c, "msg-m3", "nobody", Some(&[])).unwrap();
        assert_eq!(count_unread_mentions_impl(&c, "carol").unwrap(), 0);
        assert!(update_message_impl(&c, "msg-nope", "x", None).is_err());
        drop(c);
        drop(path);
    }

    #[test]
    fn the_mentions_inbox_filters_by_read_state_and_archival() {
        let (c, path) = conn();
        seed_channel(&c, "chan-m4");
        seed_profiles(&c, &["alice", "bob"]);
        post(&c, "chan-m4", "msg-m4a", "alice", &["bob"]).unwrap();
        post(&c, "chan-m4", "msg-m4b", "alice", &["bob"]).unwrap();
        assert_eq!(
            list_mentions_for_profile_impl(&c, "bob", false)
                .unwrap()
                .len(),
            2
        );
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 2);
        c.execute(
            "UPDATE notifications SET read_at=unixepoch() WHERE id='mention:msg-m4a:bob'",
            [],
        )
        .unwrap();
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 1);
        let unread = list_mentions_for_profile_impl(&c, "bob", true).unwrap();
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].message.message.id, "msg-m4b");
        assert_eq!(unread[0].channel_name.as_deref(), Some("General"));
        // a deleted message drops out of the inbox
        delete_message_impl(&c, "msg-m4b").unwrap();
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 0);
        drop(c);
        drop(path);
    }

    #[test]
    fn attachment_writes_require_author_or_channel_admin() {
        let (c, path) = conn();
        seed_message(&c, "chan-att9", "msg-att9");
        for (id, username) in [
            ("outsider", "outsider-user"),
            ("chan-admin", "chan-admin-user"),
        ] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?2,unixepoch())",
                rusqlite::params![id, username],
            )
            .unwrap();
        }
        add_channel_member_impl(&c, "chan-att9", "outsider", false).unwrap();
        add_channel_member_impl(&c, "chan-att9", "chan-admin", true).unwrap();
        // author of msg-att9 is "default-org" (see seed_message)
        assert!(message_attachment_writable_by_impl(&c, "msg-att9", "default-org", false).unwrap());
        assert!(message_attachment_writable_by_impl(&c, "msg-att9", "chan-admin", false).unwrap());
        // a plain member of the channel is not the owner of someone else's content
        assert!(!message_attachment_writable_by_impl(&c, "msg-att9", "outsider", false).unwrap());
        // the global admin always passes; an unknown message never does
        assert!(message_attachment_writable_by_impl(&c, "msg-att9", "outsider", true).unwrap());
        assert!(
            !message_attachment_writable_by_impl(&c, "msg-nope", "default-org", false).unwrap()
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn archiving_a_message_retains_its_attachments() {
        let (c, path) = conn();
        seed_message(&c, "chan-att10", "msg-att10");
        add_message_attachment_impl(
            &c,
            "msg-att10",
            new_attachment("att-10", "data:,hi", 2, None),
        )
        .unwrap();
        delete_message_impl(&c, "msg-att10").unwrap();
        // the soft delete hides the message but keeps the files with it
        let kept = attachments_for_impl(&c, "msg-att10").unwrap();
        assert_eq!(kept.len(), 1);
        // and removing one still answers to the author/channel-admin gate
        assert!(
            message_attachment_writable_by_impl(&c, "msg-att10", "default-org", false).unwrap()
        );
        assert!(!message_attachment_writable_by_impl(&c, "msg-att10", "nobody", false).unwrap());
        remove_message_attachment_impl(&c, "msg-att10", "att-10").unwrap();
        assert!(attachments_for_impl(&c, "msg-att10").unwrap().is_empty());
        drop(c);
        drop(path);
    }

    #[test]
    fn oversized_encoded_payload_is_refused_before_decoding() {
        // 200 MiB of base64: the bound must come from the length, not from a decode
        let payload = "A".repeat(200 * 1024 * 1024);
        let url = format!("data:application/octet-stream;base64,{payload}");
        let err = measure_data_url(&url, 0).unwrap_err();
        assert!(err.contains("encoded payload"), "{err}");
    }

    #[test]
    fn attachment_size_is_measured_not_trusted() {
        let (c, path) = conn();
        seed_message(&c, "chan-att3", "msg-att3");
        use base64::Engine as _;
        let big = base64::engine::general_purpose::STANDARD.encode(vec![0u8; 11 * 1024 * 1024]);
        let url = format!("data:application/octet-stream;base64,{big}");
        // the historic hole: a zero declared length carrying an oversized payload
        let err =
            add_message_attachment_impl(&c, "msg-att3", new_attachment("att-big", &url, 0, None))
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
        assert!(add_message_attachment_impl(
            &c,
            "msg-att3",
            new_attachment("att-nourl", "hi", 2, None)
        )
        .is_err());
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
        remove_message_attachment_impl(&c, "msg-att4", "att-4").unwrap();
        let left = attachments_for_impl(&c, "msg-att4").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "att-5");
        assert!(remove_message_attachment_impl(&c, "msg-att4", "att-4").is_err());
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
            pinned: false,
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
            pinned: false,
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
                pinned: false,
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
                pinned: false,
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
                read_only: false,
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
                pinned: false,
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
    fn meeting_entity_channel_keeps_private_read_scope_for_actor_reads() {
        let (c, path) = conn();
        for id in ["guest", "stranger"] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,unixepoch())",
                [id],
            )
            .unwrap();
        }
        c.execute_batch(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,visibility,modification_preference,archived)
             VALUES('private-meeting','Private',1,2,'default-org','participants','organizer-only',0);
             INSERT INTO meeting_participants(meeting_id,profile_id,status)
             VALUES('private-meeting','guest','accepted');",
        )
        .unwrap();
        create_entity_channel_impl(&c, "meeting", "private-meeting", None).unwrap();
        let channel = "entity:meeting:private-meeting";
        assert!(channel_allows_actor(&c, channel, Some("guest")).unwrap());
        assert!(!channel_allows_actor(&c, channel, Some("stranger")).unwrap());
        assert!(!channel_allows_actor(&c, channel, None).unwrap());
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
