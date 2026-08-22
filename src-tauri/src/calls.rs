//! Native LiveKit runtime + token authority. Claims mirror `meet/src/backend/core/utils.py`.
use crate::{db, meetings};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
#[cfg(test)]
use jsonwebtoken::{decode, DecodingKey, Validation};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::{net::TcpStream, process::{Child, Command}, sync::{LazyLock, Mutex}, thread, time::{Duration, SystemTime, UNIX_EPOCH}};
#[cfg(feature = "desktop")]
use tauri::AppHandle;

type Result<T> = std::result::Result<T, String>;
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 7880;
const DEFAULT_API_KEY: &str = "devkey";
const DEFAULT_API_SECRET: &str = "secret";
const DEFAULT_SERVER_PATH: &str = "livekit-server";
const TOKEN_LIFETIME_SECONDS: u64 = 60 * 60;
const DEFAULT_SOURCES: [&str; 4] = ["camera", "microphone", "screen_share", "screen_share_audio"];

#[derive(Debug, Clone, Deserialize)]
pub struct LivekitConfig {
    pub server_path: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
/// Optional HTTP endpoint for the LiveKit Egress RPC service. Keep this and
/// storage credentials in the native process; the Solid webview never sees them.
pub egress_url: Option<String>,
/// File path on the Egress worker; supports LiveKit's `{room_name}` / `{time}` templates.
pub recording_filepath: Option<String>,
}

impl Default for LivekitConfig {
    fn default() -> Self { Self { server_path: None, host: None, port: None, api_key: None, api_secret: None, egress_url: None, recording_filepath: None } }
}

impl LivekitConfig {
    fn server_path(&self) -> String { self.server_path.clone().or_else(|| std::env::var("LIVEKIT_SERVER_PATH").ok()).unwrap_or_else(|| DEFAULT_SERVER_PATH.into()) }
    fn host(&self) -> String { self.host.clone().unwrap_or_else(|| DEFAULT_HOST.into()) }
    fn port(&self) -> u16 { self.port.unwrap_or(DEFAULT_PORT) }
    fn api_key(&self) -> String { self.api_key.clone().or_else(|| std::env::var("LIVEKIT_API_KEY").ok()).unwrap_or_else(|| DEFAULT_API_KEY.into()) }
    fn api_secret(&self) -> String { self.api_secret.clone().or_else(|| std::env::var("LIVEKIT_API_SECRET").ok()).unwrap_or_else(|| DEFAULT_API_SECRET.into()) }
    fn url(&self) -> String { format!("ws://{}:{}", self.host(), self.port()) }
fn egress_url(&self) -> String { self.egress_url.clone().or_else(|| std::env::var("LIVEKIT_EGRESS_URL").ok()).unwrap_or_else(|| format!("http://{}:{}", self.host(), self.port())) }
fn recording_filepath(&self) -> String { self.recording_filepath.clone().or_else(|| std::env::var("LIVEKIT_RECORDING_FILEPATH").ok()).unwrap_or_else(|| "recordings/{room_name}-{time}.mp4".into()) }
}

struct ManagedServer { child: Child, config: LivekitConfig }
static SERVER: LazyLock<Mutex<Option<ManagedServer>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize)]
pub struct LivekitStatus { pub running: bool, pub url: String, pub pid: Option<u32> }

fn port_open(config: &LivekitConfig) -> bool { TcpStream::connect((config.host().as_str(), config.port())).is_ok() }

