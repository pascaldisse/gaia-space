import { crmApi, isEmptySnapshot, type CrmPurgeRecords, type CrmPutRecords, type CrmRecordJson, type CrmSnapshot } from "./api/crm";
import { CRM_STORAGE_KEY, normalize, type Activity, type CrmData, type Deal, type Organization } from "./crmStore";

/** ── CRM persistence: the server is the document, the browser is a mirror ─────
 *
 *  Before this module the CRM lived in `localStorage`, which meant ONE CRM PER BROWSER:
 *  Jannes, Bjarne, Charles and Pascal each saw a different pipeline and none of them
 *  could know it. The document now lives on the server (§docs/specs/crm-server-store.md)
 *  and every member reads and writes all of it.
 *
 *  Three rules this layer keeps:
 *    · `normalize()` stays the ONLY judge of what a valid record is — a snapshot is
 *      assembled into the existing `CrmData` shape and pushed through it, never parsed
 *      a second time here;
 *    · a write names ONLY the records it touched, so saving a note cannot revert
 *      somebody else's deal;
 *    · a failure is SAID, never swallowed: an unreachable server shows the last known
 *      document with a banner stating that edits are not saved — it never shows an
 *      empty CRM and never drops an edit silently. */

export { CRM_STORAGE_KEY };
/** The local document is RENAMED after a successful upload, never deleted: a backup
 *  nobody asked for is still better than a hole. Its presence is also the "already
 *  decided" FLAG, and that is load-bearing: the view keeps writing the live key as a
 *  local mirror (§crmStore.saveCrm), so "the key exists" alone would offer the upload
 *  again on every reload. */
export const CRM_MIGRATED_KEY = `${CRM_STORAGE_KEY}.migrated`;

const json = (value: unknown) => JSON.stringify(value);
const sameJson = (a: unknown, b: unknown) => json(a) === json(b);

/** A snapshot read as the document the app already knows. The server hands back the
 *  payloads verbatim, so this is an assembly, not a parse: `normalize` decides. */
export const snapshotToCrmData = (snapshot: CrmSnapshot): CrmData => normalize({
  version: 2,
  organizations: snapshot.organizations ?? [],
  deals: snapshot.deals ?? [],
  activities: snapshot.activities ?? [],
  labels: snapshot.labels ?? [],
  pipelineStages: snapshot.stages ?? [],
});

/** The reverse direction, used by the one-time upload: the whole document as records. */
export const crmDataToPut = (data: CrmData): CrmPutRecords => ({
  organizations: data.organizations as unknown as CrmRecordJson[],
  deals: data.deals as unknown as CrmRecordJson[],
  activities: (data.activities ?? []) as unknown as CrmRecordJson[],
  labels: data.labels as unknown as CrmRecordJson[],
  stages: data.pipelineStages as unknown as CrmRecordJson[],
});

export const countRecords = (data: CrmData): number =>
  data.organizations.length + data.deals.length + (data.activities?.length ?? 0);

/** ── What a mutation actually changed ────────────────────────────────────────
 *  Record granularity is the whole point of the store, so the diff is per id and by
 *  value: an untouched record is never sent, a changed one is sent whole, and a record
 *  that left the document is purged. An activity that belongs to a deal lives ON the
 *  deal, so it travels inside that deal's payload; the top-level list is the inbox. */
export type CrmWrite = { put: CrmPutRecords; purge: CrmPurgeRecords };

type Identified = { id: string };
const byId = <T extends Identified>(items: T[] | undefined) => new Map((items ?? []).map(item => [item.id, item]));
const changedRecords = <T extends Identified>(previous: T[] | undefined, next: T[] | undefined): T[] => {
  const before = byId(previous);
  return (next ?? []).filter(item => !sameJson(before.get(item.id), item));
};
const removedIds = <T extends Identified>(previous: T[] | undefined, next: T[] | undefined): string[] => {
  const after = byId(next);
  return (previous ?? []).filter(item => !after.has(item.id)).map(item => item.id);
};

