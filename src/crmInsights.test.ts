import { expect, test, describe } from "bun:test";
import {
  ALL_OWNERS, activityKindBreakdown, activityStateBreakdown, dealAmount, dealDay, inRange, insightMetrics,
  insightOwners, ownerBreakdown, resolveRange, stageDistribution, UNASSIGNED,
} from "./crmInsights";
import { dayKey, normalize, type CrmData } from "./crmStore";

// The contract of the reports: every figure is COUNTED from the document handed in,
// and a question the document cannot answer comes back as `null` rather than as a zero
// that looks like a measurement.

const NOW = new Date("2026-09-14T12:00:00.000Z");
const at = (offset: number) => { const date = new Date(NOW); date.setDate(date.getDate() + offset); return dayKey(date); };
const iso = (offset: number) => { const date = new Date(NOW); date.setDate(date.getDate() + offset); return date.toISOString(); };

const deal = (values: Record<string, unknown>) => ({
  id: `deal-${values.id}`, organizationId: "org-1", locationId: null, title: `Deal ${values.id}`, stage: "Qualified",
  status: "Offen", owner: "Jannes", source: "", value: "10000", currency: "EUR", expectedClose: "", labels: [],
  nextStep: "", nextStepDate: "", notes: [], activities: [], files: [], createdAt: iso(-5), stageEnteredAt: iso(-5),
  closedAt: null, deletedAt: null, ...values,
});

const doc = (): CrmData => normalize({
  version: 2,
  organizations: [{ id: "org-1", name: "Optik Nord", locations: [], labels: [], owner: "Jannes", createdAt: iso(-40), deletedAt: null }],
  labels: [], pipelineStages: [], activities: [
    { id: "act-inbox", kind: "Aufgabe", title: "Messe-Rückruf", dueDate: at(-2), owner: "Bjarne", done: false },
  ],
  deals: [
    deal({ id: 1, stage: "Qualified", value: "10000" }),
    deal({ id: 2, stage: "Angebot erstellt", value: "20000", owner: "Bjarne" }),
    deal({ id: 3, status: "Gewonnen", value: "30000", closedAt: iso(-3) }),
    deal({ id: 4, status: "Verloren", value: "5000", closedAt: iso(-4), owner: "Bjarne" }),
    deal({ id: 5, status: "Gewonnen", value: "99000", closedAt: iso(-400) }),        // outside 90 days
    deal({ id: 6, value: "7000", owner: "", deletedAt: iso(-1) }),                   // deleted: never counted
    deal({
      id: 7, stage: "Kontakt hergestellt", value: "4000", owner: "",
      activities: [
        { id: "act-late", kind: "Anruf", title: "Rückruf", dueDate: at(-1), owner: "", done: false },
        { id: "act-done", kind: "E-Mail", title: "Angebot", dueDate: at(-6), done: true, doneAt: iso(-6) },
        { id: "act-future", kind: "Besuch", title: "Termin", dueDate: at(+4), owner: "Jannes", done: false },
      ],
    }),
  ],
});

const scope = (owner = ALL_OWNERS, days: "90" | "all" = "90") => ({ range: resolveRange(days, { start: "", end: "" }, NOW), owner });

describe("scoping", () => {
  test("a deal is dated by its outcome, an open deal by its creation", () => {
    expect(dealDay(deal({ id: 9, closedAt: iso(-3), createdAt: iso(-40) }) as any)).toBe(at(-3));
    expect(dealDay(deal({ id: 9, createdAt: iso(-40) }) as any)).toBe(at(-40));
  });
  test("a free-text value is read as one number, thousands separator included", () => {
    expect(dealAmount({ value: "12.000 €" } as any)).toBe(12000);
    expect(dealAmount({ value: "1.250,50" } as any)).toBe(1250.5);
    expect(dealAmount({ value: "" } as any)).toBe(0);
    expect(dealAmount({ value: "keine Angabe" } as any)).toBe(0);
  });
  test("presets resolve against the clock; 'all' is no window at all", () => {
    expect(resolveRange("30", { start: "", end: "" }, NOW)).toEqual({ start: at(-29), end: at(0), forwardOpen: true });
    expect(resolveRange("year", { start: "", end: "" }, NOW)).toEqual({ start: "2026-01-01", end: at(0), forwardOpen: true });
    expect(resolveRange("all", { start: "", end: "" }, NOW)).toBeNull();
    // A reversed custom range is a typo, not an empty report.
    expect(resolveRange("custom", { start: "2026-09-10", end: "2026-09-01" }, NOW)).toEqual({ start: "2026-09-01", end: "2026-09-10" });
    // Half-open ends stay open.
    expect(resolveRange("custom", { start: "2026-09-01", end: "" }, NOW)).toEqual({ start: "2026-09-01", end: "9999-12-31" });
    expect(inRange("2026-09-05", { start: "2026-09-01", end: "9999-12-31" })).toBe(true);
    expect(inRange("", null)).toBe(true);
  });
  test("the owner list comes from the document and names the empty owner once", () => {
    expect(insightOwners(doc())).toEqual([ALL_OWNERS, "Bjarne", "Jannes", UNASSIGNED]);
  });
});

