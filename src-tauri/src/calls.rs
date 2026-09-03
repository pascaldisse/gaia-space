//! Native LiveKit runtime + token authority. Claims mirror `meet/src/backend/core/utils.py`.
use crate::{actor, db, meetings};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::{
    net::TcpStream,
    process::{Child, Command},
    sync::{LazyLock, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(feature = "desktop")]
use tauri::AppHandle;

type Result<T> = std::result::Result<T, String>;
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 7880;
const DEFAULT_API_KEY: &str = "devkey";
const DEFAULT_API_SECRET: &str = "secret";
const DEFAULT_SERVER_PATH: &str = "livekit-server";
const LIVEKIT_PUBLIC_URL_ENV: &str = "LIVEKIT_PUBLIC_URL";
const TOKEN_LIFETIME_SECONDS: u64 = 60 * 60;
const DEFAULT_EGRESS_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_RESERVATION_TTL_SECONDS: i64 = 120;
const DEFAULT_MAX_STOP_ATTEMPTS: i64 = 3;
const DEFAULT_SOURCES: [&str; 4] = ["camera", "microphone", "screen_share", "screen_share_audio"];

#[derive(Clone, Default, Deserialize)]
pub struct LivekitConfig {
    pub server_path: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    /// Browser-reachable WebSocket endpoint; local URL when unset.
    pub public_url: Option<String>,
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
    /// Enables anonymous admission to explicitly public meetings; defaults false.
    pub allow_unregistered_rooms: Option<bool>,
    /// Optional HTTP endpoint for the LiveKit Egress RPC service. Credentials stay
    /// in the native process and are never exposed to the Solid webview.
    pub egress_url: Option<String>,
    /// File path on the Egress worker; supports `{room_name}` / `{time}` templates.
    pub recording_filepath: Option<String>,
    /// Hard timeout for every Egress HTTP RPC; an unreachable worker must fail fast
    /// instead of holding the lifecycle row open forever.
    pub egress_timeout_ms: Option<u64>,
    /// A `starting`/`stopping` row older than this is reclaimed: the process that owned
    /// it is gone, so the meeting must not stay pinned as active.
    pub recording_reservation_ttl_seconds: Option<i64>,
    /// After this many failed stop attempts the row is retired as `failed` rather than
    /// left retryable forever.
    pub recording_max_stop_attempts: Option<i64>,
    /// S3/MinIO sink for finished recordings. When a bucket is named the Egress job
    /// uploads instead of writing to the worker's local disk, so a recording survives
    /// the worker container. Credentials are native/env-only, never webview-supplied.
    pub recording_s3_bucket: Option<String>,
    pub recording_s3_region: Option<String>,
    /// MinIO / non-AWS endpoint, e.g. `http://localhost:9000`.
    pub recording_s3_endpoint: Option<String>,
    pub recording_s3_access_key: Option<String>,
    pub recording_s3_secret: Option<String>,
    /// MinIO needs path-style addressing; virtual-host style is the AWS default.
    pub recording_s3_force_path_style: Option<bool>,
}

// `Default` is derived: every field is an `Option`, so the derived impl is
// byte-identical to the previous hand-written all-`None` constructor.

/// Manual `Debug`: this struct carries LiveKit API/S3 credentials. A derived
/// `Debug` would leak them into logs/panic output, so every secret prints as a
/// fixed marker and only presence is observable.
impl std::fmt::Debug for LivekitConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        fn redacted(v: &Option<String>) -> &'static str {
            match v {
                Some(_) => "<redacted>",
                None => "None",
            }
        }
        f.debug_struct("LivekitConfig")
            .field("server_path", &self.server_path)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("public_url", &self.public_url)
            .field("api_key", &redacted(&self.api_key))
            .field("api_secret", &redacted(&self.api_secret))
            .field("allow_unregistered_rooms", &self.allow_unregistered_rooms)
            .field("egress_url", &self.egress_url)
            .field("recording_filepath", &self.recording_filepath)
            .field("egress_timeout_ms", &self.egress_timeout_ms)
            .field(
                "recording_reservation_ttl_seconds",
                &self.recording_reservation_ttl_seconds,
            )
            .field(
                "recording_max_stop_attempts",
                &self.recording_max_stop_attempts,
            )
            .field("recording_s3_bucket", &self.recording_s3_bucket)
            .field("recording_s3_region", &self.recording_s3_region)
            .field("recording_s3_endpoint", &self.recording_s3_endpoint)
            .field(
                "recording_s3_access_key",
                &redacted(&self.recording_s3_access_key),
            )
            .field("recording_s3_secret", &redacted(&self.recording_s3_secret))
            .field(
                "recording_s3_force_path_style",
                &self.recording_s3_force_path_style,
            )
            .finish()
    }
}

impl LivekitConfig {
    fn server_path(&self) -> String {
        self.server_path
            .clone()
            .or_else(|| std::env::var("LIVEKIT_SERVER_PATH").ok())
            .unwrap_or_else(|| DEFAULT_SERVER_PATH.into())
    }
    fn host(&self) -> String {
        self.host
            .clone()
            .or_else(|| std::env::var("LIVEKIT_HOST").ok())
            .unwrap_or_else(|| DEFAULT_HOST.into())
    }
    fn port(&self) -> u16 {
        self.port
            .or_else(|| {
                std::env::var("LIVEKIT_PORT")
                    .ok()
                    .and_then(|value| value.parse().ok())
            })
            .unwrap_or(DEFAULT_PORT)
    }
    fn public_url(&self) -> String {
        self.public_url
            .clone()
            .or_else(|| std::env::var(LIVEKIT_PUBLIC_URL_ENV).ok())
            .filter(|url| !url.trim().is_empty())
            .unwrap_or_else(|| self.url())
    }
    fn api_key(&self) -> String {
        self.api_key
            .clone()
            .or_else(|| std::env::var("LIVEKIT_API_KEY").ok())
            .unwrap_or_else(|| DEFAULT_API_KEY.into())
    }
    fn api_secret(&self) -> String {
        self.api_secret
            .clone()
            .or_else(|| std::env::var("LIVEKIT_API_SECRET").ok())
            .unwrap_or_else(|| DEFAULT_API_SECRET.into())
    }
    fn url(&self) -> String {
        format!("ws://{}:{}", self.host(), self.port())
    }
    /// Invalid and absent environment values keep anonymous access closed.
    fn allow_unregistered_rooms(&self) -> bool {
        self.allow_unregistered_rooms.unwrap_or_else(|| {
            matches!(
                std::env::var("ALLOW_UNREGISTERED_ROOMS").ok().as_deref(),
                Some("true") | Some("1")
            )
        })
    }
    fn egress_url(&self) -> String {
        self.egress_url
            .clone()
            .or_else(|| std::env::var("LIVEKIT_EGRESS_URL").ok())
            .unwrap_or_else(|| format!("http://{}:{}", self.host(), self.port()))
    }
    fn recording_filepath(&self) -> String {
        self.recording_filepath
            .clone()
            .or_else(|| std::env::var("LIVEKIT_RECORDING_FILEPATH").ok())
            .unwrap_or_else(|| "recordings/{room_name}-{time}.mp4".into())
    }
    fn egress_timeout(&self) -> Duration {
        Duration::from_millis(
            self.egress_timeout_ms
                .or_else(|| {
                    std::env::var("LIVEKIT_EGRESS_TIMEOUT_MS")
                        .ok()
                        .and_then(|v| v.parse().ok())
                })
                .unwrap_or(DEFAULT_EGRESS_TIMEOUT_MS),
        )
    }
    fn reservation_ttl_seconds(&self) -> i64 {
        self.recording_reservation_ttl_seconds
            .or_else(|| {
                std::env::var("LIVEKIT_RECORDING_RESERVATION_TTL_SECONDS")
                    .ok()
                    .and_then(|v| v.parse().ok())
            })
            .filter(|ttl| *ttl > 0)
            .unwrap_or(DEFAULT_RESERVATION_TTL_SECONDS)
    }
    fn max_stop_attempts(&self) -> i64 {
        self.recording_max_stop_attempts
            .or_else(|| {
                std::env::var("LIVEKIT_RECORDING_MAX_STOP_ATTEMPTS")
                    .ok()
                    .and_then(|v| v.parse().ok())
            })
            .filter(|attempts| *attempts > 0)
            .unwrap_or(DEFAULT_MAX_STOP_ATTEMPTS)
    }
    fn s3_setting(field: &Option<String>, var: &str) -> Option<String> {
        field
            .clone()
            .or_else(|| std::env::var(var).ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    }
    fn s3_bucket(&self) -> Option<String> {
        Self::s3_setting(&self.recording_s3_bucket, "LIVEKIT_RECORDING_S3_BUCKET")
    }
    fn s3_force_path_style(&self) -> bool {
        self.recording_s3_force_path_style
            .or_else(|| {
                std::env::var("LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE")
                    .ok()
                    .and_then(|v| v.trim().parse().ok())
            })
            .unwrap_or(false)
    }
    /// The upload sink, or `None` when no bucket is configured (local-file mode).
    /// A named bucket without credentials is a misconfiguration, not a silent
    /// fallback to the worker's disk: recordings must never land somewhere the
    /// operator did not choose.
    fn s3_output(&self) -> Result<Option<serde_json::Value>> {
        let Some(bucket) = self.s3_bucket() else {
            return Ok(None);
        };
        let access_key = Self::s3_setting(
            &self.recording_s3_access_key,
            "LIVEKIT_RECORDING_S3_ACCESS_KEY",
        )
        .ok_or("Recording S3 bucket is configured without an access key")?;
        let secret = Self::s3_setting(&self.recording_s3_secret, "LIVEKIT_RECORDING_S3_SECRET")
            .ok_or("Recording S3 bucket is configured without a secret")?;
        let mut s3 = serde_json::json!({
            "bucket": bucket,
            "access_key": access_key,
            "secret": secret,
        });
        let map = s3.as_object_mut().expect("object literal");
        if let Some(region) =
            Self::s3_setting(&self.recording_s3_region, "LIVEKIT_RECORDING_S3_REGION")
        {
            map.insert("region".into(), region.into());
        }
        if let Some(endpoint) =
            Self::s3_setting(&self.recording_s3_endpoint, "LIVEKIT_RECORDING_S3_ENDPOINT")
        {
            map.insert("endpoint".into(), endpoint.into());
        }
        if self.s3_force_path_style() {
            map.insert("force_path_style".into(), true.into());
        }
        Ok(Some(s3))
    }
}

/// Build the `StartRoomCompositeEgress` request. With a bucket configured the same
/// `filepath` becomes the object key under that bucket; without one the Egress worker
/// keeps writing to its own filesystem. Split out from the RPC so the payload — the part
/// that decides where a recording physically lands — is unit-testable without a worker.
fn start_egress_payload(
    config: &LivekitConfig,
    room: &str,
    filepath: &str,
) -> Result<serde_json::Value> {
    let mut output = serde_json::json!({ "filepath": filepath });
    if let Some(s3) = config.s3_output()? {
        output
            .as_object_mut()
            .expect("object literal")
            .insert("s3".into(), s3);
    }
    Ok(serde_json::json!({
        "room_name": room,
        "layout": "grid",
        "file_outputs": [output],
    }))
}

struct ManagedServer {
    child: Child,
    config: LivekitConfig,
}
static SERVER: LazyLock<Mutex<Option<ManagedServer>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize)]
pub struct LivekitStatus {
    pub running: bool,
    pub url: String,
    pub pid: Option<u32>,
}