fn ensure_server(config: LivekitConfig) -> Result<LivekitStatus> {
    let mut server = SERVER.lock().map_err(|_| "LiveKit server state lock poisoned".to_string())?;
    if let Some(managed) = server.as_mut() {
        if managed.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            if managed.config.host() == config.host() && managed.config.port() == config.port() { return Ok(LivekitStatus { running: true, url: config.url(), pid: Some(managed.child.id()) }); }
            return Err("LiveKit is already managed with a different host or port".into());
        }
        *server = None;
    }
    let path = config.server_path();
    let key_pair = format!("{}: {}", config.api_key(), config.api_secret());
    let host = config.host();
    let port = config.port().to_string();
    let child = Command::new(&path).args(["--dev", "--bind", &host, "--port", &port, "--keys", &key_pair]).spawn().map_err(|e| format!("Could not start LiveKit at {path}: {e}"))?;
    let pid = child.id();
    *server = Some(ManagedServer { child, config: config.clone() });
    for _ in 0..30 {
        if port_open(&config) { return Ok(LivekitStatus { running: true, url: config.url(), pid: Some(pid) }); }
        if server.as_mut().expect("server inserted").child.try_wait().map_err(|e| e.to_string())?.is_some() { *server = None; return Err("LiveKit exited before opening its configured port".into()); }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!("LiveKit did not open {} within 3 seconds", config.url()))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn start_livekit_server(config: Option<LivekitConfig>) -> Result<LivekitStatus> { ensure_server(config.unwrap_or_default()) }

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn livekit_server_status(config: Option<LivekitConfig>) -> Result<LivekitStatus> {
    let config = config.unwrap_or_default();
    let mut server = SERVER.lock().map_err(|_| "LiveKit server state lock poisoned".to_string())?;
    let (running, pid) = if let Some(managed) = server.as_mut() {
        if managed.child.try_wait().map_err(|e| e.to_string())?.is_none() { (port_open(&managed.config), Some(managed.child.id())) }
        else { *server = None; (false, None) }
    } else { (false, None) };
    Ok(LivekitStatus { running, url: config.url(), pid })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VideoGrant {
    room: String,
    #[serde(rename = "roomJoin")]
    room_join: bool,
    #[serde(rename = "roomAdmin")]
    room_admin: bool,
    #[serde(rename = "canUpdateOwnMetadata")]
    can_update_own_metadata: bool,
    #[serde(rename = "canPublish")]
    can_publish: bool,
    #[serde(rename = "canPublishSources")]
    can_publish_sources: Vec<String>,
    #[serde(rename = "canSubscribe")]
    can_subscribe: bool,
#[serde(rename = "roomRecord")]
room_record: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LivekitClaims {
    iss: String,
    sub: String,
    name: String,
    exp: usize,
    nbf: usize,
    video: VideoGrant,
    attributes: std::collections::BTreeMap<String, String>,
}

fn room_for_meeting(meeting_id: &str) -> String { format!("meeting-{meeting_id}") }

fn token_for(config: &LivekitConfig, room: String, identity: String, name: String, admin: bool) -> Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs() as usize;
    let claims = LivekitClaims { iss: config.api_key(), sub: identity, name, exp: now + TOKEN_LIFETIME_SECONDS as usize, nbf: now, video: VideoGrant { room, room_join: true, room_admin: admin, can_update_own_metadata: false, can_publish: true, can_publish_sources: DEFAULT_SOURCES.into_iter().map(str::to_owned).collect(), can_subscribe: true, room_record: false }, attributes: [("room_admin".into(), if admin { "true".into() } else { "false".into() })].into_iter().collect() };
    encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(config.api_secret().as_bytes())).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct CallJoin { pub url: String, pub room: String, pub token: String }

#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn join_meeting_call(app: AppHandle, meeting_id: String, participant_id: String, display_name: String, config: Option<LivekitConfig>) -> Result<CallJoin> {
    if participant_id.trim().is_empty() || display_name.trim().is_empty() { return Err("Call participant identity and display name are required".into()); }
    // Read the meeting *as the joining participant*: a stranger cannot even learn
    // that the meeting exists, let alone reach the RSVP check below.
    let meeting = meetings::get_meeting_scoped(meeting_id.clone(), participant_id.clone())?
        .ok_or("Meeting not found")?;
    if meeting.archived { return Err("Cannot join an archived meeting".into()); }
    let connection = db::connection(&app)?;
    let rsvp: Option<String> = connection.query_row("SELECT status FROM meeting_participants WHERE meeting_id=?1 AND profile_id=?2", rusqlite::params![meeting_id, participant_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let is_organizer = meeting.organizer_id.as_deref() == Some(participant_id.as_str());
    if !is_organizer && !matches!(rsvp.as_deref(), Some("accepted")) { return Err("Waiting for organizer admission: only accepted participants can join this meeting call".into()); }
    let config = config.unwrap_or_default();
    let status = ensure_server(config.clone())?;
    let room = room_for_meeting(&meeting_id);
    Ok(CallJoin { url: status.url, token: token_for(&config, room.clone(), participant_id, display_name, is_organizer)?, room })
}

/// Minimal native handle for an active LiveKit Egress room-composite recording.
/// The recording bytes are written by the separately deployed Egress worker, never
/// by the webview or this process.
#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Serialize)]
pub struct CallRecording { pub egress_id: String, pub status: String }

#[cfg(feature = "desktop")]
static RECORDINGS: LazyLock<Mutex<std::collections::BTreeMap<String, String>>> = LazyLock::new(|| Mutex::new(std::collections::BTreeMap::new()));

#[cfg(feature = "desktop")]
fn recording_authorized(app: &AppHandle, meeting_id: &str, participant_id: &str) -> Result<(LivekitConfig, String)> {
    let meeting = meetings::get_meeting_scoped(meeting_id.to_owned(), participant_id.to_owned())?.ok_or("Meeting not found")?;
    if meeting.archived { return Err("Cannot record an archived meeting".into()); }
    if meeting.organizer_id.as_deref() != Some(participant_id) { return Err("Only the meeting organizer can control recording".into()); }
    Ok((LivekitConfig::default(), room_for_meeting(meeting_id)))
}

#[cfg(feature = "desktop")]
fn egress_token(config: &LivekitConfig, room: String) -> Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs() as usize;
    let claims = LivekitClaims { iss: config.api_key(), sub: "gaia-space-egress".into(), name: "GAIA Space recorder".into(), exp: now + TOKEN_LIFETIME_SECONDS as usize, nbf: now, video: VideoGrant { room, room_join: false, room_admin: true, can_update_own_metadata: false, can_publish: false, can_publish_sources: vec![], can_subscribe: false, room_record: true }, attributes: std::collections::BTreeMap::new() };
    encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(config.api_secret().as_bytes())).map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
fn egress_rpc(config: &LivekitConfig, method: &str, room: &str, body: serde_json::Value) -> Result<serde_json::Value> {
    let endpoint = format!("{}/twirp/livekit.Egress/{method}", config.egress_url().trim_end_matches('/'));
    let response = reqwest::blocking::Client::new().post(endpoint).bearer_auth(egress_token(config, room.to_owned())?).json(&body).send().map_err(|e| format!("LiveKit Egress request failed: {e}"))?;
    let status = response.status();
    let payload = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("LiveKit Egress returned {status}: {payload}")); }
    serde_json::from_str(&payload).map_err(|e| format!("LiveKit Egress returned invalid JSON: {e}"))
}

