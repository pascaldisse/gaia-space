//! Per-channel #Spacebox subscriptions; delivery is a projection into notifications.
use crate::{db, personal};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ChannelSubscription {
    pub channel_id: String,
    pub profile_id: String,
    pub enabled: bool,
}

fn channel_exists(c: &Connection, channel_id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM channels WHERE id=?1 AND archived=0)",
        [channel_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn profile_exists(c: &Connection, profile_id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1 AND archived=0)",
        [profile_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn save_on(c: &Connection, value: &ChannelSubscription) -> Result<ChannelSubscription> {
    if !channel_exists(c, &value.channel_id)? || !profile_exists(c, &value.profile_id)? {
        return Err("channel or profile not found".into());
    }
    if !crate::chat::channel_allows_profile(c, &value.channel_id, &value.profile_id)? {
        return Err("channel access denied".into());
    }
    c.execute("INSERT INTO channel_subscriptions(channel_id,profile_id,enabled) VALUES(?1,?2,?3) ON CONFLICT(channel_id,profile_id) DO UPDATE SET enabled=excluded.enabled", rusqlite::params![value.channel_id, value.profile_id, value.enabled]).map_err(|e| e.to_string())?;
    Ok(value.clone())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_channel_subscription(value: ChannelSubscription) -> Result<ChannelSubscription> {
    save_on(&db::conn()?, &value)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channel_subscriptions(profile_id: String) -> Result<Vec<ChannelSubscription>> {
    let c = db::conn()?;
    let mut s=c.prepare("SELECT channel_id,profile_id,enabled FROM channel_subscriptions WHERE profile_id=?1 ORDER BY channel_id").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([profile_id], |r| {
            Ok(ChannelSubscription {
                channel_id: r.get(0)?,
                profile_id: r.get(1)?,
                enabled: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
/// Called only after a message is durable; author receives no self-notification.
pub(crate) fn route_message_on(
    c: &Connection,
    channel_id: &str,
    author_id: Option<&str>,
    text: &str,
) -> Result<()> {
    let mut s=c.prepare("SELECT profile_id FROM channel_subscriptions WHERE channel_id=?1 AND enabled=1 ORDER BY profile_id").map_err(|e|e.to_string())?;
    let recipients: Vec<String> = s
        .query_map([channel_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|id| Some(id.as_str()) != author_id)
        .collect();
    if recipients.is_empty() {
        return Ok(());
    }
    personal::fan_out_notification_on(
        c,
        personal::NotificationFanout {
            recipients,
            event_type: "spacebox.message",
            title: "#Spacebox activity",
            body: Some(text),
            entity_type: "channel",
            entity_id: channel_id,
            target_type: None,
            target_id: None,
        },
    )?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subscription_routes_message_into_spacebox() {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        db::seed(&c).unwrap();
        c.execute(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES('p2','p2','P2',1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO channels(id,content_type,archived) VALUES('c','public',0)",
            [],
        )
        .unwrap();
        save_on(
            &c,
            &ChannelSubscription {
                channel_id: "c".into(),
                profile_id: "p2".into(),
                enabled: true,
            },
        )
        .unwrap();
        route_message_on(&c, "c", Some("default-org"), "hello").unwrap();
        let n:i64=c.query_row("SELECT count(*) FROM notifications WHERE recipient_id='p2' AND event_type='spacebox.message'",[],|r|r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