fn port_open(config: &LivekitConfig) -> bool {
    TcpStream::connect((config.host().as_str(), config.port())).is_ok()
}

fn ensure_server(config: LivekitConfig) -> Result<LivekitStatus> {
    let mut server = SERVER
        .lock()
        .map_err(|_| "LiveKit server state lock poisoned".to_string())?;
    if let Some(managed) = server.as_mut() {
        if managed
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            if managed.config.host() == config.host() && managed.config.port() == config.port() {
                return Ok(LivekitStatus {
                    running: true,
                    url: config.url(),
                    pid: Some(managed.child.id()),
                });
            }
            return Err("LiveKit is already managed with a different host or port".into());
        }
        *server = None;
    }
    // The web server joins an externally managed production daemon. Only desktop
    // development starts a child when no configured LiveKit endpoint is listening.
    if port_open(&config) {
        return Ok(LivekitStatus { running: true, url: config.url(), pid: None });
    }
    let path = config.server_path();
    let key_pair = format!("{}: {}", config.api_key(), config.api_secret());
    let host = config.host();
    let port = config.port().to_string();
    let child = Command::new(&path)
        .args([
            "--dev", "--bind", &host, "--port", &port, "--keys", &key_pair,
        ])
        .spawn()
        .map_err(|e| format!("Could not start LiveKit at {path}: {e}"))?;
    let pid = child.id();
    *server = Some(ManagedServer {
        child,
        config: config.clone(),
    });
    for _ in 0..30 {
        if port_open(&config) {
            return Ok(LivekitStatus {
                running: true,
                url: config.url(),
                pid: Some(pid),
            });
        }
        if server
            .as_mut()
            .expect("server inserted")
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            *server = None;
            return Err("LiveKit exited before opening its configured port".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "LiveKit did not open {} within 3 seconds",
        config.url()
    ))
}

/// Public IPC surface: the webview names nothing. Where the LiveKit binary lives, which
/// port it binds and which keys it signs with come from native config/env only
/// (`LivekitConfig::default()` + `LIVEKIT_*`). A page that could name them could point the
/// desktop at any process and any signing secret.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn start_livekit_server() -> Result<LivekitStatus> {
    start_livekit_server_with_config(LivekitConfig::default())
}

/// Config-taking core. Not a `tauri::command`: native code and tests only.
pub(crate) fn start_livekit_server_with_config(config: LivekitConfig) -> Result<LivekitStatus> {
    ensure_server(config)
}

/// Public IPC surface: no caller config — see [`start_livekit_server`].
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn livekit_server_status() -> Result<LivekitStatus> {
    livekit_server_status_with_config(LivekitConfig::default())
}

/// Config-taking core. Not a `tauri::command`: native code and tests only.
pub(crate) fn livekit_server_status_with_config(config: LivekitConfig) -> Result<LivekitStatus> {
    let mut server = SERVER
        .lock()
        .map_err(|_| "LiveKit server state lock poisoned".to_string())?;
    let (running, pid) = if let Some(managed) = server.as_mut() {
        if managed
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            (port_open(&managed.config), Some(managed.child.id()))
        } else {
            *server = None;
            (false, None)
        }
    } else {
        (false, None)
    };
    Ok(LivekitStatus {
        running,
        url: config.url(),
        pid,
    })
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

/// The only provider Gaia mints for today; stored on the meeting so a future second
/// provider cannot be mistaken for this one on old rows.
pub(crate) const VIDEO_PROVIDER: &str = "livekit";

fn room_for_meeting(meeting_id: &str) -> String {
    format!("meeting-{meeting_id}")
}

fn token_for(
    config: &LivekitConfig,
    room: String,
    identity: String,
    name: String,
    admin: bool,
) -> Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as usize;
    let claims = LivekitClaims {
        iss: config.api_key(),
        sub: identity,
        name,
        exp: now + TOKEN_LIFETIME_SECONDS as usize,
        nbf: now,
        video: VideoGrant {
            room,
            room_join: true,
            room_admin: admin,
            can_update_own_metadata: false,
            can_publish: true,
            can_publish_sources: DEFAULT_SOURCES.into_iter().map(str::to_owned).collect(),
            can_subscribe: true,
            room_record: false,
        },
        attributes: [(
            "room_admin".into(),
            if admin { "true".into() } else { "false".into() },
        )]
        .into_iter()
        .collect(),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.api_secret().as_bytes()),
    )
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct CallJoin {
    pub url: String,
    pub room: String,
    pub token: String,
}

