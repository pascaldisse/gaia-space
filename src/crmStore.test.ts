import { expect, test } from "bun:test";
import {
  activitiesOf, closeDeal, convertToDeal, customers, dealProbability, dealsOf, defaultPipelineStages, ensureLabel, labelsOf,
  leads, migrateV1, moveDeal, normalize, openDeals, purge, restore, seed, setPipelineStages, softDeleteDeal,
  softDeleteOrganization, stageName, stageProbability, trash, type CrmData,
} from "./crmStore";

const v1Account = (over: Record<string, unknown> = {}) => ({
  id: "account-1", name: "Optik Nord", website: "", locationCount: 1, employees: "9", labels: ["Messe"], software: "", source: "Messe",
  owner: "Jannes", stage: "Qualified", status: "Aktiv", dealScope: "Betrieb",
  locations: [{
    id: "location-1", name: "Optik Nord · Zentrale", stage: "Qualified", status: "Aktiv", address: "Hauptstr. 1\n20095 Hamburg",
    employees: "9", emails: [], phones: [], nextStep: "Angebot senden", nextStepDate: "2026-10-01",
    contacts: [{ id: "c1", name: "Ida", role: "Inhaberin", emails: [], phones: [], preferred: "" }],
    notes: [{ id: "n1", title: "Erstkontakt", body: "Interesse an Software", author: "Jannes", createdAt: "2026-09-01T10:00:00.000Z" }],
    activities: [{ id: "a1", kind: "Anruf", title: "Rückruf", dueDate: "2026-09-20", outcome: "", done: false }],
    files: [],
  }],
  ...over,
});

test("v1 accounts migrate into separate organizations and deals", () => {
  const data = migrateV1([v1Account()]);
  expect(data.version).toBe(2);
  expect(data.organizations).toHaveLength(1);
  expect(data.deals).toHaveLength(1);
  const [org] = data.organizations;
  const [deal] = data.deals;
  expect(org.name).toBe("Optik Nord");
  expect(deal.organizationId).toBe(org.id);
  // Stage/status split: a v1 "Aktiv" account is an OPEN deal, not a stage called won.
  expect(deal.status).toBe("Offen");
  expect(deal.stage).toBe("Qualified");
  // Conversation history is deal-owned after migration, not location-owned.
  expect(deal.notes.map(note => note.title)).toEqual(["Erstkontakt"]);
  expect(deal.activities).toHaveLength(1);
  expect(org.locations[0].contacts[0].name).toBe("Ida");
  expect((org.locations[0] as Record<string, unknown>).notes).toBeUndefined();
});

test("v1 'Gewonnen' stage becomes a won status and leaves the open pipeline", () => {
  const data = migrateV1([v1Account({ stage: "Gewonnen" })]);
  expect(data.deals[0].status).toBe("Gewonnen");
  expect(data.deals[0].closedAt).not.toBeNull();
  expect(openDeals(data)).toHaveLength(0);
  expect(customers(data).map(org => org.name)).toEqual(["Optik Nord"]);
});

test("per-site v1 accounts migrate to one deal per location", () => {
  const account = v1Account({
    dealScope: "Standorte",
    locations: [
      { id: "l1", name: "Nord", stage: "Qualified", status: "Aktiv", address: "", employees: "", emails: [], phones: [], contacts: [], notes: [], activities: [], files: [] },
      { id: "l2", name: "Süd", stage: "Angebot erstellt", status: "Verloren", address: "", employees: "", emails: [], phones: [], contacts: [], notes: [], activities: [], files: [] },
    ],
  });
  const data = migrateV1([account]);
  expect(data.organizations).toHaveLength(1);
  expect(data.deals.map(deal => deal.title)).toEqual(["Nord", "Süd"]);
  expect(data.deals.map(deal => deal.status)).toEqual(["Offen", "Verloren"]);
  expect(data.deals[1].locationId).toBe("l2");
});

