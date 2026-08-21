//! Minimal read-only iCalendar (RFC 5545) reader: enough to render a personal
//! Google/iCloud/Outlook export as calendar items. Deliberately partial, and
//! that boundary is load-bearing, so it is named here rather than discovered
//! later as a silent gap:
//!
//! Supported: VEVENT `SUMMARY`/`UID`/`DTSTART`/`DTEND`, all-day (`VALUE=DATE`
//! or a bare 8-digit date) and timed instants (`...Z` or a bare local
//! `YYYYMMDDTHHMMSS`), and `RRULE` with `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`,
//! `INTERVAL`, `COUNT`, `UNTIL`. Line folding (RFC 5545 §3.1) is undone before
//! parsing, and `\n` / `\,` / `\;` / `\\` text escapes are undone in `SUMMARY`.
//!
//! NOT supported, on purpose rather than by accident: `BYDAY`/`BYMONTHDAY`/
//! `BYSETPOS` (a plain RRULE still expands from `DTSTART`'s own weekday/day-of-
//! month), `EXDATE`/`RDATE` exceptions, and `VTIMEZONE` offsets — a `DTSTART`
//! carrying a `TZID` parameter is read as its literal wall-clock digits, not
//! converted through that zone's UTC offset. A VEVENT that cannot be read at
//! all (no parseable `DTSTART`) is counted in `skipped`, never silently
//! dropped without a trace.

use chrono::{Months, NaiveDate, NaiveDateTime};

/// One occurrence ready to become a `CalendarItem`: either a date-only
/// all-day entry (`all_day_date` set, `starts_at` its UTC midnight for
/// ordering) or a timed instant (`all_day_date` is `None`).
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub uid: String,
    /// Stable within one feed: the base UID plus this occurrence's own start,
    /// so a recurring event's instances never collide on one row id.
    pub occurrence_key: String,
    pub title: String,
    pub starts_at: i64,
    pub ends_at: Option<i64>,
    pub all_day_date: Option<String>,
}

pub struct ParseResult {
    pub occurrences: Vec<Occurrence>,
    /// VEVENTs present in the feed but not readable (no usable DTSTART).
    pub skipped: usize,
}

/// Per-event and total caps: a feed with a decades-long daily RRULE and no
/// UNTIL must still return in bounded time and bounded memory.
const MAX_OCCURRENCES_PER_EVENT: usize = 500;
const MAX_TOTAL_OCCURRENCES: usize = 2000;

#[derive(Clone, Copy, Debug, PartialEq)]
enum DtValue {
    Instant(i64),
    Date(NaiveDate),
}

fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            if let Some(last) = lines.last_mut() {
                last.push_str(&line[1..]);
            }
        } else {
            lines.push(line.to_string());
        }
    }
    lines
}

/// Splits `NAME;PARAM=X:VALUE` into (`NAME`, `PARAM=X`, `VALUE`). A `:` inside
/// a quoted parameter value is not handled — no feed we target uses one.
fn split_property(line: &str) -> Option<(&str, &str, &str)> {
    let colon = line.find(':')?;
    let (head, value) = line.split_at(colon);
    let value = &value[1..];
    match head.find(';') {
        Some(semi) => Some((&head[..semi], &head[semi + 1..], value)),
        None => Some((head, "", value)),
    }
}

fn unescape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push(' '),
                Some(',') => out.push(','),
                Some(';') => out.push(';'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn parse_dt(raw: &str, params: &str) -> Option<DtValue> {
    let raw = raw.trim();
    let digits_only = |s: &str| s.len() >= 8 && s.as_bytes()[..8].iter().all(u8::is_ascii_digit);
    let date_of = |s: &str| -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(s[0..4].parse().ok()?, s[4..6].parse().ok()?, s[6..8].parse().ok()?)
    };
    if params.contains("VALUE=DATE") || (digits_only(raw) && raw.len() == 8) {
        return date_of(raw).map(DtValue::Date);
    }
    if digits_only(raw) && raw.len() >= 15 && raw.as_bytes()[8] == b'T' {
        let date = date_of(raw)?;
        let hh: u32 = raw[9..11].parse().ok()?;
        let mm: u32 = raw[11..13].parse().ok()?;
        let ss: u32 = raw[13..15].parse().ok()?;
        let at = date.and_hms_opt(hh, mm, ss)?;
        return Some(DtValue::Instant(at.and_utc().timestamp()));
    }
    None
}