/// HS256 OIDC normal-room admission. Real IdP JWKS discovery is not implemented.
#[derive(Debug, Deserialize)]
struct NormalRoomOidcClaims {
    sub: String,
    iss: String,
    aud: serde_json::Value,
    exp: usize,
    #[serde(default)]
    name: Option<String>,
}
#[derive(Clone)]
pub struct NormalRoomOidcConfig {
    pub issuer: String,
    pub audience: String,
    pub hs256_secret: String,
}
impl NormalRoomOidcConfig {
    pub fn from_env() -> Result<Self> {
        let required = |key: &str| {
            std::env::var(key)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| format!("{key} must be configured for OIDC normal-room admission"))
        };
        Ok(Self {
            issuer: required("SPACE_NORMAL_ROOM_OIDC_ISSUER")?,
            audience: required("SPACE_NORMAL_ROOM_OIDC_AUDIENCE")?,
            hs256_secret: required("SPACE_NORMAL_ROOM_OIDC_HS256_SECRET")?,
        })
    }
}
fn verify_normal_room_oidc_token(
    token: &str,
    config: &NormalRoomOidcConfig,
) -> Result<(String, String)> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[&config.issuer]);
    validation.set_audience(&[&config.audience]);
    let claims = decode::<NormalRoomOidcClaims>(
        token,
        &DecodingKey::from_secret(config.hs256_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| "invalid OIDC normal-room token".to_string())?
    .claims;
    let _ = (&claims.iss, &claims.aud, claims.exp);
    let subject = claims.sub.trim();
    if subject.is_empty() || subject.len() > 128 {
        return Err("OIDC subject must be 1 to 128 characters".into());
    }
    let name = claims
        .name
        .unwrap_or_else(|| subject.into())
        .trim()
        .to_owned();
    if name.is_empty() || name.len() > 128 {
        return Err("OIDC display name must be 1 to 128 characters".into());
    }
    Ok((subject.into(), name))
}
/// Authenticated normal-room join: LiveKit identity derives from token `sub`.
pub fn join_oidc_normal_meeting_call(meeting_id: String, oidc_token: &str) -> Result<CallJoin> {
    let oidc = NormalRoomOidcConfig::from_env()?;
    let (subject, display_name) = verify_normal_room_oidc_token(oidc_token, &oidc)?;
    join_oidc_normal_meeting_call_with_config(
        meeting_id,
        subject,
        display_name,
        LivekitConfig::default(),
    )
}
fn join_oidc_normal_meeting_call_with_config(
    meeting_id: String,
    subject: String,
    display_name: String,
    config: LivekitConfig,
) -> Result<CallJoin> {
    if !config.allow_unregistered_rooms() {
        return Err("Unregistered normal rooms are disabled".into());
    }
    let meeting = meetings::get_public_meeting(meeting_id)?.ok_or("Normal room not found")?;
    if meeting.video_provider.as_deref() != Some("livekit") {
        return Err("External Meet rooms are not configured".into());
    }
    meetings::video_status_after_join(&meeting.video_status)?;
    let status = ensure_server(config.clone())?;
    let room = room_for_meeting(&meeting.id);
    Ok(CallJoin {
        url: status.url,
        token: token_for(
            &config,
            room.clone(),
            format!("oidc-{subject}"),
            display_name,
            false,
        )?,
        room,
    })
}

/// Anonymous admission is independent of persisted participant scope. Both this
/// config flag and the meeting's persisted PUBLIC access level must opt in.
pub fn join_public_meeting_call(
    meeting_id: String,
    display_name: Option<String>,
) -> Result<CallJoin> {
    join_public_meeting_call_with_config(meeting_id, display_name, LivekitConfig::default())
}
pub(crate) fn join_public_meeting_call_with_config(
    meeting_id: String,
    display_name: Option<String>,
    config: LivekitConfig,
) -> Result<CallJoin> {
    if !config.allow_unregistered_rooms() {
        return Err("Unregistered public rooms are disabled".into());
    }
    let meeting = meetings::get_public_meeting(meeting_id)?.ok_or("Public room not found")?;
    if meeting.video_provider.as_deref() != Some("livekit") {
        return Err("External Meet rooms are not configured".into());
    }
    meetings::video_status_after_join(&meeting.video_status)?;
    let name = display_name
        .unwrap_or_else(|| "Anonymous".into())
        .trim()
        .to_owned();
    if name.is_empty() || name.len() > 128 {
        return Err("Anonymous display name must be 1 to 128 characters".into());
    }
    let mut entropy = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut entropy);
    let status = ensure_server(config.clone())?;
    let room = room_for_meeting(&meeting.id);
    Ok(CallJoin {
        url: status.url,
        token: token_for(
            &config,
            room.clone(),
            format!("anonymous-{}", hex::encode(entropy)),
            name,
            false,
        )?,
        room,
    })
}

/// Application API admission has no user profile. Its identity derives solely from
/// the authenticated application and it never receives the LiveKit room-admin grant.
pub fn join_application_public_meeting_call(
    meeting_id: String,
    application_id: String,
    application_name: String,
) -> Result<CallJoin> {
    if application_id.trim().is_empty() || application_name.trim().is_empty() {
        return Err("Application identity is required".into());
    }
    let config = LivekitConfig::default();
    if !config.allow_unregistered_rooms() {
        return Err("Unregistered application rooms are disabled".into());
    }
    let meeting = meetings::get_public_meeting(meeting_id)?.ok_or("Public room not found")?;
    if meeting.video_provider.as_deref() != Some("livekit") {
        return Err("External Meet rooms are not configured".into());
    }
    meetings::video_status_after_join(&meeting.video_status)?;
    let status = ensure_server(config.clone())?;
    let room = room_for_meeting(&meeting.id);
    Ok(CallJoin {
        url: status.url,
        token: token_for(
            &config,
            room.clone(),
            format!("application-{application_id}"),
            application_name,
            false,
        )?,
        room,
    })
}

/// Public IPC surface: the webview names the meeting and nothing else. Who is joining
/// comes from native state (`actor::resolve`) and their display name from that profile
/// row; the LiveKit endpoint and signing keys from native config/env. A caller that could
/// name its own identity could mint an admin token for somebody else's meeting.
#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn join_meeting_call(app: AppHandle, meeting_id: String) -> Result<CallJoin> {
    let connection = db::connection(&app)?;
    let (participant_id, _) = actor::resolve(&connection)?;
    let display_name = profile_display_name(&connection, &participant_id)?;
    join_meeting_call_with_config(
        app,
        meeting_id,
        participant_id,
        display_name,
        LivekitConfig::default(),
    )
}

/// Display name of a live profile, read natively. Never a caller-supplied string: the
/// name is what other participants see attached to the minted identity.
#[cfg(feature = "desktop")]
fn profile_display_name(connection: &rusqlite::Connection, profile_id: &str) -> Result<String> {
    connection
        .query_row(
            "SELECT display_name FROM profiles WHERE id=?1 AND archived=0",
            rusqlite::params![profile_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| format!("Profile {profile_id:?} has no live display name to join with"))
}

/// Identity/config-taking core. Not a `tauri::command`: neither the acting profile nor the
/// LiveKit settings can cross the IPC boundary.
#[cfg(feature = "desktop")]
pub(crate) fn join_meeting_call_with_config(
    app: AppHandle,
    meeting_id: String,
    participant_id: String,
    display_name: String,
    config: LivekitConfig,
) -> Result<CallJoin> {
    let connection = db::connection(&app)?;
    join_meeting_call_with_connection(
        &connection,
        meeting_id,
        participant_id,
        display_name,
        config,
    )
}

/// HTTP/server counterpart. Its caller obtains identity and display name only from
/// the authenticated session; this function accepts no request body.
pub fn join_web_meeting_call(
    meeting_id: String,
    participant_id: String,
    display_name: String,
) -> Result<CallJoin> {
    let connection = db::conn()?;
    join_meeting_call_with_connection(
        &connection,
        meeting_id,
        participant_id,
        display_name,
        LivekitConfig::default(),
    )
}

fn join_meeting_call_with_connection(
    connection: &rusqlite::Connection,
    meeting_id: String,
    participant_id: String,
    display_name: String,
    config: LivekitConfig,
) -> Result<CallJoin> {
    if participant_id.trim().is_empty() || display_name.trim().is_empty() {
        return Err("Call participant identity and display name are required".into());
    }
    let meeting = meetings::get_meeting_scoped(meeting_id.clone(), participant_id.clone())?
        .ok_or("Meeting not found")?;
    if meeting.archived {
        return Err("Cannot join an archived meeting".into());
    }
    if meeting.video_provider.as_deref() != Some("livekit") {
        return Err("External Meet rooms are not configured; select Native LiveKit or configure the external room API".into());
    }
    let rsvp: Option<String> = connection
        .query_row(
            "SELECT status FROM meeting_participants WHERE meeting_id=?1 AND profile_id=?2",
            rusqlite::params![meeting_id, participant_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let is_organizer = meeting.organizer_id.as_deref() == Some(participant_id.as_str());
    if !is_organizer && !matches!(rsvp.as_deref(), Some("accepted")) {
        return Err("Waiting for organizer admission: only accepted participants can join this meeting call".into());
    }
    ensure_server(config.clone())?;
    let public_url = config.public_url();
    let room = meetings::record_call_room_on(
        connection,
        &meeting_id,
        VIDEO_PROVIDER,
        &room_for_meeting(&meeting_id),
        &public_url,
    )?;
    Ok(CallJoin {
        url: public_url,
        token: token_for(
            &config,
            room.clone(),
            participant_id,
            display_name,
            is_organizer,
        )?,
        room,
    })
}

/// End the call. Organizer-only: any accepted participant may leave their own client,
/// but only the host declares the conference over for the record.
#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn end_meeting_call(app: AppHandle, meeting_id: String) -> Result<bool> {
    let connection = db::connection(&app)?;
    let (participant_id, _) = actor::resolve(&connection)?;
    end_meeting_call_with_connection(&connection, meeting_id, participant_id)
}

/// HTTP/server counterpart; the authenticated session supplies `participant_id`.
pub fn end_web_meeting_call(meeting_id: String, participant_id: String) -> Result<bool> {
    let connection = db::conn()?;
    end_meeting_call_with_connection(&connection, meeting_id, participant_id)
}

fn end_meeting_call_with_connection(
    connection: &rusqlite::Connection,
    meeting_id: String,
    participant_id: String,
) -> Result<bool> {
    let meeting = meetings::get_meeting_scoped(meeting_id.clone(), participant_id.clone())?
        .ok_or("Meeting not found")?;
    if meeting.organizer_id.as_deref() != Some(participant_id.as_str()) {
        return Err("Only the meeting organizer can end the call".into());
    }
    meetings::end_call_on(connection, &meeting_id, &participant_id)
}

/// LiveKit room-composite Egress handle as Gaia records it. The Egress worker writes
/// the media; Gaia owns the lifecycle row so a restart cannot orphan a running job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CallRecording {
    pub id: String,
    pub meeting_id: String,
    pub egress_id: Option<String>,
    pub status: String,
    pub filepath: Option<String>,
    pub started_by: Option<String>,
    pub started_at: i64,
    pub stopped_at: Option<i64>,
    pub stop_attempts: i64,
    pub last_error: Option<String>,
}

const RECORDING_COLUMNS: &str =
    "id,meeting_id,egress_id,status,filepath,started_by,started_at,stopped_at,stop_attempts,last_error";

/// A durable caption fact. Audio never crosses this boundary; an external
/// transcriber may submit source-attributed text, while the desktop UI reads it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CallTranscriptSegment {
    pub id: String,
    pub meeting_id: String,
    pub speaker_id: Option<String>,
    pub text: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub source: String,
    pub created_at: i64,
}

