import { For, Show, createResource, createSignal, type JSX } from "solid-js";
import { channelNotesApi, type ChannelNote, type NoteKind } from "../api/channel-notes";
import { documentsApi, type Document } from "../api/documents";
import { profiles } from "../session";
import { UI_LOCALE } from "../calendar";
import { GhostPill, PillSelect } from "./controls";
import EmptyState from "./EmptyState";
import SourceLink from "./SourceLink";
import "./NotesLog.css";

/** ── NOTES & DECISIONS: A LOG, NOT A DOCUMENT ───────────────────────────────
 *
 *  A document is edited — the current text replaces the last one and the reason a thing
 *  changed vanishes with the words that said it. A log GROWS. "Where do we stand right
 *  now" is answered by the head of a readable history, not by a paragraph somebody
 *  rewrote on Tuesday. So: newest first, nothing overwritten silently, and an author's
 *  correction is stamped "edited" in the open.
 *
 *  THE COMPOSER IS NOT A DRAWER. It sits at the top, always visible, small. Same
 *  reasoning that kept the to-do composer on its page: this is a CAPTURE surface, and a
 *  capture surface that costs a click to open is a capture surface people stop using.
 *
 *  COLOUR (statusTone.ts law): teal = open/action, amber = due soon, red = critical.
 *  A note's KIND is none of those three facts — a decision is not "urgent" and a status
 *  update is not "open work" — so the kind pill takes NO tone from that vocabulary. The
 *  two kinds are told apart by WEIGHT instead: a decision is a filled ink pill (it is a
 *  settled fact), a status is a quiet outline pill (it is a reading of the moment). That
 *  is legible at a glance and it shouts at nobody. The entry count likewise carries no
 *  colour, and is not drawn at all at zero.
 *
 *  ATTACHMENTS ARE LINKS TO DOCUMENTS. The bytes live in the project's document tree —
 *  the very thing the channel's "Files & Links" tab renders. A second blob store beside
 *  it would fork file access, versions and permissions, so this surface points instead of
 *  copying. See src-tauri/src/channel_notes.rs for the full argument.
 */

const KINDS: { key: NoteKind; label: string }[] = [
  { key: "decision", label: "Decision" },
  { key: "status", label: "Status" },
];
const kindLabel = (kind: string) => KINDS.find((k) => k.key === kind)?.label ?? kind;

// Relative in the log, absolute on hover — the exact moment stays one tooltip away.
const relativeTime = (seconds: number) => {
  const elapsed = Math.floor(Date.now() / 1000) - seconds;
  if (elapsed < 45) return "just now";
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(seconds * 1000).toLocaleDateString(UI_LOCALE, { month: "short", day: "numeric" });
};
const timestamp = (seconds: number) => new Date(seconds * 1000).toLocaleString(UI_LOCALE);

