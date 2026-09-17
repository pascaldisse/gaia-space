//! The channel's Notes & Decisions LOG.
//!
//! ── WHY A LOG AND NOT A DOCUMENT ────────────────────────────────────────────────
//! A document is *edited*: the current text replaces the previous one and the reason a
//! thing changed disappears with the words that said it. A log *grows*. The question this
//! surface answers — "where do we stand right now?" — is answered by the newest entries of
//! a readable history, not by a paragraph somebody last rewrote on Tuesday.
//!
//! So rows are appended. An author may correct their own entry, but the correction is
//! stamped in `edited_at` and shown; there is no silent rewrite, and no other person can
//! change what somebody wrote.
//!
//! ── ATTACHMENTS: A LINK TO A DOCUMENT, NOT A SECOND BLOB STORE ──────────────────
//! Two file mechanisms already exist and neither is generic:
//!   * `message_attachments` (chat.rs) is keyed on `message_id`, carries a data-URL payload
//!     and an upload lifecycle. Reusing it for a note would mean inventing a phantom
//!     message to own the bytes.
//!   * `documents` / `document_files` (documents.rs) IS the project's file surface — it is
//!     literally what the channel's "Files & Links" tab renders, already scoped to this
//!     same project.
//!     Therefore a note attaches by REFERENCING a document (`attachment_document_id`). The
//!     bytes keep one home, one access model and one version history. "Upload something" is
//!     answered honestly: upload it where files live, then point the decision at it.
//!
//! ── AUTHORIZATION ──────────────────────────────────────────────────────────────
//! Reads: project members (the same door as `list_project_todos`). Writes: a project member
//! may append; only the author may edit or delete their own entry.
use crate::{db, personal};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn new_id(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{kind}-{nanos:x}-{:x}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
fn err<T>(result: rusqlite::Result<T>) -> Result<T> {
    result.map_err(|error| error.to_string())
}

/// One entry in the log. `edited_at` is `None` until the author changes it — that is the
/// whole visibility contract: a present `edited_at` means "this text is not the original".
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChannelNote {
    pub id: String,
    pub channel_id: String,
    pub project_id: String,
    /// `decision` | `status`. Nothing else is storable.
    pub kind: String,
    pub body: String,
    pub author_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub edited_at: Option<i64>,
    /// A link to an existing document; never a blob. See the module note.
    #[serde(default)]
    pub attachment_document_id: Option<String>,
    /// Denormalized for the reader only: the log must be able to name the attachment
    /// without a second round-trip, and must keep showing the note when the document is
    /// gone (the id is then NULL and this is None).
    #[serde(default)]
    pub attachment_title: Option<String>,
    #[serde(default)]
    pub source_entity_type: Option<String>,
    #[serde(default)]
    pub source_entity_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChannelNoteInput {
    pub id: Option<String>,
    pub channel_id: String,
    pub kind: String,
    pub body: String,
    pub author_id: String,
    #[serde(default)]
    pub attachment_document_id: Option<String>,
    #[serde(default)]
    pub source_entity_type: Option<String>,
    #[serde(default)]
    pub source_entity_id: Option<String>,
}

const NOTE_COLUMNS: &str = "n.id,n.channel_id,n.project_id,n.kind,n.body,n.author_id,n.created_at,n.updated_at,n.edited_at,n.attachment_document_id,(SELECT d.title FROM documents d WHERE d.id=n.attachment_document_id),n.source_entity_type,n.source_entity_id";

fn read_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChannelNote> {
    Ok(ChannelNote {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        project_id: row.get(2)?,
        kind: row.get(3)?,
        body: row.get(4)?,
        author_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        edited_at: row.get(8)?,
        attachment_document_id: row.get(9)?,
        attachment_title: row.get(10)?,
        source_entity_type: row.get(11)?,
        source_entity_id: row.get(12)?,
    })
}

/// Two kinds exist. A third is a client bug, not a new format — the same posture as
/// `personal::normalized_content_kind`.
fn normalized_kind(kind: &str) -> Result<String> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "decision" => Ok("decision".into()),
        "status" => Ok("status".into()),
        other => Err(format!("Unknown note kind: {other}")),
    }
}

/// The both-or-neither anchor rule, identical to `personal::valid_anchor`: half an anchor
/// is a back-link that cannot be followed, which is worse than none.
fn valid_anchor(entity_type: &Option<String>, entity_id: &Option<String>) -> Result<()> {
    if entity_type.is_some() != entity_id.is_some() {
        return Err("Note anchors require both entity type and entity ID".into());
    }
    Ok(())
}

/// Blank attachment ids normalize to NULL: no empty-string variant ever reaches storage.
fn normalized_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