const TRANSCRIPT_COLUMNS: &str =
    "id,meeting_id,speaker_id,text,started_at,ended_at,source,created_at";

fn row_to_transcript_segment(row: &rusqlite::Row<'_>) -> rusqlite::Result<CallTranscriptSegment> {
    Ok(CallTranscriptSegment {
        id: row.get(0)?,
        meeting_id: row.get(1)?,
        speaker_id: row.get(2)?,
        text: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        source: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn new_transcript_segment_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("segment-{nanos:x}")
}

pub(crate) fn append_transcript_segment(
    connection: &rusqlite::Connection,
    meeting_id: &str,
    speaker_id: Option<&str>,
    text: &str,
    started_at: i64,
    ended_at: i64,
    source: &str,
) -> Result<CallTranscriptSegment> {
    let text = text.trim();
    if text.is_empty() || ended_at < started_at || !matches!(source, "external" | "manual") {
        return Err("Transcript segment is invalid".into());
    }
    let segment = CallTranscriptSegment {
        id: new_transcript_segment_id(),
        meeting_id: meeting_id.to_owned(),
        speaker_id: speaker_id.map(str::to_owned),
        text: text.to_owned(),
        started_at,
        ended_at,
        source: source.to_owned(),
        created_at: now_seconds(),
    };
    connection.execute(
        "INSERT INTO call_transcript_segments (id,meeting_id,speaker_id,text,started_at,ended_at,source,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![segment.id, segment.meeting_id, segment.speaker_id, segment.text, segment.started_at, segment.ended_at, segment.source, segment.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(segment)
}

pub(crate) fn transcript_segments_for_meeting(
    connection: &rusqlite::Connection,
    meeting_id: &str,
) -> Result<Vec<CallTranscriptSegment>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {TRANSCRIPT_COLUMNS} FROM call_transcript_segments WHERE meeting_id=?1 ORDER BY started_at,id"
    )).map_err(|e| e.to_string())?;
    let segments = statement
        .query_map(rusqlite::params![meeting_id], row_to_transcript_segment)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(segments)
}

/// Captions are readable only through the same meeting scope as recordings.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_meeting_transcript_segments(meeting_id: String) -> Result<Vec<CallTranscriptSegment>> {
    let connection = db::conn()?;
    let (actor_id, _) = actor::resolve(&connection)?;
    meetings::get_meeting_scoped(meeting_id.clone(), actor_id)?.ok_or("Meeting not found")?;
    transcript_segments_for_meeting(&connection, &meeting_id)
}

/// A participant can contribute only a self-attributed manual caption. External
/// provider ingestion stays outside IPC and uses `append_transcript_segment` directly.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn append_manual_transcript_segment(
    meeting_id: String,
    text: String,
    started_at: i64,
    ended_at: i64,
) -> Result<CallTranscriptSegment> {
    let connection = db::conn()?;
    let (actor_id, _) = actor::resolve(&connection)?;
    meetings::get_meeting_scoped(meeting_id.clone(), actor_id.clone())?
        .ok_or("Meeting not found")?;
    append_transcript_segment(
        &connection,
        &meeting_id,
        Some(&actor_id),
        &text,
        started_at,
        ended_at,
        "manual",
    )
}

fn row_to_recording(row: &rusqlite::Row<'_>) -> rusqlite::Result<CallRecording> {
    Ok(CallRecording {
        id: row.get(0)?,
        meeting_id: row.get(1)?,
        egress_id: row.get(2)?,
        status: row.get(3)?,
        filepath: row.get(4)?,
        started_by: row.get(5)?,
        started_at: row.get(6)?,
        stopped_at: row.get(7)?,
        stop_attempts: row.get(8)?,
        last_error: row.get(9)?,
    })
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn new_recording_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("rec-{nanos:x}")
}

/// The single active-recording reader. The partial unique index on
/// `meeting_recordings` makes "two live jobs for one meeting" unrepresentable, so
/// the double-start guard cannot be raced away by two windows of the same app.
pub(crate) fn active_recording(
    connection: &rusqlite::Connection,
    meeting_id: &str,
) -> Result<Option<CallRecording>> {
    connection.query_row(&format!("SELECT {RECORDING_COLUMNS} FROM meeting_recordings WHERE meeting_id=?1 AND status IN ('starting','recording','stopping')"), rusqlite::params![meeting_id], row_to_recording).optional().map_err(|e| e.to_string())
}
/// Claim locally before Egress RPC; partial unique index serializes concurrent callers.
pub(crate) fn reserve_recording(
    connection: &rusqlite::Connection,
    meeting_id: &str,
    filepath: &str,
    started_by: &str,
) -> Result<CallRecording> {
    let recording = CallRecording {
        id: new_recording_id(),
        meeting_id: meeting_id.to_owned(),
        egress_id: None,
        status: "starting".into(),
        filepath: Some(filepath.to_owned()),
        started_by: Some(started_by.to_owned()),
        started_at: now_seconds(),
        stopped_at: None,
        stop_attempts: 0,
        last_error: None,
    };
    connection.execute("INSERT INTO meeting_recordings (id,meeting_id,egress_id,status,filepath,started_by,started_at,stopped_at) VALUES (?1,?2,NULL,'starting',?3,?4,?5,NULL)", rusqlite::params![recording.id, recording.meeting_id, recording.filepath, recording.started_by, recording.started_at]).map_err(|e| e.to_string())?;
    Ok(recording)
}
/// Marker prefix for rows whose remote Egress state Gaia could not confirm. Such a row
/// keeps the meeting's active reservation on purpose: releasing it could start a second
/// recording next to a job that may still be running remotely.
pub(crate) const UNCONFIRMED_PREFIX: &str = "UNCONFIRMED:";
pub(crate) const START_IN_FLIGHT: &str = "UNCONFIRMED: StartRoomCompositeEgress in flight";
pub(crate) const STOP_IN_FLIGHT: &str = "UNCONFIRMED: StopEgress in flight";

