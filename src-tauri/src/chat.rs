#![allow(dead_code)]
//! Native chat: channels, members, messages, reactions, threads and read state.
//!
//! Model reference: docs/space-knowledge-base/04-collaboration.md §1 (decompiled M2).
//! Threads are channels linked to their root item (`M2ChannelContentThread`): the root
//! remains in its parent, `skip_first_message=true`, and replies live in the linked channel.
//! Legacy `thread_of` rows remain readable during migration. Entity-bound channels are
//! addressed by a deterministic id `entity:{entity_type}:{entity_id}`
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
/// One thread that is waiting on the caller. Carries everything a worklist row
/// needs (who replied, where, how many) so the surface makes no second round trip.
#[derive(Debug, Serialize, Deserialize)]
pub struct UnreadThread {
    pub channel_id: String,
    pub parent_channel_id: String,
    pub parent_channel_name: Option<String>,
    pub root_message_id: String,
    pub root_excerpt: String,
    pub unread_count: i64,
    pub last_reply_at: Option<i64>,
    pub last_reply_author: Option<String>,
}
/// A content thread is a channel linked to one root item in its parent channel.
/// `skip_first_message` keeps that root in the parent pane rather than duplicating it.
#[derive(Debug, Serialize, Deserialize)]
pub struct ThreadChannel {
    #[serde(flatten)]
    pub channel: Channel,
    pub root_message_id: String,
    pub parent_channel_id: String,
    pub skip_first_message: bool,
    pub title: Option<String>,
    pub always_show: bool,
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
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct MentionTarget {
    pub target_type: String,
    pub target_id: String,
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
    /// Teams named by this message (KB §04 `inviteTeam` / `teamSubscribers`). Kept apart
    /// from `mention_ids` because a team is a target, not a recipient: the recipients are
    /// derived from its membership at write time.
    #[serde(default)]
    pub mention_team_ids: Vec<String>,
    /// Typed wire targets preserve the `EntityMention` fact; profile/team fields remain
    /// for old clients and are synthesized on reads.
    #[serde(default)]
    pub mention_targets: Vec<MentionTarget>,
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

/// THE BYTES BEHIND A DATA URL, decoded server side.
///
/// A chat attachment stores its payload as a data URL in the row; the document library
/// stores files on disk. Filing a chat upload into a project library therefore needs the
/// octets once, here — never in the webview, which would mean shipping the blob back out
/// and trusting what comes in. `measure_data_url` runs first, so an oversized or malformed
/// payload is refused by arithmetic before anything is allocated.
/// PUT AN ATTACHMENT ON DISK SO THE SYSTEM CAN OPEN IT.
///
/// In the browser a `<a download>` on a data URL is a download; in the desktop shell
/// it is nothing at all — WKWebView has no download manager, so clicking a file in a
/// message did exactly nothing. The bytes live in the row as a data URL, so the way
/// to open a document is to write it where the operating system can reach it and hand
/// the path to the default application.
///
/// The name is the attachment's own, sanitised: a file called `../../space.db` must
/// land in the staging directory, not on top of the database.
///
/// Desktop only, and deliberately so: the web build has a real browser under it, which
/// downloads the data URL by itself — there is nothing for a server to do.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn stage_message_attachment(attachment_id: String) -> Result<String> {
    let c = db::conn()?;
    let (file_name, byte_length, data_url): (String, i64, String) = c
        .query_row(
            "SELECT file_name,byte_length,data_url FROM message_attachments WHERE id=?1",
            [&attachment_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "attachment not found".to_string())?;
    let bytes = decode_data_url(&data_url, byte_length)?;
    let dir = db::data_dir()?.join("attachment_opens");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create staging directory: {e}"))?;
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_alphanumeric() || "._- ".contains(c) { c } else { '_' })
        .collect();
    let safe = if safe.trim().is_empty() { "attachment".to_string() } else { safe };
    let target = dir.join(format!("{attachment_id}-{safe}"));
    std::fs::write(&target, bytes).map_err(|e| format!("write attachment: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn decode_data_url(data_url: &str, declared: i64) -> Result<Vec<u8>> {
    measure_data_url(data_url, declared)?;
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| "invalid attachment: not a data URL".to_string())?;
    let comma = rest
        .find(',')
        .ok_or_else(|| "invalid attachment: data URL has no payload".to_string())?;
    let (meta, payload) = rest.split_at(comma);
    let payload = &payload[1..];
    if meta.ends_with(";base64") {
        use base64::Engine as _;
        return base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|_| "invalid attachment: bad base64 payload".to_string());
    }
    let bytes = payload.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .filter(|h| h.iter().all(u8::is_ascii_hexdigit))
                .ok_or_else(|| "invalid attachment: bad percent escape".to_string())?;
            let value = u8::from_str_radix(
                std::str::from_utf8(hex).map_err(|_| "invalid attachment: bad percent escape")?,
                16,
            )
            .map_err(|_| "invalid attachment: bad percent escape".to_string())?;
            out.push(value);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    Ok(out)
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
    /// Links extracted from the text at write time, with any preview already unfurled.
    /// Never fetched on this path — reading history must not make outbound requests.
    #[serde(default)]
    pub links: Vec<crate::chat_links::MessageLink>,
}

/// One page of channel history, newest-first, plus the cursor that continues it.
/// `next_cursor` is `None` exactly when the page reached the beginning of history, so a
/// client never has to guess from a short page whether more exists.
#[derive(Debug, Serialize, Deserialize)]
pub struct MessagePage {
    pub messages: Vec<MessageView>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

/// Default page size when a caller does not state one, and the hard ceiling it may ask
/// for. Both are constants here, never a literal at a call site.
pub const DEFAULT_PAGE_LIMIT: i64 = 50;
pub const MAX_PAGE_LIMIT: i64 = 100;

/// A cursor is the (created_at, id) pair of the last row already delivered, base64'd so
/// no client parses or forges its parts — it is a position, not a query. The pair, not
/// the timestamp alone: imported messages share timestamps and a timestamp-only cursor
/// would silently drop or repeat every tie.
fn encode_cursor(created_at: i64, id: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!("{created_at}:{id}"))
}

fn decode_cursor(cursor: &str) -> Result<(i64, String)> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(cursor.as_bytes())
        .map_err(|_| "invalid cursor".to_string())?;
    let raw = String::from_utf8(raw).map_err(|_| "invalid cursor".to_string())?;
    let (ts, id) = raw
        .split_once(':')
        .ok_or_else(|| "invalid cursor".to_string())?;
    let ts: i64 = ts.parse().map_err(|_| "invalid cursor".to_string())?;
    if id.is_empty() {
        return Err("invalid cursor".to_string());
    }
    Ok((ts, id.to_string()))
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
/// ── ONE MEMBERSHIP, NOT TWO (project-bound channels) ────────────────────────────
///
/// A channel that belongs to a project has NO membership of its own to speak of: the
/// people of the project are the people of the conversation. Before this, the header
/// counted `channel_members` ("1 members") while the team rail counted the project
/// (four faces) — two truths about the same room, and no control anywhere to reconcile
/// them.
///
/// The rule, applied in ONE place so that count, list and access can never disagree:
///     effective members = channel_members ∪ project members (owner included)
/// `administrator` is the strongest right the person holds: a channel admin row, or
/// being the project's owner.
const EFFECTIVE_MEMBERS_SQL: &str = "SELECT profile_id, MAX(administrator) FROM (\
     SELECT profile_id, administrator FROM channel_members WHERE channel_id=?1 \
     UNION ALL SELECT p.created_by, 1 FROM channels ch JOIN projects p ON p.id=ch.project_id \
       WHERE ch.id=?1 AND p.created_by IS NOT NULL \
     UNION ALL SELECT pm.profile_id, 0 FROM channels ch \
       JOIN project_members pm ON pm.project_id=ch.project_id WHERE ch.id=?1\
   ) GROUP BY profile_id ORDER BY profile_id";

/// The project a channel belongs to, if any. `None` for a free channel — the one case
/// where the channel's own membership is the whole truth and is directly editable.
pub(crate) fn channel_project_id_on(c: &Connection, channel_id: &str) -> Result<Option<String>> {
    c.query_row(
        "SELECT project_id FROM channels WHERE id=?1",
        [channel_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|found| found.flatten())
    .map_err(|e| e.to_string())
}

/// True when the profile reaches the channel through its project rather than through a
/// `channel_members` row.
fn inherits_membership_on(c: &Connection, channel_id: &str, profile_id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id \
         WHERE ch.id=?1 AND (p.created_by=?2 OR EXISTS(SELECT 1 FROM project_members pm \
         WHERE pm.project_id=p.id AND pm.profile_id=?2)))",
        rusqlite::params![channel_id, profile_id],
        |r| r.get::<_, bool>(0),
    )
    .map_err(|e| e.to_string())
}

/// Membership of a project channel is edited on the PROJECT. Refusing here — rather
/// than writing a row that changes nothing, because the project keeps granting access —
/// is what stops the two lists drifting apart again.
fn guard_inherited_membership(c: &Connection, channel_id: &str) -> Result<()> {
    match channel_project_id_on(c, channel_id)? {
        Some(_) => Err("This channel belongs to a project: its members are the project's \
                        members. Add or remove people in the project's settings."
            .to_string()),
        None => Ok(()),
    }
}

