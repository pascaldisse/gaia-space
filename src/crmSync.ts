/** ── CRM sync: the browser cache stops being the system of record ─────────────
 *  Before this module the CRM existed ONLY in localStorage. Two people had two
 *  different sales histories, a cleared browser profile destroyed the pipeline, and
 *  nothing of it reached the nightly backup — the one place customer data must be.
 *
 *  The server (§api/crm.ts → space.db `crm_documents`) now holds the document. This
 *  module is the whole traffic between them, and it is deliberately small:
 *
 *    pull()  ─ server wins when it HAS something. When the workspace has never saved
 *              and this browser still carries a document, that document is ADOPTED
 *              (pushed up) instead of being discarded — the migration of existing
 *              prototype data is a normal first pull, not a separate ritual.
 *    push()  ─ writes the cache FIRST (so an offline browser keeps working exactly as
 *              it did), then states the revision it edited. A refused stale write is
 *              reported, never swallowed: overwriting a colleague's afternoon silently
 *              is the single failure this protocol exists to prevent.
 *
 *  The transport is injected so the protocol is testable without a server or a Tauri
 *  runtime; `crmSync` is the one instance the app uses. */
import { conflictRevision, crmApi, type CrmDocument } from "./api/crm";
import { loadCrm, normalize, saveCrm, storedCrm, type CrmData } from "./crmStore";

export type CrmTransport = {
  get(): Promise<CrmDocument>;
  save(data: string, baseRevision: number): Promise<CrmDocument>;
};
/** `stored` answers "did this browser ever write a document" (null = never), which is
 *  what decides adoption; `load` always yields something renderable. */
export type CrmCache = { load(): CrmData; save(data: CrmData): void; stored(): CrmData | null };

/** Where the document the caller is now holding came from. The view SAYS this — a user
 *  who is editing a local-only copy has a right to know before typing for an hour. */
export type PullSource =
  | "server"          // the workspace document, as stored
  | "adopted"         // this browser's document became the workspace document
  | "empty"           // nothing anywhere yet: a fresh seed
  | "offline";        // server unreachable — the cache, unsynced
export type PullResult = { data: CrmData; source: PullSource; revision: number };

export type PushOutcome =
  | { status: "saved"; revision: number }
  /** Someone else wrote since this document was read. The caller must pull and tell
   *  the user; the local edit is still in the cache and is not lost. */
  | { status: "conflict"; revision: number }
  /** No server (offline, or a desktop build without the command). Cache holds. */
  | { status: "offline"; reason: string };

export function createCrmSync(transport: CrmTransport = crmApi, cache: CrmCache = { load: loadCrm, save: saveCrm, stored: storedCrm }) {
  /** The revision the document in hand was derived from. 0 = never saved anywhere. */
  let revision = 0;
  /** Set once a pull or push has proven the server answers. Until then a push is still
   *  attempted — a first write must not be blocked by never having read. */
  let seen = false;

  const pull = async (): Promise<PullResult> => {
    let document: CrmDocument;
    try {
      document = await transport.get();
      seen = true;
    } catch {
      return { data: cache.load(), source: "offline", revision };
    }
    if (document.revision > 0 && document.data) {
      let parsed: CrmData;
      try {
        parsed = normalize(JSON.parse(document.data));
      } catch {
        // A stored document that will not parse is a server-side defect; refusing to
        // render is worse than rendering the cache and saying it is unsynced.
        return { data: cache.load(), source: "offline", revision };
      }
      revision = document.revision;
      cache.save(parsed);
      return { data: parsed, source: "server", revision };
    }
    // Server empty. Only a document this browser ACTUALLY WROTE may claim the
    // workspace — the demo seed a first-time visitor renders must not become the
    // company's CRM just because they opened the page first.
    revision = document.revision;
    const stored = cache.stored();
    if (!stored) return { data: cache.load(), source: "empty", revision };
    const pushed = await push(stored);
    return { data: stored, source: pushed.status === "saved" ? "adopted" : "offline", revision };
  };

  const push = async (data: CrmData): Promise<PushOutcome> => {
    cache.save(data);
    try {
      const saved = await transport.save(JSON.stringify(data), revision);
      revision = saved.revision;
      seen = true;
      return { status: "saved", revision };
    } catch (reason) {
      const theirs = conflictRevision(reason);
      if (theirs !== null) return { status: "conflict", revision: theirs };
      return { status: "offline", reason: String(reason) };
    }
  };

  /** Deliberate overwrite after a conflict: adopt the server's current revision, then
   *  write. The user has been TOLD what they are about to replace — this is never
   *  reached automatically, only from the banner's explicit "keep mine" action. */
  const overwrite = async (data: CrmData): Promise<PushOutcome> => {
    try {
      revision = (await transport.get()).revision;
    } catch (reason) {
      cache.save(data);
      return { status: "offline", reason: String(reason) };
    }
    return push(data);
  };

  return {
    pull,
    push,
    overwrite,
    /** The revision currently held — for tests and for the view's status line. */
    revision: () => revision,
    /** True once the server has answered at least once in this session. */
    online: () => seen,
  };
}

export const crmSync = createCrmSync();