export const crmWriteFor = (previous: CrmData, next: CrmData): CrmWrite => {
  const put: CrmPutRecords = {};
  const purge: CrmPurgeRecords = {};
  const organizations = changedRecords<Organization>(previous.organizations, next.organizations);
  const deals = changedRecords<Deal>(previous.deals, next.deals);
  const activities = changedRecords<Activity>(previous.activities, next.activities);
  if (organizations.length) put.organizations = organizations as unknown as CrmRecordJson[];
  if (deals.length) put.deals = deals as unknown as CrmRecordJson[];
  if (activities.length) put.activities = activities as unknown as CrmRecordJson[];
  // Labels and stages are whole lists: one settings row each, written only when the
  // list itself changed (a rename or a recolour), never alongside every deal edit.
  if (!sameJson(previous.labels, next.labels)) put.labels = next.labels as unknown as CrmRecordJson[];
  if (!sameJson(previous.pipelineStages, next.pipelineStages)) put.stages = next.pipelineStages as unknown as CrmRecordJson[];
  const organizationIds = removedIds<Organization>(previous.organizations, next.organizations);
  const dealIds = removedIds<Deal>(previous.deals, next.deals);
  const activityIds = removedIds<Activity>(previous.activities, next.activities);
  if (organizationIds.length) purge.organizationIds = organizationIds;
  if (dealIds.length) purge.dealIds = dealIds;
  if (activityIds.length) purge.activityIds = activityIds;
  return { put, purge };
};

export const writeSize = (write: CrmWrite): number =>
  (write.put.organizations?.length ?? 0) + (write.put.deals?.length ?? 0) + (write.put.activities?.length ?? 0)
  + (write.put.labels ? 1 : 0) + (write.put.stages ? 1 : 0)
  + (write.purge.organizationIds?.length ?? 0) + (write.purge.dealIds?.length ?? 0) + (write.purge.activityIds?.length ?? 0);
export const isEmptyWrite = (write: CrmWrite) => writeSize(write) === 0;

/** ── The state the CRM shows about its own storage ───────────────────────────
 *  `loading`   — the first snapshot is on its way.
 *  `online`    — the view holds what the server holds.
 *  `offline`   — the server refused or is unreachable. The document on screen is the
 *                last known one, and pending edits are NOT on the server. Said out loud.
 *  `migration` — the server holds no CRM and this browser does. A human decides; until
 *                then nothing is written, because a silent upload is exactly the thing
 *                the spec forbids. */
export type CrmSyncStatus = "loading" | "online" | "offline" | "migration";
export type CrmSyncState = {
  status: CrmSyncStatus;
  revision: number;
  /** Records edited here that the server has not confirmed. `0` when everything is saved. */
  pending: number;
  /** Why the server could not be reached — shown verbatim, never swallowed. */
  error: string;
  /** How many local records the migration offer would upload. Stated before the click. */
  localRecords: number;
};
export const initialSyncState = (): CrmSyncState =>
  ({ status: "loading", revision: 0, pending: 0, error: "", localRecords: 0 });

const reasonOf = (reason: unknown): string => {
  const text = String((reason as { message?: string })?.message ?? reason ?? "").trim();
  return text || "Unbekannter Fehler";
};

const readLocalDocument = (storage: Storage | undefined, key: string): CrmData | null => {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const data = normalize(JSON.parse(raw));
    return countRecords(data) ? data : null;
  } catch { return null; }
};

export type CrmSync = {
  /** First snapshot: adopt the server document, or offer the one-time upload, or say
   *  the server is unreachable. Never writes anything by itself. */
  start: () => Promise<void>;
  /** The 15 s poll (and the focus refresh). Adopts a newer revision, flushes pending
   *  edits, and does NOTHING — no re-render — when the revision is unchanged. */
  poll: () => Promise<void>;
  /** Called with every new document the view produces; persists what changed. */
  persist: (next: CrmData) => Promise<void>;
  /** The explicit, human-triggered upload of the local document. Refuses if the server
   *  meanwhile holds records: local data never overwrites a shared CRM. */
  migrate: () => Promise<void>;
  /** "Use the empty server CRM" — the other half of the migration decision. The local
   *  document is kept untouched, so nothing is lost by deciding. */
  dismissMigration: () => void;
  state: () => CrmSyncState;
};