/// The project a channel belongs to. A channel without one has no notes surface at all —
/// the tab is not even drawn — so the absence is an error here, not an empty read.
fn project_of_channel(c: &Connection, channel_id: &str) -> Result<String> {
    let project: Option<Option<String>> = err(c
        .query_row(
            "SELECT project_id FROM channels WHERE id=?1",
            [channel_id],
            |row| row.get(0),
        )
        .optional())?;
    match project {
        None => Err("Channel not found".into()),
        Some(None) => Err("This channel has no project: notes are project-scoped".into()),
        Some(Some(project_id)) => Ok(project_id),
    }
}

fn require_member(c: &Connection, project_id: &str, profile_id: &str) -> Result<()> {
    if personal::project_member_on(c, project_id, profile_id)? {
        return Ok(());
    }
    Err("Notes are visible to project members only".into())
}

fn note_on(c: &Connection, id: &str) -> Result<Option<ChannelNote>> {
    err(c
        .query_row(
            &format!("SELECT {NOTE_COLUMNS} FROM channel_notes n WHERE n.id=?1"),
            [id],
            read_note,
        )
        .optional())
}

/// Newest first: a log is read from its head. The tie-break on `id` keeps two entries
/// written in the same second in a stable order across reloads.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn list_channel_notes(channel_id: String, profile_id: String) -> Result<Vec<ChannelNote>> {
    let c = db::conn()?;
    list_channel_notes_on(&c, channel_id, profile_id)
}

fn list_channel_notes_on(
    c: &Connection,
    channel_id: String,
    profile_id: String,
) -> Result<Vec<ChannelNote>> {
    let project_id = project_of_channel(c, &channel_id)?;
    require_member(c, &project_id, &profile_id)?;
    let mut statement = err(c.prepare(&format!(
        "SELECT {NOTE_COLUMNS} FROM channel_notes n WHERE n.channel_id=?1 ORDER BY n.created_at DESC, n.id DESC"
    )))?;
    let notes = err(statement.query_map([channel_id], read_note))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(notes)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn create_channel_note(input: ChannelNoteInput) -> Result<ChannelNote> {
    let c = db::conn()?;
    create_channel_note_on(&c, input)
}

fn create_channel_note_on(c: &Connection, input: ChannelNoteInput) -> Result<ChannelNote> {
    if input.author_id.trim().is_empty() || input.body.trim().is_empty() {
        return Err("Note author and body are required".into());
    }
    let kind = normalized_kind(&input.kind)?;
    valid_anchor(&input.source_entity_type, &input.source_entity_id)?;
    let project_id = project_of_channel(c, &input.channel_id)?;
    require_member(c, &project_id, input.author_id.trim())?;
    let attachment = normalized_optional(input.attachment_document_id);
    let id = input.id.unwrap_or_else(|| new_id("note"));
    err(c.execute(
        "INSERT INTO channel_notes(id,channel_id,project_id,kind,body,author_id,attachment_document_id,source_entity_type,source_entity_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            input.channel_id,
            project_id,
            kind,
            input.body.trim(),
            input.author_id.trim(),
            attachment,
            input.source_entity_type,
            input.source_entity_id
        ],
    ))?;
    note_on(c, &id)?.ok_or_else(|| "Created note was not found".into())
}

/// An author corrects their own entry. The channel, project, author and creation time are
/// NOT taken from the payload — only body, kind, attachment and anchor can move — so an
/// edit can never relocate an entry into another channel or reassign its authorship.
/// `edited_at` is stamped on every accepted edit: that stamp is the whole point.
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn update_channel_note(note: ChannelNote) -> Result<ChannelNote> {
    let c = db::conn()?;
    update_channel_note_on(&c, note)
}

