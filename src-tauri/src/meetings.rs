//! Meetings, RSVP state, and UTC RRULE occurrence expansion.
use crate::{chat, db, personal};
use chrono::{DateTime, Duration, Months, TimeZone, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;
const RSVP_STATUSES: [&str; 3] = ["invited", "accepted", "declined"];
/// Call lifecycle. `archived` is a shelf flag on the calendar entry; THIS is the state
/// of the conference itself, and the two are independent facts.
pub const VIDEO_STATUSES: [&str; 4] = ["scheduled", "live", "ended", "cancelled"];
/// Providers Gaia can actually mint a join for. An unknown provider is refused rather
/// than stored, so no row can promise a room nothing serves.
pub const VIDEO_PROVIDERS: [&str; 1] = ["livekit"];
const VISIBILITIES: [&str; 3] = ["public", "private", "participants"];
const MODIFICATION_PREFERENCES: [&str; 2] = ["organizer-only", "participants"];
fn default_visibility() -> String {
    "participants".into()
}
fn default_modification_preference() -> String {
    "organizer-only".into()
}

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
    #[serde(default = "default_visibility")]
    pub visibility: String,
    #[serde(default = "default_modification_preference")]
    pub modification_preference: String,
    pub archived: bool,
    #[serde(default)]
    pub video_provider: Option<String>,
    #[serde(default)]
    pub video_room_id: Option<String>,
    #[serde(default)]
    pub join_url: Option<String>,
    #[serde(default = "default_video_status")]
    pub video_status: String,
}
fn default_video_status() -> String {
    "scheduled".into()
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
        visibility: r.get(9)?,
        modification_preference: r.get(10)?,
        archived: r.get(11)?,
        video_provider: r.get(12)?,
        video_room_id: r.get(13)?,
        join_url: r.get(14)?,
        video_status: r.get(15)?,
    })
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
    if !VIDEO_STATUSES.contains(&meeting.video_status.as_str()) {
        return Err("Meeting video status must be scheduled, live, ended, or cancelled".into());
    }
    if let Some(provider) = &meeting.video_provider {
        if !VIDEO_PROVIDERS.contains(&provider.as_str()) {
            return Err("Unsupported meeting video provider".into());
        }
    }
    if !VISIBILITIES.contains(&meeting.visibility.as_str()) {
        return Err("Meeting visibility must be public, private, or participants".into());
    }
    if !MODIFICATION_PREFERENCES.contains(&meeting.modification_preference.as_str()) {
        return Err(
            "Meeting modification preference must be organizer-only or participants".into(),
        );
    }
    Ok(())
}

const MEETING_COLUMNS: &str = "m.id,m.title,m.description,m.starts_at,m.ends_at,m.rrule,m.location,m.organizer_id,m.channel_id,m.visibility,m.modification_preference,m.archived,m.video_provider,m.video_room_id,m.join_url,m.video_status";
/// Private meetings are organizer-only; participant meetings additionally expose
/// themselves to invited people and the legacy project-channel audience; public
/// meetings are visible to every authenticated profile.
const MEETING_READ_SCOPE: &str = "(m.visibility='public' OR m.organizer_id=?1 OR (m.visibility='participants' AND EXISTS(SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.profile_id=?1)) OR (m.visibility='participants' AND EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND (p.created_by=?1 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.profile_id=?1)))))";
/// Every meeting read is this one SELECT. `extra` may only *narrow* it, and the
/// scope predicate always binds `?1` to the acting profile, so no caller can
/// assemble a parallel reader that forgets it.
fn visible_meetings_sql(extra: &str) -> String {
    format!("SELECT {MEETING_COLUMNS} FROM meetings m WHERE {MEETING_READ_SCOPE} {extra} ORDER BY m.starts_at")
}

const MEETING_WRITE_SCOPE: &str = "(m.organizer_id=?1 OR ?2=1 OR EXISTS(SELECT 1 FROM channels ch JOIN projects p ON p.id=ch.project_id WHERE ch.id=m.channel_id AND p.created_by=?1) OR (m.modification_preference='participants' AND EXISTS(SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id=m.id AND mp.profile_id=?1)))";

