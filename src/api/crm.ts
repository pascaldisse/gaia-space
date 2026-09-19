import { invoke } from "@tauri-apps/api/core";

/** ── The shared CRM store (§docs/specs/crm-server-store.md) ───────────────────
 *  ONE CRM for the whole space, held by the server, identical on desktop and web.
 *  Storage is a ROW PER RECORD, never one document: a write names only the records it
 *  touched, so two people editing two different deals cannot revert each other.
 *
 *  The server does not re-model a record. `payload_json` is the client record verbatim
 *  (`Organization` | `Deal` | `Activity` from `crmStore.ts`), and `normalize()` on the
 *  client stays the single place that decides what a valid record is. The server owns
 *  identity, time and access — nothing else. */

/** A record as it travels: the client shape, unread by the server. */
export type CrmRecordJson = Record<string, unknown>;

/** `revision` = MAX(updated_at) over the CRM tables, `0` when empty. It exists so a
 *  poller can skip a redundant re-render — it is NOT a lock and grants no exclusivity. */
export type CrmSnapshot = {
  organizations: CrmRecordJson[];
  deals: CrmRecordJson[];
  activities: CrmRecordJson[];
  labels: CrmRecordJson[];
  stages: CrmRecordJson[];
  revision: number;
};

/** Upsert by `id`; a list that is absent is UNTOUCHED, an absent record is untouched.
 *  `labels`/`stages` are whole lists — small shared config, one settings row each. */
export type CrmPutRecords = {
  organizations?: CrmRecordJson[];
  deals?: CrmRecordJson[];
  activities?: CrmRecordJson[];
  labels?: CrmRecordJson[];
  stages?: CrmRecordJson[];
};

/** The hard delete. Soft delete (`deletedAt`) lives INSIDE the payload — the trash is
 *  client logic, and only emptying it removes a row. */
export type CrmPurgeRecords = {
  organizationIds?: string[];
  dealIds?: string[];
  activityIds?: string[];
};

export type CrmRevision = { revision: number };

/** Every authenticated member may read and write the whole CRM; there is no owner
 *  filter and no admin gate, because that is the requirement — a UI that pretended
 *  otherwise would be lying about what the server does. */
export const crmApi = {
  snapshot: () => invoke<CrmSnapshot>("crm_snapshot"),
  putRecords: (records: CrmPutRecords) => invoke<CrmRevision>("crm_put_records", records as Record<string, unknown>),
  purgeRecords: (ids: CrmPurgeRecords) => invoke<CrmRevision>("crm_purge_records", ids as Record<string, unknown>),
};

export const emptySnapshot = (): CrmSnapshot =>
  ({ organizations: [], deals: [], activities: [], labels: [], stages: [], revision: 0 });

/** "The server holds no CRM yet" — asked of the RECORDS, never of `revision` alone,
 *  so a store that only ever held a stage rename is not mistaken for a fresh one. */
export const isEmptySnapshot = (snapshot: CrmSnapshot): boolean =>
  !snapshot.organizations?.length && !snapshot.deals?.length && !snapshot.activities?.length
  && !snapshot.labels?.length && !snapshot.stages?.length;
