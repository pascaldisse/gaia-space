/** ── CRM insights: derivation only ────────────────────────────────────────────
 *
 *  Every number this module returns is COUNTED from the local CRM document — there is
 *  no target, no benchmark, no forecast curve and no seeded example figure anywhere in
 *  it. A question the data cannot answer returns `null`, and the view says so out loud
 *  rather than printing a comfortable zero (§winRate).
 *
 *  Two scoping rules, stated once so every report reads the same document the same way:
 *    · a DEAL is dated by its outcome if it has one (`closedAt`), otherwise by its
 *      creation — so "won in the last 30 days" means actually closed then, while an
 *      open deal is placed at the moment the opportunity appeared;
 *    · an ACTIVITY is dated by the day it is planned for (`dueDate`). Work without a
 *      date has no place on a timeline, so it is only in scope when the range is "all"
 *      and is reported as its own state (`unscheduled`), never silently dropped.
 *  The owner filter reads the activity's own owner first and falls back to the deal's,
 *  because an activity may be delegated away from the deal it belongs to. */

import {
  ACTIVITY_KINDS, activityEntries, activityState, dayKey, dealAmount, dealProbability, live, organizationOf,
  stageConfig, stageName, PIPELINE_STAGES,
  type ActivityEntry, type ActivityKind, type ActivityState, type CrmData, type CrmStage, type Deal,
} from "./crmStore";

/** The value written on a deal is free text ("12.000 €"); the one reading of it lives
 *  in the store (§crmStore.dealAmount) and is re-exported here, so a report and a board
 *  column cannot drift apart into two different amounts for the same deal. */
export { dealAmount } from "./crmStore";

/** `forwardOpen` marks the backward-looking PRESETS ("last 90 days"). A deal is dated
 *  by something that has happened, so its end is real; an ACTIVITY is dated by a plan,
 *  and a plan lies in the future — cutting it off at today would report a worklist that
 *  ends this evening. So presets keep the future open for activities, and an explicitly
 *  chosen custom window does not (§scopeActivities). */
export type DateRange = { start: string; end: string; forwardOpen?: boolean } | null; // null = every record, no window
export const INSIGHT_RANGES = ["30", "90", "365", "year", "all", "custom"] as const;
export type InsightRangeKey = typeof INSIGHT_RANGES[number];
export const INSIGHT_RANGE_LABELS: Record<InsightRangeKey, string> = {
  "30": "Letzte 30 Tage", "90": "Letzte 90 Tage", "365": "Letzte 12 Monate",
  year: "Dieses Jahr", all: "Gesamter Zeitraum", custom: "Eigener Zeitraum",
};
export const ALL_OWNERS = "Alle";

const shiftDays = (at: Date, days: number) => { const next = new Date(at); next.setDate(next.getDate() - days); return next; };
/** A preset is resolved against a real clock, so a report is never stamped with a date
 *  the machine does not have; `custom` is whatever the two fields say (half-open ends
 *  allowed: a start without an end means "since", and the other way round). */
export const resolveRange = (key: InsightRangeKey, custom: { start: string; end: string }, at: Date = new Date()): DateRange => {
  const today = dayKey(at);
  if (key === "all") return null;
  if (key === "custom") {
    const start = custom.start || "0000-01-01";
    const end = custom.end || "9999-12-31";
    return start <= end ? { start, end } : { start: end, end: start };
  }
  if (key === "year") return { start: `${at.getFullYear()}-01-01`, end: today, forwardOpen: true };
  return { start: dayKey(shiftDays(at, Number(key) - 1)), end: today, forwardOpen: true };
};
export const inRange = (day: string, range: DateRange) =>
  !range ? true : !!day && day >= range.start && day <= range.end;
