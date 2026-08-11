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
fn list_channels_with_meta_impl(c: &Connection, profile_id: &str) -> Result<Vec<ChannelSummary>> {
    let channels = list_channels_impl(c)?;
    channels
        .into_iter()
        .filter(|ch| !ch.archived)
        .map(|ch| {
            let member_count = member_count_impl(c, &ch.id)?;
            let unread_count = unread_count_impl(c, &ch.id, profile_id)?;
            let last_message_at = last_message_at_impl(c, &ch.id)?;
            Ok(ChannelSummary {
                channel: ch,
                member_count,
                unread_count,
                last_message_at,
            })
        })
        .collect()
}
fn create_channel_impl(c: &Connection, channel: &Channel, member_ids: &[String]) -> Result<()> {
    c.execute(
        "INSERT INTO channels(id,content_type,name,description,project_id,archived)VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![channel.id, channel.content_type, channel.name, channel.description, channel.project_id, channel.archived],
    )
    .map_err(|e| e.to_string())?;
    for profile_id in member_ids {
        c.execute(
            "INSERT OR IGNORE INTO channel_members(channel_id,profile_id,administrator) VALUES(?1,?2,0)",
            rusqlite::params![channel.id, profile_id],
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
fn to_view(c: &Connection, m: Message, acting_profile_id: Option<&str>) -> Result<MessageView> {
    let reply_count = reply_count_impl(c, &m.id)?;
    let reactions = reactions_for_impl(c, &m.id, acting_profile_id)?;
    Ok(MessageView {
        message: m,
        reply_count,
        reactions,
    })
}
fn list_messages_impl(
    c: &Connection,
    channel_id: &str,
    acting_profile_id: Option<&str>,
) -> Result<Vec<MessageView>> {
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
    c.execute(
        "INSERT INTO messages(id,channel_id,author_id,text,created_at,edited_at,thread_of,archived)VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![message.id, message.channel_id, message.author_id, message.text, message.created_at, message.edited_at, message.thread_of, message.archived],
    )
    .map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn list_channels() -> Result<Vec<Channel>> {
    list_channels_impl(&db::conn()?)
}
#[tauri::command]
pub fn get_channel( id: String) -> Result<Option<Channel>> {
    get_channel_impl(&db::conn()?, &id)
}
#[tauri::command]
pub fn list_channels_with_meta( profile_id: String) -> Result<Vec<ChannelSummary>> {
    list_channels_with_meta_impl(&db::conn()?, &profile_id)
}
#[tauri::command]
pub fn create_channel(
    channel: Channel,
    member_ids: Vec<String>,
) -> Result<Channel> {
    let c = db::conn()?;
    create_channel_impl(&c, &channel, &member_ids)?;
    Ok(channel)
}
#[tauri::command]
pub fn update_channel( channel: Channel) -> Result<()> {
    let c = db::conn()?;
    c.execute("UPDATE channels SET content_type=?2,name=?3,description=?4,project_id=?5,archived=?6 WHERE id=?1",rusqlite::params![channel.id,channel.content_type,channel.name,channel.description,channel.project_id,channel.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn join_channel( channel_id: String, profile_id: String) -> Result<()> {
    add_channel_member_impl(&db::conn()?, &channel_id, &profile_id, false)
}
#[tauri::command]
pub fn leave_channel( channel_id: String, profile_id: String) -> Result<()> {
    remove_channel_member_impl(&db::conn()?, &channel_id, &profile_id)
}
#[tauri::command]
pub fn add_channel_member(
    channel_id: String,
    profile_id: String,
    administrator: bool,
) -> Result<()> {
    add_channel_member_impl(
        &db::conn()?,
        &channel_id,
        &profile_id,
        administrator,
    )
}
#[tauri::command]
pub fn remove_channel_member( channel_id: String, profile_id: String) -> Result<()> {
    remove_channel_member_impl(&db::conn()?, &channel_id, &profile_id)
}
#[tauri::command]
pub fn list_channel_members( channel_id: String) -> Result<Vec<ChannelMember>> {
    list_channel_members_impl(&db::conn()?, &channel_id)
}
#[tauri::command]
pub fn create_entity_channel(
    entity_type: String,
    entity_id: String,
    name: Option<String>,
) -> Result<Channel> {
    create_entity_channel_impl(&db::conn()?, &entity_type, &entity_id, name)
}
#[tauri::command]
pub fn get_channel_by_entity(
    entity_type: String,
    entity_id: String,
) -> Result<Option<Channel>> {
    get_channel_impl(
        &db::conn()?,
        &entity_channel_id(&entity_type, &entity_id),
    )
}
#[tauri::command]
pub fn list_messages(
    channel_id: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<MessageView>> {
    list_messages_impl(
        &db::conn()?,
        &channel_id,
        acting_profile_id.as_deref(),
    )
}
#[tauri::command]
pub fn list_thread_replies(
    thread_of: String,
    acting_profile_id: Option<String>,
) -> Result<Vec<MessageView>> {
    list_thread_replies_impl(
        &db::conn()?,
        &thread_of,
        acting_profile_id.as_deref(),
    )
}
#[tauri::command]
pub fn create_message( message: Message) -> Result<MessageView> {
    let c = db::conn()?;
    create_message_impl(&c, &message)?;
    to_view(&c, message, None)
}
#[tauri::command]
pub fn update_message( id: String, text: String) -> Result<MessageView> {
    let c = db::conn()?;
    update_message_impl(&c, &id, &text)?;
    let m = get_message_impl(&c, &id)?.ok_or_else(|| "message not found".to_string())?;
    to_view(&c, m, None)
}
#[tauri::command]
pub fn delete_message( id: String) -> Result<()> {
    delete_message_impl(&db::conn()?, &id)
}
#[tauri::command]
pub fn add_reaction(
    message_id: String,
    profile_id: String,
    emoji: String,
) -> Result<Vec<ReactionSummary>> {
    let c = db::conn()?;
    add_reaction_impl(&c, &message_id, &profile_id, &emoji)?;
    reactions_for_impl(&c, &message_id, Some(&profile_id))
}
#[tauri::command]
pub fn remove_reaction(
    message_id: String,
    profile_id: String,
    emoji: String,
) -> Result<Vec<ReactionSummary>> {
    let c = db::conn()?;
    remove_reaction_impl(&c, &message_id, &profile_id, &emoji)?;
    reactions_for_impl(&c, &message_id, Some(&profile_id))
}
#[tauri::command]
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

    fn conn() -> (Connection, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "gaia-space-chat-test-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let c = db::migrate_path(&path).expect("migration");
        (c, path)
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
        let _ = std::fs::remove_file(&path);
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
        let _ = std::fs::remove_file(&path);
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
        let _ = std::fs::remove_file(&path);
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
        let _ = std::fs::remove_file(&path);
    }
}