export default function NotesLog(props: {
  /** The channel whose log this is. */
  channelId: string;
  /** Inherited from the channel — this surface never asks for a project. */
  projectId: string;
  /** The acting profile: author of what is written here, and the only person who may
   *  edit or delete their own entries. */
  authorId: string;
}): JSX.Element {
  const [notes, { refetch }] = createResource(
    () => [props.channelId, props.authorId] as const,
    ([channelId, authorId]) =>
      channelId && authorId ? channelNotesApi.list(channelId, authorId) : Promise.resolve([]),
  );
  // The attach picker offers this project's documents only. A note cannot link a file
  // the channel's own Files tab would not show.
  const [documents] = createResource(
    () => props.projectId,
    async (projectId) => {
      if (!projectId) return [] as Document[];
      const all = await documentsApi.listDocuments().catch(() => [] as Document[]);
      return all.filter((d) => d.container_type === "project" && d.container_id === projectId && !d.archived);
    },
  );

  const [kind, setKind] = createSignal<NoteKind>("status");
  const [body, setBody] = createSignal("");
  const [attachment, setAttachment] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Editing happens IN PLACE on the entry, so the log never loses its position and the
  // reader can see what is being corrected while it is corrected.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editBody, setEditBody] = createSignal("");

  const authorName = (id: string) =>
    profiles()?.find((p) => p.id === id)?.display_name ?? id;

  const count = () => notes()?.length ?? 0;

  const submit = async () => {
    const text = body().trim();
    if (!text || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await channelNotesApi.create({
        channel_id: props.channelId,
        kind: kind(),
        body: text,
        author_id: props.authorId,
        attachment_document_id: attachment() || null,
      });
      setBody("");
      setAttachment("");
      await refetch();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (note: ChannelNote) => {
    const text = editBody().trim();
    if (!text) return;
    setError(null);
    try {
      await channelNotesApi.update({ ...note, body: text });
      setEditingId(null);
      await refetch();
    } catch (reason) {
      setError(String(reason));
    }
  };

  const remove = async (note: ChannelNote) => {
    setError(null);
    try {
      await channelNotesApi.remove(note.id, props.authorId);
      await refetch();
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <section class="notes-log" aria-label="Notes and decisions">
      {/* ── the capture surface ─────────────────────────────────────────────── */}
      <form
        class="notes-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="notes-compose-kind" role="group" aria-label="Entry kind">
          <For each={KINDS}>
            {(entry) => (
              <button
                type="button"
                class="notes-kind-choice"
                classList={{ active: kind() === entry.key }}
                aria-pressed={kind() === entry.key}
                onClick={() => setKind(entry.key)}
              >
                {entry.label}
              </button>
            )}
          </For>
        </div>
        <textarea
          class="notes-compose-body"
          rows="2"
          placeholder={kind() === "decision" ? "What was decided?" : "Where do we stand?"}
          aria-label="Entry text"
          value={body()}
          onInput={(event) => setBody(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter writes, Shift+Enter breaks the line: a capture box behaves like the
            // message box next door, because that is where the muscle memory comes from.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div class="notes-compose-foot">
          {/* An attachment is a LINK to a project document, never a new upload path. */}
          <Show
            when={(documents()?.length ?? 0) > 0}
            fallback={<span class="notes-compose-hint">Files live in this project's documents.</span>}
          >
            <PillSelect
              label="Attach a document"
              value={attachment()}
              onChange={setAttachment}
              class="notes-attach"
            >
              <option value="">No document</option>
              <For each={documents()}>{(doc) => <option value={doc.id}>{doc.title}</option>}</For>
            </PillSelect>
          </Show>
          <button type="submit" class="primary" disabled={!body().trim() || busy()}>
            {busy() ? "Adding…" : "Add entry"}
          </button>
        </div>
      </form>

      <Show when={error()}>
        {(reason) => (
          <p class="notes-error" role="alert">
            {reason()}
          </p>
        )}
      </Show>

      {/* ── the log ─────────────────────────────────────────────────────────── */}
      <Show when={count() > 0}>
        <p class="paper-section-label notes-log-label">
          {count()} {count() === 1 ? "entry" : "entries"} · newest first
        </p>
      </Show>

      <Show when={!notes.loading && count() === 0}>
        <EmptyState
          title="Nothing logged yet"
          hint="Write the first decision or status above — it stays here, in order, for everyone in this project."
        />
      </Show>

      <ol class="notes-entries">
        <For each={notes()}>
          {(note) => (
            <li class="notes-entry">
              <div class="notes-entry-head">
                <span class="notes-kind" classList={{ decision: note.kind === "decision" }}>
                  {kindLabel(note.kind)}
                </span>
                <span class="notes-author">{authorName(note.author_id)}</span>
                <span class="notes-time" title={timestamp(note.created_at)}>
                  {relativeTime(note.created_at)}
                </span>
                {/* The edit is never silent: the log says so, and says when. */}
                <Show when={note.edited_at}>
                  {(at) => (
                    <span class="notes-edited" title={timestamp(at())}>
                      edited
                    </span>
                  )}
                </Show>
              </div>

              <Show
                when={editingId() === note.id}
                fallback={<p class="notes-body">{note.body}</p>}
              >
                <div class="notes-edit">
                  <textarea
                    class="notes-compose-body"
                    rows="2"
                    aria-label="Edit entry text"
                    value={editBody()}
                    onInput={(event) => setEditBody(event.currentTarget.value)}
                  />
                  <div class="notes-entry-actions">
                    <button type="button" class="primary" onClick={() => void saveEdit(note)}>
                      Save
                    </button>
                    <GhostPill onClick={() => setEditingId(null)}>Cancel</GhostPill>
                  </div>
                </div>
              </Show>

              <div class="notes-entry-foot">
                <Show when={note.attachment_document_id && note.attachment_title}>
                  <span class="notes-attachment" title="Document in this project">
                    📎 {note.attachment_title}
                  </span>
                </Show>
                {/* An anchor with no target still says where the entry came from. */}
                <Show when={note.source_entity_type && note.source_entity_id}>
                  <SourceLink
                    entityType={note.source_entity_type!}
                    entityId={note.source_entity_id!}
                    label="From a message"
                  />
                </Show>
                {/* Only the author edits or removes their own words. */}
                <Show when={note.author_id === props.authorId && editingId() !== note.id}>
                  <span class="notes-own-actions">
                    <GhostPill
                      onClick={() => {
                        setEditBody(note.body);
                        setEditingId(note.id);
                      }}
                    >
                      Edit
                    </GhostPill>
                    <GhostPill onClick={() => void remove(note)}>Delete</GhostPill>
                  </span>
                </Show>
              </div>
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}