fn update_channel_note_on(c: &Connection, note: ChannelNote) -> Result<ChannelNote> {
    if note.body.trim().is_empty() {
        return Err("Note body is required".into());
    }
    let kind = normalized_kind(&note.kind)?;
    valid_anchor(&note.source_entity_type, &note.source_entity_id)?;
    let stored = note_on(c, &note.id)?.ok_or_else(|| "Note not found".to_string())?;
    if stored.author_id != note.author_id.trim() {
        return Err("Only the author can edit this note".into());
    }
    err(c.execute(
        "UPDATE channel_notes SET kind=?2,body=?3,attachment_document_id=?4,source_entity_type=?5,source_entity_id=?6,updated_at=unixepoch(),edited_at=unixepoch() WHERE id=?1",
        params![
            note.id,
            kind,
            note.body.trim(),
            normalized_optional(note.attachment_document_id),
            note.source_entity_type,
            note.source_entity_id
        ],
    ))?;
    note_on(c, &note.id)?.ok_or_else(|| "Note not found".into())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_channel_note(id: String, profile_id: String) -> Result<()> {
    let c = db::conn()?;
    delete_channel_note_on(&c, id, profile_id)
}

fn delete_channel_note_on(c: &Connection, id: String, profile_id: String) -> Result<()> {
    let stored = note_on(c, &id)?.ok_or_else(|| "Note not found".to_string())?;
    if stored.author_id != profile_id.trim() {
        return Err("Only the author can delete this note".into());
    }
    err(c.execute("DELETE FROM channel_notes WHERE id=?1", [id]))?;
    Ok(())
}

/// The author profile of a note, for authorization at the HTTP layer.
pub fn note_author(id: &str) -> Result<Option<String>> {
    let c = db::conn()?;
    err(c
        .query_row(
            "SELECT author_id FROM channel_notes WHERE id=?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One project, one project-bound channel, one member and one outsider.
    fn fixture() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('pa','ann','Ann',0),('pb','bob','Bob',0),('px','xena','Xena',0)", []).unwrap();
        c.execute(
            "INSERT INTO projects(id,name,key,created_by,created_at) VALUES('pr1','Demo','DEMO','pa',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO project_members(project_id,profile_id) VALUES('pr1','pb')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO channels(id,content_type,name,project_id) VALUES('ch1','public','general','pr1'),('ch0','public','loose',NULL)", []).unwrap();
        c
    }

    fn input(kind: &str, body: &str, author: &str) -> ChannelNoteInput {
        ChannelNoteInput {
            id: None,
            channel_id: "ch1".into(),
            kind: kind.into(),
            body: body.into(),
            author_id: author.into(),
            attachment_document_id: None,
            source_entity_type: None,
            source_entity_id: None,
        }
    }

    #[test]
    fn a_written_entry_reads_back_whole_and_newest_first() {
        let c = fixture();
        let first =
            create_channel_note_on(&c, input("decision", "  Ship on Friday  ", "pa")).unwrap();
        let second = create_channel_note_on(&c, input("status", "Backend done", "pb")).unwrap();
        // Body is trimmed, never stored with the client's whitespace.
        assert_eq!(first.body, "Ship on Friday");
        assert_eq!(first.kind, "decision");
        assert_eq!(first.author_id, "pa");
        assert!(
            first.created_at > 0,
            "the timestamp is real, not a placeholder"
        );
        assert_eq!(
            first.edited_at, None,
            "an unedited entry carries no edit stamp"
        );

        let mut statement = c
            .prepare("SELECT id FROM channel_notes WHERE channel_id='ch1' ORDER BY created_at DESC, id DESC")
            .unwrap();
        let ordered: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            ordered.first().unwrap(),
            &second.id,
            "the log is read from its head"
        );
        assert_eq!(ordered.len(), 2);
        // And the command returns the same order to a member, with the author intact.
        let listed = list_channel_notes_on(&c, "ch1".into(), "pb".into()).unwrap();
        assert_eq!(
            listed.iter().map(|n| n.id.clone()).collect::<Vec<_>>(),
            ordered
        );
        assert_eq!(listed[1].author_id, "pa");
    }

    #[test]
    fn only_the_two_kinds_are_storable() {
        let c = fixture();
        assert!(create_channel_note_on(&c, input("decision", "a", "pa")).is_ok());
        assert!(
            create_channel_note_on(&c, input("STATUS", "b", "pa")).is_ok(),
            "case is normalized, not rejected"
        );
        let rejected = create_channel_note_on(&c, input("minutes", "c", "pa")).unwrap_err();
        assert!(rejected.contains("Unknown note kind"), "{rejected}");
        // The CHECK constraint is the second lock, not the only one.
        assert!(c
            .execute("INSERT INTO channel_notes(id,channel_id,project_id,kind,body,author_id) VALUES('n','ch1','pr1','minutes','x','pa')", [])
            .is_err());
    }

    #[test]
    fn an_anchor_is_both_halves_or_neither() {
        let c = fixture();
        let mut half = input("decision", "From a message", "pa");
        half.source_entity_type = Some("message".into());
        let rejected = create_channel_note_on(&c, half).unwrap_err();
        assert!(
            rejected.contains("both entity type and entity ID"),
            "{rejected}"
        );

        let mut whole = input("decision", "From a message", "pa");
        whole.source_entity_type = Some("message".into());
        whole.source_entity_id = Some("m-1".into());
        let note = create_channel_note_on(&c, whole).unwrap();
        assert_eq!(note.source_entity_type.as_deref(), Some("message"));
        assert_eq!(note.source_entity_id.as_deref(), Some("m-1"));
        // The back-link survives a read: that round trip is the only reason it is stored.
        let listed = list_channel_notes_on(&c, "ch1".into(), "pa".into()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].source_entity_type.as_deref(), Some("message"));
        assert_eq!(listed[0].source_entity_id.as_deref(), Some("m-1"));
    }

    #[test]
    fn a_non_member_can_neither_read_nor_write() {
        let c = fixture();
        create_channel_note_on(&c, input("status", "internal", "pa")).unwrap();
        let refused = create_channel_note_on(&c, input("status", "sneaky", "px")).unwrap_err();
        assert!(refused.contains("project members only"), "{refused}");
        let unreadable = list_channel_notes_on(&c, "ch1".into(), "px".into()).unwrap_err();
        assert!(unreadable.contains("project members only"), "{unreadable}");
        // The read door is the same door.
        assert!(require_member(&c, "pr1", "px").is_err());
        assert!(
            require_member(&c, "pr1", "pb").is_ok(),
            "an explicit member passes"
        );
        assert!(
            require_member(&c, "pr1", "pa").is_ok(),
            "so does the project owner"
        );
    }

    #[test]
    fn an_edit_is_visible_and_belongs_to_the_author_alone() {
        let c = fixture();
        let note = create_channel_note_on(&c, input("status", "Half done", "pa")).unwrap();
        assert_eq!(note.edited_at, None);

        // Somebody else's correction is not a correction.
        let mut theft = note.clone();
        theft.author_id = "pb".into();
        theft.body = "Bob says otherwise".into();
        let refused = update_channel_note_on(&c, theft).unwrap_err();
        assert!(refused.contains("Only the author"), "{refused}");
        assert_eq!(note_on(&c, &note.id).unwrap().unwrap().body, "Half done");

        let mut fixed = note.clone();
        fixed.body = "Done".into();
        let edited = update_channel_note_on(&c, fixed).unwrap();
        assert_eq!(edited.body, "Done");
        assert!(edited.edited_at.is_some(), "an edit is never silent");
        assert_eq!(
            edited.created_at, note.created_at,
            "an edit does not rewrite history's start"
        );
    }

    #[test]
    fn an_edit_cannot_relocate_the_entry_or_reassign_it() {
        let c = fixture();
        let note = create_channel_note_on(&c, input("decision", "Stay here", "pa")).unwrap();
        let mut moved = note.clone();
        moved.channel_id = "ch0".into();
        moved.project_id = "other".into();
        let stored = update_channel_note_on(&c, moved).unwrap();
        assert_eq!(stored.channel_id, "ch1");
        assert_eq!(stored.project_id, "pr1");
        assert_eq!(stored.author_id, "pa");
    }

    #[test]
    fn deleting_is_the_authors_alone() {
        let c = fixture();
        let note = create_channel_note_on(&c, input("status", "temporary", "pa")).unwrap();
        let refused = delete_channel_note_on(&c, note.id.clone(), "pb".into()).unwrap_err();
        assert!(refused.contains("Only the author"), "{refused}");
        assert!(note_on(&c, &note.id).unwrap().is_some());
        delete_channel_note_on(&c, note.id.clone(), "pa".into()).unwrap();
        assert!(note_on(&c, &note.id).unwrap().is_none());
    }

    #[test]
    fn an_attachment_is_a_document_reference_that_outlives_the_document() {
        let c = fixture();
        c.execute("INSERT INTO documents(id,container_type,container_id,doc_type,title,version,created_at,updated_at) VALUES('d1','project','pr1','text','Spec v3',1,0,0)", []).unwrap();
        let mut with_file = input("decision", "Approved per spec", "pa");
        with_file.attachment_document_id = Some("d1".into());
        let note = create_channel_note_on(&c, with_file).unwrap();
        assert_eq!(note.attachment_document_id.as_deref(), Some("d1"));
        assert_eq!(
            note.attachment_title.as_deref(),
            Some("Spec v3"),
            "the log names its attachment"
        );

        // Deleting the file must not delete the decision that cited it.
        c.execute("DELETE FROM documents WHERE id='d1'", [])
            .unwrap();
        let survivor = note_on(&c, &note.id).unwrap().unwrap();
        assert_eq!(survivor.body, "Approved per spec");
        assert_eq!(survivor.attachment_document_id, None);
        assert_eq!(survivor.attachment_title, None);
    }

    #[test]
    fn a_channel_without_a_project_has_no_notes_surface() {
        let c = fixture();
        let mut loose = input("status", "nowhere", "pa");
        loose.channel_id = "ch0".into();
        let refused = create_channel_note_on(&c, loose).unwrap_err();
        assert!(refused.contains("no project"), "{refused}");
    }

    #[test]
    fn an_empty_body_is_not_an_entry() {
        let c = fixture();
        let refused = create_channel_note_on(&c, input("status", "   ", "pa")).unwrap_err();
        assert!(refused.contains("body are required"), "{refused}");
    }
}