describe("headline metrics", () => {
  test("won value counts only actually won deals inside the range", () => {
    const metrics = insightMetrics(doc(), scope(), NOW);
    expect(metrics.won).toEqual({ count: 1, value: 30000 });       // 99.000 closed 400 days ago is out
    expect(insightMetrics(doc(), scope(ALL_OWNERS, "all"), NOW).won).toEqual({ count: 2, value: 129000 });
  });
  test("open pipeline is weighted by the stage probability, never by the deal", () => {
    const metrics = insightMetrics(doc(), scope(), NOW);
    // Qualified 20% of 10.000 + Angebot 50% of 20.000 + Kontakt 30% of 4.000 = 2.000 + 10.000 + 1.200
    expect(metrics.openPipeline).toEqual({ count: 3, value: 13200, gross: 34000 });
  });
  test("win rate is won/(won+lost) and is null when nothing is decided", () => {
    expect(insightMetrics(doc(), scope(), NOW).winRate).toEqual({ won: 1, lost: 1, rate: 0.5 });
    const undecided = normalize({ version: 2, organizations: [], deals: [deal({ id: 1 })], labels: [], pipelineStages: [], activities: [] });
    expect(insightMetrics(undecided, scope(), NOW).winRate).toEqual({ won: 0, lost: 0, rate: null });
  });
  test("activities count open and overdue work, deal-owned and inbox alike", () => {
    const metrics = insightMetrics(doc(), scope(), NOW);
    // A preset looks back at what happened AND forward at what is planned: the visit in
    // four days is outstanding work, not a record from a future the range cannot see.
    expect(metrics.activities.total).toBe(4);
    expect(metrics.activities.open).toBe(3);                      // three not done
    expect(metrics.activities.overdue).toBe(2);                   // act-inbox and act-late
    // An explicitly chosen window is honoured on both ends.
    const closed = { range: resolveRange("custom", { start: at(-7), end: at(0) }, NOW), owner: ALL_OWNERS };
    expect(insightMetrics(doc(), closed, NOW).activities.total).toBe(3);
  });
  test("the owner filter narrows every number, unassigned included", () => {
    const bjarne = insightMetrics(doc(), scope("Bjarne"), NOW);
    expect(bjarne.won).toEqual({ count: 0, value: 0 });
    expect(bjarne.winRate).toEqual({ won: 0, lost: 1, rate: 0 });
    expect(bjarne.openPipeline.gross).toBe(20000);
    expect(bjarne.activities.total).toBe(1);                      // the inbox call-back
    const none = insightMetrics(doc(), scope(UNASSIGNED), NOW);
    expect(none.openPipeline.gross).toBe(4000);                   // deal 7 only; the deleted one stays deleted
  });
});

describe("reports", () => {
  test("pipeline distribution lists every configured stage, empty ones included", () => {
    const slices = stageDistribution(doc(), scope());
    expect(slices).toHaveLength(6);
    const qualified = slices.find(slice => slice.stage === "Qualified")!;
    expect(qualified).toMatchObject({ count: 1, value: 10000, weighted: 2000, probability: 20 });
    expect(slices.find(slice => slice.stage === "Non-Qualified")).toMatchObject({ count: 0, value: 0, weighted: 0 });
    // Won and lost deals are a status, never a column of the distribution.
    expect(slices.reduce((total, slice) => total + slice.count, 0)).toBe(3);
  });
  test("owner breakdown reports the actual outcomes per person", () => {
    const rows = ownerBreakdown(doc(), scope());
    // Two deals each for Jannes and Bjarne -> a tie, broken alphabetically, never randomly.
    expect(rows.map(row => row.owner)).toEqual(["Bjarne", "Jannes", UNASSIGNED]);
    expect(rows[1]).toMatchObject({ open: 1, won: 1, lost: 0, openValue: 10000, wonValue: 30000 });
    expect(rows[0]).toMatchObject({ open: 1, won: 0, lost: 1 });
    expect(rows[2]).toMatchObject({ open: 1, won: 0, lost: 0, openValue: 4000 });
  });
  test("activity reports split by state and by kind, counting the same entries", () => {
    const states = activityStateBreakdown(doc(), scope(), NOW);
    expect(Object.fromEntries(states.map(slice => [slice.state, slice.count])))
      .toEqual({ overdue: 2, today: 0, planned: 1, unscheduled: 0, done: 1 });
    const kinds = activityKindBreakdown(doc(), scope());
    expect(kinds.find(slice => slice.kind === "Anruf")).toMatchObject({ count: 1, open: 1, done: 0 });
    expect(kinds.find(slice => slice.kind === "E-Mail")).toMatchObject({ count: 1, open: 0, done: 1 });
    expect(kinds.reduce((total, slice) => total + slice.count, 0)).toBe(states.reduce((total, slice) => total + slice.count, 0));
  });
  test("an empty document reports zeros and no rate, never an invented figure", () => {
    const empty = normalize({ version: 2, organizations: [], deals: [], labels: [], pipelineStages: [], activities: [] });
    const metrics = insightMetrics(empty, scope(), NOW);
    expect(metrics.won).toEqual({ count: 0, value: 0 });
    expect(metrics.openPipeline).toEqual({ count: 0, value: 0, gross: 0 });
    expect(metrics.winRate.rate).toBeNull();
    expect(ownerBreakdown(empty, scope())).toEqual([]);
    expect(stageDistribution(empty, scope()).every(slice => slice.count === 0)).toBe(true);
  });
  // How a counted value becomes a bar length is the axis's business: §chartScale.test.
});
