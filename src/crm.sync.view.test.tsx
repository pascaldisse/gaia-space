import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// Rendered-DOM proof that the CRM is a SHARED, server-held document: the view adopts
// the server snapshot, writes only touched records back, states an unreachable server
// instead of showing an empty pipeline, and offers the one-time upload of local data
// with its record count. Only the invoke transport is stubbed.
type Call = { cmd: string; args: any };
const calls: Call[] = [];
let handler: (cmd: string, args: any) => Promise<any> = () => Promise.reject(new Error("no server"));
mock.module("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => { calls.push({ cmd, args }); return handler(cmd, args); },
}));

import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { CRM_MIGRATED_KEY, CRM_STORAGE_KEY } from "./crmSync";
import { emptyDeal, emptyOrganization, normalize, type CrmData } from "./crmStore";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "./router";

const document2 = (title: string): CrmData => normalize({
  version: 2,
  organizations: [{ ...emptyOrganization("Optik Nord", "Jannes"), id: "org-1", leadState: "converted" }],
  deals: [{ ...emptyDeal("org-1", title), id: "deal-1", stage: "Qualified", value: "12.000" }],
  activities: [], labels: [], pipelineStages: [],
});
const asSnapshot = (data: CrmData, revision: number) => ({
  organizations: data.organizations, deals: data.deals, activities: data.activities,
  labels: data.labels, stages: data.pipelineStages, revision,
});

let dispose: (() => void) | undefined;
const settle = (ms = 20) => new Promise(done => setTimeout(done, ms));
const banner = (host: HTMLElement) => host.querySelector<HTMLElement>(".crm-sync-banner");

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  handler = () => Promise.reject(new Error("no server"));
  registerViews(["Dashboard", "CRM"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("crm/pipeline"));
});
// The module mock is GLOBAL: leaving a handler behind would answer another suite's
// CRM mount with this file's snapshot, so it is reset to the no-host default.
afterEach(() => {
  dispose?.(); dispose = undefined; window.document.body.innerHTML = ""; localStorage.clear();
  handler = () => Promise.reject(new Error("no server"));
});

function mount() {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}

test("the board renders the SERVER's CRM, not this browser's", async () => {
  handler = async () => asSnapshot(document2("Vom Server"), 4);
  const host = mount();
  await settle();
  expect(host.textContent).toContain("Vom Server");
  expect(banner(host)).toBeNull();
  expect(calls[0]!.cmd).toBe("crm_snapshot");
});

test("a card moved on the board writes only that deal back", async () => {
  handler = async (cmd) => cmd === "crm_snapshot" ? asSnapshot(document2("Optik Nord"), 4) : { revision: 5 };
  const host = mount();
  await settle();
  calls.length = 0;

  // The stage change through the view's own mutation path (the drop handler calls the
  // same `moveDeal`); the assertion is about what leaves the client.
  const card = host.querySelector<HTMLElement>(".crm-card");
  expect(card).not.toBeNull();
  const column = host.querySelectorAll<HTMLElement>("[data-crm-stage]")[3]!;
  card!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
  window.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
  const realElementFromPoint = window.document.elementFromPoint;
  (window.document as any).elementFromPoint = () => column;
  window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 200 }));
  (window.document as any).elementFromPoint = realElementFromPoint;
  await settle();

  const put = calls.filter(call => call.cmd === "crm_put_records");
  expect(put).toHaveLength(1);
  expect(Object.keys(put[0]!.args)).toEqual(["deals"]);
  expect(put[0]!.args.deals).toHaveLength(1);
  expect(put[0]!.args.deals[0].id).toBe("deal-1");
});

test("an unreachable server is SAID, and the last known CRM stays on screen", async () => {
  localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(document2("Zuletzt bekannt")));
  handler = () => Promise.reject(new Error("could not connect"));
  const host = mount();
  await settle();
  const alert = banner(host);
  expect(alert).not.toBeNull();
  expect(alert!.dataset.syncStatus).toBe("offline");
  expect(alert!.textContent).toContain("Server nicht erreichbar");
  expect(alert!.textContent).toContain("could not connect");
  // NOT an empty CRM: the deal the last session saw is still rendered.
  expect(host.textContent).toContain("Zuletzt bekannt");
  expect(calls.some(call => call.cmd === "crm_put_records")).toBe(false);
});

test("local data is offered for upload with its record count, and never sent without the click", async () => {
  localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(document2("Lokaler Deal")));
  handler = async (cmd) => cmd === "crm_snapshot"
    ? { organizations: [], deals: [], activities: [], labels: [], stages: [], revision: 0 }
    : { revision: 12 };
  const host = mount();
  await settle();
  const alert = banner(host);
  expect(alert!.dataset.syncStatus).toBe("migration");
  expect(alert!.textContent).toContain("2");
  expect(calls.some(call => call.cmd === "crm_put_records")).toBe(false);

  const upload = [...alert!.querySelectorAll("button")].find(button => button.textContent?.includes("hochladen"))!;
  upload.click();
  await settle();
  const put = calls.filter(call => call.cmd === "crm_put_records");
  expect(put).toHaveLength(1);
  expect(put[0]!.args.deals[0].id).toBe("deal-1");
  // The uploaded document is KEPT under the renamed key — a backup nobody asked for is
  // better than a hole — and that key is also the "decided" flag, so the mirror the view
  // keeps writing under the live key can never make the offer reappear.
  expect(JSON.parse(localStorage.getItem(CRM_MIGRATED_KEY)!).deals[0].id).toBe("deal-1");
  expect(banner(host)).toBeNull();
});