test("migrated labels land in the central library and are referenced by id", () => {
  const data = migrateV1([v1Account(), v1Account({ id: "account-2", name: "Optik Süd", labels: ["Messe", "Kette"] })]);
  expect(data.labels.map(label => label.name)).toEqual(expect.arrayContaining(["Kette", "Messe"]));
  const messe = data.labels.find(label => label.name === "Messe")!;
  expect(data.organizations.every(org => org.labels.includes(messe.id))).toBe(true);
  expect(labelsOf(data, data.organizations[1].labels).map(label => label.name)).toEqual(["Messe", "Kette"]);
  expect(data.labels.every(label => /^#/.test(label.color))).toBe(true);
});

test("ensureLabel is case-insensitive and never duplicates a name", () => {
  const data = seed();
  const first = ensureLabel(data, "Priorität");
  expect(ensureLabel(data, "priorität")).toBe(first);
  expect(data.labels.filter(label => label.name === "Priorität")).toHaveLength(1);
});

test("normalize accepts a v2 document, a v1 array and junk", () => {
  const v2 = seed();
  expect(normalize(JSON.parse(JSON.stringify(v2))).deals).toHaveLength(1);
  expect(normalize([v1Account()]).organizations).toHaveLength(1);
  expect(normalize(null).version).toBe(2);
  expect(normalize({ hello: "world" }).version).toBe(2);
});

test("deleting a deal keeps it discoverable in trash and restorable", () => {
  const data = seed();
  const dealId = data.deals[0].id;
  softDeleteDeal(data, dealId);
  expect(openDeals(data)).toHaveLength(0);
  expect(trash(data).deals.map(deal => deal.id)).toEqual([dealId]);
  restore(data, dealId);
  expect(openDeals(data)).toHaveLength(1);
  expect(trash(data).deals).toHaveLength(0);
});

test("deleting an organization takes its deals along and restores them together", () => {
  const data = seed();
  const orgId = data.organizations[0].id;
  softDeleteOrganization(data, orgId);
  expect(trash(data).organizations).toHaveLength(1);
  expect(trash(data).deals).toHaveLength(1);
  expect(dealsOf(data, orgId)).toHaveLength(0);
  restore(data, orgId);
  expect(dealsOf(data, orgId)).toHaveLength(1);
});

test("purge removes a record permanently with its deals", () => {
  const data = seed();
  const orgId = data.organizations[0].id;
  softDeleteOrganization(data, orgId);
  purge(data, orgId);
  expect(data.organizations).toHaveLength(0);
  expect(data.deals).toHaveLength(0);
});

test("closing and moving a deal flips status without inventing a stage", () => {
  const data = seed();
  const deal = data.deals[0];
  closeDeal(data, deal.id, "Verloren");
  expect(data.deals[0].status).toBe("Verloren");
  expect(openDeals(data)).toHaveLength(0);
  moveDeal(data, deal.id, "Angebot erstellt");
  expect(data.deals[0].status).toBe("Offen");
  expect(data.deals[0].stage).toBe("Angebot erstellt");
  expect(data.deals[0].closedAt).toBeNull();
});

test("an organization without a won deal is a lead; converting adds a deal, not a record", () => {
  const data: CrmData = { version: 2, organizations: [], deals: [], labels: [], pipelineStages: defaultPipelineStages() };
  const fresh = seed();
  data.organizations.push(fresh.organizations[0]);
  expect(leads(data)).toHaveLength(1);
  expect(customers(data)).toHaveLength(0);
  const deal = convertToDeal(data, data.organizations[0].id)!;
  expect(data.organizations).toHaveLength(1);
  expect(deal.stage).toBe("Qualified");
  closeDeal(data, deal.id, "Gewonnen");
  expect(customers(data)).toHaveLength(1);
  expect(leads(data)).toHaveLength(0);
});

test("organization activity rollup is derived from its deals", () => {
  const data = migrateV1([v1Account()]);
  const orgId = data.organizations[0].id;
  expect(activitiesOf(data, orgId).map(entry => entry.activity.title)).toEqual(["Rückruf"]);
  expect(activitiesOf(data, orgId)[0].deal.id).toBe(data.deals[0].id);
});

// ── The pipeline owns the win probability ───────────────────────────────────
test("stage defaults are the pipeline's, and a deal reads its probability from its stage", () => {
  const data = seed();
  expect(data.pipelineStages.map(stage => [stage.id, stage.probability])).toEqual([
    ["Non-Qualified", 10], ["Qualified", 20], ["Kontakt hergestellt", 30],
    ["Gespräch vereinbart", 40], ["Angebot erstellt", 50], ["Abgeschlossen", 70],
  ]);
  const deal = data.deals[0];
  expect(dealProbability(data, deal)).toBe(20);            // Qualified
  moveDeal(data, deal.id, "Angebot erstellt");
  expect(dealProbability(data, data.deals[0])).toBe(50);
  closeDeal(data, deal.id, "Gewonnen");
  expect(dealProbability(data, data.deals[0])).toBe(100);  // won is settled, not estimated
  closeDeal(data, deal.id, "Verloren");
  expect(dealProbability(data, data.deals[0])).toBe(0);
});

test("renaming a stage changes the display name only; deals keep the stable stage key", () => {
  const data = seed();
  setPipelineStages(data, data.pipelineStages.map(stage => stage.id === "Qualified" ? { ...stage, name: "Erstkontakt geprüft", probability: 35 } : stage));
  expect(data.deals[0].stage).toBe("Qualified");
  expect(stageName(data, "Qualified")).toBe("Erstkontakt geprüft");
  expect(stageProbability(data, "Qualified")).toBe(35);
  // Persisting and reading back keeps the configuration and clamps junk percentages.
  const round = normalize(JSON.parse(JSON.stringify(data)));
  expect(stageName(round, "Qualified")).toBe("Erstkontakt geprüft");
  expect(stageProbability(round, "Qualified")).toBe(35);
});

test("a stored document without or with a broken pipeline configuration falls back per stage", () => {
  const base = seed();
  const raw: any = JSON.parse(JSON.stringify(base));
  delete raw.pipelineStages;
  expect(normalize(raw).pipelineStages).toEqual(defaultPipelineStages());
  const broken = normalize({ ...raw, pipelineStages: [{ id: "Unbekannt", name: "X", probability: 5 }, { id: "Abgeschlossen", name: "", probability: 480 }] });
  expect(broken.pipelineStages.map(stage => stage.id)).toEqual(defaultPipelineStages().map(stage => stage.id));
  expect(stageName(broken, "Abgeschlossen")).toBe("Abgeschlossen");
  expect(stageProbability(broken, "Abgeschlossen")).toBe(100);
});

test("a legacy per-deal probability is dropped on read: the stage is the only source", () => {
  const raw: any = JSON.parse(JSON.stringify(seed()));
  raw.deals[0].probability = 90;
  const data = normalize(raw);
  expect("probability" in data.deals[0]).toBe(false);
  expect(dealProbability(data, data.deals[0])).toBe(20);
});
