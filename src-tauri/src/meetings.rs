//! Meetings, RSVP state, and UTC RRULE occurrence expansion.
use crate::db;
use chrono::{DateTime, Duration, Months, TimeZone, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

type Result<T> = std::result::Result<T, String>;
const RSVP_STATUSES: [&str; 3] = ["invited", "accepted", "declined"];

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
        id: r.get(0)?, title: r.get(1)?, description: r.get(2)?, starts_at: r.get(3)?,
        ends_at: r.get(4)?, rrule: r.get(5)?, location: r.get(6)?, organizer_id: r.get(7)?,
        channel_id: r.get(8)?, archived: r.get(9)?,
    })
}

fn validate_meeting(meeting: &Meeting) -> Result<()> {
    if meeting.title.trim().is_empty() { return Err("Meeting title is required".into()); }
    if meeting.ends_at <= meeting.starts_at { return Err("Meeting end must be after its start".into()); }
    if let Some(rule) = &meeting.rrule { parse_rule(rule)?; }
    Ok(())
}

#[tauri::command]
pub fn list_meetings(app: AppHandle) -> Result<Vec<Meeting>> {
    let c = db::connection(&app)?;
    let mut s = c.prepare("SELECT id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,archived FROM meetings ORDER BY starts_at").map_err(|e| e.to_string())?;
    let meetings = s.query_map([], row_to_meeting).map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?;
    Ok(meetings)
}

