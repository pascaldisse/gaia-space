#![allow(dead_code)]
//! Meetings/calendar records; recurrence stays in interoperable RRULE form.
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingParticipant {
    pub meeting_id: String,
    pub profile_id: String,
    pub status: String,
}
#[tauri::command]
pub fn list_meetings(app: AppHandle) -> Result<Vec<Meeting>> {
    let c = db::connection(&app)?;
    let mut s=c.prepare("SELECT id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,archived FROM meetings ORDER BY starts_at").map_err(|e|e.to_string())?;
    let rows = s
        .query_map([], |r| {
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
                archived: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
#[tauri::command]
pub fn get_meeting(app: AppHandle, id: String) -> Result<Option<Meeting>> {
    Ok(list_meetings(app)?.into_iter().find(|v| v.id == id))
}
#[tauri::command]
pub fn create_meeting(app: AppHandle, meeting: Meeting) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("INSERT INTO meetings(id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,archived)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![meeting.id,meeting.title,meeting.description,meeting.starts_at,meeting.ends_at,meeting.rrule,meeting.location,meeting.organizer_id,meeting.channel_id,meeting.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn update_meeting(app: AppHandle, meeting: Meeting) -> Result<()> {
    let c = db::connection(&app)?;
    c.execute("UPDATE meetings SET title=?2,description=?3,starts_at=?4,ends_at=?5,rrule=?6,location=?7,organizer_id=?8,channel_id=?9,archived=?10 WHERE id=?1",rusqlite::params![meeting.id,meeting.title,meeting.description,meeting.starts_at,meeting.ends_at,meeting.rrule,meeting.location,meeting.organizer_id,meeting.channel_id,meeting.archived]).map_err(|e|e.to_string())?;
    Ok(())
}
// TODO: occurrence expansion, conflict detection, RSVP transitions and recurring edit scopes.
