/** ── CRM persistence: one workspace document, stored in space.db ──────────────
 *  The CRM used to live ONLY in localStorage: every browser held a different sales
 *  history, nothing was shared, and nothing was in the production backup — the one
 *  place customer data must be. The server now owns the document; localStorage keeps
 *  its role as a CACHE for first paint and for a broken connection.
 *
 *  The document is a JSON string on purpose. The CRM's shape is owned by crmStore.ts
 *  (`CrmData`, §normalize), which already migrates v1 → v2 documents on read; a second,
 *  Rust-side copy of that model would be a second thing to keep true.
 *
 *  CONCURRENCY — `revision` is the whole protocol. A save states which revision it was
 *  editing; the server refuses (`crm-conflict:<current>`) when someone else has written
 *  since. A refusal is NOT an error to swallow: the caller reloads and the user is told,
 *  because silently overwriting a colleague's afternoon is the failure this prevents. */
import { invoke } from "@tauri-apps/api/core";
import { profileId } from "../session";

export type CrmDocument = {
  /** The whole CrmData document, JSON-encoded. Empty string = nothing stored yet. */
  data: string;
  /** 0 when the workspace has never saved. Every successful save increments it. */
  revision: number;
  /** Unix millis of the last write; 0 when never written. */
  updatedAt: number;
  updatedBy: string | null;
};

/** Thrown-error prefix the server uses for a refused stale write (§save). */
export const CRM_CONFLICT = "crm-conflict:";

/** The revision the server holds, parsed out of a conflict error, or null if the
 *  failure was something else entirely (offline, permission, a real bug). */
export const conflictRevision = (reason: unknown): number | null => {
  const text = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : String(reason ?? "");
  const at = text.indexOf(CRM_CONFLICT);
  if (at < 0) return null;
  const parsed = Number.parseInt(text.slice(at + CRM_CONFLICT.length), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/** The document is workspace-wide, so `profileId` scopes nothing — it names the CALLER.
 *  The web bridge's `bind_session_identity` only REWRITES a key that is present; an
 *  omitted one is a missing argument (400), so it is always sent, even empty. */
export const crmApi = {
  get: () => invoke<CrmDocument>("get_crm_document", { profileId: profileId() ?? "" }),
  /** `baseRevision` is the revision this data was derived from. */
  save: (data: string, baseRevision: number) =>
    invoke<CrmDocument>("save_crm_document", { data, baseRevision, profileId: profileId() ?? "" }),
};
