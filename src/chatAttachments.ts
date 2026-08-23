/**
 * The composer's two attachment decisions, kept out of the view so they can be tested
 * without a DOM: which pending files are actually sendable, and whether a draft is
 * worth posting at all.
 *
 * A chip with no `data_url` never produced a payload (too large, unreadable, rejected
 * by the reader). It exists to show the user why, and must never reach the backend nor
 * cause an empty message to be posted in its name.
 */
export type UploadableAttachment = { id: string; data_url: string };

export function uploadableAttachments<T extends UploadableAttachment>(attachments: T[]): T[] {
  return attachments.filter((attachment) => attachment.data_url !== "");
}

/** A draft is postable when it carries text, or at least one readable attachment. */
export function canSendDraft(text: string, attachments: UploadableAttachment[]): boolean {
  return text.trim().length > 0 || uploadableAttachments(attachments).length > 0;
}