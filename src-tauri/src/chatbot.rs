//! Chatbot slash-command callback (KB §07 §2.2 payloads SDK, §3.2 Applications #5/#7).
//!
//! Space does not store an app's slash commands: when a user types `/` in a channel the
//! platform POSTs a `ListCommandsPayload` to the app's own endpoint and the app answers
//! with `Commands(commands: List<CommandDetail>)` — a flat name+description list, no
//! declarative argument schema. The registration's `commands_json` is only a
//! developer-declared fallback, so a bot whose endpoint is down still autocompletes.
use crate::applications::{ApplicationPayload, ChatbotRegistration};
use crate::db;
use crate::payload_dispatch::{dispatch_with, post_payload_transport, Transport};
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;

/// One autocomplete entry, exactly the KB's `CommandDetail(name, description)`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CommandDetail {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// Where the returned list came from, so a caller can tell a live answer from the
/// fallback and surface the endpoint failure instead of silently degrading.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct CommandListing {
    pub chatbot_id: String,
    pub application_id: String,
    pub commands: Vec<CommandDetail>,
    /// `"app"` = answered by the app endpoint · `"registration"` = declared fallback.
    pub source: String,
    /// Dispatch or parse failure that forced the fallback; `None` on a live answer.
    pub error: Option<String>,
}

/// The app's reply body. Space accepts the wrapped `Commands` object; a bare list is
/// accepted too because the Kotlin SDK serialises `Commands` that way in older versions.
#[derive(Deserialize)]
#[serde(untagged)]
enum CommandsResponse {
    Wrapped { commands: Vec<CommandDetail> },
    Bare(Vec<CommandDetail>),
}

impl CommandsResponse {
    fn into_commands(self) -> Vec<CommandDetail> {
        match self {
            Self::Wrapped { commands } => commands,
            Self::Bare(commands) => commands,
        }
    }
}

fn read_bot(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChatbotRegistration> {
    Ok(ChatbotRegistration {
        id: r.get(0)?,
        application_id: r.get(1)?,
        display_name: r.get(2)?,
        description: r.get(3)?,
        commands_json: r.get(4)?,
        enabled: r.get(5)?,
    })
}

/// Prefix matching mirrors the slash menu: the user's typed text may or may not carry the
/// leading `/`, and matching is case-insensitive on the command name.
fn matches_prefix(command: &CommandDetail, prefix: &str) -> bool {
    let needle = prefix.trim().trim_start_matches('/').to_ascii_lowercase();
    needle.is_empty() || command.name.to_ascii_lowercase().starts_with(&needle)
}

fn declared_commands(bot: &ChatbotRegistration) -> Vec<CommandDetail> {
    serde_json::from_str::<Vec<CommandDetail>>(&bot.commands_json).unwrap_or_default()
}

/// Ask one chatbot for its `/command` list. Transport-injected so a test drives the whole
/// callback — payload shape, signature, response parsing — without a socket.
pub(crate) fn list_commands_on(
    c: &rusqlite::Connection,
    chatbot_id: &str,
    user_id: &str,
    prefix: Option<&str>,
    send: Transport,
) -> Result<CommandListing> {
    let bot = c
        .query_row(
            "SELECT id,application_id,display_name,description,commands_json,enabled FROM chatbot_registrations WHERE id=?1",
            [chatbot_id],
            read_bot,
        )
        .map_err(|_| "chatbot not found".to_string())?;
    if !bot.enabled {
        return Err("chatbot is disabled".into());
    }
    // The typed-by identity is announced to a third party (the bot's endpoint), so it
    // must name a real, live profile whatever the caller is. The web chokepoint already
    // rebinds it to the session; this refusal is what the desktop IPC caller — which has
    // no session to rebind from — runs into, so an arbitrary string never reaches a bot.
    let known: i64 = c
        .query_row(
            "SELECT count(*) FROM profiles WHERE id=?1 AND coalesce(archived,0)=0",
            [user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if known == 0 {
        return Err("unknown profile".into());
    }
    let prefix = prefix.map(str::to_string);
    let payload = ApplicationPayload::ListCommandsPayload {
        user_id: user_id.to_string(),
        prefix: prefix.clone(),
    };
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let filter = prefix.unwrap_or_default();
    let fallback = |error: String| CommandListing {
        chatbot_id: bot.id.clone(),
        application_id: bot.application_id.clone(),
        commands: filtered(declared_commands(&bot), &filter),
        source: "registration".into(),
        error: Some(error),
    };
    let dispatch = match dispatch_with(c, &bot.application_id, &payload_json, send) {
        Ok(dispatch) => dispatch,
        Err(error) => return Ok(fallback(error)),
    };
    if let Some(error) = dispatch.error {
        return Ok(fallback(error));
    }
    let body = dispatch.response_body.unwrap_or_default();
    match serde_json::from_str::<CommandsResponse>(&body) {
        Ok(response) => Ok(CommandListing {
            chatbot_id: bot.id.clone(),
            application_id: bot.application_id.clone(),
            commands: filtered(response.into_commands(), &filter),
            source: "app".into(),
            error: None,
        }),
        Err(e) => Ok(fallback(format!("unreadable Commands response: {e}"))),
    }
}

/// The app is allowed to ignore the prefix; Space filters again so the menu never shows a
/// non-matching entry, and de-duplicates by name keeping the first (app-preferred) order.
fn filtered(commands: Vec<CommandDetail>, prefix: &str) -> Vec<CommandDetail> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<CommandDetail> = commands
        .into_iter()
        .filter(|command| !command.name.trim().is_empty())
        .filter(|command| matches_prefix(command, prefix))
        .filter(|command| seen.insert(command.name.to_ascii_lowercase()))
        .collect();
    out.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    out
}

/// Slash-menu autocomplete for one registered chatbot.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_chatbot_commands(
    chatbot_id: String,
    user_id: String,
    prefix: Option<String>,
) -> Result<CommandListing> {
    list_commands_on(
        &db::conn()?,
        &chatbot_id,
        &user_id,
        prefix.as_deref(),
        post_payload_transport(),
    )
}

#[cfg(test)]
#[path = "chatbot_tests.rs"]
mod chatbot_tests;
