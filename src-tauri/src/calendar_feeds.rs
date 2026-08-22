//! Read-only external calendar sync: a user pastes a provider's secret iCal
//! URL (Google's "Secret address in iCal format", or the iCloud/Outlook
//! equivalent) and its events show up on their own Calendar view. Nothing is
//! written back to the provider — see `docs` note in Settings for why.
//!
//! The URL is a bearer credential (anyone holding it can read that calendar
//! forever) and is sealed at rest with [`crate::secretbox`], the same store
//! built for OAuth refresh tokens; it is never returned to a client once
//! saved. A transient fetch failure never destroys the previously cached
//! events — `last_error` records it, the last-good events stay visible.
use crate::{db, ics, personal::CalendarItem, secretbox};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::Duration;

type Result<T> = std::result::Result<T, String>;

/// A named calendar is a user-owned container. Feed assignment is optional: an
/// unassigned feed remains visible for backward compatibility while new feeds
/// can be placed into a specific calendar.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Calendar {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
}
#[derive(Debug, Deserialize)]
pub struct CalendarInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
}
fn calendar_row(c: &Connection, id: &str) -> Result<Option<Calendar>> {
    err(c
        .query_row(
            "SELECT id,profile_id,name,color,visible FROM calendars WHERE id=?1",
            [id],
            |r| {
                Ok(Calendar {
                    id: r.get(0)?,
                    profile_id: r.get(1)?,
                    name: r.get(2)?,
                    color: r.get(3)?,
                    visible: r.get(4)?,
                })
            },
        )
        .optional())
}
pub fn calendar_owner(id: &str) -> Result<Option<String>> {
    let c = db::conn()?;
    err(c
        .query_row("SELECT profile_id FROM calendars WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_calendars(profile_id: String) -> Result<Vec<Calendar>> {
    let c = db::conn()?;
    let mut q = err(c.prepare(
        "SELECT id,profile_id,name,color,visible FROM calendars WHERE profile_id=?1 ORDER BY name",
    ))?;
    let rows = err(q.query_map([profile_id], |r| {
        Ok(Calendar {
            id: r.get(0)?,
            profile_id: r.get(1)?,
            name: r.get(2)?,
            color: r.get(3)?,
            visible: r.get(4)?,
        })
    }))?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_calendar(input: CalendarInput) -> Result<Calendar> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("A calendar needs a name.".into());
    }
    if !input.color.starts_with('#') || input.color.len() != 7 {
        return Err("Calendar color must be a #RRGGBB value.".into());
    }
    let c = db::conn()?;
    let id = match input.id {
        Some(id) if calendar_row(&c, &id)?.is_some() => {
            err(c.execute(
                "UPDATE calendars SET name=?1,color=?2,visible=?3 WHERE id=?4",
                params![name, input.color, input.visible, id],
            ))?;
            id
        }
        _ => {
            let id = format!("calendar-{:x}", now());
            err(c.execute("INSERT INTO calendars(id,profile_id,name,color,visible,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![id,input.profile_id,name,input.color,input.visible,now()]))?;
            id
        }
    };
    calendar_row(&c, &id)?.ok_or_else(|| "Calendar disappeared".into())
}
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_calendar(id: String) -> Result<()> {
    let c = db::conn()?;
    if err(c.execute("DELETE FROM calendars WHERE id=?1", [id]))? == 0 {
        return Err("Calendar not found".into());
    };
    Ok(())
}

fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("feed-{nanos:x}")
}
fn err<T>(result: rusqlite::Result<T>) -> Result<T> {
    result.map_err(|error| error.to_string())
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Never carries the URL back to a client — only its sync state.
#[derive(Clone, Debug, Serialize)]
pub struct CalendarFeed {
    pub id: String,
    pub profile_id: String,
    pub label: String,
    pub created_at: i64,
    pub last_synced_at: Option<i64>,
    pub last_error: Option<String>,
    pub event_count: i64,
}
#[derive(Debug, Deserialize)]
pub struct CalendarFeedInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub label: String,
    pub ics_url: String,
}

fn row(c: &Connection, id: &str) -> Result<Option<CalendarFeed>> {
    err(c.query_row(
        "SELECT id,profile_id,label,created_at,last_synced_at,last_error,event_count FROM calendar_feeds WHERE id=?1",
        [id],
        |r| Ok(CalendarFeed { id: r.get(0)?, profile_id: r.get(1)?, label: r.get(2)?, created_at: r.get(3)?, last_synced_at: r.get(4)?, last_error: r.get(5)?, event_count: r.get(6)? }),
    ).optional())
}

/// The DB-side ownership check `space-server.rs`'s command policy authorizes
/// write/sync/delete against — read from the row, never trusted from the body.
pub fn feed_owner(id: &str) -> Result<Option<String>> {
    let c = db::conn()?;
    err(c
        .query_row(
            "SELECT profile_id FROM calendar_feeds WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_calendar_feeds(profile_id: String) -> Result<Vec<CalendarFeed>> {
    let c = db::conn()?;
    let mut statement = err(c.prepare("SELECT id,profile_id,label,created_at,last_synced_at,last_error,event_count FROM calendar_feeds WHERE profile_id=?1 ORDER BY created_at"))?;
    let rows = err(statement.query_map([&profile_id], |r| {
        Ok(CalendarFeed {
            id: r.get(0)?,
            profile_id: r.get(1)?,
            label: r.get(2)?,
            created_at: r.get(3)?,
            last_synced_at: r.get(4)?,
            last_error: r.get(5)?,
            event_count: r.get(6)?,
        })
    }))?;
    let mut out = Vec::new();
    for feed in rows {
        out.push(feed.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Create (no `id`) or rename/re-point (existing `id`, ownership already
/// checked by the command policy). Either way ends with an immediate sync
/// attempt so the caller sees real state, not a promise — a fetch failure at
/// this point is not an error return, it is `last_error` on the saved row.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn save_calendar_feed(input: CalendarFeedInput) -> Result<CalendarFeed> {
    let label = input.label.trim();
    if label.is_empty() {
        return Err("A calendar needs a label.".into());
    }
    let url = input.ics_url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("The calendar address must start with http:// or https://.".into());
    }
    let sealed = secretbox::seal(url)?;
    let c = db::conn()?;
    let id = match &input.id {
        Some(id) if row(&c, id)?.is_some() => {
            err(c.execute(
                "UPDATE calendar_feeds SET label=?1, ics_url_sealed=?2 WHERE id=?3",
                params![label, sealed, id],
            ))?;
            id.clone()
        }
        _ => {
            let id = new_id();
            err(c.execute(
                "INSERT INTO calendar_feeds(id,profile_id,label,ics_url_sealed,created_at,last_synced_at,last_error,event_count) VALUES(?1,?2,?3,?4,?5,NULL,NULL,0)",
                params![id, input.profile_id, label, sealed, now()],
            ))?;
            id
        }
    };
    drop(c);
    sync_calendar_feed(id)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_calendar_feed(id: String) -> Result<()> {
    let c = db::conn()?;
    err(c.execute("DELETE FROM calendar_feeds WHERE id=?1", [&id]))?;
    Ok(())
}

const SYNC_WINDOW_PAST_DAYS: i64 = 60;
const SYNC_WINDOW_FUTURE_DAYS: i64 = 400;
const MAX_FEED_BYTES: u64 = 8_000_000;
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

fn record_error(c: &Connection, id: &str, message: &str) -> Result<()> {
    // A failed fetch touches only sync bookkeeping — cached events (the
    // last-good sync) are left exactly as they were, never wiped by a
    // transient network error.
    err(c.execute(
        "UPDATE calendar_feeds SET last_synced_at=?1, last_error=?2 WHERE id=?3",
        params![now(), message, id],
    ))
    .map(|_| ())
}

/// Fetches the feed's URL, parses it, and replaces its cached events. Always
/// returns `Ok` with the feed's resulting state (including a set `last_error`)
/// unless the feed id itself is unknown or the deployment cannot hold secrets
/// at all — those are the only cases where nothing useful could be recorded.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn sync_calendar_feed(id: String) -> Result<CalendarFeed> {
    let c = db::conn()?;
    let (sealed_url,) = err(c.query_row(
        "SELECT ics_url_sealed FROM calendar_feeds WHERE id=?1",
        [&id],
        |r| Ok((r.get::<_, String>(0)?,)),
    ))
    .map_err(|_| format!("Calendar feed `{id}` does not exist"))?;
    let url = match secretbox::open(&sealed_url) {
        Ok(url) => url,
        Err(message) => {
            record_error(&c, &id, &message)?;
            return row(&c, &id)?
                .ok_or_else(|| "Calendar feed disappeared during sync".to_string());
        }
    };
    drop(c);

    let outcome = fetch_and_parse(&url);
    let c = db::conn()?;
    match outcome {
        Err(message) => {
            record_error(&c, &id, &message)?;
        }
        Ok(result) => {
            let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM calendar_feed_events WHERE feed_id=?1", [&id])
                .map_err(|e| e.to_string())?;
            for occurrence in &result.occurrences {
                tx.execute(
                    "INSERT OR IGNORE INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![id, occurrence.uid, occurrence.occurrence_key, occurrence.title, occurrence.starts_at, occurrence.ends_at, occurrence.all_day_date],
                ).map_err(|e| e.to_string())?;
            }
            let last_error = if result.skipped > 0 {
                Some(format!(
                    "synced {} events; {} entries in this calendar could not be read",
                    result.occurrences.len(),
                    result.skipped
                ))
            } else {
                None
            };
            tx.execute("UPDATE calendar_feeds SET last_synced_at=?1, last_error=?2, event_count=?3 WHERE id=?4", params![now(), last_error, result.occurrences.len() as i64, id]).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
    }
    row(&c, &id)?.ok_or_else(|| "Calendar feed disappeared during sync".to_string())
}

struct FetchOutcome {
    occurrences: Vec<ics::Occurrence>,
    skipped: usize,
}

/// Reqwest's blocking client owns its own little Tokio runtime; building *and
/// dropping* one while already inside this binary's own async runtime (every
/// `/api/cmd/*` handler is `async fn`) panics on drop ("cannot drop a runtime
/// in a context where blocking is not allowed"). A plain OS thread has no
/// ambient runtime, so the client's whole lifetime happens there instead; the
/// caller just waits on the join — fine for a manual "Sync now", not a hot path.
fn fetch_and_parse(url: &str) -> Result<FetchOutcome> {
    let url = url.to_string();
    std::thread::spawn(move || fetch_and_parse_off_the_async_runtime(&url))
        .join()
        .map_err(|_| "the calendar fetch thread panicked".to_string())?
}

fn fetch_and_parse_off_the_async_runtime(url: &str) -> Result<FetchOutcome> {
    let client = reqwest::blocking::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent("gaia-space-calendar-sync/1.0")
        .build()
        .map_err(|e| format!("could not start the fetch client: {e}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("could not reach that calendar address: {e}"))?;
    if let Some(len) = response.content_length() {
        if len > MAX_FEED_BYTES {
            return Err(format!(
                "that calendar is {len} bytes, larger than the {MAX_FEED_BYTES} byte limit"
            ));
        }
    }
    let status = response.status();
    if !status.is_success() {
        return Err(format!("the calendar server answered {status}"));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("the calendar download was interrupted: {e}"))?;
    if bytes.len() as u64 > MAX_FEED_BYTES {
        return Err(format!(
            "that calendar is larger than the {MAX_FEED_BYTES} byte limit"
        ));
    }
    let text = String::from_utf8_lossy(&bytes);
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("that address did not answer with a calendar (.ics) file".into());
    }
    let window_start = now() - SYNC_WINDOW_PAST_DAYS * 86_400;
    let window_end = now() + SYNC_WINDOW_FUTURE_DAYS * 86_400;
    let result = ics::parse_ics(&text, window_start, window_end);
    Ok(FetchOutcome {
        occurrences: result.occurrences,
        skipped: result.skipped,
    })
}

/// Every synced feed event belonging to `profile_id` that lands in either
/// window: timed events by instant overlap (mirrors how meetings are shown),
/// all-day events by their own calendar-day string (mirrors todos/deadlines).
pub fn external_items_on(
    c: &Connection,
    profile_id: &str,
    range_start: i64,
    range_end: i64,
    day_start: &str,
    day_end: &str,
) -> Result<Vec<CalendarItem>> {
    let mut statement = err(c.prepare(
        "SELECT cfe.feed_id,cfe.uid,cfe.occurrence_key,cfe.title,cfe.starts_at,cfe.ends_at,cfe.all_day_date FROM calendar_feed_events cfe \
         JOIN calendar_feeds cf ON cf.id=cfe.feed_id WHERE cf.profile_id=?1 AND ( \
           (cfe.all_day_date IS NULL AND cfe.starts_at<?3 AND (cfe.ends_at IS NULL OR cfe.ends_at>?2)) \
           OR (cfe.all_day_date IS NOT NULL AND cfe.all_day_date>=?4 AND cfe.all_day_date<?5) \
         )",
    ))?;
    let rows = err(statement.query_map(
        params![profile_id, range_start, range_end, day_start, day_end],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        },
    ))?;
    let mut items = Vec::new();
    for record in rows {
        let (feed_id, uid, occurrence_key, title, starts_at, ends_at, date) =
            record.map_err(|e| e.to_string())?;
        items.push(CalendarItem {
            id: format!("external-{feed_id}-{uid}-{occurrence_key}"),
            source_id: feed_id,
            kind: "external".into(),
            title,
            starts_at,
            ends_at,
            project_id: None,
            date,
        });
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrate, open_in_memory};

    fn seeded() -> Connection {
        let c = open_in_memory().unwrap();
        migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','pa','Pa',0),('pb','pb','Pb',0)", []).unwrap();
        c
    }

    #[test]
    fn external_items_are_scoped_to_their_own_profile() {
        let c = seeded();
        c.execute("INSERT INTO calendar_feeds(id,profile_id,label,ics_url_sealed,created_at,event_count) VALUES('f1','pa','Mine','sealed',0,0)", []).unwrap();
        c.execute("INSERT INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES('f1','u1','1900000000','Timed',1900000000,1900003600,NULL)", []).unwrap();
        c.execute("INSERT INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES('f1','u2','2030-03-10','All day',1899936000,NULL,'2030-03-10')", []).unwrap();
        let owner = external_items_on(&c, "pa", 1899900000, 1900010000, "2030-03-10", "2030-03-11")
            .unwrap();
        assert_eq!(
            owner.len(),
            2,
            "both the timed and all-day event land in their windows"
        );
        assert!(owner.iter().all(|item| item.kind == "external"));
        let stranger =
            external_items_on(&c, "pb", 1899900000, 1900010000, "2030-03-10", "2030-03-11")
                .unwrap();
        assert_eq!(stranger.len(), 0, "another profile's feed is invisible");
    }

    #[test]
    fn deleting_a_feed_cascades_its_cached_events() {
        let c = seeded();
        c.execute("INSERT INTO calendar_feeds(id,profile_id,label,ics_url_sealed,created_at,event_count) VALUES('f2','pa','Mine','sealed',0,0)", []).unwrap();
        c.execute("INSERT INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES('f2','u1','1',  'x',1900000000,NULL,NULL)", []).unwrap();
        c.execute("DELETE FROM calendar_feeds WHERE id='f2'", [])
            .unwrap();
        let left: i64 = c
            .query_row(
                "SELECT count(*) FROM calendar_feed_events WHERE feed_id='f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            left, 0,
            "junction-shaped cache rows never survive their feed (FK cascade)"
        );
    }

    #[test]
    fn a_failed_sync_keeps_the_previous_cached_events_and_records_the_error() {
        let c = seeded();
        c.execute("INSERT INTO calendar_feeds(id,profile_id,label,ics_url_sealed,created_at,last_synced_at,last_error,event_count) VALUES('f3','pa','Mine','sealed',0,100,NULL,1)", []).unwrap();
        c.execute("INSERT INTO calendar_feed_events(feed_id,uid,occurrence_key,title,starts_at,ends_at,all_day_date) VALUES('f3','u1','1','Kept',1900000000,NULL,NULL)", []).unwrap();
        record_error(&c, "f3", "could not reach that calendar address: timed out").unwrap();
        let still_there: i64 = c
            .query_row(
                "SELECT count(*) FROM calendar_feed_events WHERE feed_id='f3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            still_there, 1,
            "a fetch failure must not wipe the last-good cache"
        );
        let feed = row(&c, "f3").unwrap().unwrap();
        assert!(feed.last_error.is_some());
        assert_eq!(
            feed.event_count, 1,
            "event_count is untouched by a failed sync"
        );
    }
}