const day = (value: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "offen";
export const rangeLabel = (key: InsightRangeKey, range: DateRange) =>
  !range ? INSIGHT_RANGE_LABELS.all
    : `${INSIGHT_RANGE_LABELS[key]} · ${day(range.start)} – ${day(range.end)}`;

/** The day a deal is counted on: its outcome, else its creation. */
export const dealDay = (deal: Deal): string =>
  (deal.closedAt ?? deal.createdAt ?? "").slice(0, 10);

export type InsightScope = { range: DateRange; owner: string };
export const scopeDeals = (data: CrmData, scope: InsightScope): Deal[] =>
  live(data.deals).filter(deal =>
    inRange(dealDay(deal), scope.range)
    && (scope.owner === ALL_OWNERS || (deal.owner || "") === ownerKeyOf(scope.owner)));

/** "Nicht zugeteilt" is a LABEL for the empty owner, never a person's name. */
export const UNASSIGNED = "Nicht zugeteilt";
const ownerKeyOf = (owner: string) => owner === UNASSIGNED ? "" : owner;
export const ownerLabel = (owner: string) => owner || UNASSIGNED;
/** The owner list is read from the document, so the filter can only offer people who
 *  actually carry work; the unassigned bucket appears only when something is unassigned. */
export const insightOwners = (data: CrmData): string[] => {
  const names = new Set<string>();
  for (const deal of live(data.deals)) names.add(ownerLabel(deal.owner));
  for (const entry of activityEntries(data)) names.add(ownerLabel(entry.activity.owner || entry.deal?.owner || ""));
  const sorted = [...names].filter(name => name !== UNASSIGNED).sort((a, b) => a.localeCompare(b, "de"));
  return [ALL_OWNERS, ...sorted, ...(names.has(UNASSIGNED) ? [UNASSIGNED] : [])];
};

export const entryOwner = (entry: ActivityEntry) => ownerLabel(entry.activity.owner || entry.deal?.owner || "");
export const scopeActivities = (data: CrmData, scope: InsightScope): ActivityEntry[] =>
  activityEntries(data).filter(entry => {
    if (scope.owner !== ALL_OWNERS && entryOwner(entry) !== scope.owner) return false;
    // Undated work is real work; it simply has no position on a timeline.
    if (!entry.activity.dueDate) return !scope.range;
    if (scope.range?.forwardOpen) return entry.activity.dueDate >= scope.range.start;
    return inRange(entry.activity.dueDate, scope.range);
  });

/** ── Money is never one number ────────────────────────────────────────────────
 *  A deal carries its own currency (§crmStore.Deal.currency). Adding 10.000 CHF to
 *  20.000 € and printing "30.000 €" is not a rounding error, it is a false statement,
 *  so no report in this module ever returns a bare monetary number: it returns the
 *  amounts PER CURRENCY, and says out loud when a figure spans several of them.
 *  `amount` is the plain sum and is only meaningful when `mixed` is false — a chart
 *  axis may use it then, and must fall back to counts when it is mixed. */
export type Currency = Deal["currency"];
export const CURRENCY_ORDER = ["EUR", "CHF", "USD"] as const;
export type MoneyPart = { currency: Currency; amount: number };
export type Money = { parts: MoneyPart[]; currency: Currency | null; amount: number; mixed: boolean };
export const EMPTY_MONEY: Money = { parts: [], currency: null, amount: 0, mixed: false };
export const MIXED_CURRENCY_LABEL = "Gemischte Währungen";

const currencyOf = (deal: Deal): Currency =>
  (CURRENCY_ORDER as readonly string[]).includes(deal.currency) ? deal.currency : "EUR";

/** Sum a set of deals into one amount PER currency, in a stable order. */
export const moneyOf = (deals: Deal[], per: (deal: Deal) => number = dealAmount): Money => {
  const buckets = new Map<Currency, number>();
  for (const deal of deals) {
    const currency = currencyOf(deal);
    buckets.set(currency, (buckets.get(currency) ?? 0) + per(deal));
  }
  const parts = CURRENCY_ORDER.filter(currency => buckets.has(currency))
    .map(currency => ({ currency, amount: buckets.get(currency)! }));
  return {
    parts,
    currency: parts.length === 1 ? parts[0].currency : null,
    amount: parts.reduce((total, part) => total + part.amount, 0),
    mixed: parts.length > 1,
  };
};
/** Which currencies a scope actually contains — the view asks this before it offers a
 *  monetary chart axis at all. */
export const scopeCurrencies = (deals: Deal[]): Currency[] =>
  CURRENCY_ORDER.filter(currency => deals.some(deal => currencyOf(deal) === currency));

/** `€` is unambiguous, `$` is not — so every foreign currency prints its CODE (`USD`,
 *  `CHF`). Beside each other in one report, symbols would be the old lie again. */
export const formatAmount = (amount: number, currency: Currency = "EUR") =>
  new Intl.NumberFormat("de-DE", {
    style: "currency", currency, maximumFractionDigits: 0,
    currencyDisplay: currency === "EUR" ? "symbol" : "code",
  }).format(amount);
export const formatAmountShort = (amount: number, currency: Currency = "EUR") =>
  Math.abs(amount) >= 10000
    ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: Math.abs(amount) >= 100000 ? 0 : 1 }).format(amount / 1000)} Tsd. ${currency === "EUR" ? "€" : currency}`
    : formatAmount(amount, currency);
/** Every currency, spelled out: `20.000 € · 10.000 CHF`. Never one merged total. */
export const formatMoney = (money: Money): string =>
  !money.parts.length ? formatAmount(0) : money.parts.map(part => formatAmount(part.amount, part.currency)).join(" · ");
/** A headline: one currency prints its amount, several print `Gemischte Währungen`
 *  with the per-currency amounts beside it, so nothing is ever labelled EUR falsely. */
export const moneyHeadline = (money: Money): { value: string; detail: string } =>
  money.mixed ? { value: MIXED_CURRENCY_LABEL, detail: formatMoney(money) } : { value: formatMoney(money), detail: "" };

/** ── The four headline numbers ────────────────────────────────────────────── */
export type Metric = { count: number; money: Money };
export type WinRate = { won: number; lost: number; rate: number | null };
export type InsightMetrics = {
  won: Metric;
  openPipeline: Metric & { gross: Money };
  winRate: WinRate;
  /** The currencies present in the scope — one means every figure is comparable. */
  currencies: Currency[];
  activities: { open: number; overdue: number; total: number };
};

export const insightMetrics = (data: CrmData, scope: InsightScope, at: Date = new Date()): InsightMetrics => {
  const deals = scopeDeals(data, scope);
  const won = deals.filter(deal => deal.status === "Gewonnen");
  const lost = deals.filter(deal => deal.status === "Verloren");
  const open = deals.filter(deal => deal.status === "Offen");
  const activities = scopeActivities(data, scope);
  const states = activities.map(entry => activityState(entry.activity, at));
  return {
    won: { count: won.length, money: moneyOf(won) },
    openPipeline: {
      count: open.length,
      // Weighted by the STAGE's probability — the same single source the board uses.
      money: moneyOf(open, deal => dealAmount(deal) * dealProbability(data, deal) / 100),
      gross: moneyOf(open),
    },
    currencies: scopeCurrencies(deals),
    // A rate needs decided deals. None decided -> no rate exists, and `null` says that.
    winRate: { won: won.length, lost: lost.length, rate: won.length + lost.length ? won.length / (won.length + lost.length) : null },
    activities: {
      open: states.filter(state => state !== "done").length,
      overdue: states.filter(state => state === "overdue").length,
      total: activities.length,
    },
  };
};

/** ── Pipeline distribution ────────────────────────────────────────────────
 *  Every configured stage appears, including the empty ones: a column with nothing in
 *  it is a finding, not a gap to hide. Names and probabilities come from the pipeline
 *  configuration (§crmStore.stageConfig), so renaming a phase renames the report. */
export type StageSlice = { stage: CrmStage; name: string; probability: number; count: number; money: Money; weighted: Money };
export const stageDistribution = (data: CrmData, scope: InsightScope): StageSlice[] => {
  const open = scopeDeals(data, scope).filter(deal => deal.status === "Offen");
  return PIPELINE_STAGES.map(stage => {
    const inStage = open.filter(deal => deal.stage === stage);
    const config = stageConfig(data, stage);
    return {
      stage, name: stageName(data, stage), probability: config.probability,
      count: inStage.length, money: moneyOf(inStage),
      weighted: moneyOf(inStage, deal => dealAmount(deal) * config.probability / 100),
    };
  });
};

/** ── Deal status by owner ─────────────────────────────────────────────────── */
export type OwnerSlice = { owner: string; open: number; won: number; lost: number; openMoney: Money; wonMoney: Money; total: number };
export const ownerBreakdown = (data: CrmData, scope: InsightScope): OwnerSlice[] => {
  const buckets = new Map<string, Deal[]>();
  for (const deal of scopeDeals(data, scope)) {
    const key = ownerLabel(deal.owner);
    buckets.set(key, [...(buckets.get(key) ?? []), deal]);
  }
  return [...buckets.entries()].map(([owner, deals]) => {
    const open = deals.filter(deal => deal.status === "Offen");
    const won = deals.filter(deal => deal.status === "Gewonnen");
    return {
      owner, open: open.length, won: won.length, lost: deals.filter(deal => deal.status === "Verloren").length,
      openMoney: moneyOf(open), wonMoney: moneyOf(won), total: deals.length,
    };
  }).sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner, "de"));
};

/** ── Activities: what state they are in, and what kind of work they are ───── */
export const ACTIVITY_STATE_ORDER = ["overdue", "today", "planned", "unscheduled", "done"] as const;
export const ACTIVITY_STATE_LABELS: Record<ActivityState, string> = {
  overdue: "Überfällig", today: "Heute", planned: "Geplant", unscheduled: "Ohne Termin", done: "Erledigt",
};
export type StateSlice = { state: ActivityState; label: string; count: number };
export const activityStateBreakdown = (data: CrmData, scope: InsightScope, at: Date = new Date()): StateSlice[] => {
  const states = scopeActivities(data, scope).map(entry => activityState(entry.activity, at));
  return ACTIVITY_STATE_ORDER.map(state => ({ state, label: ACTIVITY_STATE_LABELS[state], count: states.filter(item => item === state).length }));
};
export type KindSlice = { kind: ActivityKind; count: number; done: number; open: number };
export const activityKindBreakdown = (data: CrmData, scope: InsightScope): KindSlice[] => {
  const entries = scopeActivities(data, scope);
  return ACTIVITY_KINDS.map(kind => {
    const ofKind = entries.filter(entry => entry.activity.kind === kind);
    const done = ofKind.filter(entry => entry.activity.done).length;
    return { kind, count: ofKind.length, done, open: ofKind.length - done };
  });
};

/** Organization name of a deal, for the few places a report names a record. */
export const dealOrgName = (data: CrmData, deal: Deal) => organizationOf(data, deal)?.name ?? "";

/* Scaling lives in §chartScale: bars are measured against a rounded AXIS, so two
   reports with different numbers no longer look alike. */