#[tauri::command]
pub fn get_meeting(app: AppHandle, id: String) -> Result<Option<Meeting>> {
    let c = db::connection(&app)?;
    c.query_row("SELECT id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,archived FROM meetings WHERE id=?1", [&id], row_to_meeting)
        .optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_meeting(app: AppHandle, meeting: Meeting) -> Result<()> {
    validate_meeting(&meeting)?;
    let c = db::connection(&app)?;
    c.execute("INSERT INTO meetings(id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,archived) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", rusqlite::params![meeting.id, meeting.title, meeting.description, meeting.starts_at, meeting.ends_at, meeting.rrule, meeting.location, meeting.organizer_id, meeting.channel_id, meeting.archived]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_meeting(app: AppHandle, meeting: Meeting) -> Result<()> {
    validate_meeting(&meeting)?;
    let c = db::connection(&app)?;
    let changed = c.execute("UPDATE meetings SET title=?2,description=?3,starts_at=?4,ends_at=?5,rrule=?6,location=?7,organizer_id=?8,channel_id=?9,archived=?10 WHERE id=?1", rusqlite::params![meeting.id, meeting.title, meeting.description, meeting.starts_at, meeting.ends_at, meeting.rrule, meeting.location, meeting.organizer_id, meeting.channel_id, meeting.archived]).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("Meeting not found".into()); }
    Ok(())
}

#[tauri::command]
pub fn archive_meeting(app: AppHandle, id: String, archived: bool) -> Result<()> {
    let c = db::connection(&app)?;
    if c.execute("UPDATE meetings SET archived=?2 WHERE id=?1", rusqlite::params![id, archived]).map_err(|e| e.to_string())? == 0 { return Err("Meeting not found".into()); }
    Ok(())
}

#[tauri::command]
pub fn list_meeting_participants(app: AppHandle, meeting_id: String) -> Result<Vec<MeetingParticipant>> {
    let c = db::connection(&app)?;
    let mut s = c.prepare("SELECT meeting_id,profile_id,status FROM meeting_participants WHERE meeting_id=?1 ORDER BY profile_id").map_err(|e| e.to_string())?;
    let participants = s.query_map([meeting_id], |r| Ok(MeetingParticipant { meeting_id: r.get(0)?, profile_id: r.get(1)?, status: r.get(2)? }))
        .map_err(|e| e.to_string())?.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?;
    Ok(participants)
}

#[tauri::command]
pub fn invite_meeting_participant(app: AppHandle, meeting_id: String, profile_id: String) -> Result<()> {
    if profile_id.trim().is_empty() { return Err("Participant profile ID is required".into()); }
    let c = db::connection(&app)?;
    c.execute("INSERT INTO meeting_participants(meeting_id,profile_id,status) VALUES(?1,?2,'invited') ON CONFLICT(meeting_id,profile_id) DO UPDATE SET status='invited'", rusqlite::params![meeting_id, profile_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_meeting_participant_status(app: AppHandle, meeting_id: String, profile_id: String, status: String) -> Result<()> {
    if !RSVP_STATUSES.contains(&status.as_str()) { return Err("RSVP status must be invited, accepted, or declined".into()); }
    let c = db::connection(&app)?;
    if c.execute("UPDATE meeting_participants SET status=?3 WHERE meeting_id=?1 AND profile_id=?2", rusqlite::params![meeting_id, profile_id, status]).map_err(|e| e.to_string())? == 0 { return Err("Meeting participant not found".into()); }
    Ok(())
}

#[derive(Default)]
struct Rule { freq: String, interval: i64, count: Option<usize>, until: Option<i64> }

fn parse_rule(source: &str) -> Result<Rule> {
    let text = source.trim().strip_prefix("RRULE:").unwrap_or(source.trim());
    let mut rule = Rule { interval: 1, ..Default::default() };
    for part in text.split(';') {
        let (key, value) = part.split_once('=').ok_or_else(|| format!("Invalid RRULE component: {part}"))?;
        match key.to_ascii_uppercase().as_str() {
            "FREQ" => rule.freq = value.to_ascii_uppercase(),
            "INTERVAL" => rule.interval = value.parse().map_err(|_| "RRULE INTERVAL must be a positive number".to_string())?,
            "COUNT" => rule.count = Some(value.parse().map_err(|_| "RRULE COUNT must be a positive number".to_string())?),
            "UNTIL" => rule.until = Some(parse_until(value)?),
            "BYDAY" => { /* weekly series remains anchored to DTSTART in this MVP */ },
            unknown => return Err(format!("Unsupported RRULE component: {unknown}")),
        }
    }
    if !matches!(rule.freq.as_str(), "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY") { return Err("RRULE FREQ must be DAILY, WEEKLY, MONTHLY, or YEARLY".into()); }
    if rule.interval < 1 || rule.count == Some(0) { return Err("RRULE interval and count must be positive".into()); }
    Ok(rule)
}

fn parse_until(value: &str) -> Result<i64> {
    if let Ok(seconds) = value.parse::<i64>() { return Ok(seconds); }
    DateTime::parse_from_rfc3339(value).map(|date| date.timestamp()).or_else(|_| chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ").map(|date| date.and_utc().timestamp())).map_err(|_| "RRULE UNTIL must be unix seconds, RFC3339, or YYYYMMDDTHHMMSSZ".into())
}

fn next_start(start: DateTime<Utc>, rule: &Rule) -> Result<DateTime<Utc>> {
    match rule.freq.as_str() {
        "DAILY" => Ok(start + Duration::days(rule.interval)),
        "WEEKLY" => Ok(start + Duration::weeks(rule.interval)),
        "MONTHLY" => start.checked_add_months(Months::new(rule.interval as u32)).ok_or_else(|| "RRULE monthly date is out of range".into()),
        "YEARLY" => start.checked_add_months(Months::new((rule.interval * 12) as u32)).ok_or_else(|| "RRULE yearly date is out of range".into()),
        _ => Err("Invalid RRULE FREQ".into()),
    }
}

fn expand(meeting: &Meeting, range_start: i64, range_end: i64) -> Result<Vec<MeetingOccurrence>> {
    let duration = meeting.ends_at - meeting.starts_at;
    let rule = meeting.rrule.as_deref().map(parse_rule).transpose()?;
    let mut start = Utc.timestamp_opt(meeting.starts_at, 0).single().ok_or("Invalid meeting start")?;
    let mut index = 0usize;
    let mut result = Vec::new();
    loop {
        let seconds = start.timestamp();
        if rule.as_ref().and_then(|r| r.until).is_some_and(|until| seconds > until) { break; }
        if seconds >= range_end { break; }
        if seconds + duration > range_start { result.push(MeetingOccurrence { id: format!("{}:{seconds}", meeting.id), meeting_id: meeting.id.clone(), title: meeting.title.clone(), starts_at: seconds, ends_at: seconds + duration, location: meeting.location.clone() }); }
        index += 1;
        let Some(rule) = &rule else { break; };
        if rule.count.is_some_and(|count| index >= count) { break; }
        start = next_start(start, rule)?;
    }
    Ok(result)
}

#[tauri::command]
pub fn expand_meeting_occurrences(app: AppHandle, range_start: i64, range_end: i64) -> Result<Vec<MeetingOccurrence>> {
    if range_end <= range_start { return Err("Calendar range end must be after its start".into()); }
    let mut all = Vec::new();
    for meeting in list_meetings(app)?.into_iter().filter(|meeting| !meeting.archived) { all.extend(expand(&meeting, range_start, range_end)?); }
    all.sort_by_key(|occurrence| occurrence.starts_at);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn meeting(starts_at: i64, rrule: Option<&str>) -> Meeting { Meeting { id: "m-1".into(), title: "Planning".into(), description: None, starts_at, ends_at: starts_at + 3600, rrule: rrule.map(str::to_owned), location: None, organizer_id: Some("default-org".into()), channel_id: None, archived: false } }
    #[test]
    fn expands_daily_over_month_boundary() { let start = Utc.with_ymd_and_hms(2026, 1, 31, 23, 0, 0).unwrap().timestamp(); let occurrences = expand(&meeting(start, Some("FREQ=DAILY;COUNT=3")), start, start + 4 * 86_400).unwrap(); assert_eq!(occurrences.iter().map(|v| v.starts_at).collect::<Vec<_>>(), vec![start, start + 86_400, start + 172_800]); }
    #[test]
    fn participant_status_transitions_from_invited_to_accepted() { let conn = rusqlite::Connection::open_in_memory().unwrap(); conn.execute_batch("CREATE TABLE meeting_participants(meeting_id TEXT, profile_id TEXT, status TEXT, PRIMARY KEY(meeting_id,profile_id)); INSERT INTO meeting_participants VALUES('m-1','p-1','invited');").unwrap(); conn.execute("UPDATE meeting_participants SET status=?3 WHERE meeting_id=?1 AND profile_id=?2", rusqlite::params!["m-1", "p-1", "accepted"]).unwrap(); let status: String = conn.query_row("SELECT status FROM meeting_participants WHERE meeting_id='m-1' AND profile_id='p-1'", [], |row| row.get(0)).unwrap(); assert_eq!(status, "accepted"); assert!(RSVP_STATUSES.contains(&status.as_str())); }
}