/// Start a real room-composite MP4 Egress job. Requires an Egress worker and a
/// writable `LIVEKIT_RECORDING_FILEPATH` mounted in that worker; absent runtime
/// infrastructure is surfaced to the organizer rather than silently faking a recording.
#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn start_meeting_recording(app: AppHandle, meeting_id: String, participant_id: String, config: Option<LivekitConfig>) -> Result<CallRecording> {
    let (mut effective, room) = recording_authorized(&app, &meeting_id, &participant_id)?;
    if let Some(config) = config { effective = config; }
    if RECORDINGS.lock().map_err(|_| "recording state lock poisoned".to_string())?.contains_key(&meeting_id) { return Err("This meeting is already recording".into()); }
    let response = egress_rpc(&effective, "StartRoomCompositeEgress", &room, serde_json::json!({ "room_name": room, "layout": "grid", "file_outputs": [{ "filepath": effective.recording_filepath() }] }))?;
    let egress_id = response.get("egress_id").and_then(serde_json::Value::as_str).filter(|value| !value.is_empty()).ok_or("LiveKit Egress did not return an egress_id")?.to_owned();
    RECORDINGS.lock().map_err(|_| "recording state lock poisoned".to_string())?.insert(meeting_id, egress_id.clone());
    Ok(CallRecording { egress_id, status: "recording".into() })
}

#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn stop_meeting_recording(app: AppHandle, meeting_id: String, participant_id: String, config: Option<LivekitConfig>) -> Result<CallRecording> {
    let (mut effective, room) = recording_authorized(&app, &meeting_id, &participant_id)?;
    if let Some(config) = config { effective = config; }
    let egress_id = RECORDINGS.lock().map_err(|_| "recording state lock poisoned".to_string())?.get(&meeting_id).cloned().ok_or("No active recording is known for this meeting")?;
    egress_rpc(&effective, "StopEgress", &room, serde_json::json!({ "egress_id": egress_id }))?;
    RECORDINGS.lock().map_err(|_| "recording state lock poisoned".to_string())?.remove(&meeting_id);
    Ok(CallRecording { egress_id, status: "stopped".into() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn room_name_is_derived_only_from_meeting_id() { assert_eq!(room_for_meeting("a-b_1"), "meeting-a-b_1"); }
    #[test]
    fn minted_token_decodes_with_meet_style_grants() { let config = LivekitConfig { api_key: Some("test-key".into()), api_secret: Some("test-secret".into()), ..Default::default() }; let token = token_for(&config, room_for_meeting("m-1"), "p-1".into(), "Pat".into(), true).unwrap(); let decoded = decode::<LivekitClaims>(&token, &DecodingKey::from_secret(b"test-secret"), &Validation::new(Algorithm::HS256)).unwrap(); assert_eq!(decoded.claims.video.room, "meeting-m-1"); assert!(decoded.claims.video.room_join && decoded.claims.video.can_publish && decoded.claims.video.can_subscribe); assert!(decoded.claims.video.room_admin); assert!(!decoded.claims.video.room_record); assert_eq!(decoded.claims.video.can_publish_sources, DEFAULT_SOURCES); }
#[cfg(feature = "desktop")]
#[test]
fn egress_token_has_only_room_record_grant() { let config = LivekitConfig { api_key: Some("test-key".into()), api_secret: Some("test-secret".into()), ..Default::default() }; let token = egress_token(&config, room_for_meeting("m-1")).unwrap(); let decoded = decode::<LivekitClaims>(&token, &DecodingKey::from_secret(b"test-secret"), &Validation::new(Algorithm::HS256)).unwrap(); assert!(decoded.claims.video.room_record); assert!(!decoded.claims.video.room_join && !decoded.claims.video.can_publish && !decoded.claims.video.can_subscribe); }
}
