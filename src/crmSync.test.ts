import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// The invoke layer is the ONLY thing stubbed: the sync engine below runs its real
// diffing, its real `normalize()` pass and its real migration decision, and the calls
// asserted here are the ones the Rust commands will actually receive
// (§docs/specs/crm-server-store.md — the commands do not exist at runtime yet).
type Call = { cmd: string; args: any };
const calls: Call[] = [];
let handler: (cmd: string, args: any) => Promise<any> = () => Promise.reject(new Error("no server"));
mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => { calls.push({ cmd, args }); return handler(cmd, args); },
}));

import { isEmptySnapshot, type CrmSnapshot } from "./api/crm";
import {
  CRM_MIGRATED_KEY, CRM_STORAGE_KEY, countRecords, createCrmSync, crmWriteFor, snapshotToCrmData,
  type CrmSyncState,
} from "./crmSync";
import { emptyActivity, emptyDeal, emptyOrganization, normalize, type CrmData } from "./crmStore";

const snapshot = (parts: Partial<CrmSnapshot> = {}): CrmSnapshot =>
  ({ organizations: [], deals: [], activities: [], labels: [], stages: [], revision: 0, ...parts });

const fixture = (): CrmData => {
  const org = { ...emptyOrganization("Optik Nord", "Jannes"), id: "org-1" };
  const deal = { ...emptyDeal("org-1", "Optik Nord"), id: "deal-1", value: "12.000" };
  const inbox = { ...emptyActivity({ title: "Rückruf" }), id: "activity-1" };
  return normalize({ version: 2, organizations: [org], deals: [deal], activities: [inbox], labels: [], pipelineStages: [] });
};
const asSnapshot = (data: CrmData, revision = 1): CrmSnapshot => snapshot({
  organizations: data.organizations as any, deals: data.deals as any, activities: data.activities as any,
  labels: data.labels as any, stages: data.pipelineStages as any, revision,
});

const track = () => {
  const applied: CrmData[] = [];
  const states: CrmSyncState[] = [];
  const sync = createCrmSync({ apply: data => applied.push(data), onState: state => states.push({ ...state }) });
  return { applied, states, sync, last: () => states[states.length - 1] };
};

beforeEach(() => { calls.length = 0; localStorage.clear(); handler = () => Promise.reject(new Error("no server")); });
// The module mock is GLOBAL to the test process: a handler left behind would answer
// another suite's CRM mount with this file's fixture. Reset to the real-world default
// (no Tauri host -> the call rejects).
afterEach(() => { localStorage.clear(); handler = () => Promise.reject(new Error("no server")); });

test("a snapshot becomes the CrmData the app already knows, through the one normalize()", () => {
  const data = fixture();
  const round = snapshotToCrmData(asSnapshot(data));
  expect(round).toEqual(normalize(data));
  expect(round.organizations.map(org => org.id)).toEqual(["org-1"]);
  expect(round.deals[0]!.value).toBe("12.000");
  expect(round.activities.map(activity => activity.title)).toEqual(["Rückruf"]);
  // An empty store is an EMPTY CRM, never the seed: a shared CRM nobody filled yet is
  // a fact, and inventing example records would write them into everyone's pipeline.
  expect(countRecords(snapshotToCrmData(snapshot()))).toBe(0);
  expect(isEmptySnapshot(snapshot())).toBe(true);
  expect(isEmptySnapshot(asSnapshot(data))).toBe(false);
});

test("a mutation writes ONLY the records it touched", async () => {
  const before = fixture();
  handler = async (cmd) => cmd === "crm_snapshot" ? asSnapshot(before, 5) : { revision: 6 };
  const { sync } = track();
  await sync.start();
  calls.length = 0;

  const after = structuredClone(before);
  after.deals[0]!.stage = "Angebot erstellt";
  await sync.persist(after);

  const put = calls.filter(call => call.cmd === "crm_put_records");
  expect(put).toHaveLength(1);
  expect(Object.keys(put[0]!.args)).toEqual(["deals"]);
  expect(put[0]!.args.deals.map((deal: any) => deal.id)).toEqual(["deal-1"]);
  expect(calls.some(call => call.cmd === "crm_purge_records")).toBe(false);
  expect(sync.state().status).toBe("online");
  expect(sync.state().revision).toBe(6);

  // Persisting an unchanged document is not a write at all.
  calls.length = 0;
  await sync.persist(structuredClone(after));
  expect(calls).toHaveLength(0);
});

test("a purge names the removed ids, and labels/stages travel as whole lists", () => {
  const before = fixture();
  const after = structuredClone(before);
  after.deals = [];
  after.labels = [...after.labels, { id: "label-x", name: "Neu", color: "#00C2A8" }];
  after.pipelineStages[0]!.probability = 15;
  const write = crmWriteFor(before, after);
  expect(write.purge).toEqual({ dealIds: ["deal-1"] });
  expect(write.put.labels).toHaveLength(after.labels.length);
  expect(write.put.stages).toHaveLength(after.pipelineStages.length);
  expect(write.put.organizations).toBeUndefined();
  expect(write.put.deals).toBeUndefined();
});