pub fn meeting_readable_on(c: &rusqlite::Connection, id: &str, profile_id: &str) -> Result<bool> {
    c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM meetings m WHERE m.id=?2 AND {MEETING_READ_SCOPE})"),
        rusqlite::params![profile_id, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}
pub fn meeting_readable_by(id: &str, profile_id: &str) -> Result<bool> {
    meeting_readable_on(&db::conn()?, id, profile_id)
}

pub fn meeting_writable_on(
    c: &rusqlite::Connection,
    id: &str,
    profile_id: &str,
    is_admin: bool,
) -> Result<bool> {
    c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM meetings m WHERE m.id=?3 AND {MEETING_WRITE_SCOPE})"),
        rusqlite::params![profile_id, is_admin, id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}
pub fn meeting_writable_by(id: &str, profile_id: &str, is_admin: bool) -> Result<bool> {
    meeting_writable_on(&db::conn()?, id, profile_id, is_admin)
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

fn notification_recipients_on(c: &rusqlite::Connection, meeting_id: &str) -> Result<Vec<String>> {
    c.prepare("SELECT profile_id FROM meeting_participants WHERE meeting_id=?1 ORDER BY profile_id")
        .map_err(|e| e.to_string())?
        .query_map([meeting_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
fn notify_meeting_change_on(c: &rusqlite::Connection, meeting: &Meeting, event_type: &str) {
    let Ok(recipients) = notification_recipients_on(c, &meeting.id) else {
        return;
    };
    if recipients.is_empty() {
        return;
    }
    if let Err(error) = personal::fan_out_notification_on(
        c,
        personal::NotificationFanout {
            recipients,
            event_type,
            title: &meeting.title,
            body: meeting.description.as_deref(),
            entity_type: "meeting",
            entity_id: &meeting.id,
            // Subscription kinds are domain entities; the linked channel is navigation only.
            target_type: Some("entity"),
            target_id: Some(&meeting.id),
        },
    ) {
        eprintln!("meeting notification fan-out for {event_type} failed: {error}");
    }
}
fn attach_meeting_channel_on(c: &rusqlite::Connection, id: &str) -> Result<String> {
    let title: String = c
        .query_row("SELECT title FROM meetings WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let channel =
        chat::create_entity_channel_impl(c, "meeting", id, Some(format!("{title} discussion")))?;
    c.execute(
        "UPDATE meetings SET channel_id=?2 WHERE id=?1",
        rusqlite::params![id, channel.id],
    )
    .map_err(|e| e.to_string())?;
    Ok(channel.id)
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_meeting(mut meeting: Meeting) -> Result<()> {
    validate_meeting(&meeting)?;
    let c = db::conn()?;
    c.execute("INSERT INTO meetings(id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,visibility,modification_preference,archived,video_provider,video_status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)", rusqlite::params![meeting.id, meeting.title, meeting.description, meeting.starts_at, meeting.ends_at, meeting.rrule, meeting.location, meeting.organizer_id, meeting.channel_id, meeting.visibility, meeting.modification_preference, meeting.archived, meeting.video_provider, meeting.video_status]).map_err(|e| e.to_string())?;
    if meeting.channel_id.is_none() {
        meeting.channel_id = Some(attach_meeting_channel_on(&c, &meeting.id)?);
    }
    notify_meeting_change_on(&c, &meeting, "meeting.created");
    Ok(())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_meeting(meeting: Meeting) -> Result<()> {
    validate_meeting(&meeting)?;
    let c = db::conn()?;
    let changed = c.execute("UPDATE meetings SET title=?2,description=?3,starts_at=?4,ends_at=?5,rrule=?6,location=?7,organizer_id=?8,channel_id=?9,visibility=?10,modification_preference=?11,archived=?12,video_provider=?13,video_status=?14 WHERE id=?1", rusqlite::params![meeting.id, meeting.title, meeting.description, meeting.starts_at, meeting.ends_at, meeting.rrule, meeting.location, meeting.organizer_id, meeting.channel_id, meeting.visibility, meeting.modification_preference, meeting.archived, meeting.video_provider, meeting.video_status]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Meeting not found".into());
    }
    notify_meeting_change_on(&c, &meeting, "meeting.updated");
    Ok(())
}
/// Idempotently attach the deterministic entity-bound discussion to legacy meetings.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn attach_meeting_channel(id: String) -> Result<String> {
    attach_meeting_channel_on(&db::conn()?, &id)
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

/// Native-only writer: the join path records the room it actually minted a token for,
/// and marks the call live. Idempotent — a second joiner writes the same address.
/// Returns the room id now bound to the meeting, which is the FIRST recorded one:
/// once a room exists, later joins reuse it instead of splitting the call in two.
pub fn record_call_room_on(
    c: &rusqlite::Connection,
    meeting_id: &str,
    provider: &str,
    room_id: &str,
    join_url: &str,
) -> Result<String> {
    if !VIDEO_PROVIDERS.contains(&provider) {
        return Err("Unsupported meeting video provider".into());
    }
    if room_id.trim().is_empty() || join_url.trim().is_empty() {
        return Err("Call room id and join URL are required".into());
    }
    let changed = c
        .execute(
            "UPDATE meetings SET video_provider=?2, video_room_id=COALESCE(video_room_id,?3), join_url=?4, video_status='live' WHERE id=?1",
            rusqlite::params![meeting_id, provider, room_id, join_url],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Meeting not found".into());
    }
    c.query_row(
        "SELECT video_room_id FROM meetings WHERE id=?1",
        rusqlite::params![meeting_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Meeting has no recorded call room".into())
}

/// Native-only writer for the end of a call. `ended` is only reachable from `live`,
/// so a stale leave cannot retro-end a meeting that never started or was cancelled.
pub fn end_call_on(c: &rusqlite::Connection, meeting_id: &str) -> Result<bool> {
    c.execute(
        "UPDATE meetings SET video_status='ended' WHERE id=?1 AND video_status='live'",
        rusqlite::params![meeting_id],
    )
    .map(|changed| changed > 0)
    .map_err(|e| e.to_string())
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
    let meeting = c
        .query_row(
            &format!("SELECT {MEETING_COLUMNS} FROM meetings m WHERE m.id=?1"),
            [&meeting_id],
            row_to_meeting,
        )
        .map_err(|e| e.to_string())?;
    if let Err(error) = personal::fan_out_notification_on(
        &c,
        personal::NotificationFanout {
            recipients: vec![profile_id],
            event_type: "meeting.invited",
            title: &meeting.title,
            body: meeting.description.as_deref(),
            entity_type: "meeting",
            entity_id: &meeting.id,
            // Subscription kinds are domain entities; the linked channel is navigation only.
            target_type: Some("entity"),
            target_id: Some(&meeting.id),
        },
    ) {
        eprintln!("meeting invitation notification failed: {error}");
    }
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
            visibility: default_visibility(),
            modification_preference: default_modification_preference(),
            archived: false,
            video_provider: None,
            video_room_id: None,
            join_url: None,
            video_status: default_video_status(),
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
    fn privacy_edit_policy_channel_and_notifications_share_the_meeting_scope() {
        let c = scope_conn();
        for id in ["owner", "guest", "stranger"] {
            c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?1,?1,unixepoch())", [id]).unwrap();
        }
        c.execute_batch("            INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,visibility,modification_preference,archived)
                VALUES('private','Private',1,2,'owner','private','organizer-only',0);
            INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,visibility,modification_preference,archived)
                VALUES('participants','Participants',3,4,'owner','participants','organizer-only',0);
            INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,visibility,modification_preference,archived)
                VALUES('public','Public',5,6,'owner','public','organizer-only',0);
            INSERT INTO meeting_participants(meeting_id,profile_id,status) VALUES('private','guest','invited');
            INSERT INTO meeting_participants(meeting_id,profile_id,status) VALUES('participants','guest','accepted');
        ").unwrap();
        assert!(
            !meeting_readable_on(&c, "private", "guest").unwrap(),
            "private ignores an invitation"
        );
        assert!(meeting_readable_on(&c, "participants", "guest").unwrap());
        assert!(meeting_readable_on(&c, "public", "stranger").unwrap());
        assert!(!meeting_writable_on(&c, "participants", "guest", false).unwrap());
        c.execute(
            "UPDATE meetings SET modification_preference='participants' WHERE id='participants'",
            [],
        )
        .unwrap();
        assert!(meeting_writable_on(&c, "participants", "guest", false).unwrap());
        let channel_id = attach_meeting_channel_on(&c, "participants").unwrap();
        assert_eq!(channel_id, "entity:meeting:participants");
        let meeting = c
            .query_row(
                &format!("SELECT {MEETING_COLUMNS} FROM meetings m WHERE m.id='participants'"),
                [],
                row_to_meeting,
            )
            .unwrap();
        notify_meeting_change_on(&c, &meeting, "meeting.updated");
        let routed: (String, String, String) = c
            .query_row(
                "SELECT recipient_id,event_type,entity_id FROM notifications",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            routed,
            (
                "guest".into(),
                "meeting.updated".into(),
                "participants".into()
            )
        );
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

    /// The call room is a persisted fact, not a per-join invention: the SECOND joiner
    /// must land in the room the first one created, even if the caller proposes a
    /// different one. Without the COALESCE this test splits the call in two.
    #[test]
    fn the_second_joiner_is_bound_to_the_first_recorded_room() {
        let c = crate::db::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-owner','p-owner','p-owner',unixepoch())", []).unwrap();
        c.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,archived) VALUES('m-1','Call',1000,4600,'p-owner',0)",
            [],
        )
        .unwrap();

        let first = record_call_room_on(&c, "m-1", "livekit", "meeting-m-1", "ws://127.0.0.1:7880")
            .unwrap();
        let second =
            record_call_room_on(&c, "m-1", "livekit", "attacker-room", "ws://127.0.0.1:7880")
                .unwrap();
        assert_eq!(first, "meeting-m-1");
        assert_eq!(
            second, "meeting-m-1",
            "a later join reuses the bound room instead of opening a second one"
        );

        let (provider, room, url, status): (Option<String>, Option<String>, Option<String>, String) =
            c.query_row(
                "SELECT video_provider,video_room_id,join_url,video_status FROM meetings WHERE id='m-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(provider.as_deref(), Some("livekit"));
        assert_eq!(room.as_deref(), Some("meeting-m-1"));
        assert_eq!(url.as_deref(), Some("ws://127.0.0.1:7880"));
        assert_eq!(status, "live", "joining makes the call live");
    }

    /// `ended` is reachable only from `live`. A leave arriving for a meeting that was
    /// cancelled (or never started) must not rewrite that decision.
    #[test]
    fn ending_a_call_only_moves_a_live_meeting() {
        let c = crate::db::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-owner','p-owner','p-owner',unixepoch())", []).unwrap();
        c.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,archived,video_status) VALUES('m-c','Call',1,2,'p-owner',0,'cancelled')",
            [],
        )
        .unwrap();
        assert!(
            !end_call_on(&c, "m-c").unwrap(),
            "a cancelled meeting is not ended by a stale leave"
        );
        let status: String = c
            .query_row(
                "SELECT video_status FROM meetings WHERE id='m-c'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "cancelled");

        record_call_room_on(&c, "m-c", "livekit", "meeting-m-c", "ws://127.0.0.1:7880").unwrap();
        assert!(end_call_on(&c, "m-c").unwrap());
        let status: String = c
            .query_row(
                "SELECT video_status FROM meetings WHERE id='m-c'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "ended");
        assert!(VIDEO_STATUSES.contains(&status.as_str()));
    }

    /// An unknown provider is refused at both doors — the model writer and the
    /// native join writer — so no row can name media nothing serves.
    #[test]
    fn an_unsupported_video_provider_is_refused() {
        let c = crate::db::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('p-owner','p-owner','p-owner',unixepoch())", []).unwrap();
        c.execute(
            "INSERT INTO meetings(id,title,starts_at,ends_at,organizer_id,archived) VALUES('m-p','Call',1,2,'p-owner',0)",
            [],
        )
        .unwrap();
        assert!(record_call_room_on(&c, "m-p", "zoom", "r", "ws://x").is_err());

        let mut m = meeting(1000, None);
        m.video_provider = Some("zoom".into());
        assert!(validate_meeting(&m).is_err());
        m.video_provider = Some("livekit".into());
        assert!(validate_meeting(&m).is_ok());
        m.video_status = "whenever".into();
        assert!(validate_meeting(&m).is_err());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailabilityConflict {
    pub kind: String,
    pub profile_id: Option<String>,
    pub meeting_id: Option<String>,
    pub room_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableMeetingRoom {
    #[serde(flatten)]
    pub room: MeetingRoom,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingAvailability {
    pub rooms: Vec<AvailableMeetingRoom>,
    pub conflicts: Vec<AvailabilityConflict>,
    pub suggestions: Vec<MeetingRoom>,
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

/// Checks derived room, attendee-meeting, and approved-away-absence conflicts.
/// The half-open overlap test makes back-to-back meetings available.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn meeting_availability(
    starts_at: i64,
    ends_at: i64,
    profile_ids: Vec<String>,
    meeting_id: Option<String>,
) -> Result<MeetingAvailability> {
    if ends_at <= starts_at {
        return Err("Meeting end must be after its start".into());
    }
    let c = db::conn()?;
    let rooms = list_meeting_rooms()?;
    let mut conflicts = Vec::new();
    let mut available_rooms = Vec::with_capacity(rooms.len());
    for room in rooms {
        let conflict: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM meeting_room_bookings b JOIN meetings m ON m.id=b.meeting_id WHERE b.room_id=?1 AND (?2 IS NULL OR b.meeting_id<>?2) AND m.archived=0 AND m.starts_at<?4 AND m.ends_at>?3)",
            rusqlite::params![room.id, meeting_id, starts_at, ends_at],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if conflict {
            conflicts.push(AvailabilityConflict {
                kind: "room".into(),
                profile_id: None,
                meeting_id: None,
                room_id: Some(room.id.clone()),
                message: format!("{} is already booked for this time", room.name),
            });
        }
        available_rooms.push(AvailableMeetingRoom {
            room,
            available: !conflict,
        });
    }
    let start_date = Utc
        .timestamp_opt(starts_at, 0)
        .single()
        .ok_or("Invalid meeting start")?
        .date_naive()
        .to_string();
    let end_date = Utc
        .timestamp_opt(ends_at - 1, 0)
        .single()
        .ok_or("Invalid meeting end")?
        .date_naive()
        .to_string();
    for profile_id in profile_ids.into_iter().filter(|id| !id.trim().is_empty()) {
        let mut meetings = c.prepare("SELECT DISTINCT m.id,m.title FROM meetings m LEFT JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE m.archived=0 AND (?1 IS NULL OR m.id<>?1) AND (m.organizer_id=?2 OR mp.profile_id=?2) AND m.starts_at<?4 AND m.ends_at>?3 ORDER BY m.starts_at").map_err(|e| e.to_string())?;
        let rows = meetings
            .query_map(
                rusqlite::params![meeting_id, profile_id, starts_at, ends_at],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, title) = row.map_err(|e| e.to_string())?;
            conflicts.push(AvailabilityConflict {
                kind: "meeting".into(),
                profile_id: Some(profile_id.clone()),
                meeting_id: Some(id),
                room_id: None,
                message: format!("{profile_id} has an overlapping meeting: {title}"),
            });
        }
        let away: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM absences WHERE profile_id=?1 AND approved=1 AND availability<>'available' AND date_from<=?2 AND date_to>=?3)", rusqlite::params![profile_id, end_date, start_date], |row| row.get(0)).map_err(|e| e.to_string())?;
        if away {
            conflicts.push(AvailabilityConflict {
                kind: "absence".into(),
                profile_id: Some(profile_id.clone()),
                meeting_id: None,
                room_id: None,
                message: format!("{profile_id} has an approved absence"),
            });
        }
    }
    let suggestions = available_rooms
        .iter()
        .filter(|room| room.available)
        .map(|room| room.room.clone())
        .collect();
    Ok(MeetingAvailability {
        rooms: available_rooms,
        conflicts,
        suggestions,
    })
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