export const createCrmSync = (options: {
  /** Hand a server document to the view. Called ONLY when the document really changed. */
  apply: (data: CrmData) => void;
  onState: (state: CrmSyncState) => void;
  storage?: Storage | undefined;
}): CrmSync => {
  const storage = options.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  let state = initialSyncState();
  /** The document as the server last confirmed it — the base every diff is taken from.
   *  `null` means "we have never spoken to the server", and in that state nothing is
   *  ever pushed: uploading a whole local document over a CRM we have not seen is the
   *  silent overwrite this design exists to prevent. */
  let baseline: CrmData | null = null;
  let current: CrmData | null = null;
  let flushing: Promise<void> | null = null;

  const set = (patch: Partial<CrmSyncState>) => { state = { ...state, ...patch }; options.onState(state); };
  const adopt = (snapshot: CrmSnapshot) => {
    const data = snapshotToCrmData(snapshot);
    baseline = data;
    current = data;
    set({ status: "online", revision: snapshot.revision ?? 0, pending: 0, error: "", localRecords: 0 });
    options.apply(data);
  };
  const offline = (reason: unknown, pending = state.pending) =>
    set({ status: "offline", error: reasonOf(reason), pending });

  const flush = async (): Promise<void> => {
    if (!baseline || !current) return;
    const write = crmWriteFor(baseline, current);
    if (isEmptyWrite(write)) { if (state.pending) set({ pending: 0 }); return; }
    const target = current;
    try {
      let revision = state.revision;
      if (Object.keys(write.put).length) revision = (await crmApi.putRecords(write.put)).revision ?? revision;
      if (Object.keys(write.purge).length) revision = (await crmApi.purgeRecords(write.purge)).revision ?? revision;
      baseline = target;
      set({ status: "online", revision, pending: 0, error: "" });
      // An edit made while the write was in flight is a second write, not a lost one.
      if (current !== target) await flush();
    } catch (reason) {
      offline(reason, writeSize(write));
    }
  };
  const queueFlush = async () => {
    // Writes are serialized: two overlapping flushes would diff against the same
    // baseline and send the same records twice.
    flushing = (flushing ?? Promise.resolve()).then(flush, flush);
    await flushing;
  };

  const start = async () => {
    let snapshot: CrmSnapshot;
    try { snapshot = await crmApi.snapshot(); }
    catch (reason) { offline(reason); return; }
    if (!isEmptySnapshot(snapshot)) { adopt(snapshot); return; }
    // The server holds no CRM. If this browser does, a human decides what happens
    // with it — and is told how many records that is.
    const local = storage?.getItem(CRM_MIGRATED_KEY) ? null : readLocalDocument(storage, CRM_STORAGE_KEY);
    if (local) { set({ status: "migration", revision: snapshot.revision ?? 0, localRecords: countRecords(local), error: "" }); return; }
    adopt(snapshot);
  };

  const migrate = async () => {
    const local = readLocalDocument(storage, CRM_STORAGE_KEY);
    if (!local) { await start(); return; }
    try {
      // Re-asked immediately before the write: between the offer and the click somebody
      // else may have filled the CRM, and local data never overwrites a shared one.
      const snapshot = await crmApi.snapshot();
      if (!isEmptySnapshot(snapshot)) { adopt(snapshot); return; }
      const revision = (await crmApi.putRecords(crmDataToPut(local))).revision ?? state.revision;
      const raw = storage?.getItem(CRM_STORAGE_KEY);
      if (raw !== null && raw !== undefined) { storage?.setItem(CRM_MIGRATED_KEY, raw); storage?.removeItem(CRM_STORAGE_KEY); }
      baseline = local;
      current = local;
      set({ status: "online", revision, pending: 0, error: "", localRecords: 0 });
      options.apply(local);
    } catch (reason) {
      offline(reason);
    }
  };

  const dismissMigration = () => {
    // The local document is KEPT (and marked as decided), so "use the empty server CRM"
    // destroys nothing and the offer does not reappear on every reload.
    const raw = storage?.getItem(CRM_STORAGE_KEY);
    if (raw) storage?.setItem(CRM_MIGRATED_KEY, raw);
    adopt({ organizations: [], deals: [], activities: [], labels: [], stages: [], revision: state.revision });
  };

  const poll = async () => {
    // A pending human decision is not a stale read; polling over it would either
    // upload silently or replace the offer with an empty CRM.
    if (state.status === "migration") return;
    let snapshot: CrmSnapshot;
    try { snapshot = await crmApi.snapshot(); }
    catch (reason) { offline(reason); return; }
    if (baseline && current && !isEmptyWrite(crmWriteFor(baseline, current))) { await queueFlush(); return; }
    // The whole reason `revision` exists: an unchanged store is not re-rendered, so a
    // poll can never dispose the row somebody is typing in.
    if (baseline && (snapshot.revision ?? 0) === state.revision) {
      if (state.status !== "online") set({ status: "online", error: "", pending: 0 });
      return;
    }
    adopt(snapshot);
  };

  const persist = async (next: CrmData) => {
    current = next;
    // During `loading` the view is still showing the local mirror and `start()` decides
    // what happens to it; during `migration` a human does. Neither writes.
    if (state.status === "loading" || state.status === "migration") return;
    if (!baseline) {
      // Never connected: the edit is in the local mirror, and the banner says plainly
      // that it is not on the server. Retrying is `start()`, offered as a button.
      offline(state.error || "Server nicht erreichbar", countRecords(next));
      return;
    }
    await queueFlush();
  };

  return { start, poll, persist, migrate, dismissMigration, state: () => state };
};