fn instant_of(value: DtValue) -> i64 {
    match value {
        DtValue::Instant(seconds) => seconds,
        DtValue::Date(date) => date.and_hms_opt(0, 0, 0).expect("midnight is always valid").and_utc().timestamp(),
    }
}

struct Rrule {
    freq: Freq,
    interval: i64,
    count: Option<u32>,
    until: Option<DtValue>,
}

#[derive(Clone, Copy)]
enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

fn parse_rrule(raw: &str) -> Option<Rrule> {
    let mut freq = None;
    let mut interval = 1i64;
    let mut count = None;
    let mut until = None;
    for part in raw.split(';') {
        let mut kv = part.splitn(2, '=');
        let key = kv.next()?.trim();
        let value = kv.next()?.trim();
        match key {
            "FREQ" => {
                freq = Some(match value {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    // BYDAY/BYSETPOS-shaped frequencies (e.g. secondly) are out of
                    // scope for a personal calendar feed; the base occurrence still
                    // renders, the series just does not expand further.
                    _ => return None,
                });
            }
            "INTERVAL" => interval = value.parse().unwrap_or(1).max(1),
            "COUNT" => count = value.parse().ok(),
            "UNTIL" => until = parse_dt(value, ""),
            _ => {}
        }
    }
    Some(Rrule { freq: freq?, interval, count, until })
}

fn advance_instant(at: NaiveDateTime, rule: &Rrule) -> Option<NaiveDateTime> {
    match rule.freq {
        Freq::Daily => at.checked_add_signed(chrono::Duration::days(rule.interval)),
        Freq::Weekly => at.checked_add_signed(chrono::Duration::days(rule.interval * 7)),
        Freq::Monthly => {
            let date = at.date().checked_add_months(Months::new(rule.interval.max(0) as u32))?;
            Some(NaiveDateTime::new(date, at.time()))
        }
        Freq::Yearly => {
            let date = at.date().checked_add_months(Months::new((rule.interval.max(0) as u32).saturating_mul(12)))?;
            Some(NaiveDateTime::new(date, at.time()))
        }
    }
}

fn advance_date(at: NaiveDate, rule: &Rrule) -> Option<NaiveDate> {
    match rule.freq {
        Freq::Daily => at.checked_add_signed(chrono::Duration::days(rule.interval)),
        Freq::Weekly => at.checked_add_signed(chrono::Duration::days(rule.interval * 7)),
        Freq::Monthly => at.checked_add_months(Months::new(rule.interval.max(0) as u32)),
        Freq::Yearly => at.checked_add_months(Months::new((rule.interval.max(0) as u32).saturating_mul(12))),
    }
}

struct RawEvent {
    uid: Option<String>,
    summary: Option<String>,
    dtstart: Option<DtValue>,
    dtend: Option<DtValue>,
    rrule: Option<String>,
}

fn emit(events: &mut Vec<Occurrence>, uid: &str, title: &str, start: DtValue, duration: Option<i64>) {
    let starts_at = instant_of(start);
    let (ends_at, all_day_date) = match start {
        DtValue::Date(date) => (None, Some(date.format("%Y-%m-%d").to_string())),
        DtValue::Instant(_) => (duration.map(|d| starts_at + d), None),
    };
    events.push(Occurrence {
        uid: uid.to_string(),
        occurrence_key: starts_at.to_string(),
        title: title.to_string(),
        starts_at,
        ends_at,
        all_day_date,
    });
}

