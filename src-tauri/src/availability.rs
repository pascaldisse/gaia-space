//! Free/busy availability, meeting conflict detection and slot suggestion.
//!
//! Nothing here owns storage: busy time is derived from what already exists —
//! meeting occurrences (`meetings::expand`) and approved absences
//! (`personal::Absence`). The scheduling core is pure and takes busy blocks,
//! so it is testable without a database; only the thin readers touch SQLite.
use crate::db;
use crate::meetings::{self, Meeting};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;

/// Default slot alignment when a caller does not ask for one: quarter hour.
pub const DEFAULT_GRANULARITY_SECONDS: i64 = 900;
/// Upper bound on suggestions returned in one call.
pub const MAX_SUGGESTIONS: usize = 50;
/// Widest range a single availability query may span: 92 days.
pub const MAX_RANGE_SECONDS: i64 = 92 * 86_400;
const DAY_SECONDS: i64 = 86_400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusyBlock {
    pub profile_id: String,
    pub starts_at: i64,
    pub ends_at: i64,
    /// `"meeting"` or `"absence"`.
    pub kind: String,
    /// Meeting occurrence id or absence id — enough to link back in a UI.
    pub source_id: String,
    /// Absence-only: `away` or `partial`. Meetings leave this empty.
    #[serde(default)]
    pub availability: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Slot {
    pub starts_at: i64,
    pub ends_at: i64,
    /// Profiles free for the whole slot.
    pub free: Vec<String>,
    /// Profiles busy for part of it — a slot with these is a compromise.
    pub busy: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConflictReport {
    pub starts_at: i64,
    pub ends_at: i64,
    pub conflicts: Vec<BusyBlock>,
    /// Profiles with no overlapping busy block in the window.
    pub free: Vec<String>,
}

fn validate_range(range_start: i64, range_end: i64) -> Result<()> {
    if range_end <= range_start {
        return Err("Availability range end must be after its start".into());
    }
    if range_end - range_start > MAX_RANGE_SECONDS {
        return Err("Availability range is too wide".into());
    }
    Ok(())
}

/// Half-open overlap: `[a_start, a_end)` against `[b_start, b_end)`.
pub fn overlaps(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> bool {
    a_start < b_end && b_start < a_end
}

/// Inclusive `YYYY-MM-DD` day range to the UTC half-open second range that
/// covers it. `date_to` is inclusive in the schema, so its whole day counts.
pub fn absence_window(date_from: &str, date_to: &str) -> Result<(i64, i64)> {
    let parse = |value: &str| {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| format!("Invalid absence date: {value}"))
    };
    let from = parse(date_from)?;
    let to = parse(date_to)?;
    if to < from {
        return Err("Absence ends before it starts".into());
    }
    let start = from.and_hms_opt(0, 0, 0).ok_or("Invalid absence start")?;
    let end = to.and_hms_opt(0, 0, 0).ok_or("Invalid absence end")?;
    Ok((
        start.and_utc().timestamp(),
        end.and_utc().timestamp() + DAY_SECONDS,
    ))
}

/// Busy blocks overlapping `[range_start, range_end)` for the given profiles.
/// Pure: the caller supplies the raw rows it was allowed to read.
pub fn busy_blocks(
    profiles: &[String],
    meetings_with_attendees: &[(Meeting, Vec<String>)],
    absences: &[(String, String, String, String, bool)],
    range_start: i64,
    range_end: i64,
) -> Result<Vec<BusyBlock>> {
    validate_range(range_start, range_end)?;
    let wanted = |id: &String| profiles.iter().any(|p| p == id);
    let mut blocks = Vec::new();

    for (meeting, attendees) in meetings_with_attendees {
        if meeting.archived {
            continue;
        }
        let present: Vec<&String> = attendees.iter().filter(|id| wanted(id)).collect();
        if present.is_empty() {
            continue;
        }
        for occurrence in meetings::expand(meeting, range_start, range_end)? {
            for profile_id in &present {
                blocks.push(BusyBlock {
                    profile_id: (*profile_id).clone(),
                    starts_at: occurrence.starts_at,
                    ends_at: occurrence.ends_at,
                    kind: "meeting".into(),
                    source_id: occurrence.id.clone(),
                    availability: String::new(),
                });
            }
        }
    }

    for (id, profile_id, date_from, date_to, _approved) in absences {
        if !wanted(profile_id) {
            continue;
        }
        let (starts_at, ends_at) = absence_window(date_from, date_to)?;
        if !overlaps(starts_at, ends_at, range_start, range_end) {
            continue;
        }
        blocks.push(BusyBlock {
            profile_id: profile_id.clone(),
            starts_at,
            ends_at,
            kind: "absence".into(),
            source_id: id.clone(),
            availability: String::new(),
        });
    }

    blocks.sort_by(|a, b| {
        a.starts_at
            .cmp(&b.starts_at)
            .then_with(|| a.profile_id.cmp(&b.profile_id))
    });
    Ok(blocks)
}

/// Which of `profiles` collide with `[starts_at, ends_at)`, and which do not.
pub fn conflicts_in(
    profiles: &[String],
    blocks: &[BusyBlock],
    starts_at: i64,
    ends_at: i64,
) -> Result<ConflictReport> {
    validate_range(starts_at, ends_at)?;
    let conflicts: Vec<BusyBlock> = blocks
        .iter()
        .filter(|b| overlaps(b.starts_at, b.ends_at, starts_at, ends_at))
        .filter(|b| profiles.contains(&b.profile_id))
        .cloned()
        .collect();
    let free = profiles
        .iter()
        .filter(|p| !conflicts.iter().any(|b| b.profile_id == **p))
        .cloned()
        .collect();
    Ok(ConflictReport {
        starts_at,
        ends_at,
        conflicts,
        free,
    })
}

/// Candidate slots of `duration_seconds`, best first. A slot where everybody is
/// free ranks above one where somebody is not; ties break on the earlier start,
/// because a scheduler that hesitates wastes the week.
pub fn suggest_slots(
    profiles: &[String],
    blocks: &[BusyBlock],
    range_start: i64,
    range_end: i64,
    duration_seconds: i64,
    granularity_seconds: i64,
    limit: usize,
) -> Result<Vec<Slot>> {
    validate_range(range_start, range_end)?;
    if duration_seconds <= 0 {
        return Err("Meeting duration must be positive".into());
    }
    if duration_seconds > range_end - range_start {
        return Err("Meeting duration does not fit in the range".into());
    }
    let step = if granularity_seconds > 0 {
        granularity_seconds
    } else {
        DEFAULT_GRANULARITY_SECONDS
    };
    let limit = limit.clamp(1, MAX_SUGGESTIONS);

    let mut all = Vec::new();
    let mut start = range_start;
    while start + duration_seconds <= range_end {
        let end = start + duration_seconds;
        let report = conflicts_in(profiles, blocks, start, end)?;
        let busy: Vec<String> = profiles
            .iter()
            .filter(|p| !report.free.contains(p))
            .cloned()
            .collect();
        all.push(Slot {
            starts_at: start,
            ends_at: end,
            free: report.free,
            busy,
        });
        start += step;
    }
    all.sort_by(|a, b| {
        a.busy
            .len()
            .cmp(&b.busy.len())
            .then_with(|| a.starts_at.cmp(&b.starts_at))
    });
    all.truncate(limit);
    Ok(all)
}

// ---------------------------------------------------------------------------
// Readers: the only part that touches the database.
// ---------------------------------------------------------------------------

fn read_meetings_with_attendees(
    c: &rusqlite::Connection,
    viewer: &str,
) -> Result<Vec<(Meeting, Vec<String>)>> {
    let meetings = meetings::visible_meetings_on(c, viewer)?;
    let mut out = Vec::with_capacity(meetings.len());
    for meeting in meetings {
        let mut statement = c
            .prepare("SELECT profile_id FROM meeting_participants WHERE meeting_id=?1 AND status<>'declined'")
            .map_err(|e| e.to_string())?;
        let mut attendees: Vec<String> = statement
            .query_map([&meeting.id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?;
        if let Some(organizer) = meeting.organizer_id.clone() {
            if !attendees.contains(&organizer) {
                attendees.push(organizer);
            }
        }
        out.push((meeting, attendees));
    }
    Ok(out)
}

type AbsenceRow = (String, String, String, String, bool);

fn read_absences(c: &rusqlite::Connection) -> Result<Vec<AbsenceRow>> {
    let mut statement = c
        .prepare("SELECT id,profile_id,date_from,date_to,approved,availability FROM absences")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    // An absence with availability `available` is a note, not busy time.
    Ok(rows
        .into_iter()
        .filter(|(_, _, _, _, _, availability)| availability != "available")
        .map(|(id, profile_id, from, to, approved, _)| (id, profile_id, from, to, approved))
        .collect())
}

/// Busy blocks for `profiles`, as visible to `viewer`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_busy_blocks(
    profiles: Vec<String>,
    range_start: i64,
    range_end: i64,
    viewer_id: String,
) -> Result<Vec<BusyBlock>> {
    validate_range(range_start, range_end)?;
    let c = db::conn()?;
    let meetings = read_meetings_with_attendees(&c, &viewer_id)?;
    let absences = read_absences(&c)?;
    busy_blocks(&profiles, &meetings, &absences, range_start, range_end)
}

/// Does the proposed window collide with anything the viewer can see?
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn check_meeting_conflicts(
    profiles: Vec<String>,
    starts_at: i64,
    ends_at: i64,
    viewer_id: String,
) -> Result<ConflictReport> {
    let blocks = list_busy_blocks(profiles.clone(), starts_at, ends_at, viewer_id)?;
    conflicts_in(&profiles, &blocks, starts_at, ends_at)
}

/// Slot suggestions inside `[range_start, range_end)`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn suggest_meeting_slots(
    profiles: Vec<String>,
    range_start: i64,
    range_end: i64,
    duration_seconds: i64,
    granularity_seconds: Option<i64>,
    limit: Option<u32>,
    viewer_id: String,
) -> Result<Vec<Slot>> {
    let blocks = list_busy_blocks(profiles.clone(), range_start, range_end, viewer_id)?;
    suggest_slots(
        &profiles,
        &blocks,
        range_start,
        range_end,
        duration_seconds,
        granularity_seconds.unwrap_or(DEFAULT_GRANULARITY_SECONDS),
        limit.unwrap_or(5) as usize,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meeting(id: &str, starts_at: i64, rrule: Option<&str>) -> Meeting {
        Meeting {
            id: id.into(),
            title: "Planning".into(),
            description: None,
            starts_at,
            ends_at: starts_at + 3600,
            rrule: rrule.map(str::to_owned),
            location: None,
            organizer_id: Some("p-1".into()),
            channel_id: None,
            visibility: "participants".into(),
            modification_preference: "organizer-only".into(),
            archived: false,
            video_provider: None,
            video_room_id: None,
            join_url: None,
            video_status: "scheduled".into(),
        }
    }

    #[test]
    fn half_open_windows_touch_without_overlapping() {
        assert!(!overlaps(0, 100, 100, 200), "back to back is not a clash");
        assert!(overlaps(0, 101, 100, 200), "one second of shared time is");
    }

    #[test]
    fn absence_covers_its_last_day_entirely() {
        let (start, end) = absence_window("2026-03-02", "2026-03-03").unwrap();
        assert_eq!(end - start, 2 * DAY_SECONDS, "both days are busy, not one");
        assert!(absence_window("2026-03-04", "2026-03-02").is_err());
    }

    #[test]
    fn recurring_meeting_makes_every_occurrence_busy() {
        let profiles = vec!["p-1".to_string()];
        let meetings = vec![(
            meeting("m-1", 0, Some("FREQ=DAILY;INTERVAL=1")),
            vec!["p-1".to_string()],
        )];
        let blocks = busy_blocks(&profiles, &meetings, &[], 0, 3 * DAY_SECONDS).unwrap();
        assert_eq!(blocks.len(), 3, "one busy hour per day in the range");
        assert_eq!(blocks[1].starts_at, DAY_SECONDS);
        assert_eq!(blocks[0].kind, "meeting");
    }

    #[test]
    fn archived_meetings_and_other_profiles_are_not_busy_time() {
        let profiles = vec!["p-1".to_string()];
        let mut archived = meeting("m-old", 0, None);
        archived.archived = true;
        let meetings = vec![
            (archived, vec!["p-1".to_string()]),
            (meeting("m-other", 0, None), vec!["p-2".to_string()]),
        ];
        let blocks = busy_blocks(&profiles, &meetings, &[], 0, DAY_SECONDS).unwrap();
        assert!(blocks.is_empty(), "neither archive nor strangers block me");
    }

    #[test]
    fn conflicts_name_who_is_busy_and_who_is_free() {
        let profiles = vec!["p-1".to_string(), "p-2".to_string()];
        let meetings = vec![(meeting("m-1", 3600, None), vec!["p-1".to_string()])];
        let blocks = busy_blocks(&profiles, &meetings, &[], 0, DAY_SECONDS).unwrap();
        let report = conflicts_in(&profiles, &blocks, 3600, 7200).unwrap();
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(report.conflicts[0].profile_id, "p-1");
        assert_eq!(report.free, vec!["p-2".to_string()]);

        let clear = conflicts_in(&profiles, &blocks, 7200, 10_800).unwrap();
        assert!(clear.conflicts.is_empty(), "after the hour, both are free");
        assert_eq!(clear.free.len(), 2);
    }

    #[test]
    fn absence_blocks_the_whole_day_for_that_person_only() {
        let profiles = vec!["p-1".to_string(), "p-2".to_string()];
        let absences = vec![(
            "a-1".to_string(),
            "p-1".to_string(),
            "1970-01-01".to_string(),
            "1970-01-01".to_string(),
            true,
        )];
        let blocks = busy_blocks(&profiles, &[], &absences, 0, DAY_SECONDS).unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, "absence");
        let report = conflicts_in(&profiles, &blocks, 0, 3600).unwrap();
        assert_eq!(report.free, vec!["p-2".to_string()]);
    }

    #[test]
    fn suggestions_put_the_fully_free_slot_first() {
        let profiles = vec!["p-1".to_string(), "p-2".to_string()];
        let meetings = vec![(meeting("m-1", 0, None), vec!["p-1".to_string()])];
        let blocks = busy_blocks(&profiles, &meetings, &[], 0, 4 * 3600).unwrap();
        let slots = suggest_slots(&profiles, &blocks, 0, 4 * 3600, 3600, 3600, 5).unwrap();
        assert_eq!(slots[0].starts_at, 3600, "the first clash-free hour wins");
        assert!(slots[0].busy.is_empty());
        let compromise = slots.last().unwrap();
        assert_eq!(
            compromise.starts_at, 0,
            "the clashing slot sinks to the end"
        );
        assert_eq!(compromise.busy, vec!["p-1".to_string()]);
    }

    #[test]
    fn impossible_requests_are_refused_rather_than_guessed() {
        let profiles = vec!["p-1".to_string()];
        assert!(suggest_slots(&profiles, &[], 0, 3600, 7200, 900, 5).is_err());
        assert!(suggest_slots(&profiles, &[], 0, 3600, 0, 900, 5).is_err());
        assert!(busy_blocks(&profiles, &[], &[], 100, 100).is_err());
        assert!(busy_blocks(&profiles, &[], &[], 0, MAX_RANGE_SECONDS + 1).is_err());
    }

    #[test]
    fn granularity_and_limit_fall_back_to_sane_values() {
        let profiles = vec!["p-1".to_string()];
        let slots = suggest_slots(&profiles, &[], 0, 3600, 900, 0, 999).unwrap();
        assert_eq!(slots.len(), 4, "quarter hour steps across one free hour");
        assert!(slots.len() <= MAX_SUGGESTIONS);
    }
}
