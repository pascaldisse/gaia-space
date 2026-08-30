// Channel Notes & Decisions — thin invoke() wrappers over src-tauri/src/channel_notes.rs.
// Standalone from ../api.ts and ./personal.ts (other lanes own those): only the types and
// calls the Notes tab needs.
import { invoke } from "@tauri-apps/api/core";

/** Two kinds, and only two. The Rust side refuses a third, so the UI never invents one. */
export type NoteKind = "decision" | "status";

/**
 * One entry in the log.
 *
 * `edited_at` is the visibility contract: `null` means the text is the original, a number
 * means the author corrected it and the log says so. There is no silent rewrite.
 *
 * `attachment_document_id` points at an EXISTING document — the log links files, it does
 * not store them. `attachment_title` is the server's read-side convenience so the entry can
 * name its attachment without a second round-trip; it is null once the document is gone,
 * while the entry itself stays.
 */
export type ChannelNote = {
  id: string;
  channel_id: string;
  project_id: string;
  kind: NoteKind;
  body: string;
  author_id: string;
  created_at: number;
  updated_at: number;
  edited_at: number | null;
  attachment_document_id: string | null;
  attachment_title: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
};

export type ChannelNoteInput = {
  id?: string;
  channel_id: string;
  kind: NoteKind;
  body: string;
  /** Rewritten to the session profile by the web transport; desktop sends the acting one. */
  author_id: string;
  attachment_document_id?: string | null;
  source_entity_type?: string | null;
  source_entity_id?: string | null;
};

export const channelNotesApi = {
  list: (channel_id: string, profile_id: string) =>
    invoke<ChannelNote[]>("list_channel_notes", { channelId: channel_id, profileId: profile_id }),
  create: (input: ChannelNoteInput) => invoke<ChannelNote>("create_channel_note", { input }),
  update: (note: ChannelNote) => invoke<ChannelNote>("update_channel_note", { note }),
  remove: (id: string, profile_id: string) =>
    invoke<void>("delete_channel_note", { id, profileId: profile_id }),
};