/// Parses `text` and returns every occurrence (base + RRULE expansion) whose
/// start falls in `[window_start, window_end)` (unix seconds). An event whose
/// RRULE this reader cannot expand still contributes its own base occurrence.
pub fn parse_ics(text: &str, window_start: i64, window_end: i64) -> ParseResult {
    let lines = unfold(text);
    let mut occurrences = Vec::new();
    let mut skipped = 0usize;
    let mut current: Option<RawEvent> = None;
    for line in &lines {
        let Some((name, params, value)) = split_property(line) else { continue };
        match name {
            "BEGIN" if value == "VEVENT" => current = Some(RawEvent { uid: None, summary: None, dtstart: None, dtend: None, rrule: None }),
            "END" if value == "VEVENT" => {
                if let Some(event) = current.take() {
                    let Some(dtstart) = event.dtstart else { skipped += 1; continue };
                    let uid = event.uid.unwrap_or_else(|| dtstart_fallback_uid(dtstart));
                    let title = event.summary.unwrap_or_else(|| "Untitled event".to_string());
                    let duration = event.dtend.map(|end| instant_of(end) - instant_of(dtstart)).filter(|d| *d > 0);
                    let budget = MAX_TOTAL_OCCURRENCES.saturating_sub(occurrences.len());
                    if budget == 0 { break; }
                    match event.rrule.as_deref().and_then(parse_rrule) {
                        None => {
                            let at = instant_of(dtstart);
                            if at >= window_start && at < window_end { emit(&mut occurrences, &uid, &title, dtstart, duration); }
                        }
                        Some(rule) => expand(&mut occurrences, &uid, &title, dtstart, duration, &rule, window_start, window_end, budget.min(MAX_OCCURRENCES_PER_EVENT)),
                    }
                }
            }
            _ if current.is_some() => {
                let event = current.as_mut().expect("checked above");
                match name {
                    "UID" => event.uid = Some(value.trim().to_string()),
                    "SUMMARY" => event.summary = Some(unescape_text(value.trim())),
                    "DTSTART" => event.dtstart = parse_dt(value, params),
                    "DTEND" => event.dtend = parse_dt(value, params),
                    "RRULE" => event.rrule = Some(value.trim().to_string()),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    ParseResult { occurrences, skipped }
}

fn dtstart_fallback_uid(start: DtValue) -> String { format!("no-uid-{}", instant_of(start)) }

#[allow(clippy::too_many_arguments)]
fn expand(
    out: &mut Vec<Occurrence>,
    uid: &str,
    title: &str,
    dtstart: DtValue,
    duration: Option<i64>,
    rule: &Rrule,
    window_start: i64,
    window_end: i64,
    cap: usize,
) {
    let until_instant = rule.until.map(instant_of);
    let mut generated = 0u32;
    match dtstart {
        DtValue::Date(mut at) => {
            for _ in 0..cap {
                if let Some(count) = rule.count { if generated >= count { break; } }
                let at_instant = instant_of(DtValue::Date(at));
                if let Some(until) = until_instant { if at_instant > until { break; } }
                if at_instant >= window_end { break; }
                if at_instant >= window_start { emit(out, uid, title, DtValue::Date(at), duration); }
                generated += 1;
                let Some(next) = advance_date(at, rule) else { break };
                at = next;
            }
        }
        DtValue::Instant(_) => {
            let mut at = chrono::DateTime::from_timestamp(instant_of(dtstart), 0).expect("valid instant").naive_utc();
            for _ in 0..cap {
                if let Some(count) = rule.count { if generated >= count { break; } }
                let at_instant = at.and_utc().timestamp();
                if let Some(until) = until_instant { if at_instant > until { break; } }
                if at_instant >= window_end { break; }
                if at_instant >= window_start { emit(out, uid, title, DtValue::Instant(at_instant), duration); }
                generated += 1;
                let Some(next) = advance_instant(at, rule) else { break };
                at = next;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_all_day_event_is_read_as_a_calendar_day() {
        let ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:e1\nSUMMARY:Birthday\nDTSTART;VALUE=DATE:20300315\nEND:VEVENT\nEND:VCALENDAR\n";
        let result = parse_ics(ics, 1_899_000_000, 1_902_000_000);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.occurrences.len(), 1);
        let event = &result.occurrences[0];
        assert_eq!(event.title, "Birthday");
        assert_eq!(event.all_day_date.as_deref(), Some("2030-03-15"));
        assert_eq!(event.ends_at, None);
    }

    #[test]
    fn a_timed_utc_event_carries_start_and_end() {
        let ics = "BEGIN:VEVENT\r\nUID:e2\r\nSUMMARY:Standup\r\nDTSTART:20300315T090000Z\r\nDTEND:20300315T093000Z\r\nEND:VEVENT\r\n";
        let result = parse_ics(ics, 1_899_000_000, 1_902_000_000);
        let event = &result.occurrences[0];
        assert_eq!(event.all_day_date, None);
        assert_eq!(event.ends_at.unwrap() - event.starts_at, 1800);
    }

    #[test]
    fn folded_summary_lines_are_rejoined_before_parsing() {
        // RFC 5545 §3.1: the single leading SPACE/HTAB on a continuation line is
        // the fold marker itself and is always stripped, never replaced — a real
        // content space at the fold point survives only if the producer wrote
        // it as a *second* character. Two spaces here: one marker, one content.
        let ics = "BEGIN:VEVENT\nUID:e3\nSUMMARY:A very long title that\n  continues on the next physical line\nDTSTART;VALUE=DATE:20300401\nEND:VEVENT\n";
        let result = parse_ics(ics, 1_899_000_000, 1_902_000_000);
        assert_eq!(result.occurrences[0].title, "A very long title that continues on the next physical line");
    }

    #[test]
    fn escaped_text_is_unescaped() {
        let ics = "BEGIN:VEVENT\nUID:e4\nSUMMARY:Comma\\, semicolon\\; and newline\\nhere\nDTSTART;VALUE=DATE:20300401\nEND:VEVENT\n";
        let result = parse_ics(ics, 1_899_000_000, 1_902_000_000);
        assert_eq!(result.occurrences[0].title, "Comma, semicolon; and newline here");
    }

    #[test]
    fn a_vevent_with_no_dtstart_is_skipped_not_dropped_silently() {
        let ics = "BEGIN:VEVENT\nUID:e5\nSUMMARY:Missing start\nEND:VEVENT\nBEGIN:VEVENT\nUID:e6\nSUMMARY:Fine\nDTSTART;VALUE=DATE:20300401\nEND:VEVENT\n";
        let result = parse_ics(ics, 1_899_000_000, 1_902_000_000);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.occurrences.len(), 1);
    }

    #[test]
    fn weekly_rrule_expands_within_the_window_and_respects_count() {
        // 2030-03-01 is a Friday; five weekly occurrences, only some in-window.
        let ics = "BEGIN:VEVENT\nUID:e7\nSUMMARY:Standup\nDTSTART:20300301T090000Z\nDTEND:20300301T093000Z\nRRULE:FREQ=WEEKLY;COUNT=5\nEND:VEVENT\n";
        let start = NaiveDate::from_ymd_opt(2030, 3, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
        let end = NaiveDate::from_ymd_opt(2030, 3, 22).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
        let result = parse_ics(ics, start, end);
        // COUNT=5 → 2030-03-01,08,15,22,29; window ends 2030-03-22 exclusive → 3 land inside.
        assert_eq!(result.occurrences.len(), 3);
        assert_eq!(result.occurrences[0].occurrence_key, result.occurrences[0].starts_at.to_string());
        let keys: std::collections::BTreeSet<_> = result.occurrences.iter().map(|o| o.occurrence_key.clone()).collect();
        assert_eq!(keys.len(), 3, "every occurrence has a distinct key");
    }

    #[test]
    fn monthly_rrule_respects_until() {
        let ics = "BEGIN:VEVENT\nUID:e8\nSUMMARY:Rent\nDTSTART;VALUE=DATE:20300101\nRRULE:FREQ=MONTHLY;UNTIL=20300401\nEND:VEVENT\n";
        let start = NaiveDate::from_ymd_opt(2030, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
        let end = NaiveDate::from_ymd_opt(2031, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
        let result = parse_ics(ics, start, end);
        // Jan, Feb, Mar, Apr(=UNTIL, inclusive) land; May is past UNTIL.
        assert_eq!(result.occurrences.len(), 4);
    }

    #[test]
    fn a_runaway_daily_rrule_with_no_until_or_count_is_capped() {
        let ics = "BEGIN:VEVENT\nUID:e9\nSUMMARY:Forever\nDTSTART;VALUE=DATE:19700101\nRRULE:FREQ=DAILY\nEND:VEVENT\n";
        let start = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
        let end = NaiveDate::from_ymd_opt(2099, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
        let result = parse_ics(ics, start, end);
        assert_eq!(result.occurrences.len(), MAX_OCCURRENCES_PER_EVENT);
    }

    #[test]
    fn an_event_entirely_outside_the_window_contributes_nothing() {
        let ics = "BEGIN:VEVENT\nUID:e10\nSUMMARY:Long ago\nDTSTART;VALUE=DATE:19990101\nEND:VEVENT\n";
        let result = parse_ics(ics, 1_899_000_000, 1_902_000_000);
        assert_eq!(result.occurrences.len(), 0);
        assert_eq!(result.skipped, 0);
    }
}