test("polling with an unchanged revision does not re-render", async () => {
  const data = fixture();
  handler = async () => asSnapshot(data, 7);
  const { applied, sync } = track();
  await sync.start();
  expect(applied).toHaveLength(1);
  await sync.poll();
  await sync.poll();
  expect(applied).toHaveLength(1);
  expect(calls.filter(call => call.cmd === "crm_snapshot")).toHaveLength(3);

  // A newer revision — somebody else wrote — IS adopted.
  const next = structuredClone(data);
  next.deals[0]!.title = "Optik Nord · Filiale";
  handler = async () => asSnapshot(next, 8);
  await sync.poll();
  expect(applied).toHaveLength(2);
  expect(applied[1]!.deals[0]!.title).toBe("Optik Nord · Filiale");
});

test("local data is offered once, uploaded only on the explicit choice, and the key is renamed", async () => {
  const local = fixture();
  localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(local));
  handler = async (cmd) => cmd === "crm_snapshot" ? snapshot() : { revision: 42 };
  const { applied, sync } = track();

  await sync.start();
  // Offered, NOT performed: nothing was written and the count is stated.
  expect(sync.state().status).toBe("migration");
  expect(sync.state().localRecords).toBe(countRecords(local));
  expect(calls.some(call => call.cmd === "crm_put_records")).toBe(false);
  expect(applied).toHaveLength(0);

  await sync.migrate();
  const put = calls.filter(call => call.cmd === "crm_put_records");
  expect(put).toHaveLength(1);
  expect(put[0]!.args.organizations.map((org: any) => org.id)).toEqual(["org-1"]);
  expect(put[0]!.args.deals.map((deal: any) => deal.id)).toEqual(["deal-1"]);
  expect(sync.state().status).toBe("online");
  expect(sync.state().revision).toBe(42);
  expect(localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  expect(JSON.parse(localStorage.getItem(CRM_MIGRATED_KEY)!).deals[0].id).toBe("deal-1");

  // Runs ONCE: the renamed key is also the "already decided" flag, so a mirror written
  // afterwards cannot make the offer reappear.
  localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(local));
  const second = track();
  await second.sync.start();
  expect(second.sync.state().status).toBe("online");
  expect(second.sync.state().localRecords).toBe(0);
});

test("a non-empty server is never overwritten by the local document", async () => {
  const local = fixture();
  const server = structuredClone(local);
  server.deals[0]!.title = "Server gewinnt";
  localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(local));
  handler = async (cmd) => cmd === "crm_snapshot" ? asSnapshot(server, 3) : { revision: 4 };
  const { applied, sync } = track();

  await sync.start();
  expect(sync.state().status).toBe("online");
  expect(applied[0]!.deals[0]!.title).toBe("Server gewinnt");
  expect(calls.some(call => call.cmd === "crm_put_records")).toBe(false);

  // Even asked directly — the offer could have been made a minute before somebody else
  // filled the CRM — the upload refuses and adopts the shared document instead.
  calls.length = 0;
  await sync.migrate();
  expect(calls.some(call => call.cmd === "crm_put_records")).toBe(false);
  expect(localStorage.getItem(CRM_STORAGE_KEY)).not.toBeNull();
});

test("an unreachable server is stated, never turned into an empty CRM or a lost edit", async () => {
  handler = () => Promise.reject(new Error("could not connect"));
  const { applied, sync } = track();
  await sync.start();
  expect(sync.state().status).toBe("offline");
  expect(sync.state().error).toContain("could not connect");
  // Nothing was applied, so the view keeps showing the last known document.
  expect(applied).toHaveLength(0);

  // An edit while offline is NOT sent and NOT silently accepted: it is counted and said.
  const edited = fixture();
  await sync.persist(edited);
  expect(sync.state().status).toBe("offline");
  expect(sync.state().pending).toBe(countRecords(edited));
  expect(calls.some(call => call.cmd === "crm_put_records")).toBe(false);
});

test("an edit that fails mid-flight stays pending and is written on the next poll", async () => {
  const data = fixture();
  handler = async (cmd) => cmd === "crm_snapshot" ? asSnapshot(data, 9) : { revision: 10 };
  const { sync } = track();
  await sync.start();

  handler = async (cmd) => cmd === "crm_snapshot" ? asSnapshot(data, 9) : Promise.reject(new Error("socket closed"));
  const edited = structuredClone(data);
  edited.organizations[0]!.owner = "Bjarne";
  await sync.persist(edited);
  expect(sync.state().status).toBe("offline");
  expect(sync.state().pending).toBe(1);

  handler = async (cmd) => cmd === "crm_snapshot" ? asSnapshot(data, 9) : { revision: 11 };
  calls.length = 0;
  await sync.poll();
  const put = calls.filter(call => call.cmd === "crm_put_records");
  expect(put).toHaveLength(1);
  expect(put[0]!.args.organizations[0].owner).toBe("Bjarne");
  expect(sync.state().status).toBe("online");
  expect(sync.state().pending).toBe(0);
});