fn member_count_impl(c: &Connection, channel_id: &str) -> Result<i64> {
    c.query_row(
        &format!("SELECT COUNT(*) FROM ({EFFECTIVE_MEMBERS_SQL})"),
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
    // Thread channels inherit their parent boundary; their entity-bound storage class
    // must never turn a private parent discussion public.
    if let Some(parent_id) = thread_parent_channel_id_on(c, channel_id)? {
        return channel_allows_profile(c, &parent_id, profile_id);
    }
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
    // Inherited membership is real membership: a person of the project can read the
    // project's conversations without a `channel_members` row being written for them.
    Ok(count > 0 || inherits_membership_on(c, channel_id, profile_id)?)
}
fn channel_allows_actor(
    c: &Connection,
    channel_id: &str,
    profile_id: Option<&str>,
) -> Result<bool> {
    // Thread channels inherit their parent boundary; their entity-bound storage class
    // must never turn a private parent discussion public.
    if let Some(parent_id) = thread_parent_channel_id_on(c, channel_id)? {
        return profile_id
            .map(|profile_id| channel_allows_profile(c, &parent_id, profile_id))
            .transpose()
            .map(|allowed| allowed.unwrap_or(false));
    }
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
/// Threads that are asking the caller something. THREE conditions, all required:
///
///  1. PARTICIPATION — they wrote the root message, or replied in the thread. An
///     unread reply in a thread you never joined is somebody else's conversation;
///     the worklist is for what is ADDRESSED to you, and joining a thread is that
///     address. (Deliberately NOT widened to "member of the parent channel": that
///     is every busy channel's traffic, exactly the noise `attention.ts` excludes.)
///  2. UNREAD REPLIES BY SOMEBODY ELSE — the read-state definition is the shared
///     `unread_count_impl`; authorship is added on top because posting does not mark
///     a channel read, so without it every reply YOU send would file a task against
///     yourself. Your own message is never a claim on your attention.
///  3. THE PARENT'S ACL ADMITS THEM — through `channel_allows_profile`, which is the
///     same predicate the rest of chat uses and which resolves a thread to its parent
///     itself. No second ACL path exists here, so the inheritance law cannot drift.
fn list_unread_threads_impl(c: &Connection, profile_id: &str) -> Result<Vec<UnreadThread>> {
    let mut s = c
        .prepare(
            "SELECT tc.channel_id, tc.parent_channel_id, pc.name, tc.root_message_id, m.text, m.author_id \
             FROM thread_channels tc \
             JOIN channels ch ON ch.id=tc.channel_id AND ch.archived=0 \
             JOIN channels pc ON pc.id=tc.parent_channel_id \
             JOIN messages m ON m.id=tc.root_message_id AND m.archived=0",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, Option<String>, String, String, Option<String>)> = s
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut out: Vec<UnreadThread> = Vec::new();
    for (channel_id, parent_channel_id, parent_channel_name, root_message_id, root_text, root_author) in rows {
        // (3) first: never compute anything about a thread the caller cannot see.
        if !channel_allows_profile(c, &channel_id, profile_id)? {
            continue;
        }
        // (1) participation.
        let replied: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE channel_id=?1 AND archived=0 AND author_id=?2",
                rusqlite::params![channel_id, profile_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let participates = root_author.as_deref() == Some(profile_id) || replied > 0;
        if !participates {
            continue;
        }
        // (2) unread at all, by the shared definition …
        if unread_count_impl(c, &channel_id, profile_id)? <= 0 {
            continue;
        }
        // … and unread because somebody ELSE wrote it.
        let (unread_count, last_reply_at): (i64, Option<i64>) = c
            .query_row(
                "SELECT COUNT(*), MAX(created_at) FROM messages WHERE channel_id=?1 AND archived=0 \
                 AND author_id IS NOT ?2 AND created_at > \
                 COALESCE((SELECT read_at FROM read_state WHERE channel_id=?1 AND profile_id=?2), 0)",
                rusqlite::params![channel_id, profile_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        if unread_count <= 0 {
            continue;
        }
        let last_reply_author: Option<String> = c
            .query_row(
                "SELECT COALESCE(p.display_name, m.author_id) FROM messages m \
                 LEFT JOIN profiles p ON p.id=m.author_id \
                 WHERE m.channel_id=?1 AND m.archived=0 AND m.author_id IS NOT ?2 AND m.created_at > \
                 COALESCE((SELECT read_at FROM read_state WHERE channel_id=?1 AND profile_id=?2), 0) \
                 ORDER BY m.created_at DESC LIMIT 1",
                rusqlite::params![channel_id, profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        out.push(UnreadThread {
            channel_id,
            parent_channel_id,
            parent_channel_name,
            root_message_id,
            root_excerpt: root_text.chars().take(140).collect(),
            unread_count,
            last_reply_at,
            last_reply_author,
        });
    }
    out.sort_by(|a, b| b.last_reply_at.cmp(&a.last_reply_at));
    Ok(out)
}
fn list_channels_with_meta_impl(c: &Connection, profile_id: &str) -> Result<Vec<ChannelSummary>> {
    // Thread channels are opened from their root item, never shown as peer channels.
    let channels: Vec<Channel> = list_channels_impl(c)?
        .into_iter()
        .map(|channel| {
            let is_top_level = thread_parent_channel_id_on(c, &channel.id)?.is_none();
            Ok((channel, is_top_level))
        })
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter_map(|(channel, is_top_level)| is_top_level.then_some(channel))
        .collect();
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
/// Erase one channel and everything that only exists because of it, in one transaction.
///
/// Two rules make this more than a `DELETE`:
/// 1. A thread is itself a channel (`thread_channels`), so a parent takes its threads
///    with it — otherwise the thread channel outlives its root message as an
///    unreachable room full of messages.
/// 2. A vanished message may not leave a mention notification behind. That is the same
///    rule `remove_channel_member_impl` applies when someone loses access: the generic
///    notification list would otherwise still render the body of a message that no
///    longer exists.
///
/// Rows in other domains merely *point* at the channel (a review, a meeting, a team, a
/// location). Those are not channel content and are never deleted here; their pointer
/// is cleared, so the review survives without a discussion room.
fn delete_channel_impl(c: &mut Connection, id: &str, actor_id: &str) -> Result<()> {
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM channels WHERE id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Channel not found".into());
    }
    // Same gate as every other channel write (`update_channel`, member changes):
    // Channel.ManageChannel at the channel's own scope. A missing right is an error,
    // never a silent no-op that reports success.
    crate::platform::require_right_on(
        c,
        actor_id,
        crate::rights::Right::ManageChannel,
        "channel",
        Some(id),
    )?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    // Threads first: `thread_channels.parent_channel_id` names the rooms that only
    // exist under this one, and each of them is a channel with its own content.
    let mut pending = vec![id.to_string()];
    let mut order: Vec<String> = Vec::new();
    while let Some(current) = pending.pop() {
        let children: Vec<String> = {
            let mut s = tx
                .prepare("SELECT channel_id FROM thread_channels WHERE parent_channel_id=?1")
                .map_err(|e| e.to_string())?;
            let rows = s
                .query_map([&current], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        for child in children {
            if !order.contains(&child) && child != current {
                pending.push(child);
            }
        }
        order.retain(|existing| existing != &current);
        order.push(current);
    }
    for channel_id in order.iter().rev() {
        purge_channel_rows(&tx, channel_id)?;
    }
    tx.commit().map_err(|e| e.to_string())
}
/// Every table that holds a row *because of* this channel, deepest first. Message-level
/// rows are removed explicitly rather than left to `ON DELETE CASCADE`: several of these
/// tables predate the cascade clauses, and this way the guarantee does not depend on the
/// `foreign_keys` pragma being on for the connection that happens to call us.
fn purge_channel_rows(tx: &rusqlite::Transaction<'_>, channel_id: &str) -> Result<()> {
    // A deleted message must not leave a claim on anyone's attention behind.
    tx.execute(
        "DELETE FROM notifications WHERE (entity_type='message' AND entity_id IN (SELECT id FROM messages WHERE channel_id=?1)) \
         OR (entity_type='channel' AND entity_id=?1)",
        [channel_id],
    )
    .map_err(|e| e.to_string())?;
    const MESSAGE_SCOPED: &[&str] = &[
        "message_poll_votes WHERE poll_id IN (SELECT id FROM message_polls WHERE channel_id=?1)",
        "message_poll_options WHERE poll_id IN (SELECT id FROM message_polls WHERE channel_id=?1)",
        "message_polls WHERE channel_id=?1",
        "reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
        "message_mentions WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
        "message_team_mentions WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
        "message_entity_mentions WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
        "message_links WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
        "message_attachments WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
    ];
    for clause in MESSAGE_SCOPED {
        tx.execute(&format!("DELETE FROM {clause}"), [channel_id])
            .map_err(|e| e.to_string())?;
    }
    // Pointers from other domains: cleared, not followed. Their owner keeps existing.
    for clause in [
        "UPDATE reviews SET channel_id=NULL WHERE channel_id=?1",
        "UPDATE review_discussions SET channel_id=NULL WHERE channel_id=?1",
        "UPDATE meetings SET channel_id=NULL WHERE channel_id=?1",
        "UPDATE teams SET channel_id=NULL WHERE channel_id=?1",
        "UPDATE locations SET channel_id=NULL WHERE channel_id=?1",
    ] {
        tx.execute(clause, [channel_id])
            .map_err(|e| e.to_string())?;
    }
    const CHANNEL_SCOPED: &[&str] = &[
        "read_state WHERE channel_id=?1",
        "message_drafts WHERE channel_id=?1",
        "channel_typing WHERE channel_id=?1",
        "scheduled_messages WHERE channel_id=?1",
        "channel_subscriptions WHERE channel_id=?1",
        "channel_notification_preferences WHERE channel_id=?1",
        "channel_notes WHERE channel_id=?1",
        "channel_members WHERE channel_id=?1",
        "private_feeds WHERE channel_id=?1",
        "document_discussions WHERE channel_id=?1",
        "thread_channels WHERE channel_id=?1 OR parent_channel_id=?1 \
         OR root_message_id IN (SELECT id FROM messages WHERE channel_id=?1)",
        // Replies before roots: `messages.thread_of` points at another message.
        "messages WHERE channel_id=?1 AND thread_of IS NOT NULL",
        "messages WHERE channel_id=?1",
        "channels WHERE id=?1",
    ];
    for clause in CHANNEL_SCOPED {
        tx.execute(&format!("DELETE FROM {clause}"), [channel_id])
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
    let mut s = c.prepare(EFFECTIVE_MEMBERS_SQL).map_err(|e| e.to_string())?;
    let rows = s
        .query_map([channel_id], |r| {
            Ok(ChannelMember {
                channel_id: channel_id.to_string(),
                profile_id: r.get(0)?,
                administrator: r.get(1)?,
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

fn thread_parent_channel_id_on(c: &Connection, channel_id: &str) -> Result<Option<String>> {
    c.query_row(
        "SELECT parent_channel_id FROM thread_channels WHERE channel_id=?1",
        [channel_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
fn thread_channel_for_root_impl(
    c: &Connection,
    root_message_id: &str,
) -> Result<Option<ThreadChannel>> {
    c.query_row(
        "SELECT ch.id,ch.content_type,ch.name,ch.description,ch.project_id,ch.archived,tc.root_message_id,tc.parent_channel_id,tc.title,tc.always_show \
         FROM thread_channels tc JOIN channels ch ON ch.id=tc.channel_id \
         WHERE tc.root_message_id=?1 AND ch.archived=0",
        [root_message_id],
        |r| Ok(ThreadChannel {
            channel: Channel { id:r.get(0)?, content_type:r.get(1)?, name:r.get(2)?, description:r.get(3)?, project_id:r.get(4)?, archived:r.get(5)?, read_only:false },
            root_message_id:r.get(6)?, parent_channel_id:r.get(7)?, title:r.get(8)?, always_show:r.get(9)?, skip_first_message:true,
        }),
    ).optional().map_err(|e| e.to_string())
}
fn ensure_thread_channel_impl(
    c: &Connection,
    root_message_id: &str,
    title: Option<String>,
    acting_profile_id: Option<&str>,
) -> Result<ThreadChannel> {
    let parent_channel_id: String = c
        .query_row(
            "SELECT channel_id FROM messages WHERE id=?1 AND archived=0 AND thread_of IS NULL",
            [root_message_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "thread root not found".to_string())?;
    if !channel_allows_actor(c, &parent_channel_id, acting_profile_id)? {
        return Err("channel access denied".into());
    }
    if let Some(thread) = thread_channel_for_root_impl(c, root_message_id)? {
        return Ok(thread);
    }
    let channel = Channel {
        id: format!("thread:{root_message_id}"),
        content_type: "entity-bound".into(),
        name: title.clone().or(Some("Thread".into())),
        description: Some(format!("thread:{root_message_id}")),
        project_id: None,
        archived: false,
        read_only: false,
    };
    c.execute("INSERT OR IGNORE INTO channels(id,content_type,name,description,project_id,archived) VALUES(?1,?2,?3,?4,?5,0)", rusqlite::params![channel.id,channel.content_type,channel.name,channel.description,channel.project_id]).map_err(|e| e.to_string())?;
    c.execute("INSERT OR IGNORE INTO thread_channels(root_message_id,channel_id,parent_channel_id,title,always_show) VALUES(?1,?2,?3,?4,0)", rusqlite::params![root_message_id,channel.id,parent_channel_id,title]).map_err(|e| e.to_string())?;
    // Earlier clients stored replies in the parent with `thread_of`. Once a root is
    // opened as a channel, move that history intact so the panel has one source of truth.
    c.execute(
        "UPDATE messages SET channel_id=?1, thread_of=NULL WHERE thread_of=?2",
        rusqlite::params![channel.id, root_message_id],
    )
    .map_err(|e| e.to_string())?;
    thread_channel_for_root_impl(c, root_message_id)?
        .ok_or_else(|| "thread channel missing after insert".into())
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
        mention_team_ids: Vec::new(),
        mention_targets: Vec::new(),
    })
}
fn reply_count_impl(c: &Connection, message_id: &str) -> Result<i64> {
    c.query_row(
        "SELECT COUNT(*) FROM messages WHERE (thread_of=?1 OR channel_id=(SELECT channel_id FROM thread_channels WHERE root_message_id=?1)) AND archived=0",
        [message_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())
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

/// The teams a message named, as stored rows (same reasoning as `mentions_for_impl`:
/// the row is the fact, the `@name` spelling in the text is not).
fn entity_mentions_for_impl(c: &Connection, message_id: &str) -> Result<Vec<MentionTarget>> {
    let mut s = c.prepare("SELECT entity_type,entity_id FROM message_entity_mentions WHERE message_id=?1 ORDER BY entity_type,entity_id").map_err(|e| e.to_string())?;
    let rows = s
        .query_map([message_id], |r| {
            Ok(MentionTarget {
                target_type: r.get(0)?,
                target_id: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
fn team_mentions_for_impl(c: &Connection, message_id: &str) -> Result<Vec<String>> {
    let mut s = c
        .prepare("SELECT team_id FROM message_team_mentions WHERE message_id=?1 ORDER BY team_id")
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
    m.mention_team_ids = team_mentions_for_impl(c, &m.id)?;
    m.mention_targets = m
        .mention_ids
        .iter()
        .map(|id| MentionTarget {
            target_type: "profile".into(),
            target_id: id.clone(),
        })
        .chain(m.mention_team_ids.iter().map(|id| MentionTarget {
            target_type: "team".into(),
            target_id: id.clone(),
        }))
        .chain(entity_mentions_for_impl(c, &m.id)?)
        .collect();
    let links = crate::chat_links::links_for(c, &m.id)?;
    Ok(MessageView {
        message: m,
        reply_count,
        reactions,
        attachments,
        links,
    })
}

/// Keyset page of a channel's history (roots when `thread_of` is None, one thread's
/// replies otherwise), newest first, continuing strictly before `cursor`.
///
/// Keyset, not OFFSET: history grows while a reader pages, and an offset would make every
/// new message shift the window and duplicate a row. The ACL is checked here, on every
/// page — a cursor is not a capability and must never stand in for channel membership.
fn list_messages_page_impl(
    c: &Connection,
    channel_id: &str,
    thread_of: Option<&str>,
    cursor: Option<&str>,
    limit: Option<i64>,
    acting_profile_id: Option<&str>,
) -> Result<MessagePage> {
    if !channel_allows_actor(c, channel_id, acting_profile_id)? {
        return Err("channel access denied".to_string());
    }
    let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT).clamp(1, MAX_PAGE_LIMIT);
    if let Some(root) = thread_of {
        // A thread is addressed by its root, but the root's channel is what the ACL was
        // checked against: refuse a root from some other channel instead of paging it.
        let root_channel: Option<String> = c
            .query_row("SELECT channel_id FROM messages WHERE id=?1", [root], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        if root_channel.as_deref() != Some(channel_id) {
            return Err("thread does not belong to this channel".to_string());
        }
    }
    let (cursor_ts, cursor_id) = match cursor {
        Some(raw) => decode_cursor(raw)?,
        None => (i64::MAX, String::new()),
    };
    // Fetch one extra row: presence of row `limit+1` is what proves more history exists,
    // without a second COUNT query that could disagree with this one.
    let sql = format!(
        "SELECT id,channel_id,author_id,text,created_at,edited_at,thread_of,archived,pinned,content_kind \
         FROM messages WHERE channel_id=?1 AND archived=0 AND {} \
         AND (created_at < ?2 OR (created_at = ?2 AND id < ?3)) \
         ORDER BY created_at DESC, id DESC LIMIT ?4",
        if thread_of.is_some() {
            "thread_of = ?5"
        } else {
            "thread_of IS NULL AND ?5 IS NULL"
        }
    );
    let mut s = c.prepare(&sql).map_err(|e| e.to_string())?;
    let mut msgs: Vec<Message> = s
        .query_map(
            rusqlite::params![channel_id, cursor_ts, cursor_id, limit + 1, thread_of],
            message_row,
        )
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let has_more = msgs.len() as i64 > limit;
    msgs.truncate(limit as usize);
    let next_cursor = if has_more {
        msgs.last().map(|m| encode_cursor(m.created_at, &m.id))
    } else {
        None
    };
    let messages = msgs
        .into_iter()
        .map(|m| to_view(c, m, acting_profile_id))
        .collect::<Result<Vec<_>>>()?;
    Ok(MessagePage {
        messages,
        next_cursor,
        has_more,
    })
}

/// Unfurl the pending links of one message. The read ACL of the owning channel gates it —
/// otherwise anyone could make the server fetch on behalf of a channel they cannot read,
/// and learn the answer.
fn unfurl_message_links_impl(
    c: &Connection,
    message_id: &str,
    acting_profile_id: Option<&str>,
    fetch: &dyn Fn(&str) -> Result<crate::chat_links::FetchedDoc>,
) -> Result<Vec<crate::chat_links::MessageLink>> {
    let channel_id: String = c
        .query_row(
            "SELECT channel_id FROM messages WHERE id=?1",
            [message_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "message not found".to_string())?;
    if !channel_allows_actor(c, &channel_id, acting_profile_id)? {
        return Err("channel access denied".to_string());
    }
    crate::chat_links::unfurl_links_with(c, message_id, fetch)
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

/// Default lifetime of a typing beat. Clients re-beat well inside it; a crashed or
/// backgrounded client's row simply ages out instead of showing a stuck "typing…".
/// Callers may override it, so the window is policy, not a constant baked into queries.
pub const TYPING_TTL_SECS_DEFAULT: i64 = 8;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageDraft {
    pub channel_id: String,
    pub author_id: String,
    /// `""` = channel root composer; otherwise the root message id being replied to.
    #[serde(default)]
    pub thread_key: String,
    pub text: String,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TypingParticipant {
    pub channel_id: String,
    pub profile_id: String,
    pub updated_at: i64,
}

fn draft_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MessageDraft> {
    Ok(MessageDraft {
        channel_id: r.get(0)?,
        author_id: r.get(1)?,
        thread_key: r.get(2)?,
        text: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Saving a draft is an upsert, not an append: the composer holds exactly one unsent body
/// per (channel, author, thread). An empty/whitespace body means "nothing unsent" and
/// deletes the row, so a cleared composer never resurrects text on the next reload.
fn save_draft_impl(
    c: &Connection,
    channel_id: &str,
    author_id: &str,
    thread_key: &str,
    text: &str,
) -> Result<Option<MessageDraft>> {
    if !channel_allows_actor(c, channel_id, Some(author_id))? {
        return Err("channel access denied".into());
    }
    if text.trim().is_empty() {
        delete_draft_impl(c, channel_id, author_id, thread_key)?;
        return Ok(None);
    }
    let now = now_secs();
    c.execute(
        "INSERT INTO message_drafts(channel_id,author_id,thread_key,text,updated_at) VALUES(?1,?2,?3,?4,?5) \
         ON CONFLICT(channel_id,author_id,thread_key) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
        rusqlite::params![channel_id, author_id, thread_key, text, now],
    )
    .map_err(|e| e.to_string())?;
    get_draft_impl(c, channel_id, author_id, thread_key)
}

fn get_draft_impl(
    c: &Connection,
    channel_id: &str,
    author_id: &str,
    thread_key: &str,
) -> Result<Option<MessageDraft>> {
    c.query_row(
        "SELECT channel_id,author_id,thread_key,text,updated_at FROM message_drafts WHERE channel_id=?1 AND author_id=?2 AND thread_key=?3",
        rusqlite::params![channel_id, author_id, thread_key],
        draft_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Newest-first so a client can render "unsent elsewhere" without a second sort.
fn list_drafts_impl(c: &Connection, author_id: &str) -> Result<Vec<MessageDraft>> {
    let mut s = c
        .prepare(
            "SELECT channel_id,author_id,thread_key,text,updated_at FROM message_drafts WHERE author_id=?1 ORDER BY updated_at DESC, channel_id, thread_key",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([author_id], draft_row)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Idempotent: deleting an absent draft is success, so send-then-clear can be retried.
fn delete_draft_impl(
    c: &Connection,
    channel_id: &str,
    author_id: &str,
    thread_key: &str,
) -> Result<bool> {
    let changed = c
        .execute(
            "DELETE FROM message_drafts WHERE channel_id=?1 AND author_id=?2 AND thread_key=?3",
            rusqlite::params![channel_id, author_id, thread_key],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

/// A typing beat overwrites the profile's previous beat. `typing=false` retracts it
/// immediately (message sent / composer cleared) rather than waiting for the TTL.
fn set_typing_impl(c: &Connection, channel_id: &str, profile_id: &str, typing: bool) -> Result<()> {
    if !channel_allows_actor(c, channel_id, Some(profile_id))? {
        return Err("channel access denied".into());
    }
    if !typing {
        c.execute(
            "DELETE FROM channel_typing WHERE channel_id=?1 AND profile_id=?2",
            rusqlite::params![channel_id, profile_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    c.execute(
        "INSERT INTO channel_typing(channel_id,profile_id,updated_at) VALUES(?1,?2,?3) \
         ON CONFLICT(channel_id,profile_id) DO UPDATE SET updated_at=excluded.updated_at",
        rusqlite::params![channel_id, profile_id, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Readers see everyone but themselves, and only beats inside the TTL window. Expired rows
/// are swept here so the table cannot grow without a background job.
fn list_typing_impl(
    c: &Connection,
    channel_id: &str,
    acting_profile_id: Option<&str>,
    ttl_secs: i64,
) -> Result<Vec<TypingParticipant>> {
    if !channel_allows_actor(c, channel_id, acting_profile_id)? {
        return Err("channel access denied".into());
    }
    let ttl = ttl_secs.max(1);
    let cutoff = now_secs() - ttl;
    c.execute("DELETE FROM channel_typing WHERE updated_at < ?1", [cutoff])
        .map_err(|e| e.to_string())?;
    let mut s = c
        .prepare(
            "SELECT channel_id,profile_id,updated_at FROM channel_typing WHERE channel_id=?1 AND updated_at >= ?2 AND profile_id IS NOT ?3 ORDER BY updated_at DESC, profile_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(
            rusqlite::params![channel_id, cutoff, acting_profile_id],
            |r| {
                Ok(TypingParticipant {
                    channel_id: r.get(0)?,
                    profile_id: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// How many due intents one delivery run may claim. A tick is bounded so a backlog
/// (server down over a weekend) drains across ticks instead of holding the write lock.
pub const SCHEDULED_TICK_LIMIT_DEFAULT: i64 = 100;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScheduledMessage {
    pub id: String,
    pub channel_id: String,
    pub author_id: String,
    pub text: String,
    pub thread_of: Option<String>,
    /// UTC epoch seconds — the wire never carries a local wall clock.
    pub scheduled_at: i64,
    pub status: String,
    pub sent_message_id: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn scheduled_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduledMessage> {
    Ok(ScheduledMessage {
        id: r.get(0)?,
        channel_id: r.get(1)?,
        author_id: r.get(2)?,
        text: r.get(3)?,
        thread_of: r.get(4)?,
        scheduled_at: r.get(5)?,
        status: r.get(6)?,
        sent_message_id: r.get(7)?,
        error: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

const SCHEDULED_COLS: &str = "id,channel_id,author_id,text,thread_of,scheduled_at,status,sent_message_id,error,created_at,updated_at";

/// The delivered message id is derived from the intent id, never random: a replayed
/// delivery hits the messages primary key instead of posting the text twice.
fn scheduled_message_id(id: &str) -> String {
    format!("sched-{id}")
}

/// A thread target must live in the same channel and still exist — otherwise the reply
/// would surface in a conversation its author never chose.
fn validate_scheduled_thread(
    c: &Connection,
    channel_id: &str,
    thread_of: Option<&str>,
) -> Result<()> {
    let Some(thread_of) = thread_of else {
        return Ok(());
    };
    let root_channel: Option<String> = c
        .query_row(
            "SELECT channel_id FROM messages WHERE id=?1 AND archived=0",
            [thread_of],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match root_channel.as_deref() {
        Some(found) if found == channel_id => Ok(()),
        Some(_) => Err("thread root belongs to another channel".into()),
        None => Err("thread root not found".into()),
    }
}

/// Scheduling is a future act by definition: a past (or now) timestamp would fire on the
/// very next tick, which is a plain send wearing a scheduling costume.
fn validate_future(scheduled_at: i64, now: i64) -> Result<()> {
    if scheduled_at <= now {
        return Err("scheduled_at must be in the future".into());
    }
    Ok(())
}

fn scheduled_write_guard(c: &Connection, channel_id: &str, author_id: &str) -> Result<()> {
    if is_read_only_channel_on(c, channel_id)? {
        return Err("Private feeds are read-only".into());
    }
    if !channel_allows_profile(c, channel_id, author_id)? {
        return Err("channel access denied".into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn schedule_message_impl(
    c: &Connection,
    id: &str,
    channel_id: &str,
    author_id: &str,
    text: &str,
    thread_of: Option<&str>,
    scheduled_at: i64,
) -> Result<ScheduledMessage> {
    if text.trim().is_empty() {
        return Err("scheduled message text is required".into());
    }
    scheduled_write_guard(c, channel_id, author_id)?;
    validate_future(scheduled_at, now_secs())?;
    validate_scheduled_thread(c, channel_id, thread_of)?;
    let now = now_secs();
    c.execute(
        "INSERT INTO scheduled_messages(id,channel_id,author_id,text,thread_of,scheduled_at,status,created_at,updated_at) \
         VALUES(?1,?2,?3,?4,?5,?6,'pending',?7,?7)",
        rusqlite::params![id, channel_id, author_id, text, thread_of, scheduled_at, now],
    )
    .map_err(|e| e.to_string())?;
    get_scheduled_impl(c, id)?.ok_or_else(|| "scheduled message not found".to_string())
}

fn get_scheduled_impl(c: &Connection, id: &str) -> Result<Option<ScheduledMessage>> {
    c.query_row(
        &format!("SELECT {SCHEDULED_COLS} FROM scheduled_messages WHERE id=?1"),
        [id],
        scheduled_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Only the author may see or steer their own unsent intents — a pending message is not
/// channel content yet, so channel membership alone grants nothing.
fn owned_scheduled(c: &Connection, id: &str, actor_id: &str) -> Result<ScheduledMessage> {
    let row =
        get_scheduled_impl(c, id)?.ok_or_else(|| "scheduled message not found".to_string())?;
    if row.author_id != actor_id {
        return Err("scheduled message belongs to another author".into());
    }
    Ok(row)
}

fn list_scheduled_impl(
    c: &Connection,
    author_id: &str,
    channel_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<ScheduledMessage>> {
    if let Some(status) = status {
        if !matches!(status, "pending" | "sent" | "cancelled") {
            return Err(format!("invalid scheduled status: {status}"));
        }
    }
    let mut s = c
        .prepare(&format!(
            "SELECT {SCHEDULED_COLS} FROM scheduled_messages \
             WHERE author_id=?1 AND (?2 IS NULL OR channel_id=?2) AND (?3 IS NULL OR status=?3) \
             ORDER BY scheduled_at, id"
        ))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map(
            rusqlite::params![author_id, channel_id, status],
            scheduled_row,
        )
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Editing is CAS on `status='pending'`: an intent that already fired (or was cancelled)
/// is history and cannot be rewritten by a client that raced the ticker.
fn update_scheduled_impl(
    c: &Connection,
    id: &str,
    actor_id: &str,
    text: Option<&str>,
    scheduled_at: Option<i64>,
) -> Result<ScheduledMessage> {
    let current = owned_scheduled(c, id, actor_id)?;
    if current.status != "pending" {
        return Err(format!("scheduled message is {}", current.status));
    }
    let text = text.unwrap_or(&current.text);
    if text.trim().is_empty() {
        return Err("scheduled message text is required".into());
    }
    let when = scheduled_at.unwrap_or(current.scheduled_at);
    validate_future(when, now_secs())?;
    scheduled_write_guard(c, &current.channel_id, actor_id)?;
    let changed = c
        .execute(
            "UPDATE scheduled_messages SET text=?2, scheduled_at=?3, updated_at=?4 WHERE id=?1 AND status='pending'",
            rusqlite::params![id, text, when, now_secs()],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("scheduled message is no longer pending".into());
    }
    get_scheduled_impl(c, id)?.ok_or_else(|| "scheduled message not found".to_string())
}

/// Cancelling is the same CAS; it never deletes the row, so the author keeps the record
/// of what they called off.
fn cancel_scheduled_impl(c: &Connection, id: &str, actor_id: &str) -> Result<ScheduledMessage> {
    let current = owned_scheduled(c, id, actor_id)?;
    if current.status == "cancelled" {
        return Ok(current); // idempotent retry
    }
    let changed = c
        .execute(
            "UPDATE scheduled_messages SET status='cancelled', updated_at=?2 WHERE id=?1 AND status='pending'",
            rusqlite::params![id, now_secs()],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("scheduled message already delivered".into());
    }
    get_scheduled_impl(c, id)?.ok_or_else(|| "scheduled message not found".to_string())
}

/// One delivery step: *lease* a single due row with a conditional UPDATE (`status='pending'`
/// -> `sent` in the same statement that names the message id), then insert the message.
/// Two concurrent ticks cannot both win that UPDATE, so nobody posts twice; a crash after
/// the lease leaves a `sent` row whose derived message id is reinserted idempotently on the
/// next run. A failed insert releases the lease and records `error` for the author.
fn deliver_one_scheduled(c: &Connection, id: &str) -> Result<Option<ScheduledMessage>> {
    let message_id = scheduled_message_id(id);
    let leased = c
        .execute(
            "UPDATE scheduled_messages SET status='sent', sent_message_id=?2, error=NULL, updated_at=?3 \
             WHERE id=?1 AND status='pending'",
            rusqlite::params![id, message_id, now_secs()],
        )
        .map_err(|e| e.to_string())?;
    if leased == 0 {
        return Ok(None);
    }
    let row =
        get_scheduled_impl(c, id)?.ok_or_else(|| "scheduled message not found".to_string())?;
    let message = Message {
        id: message_id,
        channel_id: row.channel_id.clone(),
        author_id: Some(row.author_id.clone()),
        text: row.text.clone(),
        created_at: row.scheduled_at,
        edited_at: None,
        thread_of: row.thread_of.clone(),
        archived: false,
        pinned: false,
        content_kind: default_message_content_kind(),
        mention_ids: Vec::new(),
        mention_team_ids: Vec::new(),
        mention_targets: Vec::new(),
    };
    match create_message_impl(c, &message) {
        Ok(()) => Ok(Some(row)),
        Err(e) => {
            c.execute(
                "UPDATE scheduled_messages SET status='pending', sent_message_id=NULL, error=?2, updated_at=?3 WHERE id=?1",
                rusqlite::params![id, e, now_secs()],
            )
            .map_err(|e| e.to_string())?;
            Err(e)
        }
    }
}

/// Bounded tick: claim at most `limit` due intents, oldest first. Failures are recorded
/// on their row and do not abort the run — one broken channel must not block the rest.
fn deliver_due_scheduled_impl(
    c: &Connection,
    now: i64,
    limit: i64,
) -> Result<Vec<ScheduledMessage>> {
    let limit = limit.clamp(1, 1000);
    let mut s = c
        .prepare(
            "SELECT id FROM scheduled_messages WHERE status='pending' AND scheduled_at <= ?1 ORDER BY scheduled_at, id LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = s
        .query_map(rusqlite::params![now, limit], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(s);
    let mut delivered = Vec::new();
    for id in ids {
        match deliver_one_scheduled(c, &id) {
            Ok(Some(row)) => delivered.push(row),
            Ok(None) => {}
            Err(_) => {}
        }
    }
    Ok(delivered)
}

// ---------------------------------------------------------------------------
// Polls (V117) — KB §04 §1.1 `M2PollContent`: a poll IS a message's content.
// ---------------------------------------------------------------------------

/// A poll needs at least a choice between two things; one option is an announcement.
pub const POLL_MIN_OPTIONS: usize = 2;
/// Bound taken from the composer: an unbounded option list is a write amplifier.
pub const POLL_MAX_OPTIONS: usize = 20;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PollOptionResult {
    pub id: String,
    pub position: i64,
    pub text: String,
    pub vote_count: i64,
    /// Whether the *reading* profile picked this option. Never other people's ballots.
    pub me_voted: bool,
}
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PollView {
    pub id: String,
    pub message_id: String,
    pub channel_id: String,
    pub author_id: String,
    pub question: String,
    pub multiple_choice: bool,
    pub anonymous: bool,
    pub closed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub options: Vec<PollOptionResult>,
    /// Distinct voters, not ballots: a multi-choice poll must not report turnout
    /// larger than its electorate.
    pub voter_count: i64,
}

fn poll_message_id(poll_id: &str) -> String {
    format!("poll-{poll_id}")
}
fn poll_option_id(poll_id: &str, position: usize) -> String {
    format!("{poll_id}-o{position}")
}

fn validate_poll_options(options: &[String]) -> Result<Vec<String>> {
    let cleaned: Vec<String> = options.iter().map(|o| o.trim().to_string()).collect();
    if cleaned.iter().any(|o| o.is_empty()) {
        return Err("poll options must not be empty".into());
    }
    if cleaned.len() < POLL_MIN_OPTIONS {
        return Err(format!("a poll needs at least {POLL_MIN_OPTIONS} options"));
    }
    if cleaned.len() > POLL_MAX_OPTIONS {
        return Err(format!("a poll accepts at most {POLL_MAX_OPTIONS} options"));
    }
    let mut seen = std::collections::HashSet::new();
    for o in &cleaned {
        if !seen.insert(o.to_lowercase()) {
            return Err("poll options must be distinct".into());
        }
    }
    Ok(cleaned)
}

/// Creating a poll writes the carrying message and the poll in ONE transaction: a
/// half-written poll would show as an empty message nobody can vote on, and a poll row
/// without its message would be unreachable content.
#[allow(clippy::too_many_arguments)]
fn create_poll_impl(
    c: &Connection,
    id: &str,
    channel_id: &str,
    author_id: &str,
    question: &str,
    options: &[String],
    multiple_choice: bool,
    anonymous: bool,
) -> Result<PollView> {
    let question = question.trim();
    if question.is_empty() {
        return Err("poll question is required".into());
    }
    let options = validate_poll_options(options)?;
    let message_id = poll_message_id(id);
    let now = now_secs();
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    // The message carries the channel ACL / read-only checks for us.
    create_message_impl(
        &tx,
        &Message {
            id: message_id.clone(),
            channel_id: channel_id.to_string(),
            author_id: Some(author_id.to_string()),
            text: question.to_string(),
            created_at: now,
            edited_at: None,
            thread_of: None,
            archived: false,
            pinned: false,
            content_kind: "poll".into(),
            mention_ids: Vec::new(),
            mention_team_ids: Vec::new(),
            mention_targets: Vec::new(),
        },
    )?;
    tx.execute(
        "INSERT INTO message_polls(id,message_id,channel_id,author_id,question,multiple_choice,anonymous,created_at,updated_at) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)",
        rusqlite::params![id, message_id, channel_id, author_id, question, multiple_choice, anonymous, now],
    )
    .map_err(|e| e.to_string())?;
    for (position, text) in options.iter().enumerate() {
        tx.execute(
            "INSERT INTO message_poll_options(id,poll_id,position,text) VALUES(?1,?2,?3,?4)",
            rusqlite::params![poll_option_id(id, position), id, position as i64, text],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    get_poll_impl(c, id, Some(author_id))?.ok_or_else(|| "poll not found".to_string())
}

/// The read model is an aggregate: counts plus the reader's own ballot. Individual
/// ballots are never returned, so an anonymous poll cannot be de-anonymized by reading
/// the API, and a public one still does not leak who voted for what through this seam.
fn get_poll_impl(
    c: &Connection,
    id: &str,
    acting_profile_id: Option<&str>,
) -> Result<Option<PollView>> {
    let head = c
        .query_row(
            "SELECT id,message_id,channel_id,author_id,question,multiple_choice,anonymous,closed_at,created_at,updated_at \
             FROM message_polls WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, bool>(5)?,
                    r.get::<_, bool>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(head) = head else {
        return Ok(None);
    };
    let mut s = c
        .prepare(
            "SELECT o.id,o.position,o.text, \
                    (SELECT COUNT(*) FROM message_poll_votes v WHERE v.option_id=o.id), \
                    (SELECT COUNT(*) FROM message_poll_votes v WHERE v.option_id=o.id AND v.voter_id=?2) \
             FROM message_poll_options o WHERE o.poll_id=?1 ORDER BY o.position",
        )
        .map_err(|e| e.to_string())?;
    let options = s
        .query_map(rusqlite::params![id, acting_profile_id], |r| {
            Ok(PollOptionResult {
                id: r.get(0)?,
                position: r.get(1)?,
                text: r.get(2)?,
                vote_count: r.get(3)?,
                me_voted: r.get::<_, i64>(4)? > 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(s);
    let voter_count: i64 = c
        .query_row(
            "SELECT COUNT(DISTINCT voter_id) FROM message_poll_votes WHERE poll_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(Some(PollView {
        id: head.0,
        message_id: head.1,
        channel_id: head.2,
        author_id: head.3,
        question: head.4,
        multiple_choice: head.5,
        anonymous: head.6,
        closed_at: head.7,
        created_at: head.8,
        updated_at: head.9,
        options,
        voter_count,
    }))
}

fn poll_head(c: &Connection, id: &str) -> Result<(String, String, Option<i64>, bool, String)> {
    c.query_row(
        "SELECT channel_id,author_id,closed_at,multiple_choice,message_id FROM message_polls WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "poll not found".to_string())
}

fn list_channel_polls_impl(
    c: &Connection,
    channel_id: &str,
    acting_profile_id: Option<&str>,
) -> Result<Vec<PollView>> {
    if let Some(profile_id) = acting_profile_id {
        if !channel_allows_profile(c, channel_id, profile_id)? {
            return Err("channel access denied".into());
        }
    }
    let mut s = c
        .prepare(
            "SELECT id FROM message_polls WHERE channel_id=?1 ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = s
        .query_map([channel_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(s);
    let mut out = Vec::new();
    for id in ids {
        if let Some(view) = get_poll_impl(c, &id, acting_profile_id)? {
            out.push(view);
        }
    }
    Ok(out)
}

/// Casting a ballot replaces the voter's previous one in the same transaction, so a
/// single-choice poll can never hold two rows for one voter, and the option is checked
/// to belong to THIS poll — otherwise a hand-written call could add a vote to another
/// poll's tally through a poll the caller may read.
fn vote_poll_impl(
    c: &Connection,
    poll_id: &str,
    voter_id: &str,
    option_ids: &[String],
) -> Result<PollView> {
    let (channel_id, _author, closed_at, multiple_choice, _message_id) = poll_head(c, poll_id)?;
    if closed_at.is_some() {
        return Err("poll is closed".into());
    }
    if is_read_only_channel_on(c, &channel_id)? {
        return Err("Private feeds are read-only".into());
    }
    if !channel_allows_profile(c, &channel_id, voter_id)? {
        return Err("channel access denied".into());
    }
    if !multiple_choice && option_ids.len() > 1 {
        return Err("poll accepts a single choice".into());
    }
    let mut unique = std::collections::HashSet::new();
    for option_id in option_ids {
        if !unique.insert(option_id.as_str()) {
            return Err("duplicate option in ballot".into());
        }
        let owner: Option<String> = c
            .query_row(
                "SELECT poll_id FROM message_poll_options WHERE id=?1",
                [option_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match owner.as_deref() {
            Some(found) if found == poll_id => {}
            Some(_) => return Err("option belongs to another poll".into()),
            None => return Err("poll option not found".into()),
        }
    }
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    // Retract first: an empty ballot is a valid "withdraw my vote".
    tx.execute(
        "DELETE FROM message_poll_votes WHERE poll_id=?1 AND voter_id=?2",
        rusqlite::params![poll_id, voter_id],
    )
    .map_err(|e| e.to_string())?;
    for option_id in option_ids {
        tx.execute(
            "INSERT INTO message_poll_votes(poll_id,option_id,voter_id,created_at) VALUES(?1,?2,?3,?4)",
            rusqlite::params![poll_id, option_id, voter_id, now_secs()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    get_poll_impl(c, poll_id, Some(voter_id))?.ok_or_else(|| "poll not found".to_string())
}

/// Closing is CAS on `closed_at IS NULL` and author-scoped: a closed tally is final, and
/// a second close cannot move the closing time (a retry is a no-op, not a rewrite).
fn close_poll_impl(c: &Connection, poll_id: &str, actor_id: &str) -> Result<PollView> {
    let (_channel_id, author_id, closed_at, _multi, _message_id) = poll_head(c, poll_id)?;
    if author_id != actor_id {
        return Err("only the poll author may close it".into());
    }
    if closed_at.is_none() {
        let now = now_secs();
        c.execute(
            "UPDATE message_polls SET closed_at=?2, updated_at=?2 WHERE id=?1 AND closed_at IS NULL",
            rusqlite::params![poll_id, now],
        )
        .map_err(|e| e.to_string())?;
    }
    get_poll_impl(c, poll_id, Some(actor_id))?.ok_or_else(|| "poll not found".to_string())
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

fn validate_mention_count(
    mention_ids: &[String],
    mention_team_ids: &[String],
    entity_mentions: &[MentionTarget],
) -> Result<()> {
    if mention_ids.len() + mention_team_ids.len() + entity_mentions.len() > MAX_MENTION_TARGETS {
        return Err(format!(
            "at most {MAX_MENTION_TARGETS} mention targets are allowed"
        ));
    }
    Ok(())
}

fn split_mention_targets(
    legacy_profiles: &[String],
    legacy_teams: &[String],
    targets: &[MentionTarget],
) -> Result<(Vec<String>, Vec<String>, Vec<MentionTarget>)> {
    let mut profiles = legacy_profiles.to_vec();
    let mut teams = legacy_teams.to_vec();
    let mut entities = Vec::new();
    for target in targets {
        if target.target_id.trim().is_empty() {
            return Err("invalid mention target".into());
        }
        match target.target_type.as_str() {
            "profile" => profiles.push(target.target_id.clone()),
            "team" => teams.push(target.target_id.clone()),
            "issue" | "document" => entities.push(target.clone()),
            _ => return Err("invalid mention target type".into()),
        }
    }
    Ok((profiles, teams, entities))
}

fn create_message_impl(c: &Connection, message: &Message) -> Result<()> {
    let (mention_ids, mention_team_ids, entity_mentions) = split_mention_targets(
        &message.mention_ids,
        &message.mention_team_ids,
        &message.mention_targets,
    )?;
    validate_mention_count(&mention_ids, &mention_team_ids, &entity_mentions)?;
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
        &mention_ids,
        &mention_team_ids,
        &entity_mentions,
    )?;
    crate::chat_links::sync_links_on(c, &message.id, &message.text)?;
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
#[allow(clippy::too_many_arguments)]
fn sync_mentions_impl(
    c: &Connection,
    message_id: &str,
    channel_id: &str,
    author_id: Option<&str>,
    text: &str,
    mention_ids: &[String],
    mention_team_ids: &[String],
    entity_mentions: &[MentionTarget],
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
    sync_team_mentions_impl(c, message_id, channel_id, author_id, text, mention_team_ids)?;
    sync_entity_mentions_impl(c, message_id, entity_mentions)
}

/// How many members a single team mention may alert. A mention is an interruption, so
/// naming a thousand-person team is a mistake, not a feature; the bound is a constant so
/// deployments can move it in one place.
const MAX_TEAM_MENTION_RECIPIENTS: usize = 500;

/// A team target must exist and still be live: an archived team is history, and history
/// does not get notified.
fn team_mention_target_allowed(c: &Connection, team_id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM teams WHERE id=?1 AND archived=0)",
        [team_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Who a team mention actually reaches: live members of the team, minus the author,
/// minus anyone who cannot read the channel. Membership is read at write time — the
/// alert belongs to the people who were on the team when it was named.
fn team_mention_recipients(
    c: &Connection,
    channel_id: &str,
    author_id: Option<&str>,
    team_id: &str,
) -> Result<Vec<String>> {
    let mut s = c
        .prepare(
            "SELECT DISTINCT profile_id FROM team_memberships WHERE team_id=?1 AND archived=0 ORDER BY profile_id",
        )
        .map_err(|e| e.to_string())?;
    let members: Vec<String> = s
        .query_map([team_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for profile_id in members {
        if out.len() >= MAX_TEAM_MENTION_RECIPIENTS {
            break;
        }
        if mention_target_allowed(c, channel_id, author_id, &profile_id)? {
            out.push(profile_id);
        }
    }
    Ok(out)
}

fn team_mention_notification_id(message_id: &str, team_id: &str, profile_id: &str) -> String {
    format!("mention:{message_id}:team:{team_id}:{profile_id}")
}

/// Same diff discipline as the profile mentions: a team that leaves the message loses its
/// row and every unread alert it raised, a team that arrives fans out to its members, a
/// team that survives the edit is left alone (no re-notify on a typo fix). The alert id
/// carries the team, so a person mentioned both directly and through a team keeps two
/// independent notifications and neither erases the other.
fn sync_team_mentions_impl(
    c: &Connection,
    message_id: &str,
    channel_id: &str,
    author_id: Option<&str>,
    text: &str,
    mention_team_ids: &[String],
) -> Result<()> {
    let mut wanted: Vec<String> = Vec::new();
    for team_id in mention_team_ids {
        if wanted.iter().any(|id| id == team_id) {
            continue;
        }
        if team_mention_target_allowed(c, team_id)? {
            wanted.push(team_id.clone());
        }
    }
    let existing = team_mentions_for_impl(c, message_id)?;
    for stale in existing.iter().filter(|id| !wanted.contains(id)) {
        c.execute(
            "DELETE FROM message_team_mentions WHERE message_id=?1 AND team_id=?2",
            rusqlite::params![message_id, stale],
        )
        .map_err(|e| e.to_string())?;
        // Every unread alert this team mention raised goes with it, whoever holds it:
        // membership may have changed since the write, so the rows are matched by the
        // (message, team) prefix of their id rather than by re-deriving the member list.
        c.execute(
            "DELETE FROM notifications WHERE id LIKE ?1 ESCAPE '\\' AND read_at IS NULL",
            [format!(
                "{}%",
                like_prefix(&team_mention_notification_id(message_id, stale, ""))
            )],
        )
        .map_err(|e| e.to_string())?;
    }
    for team_id in wanted.iter().filter(|id| !existing.contains(id)) {
        c.execute(
            "INSERT OR IGNORE INTO message_team_mentions(message_id,team_id) VALUES(?1,?2)",
            rusqlite::params![message_id, team_id],
        )
        .map_err(|e| e.to_string())?;
        for profile_id in team_mention_recipients(c, channel_id, author_id, team_id)? {
            c.execute("INSERT OR IGNORE INTO notifications(id,recipient_id,event_type,title,body,entity_type,entity_id) VALUES(?1,?2,'chat.mention','Your team was mentioned',?3,'message',?4)", rusqlite::params![team_mention_notification_id(message_id, team_id, &profile_id), profile_id, text, message_id]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Ids are opaque strings, so a prefix used inside LIKE has its wildcards neutralised
/// before it goes near the query.
fn like_prefix(prefix: &str) -> String {
    prefix
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn sync_entity_mentions_impl(
    c: &Connection,
    message_id: &str,
    targets: &[MentionTarget],
) -> Result<()> {
    let mut wanted = Vec::new();
    for target in targets {
        if !matches!(target.target_type.as_str(), "issue" | "document")
            || target.target_id.trim().is_empty()
        {
            return Err("invalid entity mention".into());
        }
        if !wanted.iter().any(|item: &MentionTarget| item == target) {
            wanted.push(target.clone());
        }
    }
    c.execute(
        "DELETE FROM message_entity_mentions WHERE message_id=?1",
        [message_id],
    )
    .map_err(|e| e.to_string())?;
    for target in wanted {
        c.execute("INSERT INTO message_entity_mentions(message_id,entity_type,entity_id) VALUES(?1,?2,?3)", rusqlite::params![message_id, target.target_type, target.target_id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn update_message_with_targets_impl(
    c: &Connection,
    id: &str,
    text: &str,
    mention_ids: Option<&[String]>,
    mention_team_ids: Option<&[String]>,
    mention_targets: Option<&[MentionTarget]>,
) -> Result<()> {
    if mention_ids.is_some() || mention_team_ids.is_some() || mention_targets.is_some() {
        let (profiles, teams, entities) = if let Some(targets) = mention_targets {
            split_mention_targets(&[], &[], targets)?
        } else {
            (
                mention_ids.unwrap_or(&[]).to_vec(),
                mention_team_ids.unwrap_or(&[]).to_vec(),
                Vec::new(),
            )
        };
        validate_mention_count(&profiles, &teams, &entities)?;
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
    // An edit re-derives the link set: a URL that survives keeps its preview, one that
    // left loses it, one that arrived is `pending` — an edit must never become an
    // outbound request.
    crate::chat_links::sync_links_on(c, id, text)?;
    // Omitting `mention_ids` leaves the mentions untouched: an old client that only
    // knows how to edit text must not silently strip everyone off the message.
    if mention_ids.is_some() || mention_team_ids.is_some() || mention_targets.is_some() {
        let message = get_message_impl(c, id)?.ok_or_else(|| "message not found".to_string())?;
        // An omitted list means "leave that kind of target alone", so the current rows
        // are re-sent for the side the caller did not speak about.
        let current_profiles = mentions_for_impl(c, id)?;
        let current_teams = team_mentions_for_impl(c, id)?;
        let current_entities = entity_mentions_for_impl(c, id)?;
        let (profiles, teams, entities) = if let Some(targets) = mention_targets {
            split_mention_targets(&[], &[], targets)?
        } else {
            (
                mention_ids.unwrap_or(&current_profiles).to_vec(),
                mention_team_ids.unwrap_or(&current_teams).to_vec(),
                current_entities,
            )
        };
        sync_mentions_impl(
            c,
            id,
            &message.channel_id,
            message.author_id.as_deref(),
            text,
            &profiles,
            &teams,
            &entities,
        )?;
    }
    Ok(())
}

/// Compatibility seam for existing callers that only know profile/team mention lists.
fn update_message_impl(
    c: &Connection,
    id: &str,
    text: &str,
    mention_ids: Option<&[String]>,
    mention_team_ids: Option<&[String]>,
) -> Result<()> {
    update_message_with_targets_impl(c, id, text, mention_ids, mention_team_ids, None)
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
    // A message that named one of this profile's live teams belongs in the same inbox.
    // A direct mention wins over a team mention of the same message: being named in
    // person is the stronger fact, and the inbox lists a message once.
    let mut named: Vec<(Message, String)> = msgs
        .into_iter()
        .map(|m| {
            let id = format!("mention:{}:{}", m.id, profile_id);
            (m, id)
        })
        .collect();
    let mut ts = c
        .prepare(
            "SELECT m.id,m.channel_id,m.author_id,m.text,m.created_at,m.edited_at,m.thread_of,m.archived,m.pinned,m.content_kind,tm.team_id \
             FROM message_team_mentions tm JOIN messages m ON m.id=tm.message_id \
             JOIN team_memberships mem ON mem.team_id=tm.team_id AND mem.archived=0 AND mem.profile_id=?1 \
             JOIN teams t ON t.id=tm.team_id AND t.archived=0 \
             WHERE m.archived=0 ORDER BY m.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let team_named: Vec<(Message, String)> = ts
        .query_map([profile_id], |r| {
            let team_id: String = r.get(10)?;
            let m = message_row(r)?;
            let notification_id = team_mention_notification_id(&m.id, &team_id, profile_id);
            Ok((m, notification_id))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    for (m, notification_id) in team_named {
        if named.iter().any(|(seen, _)| seen.id == m.id) {
            continue;
        }
        // The alert raised at write time is what makes a team mention this profile's:
        // the author of the message, and anyone who joined the team after it was sent,
        // hold no notification and so have nothing in their inbox.
        let alerted: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM notifications WHERE id=?1)",
                [&notification_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !alerted {
            continue;
        }
        named.push((m, notification_id));
    }
    named.sort_by(|a, b| b.0.created_at.cmp(&a.0.created_at));
    let mut out = Vec::new();
    for (m, notification_id) in named {
        // Access is re-checked at read time: leaving a private channel must hide its
        // mentions, even though the mention row survives for the message's own history.
        if !channel_allows_profile(c, &m.channel_id, profile_id)? {
            continue;
        }
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
/// Threads with replies the caller has not read. `list_channels_with_meta` filters
/// thread channels out on purpose (they are opened from their root, never listed as
/// peers), which left unread replies invisible to every surface. This is the read that
/// makes them visible — as attention, not as a destination.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_unread_threads(profile_id: String) -> Result<Vec<UnreadThread>> {
    list_unread_threads_impl(&db::conn()?, &profile_id)
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
/// Delete a channel and its whole content. `actor_id` must hold `Channel.ManageChannel`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_channel(id: String, actor_id: String) -> Result<()> {
    let mut c = db::conn()?;
    delete_channel_impl(&mut c, &id, &actor_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn join_channel(channel_id: String, profile_id: String) -> Result<()> {
    let c = db::conn()?;
    guard_inherited_membership(&c, &channel_id)?;
    add_channel_member_impl(&c, &channel_id, &profile_id, false)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn leave_channel(channel_id: String, profile_id: String) -> Result<()> {
    let c = db::conn()?;
    guard_inherited_membership(&c, &channel_id)?;
    remove_channel_member_impl(&c, &channel_id, &profile_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn add_channel_member(
    channel_id: String,
    profile_id: String,
    administrator: bool,
) -> Result<()> {
    let c = db::conn()?;
    guard_inherited_membership(&c, &channel_id)?;
    add_channel_member_impl(&c, &channel_id, &profile_id, administrator)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn remove_channel_member(channel_id: String, profile_id: String) -> Result<()> {
    let c = db::conn()?;
    guard_inherited_membership(&c, &channel_id)?;
    remove_channel_member_impl(&c, &channel_id, &profile_id)
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
/// Enough of an anchor's target to render a back-link into the conversation it came
/// from. Work created out of a message (`todos`/`issues`/`meetings.source_entity_*`)
/// stores only the pair `(entity_type, entity_id)`; this is the one reader that turns
/// that pair back into something a person can click.
#[derive(Debug, Serialize, Deserialize)]
pub struct SourceRef {
    pub entity_type: String,
    pub entity_id: String,
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub author_name: Option<String>,
    pub created_at: i64,
    /// A short, single-line rendering of the message body — never the whole text.
    pub excerpt: String,
}
/// One line, at most `SOURCE_EXCERPT_CHARS` characters, cut on a char boundary.
const SOURCE_EXCERPT_CHARS: usize = 160;
fn source_excerpt(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= SOURCE_EXCERPT_CHARS {
        return flat;
    }
    let head: String = flat.chars().take(SOURCE_EXCERPT_CHARS).collect();
    format!("{head}\u{2026}")
}
fn resolve_message_source(c: &Connection, entity_id: &str) -> Result<SourceRef> {
    c.query_row(
        "SELECT m.channel_id,ch.name,p.display_name,m.created_at,m.text FROM messages m JOIN channels ch ON ch.id=m.channel_id LEFT JOIN profiles p ON p.id=m.author_id WHERE m.id=?1",
        [entity_id],
        |r| {
            Ok(SourceRef {
                entity_type: "message".into(),
                entity_id: entity_id.to_string(),
                channel_id: r.get(0)?,
                channel_name: r.get(1)?,
                author_name: r.get(2)?,
                created_at: r.get(3)?,
                excerpt: source_excerpt(&r.get::<_, String>(4)?),
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("No message found for source anchor {entity_id}"))
}
fn resolve_source_ref_impl(
    c: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> Result<SourceRef> {
    match entity_type {
        "message" => resolve_message_source(c, entity_id),
        // A file filed out of a conversation points back at the MESSAGE it arrived in:
        // the attachment is not a place a person can stand, the message is.
        crate::documents::CHAT_ATTACHMENT_SOURCE => {
            let message_id: String = c
                .query_row(
                    "SELECT message_id FROM message_attachments WHERE id=?1",
                    [entity_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("No attachment found for source anchor {entity_id}"))?;
            resolve_message_source(c, &message_id)
        }
        other => Err(format!("Cannot resolve a {other} source anchor")),
    }
}
/// Resolve one `(source_entity_type, source_entity_id)` anchor into a renderable
/// back-link. It is a pure read of already-visible conversation metadata, so it is
/// session-scoped like `get_channel`; a deleted or unknown source errors cleanly
/// rather than silently returning an empty card.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn resolve_source_ref(entity_type: String, entity_id: String) -> Result<SourceRef> {
    resolve_source_ref_impl(&db::conn()?, &entity_type, &entity_id)
}
/// Creates (idempotently) the channel that backs one root message's content thread.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn ensure_thread_channel(
    root_message_id: String,
    title: Option<String>,
    acting_profile_id: Option<String>,
) -> Result<ThreadChannel> {
    ensure_thread_channel_impl(
        &db::conn()?,
        &root_message_id,
        title,
        acting_profile_id.as_deref(),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_messages(
    channel_id: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<MessageView>> {
    list_messages_impl(&db::conn()?, &channel_id, acting_profile_id.as_deref())
}
/// Paged history. `cursor` continues a previous page; `limit` is clamped to
/// `MAX_PAGE_LIMIT` server-side, so a client asking for a million rows gets one page.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_messages_page(
    channel_id: String,
    thread_of: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
    acting_profile_id: Option<String>,
) -> Result<MessagePage> {
    list_messages_page_impl(
        &db::conn()?,
        &channel_id,
        thread_of.as_deref(),
        cursor.as_deref(),
        limit,
        acting_profile_id.as_deref(),
    )
}

/// Fetch previews for a message's still-unfurled links. Explicit, server-side, ACL-gated,
/// and never invoked from a read path.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn unfurl_message_links(
    message_id: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<crate::chat_links::MessageLink>> {
    unfurl_message_links_impl(
        &db::conn()?,
        &message_id,
        acting_profile_id.as_deref(),
        &crate::chat_links::fetch_url,
    )
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
pub fn save_message_draft(
    channel_id: String,
    author_id: String,
    thread_key: Option<String>,
    text: String,
) -> Result<Option<MessageDraft>> {
    save_draft_impl(
        &db::conn()?,
        &channel_id,
        &author_id,
        thread_key.as_deref().unwrap_or(""),
        &text,
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_message_draft(
    channel_id: String,
    author_id: String,
    thread_key: Option<String>,
) -> Result<Option<MessageDraft>> {
    get_draft_impl(
        &db::conn()?,
        &channel_id,
        &author_id,
        thread_key.as_deref().unwrap_or(""),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_message_drafts(author_id: String) -> Result<Vec<MessageDraft>> {
    list_drafts_impl(&db::conn()?, &author_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_message_draft(
    channel_id: String,
    author_id: String,
    thread_key: Option<String>,
) -> Result<bool> {
    delete_draft_impl(
        &db::conn()?,
        &channel_id,
        &author_id,
        thread_key.as_deref().unwrap_or(""),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub fn schedule_message(
    id: String,
    channel_id: String,
    author_id: String,
    text: String,
    thread_of: Option<String>,
    scheduled_at: i64,
) -> Result<ScheduledMessage> {
    schedule_message_impl(
        &db::conn()?,
        &id,
        &channel_id,
        &author_id,
        &text,
        thread_of.as_deref(),
        scheduled_at,
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_scheduled_messages(
    author_id: String,
    channel_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<ScheduledMessage>> {
    list_scheduled_impl(
        &db::conn()?,
        &author_id,
        channel_id.as_deref(),
        status.as_deref(),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_scheduled_message(id: String, author_id: String) -> Result<ScheduledMessage> {
    owned_scheduled(&db::conn()?, &id, &author_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_scheduled_message(
    id: String,
    author_id: String,
    text: Option<String>,
    scheduled_at: Option<i64>,
) -> Result<ScheduledMessage> {
    update_scheduled_impl(&db::conn()?, &id, &author_id, text.as_deref(), scheduled_at)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn cancel_scheduled_message(id: String, author_id: String) -> Result<ScheduledMessage> {
    cancel_scheduled_impl(&db::conn()?, &id, &author_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn deliver_due_scheduled_messages(
    now: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ScheduledMessage>> {
    let c = db::conn()?;
    deliver_due_scheduled_impl(
        &c,
        now.unwrap_or_else(now_secs),
        limit.unwrap_or(SCHEDULED_TICK_LIMIT_DEFAULT),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub fn create_poll(
    id: String,
    channel_id: String,
    author_id: String,
    question: String,
    options: Vec<String>,
    multiple_choice: Option<bool>,
    anonymous: Option<bool>,
) -> Result<PollView> {
    create_poll_impl(
        &db::conn()?,
        &id,
        &channel_id,
        &author_id,
        &question,
        &options,
        multiple_choice.unwrap_or(false),
        anonymous.unwrap_or(false),
    )
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_poll(id: String, acting_profile_id: Option<String>) -> Result<PollView> {
    get_poll_impl(&db::conn()?, &id, acting_profile_id.as_deref())?
        .ok_or_else(|| "poll not found".to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channel_polls(
    channel_id: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<PollView>> {
    list_channel_polls_impl(&db::conn()?, &channel_id, acting_profile_id.as_deref())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn vote_poll(poll_id: String, voter_id: String, option_ids: Vec<String>) -> Result<PollView> {
    vote_poll_impl(&db::conn()?, &poll_id, &voter_id, &option_ids)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn close_poll(poll_id: String, author_id: String) -> Result<PollView> {
    close_poll_impl(&db::conn()?, &poll_id, &author_id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_channel_typing(channel_id: String, profile_id: String, typing: bool) -> Result<()> {
    set_typing_impl(&db::conn()?, &channel_id, &profile_id, typing)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channel_typing(
    channel_id: String,
    acting_profile_id: Option<String>,
    ttl_secs: Option<i64>,
) -> Result<Vec<TypingParticipant>> {
    list_typing_impl(
        &db::conn()?,
        &channel_id,
        acting_profile_id.as_deref(),
        ttl_secs.unwrap_or(TYPING_TTL_SECS_DEFAULT),
    )
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
/// Where a channel's uploads belong in the library, if anywhere: the project behind the
/// message's channel, plus the channel's name for the shelf label. `None` for a channel
/// with no project — there is no library to file into, so nothing is filed anywhere.
fn library_target_for_message(c: &Connection, message_id: &str) -> Result<Option<(String, String, String)>> {
    c.query_row(
        "SELECT ch.id, ch.project_id, ch.name FROM messages m JOIN channels ch ON ch.id=m.channel_id WHERE m.id=?1",
        [message_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
            ))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(|found| {
        found.and_then(|(channel_id, project_id, name)| {
            project_id
                .filter(|id| !id.trim().is_empty())
                .map(|project_id| (channel_id, project_id, name))
        })
    })
}

/// A FILE SHARED IN A PROJECT CHANNEL IS ALSO THE PROJECT'S FILE.
///
/// The attachment row is left exactly as it is; the library gets its own copy of the
/// bytes on disk, on the channel's shelf. Failure here never costs the person their
/// message: the attachment is already stored, so a library that cannot be written is
/// reported to the log and the send still succeeds.
fn file_attachment_into_library(
    c: &Connection,
    store: Option<&std::path::Path>,
    message_id: &str,
    attachment: &MessageAttachment,
) -> Result<Option<String>> {
    let Some(store) = store else {
        return Ok(None);
    };
    let Some((channel_id, project_id, channel_name)) = library_target_for_message(c, message_id)?
    else {
        return Ok(None);
    };
    let author: Option<String> = c
        .query_row(
            "SELECT author_id FROM messages WHERE id=?1",
            [message_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let bytes = decode_data_url(&attachment.data_url, attachment.byte_length)?;
    crate::documents::file_chat_attachment_tx(
        c,
        store,
        crate::documents::ChatAttachmentFiling {
            attachment_id: &attachment.id,
            project_id: &project_id,
            channel_id: &channel_id,
            channel_name: &channel_name,
            file_name: &attachment.file_name,
            created_by: author.as_deref(),
        },
        &bytes,
    )
    .map(Some)
}

fn add_message_attachment_impl(
    c: &Connection,
    message_id: &str,
    attachment: NewMessageAttachment,
) -> Result<MessageAttachment> {
    let store = crate::documents::upload_dir().ok();
    add_message_attachment_in(c, store.as_deref(), message_id, attachment)
}

fn add_message_attachment_in(
    c: &Connection,
    store: Option<&std::path::Path>,
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
            // A retry files nothing twice: the anchor already exists, so this is a no-op
            // that simply repairs a first attempt whose library copy failed.
            if let Err(e) = file_attachment_into_library(c, store, message_id, &existing) {
                eprintln!(
                    "attachment {} not filed into the project library: {e}",
                    existing.id
                );
            }
            Ok(existing)
        } else {
            Err(format!(
                "attachment id conflict: {} already stores a different payload",
                attachment.id
            ))
        };
    }
    c.execute("INSERT INTO message_attachments(id,message_id,file_name,mime_type,byte_length,data_url,upload_state,error) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL)", rusqlite::params![attachment.id, message_id, attachment.file_name, attachment.mime_type, attachment.byte_length, attachment.data_url, state]).map_err(|e| e.to_string())?;
    let stored = attachments_for_impl(c, message_id)?
        .into_iter()
        .find(|item| item.id == attachment.id)
        .ok_or_else(|| "attachment missing".to_string())?;
    if let Err(e) = file_attachment_into_library(c, store, message_id, &stored) {
        eprintln!("attachment {} not filed into the project library: {e}", stored.id);
    }
    Ok(stored)
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
    mention_team_ids: Option<Vec<String>>,
    mention_targets: Option<Vec<MentionTarget>>,
) -> Result<MessageView> {
    let c = db::conn()?;
    update_message_with_targets_impl(
        &c,
        &id,
        &text,
        mention_ids.as_deref(),
        mention_team_ids.as_deref(),
        mention_targets.as_deref(),
    )?;
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

    /// `resolve_source_ref` is the whole back-link contract: work created out of a
    /// message stores only `("message", <id>)`, so this reader must hand back the
    /// channel, the author and a readable excerpt — and must fail loudly when the
    /// anchor points at nothing, rather than rendering an empty source card.
    #[test]
    fn resolve_source_ref_returns_the_channel_behind_a_message_anchor() {
        let (c, _temp) = conn();
        seed_channel(&c, "c-source");
        c.execute("INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES('p-author','author','Ada Lovelace',unixepoch())", []).unwrap();
        c.execute(
            "INSERT INTO messages(id,channel_id,author_id,text,created_at) VALUES('m-1','c-source','p-author','Can  someone\nship the release notes?',4242)",
            [],
        )
        .unwrap();
        let resolved = resolve_source_ref_impl(&c, "message", "m-1").expect("anchor resolves");
        assert_eq!(resolved.entity_type, "message");
        assert_eq!(resolved.entity_id, "m-1");
        assert_eq!(resolved.channel_id, "c-source");
        assert_eq!(resolved.channel_name.as_deref(), Some("General"));
        assert_eq!(resolved.author_name.as_deref(), Some("Ada Lovelace"));
        assert_eq!(resolved.created_at, 4242);
        assert_eq!(
            resolved.excerpt, "Can someone ship the release notes?",
            "the excerpt is one flat line, never the raw body"
        );
        let missing = resolve_source_ref_impl(&c, "message", "m-gone").unwrap_err();
        assert!(
            missing.contains("m-gone"),
            "a dangling anchor names itself: {missing}"
        );
        let unknown = resolve_source_ref_impl(&c, "asteroid", "m-1").unwrap_err();
        assert!(
            unknown.contains("asteroid"),
            "unknown kinds fail loudly: {unknown}"
        );
    }

    /// An excerpt is a preview, not a payload: long bodies are cut on a char boundary
    /// (never a byte boundary — multi-byte text must not panic here).
    #[test]
    fn source_excerpt_is_one_short_line() {
        assert_eq!(source_excerpt("  a   b \n c "), "a b c");
        let long = "\u{00e4}".repeat(400);
        let cut = source_excerpt(&long);
        assert_eq!(cut.chars().count(), SOURCE_EXCERPT_CHARS + 1);
        assert!(cut.ends_with('\u{2026}'));
    }

    fn seed_scheduler(c: &Connection, channel: &str) {
        seed_channel(c, channel);
        c.execute(
            "INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES('default-org','org','Org',unixepoch())",
            [],
        )
        .unwrap();
    }

    fn seed_poll_voters(c: &Connection, channel: &str) {
        seed_scheduler(c, channel);
        for (id, name) in [("voter-a", "A"), ("voter-b", "B")] {
            c.execute(
                "INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?2,unixepoch())",
                rusqlite::params![id, name],
            )
            .unwrap();
        }
    }

    #[test]
    fn a_single_choice_ballot_replaces_itself_and_never_stacks() {
        let (c, path) = conn();
        seed_poll_voters(&c, "chan-poll");

        assert!(
            create_poll_impl(
                &c,
                "p-thin",
                "chan-poll",
                "default-org",
                "lunch?",
                &["only".into()],
                false,
                false
            )
            .is_err(),
            "one option is an announcement, not a poll"
        );
        assert!(create_poll_impl(
            &c,
            "p-dup",
            "chan-poll",
            "default-org",
            "lunch?",
            &["Pizza".into(), "pizza".into()],
            false,
            false
        )
        .is_err());

        let poll = create_poll_impl(
            &c,
            "p-1",
            "chan-poll",
            "default-org",
            "lunch?",
            &["pizza".into(), "sushi".into()],
            false,
            false,
        )
        .unwrap();
        assert_eq!(poll.options.len(), 2);
        // The poll is real channel content: its message exists and names the question.
        let carrier = get_message_impl(&c, &poll.message_id).unwrap().unwrap();
        assert_eq!(carrier.content_kind, "poll");
        assert_eq!(carrier.text, "lunch?");

        let pizza = poll.options[0].id.clone();
        let sushi = poll.options[1].id.clone();
        assert!(
            vote_poll_impl(&c, "p-1", "voter-a", &[pizza.clone(), sushi.clone()]).is_err(),
            "a single-choice poll refuses a two-option ballot"
        );
        vote_poll_impl(&c, "p-1", "voter-a", std::slice::from_ref(&pizza)).unwrap();
        let after = vote_poll_impl(&c, "p-1", "voter-a", std::slice::from_ref(&sushi)).unwrap();
        assert_eq!(
            after.options[0].vote_count, 0,
            "the old ballot is retracted"
        );
        assert_eq!(after.options[1].vote_count, 1);
        assert_eq!(after.voter_count, 1);
        assert!(after.options[1].me_voted);

        // An empty ballot withdraws the vote entirely.
        let withdrawn = vote_poll_impl(&c, "p-1", "voter-a", &[]).unwrap();
        assert_eq!(withdrawn.voter_count, 0);
        assert!(!withdrawn.options[1].me_voted);
        drop(path);
    }

    #[test]
    fn a_tally_counts_distinct_voters_and_leaks_no_other_ballot() {
        let (c, path) = conn();
        seed_poll_voters(&c, "chan-poll2");
        let poll = create_poll_impl(
            &c,
            "p-multi",
            "chan-poll2",
            "default-org",
            "which days?",
            &["mon".into(), "tue".into()],
            true,
            true,
        )
        .unwrap();
        let other = create_poll_impl(
            &c,
            "p-other",
            "chan-poll2",
            "default-org",
            "other",
            &["x".into(), "y".into()],
            false,
            false,
        )
        .unwrap();
        let (mon, tue) = (poll.options[0].id.clone(), poll.options[1].id.clone());

        assert!(
            vote_poll_impl(&c, "p-multi", "voter-a", &[other.options[0].id.clone()]).is_err(),
            "an option from another poll may never enter this tally"
        );
        assert!(vote_poll_impl(&c, "p-multi", "voter-a", &[mon.clone(), mon.clone()]).is_err());

        vote_poll_impl(&c, "p-multi", "voter-a", &[mon.clone(), tue.clone()]).unwrap();
        let view = vote_poll_impl(&c, "p-multi", "voter-b", std::slice::from_ref(&mon)).unwrap();
        assert_eq!(view.options[0].vote_count, 2);
        assert_eq!(view.options[1].vote_count, 1);
        assert_eq!(view.voter_count, 2, "turnout counts people, not ballots");
        // Voter B reads B's own picks only; A's second choice is never attributed.
        assert!(view.options[0].me_voted && !view.options[1].me_voted);
        let json = serde_json::to_string(&view).unwrap();
        assert!(
            !json.contains("voter-a"),
            "the read model carries counts, never voter identities: {json}"
        );
        drop(path);
    }

    #[test]
    fn only_the_author_closes_a_poll_and_a_closed_poll_takes_no_more_votes() {
        let (c, path) = conn();
        seed_poll_voters(&c, "chan-poll3");
        let poll = create_poll_impl(
            &c,
            "p-close",
            "chan-poll3",
            "default-org",
            "ship it?",
            &["yes".into(), "no".into()],
            false,
            false,
        )
        .unwrap();
        let yes = poll.options[0].id.clone();
        vote_poll_impl(&c, "p-close", "voter-a", std::slice::from_ref(&yes)).unwrap();

        assert!(close_poll_impl(&c, "p-close", "voter-a").is_err());
        let closed = close_poll_impl(&c, "p-close", "default-org").unwrap();
        let at = closed.closed_at.expect("closed");
        let again = close_poll_impl(&c, "p-close", "default-org").unwrap();
        assert_eq!(
            again.closed_at,
            Some(at),
            "a retried close never moves the closing time"
        );
        assert!(vote_poll_impl(&c, "p-close", "voter-b", &[yes]).is_err());
        assert_eq!(again.options[0].vote_count, 1, "the tally is final");

        let listed = list_channel_polls_impl(&c, "chan-poll3", Some("voter-b")).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "p-close");
        drop(path);
    }

    #[test]
    fn scheduling_requires_future_time_and_owner_may_edit_and_cancel() {
        let (c, path) = conn();
        seed_scheduler(&c, "chan-sched");
        let future = now_secs() + 600;

        assert!(
            schedule_message_impl(
                &c,
                "s-past",
                "chan-sched",
                "default-org",
                "x",
                None,
                now_secs()
            )
            .is_err(),
            "a past timestamp is a plain send, not a schedule"
        );
        assert!(schedule_message_impl(
            &c,
            "s-empty",
            "chan-sched",
            "default-org",
            "   ",
            None,
            future
        )
        .is_err());

        let row = schedule_message_impl(
            &c,
            "s-1",
            "chan-sched",
            "default-org",
            "later",
            None,
            future,
        )
        .unwrap();
        assert_eq!(row.status, "pending");

        assert!(
            owned_scheduled(&c, "s-1", "someone-else").is_err(),
            "an unsent intent is private to its author"
        );
        assert!(update_scheduled_impl(&c, "s-1", "someone-else", Some("hack"), None).is_err());

        let edited =
            update_scheduled_impl(&c, "s-1", "default-org", Some("later, edited"), None).unwrap();
        assert_eq!(edited.text, "later, edited");

        let cancelled = cancel_scheduled_impl(&c, "s-1", "default-org").unwrap();
        assert_eq!(cancelled.status, "cancelled");
        // cancel is idempotent, and a cancelled intent can no longer be rewritten
        assert_eq!(
            cancel_scheduled_impl(&c, "s-1", "default-org")
                .unwrap()
                .status,
            "cancelled"
        );
        assert!(update_scheduled_impl(&c, "s-1", "default-org", Some("zombie"), None).is_err());

        drop(c);
        drop(path);
    }

    #[test]
    fn delivery_is_bounded_idempotent_and_skips_cancelled() {
        let (c, path) = conn();
        seed_scheduler(&c, "chan-deliver");
        let future = now_secs() + 60;
        for id in ["d-1", "d-2", "d-3"] {
            schedule_message_impl(&c, id, "chan-deliver", "default-org", id, None, future).unwrap();
        }
        cancel_scheduled_impl(&c, "d-3", "default-org").unwrap();

        // not due yet
        assert!(deliver_due_scheduled_impl(&c, future - 1, 10)
            .unwrap()
            .is_empty());

        // bounded tick: one per run
        let first = deliver_due_scheduled_impl(&c, future, 1).unwrap();
        assert_eq!(first.len(), 1);
        let second = deliver_due_scheduled_impl(&c, future, 10).unwrap();
        assert_eq!(
            second.len(),
            1,
            "remaining pending intent, cancelled one skipped"
        );
        assert!(deliver_due_scheduled_impl(&c, future, 10)
            .unwrap()
            .is_empty());

        let sent = get_scheduled_impl(&c, "d-1").unwrap().unwrap();
        assert_eq!(sent.status, "sent");
        assert_eq!(sent.sent_message_id.as_deref(), Some("sched-d-1"));
        let posted: i64 = c
            .query_row(
                "SELECT count(*) FROM messages WHERE channel_id='chan-deliver'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(posted, 2, "exactly one message per delivered intent");

        drop(c);
        drop(path);
    }

    #[test]
    fn thread_target_must_live_in_the_same_channel() {
        let (c, path) = conn();
        seed_scheduler(&c, "chan-a");
        seed_channel(&c, "chan-b");
        create_message_impl(
            &c,
            &Message {
                id: "root-b".to_string(),
                channel_id: "chan-b".to_string(),
                author_id: Some("default-org".to_string()),
                text: "root".to_string(),
                created_at: now_secs(),
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                content_kind: default_message_content_kind(),
                mention_ids: Vec::new(),
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
            },
        )
        .unwrap();
        let future = now_secs() + 60;
        assert!(schedule_message_impl(
            &c,
            "s-x",
            "chan-a",
            "default-org",
            "cross",
            Some("root-b"),
            future
        )
        .is_err());
        assert!(schedule_message_impl(
            &c,
            "s-y",
            "chan-a",
            "default-org",
            "ghost",
            Some("nope"),
            future
        )
        .is_err());
        drop(c);
        drop(path);
    }

    #[test]
    fn draft_upserts_per_thread_and_clearing_removes_it() {
        let (c, path) = conn();
        seed_channel(&c, "chan-draft");
        c.execute(
            "INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES('default-org','org','Org',unixepoch())",
            [],
        )
        .unwrap();

        let first = save_draft_impl(&c, "chan-draft", "default-org", "", "hello")
            .unwrap()
            .expect("draft stored");
        assert_eq!(first.text, "hello");
        // a second save is an update, not a second row
        save_draft_impl(&c, "chan-draft", "default-org", "", "hello there").unwrap();
        // a thread draft is independent of the channel-root draft
        save_draft_impl(&c, "chan-draft", "default-org", "root-1", "reply body").unwrap();

        let drafts = list_drafts_impl(&c, "default-org").unwrap();
        assert_eq!(drafts.len(), 2, "root + thread draft, no duplicates");
        assert_eq!(
            get_draft_impl(&c, "chan-draft", "default-org", "")
                .unwrap()
                .map(|d| d.text),
            Some("hello there".into())
        );

        // clearing the composer must not resurrect the old body on reload
        assert_eq!(
            save_draft_impl(&c, "chan-draft", "default-org", "", "   ").unwrap(),
            None
        );
        assert_eq!(
            get_draft_impl(&c, "chan-draft", "default-org", "").unwrap(),
            None
        );
        // deleting an absent draft is success, so send-then-clear is retry-safe
        assert!(!delete_draft_impl(&c, "chan-draft", "default-org", "").unwrap());
        assert!(delete_draft_impl(&c, "chan-draft", "default-org", "root-1").unwrap());
        drop(c);
        drop(path);
    }

    #[test]
    fn typing_excludes_self_expires_and_can_be_retracted() {
        let (c, path) = conn();
        seed_channel(&c, "chan-type");
        seed_profiles(&c, &["default-org", "other"]);

        set_typing_impl(&c, "chan-type", "default-org", true).unwrap();
        set_typing_impl(&c, "chan-type", "other", true).unwrap();
        let seen = list_typing_impl(&c, "chan-type", Some("default-org"), 60).unwrap();
        assert_eq!(
            seen.iter()
                .map(|t| t.profile_id.as_str())
                .collect::<Vec<_>>(),
            vec!["other"],
            "a reader never sees their own beat"
        );

        // an aged beat is swept, not shown: no stuck "typing…" after a client dies
        c.execute(
            "UPDATE channel_typing SET updated_at=updated_at-3600 WHERE profile_id='other'",
            [],
        )
        .unwrap();
        assert!(list_typing_impl(&c, "chan-type", Some("default-org"), 60)
            .unwrap()
            .is_empty());
        let remaining: i64 = c
            .query_row("SELECT count(*) FROM channel_typing", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1, "expired rows are swept at read time");

        // explicit retraction beats the TTL
        set_typing_impl(&c, "chan-type", "other", true).unwrap();
        set_typing_impl(&c, "chan-type", "other", false).unwrap();
        assert!(list_typing_impl(&c, "chan-type", Some("default-org"), 60)
            .unwrap()
            .is_empty());
        drop(c);
        drop(path);
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
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
                content_kind: "text".into(),
            },
        )
        .unwrap();
    }

    /// A channel that belongs to a project, plus one message in it. The project row is
    /// created here because `channels.project_id` is a real foreign key.
    fn seed_project_message(c: &Connection, channel: &str, id: &str, project: Option<&str>) {
        if let Some(project) = project {
            c.execute(
                "INSERT INTO projects(id,name,key,created_at) VALUES(?1,'Filing','FIL',unixepoch())",
                [project],
            )
            .unwrap();
        }
        seed_message(c, channel, id);
        c.execute(
            "UPDATE channels SET project_id=?2, name='general' WHERE id=?1",
            rusqlite::params![channel, project],
        )
        .unwrap();
    }

    fn library_documents(c: &Connection, project: &str) -> Vec<(String, String, String)> {
        let mut s = c
            .prepare(
                "SELECT d.id, d.title, f.name FROM documents d JOIN document_folders f ON f.id=d.folder_id \
                 WHERE d.container_type='project' AND d.container_id=?1 ORDER BY d.id",
            )
            .unwrap();
        let rows = s
            .query_map([project], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        rows
    }

    /// A FILE SHARED IN A PROJECT CHANNEL IS THE PROJECT'S FILE. It appears on the
    /// channel's own shelf under the project root — not loose in the root, where chat
    /// screenshots would bury the written documents — and it carries the same bytes.
    #[test]
    fn an_attachment_in_a_project_channel_is_filed_on_the_channels_library_shelf() {
        let (c, path) = conn();
        let store = path.path().parent().unwrap().join("document_files");
        seed_project_message(&c, "chan-lib", "msg-lib", Some("proj-lib"));
        add_message_attachment_in(
            &c,
            Some(&store),
            "msg-lib",
            NewMessageAttachment {
                id: "att-lib".into(),
                file_name: "plan.txt".into(),
                mime_type: "text/plain".into(),
                byte_length: 5,
                data_url: "data:text/plain;base64,aGVsbG8=".into(),
                upload_state: None,
            },
        )
        .expect("attachment stored");

        let filed = library_documents(&c, "proj-lib");
        assert_eq!(filed.len(), 1, "exactly one library document");
        assert_eq!(filed[0].1, "plan.txt", "the title is the file name");
        assert_eq!(filed[0].2, "From #general", "filed on the channel's shelf");

        // The shelf hangs under the project root, never beside it.
        let (parent, container): (Option<String>, Option<String>) = c
            .query_row(
                "SELECT parent_id, container_id FROM document_folders WHERE name='From #general'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(container.as_deref(), Some("proj-lib"));
        assert!(parent.is_some(), "the shelf sits under the project root");

        // Origin is recorded and resolves back to the message it arrived in.
        let anchor: (String, String) = c
            .query_row(
                "SELECT source_entity_type, source_entity_id FROM documents WHERE id=?1",
                [&filed[0].0],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(anchor, ("message-attachment".to_string(), "att-lib".into()));
        let back = resolve_source_ref_impl(&c, "message-attachment", "att-lib").expect("back-link");
        assert_eq!(back.channel_id, "chan-lib");

        // Bytes on disk ARE the attachment's bytes, stored once.
        let stored_path: String = c
            .query_row(
                "SELECT stored_path FROM document_files WHERE document_id=?1",
                [&filed[0].0],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(std::fs::read(stored_path).unwrap(), b"hello");
        drop(c);
        drop(path);
    }

    /// A RETRY IS NOT A SECOND DOCUMENT. The client repeats an upload it lost the answer
    /// to; the library must not grow a duplicate card for it.
    #[test]
    fn refiling_the_same_attachment_leaves_one_library_document() {
        let (c, path) = conn();
        let store = path.path().parent().unwrap().join("document_files");
        seed_project_message(&c, "chan-twice", "msg-twice", Some("proj-twice"));
        let attachment = || NewMessageAttachment {
            id: "att-twice".into(),
            file_name: "shot.png".into(),
            mime_type: "image/png".into(),
            byte_length: 5,
            data_url: "data:image/png;base64,aGVsbG8=".into(),
            upload_state: None,
        };
        add_message_attachment_in(&c, Some(&store), "msg-twice", attachment()).unwrap();
        add_message_attachment_in(&c, Some(&store), "msg-twice", attachment()).unwrap();
        assert_eq!(
            library_documents(&c, "proj-twice").len(),
            1,
            "the same attachment files once"
        );
        drop(c);
        drop(path);
    }

    /// NO PROJECT, NO FILING. A channel without a project has no library to file into,
    /// so the upload stays what it is: an attachment on a message.
    #[test]
    fn an_attachment_in_a_projectless_channel_creates_no_document() {
        let (c, path) = conn();
        let store = path.path().parent().unwrap().join("document_files");
        seed_project_message(&c, "chan-loose", "msg-loose", None);
        add_message_attachment_in(
            &c,
            Some(&store),
            "msg-loose",
            new_attachment("att-loose", "data:text/plain;base64,aGVsbG8=", 5, None),
        )
        .unwrap();
        let documents: i64 = c
            .query_row("SELECT count(*) FROM documents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(documents, 0, "nothing is filed anywhere");
        drop(c);
        drop(path);
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
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
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
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
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

    fn post_teams(
        c: &Connection,
        channel: &str,
        id: &str,
        author: &str,
        teams: &[&str],
    ) -> Result<()> {
        create_message_impl(
            c,
            &Message {
                id: id.into(),
                channel_id: channel.into(),
                author_id: Some(author.into()),
                text: "hey team".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                mention_ids: Vec::new(),
                mention_team_ids: teams.iter().map(|s| s.to_string()).collect(),
                mention_targets: Vec::new(),
                content_kind: "text".into(),
            },
        )
    }

    fn seed_team(c: &Connection, team: &str, members: &[&str]) {
        c.execute(
            "INSERT OR IGNORE INTO teams(id,name,archived) VALUES(?1,?1,0)",
            [team],
        )
        .unwrap();
        for member in members {
            c.execute(
                "INSERT INTO team_memberships(id,profile_id,team_id,archived) VALUES(?1,?2,?3,0)",
                rusqlite::params![format!("{team}-{member}"), member, team],
            )
            .unwrap();
        }
    }

    #[test]
    fn a_team_mention_fans_out_to_its_live_members_only() {
        let (c, path) = conn();
        seed_channel(&c, "chan-tm");
        seed_profiles(&c, &["alice", "bob", "carol", "dave"]);
        seed_team(&c, "team-a", &["alice", "bob", "carol"]);
        // carol left the team: an archived membership is not a recipient
        c.execute(
            "UPDATE team_memberships SET archived=1 WHERE id='team-a-carol'",
            [],
        )
        .unwrap();
        post_teams(
            &c,
            "chan-tm",
            "msg-tm1",
            "alice",
            &["team-a", "team-a", "ghost-team"],
        )
        .unwrap();
        // duplicates collapse, an unknown team is ignored, the row records the utterance
        assert_eq!(
            team_mentions_for_impl(&c, "msg-tm1").unwrap(),
            vec!["team-a".to_string()]
        );
        let view = list_messages_impl(&c, "chan-tm", Some("alice")).unwrap();
        assert_eq!(view[0].message.mention_team_ids, vec!["team-a".to_string()]);
        // bob is alerted; the author is not, the ex-member is not, the outsider is not
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 1);
        assert_eq!(count_unread_mentions_impl(&c, "alice").unwrap(), 0);
        assert_eq!(count_unread_mentions_impl(&c, "carol").unwrap(), 0);
        assert_eq!(count_unread_mentions_impl(&c, "dave").unwrap(), 0);
        // the inbox carries the message once, under the team-scoped notification id
        let inbox = list_mentions_for_profile_impl(&c, "bob", false).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].message.message.id, "msg-tm1");
        assert_eq!(inbox[0].notification_id, "mention:msg-tm1:team:team-a:bob");
        drop(c);
        drop(path);
    }

    #[test]
    fn a_team_mention_never_reaches_a_member_who_cannot_read_the_channel() {
        let (c, path) = conn();
        seed_profiles(&c, &["alice", "bob"]);
        seed_team(&c, "team-p", &["alice", "bob"]);
        create_channel_impl(
            &c,
            &Channel {
                id: "chan-tp".into(),
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
        add_channel_member_impl(&c, "chan-tp", "alice", true).unwrap();
        post_teams(&c, "chan-tp", "msg-tp", "alice", &["team-p"]).unwrap();
        // the team mention is stored (it was said) but bob, who cannot open the
        // channel, gets neither an alert nor an inbox entry
        assert_eq!(
            team_mentions_for_impl(&c, "msg-tp").unwrap(),
            vec!["team-p".to_string()]
        );
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 0);
        assert!(list_mentions_for_profile_impl(&c, "bob", false)
            .unwrap()
            .is_empty());
        drop(c);
        drop(path);
    }

    #[test]
    fn editing_a_message_diffs_its_team_mentions() {
        let (c, path) = conn();
        seed_channel(&c, "chan-td");
        seed_profiles(&c, &["alice", "bob", "carol"]);
        seed_team(&c, "team-x", &["bob"]);
        seed_team(&c, "team-y", &["carol"]);
        post_teams(&c, "chan-td", "msg-td", "alice", &["team-x"]).unwrap();
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 1);
        // omitting the team list leaves the team mentions untouched
        update_message_impl(&c, "msg-td", "typo fixed", None, None).unwrap();
        assert_eq!(
            team_mentions_for_impl(&c, "msg-td").unwrap(),
            vec!["team-x".to_string()]
        );
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 1);
        // swapping the team drops bob's unread alert and raises carol's
        update_message_impl(
            &c,
            "msg-td",
            "now team y",
            None,
            Some(&["team-y".to_string()]),
        )
        .unwrap();
        assert_eq!(
            team_mentions_for_impl(&c, "msg-td").unwrap(),
            vec!["team-y".to_string()]
        );
        assert_eq!(count_unread_mentions_impl(&c, "bob").unwrap(), 0);
        assert_eq!(count_unread_mentions_impl(&c, "carol").unwrap(), 1);
        // a read alert of a dropped team is history and stays
        c.execute(
            "UPDATE notifications SET read_at=unixepoch() WHERE id='mention:msg-td:team:team-y:carol'",
            [],
        )
        .unwrap();
        update_message_impl(&c, "msg-td", "nobody", None, Some(&[])).unwrap();
        assert!(team_mentions_for_impl(&c, "msg-td").unwrap().is_empty());
        let kept: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM notifications WHERE id='mention:msg-td:team:team-y:carol'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kept, 1);
        drop(c);
        drop(path);
    }

    #[test]
    fn typed_entity_mention_is_durable_and_returned_with_profile_targets() {
        let (c, path) = conn();
        seed_channel(&c, "chan-entity");
        seed_profiles(&c, &["alice", "bob"]);
        let message = Message {
            id: "msg-entity".into(),
            channel_id: "chan-entity".into(),
            author_id: Some("alice".into()),
            text: "See this".into(),
            created_at: 1,
            edited_at: None,
            thread_of: None,
            archived: false,
            pinned: false,
            content_kind: "text".into(),
            mention_ids: Vec::new(),
            mention_team_ids: Vec::new(),
            mention_targets: vec![
                MentionTarget {
                    target_type: "profile".into(),
                    target_id: "bob".into(),
                },
                MentionTarget {
                    target_type: "issue".into(),
                    target_id: "issue-7".into(),
                },
            ],
        };
        create_message_impl(&c, &message).unwrap();
        let view = to_view(
            &c,
            get_message_impl(&c, "msg-entity").unwrap().unwrap(),
            Some("alice"),
        )
        .unwrap();
        assert!(view
            .message
            .mention_targets
            .iter()
            .any(|target| target.target_type == "profile" && target.target_id == "bob"));
        assert!(view
            .message
            .mention_targets
            .iter()
            .any(|target| target.target_type == "issue" && target.target_id == "issue-7"));
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM message_entity_mentions WHERE message_id='msg-entity'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn typed_entity_mention_update_replaces_the_whole_typed_set() {
        let (c, path) = conn();
        seed_channel(&c, "chan-entity-update");
        seed_profiles(&c, &["alice", "bob"]);
        create_message_impl(
            &c,
            &Message {
                id: "msg-entity-update".into(),
                channel_id: "chan-entity-update".into(),
                author_id: Some("alice".into()),
                text: "first".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
                mention_team_ids: Vec::new(),
                mention_targets: vec![MentionTarget {
                    target_type: "issue".into(),
                    target_id: "issue-old".into(),
                }],
            },
        )
        .unwrap();
        update_message_with_targets_impl(
            &c,
            "msg-entity-update",
            "second",
            None,
            None,
            Some(&[
                MentionTarget {
                    target_type: "profile".into(),
                    target_id: "bob".into(),
                },
                MentionTarget {
                    target_type: "document".into(),
                    target_id: "doc-new".into(),
                },
            ]),
        )
        .unwrap();
        let view = to_view(
            &c,
            get_message_impl(&c, "msg-entity-update").unwrap().unwrap(),
            Some("alice"),
        )
        .unwrap();
        assert_eq!(
            view.message.mention_targets,
            vec![
                MentionTarget {
                    target_type: "profile".into(),
                    target_id: "bob".into()
                },
                MentionTarget {
                    target_type: "document".into(),
                    target_id: "doc-new".into()
                },
            ]
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn profile_and_team_mention_targets_share_one_bound() {
        let (c, path) = conn();
        seed_channel(&c, "chan-tb");
        seed_profiles(&c, &["alice"]);
        let teams = (0..MAX_MENTION_TARGETS)
            .map(|n| format!("t{n}"))
            .collect::<Vec<_>>();
        let message = Message {
            id: "msg-tb".into(),
            channel_id: "chan-tb".into(),
            author_id: Some("alice".into()),
            text: "flood".into(),
            created_at: 1,
            edited_at: None,
            thread_of: None,
            archived: false,
            pinned: false,
            mention_ids: vec!["alice".to_string()],
            mention_team_ids: teams,
            mention_targets: Vec::new(),
            content_kind: "text".into(),
        };
        assert!(create_message_impl(&c, &message)
            .unwrap_err()
            .contains("at most"));
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
            mention_team_ids: Vec::new(),
            mention_targets: Vec::new(),
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
        assert!(update_message_impl(&c, "msg-m-limit-ok", "flood", Some(&too_many), None).is_err());
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
        update_message_impl(&c, "msg-m3", "typo fixed", None, None).unwrap();
        assert_eq!(
            mentions_for_impl(&c, "msg-m3").unwrap(),
            vec!["bob".to_string()]
        );
        // an explicit list is the whole truth: bob leaves, carol arrives
        update_message_impl(
            &c,
            "msg-m3",
            "now carol",
            Some(&["carol".to_string()]),
            None,
        )
        .unwrap();
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
        update_message_impl(&c, "msg-m3", "nobody", Some(&[]), None).unwrap();
        assert_eq!(count_unread_mentions_impl(&c, "carol").unwrap(), 0);
        assert!(update_message_impl(&c, "msg-nope", "x", None, None).is_err());
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
            mention_team_ids: Vec::new(),
            mention_targets: Vec::new(),
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
            mention_team_ids: Vec::new(),
            mention_targets: Vec::new(),
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

    /// Builds `parent` (private, members = `members`), a root message by `root_author`,
    /// its thread channel, and returns the thread channel id. Replies are added by the
    /// caller so each test controls authorship and time explicitly.
    fn seed_thread(c: &Connection, parent: &str, members: &[&str], root_author: &str) -> String {
        create_channel_impl(
            c,
            &Channel {
                id: parent.into(),
                content_type: "private".into(),
                name: Some("Design".into()),
                description: None,
                project_id: None,
                archived: false,
                read_only: false,
            },
            &members.iter().map(|m| m.to_string()).collect::<Vec<_>>(),
        )
        .unwrap();
        let root = format!("{parent}-root");
        reply_at(c, parent, &root, root_author, 10, "the root question");
        ensure_thread_channel_impl(c, &root, Some("Discuss".into()), Some(root_author))
            .unwrap()
            .channel
            .id
    }
    fn reply_at(c: &Connection, channel: &str, id: &str, author: &str, at: i64, text: &str) {
        create_message_impl(
            c,
            &Message {
                id: id.into(),
                channel_id: channel.into(),
                author_id: Some(author.into()),
                text: text.into(),
                created_at: at,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
            },
        )
        .unwrap();
    }

    /// The whole point: I asked, somebody answered, and that answer is work for me.
    /// The row must arrive complete — a worklist that needs a second call to say who
    /// replied would render "someone replied somewhere".
    #[test]
    fn a_participant_sees_their_thread_with_unread_replies_and_the_row_is_complete() {
        let (c, path) = conn();
        seed_profiles(&c, &["asker", "answerer"]);
        let thread = seed_thread(&c, "chan-unread", &["asker", "answerer"], "asker");
        reply_at(&c, &thread, "r1", "answerer", 20, "first answer");
        reply_at(&c, &thread, "r2", "answerer", 30, "second answer");

        let rows = list_unread_threads_impl(&c, "asker").unwrap();
        assert_eq!(rows.len(), 1, "the thread I started and have not read");
        let row = &rows[0];
        assert_eq!(row.channel_id, thread);
        assert_eq!(row.parent_channel_id, "chan-unread");
        assert_eq!(row.parent_channel_name.as_deref(), Some("Design"));
        assert_eq!(row.root_message_id, "chan-unread-root");
        assert_eq!(row.root_excerpt, "the root question");
        assert_eq!(row.unread_count, 2);
        assert_eq!(row.last_reply_at, Some(30));
        assert_eq!(row.last_reply_author.as_deref(), Some("answerer-user"));
        drop(c);
        drop(path);
    }

    /// Participation is the address. A member of the parent channel who never touched
    /// the thread is a bystander; putting that traffic in the worklist is the exact
    /// noise the one attention rule exists to keep out.
    #[test]
    fn a_non_participant_of_the_thread_is_not_asked_to_attend_it() {
        let (c, path) = conn();
        seed_profiles(&c, &["asker", "answerer", "bystander"]);
        let thread = seed_thread(&c, "chan-bystander", &["asker", "answerer", "bystander"], "asker");
        reply_at(&c, &thread, "r1", "answerer", 20, "answer");

        assert!(
            channel_allows_profile(&c, &thread, "bystander").unwrap(),
            "the bystander CAN read the thread — so absence below is the participation \
             rule, not an access failure"
        );
        assert!(list_unread_threads_impl(&c, "bystander").unwrap().is_empty());
        assert_eq!(list_unread_threads_impl(&c, "asker").unwrap().len(), 1);
        drop(c);
        drop(path);
    }

    /// THE INHERITANCE LAW. A thread never widens its parent's boundary, and this read
    /// must not be the hole. Checked through `channel_allows_profile`, the same
    /// predicate the rest of chat uses — there is no second ACL path here to drift.
    #[test]
    fn a_non_member_of_the_parent_channel_never_sees_the_thread() {
        let (c, path) = conn();
        seed_profiles(&c, &["asker", "outsider"]);
        let thread = seed_thread(&c, "chan-private", &["asker", "outsider"], "asker");
        // The outsider even PARTICIPATES: they replied while they were still a member,
        // and were then removed from the PARENT. Participation survives in the data;
        // the parent's boundary must still overrule it.
        reply_at(&c, &thread, "r1", "outsider", 20, "answer");
        reply_at(&c, &thread, "r2", "asker", 25, "thanks");
        remove_channel_member_impl(&c, "chan-private", "outsider").unwrap();

        assert!(!channel_allows_profile(&c, &thread, "outsider").unwrap());
        assert!(
            list_unread_threads_impl(&c, "outsider").unwrap().is_empty(),
            "the parent ACL overrules participation"
        );
        assert_eq!(list_unread_threads_impl(&c, "asker").unwrap().len(), 1);
        drop(c);
        drop(path);
    }

    /// The worklist EMPTIES. Reading the replies is the resolution, and it must clear
    /// the row through the ordinary read-state write — no separate dismissal state.
    #[test]
    fn reading_the_replies_clears_the_thread_from_the_worklist() {
        let (c, path) = conn();
        seed_profiles(&c, &["asker", "answerer"]);
        let thread = seed_thread(&c, "chan-clear", &["asker", "answerer"], "asker");
        reply_at(&c, &thread, "r1", "answerer", 20, "answer");
        assert_eq!(list_unread_threads_impl(&c, "asker").unwrap().len(), 1);

        mark_channel_read_impl(&c, &thread, "asker", None).unwrap();
        assert!(list_unread_threads_impl(&c, "asker").unwrap().is_empty());
        drop(c);
        drop(path);
    }

    /// A thread with nothing new is not work. Includes the case that would otherwise
    /// make this feature self-defeating: posting does NOT mark a channel read, so
    /// without the authorship condition your own reply would file a task against you.
    #[test]
    fn a_thread_with_no_unread_replies_from_others_is_absent() {
        let (c, path) = conn();
        seed_profiles(&c, &["asker", "answerer"]);
        let quiet = seed_thread(&c, "chan-quiet", &["asker", "answerer"], "asker");
        assert!(
            list_unread_threads_impl(&c, "asker").unwrap().is_empty(),
            "a thread nobody has replied in yet"
        );

        reply_at(&c, &quiet, "mine", "asker", 20, "following up on myself");
        assert!(
            list_unread_threads_impl(&c, "asker").unwrap().is_empty(),
            "my own reply is never a claim on my attention"
        );

        reply_at(&c, &quiet, "theirs", "answerer", 30, "real answer");
        assert_eq!(
            list_unread_threads_impl(&c, "asker").unwrap()[0].unread_count,
            1,
            "only the other person's reply counts"
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn a_thread_is_a_hidden_channel_that_inherits_private_parent_access() {
        let (c, path) = conn();
        seed_profiles(&c, &["thread-owner", "thread-outsider"]);
        create_channel_impl(
            &c,
            &Channel {
                id: "private-parent".into(),
                content_type: "private".into(),
                name: Some("Private".into()),
                description: None,
                project_id: None,
                archived: false,
                read_only: false,
            },
            &["thread-owner".into()],
        )
        .unwrap();
        create_message_impl(
            &c,
            &Message {
                id: "thread-root-channel".into(),
                channel_id: "private-parent".into(),
                author_id: Some("thread-owner".into()),
                text: "root".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
            },
        )
        .unwrap();
        let thread = ensure_thread_channel_impl(
            &c,
            "thread-root-channel",
            Some("Discuss".into()),
            Some("thread-owner"),
        )
        .unwrap();
        assert_eq!(thread.channel.id, "thread:thread-root-channel");
        assert!(thread.skip_first_message);
        assert!(!channel_allows_profile(&c, &thread.channel.id, "thread-outsider").unwrap());
        create_message_impl(
            &c,
            &Message {
                id: "thread-channel-reply".into(),
                channel_id: thread.channel.id.clone(),
                author_id: Some("thread-owner".into()),
                text: "reply".into(),
                created_at: 2,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                content_kind: "text".into(),
                mention_ids: Vec::new(),
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(
            to_view(
                &c,
                get_message_impl(&c, "thread-root-channel")
                    .unwrap()
                    .unwrap(),
                Some("thread-owner")
            )
            .unwrap()
            .reply_count,
            1
        );
        assert!(list_channels_with_meta_impl(&c, "thread-owner")
            .unwrap()
            .iter()
            .all(|row| row.channel.id != thread.channel.id));
        assert_eq!(
            list_messages_impl(&c, &thread.channel.id, Some("thread-owner"))
                .unwrap()
                .len(),
            1
        );
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
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
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
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
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

    /// THE BUG THIS ENCODES: the channel header counted `channel_members` ("1 members")
    /// while the project's team rail listed four people. Membership of a project channel
    /// is the PROJECT's membership — count, list and read access all read it now.
    #[test]
    fn a_project_channel_inherits_the_projects_people() {
        let (c, path) = conn();
        for (id, username) in [("owner", "owner-user"), ("teammate", "team-user"), ("stranger", "stranger-user")] {
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?2,unixepoch())",
                rusqlite::params![id, username],
            ).unwrap();
        }
        c.execute_batch(
            "INSERT INTO projects(id,name,key,created_by,created_at) VALUES('pr','Atlas','ATL','owner',1);\
             INSERT INTO project_members(project_id,profile_id) VALUES('pr','teammate');",
        )
        .unwrap();
        create_channel_impl(
            &c,
            &Channel {
                id: "c-exist".into(),
                content_type: "private".into(),
                name: Some("EXIST".into()),
                description: None,
                project_id: Some("pr".into()),
                archived: false,
                read_only: false,
            },
            &["default-org".into()],
        )
        .unwrap();

        let members = list_channel_members_impl(&c, "c-exist").unwrap();
        let ids: Vec<_> = members.iter().map(|m| m.profile_id.as_str()).collect();
        assert_eq!(ids, vec!["default-org", "owner", "teammate"], "project people are channel people");
        assert_eq!(member_count_impl(&c, "c-exist").unwrap(), 3, "the header counts the same list");
        assert!(members.iter().any(|m| m.profile_id == "owner" && m.administrator),
                "the project's owner is an administrator of its conversations");

        // Access follows the same single source of truth — no row was ever written for them.
        assert!(channel_allows_profile(&c, "c-exist", "teammate").unwrap());
        assert!(!channel_allows_profile(&c, "c-exist", "stranger").unwrap());

        // A free channel keeps its own, directly editable membership.
        seed_channel(&c, "c-loose");
        assert_eq!(member_count_impl(&c, "c-loose").unwrap(), 1);
        drop(c);
        drop(path);
    }

    /// The refusal is the other half of the policy: a write that cannot change anything
    /// (the project keeps granting access) must not pretend to have happened.
    #[test]
    fn membership_of_a_project_channel_is_edited_on_the_project() {
        let (c, path) = conn();
        c.execute_batch(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('owner','o','O',unixepoch());\
             INSERT INTO projects(id,name,key,created_by,created_at) VALUES('pr','Atlas','ATL','owner',1);",
        )
        .unwrap();
        create_channel_impl(
            &c,
            &Channel {
                id: "c-bound".into(),
                content_type: "public".into(),
                name: Some("bound".into()),
                description: None,
                project_id: Some("pr".into()),
                archived: false,
                read_only: false,
            },
            &[],
        )
        .unwrap();
        seed_channel(&c, "c-free");

        let refused = guard_inherited_membership(&c, "c-bound").unwrap_err();
        assert!(refused.contains("project"), "the refusal says where members are managed: {refused}");
        assert!(guard_inherited_membership(&c, "c-free").is_ok(), "a free channel manages its own");
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
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
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

    // ---- V118: history paging + link unfurling ---------------------------------

    /// All rows share one `created_at` on purpose: a timestamp-only cursor would drop or
    /// repeat rows here, so this fixture is the tie-break test's whole point.
    fn seed_history(c: &Connection, channel: &str, count: usize) {
        seed_scheduler(c, channel);
        for i in 0..count {
            c.execute(
                "INSERT INTO messages(id,channel_id,author_id,text,created_at,thread_of,archived,pinned,content_kind) \
                 VALUES(?1,?2,'default-org',?3,100,NULL,0,0,'text')",
                rusqlite::params![format!("m-{i:02}"), channel, format!("line {i}")],
            )
            .unwrap();
        }
    }

    #[test]
    fn paging_walks_a_tied_timestamp_history_exactly_once() {
        let (c, path) = conn();
        seed_history(&c, "chan-page", 7);

        let mut seen: Vec<String> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let page =
                list_messages_page_impl(&c, "chan-page", None, cursor.as_deref(), Some(3), None)
                    .unwrap();
            seen.extend(page.messages.iter().map(|m| m.message.id.clone()));
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => {
                    assert!(!page.has_more);
                    break;
                }
            }
        }
        // Every row once, newest id first (ids tie on time, so id breaks it).
        let mut unique = seen.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 7, "paging repeated or skipped rows: {seen:?}");
        assert_eq!(seen.first().unwrap(), "m-06");
        assert_eq!(seen.last().unwrap(), "m-00");
        drop(c);
        drop(path);
    }

    #[test]
    fn a_page_limit_is_clamped_and_a_forged_cursor_is_refused() {
        let (c, path) = conn();
        seed_history(&c, "chan-clamp", 3);

        let huge =
            list_messages_page_impl(&c, "chan-clamp", None, None, Some(1_000_000), None).unwrap();
        assert_eq!(huge.messages.len(), 3);
        assert!(!huge.has_more);
        // A zero/negative page is a client bug, not an infinite loop generator.
        let tiny = list_messages_page_impl(&c, "chan-clamp", None, None, Some(0), None).unwrap();
        assert_eq!(tiny.messages.len(), 1);
        assert!(tiny.has_more);

        assert_eq!(
            list_messages_page_impl(&c, "chan-clamp", None, Some("not-a-cursor!!"), None, None)
                .unwrap_err(),
            "invalid cursor"
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn a_cursor_is_not_a_capability_and_a_thread_must_belong_to_its_channel() {
        let (c, path) = conn();
        seed_profiles(&c, &["alice", "mallory"]);
        create_channel_impl(
            &c,
            &Channel {
                id: "chan-private".into(),
                content_type: "private".into(),
                name: Some("Secret".into()),
                description: None,
                project_id: None,
                archived: false,
                read_only: false,
            },
            &["alice".to_string()],
        )
        .unwrap();
        post(&c, "chan-private", "m-secret", "alice", &[]).unwrap();
        let page = list_messages_page_impl(&c, "chan-private", None, None, Some(1), Some("alice"))
            .unwrap();
        assert_eq!(page.messages.len(), 1);
        // Same channel, same (absent) cursor, different reader: the ACL is re-checked on
        // every page, so holding a cursor grants nothing.
        assert_eq!(
            list_messages_page_impl(&c, "chan-private", None, None, Some(1), Some("mallory"))
                .unwrap_err(),
            "channel access denied"
        );

        seed_history(&c, "chan-other", 1);
        assert_eq!(
            list_messages_page_impl(
                &c,
                "chan-other",
                Some("m-secret"),
                None,
                Some(5),
                Some("mallory")
            )
            .unwrap_err(),
            "thread does not belong to this channel"
        );
        drop(c);
        drop(path);
    }

    #[test]
    fn thread_replies_page_separately_from_channel_roots() {
        let (c, path) = conn();
        seed_history(&c, "chan-thr", 1);
        for i in 0..3 {
            c.execute(
                "INSERT INTO messages(id,channel_id,author_id,text,created_at,thread_of,archived,pinned,content_kind) \
                 VALUES(?1,'chan-thr','default-org','re',?2,'m-00',0,0,'text')",
                rusqlite::params![format!("r-{i}"), 200 + i],
            )
            .unwrap();
        }
        let roots = list_messages_page_impl(&c, "chan-thr", None, None, None, None).unwrap();
        assert_eq!(roots.messages.len(), 1);
        let replies =
            list_messages_page_impl(&c, "chan-thr", Some("m-00"), None, Some(2), None).unwrap();
        assert_eq!(replies.messages.len(), 2);
        assert!(replies.has_more);
        let rest = list_messages_page_impl(
            &c,
            "chan-thr",
            Some("m-00"),
            replies.next_cursor.as_deref(),
            Some(2),
            None,
        )
        .unwrap();
        assert_eq!(rest.messages.len(), 1);
        assert!(!rest.has_more);
        assert!(rest.next_cursor.is_none());
        drop(c);
        drop(path);
    }

    #[test]
    fn links_are_extracted_on_write_and_re_derived_on_edit() {
        let (c, path) = conn();
        seed_scheduler(&c, "chan-link");
        create_message_impl(
            &c,
            &Message {
                id: "m-link".into(),
                channel_id: "chan-link".into(),
                author_id: Some("default-org".into()),
                text: "read https://a.example/x and https://b.example/y".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                mention_ids: vec![],
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
                content_kind: "text".into(),
            },
        )
        .unwrap();
        let view = list_messages_page_impl(&c, "chan-link", None, None, None, None).unwrap();
        let links = &view.messages[0].links;
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|l| l.status == "pending"));

        // Pretend the first was unfurled, then edit the text: the survivor keeps its
        // preview, the dropped URL takes its own with it.
        unfurl_message_links_impl(&c, "m-link", None, &|_url| {
            Ok(crate::chat_links::FetchedDoc {
                content_type: "text/html".into(),
                body: "<html><head><title>Kept</title></head></html>".into(),
            })
        })
        .unwrap();
        update_message_impl(&c, "m-link", "only https://a.example/x now", None, None).unwrap();
        let links = crate::chat_links::links_for(&c, "m-link").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://a.example/x");
        assert_eq!(links[0].title.as_deref(), Some("Kept"));
        drop(c);
        drop(path);
    }

    #[test]
    fn unfurling_needs_the_channel_and_a_refusal_is_recorded_not_retried() {
        let (c, path) = conn();
        seed_profiles(&c, &["alice", "mallory"]);
        create_channel_impl(
            &c,
            &Channel {
                id: "chan-unf".into(),
                content_type: "private".into(),
                name: Some("Secret".into()),
                description: None,
                project_id: None,
                archived: false,
                read_only: false,
            },
            &["alice".to_string()],
        )
        .unwrap();
        create_message_impl(
            &c,
            &Message {
                id: "m-unf".into(),
                channel_id: "chan-unf".into(),
                author_id: Some("alice".into()),
                text: "http://169.254.169.254/latest/meta-data".into(),
                created_at: 1,
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                mention_ids: vec![],
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
                content_kind: "text".into(),
            },
        )
        .unwrap();

        // An outsider cannot make the server fetch on behalf of a channel they cannot read.
        let calls = std::cell::Cell::new(0);
        assert_eq!(
            unfurl_message_links_impl(&c, "m-unf", Some("mallory"), &|_u| {
                calls.set(calls.get() + 1);
                Ok(crate::chat_links::FetchedDoc {
                    content_type: "text/html".into(),
                    body: String::new(),
                })
            })
            .unwrap_err(),
            "channel access denied"
        );
        assert_eq!(
            calls.get(),
            0,
            "a denied request must not reach the network"
        );

        // The member's request runs, the guard refuses the link-local address, and the
        // refusal is terminal: a second request does not re-dial.
        let links = unfurl_message_links_impl(&c, "m-unf", Some("alice"), &|url| {
            calls.set(calls.get() + 1);
            crate::chat_links::fetch_url(url)
        })
        .unwrap();
        assert_eq!(links[0].status, "refused");
        assert!(links[0].title.is_none());
        assert_eq!(calls.get(), 1);
        unfurl_message_links_impl(&c, "m-unf", Some("alice"), &|url| {
            calls.set(calls.get() + 1);
            crate::chat_links::fetch_url(url)
        })
        .unwrap();
        assert_eq!(calls.get(), 1, "a refused link must not be re-fetched");
        drop(c);
        drop(path);
    }

    /// Deleting a channel is the one operation that must leave *nothing* behind: after
    /// it, no table may still point at the room or at any message that lived in it —
    /// including the mention notification, which otherwise keeps rendering the body of a
    /// message that no longer exists (the same defect `remove_channel_member_impl`
    /// already fixes on exit).
    #[test]
    fn deleting_a_channel_leaves_no_row_pointing_at_it() {
        let (mut c, path) = conn();
        seed_poll_voters(&c, "chan-doomed");
        add_channel_member_impl(&c, "chan-doomed", "voter-a", false).unwrap();
        create_message_impl(
            &c,
            &Message {
                id: "m-root".to_string(),
                channel_id: "chan-doomed".to_string(),
                author_id: Some("default-org".to_string()),
                text: "hello @voter-a".to_string(),
                created_at: now_secs(),
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: true,
                content_kind: default_message_content_kind(),
                mention_ids: vec!["voter-a".to_string()],
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(
            mentions_for_impl(&c, "m-root").unwrap(),
            vec!["voter-a".to_string()],
            "the fixture must really carry a mention, or the cascade proves nothing"
        );
        let mention_notifications: i64 = c
            .query_row(
                "SELECT count(*) FROM notifications WHERE entity_type='message' AND entity_id='m-root'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mention_notifications, 1);
        add_reaction_impl(&c, "m-root", "voter-a", "\u{1f44d}").unwrap();
        mark_channel_read_impl(&c, "chan-doomed", "voter-a", None).unwrap();
        save_draft_impl(&c, "chan-doomed", "voter-a", "", "half a thought").unwrap();
        create_poll_impl(
            &c,
            "poll-doomed",
            "chan-doomed",
            "default-org",
            "lunch?",
            &["Pizza".into(), "Salad".into()],
            false,
            false,
        )
        .unwrap();
        let thread = ensure_thread_channel_impl(&c, "m-root", None, Some("default-org"))
            .unwrap()
            .channel;
        create_message_impl(
            &c,
            &Message {
                id: "m-in-thread".to_string(),
                channel_id: thread.id.clone(),
                author_id: Some("default-org".to_string()),
                text: "in the thread".to_string(),
                created_at: now_secs(),
                edited_at: None,
                thread_of: None,
                archived: false,
                pinned: false,
                content_kind: default_message_content_kind(),
                mention_ids: Vec::new(),
                mention_team_ids: Vec::new(),
                mention_targets: Vec::new(),
            },
        )
        .unwrap();

        delete_channel_impl(&mut c, "chan-doomed", "default-org").unwrap();

        assert_eq!(
            delete_channel_impl(&mut c, "chan-doomed", "default-org").unwrap_err(),
            "Channel not found",
            "a second delete has nothing to delete and says so"
        );
        // Every table that can name a channel or one of its messages, asked directly.
        for (table, clause) in [
            ("channels", "id='chan-doomed'"),
            ("messages", "channel_id='chan-doomed'"),
            ("channel_members", "channel_id='chan-doomed'"),
            ("read_state", "channel_id='chan-doomed'"),
            ("message_drafts", "channel_id='chan-doomed'"),
            ("channel_typing", "channel_id='chan-doomed'"),
            ("scheduled_messages", "channel_id='chan-doomed'"),
            ("channel_subscriptions", "channel_id='chan-doomed'"),
            (
                "channel_notification_preferences",
                "channel_id='chan-doomed'",
            ),
            ("channel_notes", "channel_id='chan-doomed'"),
            ("message_polls", "channel_id='chan-doomed'"),
            ("thread_channels", "parent_channel_id='chan-doomed'"),
            ("reactions", "message_id='m-root'"),
            ("message_mentions", "message_id='m-root'"),
            ("message_team_mentions", "message_id='m-root'"),
            ("message_entity_mentions", "message_id='m-root'"),
            ("message_links", "message_id='m-root'"),
            ("message_attachments", "message_id='m-root'"),
            ("message_poll_votes", "poll_id='poll-doomed'"),
            ("message_poll_options", "poll_id='poll-doomed'"),
            (
                "notifications",
                "entity_type='message' AND entity_id='m-root'",
            ),
            (
                "notifications",
                "entity_type='channel' AND entity_id='chan-doomed'",
            ),
        ] {
            let left: i64 = c
                .query_row(
                    &format!("SELECT count(*) FROM {table} WHERE {clause}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(left, 0, "{table} still points at the deleted channel");
        }
        // A thread is a channel: it goes with its parent, messages and all.
        for (table, clause) in [
            ("channels", format!("id='{}'", thread.id)),
            ("messages", format!("channel_id='{}'", thread.id)),
        ] {
            let left: i64 = c
                .query_row(
                    &format!("SELECT count(*) FROM {table} WHERE {clause}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(left, 0, "the thread channel outlived its parent in {table}");
        }
        drop(c);
        drop(path);
    }

    /// Deletion is a channel *write*: without `Channel.ManageChannel` it fails loudly and
    /// the room is still there afterwards. (The catalog is opt-in — a right nobody has
    /// configured is not yet enforced — so the fixture grants it to a role first.)
    #[test]
    fn deleting_a_channel_without_the_right_fails_and_changes_nothing() {
        let (mut c, path) = conn();
        seed_scheduler(&c, "chan-guarded");
        c.execute(
            "INSERT OR IGNORE INTO profiles(id,username,display_name,created_at) VALUES('outsider','outsider','Outsider',unixepoch())",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT OR IGNORE INTO rights(id,code,title,right_type,implied_rights_json) VALUES('right-manage-channel','Channel.ManageChannel','Manage channel','Channel','[]')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO roles(id,name) VALUES('role-chan','Channel manager')",
            [],
        )
        .unwrap();
        let right_id: String = c
            .query_row(
                "SELECT id FROM rights WHERE code='Channel.ManageChannel'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        c.execute(
            "INSERT INTO role_rights(role_id,right_id) VALUES('role-chan',?1)",
            rusqlite::params![right_id],
        )
        .unwrap();

        let refusal = delete_channel_impl(&mut c, "chan-guarded", "outsider").unwrap_err();
        assert!(
            !refusal.is_empty(),
            "a missing right must be an error, never a silent success"
        );
        let still_there: i64 = c
            .query_row(
                "SELECT count(*) FROM channels WHERE id='chan-guarded'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 1, "the refused delete must not have run");

        c.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES('ra-chan','role-chan','outsider','channel','chan-guarded')", []).unwrap();
        delete_channel_impl(&mut c, "chan-guarded", "outsider").unwrap();
        let gone: i64 = c
            .query_row(
                "SELECT count(*) FROM channels WHERE id='chan-guarded'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0, "the granted right opens the same door");
        drop(c);
        drop(path);
    }
}