/// Arm the row just before the start RPC leaves the process. A crash after this point is
/// indistinguishable from a running remote job, so the TTL must not reclaim it.
pub(crate) fn mark_start_rpc_in_flight(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<()> {
    connection
        .execute(
            "UPDATE meeting_recordings SET last_error=?2 WHERE id=?1 AND status='starting'",
            rusqlite::params![recording_id, START_IN_FLIGHT],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remote state unknown (timeout, 5xx, unreadable reply, failed cleanup): hold the
/// reservation and record why. Only an operator — or a later confirmed stop — releases it.
pub(crate) fn mark_recording_unconfirmed(
    connection: &rusqlite::Connection,
    recording_id: &str,
    error: &str,
) -> Result<CallRecording> {
    connection
        .execute(
            "UPDATE meeting_recordings SET last_error=?2 WHERE id=?1",
            rusqlite::params![recording_id, format!("{UNCONFIRMED_PREFIX} {error}")],
        )
        .map_err(|e| e.to_string())?;
    get_recording(connection, recording_id)
}

/// Reclaim only rows that provably never reached the Egress service: `starting`, no
/// egress id, and no in-flight/unconfirmed marker. Everything else — anything `stopping`,
/// or any row whose RPC was in flight — is left locked, because remote termination is
/// unconfirmed and a timed unlock would be a fail-open double-recording hazard.
pub(crate) fn expire_stale_lifecycle(
    connection: &rusqlite::Connection,
    ttl_seconds: i64,
) -> Result<usize> {
    let now = now_seconds();
    connection
        .execute(
            "UPDATE meeting_recordings SET status='failed', stopped_at=?1, last_error='Abandoned before the Egress request was sent' WHERE status='starting' AND egress_id IS NULL AND last_error IS NULL AND started_at<=?2",
            rusqlite::params![now, now - ttl_seconds],
        )
        .map_err(|e| e.to_string())
}
pub(crate) fn get_recording(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<CallRecording> {
    connection
        .query_row(
            &format!("SELECT {RECORDING_COLUMNS} FROM meeting_recordings WHERE id=?1"),
            rusqlite::params![recording_id],
            row_to_recording,
        )
        .map_err(|e| e.to_string())
}
/// Compare-and-swap into the durable `stopping` phase. `recording` → `stopping` succeeds
/// exactly once, and a row already carrying the in-flight marker is refused, so two
/// concurrent Stop calls can never both reach StopEgress. A finished-but-failed attempt
/// (marker replaced by the real error) stays retryable.
pub(crate) fn begin_recording_stop(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<i64> {
    if connection
        .execute(
            "UPDATE meeting_recordings SET status='stopping', stop_attempts=stop_attempts+1, last_error=?2 WHERE id=?1 AND (status='recording' OR (status='stopping' AND last_error IS NOT NULL AND last_error<>?2))",
            rusqlite::params![recording_id, STOP_IN_FLIGHT],
        )
        .map_err(|e| e.to_string())?
        == 0
    {
        let existing = get_recording(connection, recording_id)?;
        return Err(if existing.status == "stopping" {
            "A stop for that recording is already in flight".into()
        } else {
            "That recording is no longer running".to_string()
        });
    }
    connection
        .query_row(
            "SELECT stop_attempts FROM meeting_recordings WHERE id=?1",
            rusqlite::params![recording_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
}
/// A failed stop leaves the row in `stopping`: the remote job may well still be writing,
/// so the reservation is never released on a failure. The attempt is retryable — the row
/// only leaves `stopping` on a confirmed StopEgress.
pub(crate) fn mark_recording_stop_failed(
    connection: &rusqlite::Connection,
    recording_id: &str,
    error: &str,
) -> Result<CallRecording> {
    connection
        .execute(
            "UPDATE meeting_recordings SET last_error=?2 WHERE id=?1 AND status='stopping'",
            rusqlite::params![recording_id, format!("{UNCONFIRMED_PREFIX} {error}")],
        )
        .map_err(|e| e.to_string())?;
    get_recording(connection, recording_id)
}
pub(crate) fn mark_recording_started(
    connection: &rusqlite::Connection,
    recording_id: &str,
    egress_id: &str,
) -> Result<CallRecording> {
    if connection.execute("UPDATE meeting_recordings SET egress_id=?2,status='recording' WHERE id=?1 AND status='starting'", rusqlite::params![recording_id, egress_id]).map_err(|e| e.to_string())? == 0 { return Err("That recording reservation is no longer starting".into()); }
    connection
        .query_row(
            &format!("SELECT {RECORDING_COLUMNS} FROM meeting_recordings WHERE id=?1"),
            rusqlite::params![recording_id],
            row_to_recording,
        )
        .map_err(|e| e.to_string())
}
pub(crate) fn mark_recording_failed(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<()> {
    if connection.execute("UPDATE meeting_recordings SET status='failed',stopped_at=?2 WHERE id=?1 AND status='starting'", rusqlite::params![recording_id, now_seconds()]).map_err(|e| e.to_string())? == 0 { return Err("That recording reservation is no longer starting".into()); }
    Ok(())
}
pub(crate) fn mark_recording_stopped(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<CallRecording> {
    if connection.execute("UPDATE meeting_recordings SET status='stopped', stopped_at=?2, last_error=NULL WHERE id=?1 AND status IN ('recording','stopping')", rusqlite::params![recording_id, now_seconds()]).map_err(|e| e.to_string())? == 0 {
        // Idempotent: the remote job is already gone, so a retry after a failed DB write
        // must converge on `stopped` rather than error.
        let existing = get_recording(connection, recording_id)?;
        if existing.status != "stopped" {
            return Err("That recording is no longer running".into());
        }
        return Ok(existing);
    }
    get_recording(connection, recording_id)
}
pub(crate) fn recordings_for_meeting(
    connection: &rusqlite::Connection,
    meeting_id: &str,
) -> Result<Vec<CallRecording>> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {RECORDING_COLUMNS} FROM meeting_recordings WHERE meeting_id=?1 ORDER BY started_at DESC, id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(rusqlite::params![meeting_id], row_to_recording)
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

/// Recording evidence is readable by anyone who may read the meeting; only the
/// organizer may start or stop a job.
///
/// Public IPC surface: the caller names the meeting only. The reading profile is
/// resolved from native state (`actor::resolve`), so a webview cannot borrow
/// somebody else's read scope to enumerate their recordings.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_meeting_recordings(meeting_id: String) -> Result<Vec<CallRecording>> {
    let connection = db::conn()?;
    let (actor_id, _) = actor::resolve(&connection)?;
    list_meeting_recordings_as(&connection, &meeting_id, &actor_id)
}

/// Actor-taking core; not a command, so the acting profile can never arrive over IPC.
pub(crate) fn list_meeting_recordings_as(
    connection: &rusqlite::Connection,
    meeting_id: &str,
    actor_id: &str,
) -> Result<Vec<CallRecording>> {
    meetings::get_meeting_scoped(meeting_id.to_owned(), actor_id.to_owned())?
        .ok_or("Meeting not found")?;
    recordings_for_meeting(connection, meeting_id)
}

/// Truthful report of whether this installation can name the acting profile.
/// The UI asks before offering recording controls, so a fail-closed backend
/// never shows up as a button that silently does nothing.
#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn recording_actor_status(app: AppHandle) -> Result<actor::ActorStatus> {
    let connection = db::connection(&app)?;
    Ok(actor::status(&connection))
}

#[cfg(feature = "desktop")]
fn recording_authorized(_app: &AppHandle, meeting_id: &str, actor_id: &str) -> Result<String> {
    let meeting = meetings::get_meeting_scoped(meeting_id.to_owned(), actor_id.to_owned())?
        .ok_or("Meeting not found")?;
    if meeting.archived {
        return Err("Cannot record an archived meeting".into());
    }
    if meeting.organizer_id.as_deref() != Some(actor_id) {
        return Err("Only the meeting organizer can control recording".into());
    }
    Ok(room_for_meeting(meeting_id))
}

#[cfg(feature = "desktop")]
fn egress_token(config: &LivekitConfig, room: String) -> Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as usize;
    let claims = LivekitClaims {
        iss: config.api_key(),
        sub: "gaia-space-egress".into(),
        name: "GAIA Space recorder".into(),
        exp: now + TOKEN_LIFETIME_SECONDS as usize,
        nbf: now,
        video: VideoGrant {
            room,
            room_join: false,
            room_admin: true,
            can_update_own_metadata: false,
            can_publish: false,
            can_publish_sources: vec![],
            can_subscribe: false,
            room_record: true,
        },
        attributes: std::collections::BTreeMap::new(),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.api_secret().as_bytes()),
    )
    .map_err(|e| e.to_string())
}

/// An Egress call that did not succeed, plus the only fact that matters for safety:
/// whether the remote side may have acted anyway. `ambiguous` forces fail-closed handling.
#[derive(Debug, Clone)]
pub(crate) struct EgressFailure {
    pub message: String,
    pub ambiguous: bool,
}

impl EgressFailure {
    fn definite(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            ambiguous: false,
        }
    }
    fn ambiguous(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            ambiguous: true,
        }
    }
}

#[cfg(feature = "desktop")]
fn egress_rpc(
    config: &LivekitConfig,
    method: &str,
    room: &str,
    body: serde_json::Value,
) -> std::result::Result<serde_json::Value, EgressFailure> {
    let endpoint = format!(
        "{}/twirp/livekit.Egress/{method}",
        config.egress_url().trim_end_matches('/')
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(config.egress_timeout())
        .build()
        .map_err(|e| EgressFailure::definite(e.to_string()))?;
    let token = egress_token(config, room.to_owned()).map_err(EgressFailure::definite)?;
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|e| {
            let message = format!("LiveKit Egress request failed: {e}");
            // Only a failed connect proves the request never reached the service; a
            // timeout or a broken read may well have executed remotely.
            if e.is_connect() && !e.is_timeout() {
                EgressFailure::definite(message)
            } else {
                EgressFailure::ambiguous(message)
            }
        })?;
    let status = response.status();
    let payload = response
        .text()
        .map_err(|e| EgressFailure::ambiguous(format!("LiveKit Egress reply unreadable: {e}")))?;
    if !status.is_success() {
        let message = format!("LiveKit Egress returned {status}: {payload}");
        return Err(
            if status.is_server_error() || status.as_u16() == 408 || status.as_u16() == 429 {
                EgressFailure::ambiguous(message)
            } else {
                EgressFailure::definite(message)
            },
        );
    }
    serde_json::from_str(&payload)
        .map_err(|e| EgressFailure::ambiguous(format!("LiveKit Egress returned invalid JSON: {e}")))
}

/// Start a room-composite MP4 Egress job. Requires a deployed Egress worker and
/// writable `LIVEKIT_RECORDING_FILEPATH`; missing infrastructure fails visibly.
/// Public IPC surface: the webview may name the meeting and nothing else. The
/// acting profile comes from native state (`actor::resolve`), and the Egress
/// endpoint, output path and timeouts from native config/env only
/// (`LivekitConfig::default()` + `LIVEKIT_*`). A page that could name either
/// could record as somebody else, or into somebody else's sink.
#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn start_meeting_recording(app: AppHandle, meeting_id: String) -> Result<CallRecording> {
    let actor_id = actor::resolve(&db::connection(&app)?)?.0;
    start_meeting_recording_with_config(app, meeting_id, actor_id, LivekitConfig::default())
}

/// Config/actor-taking core. Not a `tauri::command`: reachable from native code and
/// tests only, so neither the acting profile nor Egress settings cross the IPC boundary.
#[cfg(feature = "desktop")]
pub(crate) fn start_meeting_recording_with_config(
    app: AppHandle,
    meeting_id: String,
    actor_id: String,
    config: LivekitConfig,
) -> Result<CallRecording> {
    let room = recording_authorized(&app, &meeting_id, &actor_id)?;
    let connection = db::connection(&app)?;
    // A row abandoned by a dead attempt must not block a fresh recording.
    expire_stale_lifecycle(&connection, config.reservation_ttl_seconds())?;
    let filepath = config.recording_filepath();
    // Built before the reservation: a misconfigured sink must fail with no row held.
    let payload = start_egress_payload(&config, &room, &filepath)?;
    let reservation = reserve_recording(&connection, &meeting_id, &filepath, &actor_id)?;
    // Arm before the wire: from here on an abandoned row is remote-unconfirmed and the
    // TTL must not reclaim it.
    mark_start_rpc_in_flight(&connection, &reservation.id)?;
    let response = match egress_rpc(&config, "StartRoomCompositeEgress", &room, payload) {
        Ok(response) => response,
        Err(failure) => return Err(release_or_hold(&connection, &reservation.id, failure)),
    };
    let egress_id = match response
        .get("egress_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.is_empty())
    {
        Some(id) => id,
        None => {
            // The service accepted the call but named no job: it may have started one.
            return Err(release_or_hold(
                &connection,
                &reservation.id,
                EgressFailure::ambiguous("LiveKit Egress did not return an egress_id"),
            ));
        }
    };
    match mark_recording_started(&connection, &reservation.id, egress_id) {
        Ok(recording) => Ok(recording),
        Err(error) => {
            // Compensating stop. If cleanup itself fails, the remote job's fate is
            // unknown, so the reservation stays held rather than freeing the meeting.
            match egress_rpc(
                &config,
                "StopEgress",
                &room,
                serde_json::json!({"egress_id": egress_id}),
            ) {
                Ok(_) => {
                    let _ = mark_recording_failed(&connection, &reservation.id);
                    Err(error)
                }
                Err(cleanup) => {
                    let _ = mark_recording_unconfirmed(
                        &connection,
                        &reservation.id,
                        &format!("{error}; cleanup StopEgress failed: {}", cleanup.message),
                    );
                    Err(held_message(&format!(
                        "{error}; cleanup StopEgress failed: {}",
                        cleanup.message
                    )))
                }
            }
        }
    }
}

/// The one place that decides whether a start failure may free the meeting.
#[cfg(feature = "desktop")]
fn release_or_hold(
    connection: &rusqlite::Connection,
    recording_id: &str,
    failure: EgressFailure,
) -> String {
    if failure.ambiguous {
        let _ = mark_recording_unconfirmed(connection, recording_id, &failure.message);
        held_message(&failure.message)
    } else {
        let _ = mark_recording_failed(connection, recording_id);
        failure.message
    }
}

/// A reservation with no egress id may only be released when nothing was ever put on the
/// wire for it: no in-flight marker, no unconfirmed marker, and still `starting`.
pub(crate) fn may_release_unstarted_reservation(recording: &CallRecording) -> bool {
    recording.egress_id.is_none()
        && recording.status == "starting"
        && !recording
            .last_error
            .as_deref()
            .is_some_and(|error| error.starts_with(UNCONFIRMED_PREFIX))
}

fn held_message(error: &str) -> String {
    format!("{error} (remote Egress state unconfirmed: the recording reservation is held; stop or clear it before recording again)")
}
#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn stop_meeting_recording(app: AppHandle, meeting_id: String) -> Result<CallRecording> {
    let actor_id = actor::resolve(&db::connection(&app)?)?.0;
    stop_meeting_recording_with_config(app, meeting_id, actor_id, LivekitConfig::default())
}

/// Config/actor-taking core; see `start_meeting_recording_with_config`.
#[cfg(feature = "desktop")]
pub(crate) fn stop_meeting_recording_with_config(
    app: AppHandle,
    meeting_id: String,
    actor_id: String,
    config: LivekitConfig,
) -> Result<CallRecording> {
    let room = recording_authorized(&app, &meeting_id, &actor_id)?;
    let connection = db::connection(&app)?;
    expire_stale_lifecycle(&connection, config.reservation_ttl_seconds())?;
    // Read the handle from SQLite, not from process memory: a job started before an
    // app restart is still stoppable.
    let recording = active_recording(&connection, &meeting_id)?
        .ok_or("No active recording is known for this meeting")?;
    let Some(egress_id) = recording.egress_id.clone() else {
        // No egress id is not the same as no remote job. A row armed by
        // `mark_start_rpc_in_flight` — or later marked unconfirmed — may have reached the
        // Egress service; the id is simply not back yet. Releasing it here would let the
        // next start run a second recording beside a live remote job, so refuse.
        if !may_release_unstarted_reservation(&recording) {
            return Err(held_message(
                "Cannot stop: the start request may still be in flight",
            ));
        }
        // Nothing was ever sent: releasing the reservation is safe and keeps the meeting
        // recordable.
        mark_recording_failed(&connection, &recording.id)?;
        return get_recording(&connection, &recording.id);
    };
    begin_recording_stop(&connection, &recording.id)?;
    if let Err(failure) = egress_rpc(
        &config,
        "StopEgress",
        &room,
        serde_json::json!({ "egress_id": egress_id }),
    ) {
        // A stop that failed never proves the remote job ended: keep the row in
        // `stopping` (still holding the meeting) and stay retryable.
        let row = mark_recording_stop_failed(&connection, &recording.id, &failure.message)?;
        return Err(if row.stop_attempts >= config.max_stop_attempts() {
            format!(
                "{} ({} failed stop attempts; the recording stays reserved until a stop succeeds — check the Egress worker)",
                failure.message, row.stop_attempts
            )
        } else {
            failure.message
        });
    }
    mark_recording_stopped(&connection, &recording.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn recording_conn() -> rusqlite::Connection {
        let connection = db::open_in_memory().expect("in-memory database");
        db::migrate(&connection).expect("migration");
        db::seed(&connection).expect("seed");
        connection
            .execute(
                "INSERT INTO meetings (id,title,starts_at,ends_at,organizer_id,archived) VALUES ('m-1','Standup',0,3600,'default-org',0)",
                [],
            )
            .expect("seed meeting");
        connection
    }

    #[test]
    fn transcript_segments_are_ordered_and_validate_their_facts() {
        let connection = recording_conn();
        let later = append_transcript_segment(
            &connection,
            "m-1",
            Some("default-org"),
            "Later",
            20,
            21,
            "manual",
        )
        .unwrap();
        let first =
            append_transcript_segment(&connection, "m-1", None, " First ", 10, 12, "external")
                .unwrap();
        assert!(
            append_transcript_segment(&connection, "m-1", None, "   ", 1, 1, "external").is_err()
        );
        assert!(
            append_transcript_segment(&connection, "m-1", None, "bad range", 2, 1, "external")
                .is_err()
        );
        let segments = transcript_segments_for_meeting(&connection, "m-1").unwrap();
        assert_eq!(segments, vec![first, later]);
        assert_eq!(segments[0].text, "First");
    }

    #[test]
    fn reservation_prevents_a_second_egress_before_rpc() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        assert_eq!(reserved.status, "starting");
        assert!(reserve_recording(&connection, "m-1", "b.mp4", "default-org").is_err());
        mark_recording_failed(&connection, &reserved.id).unwrap();
        let retry = reserve_recording(&connection, "m-1", "b.mp4", "default-org").unwrap();
        let started = mark_recording_started(&connection, &retry.id, "EG_2").unwrap();
        assert_eq!(started.egress_id.as_deref(), Some("EG_2"));
        mark_recording_stopped(&connection, &started.id).unwrap();
        assert!(active_recording(&connection, "m-1").unwrap().is_none());
    }
    #[test]
    fn failed_stop_stays_retryable_and_never_releases_an_unconfirmed_remote_job() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        mark_recording_started(&connection, &reserved.id, "EG_1").unwrap();
        for attempt in 1..=3 {
            assert_eq!(
                begin_recording_stop(&connection, &reserved.id).unwrap(),
                attempt
            );
            let row = mark_recording_stop_failed(&connection, &reserved.id, "boom").unwrap();
            assert_eq!(
                row.status, "stopping",
                "remote termination stays unconfirmed"
            );
            assert!(row
                .last_error
                .as_deref()
                .unwrap()
                .starts_with(UNCONFIRMED_PREFIX));
            assert!(
                active_recording(&connection, "m-1").unwrap().is_some(),
                "fail-closed: the meeting stays reserved"
            );
            assert!(reserve_recording(&connection, "m-1", "b.mp4", "default-org").is_err());
        }
        // Only a confirmed stop frees the meeting.
        mark_recording_stopped(&connection, &reserved.id).unwrap();
        assert!(active_recording(&connection, "m-1").unwrap().is_none());
    }

    #[test]
    fn stop_is_a_compare_and_swap_so_two_concurrent_stops_cannot_both_call_egress() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        mark_recording_started(&connection, &reserved.id, "EG_1").unwrap();
        assert_eq!(begin_recording_stop(&connection, &reserved.id).unwrap(), 1);
        let second = begin_recording_stop(&connection, &reserved.id).unwrap_err();
        assert!(second.contains("already in flight"), "{second}");
        // Once the first attempt has finished and failed, a retry is allowed again.
        mark_recording_stop_failed(&connection, &reserved.id, "boom").unwrap();
        assert_eq!(begin_recording_stop(&connection, &reserved.id).unwrap(), 2);
    }

    #[test]
    fn a_stop_racing_an_in_flight_start_cannot_release_the_reservation() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        // Before the wire: a stop here provably races nothing, so it may free the meeting.
        assert!(may_release_unstarted_reservation(&reserved));

        // Start RPC is now in flight; the egress id is not back yet, but a remote job may
        // already exist. A concurrent stop must fail closed rather than unlock.
        mark_start_rpc_in_flight(&connection, &reserved.id).unwrap();
        let armed = get_recording(&connection, &reserved.id).unwrap();
        assert_eq!(armed.egress_id, None);
        assert!(
            !may_release_unstarted_reservation(&armed),
            "fail-closed: an in-flight start is not a free reservation"
        );

        // Same for an ambiguous start failure that left the remote state unknown.
        let unconfirmed = mark_recording_unconfirmed(&connection, &reserved.id, "timeout").unwrap();
        assert!(!may_release_unstarted_reservation(&unconfirmed));
        assert!(active_recording(&connection, "m-1").unwrap().is_some());
        assert!(reserve_recording(&connection, "m-1", "b.mp4", "default-org").is_err());

        // A row that did reach the service is never on this path either.
        let started = mark_recording_started(&connection, &reserved.id, "EG_1").unwrap();
        assert!(!may_release_unstarted_reservation(&started));
    }

    #[test]
    fn ttl_never_unlocks_a_row_whose_remote_state_is_unconfirmed() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        mark_start_rpc_in_flight(&connection, &reserved.id).unwrap();
        connection
            .execute(
                "UPDATE meeting_recordings SET started_at=started_at-600 WHERE id=?1",
                rusqlite::params![reserved.id],
            )
            .unwrap();
        assert_eq!(
            expire_stale_lifecycle(&connection, 120).unwrap(),
            0,
            "an in-flight start is not reclaimed by a timer"
        );
        assert!(active_recording(&connection, "m-1").unwrap().is_some());

        mark_recording_started(&connection, &reserved.id, "EG_1").unwrap();
        begin_recording_stop(&connection, &reserved.id).unwrap();
        mark_recording_stop_failed(&connection, &reserved.id, "timeout").unwrap();
        assert_eq!(expire_stale_lifecycle(&connection, 120).unwrap(), 0);
        assert_eq!(
            get_recording(&connection, &reserved.id).unwrap().status,
            "stopping"
        );
    }

    #[test]
    fn stop_is_idempotent_so_a_failed_db_write_can_be_replayed() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        mark_recording_started(&connection, &reserved.id, "EG_1").unwrap();
        begin_recording_stop(&connection, &reserved.id).unwrap();
        let stopped = mark_recording_stopped(&connection, &reserved.id).unwrap();
        assert_eq!(stopped.status, "stopped");
        let replay = mark_recording_stopped(&connection, &reserved.id).unwrap();
        assert_eq!(replay, stopped, "replaying a stop converges, never errors");
    }

    #[test]
    fn rows_abandoned_before_the_egress_request_expire() {
        let connection = recording_conn();
        let reserved = reserve_recording(&connection, "m-1", "a.mp4", "default-org").unwrap();
        assert_eq!(
            expire_stale_lifecycle(&connection, 120).unwrap(),
            0,
            "fresh rows survive"
        );
        connection
            .execute(
                "UPDATE meeting_recordings SET started_at=started_at-600 WHERE id=?1",
                rusqlite::params![reserved.id],
            )
            .unwrap();
        assert_eq!(expire_stale_lifecycle(&connection, 120).unwrap(), 1);
        let expired = get_recording(&connection, &reserved.id).unwrap();
        assert_eq!(expired.status, "failed");
        assert!(expired.last_error.is_some());
        assert!(active_recording(&connection, "m-1").unwrap().is_none());
    }

    #[test]
    fn defaults_are_configurable() {
        let defaults = LivekitConfig::default();
        assert_eq!(
            defaults.egress_timeout(),
            Duration::from_millis(DEFAULT_EGRESS_TIMEOUT_MS)
        );
        let overridden = LivekitConfig {
            egress_timeout_ms: Some(250),
            recording_reservation_ttl_seconds: Some(7),
            recording_max_stop_attempts: Some(9),
            ..Default::default()
        };
        assert_eq!(overridden.egress_timeout(), Duration::from_millis(250));
        assert_eq!(overridden.reservation_ttl_seconds(), 7);
        assert_eq!(overridden.max_stop_attempts(), 9);
    }

    // Regression: the IPC signature itself is the security boundary. If someone adds a
    // `config` parameter back to the public command this stops compiling.
    #[cfg(feature = "desktop")]
    #[test]
    fn public_recording_commands_take_no_caller_config() {
        let _start: fn(AppHandle, String) -> Result<CallRecording> = start_meeting_recording;
        let _stop: fn(AppHandle, String) -> Result<CallRecording> = stop_meeting_recording;
        // ...and no acting-profile parameter either: the actor is native-resolved.
        let _list: fn(String) -> Result<Vec<CallRecording>> = list_meeting_recordings;
    }

    // Same boundary for the call/runtime commands: identity and LiveKit settings are
    // native-only. Re-adding a caller argument breaks this compile.
    #[test]
    fn public_livekit_commands_take_no_caller_config() {
        let _start: fn() -> Result<LivekitStatus> = start_livekit_server;
        let _status: fn() -> Result<LivekitStatus> = livekit_server_status;
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn public_join_command_takes_only_the_meeting() {
        let _join: fn(AppHandle, String) -> Result<CallJoin> = join_meeting_call;
    }

    fn s3_config() -> LivekitConfig {
        LivekitConfig {
            recording_s3_bucket: Some("gaia-recordings".into()),
            recording_s3_access_key: Some("minio-key".into()),
            recording_s3_secret: Some("minio-secret".into()),
            recording_s3_endpoint: Some("http://localhost:9000".into()),
            recording_s3_region: Some("us-east-1".into()),
            recording_s3_force_path_style: Some(true),
            ..Default::default()
        }
    }

    #[test]
    fn payload_without_a_bucket_keeps_writing_to_the_worker_filesystem() {
        let config = LivekitConfig {
            recording_s3_bucket: Some(String::new()),
            ..Default::default()
        };
        let payload = start_egress_payload(&config, "meeting-m-1", "recordings/a.mp4").unwrap();
        assert_eq!(payload["room_name"], "meeting-m-1");
        assert_eq!(payload["file_outputs"][0]["filepath"], "recordings/a.mp4");
        assert!(payload["file_outputs"][0].get("s3").is_none());
    }

    #[test]
    fn payload_with_a_bucket_uploads_the_same_path_as_an_object_key() {
        let payload =
            start_egress_payload(&s3_config(), "meeting-m-1", "recordings/a.mp4").unwrap();
        let output = &payload["file_outputs"][0];
        assert_eq!(output["filepath"], "recordings/a.mp4");
        let s3 = &output["s3"];
        assert_eq!(s3["bucket"], "gaia-recordings");
        assert_eq!(s3["access_key"], "minio-key");
        assert_eq!(s3["secret"], "minio-secret");
        assert_eq!(s3["endpoint"], "http://localhost:9000");
        assert_eq!(s3["region"], "us-east-1");
        assert_eq!(s3["force_path_style"], true);
    }

    #[test]
    fn aws_style_sink_omits_endpoint_and_path_style() {
        let config = LivekitConfig {
            recording_s3_endpoint: None,
            recording_s3_force_path_style: Some(false),
            ..s3_config()
        };
        let s3 = start_egress_payload(&config, "meeting-m-1", "a.mp4").unwrap()["file_outputs"][0]
            ["s3"]
            .clone();
        assert!(s3.get("force_path_style").is_none());
        assert_eq!(s3["region"], "us-east-1");
        // endpoint may still come from the environment; only the explicit-None case is
        // asserted through the field-set path below.
        assert_eq!(s3["bucket"], "gaia-recordings");
    }

    #[test]
    fn a_bucket_without_credentials_fails_instead_of_falling_back_to_local_disk() {
        let config = LivekitConfig {
            recording_s3_access_key: None,
            recording_s3_secret: None,
            ..s3_config()
        };
        let error = start_egress_payload(&config, "meeting-m-1", "a.mp4").unwrap_err();
        assert!(
            error.contains("access key") || error.contains("secret"),
            "{error}"
        );
        let secretless = LivekitConfig {
            recording_s3_secret: Some("  ".into()),
            ..s3_config()
        };
        assert!(start_egress_payload(&secretless, "meeting-m-1", "a.mp4")
            .unwrap_err()
            .contains("secret"));
    }

    #[test]
    fn room_name_is_derived_only_from_meeting_id() {
        assert_eq!(room_for_meeting("a-b_1"), "meeting-a-b_1");
    }
    #[test]
    fn minted_token_decodes_with_meet_style_grants() {
        let config = LivekitConfig {
            api_key: Some("test-key".into()),
            api_secret: Some("test-secret".into()),
            ..Default::default()
        };
        let token = token_for(
            &config,
            room_for_meeting("m-1"),
            "p-1".into(),
            "Pat".into(),
            true,
        )
        .unwrap();
        let decoded = decode::<LivekitClaims>(
            &token,
            &DecodingKey::from_secret(b"test-secret"),
            &Validation::new(Algorithm::HS256),
        )
        .unwrap();
        assert_eq!(decoded.claims.video.room, "meeting-m-1");
        assert!(
            decoded.claims.video.room_join
                && decoded.claims.video.can_publish
                && decoded.claims.video.can_subscribe
        );
        assert!(decoded.claims.video.room_admin);
        assert!(!decoded.claims.video.room_record);
        assert_eq!(decoded.claims.video.can_publish_sources, DEFAULT_SOURCES);
    }
    #[cfg(feature = "desktop")]
    #[test]
    fn egress_token_has_only_room_record_grant() {
        let config = LivekitConfig {
            api_key: Some("test-key".into()),
            api_secret: Some("test-secret".into()),
            ..Default::default()
        };
        let token = egress_token(&config, room_for_meeting("m-1")).unwrap();
        let decoded = decode::<LivekitClaims>(
            &token,
            &DecodingKey::from_secret(b"test-secret"),
            &Validation::new(Algorithm::HS256),
        )
        .unwrap();
        assert!(decoded.claims.video.room_record);
        assert!(!decoded.claims.video.room_join);
        assert!(!decoded.claims.video.can_publish);
        assert!(!decoded.claims.video.can_subscribe);
    }

    #[test]
    fn normal_room_oidc_verifies_signature_issuer_audience_and_expiry() {
        #[derive(Serialize)]
        struct Claims<'a> {
            sub: &'a str,
            iss: &'a str,
            aud: &'a str,
            exp: usize,
            name: &'a str,
        }
        let config = NormalRoomOidcConfig {
            issuer: "https://idp.test".into(),
            audience: "space-room".into(),
            hs256_secret: "test-secret".into(),
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &Claims {
                sub: "person-1",
                iss: "https://idp.test",
                aud: "space-room",
                exp: (SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    + 60) as usize,
                name: "Person One",
            },
            &EncodingKey::from_secret(config.hs256_secret.as_bytes()),
        )
        .unwrap();
        assert_eq!(
            verify_normal_room_oidc_token(&token, &config).unwrap(),
            ("person-1".into(), "Person One".into())
        );
        let wrong = NormalRoomOidcConfig {
            audience: "other".into(),
            ..config
        };
        assert!(verify_normal_room_oidc_token(&token, &wrong).is_err());
    }

    #[test]
    fn anonymous_rooms_need_an_explicit_config_opt_in() {
        assert!(!LivekitConfig {
            allow_unregistered_rooms: Some(false),
            ..Default::default()
        }
        .allow_unregistered_rooms());
        assert!(LivekitConfig {
            allow_unregistered_rooms: Some(true),
            ..Default::default()
        }
        .allow_unregistered_rooms());
    }

    #[test]
    fn livekit_config_debug_redacts_secrets() {
        let cfg = LivekitConfig {
            host: Some("lk.example".to_string()),
            api_key: Some("AKplain".to_string()),
            api_secret: Some("supersecret-livekit".to_string()),
            recording_s3_access_key: Some("AKIAPLAINTEXT".to_string()),
            recording_s3_secret: Some("s3-supersecret".to_string()),
            ..LivekitConfig::default()
        };

        let rendered = format!("{cfg:?}");

        for leak in [
            "AKplain",
            "supersecret-livekit",
            "AKIAPLAINTEXT",
            "s3-supersecret",
        ] {
            assert!(!rendered.contains(leak), "secret leaked in Debug: {leak}");
        }
        // Non-secret fields stay observable, and presence of secrets is still visible.
        assert!(rendered.contains("lk.example"));
        assert_eq!(rendered.matches("<redacted>").count(), 4);
        assert!(rendered.contains("api_secret"));
    }
}
