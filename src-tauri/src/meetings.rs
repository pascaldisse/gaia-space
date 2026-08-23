//! Meetings, RSVP state, and UTC RRULE occurrence expansion.
use crate::db;
use chrono::{DateTime, Duration, Months, TimeZone, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;
const RSVP_STATUSES: [&str; 3] = ["invited", "accepted", "declined"];
const VIDEO_STATUSES: [&str; 4] = ["scheduled", "live", "ended", "cancelled"];
const VIDEO_PROVIDERS: [&str; 2] = ["native", "meet"];
fn default_video_provider() -> String { "native".into() }
fn default_video_status() -> String { "scheduled".into() }
fn default_access_level() -> String { "PRIVATE".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub starts_at: i64,
    pub ends_at: i64,
    pub rrule: Option<String>,
    pub location: Option<String>,
    pub organizer_id: Option<String>,
    pub channel_id: Option<String>,
    #[serde(default = "default_video_provider")]
    pub video_provider: String,
    #[serde(default = "default_video_status")]
    pub video_status: String,
    #[serde(default = "default_access_level")]
    pub access_level: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingParticipant {
    pub meeting_id: String,
    pub profile_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingOccurrence {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub location: Option<String>,
}

fn row_to_meeting(r: &rusqlite::Row<'_>) -> rusqlite::Result<Meeting> {
    Ok(Meeting {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        starts_at: r.get(3)?,
        ends_at: r.get(4)?,
        rrule: r.get(5)?,
        location: r.get(6)?,
        organizer_id: r.get(7)?,
        channel_id: r.get(8)?,
        video_provider: r.get(9)?,
        video_status: r.get(10)?,
        access_level: r.get(11)?,
        archived: r.get(12)?,
    })
}

/// A room becomes live only after an authorized native join reaches a usable server.
/// Ended and cancelled rooms are terminal; reopening requires an explicit meeting edit.
pub fn video_status_after_join(status: &str) -> Result<&'static str> {
    match status {
        "scheduled" | "live" => Ok("live"),
        "ended" | "cancelled" => Err(format!("Cannot join a {status} video room")),
        _ => Err("Video status must be scheduled, live, ended, or cancelled".into()),
    }
}

fn validate_meeting(meeting: &Meeting) -> Result<()> {
    if meeting.title.trim().is_empty() {
        return Err("Meeting title is required".into());
    }
    if meeting.ends_at <= meeting.starts_at {
        return Err("Meeting end must be after its start".into());
    }
    if let Some(rule) = &meeting.rrule {
        parse_rule(rule)?;
    }
    if !VIDEO_PROVIDERS.contains(&meeting.video_provider.as_str()) {
        return Err("Video provider must be native or meet".into());
    }
    if !VIDEO_STATUSES.contains(&meeting.video_status.as_str()) {
        return Err("Video status must be scheduled, live, ended, or cancelled".into());
    }
    if !["PRIVATE", "PUBLIC"].contains(&meeting.access_level.as_str()) {
        return Err("Meeting access level must be PRIVATE or PUBLIC".into());
    }
    Ok(())
}

const MEETING_COLUMNS: &str = "m.id,m.title,m.description,m.starts_at,m.ends_at,m.rrule,m.location,m.organizer_id,m.channel_id,m.video_provider,m.video_status,m.access_level,m.archived";
/// Meeting read scope: organizer, explicitly invited participant, or a member of
/// the project attached through the meeting's channel.
const MEETING_READ_SCOPE: &str = "(m.organizer_id=?1 OR EXISTS(SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.profile_id=?1) OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1))))";
/// Every meeting read is this one SELECT. `extra` may only *narrow* it, and the
/// scope predicate always binds `?1` to the acting profile, so no caller can
/// assemble a parallel reader that forgets it.
fn visible_meetings_sql(extra: &str) -> String {
    format!("SELECT {MEETING_COLUMNS} FROM meetings m WHERE {MEETING_READ_SCOPE} {extra} ORDER BY m.starts_at")
}

const MEETING_WRITE_SCOPE: &str = "(m.organizer_id=?1 OR ?2=1 OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND p.created_by=?1))";

pub fn meeting_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM meetings m WHERE m.id=?2 AND {MEETING_READ_SCOPE})"),
        rusqlite::params![profile_id, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn meeting_writable_by(id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    let c = db::conn()?;
    c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM meetings m WHERE m.id=?3 AND {MEETING_WRITE_SCOPE})"),
        rusqlite::params![profile_id, is_admin, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn list_meetings_scoped(profile_id: String) -> Result<Vec<Meeting>> {
    let c = db::conn()?;
    visible_meetings_on(&c, &profile_id)
}

/// The single source of truth for meeting read visibility on an explicit
/// connection: `MEETING_READ_SCOPE`, nothing parallel to it. Every caller that
/// needs "which meetings may this profile see" — list, calendar aggregate,
/// occurrence expansion — goes through here, so the predicates cannot drift.
pub fn visible_meetings_on(c: &rusqlite::Connection, profile_id: &str) -> Result<Vec<Meeting>> {
    let mut s = c
        .prepare(&visible_meetings_sql(""))
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([profile_id], row_to_meeting)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Server-side application transport already authorizes a project before reading.
/// Keep this connection-bound reader private to that transport instead of inventing a
/// fake profile or accidentally using the human visibility predicate.
pub fn get_meeting_unscoped(c: &rusqlite::Connection, id: &str) -> Result<Option<Meeting>> {
    c.query_row(
        &format!("SELECT {MEETING_COLUMNS} FROM meetings m WHERE m.id=?1 AND m.archived=0"),
        [id],
        row_to_meeting,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Application room lists begin from every non-archived room; the HTTP boundary then
/// filters each row through its channel's project grant. Rooms with no project channel
/// intentionally cannot become application-visible.
pub fn list_meetings_scoped_for_application(c: &rusqlite::Connection) -> Result<Vec<Meeting>> {
    let mut statement = c
        .prepare(&format!(
            "SELECT {MEETING_COLUMNS} FROM meetings m WHERE m.archived=0 ORDER BY m.starts_at"
        ))
        .map_err(|e| e.to_string())?;
    let rooms = statement
        .query_map([], row_to_meeting)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rooms)
}

pub fn get_meeting_scoped(id: String, profile_id: String) -> Result<Option<Meeting>> {
    let c = db::conn()?;
    c.query_row(
        &visible_meetings_sql("AND m.id=?2"),
        rusqlite::params![profile_id, id],
        row_to_meeting,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Anonymous admission may only resolve an explicitly public, unarchived meeting.
/// This is intentionally separate from profile-scoped reads.
pub fn get_public_meeting(id: String) -> Result<Option<Meeting>> {
    let c = db::conn()?;
    c.query_row(
        &format!("SELECT {MEETING_COLUMNS} FROM meetings m WHERE m.id=?1 AND m.access_level='PUBLIC' AND m.archived=0"),
        [id],
        row_to_meeting,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Desktop transport. It carries the acting profile like every other reader:
/// there is no unscoped meeting list left to call, on either transport.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_meetings(profile_id: String) -> Result<Vec<Meeting>> {
    list_meetings_scoped(profile_id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn get_meeting(id: String, profile_id: String) -> Result<Option<Meeting>> {
    get_meeting_scoped(id, profile_id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_meeting(meeting: Meeting) -> Result<()> {
    validate_meeting(&meeting)?;
    let c = db::conn()?;
    c.execute("INSERT INTO meetings(id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,video_provider,video_status,access_level,archived) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", rusqlite::params![meeting.id, meeting.title, meeting.description, meeting.starts_at, meeting.ends_at, meeting.rrule, meeting.location, meeting.organizer_id, meeting.channel_id, meeting.video_provider, meeting.video_status, meeting.access_level, meeting.archived]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_meeting(meeting: Meeting) -> Result<()> {
    validate_meeting(&meeting)?;
    let c = db::conn()?;
    let changed = c.execute("UPDATE meetings SET title=?2,description=?3,starts_at=?4,ends_at=?5,rrule=?6,location=?7,organizer_id=?8,channel_id=?9,video_provider=?10,video_status=?11,access_level=?12,archived=?13 WHERE id=?1", rusqlite::params![meeting.id, meeting.title, meeting.description, meeting.starts_at, meeting.ends_at, meeting.rrule, meeting.location, meeting.organizer_id, meeting.channel_id, meeting.video_provider, meeting.video_status, meeting.access_level, meeting.archived]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Meeting not found".into());
    }
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn archive_meeting(id: String, archived: bool) -> Result<()> {
    let c = db::conn()?;
    if c.execute(
        "UPDATE meetings SET archived=?2 WHERE id=?1",
        rusqlite::params![id, archived],
    )
    .map_err(|e| e.to_string())?
        == 0
    {
        return Err("Meeting not found".into());
    }
    Ok(())
}

pub fn delete_meeting(id: String) -> Result<()> {
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM meeting_participants WHERE meeting_id=?1",
        [&id],
    )
    .map_err(|e| e.to_string())?;
    if tx
        .execute("DELETE FROM meetings WHERE id=?1", [&id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("Meeting not found".into());
    }
    tx.commit().map_err(|e| e.to_string())
}

fn row_to_participant(r: &rusqlite::Row<'_>) -> rusqlite::Result<MeetingParticipant> {
    Ok(MeetingParticipant {
        meeting_id: r.get(0)?,
        profile_id: r.get(1)?,
        status: r.get(2)?,
    })
}

pub fn list_meeting_participants_scoped(
    meeting_id: String,
    profile_id: String,
) -> Result<Vec<MeetingParticipant>> {
    let c = db::conn()?;
    let mut s = c.prepare(&format!("SELECT mp.meeting_id,mp.profile_id,mp.status FROM meeting_participants mp JOIN meetings m ON m.id=mp.meeting_id WHERE {MEETING_READ_SCOPE} AND mp.meeting_id=?2 ORDER BY mp.profile_id")).map_err(|e| e.to_string())?;
    let rows = s
        .query_map(
            rusqlite::params![profile_id, meeting_id],
            row_to_participant,
        )
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_meeting_participants(
    meeting_id: String,
    profile_id: String,
) -> Result<Vec<MeetingParticipant>> {
    list_meeting_participants_scoped(meeting_id, profile_id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn invite_meeting_participant(meeting_id: String, profile_id: String) -> Result<()> {
    if profile_id.trim().is_empty() {
        return Err("Participant profile ID is required".into());
    }
    let c = db::conn()?;
    c.execute("INSERT INTO meeting_participants(meeting_id,profile_id,status) VALUES(?1,?2,'invited') ON CONFLICT(meeting_id,profile_id) DO UPDATE SET status='invited'", rusqlite::params![meeting_id, profile_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_meeting_participant_status(
    meeting_id: String,
    profile_id: String,
    status: String,
) -> Result<()> {
    if !RSVP_STATUSES.contains(&status.as_str()) {
        return Err("RSVP status must be invited, accepted, or declined".into());
    }
    let c = db::conn()?;
    if c.execute(
        "UPDATE meeting_participants SET status=?3 WHERE meeting_id=?1 AND profile_id=?2",
        rusqlite::params![meeting_id, profile_id, status],
    )
    .map_err(|e| e.to_string())?
        == 0
    {
        return Err("Meeting participant not found".into());
    }
    Ok(())
}

#[derive(Default)]
struct Rule {
    freq: String,
    interval: i64,
    count: Option<usize>,
    until: Option<i64>,
}

fn parse_rule(source: &str) -> Result<Rule> {
    let text = source
        .trim()
        .strip_prefix("RRULE:")
        .unwrap_or(source.trim());
    let mut rule = Rule {
        interval: 1,
        ..Default::default()
    };
    for part in text.split(';') {
        let (key, value) = part
            .split_once('=')
            .ok_or_else(|| format!("Invalid RRULE component: {part}"))?;
        match key.to_ascii_uppercase().as_str() {
            "FREQ" => rule.freq = value.to_ascii_uppercase(),
            "INTERVAL" => {
                rule.interval = value
                    .parse()
                    .map_err(|_| "RRULE INTERVAL must be a positive number".to_string())?
            }
            "COUNT" => {
                rule.count = Some(
                    value
                        .parse()
                        .map_err(|_| "RRULE COUNT must be a positive number".to_string())?,
                )
            }
            "UNTIL" => rule.until = Some(parse_until(value)?),
            "BYDAY" => { /* weekly series remains anchored to DTSTART in this MVP */ }
            unknown => return Err(format!("Unsupported RRULE component: {unknown}")),
        }
    }
    if !matches!(
        rule.freq.as_str(),
        "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
    ) {
        return Err("RRULE FREQ must be DAILY, WEEKLY, MONTHLY, or YEARLY".into());
    }
    if rule.interval < 1 || rule.count == Some(0) {
        return Err("RRULE interval and count must be positive".into());
    }
    Ok(rule)
}

fn parse_until(value: &str) -> Result<i64> {
    if let Ok(seconds) = value.parse::<i64>() {
        return Ok(seconds);
    }
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp())
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
                .map(|date| date.and_utc().timestamp())
        })
        .map_err(|_| "RRULE UNTIL must be unix seconds, RFC3339, or YYYYMMDDTHHMMSSZ".into())
}

fn next_start(start: DateTime<Utc>, rule: &Rule) -> Result<DateTime<Utc>> {
    match rule.freq.as_str() {
        "DAILY" => Ok(start + Duration::days(rule.interval)),
        "WEEKLY" => Ok(start + Duration::weeks(rule.interval)),
        "MONTHLY" => start
            .checked_add_months(Months::new(rule.interval as u32))
            .ok_or_else(|| "RRULE monthly date is out of range".into()),
        "YEARLY" => start
            .checked_add_months(Months::new((rule.interval * 12) as u32))
            .ok_or_else(|| "RRULE yearly date is out of range".into()),
        _ => Err("Invalid RRULE FREQ".into()),
    }
}

/// Occurrences of one meeting overlapping `[range_start, range_end)`. Visibility
/// is the caller's business: this only knows the RRULE and the range.
pub fn expand(
    meeting: &Meeting,
    range_start: i64,
    range_end: i64,
) -> Result<Vec<MeetingOccurrence>> {
    let duration = meeting.ends_at - meeting.starts_at;
    let rule = meeting.rrule.as_deref().map(parse_rule).transpose()?;
    let mut start = Utc
        .timestamp_opt(meeting.starts_at, 0)
        .single()
        .ok_or("Invalid meeting start")?;
    let mut index = 0usize;
    let mut result = Vec::new();
    loop {
        let seconds = start.timestamp();
        if rule
            .as_ref()
            .and_then(|r| r.until)
            .is_some_and(|until| seconds > until)
        {
            break;
        }
        if seconds >= range_end {
            break;
        }
        if seconds + duration > range_start {
            result.push(MeetingOccurrence {
                id: format!("{}:{seconds}", meeting.id),
                meeting_id: meeting.id.clone(),
                title: meeting.title.clone(),
                starts_at: seconds,
                ends_at: seconds + duration,
                location: meeting.location.clone(),
            });
        }
        index += 1;
        let Some(rule) = &rule else {
            break;
        };
        if rule.count.is_some_and(|count| index >= count) {
            break;
        }
        start = next_start(start, rule)?;
    }
    Ok(result)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn expand_meeting_occurrences_scoped(
    range_start: i64,
    range_end: i64,
    profile_id: String,
) -> Result<Vec<MeetingOccurrence>> {
    if range_end <= range_start {
        return Err("Calendar range end must be after its start".into());
    }
    let mut all = Vec::new();
    for meeting in list_meetings_scoped(profile_id)?
        .into_iter()
        .filter(|meeting| !meeting.archived)
    {
        all.extend(expand(&meeting, range_start, range_end)?);
    }
    all.sort_by_key(|occurrence| occurrence.starts_at);
    Ok(all)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn expand_meeting_occurrences(
    range_start: i64,
    range_end: i64,
    profile_id: String,
) -> Result<Vec<MeetingOccurrence>> {
    expand_meeting_occurrences_scoped(range_start, range_end, profile_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn meeting(starts_at: i64, rrule: Option<&str>) -> Meeting {
        Meeting {
            id: "m-1".into(),
            title: "Planning".into(),
            description: None,
            starts_at,
            ends_at: starts_at + 3600,
            rrule: rrule.map(str::to_owned),
            location: None,
            organizer_id: Some("default-org".into()),
            channel_id: None,
            video_provider: "native".into(),
            video_status: "scheduled".into(),
            access_level: "PRIVATE".into(),
            archived: false,
        }
    }
    #[test]
    fn expands_daily_over_month_boundary() {
        let start = Utc
            .with_ymd_and_hms(2026, 1, 31, 23, 0, 0)
            .unwrap()
            .timestamp();
        let occurrences = expand(
            &meeting(start, Some("FREQ=DAILY;COUNT=3")),
            start,
            start + 4 * 86_400,
        )
        .unwrap();
        assert_eq!(
            occurrences.iter().map(|v| v.starts_at).collect::<Vec<_>>(),
            vec![start, start + 86_400, start + 172_800]
        );
    }
    fn scope_conn() -> rusqlite::Connection {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "gaia-space-meetings-scope-{}-{}.sqlite",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_file(&path);
        crate::db::migrate_path(&path).expect("migration")
    }

    /// The leak this closes: `list_meetings`/`get_meeting`/`expand_meeting_occurrences`
    /// used to read the table with no scope predicate at all, so the desktop
    /// transport (and `calls::join_meeting_call` through it) handed any caller
    /// every meeting in the database. Every reader now goes through
    /// `visible_meetings_sql`, so a stranger sees nothing.
    #[test]
    fn no_meeting_reader_escapes_the_read_scope() {
        let c = scope_conn();
        for id in ["p-owner", "p-guest", "p-stranger"] {
            c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,unixepoch())", [id]).unwrap();
        }
        c.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,archived) VALUES('m-private','Private planning',1000,4600,'p-owner',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,archived) VALUES('m-shared','Shared review',2000,5600,'p-owner',0)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO meeting_participants(meeting_id,profile_id,status) VALUES('m-shared','p-guest','accepted')", []).unwrap();

        let owner: Vec<String> = visible_meetings_on(&c, "p-owner")
            .unwrap()
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(
            owner,
            vec!["m-private", "m-shared"],
            "the organizer sees both"
        );

        let guest: Vec<String> = visible_meetings_on(&c, "p-guest")
            .unwrap()
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(
            guest,
            vec!["m-shared"],
            "an invited guest sees only their meeting"
        );

        assert!(
            visible_meetings_on(&c, "p-stranger").unwrap().is_empty(),
            "a stranger sees no meeting through any reader"
        );

        // The single-row reader is the same SELECT, only narrowed.
        let one = c
            .query_row(
                &visible_meetings_sql("AND m.id=?2"),
                rusqlite::params!["p-stranger", "m-private"],
                row_to_meeting,
            )
            .optional()
            .unwrap();
        assert!(
            one.is_none(),
            "get_meeting cannot reach outside the scope either"
        );
    }

    #[test]
    fn validates_only_the_documented_video_lifecycle_states() {
        for status in VIDEO_STATUSES {
            let mut value = meeting(1_000, None);
            value.video_status = status.into();
            assert!(validate_meeting(&value).is_ok(), "{status} must be accepted");
        }
        let mut invalid = meeting(1_000, None);
        invalid.video_status = "paused".into();
        assert_eq!(
            validate_meeting(&invalid).unwrap_err(),
            "Video status must be scheduled, live, ended, or cancelled"
        );
    }

    #[test]
    fn joining_promotes_scheduled_rooms_and_rejects_terminal_lifecycle_states() {
        assert_eq!(video_status_after_join("scheduled").unwrap(), "live");
        assert_eq!(video_status_after_join("live").unwrap(), "live");
        assert_eq!(video_status_after_join("ended").unwrap_err(), "Cannot join a ended video room");
        assert_eq!(video_status_after_join("cancelled").unwrap_err(), "Cannot join a cancelled video room");
    }

    #[test]
    fn validates_only_supported_video_providers() {
        for provider in VIDEO_PROVIDERS {
            let mut value = meeting(1_000, None);
            value.video_provider = provider.into();
            assert!(validate_meeting(&value).is_ok(), "{provider} must be accepted");
        }
        let mut invalid = meeting(1_000, None);
        invalid.video_provider = "zoom".into();
        assert_eq!(validate_meeting(&invalid).unwrap_err(), "Video provider must be native or meet");
    }

    #[test]
    fn participant_status_transitions_from_invited_to_accepted() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE meeting_participants(meeting_id TEXT, profile_id TEXT, status TEXT, PRIMARY KEY(meeting_id,profile_id)); INSERT INTO meeting_participants VALUES('m-1','p-1','invited');").unwrap();
        conn.execute(
            "UPDATE meeting_participants SET status=?3 WHERE meeting_id=?1 AND profile_id=?2",
            rusqlite::params!["m-1", "p-1", "accepted"],
        )
        .unwrap();
        let status: String = conn.query_row("SELECT status FROM meeting_participants WHERE meeting_id='m-1' AND profile_id='p-1'", [], |row| row.get(0)).unwrap();
        assert_eq!(status, "accepted");
        assert!(RSVP_STATUSES.contains(&status.as_str()));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingRoom {
    pub id: String,
    pub name: String,
    pub location: Option<String>,
    pub capacity: i64,
    pub archived: bool,
    #[serde(default)]
    pub equipment: Vec<String>,
}

fn validate_room(room: &MeetingRoom) -> Result<()> {
    if room.id.trim().is_empty() || room.name.trim().is_empty() {
        return Err("Room ID and name are required".into());
    }
    if room.capacity < 1 {
        return Err("Room capacity must be positive".into());
    }
    if room.equipment.iter().any(|item| item.trim().is_empty()) {
        return Err("Equipment names must not be empty".into());
    }
    Ok(())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_meeting_rooms() -> Result<Vec<MeetingRoom>> {
    let c = db::conn()?;
    let mut statement = c.prepare("SELECT id,name,location,capacity,archived FROM meeting_rooms WHERE archived=0 ORDER BY name").map_err(|e| e.to_string())?;
    let mut rooms: Vec<MeetingRoom> = statement
        .query_map([], |row| {
            Ok(MeetingRoom {
                id: row.get(0)?,
                name: row.get(1)?,
                location: row.get(2)?,
                capacity: row.get(3)?,
                archived: row.get(4)?,
                equipment: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(statement);
    for room in &mut rooms {
        room.equipment = c
            .prepare(
                "SELECT equipment FROM meeting_room_equipment WHERE room_id=?1 ORDER BY equipment",
            )
            .map_err(|e| e.to_string())?
            .query_map([&room.id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| e.to_string())?;
    }
    Ok(rooms)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_meeting_room(room: MeetingRoom) -> Result<()> {
    validate_room(&room)?;
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO meeting_rooms(id,name,location,capacity,archived) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,location=excluded.location,capacity=excluded.capacity,archived=excluded.archived", rusqlite::params![room.id,room.name,room.location,room.capacity,room.archived]).map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM meeting_room_equipment WHERE room_id=?1",
        [&room.id],
    )
    .map_err(|e| e.to_string())?;
    for equipment in room.equipment {
        tx.execute(
            "INSERT INTO meeting_room_equipment(room_id,equipment) VALUES(?1,?2)",
            rusqlite::params![room.id, equipment.trim()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn reserve_meeting_room(meeting_id: String, room_id: String) -> Result<()> {
    let mut c = db::conn()?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let (starts, ends): (i64, i64) = tx
        .query_row(
            "SELECT starts_at,ends_at FROM meetings WHERE id=?1 AND archived=0",
            [&meeting_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Meeting not found or archived".to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM meeting_rooms WHERE id=?1 AND archived=0)",
            [&room_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Room not found or archived".into());
    }
    let conflict: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM meeting_room_bookings b JOIN meetings m ON m.id=b.meeting_id WHERE b.room_id=?1 AND b.meeting_id<>?2 AND m.archived=0 AND m.starts_at<?4 AND m.ends_at>?3)", rusqlite::params![room_id,meeting_id,starts,ends], |row| row.get(0)).map_err(|e| e.to_string())?;
    if conflict {
        return Err("Room is already booked for this time".into());
    }
    tx.execute("INSERT INTO meeting_room_bookings(meeting_id,room_id) VALUES(?1,?2) ON CONFLICT(meeting_id) DO UPDATE SET room_id=excluded.room_id", rusqlite::params![meeting_id,room_id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
