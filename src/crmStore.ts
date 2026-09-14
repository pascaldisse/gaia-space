/** ── CRM data model, v2 ───────────────────────────────────────────────────────
 *  v1 conflated three different things in one record: the BUSINESS (an organization
 *  that exists whether or not we sell anything), the SALES OPPORTUNITY (a deal, which
 *  starts, moves and ends), and the SITE (a location, which is an address of the
 *  business). The pipeline therefore rendered businesses, "won" had to be faked as a
 *  stage, and a deleted card was simply gone.
 *
 *  v2 separates them:
 *    Organization — the durable record (customer/lead). Never sits in the pipeline.
 *    Deal         — the opportunity. Owns its notes, activities and documents, and
 *                   is the ONLY thing the pipeline renders.
 *    Location     — an address of an organization. A deal may point at one.
 *  Nothing is destroyed on delete: records carry `deletedAt` and are restorable
 *  from Trash. Labels live in one central library with colors and are referenced
 *  by id, so renaming or recoloring a label is a single write. */

export const CRM_STAGES = [
  "Non-Qualified", "Qualified", "Kontakt hergestellt", "Gespräch vereinbart", "Angebot erstellt", "Abgeschlossen",
] as const;
export type CrmStage = typeof CRM_STAGES[number];
/** The board shows open work only; won/lost are a STATUS, never a column. */
export const PIPELINE_STAGES = CRM_STAGES;
export const DEAL_STATUS = ["Offen", "Gewonnen", "Verloren"] as const;
export type DealStatus = typeof DEAL_STATUS[number];
export const ACTIVITY_KINDS = ["Anruf", "E-Mail", "Besuch", "Video-Call", "Aufgabe"] as const;
export type ActivityKind = typeof ACTIVITY_KINDS[number];
/** Priority is a plan, not a judgement: three steps, "Normal" the resting value. */
export const ACTIVITY_PRIORITIES = ["Niedrig", "Normal", "Hoch"] as const;
export type ActivityPriority = typeof ACTIVITY_PRIORITIES[number];
/** Minutes, stored as a number so a duration can be summed; 0 means "not stated". */
export const ACTIVITY_DURATIONS = [0, 15, 30, 45, 60, 90, 120] as const;
/** Icon vocabulary of the activity type — one mapping, read by list, calendar and feed. */
export const ACTIVITY_ICONS = {
  "Anruf": "chat", "E-Mail": "send", "Besuch": "org", "Video-Call": "users", "Aufgabe": "check",
} as const satisfies Record<ActivityKind, string>;

export type Label = { id: string; name: string; color: string };
export type Contact = { id: string; name: string; role: string; emails: string[]; phones: string[]; preferred: string };
export type Note = { id: string; title: string; body: string; author: string; createdAt: string };
/** An activity is a piece of PLANNED WORK: what kind, about what, when, how long, how
 *  urgent, and who owes it. `dueTime` is optional (`HH:MM`) — a day without an hour is
 *  a perfectly good plan. `doneAt` records when it was actually completed, so the feed
 *  can say more than a checkbox. */
export type Activity = {
  id: string; kind: ActivityKind; title: string; dueDate: string; dueTime: string; duration: number;
  priority: ActivityPriority; owner: string; outcome: string; done: boolean; doneAt: string | null; createdAt: string;
};
export type CrmFile = { id: string; name: string; type: string; data: string; createdAt: string };
export type Location = { id: string; name: string; address: string; employees: string; emails: string[]; phones: string[]; contacts: Contact[] };
export type Organization = {
  id: string; name: string; website: string; employees: string; decisionMaker: string; software: string; source: string;
  owner: string; labels: string[]; locations: Location[]; createdAt: string; deletedAt: string | null;
};
export type Deal = {
  id: string; organizationId: string; locationId: string | null; title: string; stage: CrmStage; status: DealStatus;
  owner: string; source: string; value: string; currency: "EUR" | "CHF" | "USD"; expectedClose: string; labels: string[]; nextStep: string; nextStepDate: string;
  notes: Note[]; activities: Activity[]; files: CrmFile[]; createdAt: string; stageEnteredAt: string; closedAt: string | null; deletedAt: string | null;
};
/** `activities` at the top level is the INBOX of work that has no opportunity yet — a
 *  callback from a trade fair, a reminder to research a name. The model stays
 *  deal-owned: everything that belongs to a deal lives ON the deal, and an inbox
 *  activity is either linked into one later (§linkActivity) or stays unlinked. */
export type CrmData = { version: 2; organizations: Organization[]; deals: Deal[]; labels: Label[]; pipelineStages: PipelineStage[]; activities: Activity[] };

/** ── Pipeline configuration ──────────────────────────────────────────────────
 *  The win probability belongs to the STAGE, never to the single deal: a deal in
 *  "Angebot erstellt" is exactly as likely as the pipeline says that phase is. The
 *  stage `id` is the stable key deals are stored under and dragged between; `name`
 *  is the display text and may be renamed freely without touching a deal. */
export type PipelineStage = { id: CrmStage; name: string; probability: number };
const STAGE_DEFAULTS: Array<[CrmStage, number]> = [
  ["Non-Qualified", 10], ["Qualified", 20], ["Kontakt hergestellt", 30],
  ["Gespräch vereinbart", 40], ["Angebot erstellt", 50], ["Abgeschlossen", 70],
];
/** A won deal is settled, not estimated: it counts fully, a lost one not at all. */
export const WON_PROBABILITY = 100;
export const LOST_PROBABILITY = 0;
export const defaultPipelineStages = (): PipelineStage[] =>
  STAGE_DEFAULTS.map(([id, probability]) => ({ id, name: id, probability }));
const clampPercent = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
/** Order and ids come from the code, name and percent from the stored document, so a
 *  broken or stale configuration can never lose a column or orphan a deal. */
export const normalizePipelineStages = (raw: unknown): PipelineStage[] =>
  defaultPipelineStages().map(stage => {
    const stored = Array.isArray(raw) ? (raw as any[]).find(item => item?.id === stage.id) : undefined;
    if (!stored) return stage;
    return { id: stage.id, name: String(stored.name ?? "").trim() || stage.name, probability: stored.probability === undefined ? stage.probability : clampPercent(stored.probability) };
  });
export const stageConfig = (data: CrmData, stage: CrmStage): PipelineStage =>
  data.pipelineStages?.find(item => item.id === stage) ?? defaultPipelineStages().find(item => item.id === stage)!;
export const stageName = (data: CrmData, stage: CrmStage) => stageConfig(data, stage).name;
export const stageProbability = (data: CrmData, stage: CrmStage) => stageConfig(data, stage).probability;
/** The only place a deal's probability exists: derived from status, then stage. */
export const dealProbability = (data: CrmData, deal: Deal) =>
  deal.status === "Gewonnen" ? WON_PROBABILITY : deal.status === "Verloren" ? LOST_PROBABILITY : stageProbability(data, deal.stage);
export const setPipelineStages = (data: CrmData, stages: PipelineStage[]) => {
  data.pipelineStages = normalizePipelineStages(stages);
};

/** ── Deal aging ──────────────────────────────────────────────────────────────
 *  A deal that sits still is the cheapest warning a pipeline can give. The clock is
 *  the STAGE clock (`stageEnteredAt`), not the creation date: a deal that moved
 *  yesterday is fresh no matter how old the opportunity is, and only an actual stage
 *  CHANGE resets it (see `moveDeal`). Being young is not an achievement, so the fresh
 *  tone is neutral, never a green success — only the waiting is worth a colour. */
export const STAGE_AGE_WARN_DAYS = 7;
export const STAGE_AGE_STALE_DAYS = 30;
export type StageAgeTone = "fresh" | "warn" | "stale";
export type StageAge = { days: number; tone: StageAgeTone; label: string; hint: string };
const DAY_MS = 86_400_000;
/** Whole days since the deal entered its stage; missing or broken stamps read as day 0
 *  rather than inventing an age from a record that never tracked one. */
export const daysInStage = (deal: Deal, at: Date = new Date()): number => {
  const entered = Date.parse(deal.stageEnteredAt || deal.createdAt || "");
  if (!Number.isFinite(entered)) return 0;
  return Math.max(0, Math.floor((at.getTime() - entered) / DAY_MS));
};
export const stageAgeTone = (days: number): StageAgeTone =>
  days > STAGE_AGE_STALE_DAYS ? "stale" : days > STAGE_AGE_WARN_DAYS ? "warn" : "fresh";
export const stageAgeLabel = (days: number) => `${days} ${days === 1 ? "Tag" : "Tage"} in dieser Phase`;
export const stageAge = (deal: Deal, at?: Date): StageAge => {
  const days = daysInStage(deal, at);
  const tone = stageAgeTone(days);
  return {
    days, tone, label: stageAgeLabel(days),
    hint: tone === "stale" ? `Seit ${days} Tagen unverändert – überfällig` : tone === "warn" ? `Seit ${days} Tagen unverändert – wartet` : `Seit ${days} ${days === 1 ? "Tag" : "Tagen"} in dieser Phase`,
  };
};

export const LABEL_COLORS = ["#00C2A8", "#2F6BFF", "#6B3D8B", "#B2500F", "#0F1B33", "#118C5C", "#8B2E5A", "#5A6473"] as const;

const KEY_V2 = "gaia.crm.prototype.v2";
const KEY_V1 = "gaia.crm.prototype.v1";
export const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export const emptyActivity = (values: Partial<Activity> = {}): Activity => ({
  id: id("activity"), kind: "Anruf", title: "", dueDate: "", dueTime: "", duration: 0, priority: "Normal",
  owner: "", outcome: "", done: false, doneAt: null, createdAt: now(), ...values,
});
/** Any stored shape (v1 record, early v2, junk) read back as a complete activity. */
export const normalizeActivity = (raw: any): Activity => emptyActivity({
  id: raw?.id ?? id("activity"),
  kind: ACTIVITY_KINDS.includes(raw?.kind) ? raw.kind : "Aufgabe",
  title: String(raw?.title ?? ""),
  dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.dueDate ?? "")) ? String(raw.dueDate) : "",
  dueTime: /^\d{2}:\d{2}$/.test(String(raw?.dueTime ?? "")) ? String(raw.dueTime) : "",
  duration: Math.max(0, Math.round(Number(raw?.duration) || 0)),
  priority: ACTIVITY_PRIORITIES.includes(raw?.priority) ? raw.priority : "Normal",
  owner: String(raw?.owner ?? ""),
  outcome: String(raw?.outcome ?? ""),
  done: !!raw?.done,
  doneAt: raw?.doneAt ?? (raw?.done ? raw?.createdAt ?? null : null),
  createdAt: raw?.createdAt ?? now(),
});

export const emptyLocation = (name = ""): Location =>
  ({ id: id("location"), name, address: "", employees: "", emails: [], phones: [], contacts: [] });
export const emptyOrganization = (name: string, owner = ""): Organization =>
  ({ id: id("org"), name, website: "", employees: "", decisionMaker: "", software: "", source: "", owner, labels: [], locations: [emptyLocation(name)], createdAt: now(), deletedAt: null });
export const emptyDeal = (organizationId: string, title: string, owner = ""): Deal =>
  ({ id: id("deal"), organizationId, locationId: null, title, stage: "Non-Qualified", status: "Offen", owner, source: "", value: "", currency: "EUR", expectedClose: "", labels: [], nextStep: "", nextStepDate: "", notes: [], activities: [], files: [], createdAt: now(), stageEnteredAt: now(), closedAt: null, deletedAt: null });

/** ── Label library ───────────────────────────────────────────────────────── */
export const labelByName = (data: CrmData, name: string) =>
  data.labels.find(label => label.name.toLocaleLowerCase("de") === name.trim().toLocaleLowerCase("de"));
export const makeLabel = (name: string, index: number): Label =>
  ({ id: id("label"), name: name.trim(), color: LABEL_COLORS[index % LABEL_COLORS.length] });

const STARTER_LABELS: Array<[string, string]> = [["Heißer Lead", "#B2500F"], ["Warmer Lead", "#E0A100"], ["Kalter Lead", "#2F6BFF"], ["Empfohlen", "#6B3D8B"], ["Gründungskunde", "#00C2A8"]];
const withStarterLabels = (labels: Label[]) => [...labels, ...STARTER_LABELS.filter(([name]) => !labels.some(label => label.name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"))).map(([name, color]) => ({ id: id("label"), name, color }))];
/** Names a label once, centrally: existing name -> existing id, new name -> new entry. */
export const ensureLabel = (data: CrmData, name: string): string => {
  const existing = labelByName(data, name);
  if (existing) return existing.id;
  const label = makeLabel(name, data.labels.length);
  data.labels.push(label);
  return label.id;
};
export const labelsOf = (data: CrmData, ids: string[]): Label[] =>
  ids.map(labelId => data.labels.find(label => label.id === labelId)).filter((label): label is Label => !!label);

/** ── Selectors ───────────────────────────────────────────────────────────── */
export const live = <T extends { deletedAt: string | null }>(items: T[]) => items.filter(item => !item.deletedAt);
export const organizationOf = (data: CrmData, deal: Deal) => data.organizations.find(org => org.id === deal.organizationId);
export const dealsOf = (data: CrmData, organizationId: string) => live(data.deals).filter(deal => deal.organizationId === organizationId);
export const openDeals = (data: CrmData) => live(data.deals).filter(deal => deal.status === "Offen");
export const wonDeals = (data: CrmData) => live(data.deals).filter(deal => deal.status === "Gewonnen");
export const lostDeals = (data: CrmData) => live(data.deals).filter(deal => deal.status === "Verloren");
/** A customer is an organization we have actually won; anything else with no won deal
 *  is still a lead, and an organization with no deal at all is a pure lead. */
export const isCustomer = (data: CrmData, organizationId: string) =>
  live(data.deals).some(deal => deal.organizationId === organizationId && deal.status === "Gewonnen");
export const customers = (data: CrmData) => live(data.organizations).filter(org => isCustomer(data, org.id));
export const leads = (data: CrmData) => live(data.organizations).filter(org => !isCustomer(data, org.id));
export const trash = (data: CrmData) => ({
  organizations: data.organizations.filter(org => org.deletedAt),
  deals: data.deals.filter(deal => deal.deletedAt),
});
/** Activities stay deal-owned; an organization only ever shows a rollup of its deals'. */
export const activitiesOf = (data: CrmData, organizationId: string) =>
  dealsOf(data, organizationId).flatMap(deal => deal.activities.map(activity => ({ deal, activity })));
export const notesOf = (data: CrmData, organizationId: string) =>
  dealsOf(data, organizationId).flatMap(deal => deal.notes.map(note => ({ deal, note })));
export const allActivities = (data: CrmData) =>
  live(data.deals).flatMap(deal => deal.activities.map(activity => ({ deal, activity })))
    .sort((a, b) => (a.activity.dueDate || "9999").localeCompare(b.activity.dueDate || "9999"));

/** ── The activity worklist ──────────────────────────────────────────────
 *  ONE list carries both homes of an activity, so list, calendar and rollup can never
 *  disagree about what is outstanding. `deal`/`org` are null exactly when the activity
 *  sits in the inbox. Sorted by day, then hour, then title — undated work sorts last. */
export type ActivityEntry = { activity: Activity; deal: Deal | null; org: Organization | null };
const entryOrder = (a: ActivityEntry, b: ActivityEntry) =>
  (a.activity.dueDate || "9999-12-31").localeCompare(b.activity.dueDate || "9999-12-31")
  || (a.activity.dueTime || "99:99").localeCompare(b.activity.dueTime || "99:99")
  || a.activity.title.localeCompare(b.activity.title, "de");
export const activityEntries = (data: CrmData): ActivityEntry[] => [
  ...live(data.deals).flatMap(deal => deal.activities.map(activity => ({ activity, deal, org: organizationOf(data, deal) ?? null }))),
  ...(data.activities ?? []).map(activity => ({ activity, deal: null, org: null })),
].sort(entryOrder);
export const findActivity = (data: CrmData, activityId: string): ActivityEntry | undefined =>
  activityEntries(data).find(entry => entry.activity.id === activityId);

/** Local day key — never `toISOString()`, which would shift a date-only plan a day. */
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
/** Monday–Sunday, the week a German calendar shows. */
export const weekBounds = (at: Date = new Date()) => {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start: dayKey(start), end: dayKey(end) };
};

export type ActivityState = "done" | "overdue" | "today" | "planned" | "unscheduled";
/** What an activity IS right now. Every badge, tone and filter reads this one function. */
export const activityState = (activity: Activity, at: Date = new Date()): ActivityState => {
  if (activity.done) return "done";
  if (!activity.dueDate) return "unscheduled";
  const today = dayKey(at);
  return activity.dueDate < today ? "overdue" : activity.dueDate === today ? "today" : "planned";
};

export const ACTIVITY_VIEWS = ["todo", "overdue", "today", "week", "done", "all"] as const;
export type ActivityView = typeof ACTIVITY_VIEWS[number];
export const ACTIVITY_VIEW_LABELS: Record<ActivityView, string> = {
  todo: "To-do", overdue: "Überfällig", today: "Heute", week: "Diese Woche", done: "Erledigt", all: "Alle",
};
export const isActivityView = (value: unknown): value is ActivityView => ACTIVITY_VIEWS.includes(value as ActivityView);
/** A filter narrows the SAME worklist; nothing here mutates or re-sorts. */
export const matchesActivityView = (activity: Activity, view: ActivityView, at: Date = new Date()): boolean => {
  const state = activityState(activity, at);
  if (view === "all") return true;
  if (view === "done") return state === "done";
  if (view === "todo") return state !== "done";
  if (state === "done") return false;
  if (view === "overdue") return state === "overdue";
  if (view === "today") return state === "today";
  const { start, end } = weekBounds(at);
  return !!activity.dueDate && activity.dueDate >= start && activity.dueDate <= end;
};
export const filterActivityEntries = (entries: ActivityEntry[], view: ActivityView, kind: ActivityKind | "Alle" = "Alle", at: Date = new Date()) =>
  entries.filter(entry => matchesActivityView(entry.activity, view, at) && (kind === "Alle" || entry.activity.kind === kind));
export const activitiesOnDay = (entries: ActivityEntry[], day: Date) =>
  entries.filter(entry => entry.activity.dueDate === dayKey(day));

/** ── Activity mutations ─────────────────────────────────────────────────
 *  A deal id routes the activity to its opportunity; no deal id routes it to the inbox.
 *  One entry point, so a composer cannot invent a second storage rule. */
export const addActivity = (data: CrmData, dealId: string | null, values: Partial<Activity>): Activity => {
  const activity = emptyActivity(values);
  const deal = dealId ? data.deals.find(item => item.id === dealId) : undefined;
  if (deal) deal.activities.unshift(activity);
  else (data.activities ??= []).unshift(activity);
  return activity;
};
const activityBuckets = (data: CrmData): Activity[][] => [...data.deals.map(deal => deal.activities), (data.activities ??= [])];
export const setActivityDone = (data: CrmData, activityId: string, done: boolean) => {
  for (const bucket of activityBuckets(data)) {
    const found = bucket.find(item => item.id === activityId);
    if (found) { found.done = done; found.doneAt = done ? now() : null; return found; }
  }
  return undefined;
};
export const toggleActivity = (data: CrmData, activityId: string) => {
  for (const bucket of activityBuckets(data)) {
    const found = bucket.find(item => item.id === activityId);
    if (found) return setActivityDone(data, activityId, !found.done);
  }
  return undefined;
};
export const updateActivity = (data: CrmData, activityId: string, values: Partial<Activity>) => {
  for (const bucket of activityBuckets(data)) {
    const found = bucket.find(item => item.id === activityId);
    if (found) { Object.assign(found, values); return found; }
  }
  return undefined;
};
export const removeActivity = (data: CrmData, activityId: string) => {
  for (const bucket of activityBuckets(data)) {
    const index = bucket.findIndex(item => item.id === activityId);
    if (index >= 0) return bucket.splice(index, 1)[0];
  }
  return undefined;
};
/** Linking is a MOVE, never a copy: the activity leaves its old home in the same write,
 *  so an activity can never be outstanding twice. `null` sends it back to the inbox. */
export const linkActivity = (data: CrmData, activityId: string, dealId: string | null) => {
  const activity = removeActivity(data, activityId);
  if (!activity) return undefined;
  const deal = dealId ? data.deals.find(item => item.id === dealId) : undefined;
  if (deal) deal.activities.unshift(activity);
  else (data.activities ??= []).unshift(activity);
  return activity;
};

/** ── Mutations (pure on a draft) ─────────────────────────────────────────── */
/** Re-dropping a card in the column it already sits in is a no-op for the clock: only
 *  an actual stage CHANGE restarts the aging, so the board cannot launder a stale deal. */
export const moveDeal = (data: CrmData, dealId: string, stage: CrmStage) => {
  const deal = data.deals.find(item => item.id === dealId);
  if (!deal) return;
  if (deal.stage !== stage) { deal.stage = stage; deal.stageEnteredAt = now(); }
  deal.status = "Offen"; deal.closedAt = null;
};
export const closeDeal = (data: CrmData, dealId: string, status: Exclude<DealStatus, "Offen">) => {
  const deal = data.deals.find(item => item.id === dealId);
  if (deal) { deal.status = status; deal.closedAt = now(); }
};
export const softDeleteDeal = (data: CrmData, dealId: string) => {
  const deal = data.deals.find(item => item.id === dealId);
  if (deal) deal.deletedAt = now();
};
/** Deleting an organization takes its deals with it, so Trash can put back the whole
 *  record rather than a shell without its history. */
export const softDeleteOrganization = (data: CrmData, organizationId: string) => {
  const org = data.organizations.find(item => item.id === organizationId);
  if (!org) return;
  org.deletedAt = now();
  data.deals.filter(deal => deal.organizationId === organizationId && !deal.deletedAt).forEach(deal => { deal.deletedAt = org.deletedAt; });
};
export const restore = (data: CrmData, recordId: string) => {
  const deal = data.deals.find(item => item.id === recordId);
  if (deal) { deal.deletedAt = null; const org = data.organizations.find(item => item.id === deal.organizationId); if (org) org.deletedAt = null; return; }
  const org = data.organizations.find(item => item.id === recordId);
  if (org) { const stamp = org.deletedAt; org.deletedAt = null; data.deals.filter(item => item.organizationId === org.id && item.deletedAt === stamp).forEach(item => { item.deletedAt = null; }); }
};
export const purge = (data: CrmData, recordId: string) => {
  data.deals = data.deals.filter(deal => deal.id !== recordId && deal.organizationId !== recordId);
  data.organizations = data.organizations.filter(org => org.id !== recordId);
};
/** Convert: a lead organization becomes a real opportunity without losing the record. */
export const convertToDeal = (data: CrmData, organizationId: string, stage: CrmStage = "Qualified"): Deal | undefined => {
  const org = data.organizations.find(item => item.id === organizationId);
  if (!org) return undefined;
  const deal = { ...emptyDeal(org.id, org.name, org.owner), stage, labels: [...org.labels] };
  data.deals.unshift(deal);
  return deal;
};

/** ── Persistence and migration ───────────────────────────────────────────── */
const stageOf = (value: unknown): CrmStage =>
  value === "Verhandlung" ? "Abgeschlossen" : value === "Gewonnen" ? "Abgeschlossen"
    : CRM_STAGES.includes(value as CrmStage) ? value as CrmStage : "Non-Qualified";

/** v1 -> v2. Every v1 account becomes an organization; its deals (or, for records
 *  written before deals existed, one synthesized deal) become deals; notes and
 *  activities that v1 hung on LOCATIONS move onto the organization's first deal,
 *  because a conversation is about an opportunity, not about an address. */
export const migrateV1 = (accounts: any[]): CrmData => {
  const data: CrmData = { version: 2, organizations: [], deals: [], labels: [], pipelineStages: defaultPipelineStages(), activities: [] };
  const label = (name: string) => ensureLabel(data, name);
  for (const account of accounts ?? []) {
    const locations: Location[] = (account.locations ?? []).map((loc: any) => ({
      id: loc.id ?? id("location"), name: loc.name ?? "", address: loc.address ?? "", employees: loc.employees ?? "",
      emails: loc.emails ?? [], phones: loc.phones ?? [], contacts: loc.contacts ?? [],
    }));
    const org: Organization = {
      id: account.id ?? id("org"), name: account.name ?? "Unbenannt", website: account.website ?? "", employees: account.employees ?? "",
      decisionMaker: account.decisionMaker ?? "", software: account.software ?? "", source: account.source ?? "", owner: account.owner ?? "",
      labels: (account.labels ?? []).map(label), locations: locations.length ? locations : [emptyLocation(account.name ?? "")],
      createdAt: account.createdAt ?? now(), deletedAt: null,
    };
    data.organizations.push(org);
    const perSite = account.dealScope === "Standorte";
    const source: any[] = account.deals?.length ? account.deals
      : perSite ? (account.locations ?? []).map((loc: any) => ({ title: loc.name, stage: loc.stage, status: loc.status, locationId: loc.id, nextStep: loc.nextStep, nextStepDate: loc.nextStepDate }))
        : [{ title: account.name, stage: account.stage, status: account.status, nextStep: account.locations?.[0]?.nextStep, nextStepDate: account.locations?.[0]?.nextStepDate }];
    source.forEach((raw: any, index: number) => {
      const wasWon = raw.status === "Gewonnen" || raw.stage === "Gewonnen";
      const wasLost = raw.status === "Verloren";
      data.deals.push({
        id: raw.id ?? id("deal"), organizationId: org.id, locationId: raw.locationId ?? null, title: raw.title || org.name,
        stage: stageOf(raw.stage), status: wasWon ? "Gewonnen" : wasLost ? "Verloren" : "Offen",
        owner: raw.owner ?? org.owner, source: raw.source ?? org.source, value: raw.value ?? "", currency: raw.currency ?? "EUR", expectedClose: raw.expectedClose ?? "",
        labels: (raw.labels ?? account.labels ?? []).map(label), nextStep: raw.nextStep ?? "", nextStepDate: raw.nextStepDate ?? "",
        notes: [...(raw.notes ?? []), ...(index === 0 ? (account.locations ?? []).flatMap((loc: any) => loc.notes ?? []) : [])]
          .map((note: any) => ({ id: note.id ?? id("note"), title: note.title ?? "Notiz", body: note.body ?? "", author: note.author ?? "", createdAt: note.createdAt ?? now() })),
        activities: [...(raw.activities ?? []), ...(index === 0 ? (account.locations ?? []).flatMap((loc: any) => loc.activities ?? []) : [])].map(normalizeActivity),
        files: [...(raw.files ?? []), ...(index === 0 ? (account.locations ?? []).flatMap((loc: any) => loc.files ?? []) : [])],
        createdAt: raw.createdAt ?? now(), stageEnteredAt: raw.stageEnteredAt ?? raw.createdAt ?? now(), closedAt: wasWon || wasLost ? (raw.closedAt ?? now()) : null, deletedAt: null,
      });
    });
  }
  data.labels = withStarterLabels(data.labels);
  return data;
};

export const seed = (): CrmData => {
  const org = emptyOrganization("Beispiel Optik GmbH", "Jannes");
  org.employees = "12"; org.source = "Beispieldaten";
  org.locations = [
    { ...emptyLocation("Beispiel Optik · Mitte"), address: "Musterstraße 12\n10115 Berlin", employees: "7", emails: ["kontakt@beispiel-optik.de"], phones: ["030 123456"], contacts: [{ id: id("contact"), name: "Max Mustermann", role: "Inhaber", emails: ["max@beispiel-optik.de"], phones: ["030 123456"], preferred: "Telefon" }] },
    { ...emptyLocation("Beispiel Optik · Prenzlauer Berg"), address: "Musterallee 4\n10405 Berlin", employees: "5" },
  ];
  const data: CrmData = { version: 2, organizations: [org], deals: [], labels: withStarterLabels([]), pipelineStages: defaultPipelineStages(), activities: [] };
  org.labels = [ensureLabel(data, "Gründungskunde")];
  const deal = { ...emptyDeal(org.id, "Beispiel Optik GmbH", "Jannes"), stage: "Qualified" as CrmStage, nextStep: "Erstgespräch terminieren", labels: [...org.labels], source: "Beispieldaten" };
  data.deals.push(deal);
  return data;
};

/** Normalizes any shape (v2, v1, junk) into a valid v2 document. */
export const normalize = (raw: any): CrmData => {
  if (!raw) return seed();
  if (Array.isArray(raw)) return migrateV1(raw);
  if (raw.version === 2 && Array.isArray(raw.organizations) && Array.isArray(raw.deals)) {
    return {
      version: 2,
      pipelineStages: normalizePipelineStages(raw.pipelineStages),
      // The inbox is additive: a document written before unlinked activities existed
      // reads back as an empty inbox, never as a missing field.
      activities: (Array.isArray(raw.activities) ? raw.activities : []).map(normalizeActivity),
      labels: withStarterLabels((raw.labels ?? []).map((label: any, index: number) => ({ id: label.id ?? id("label"), name: label.name ?? "", color: label.color ?? LABEL_COLORS[index % LABEL_COLORS.length] }))),
      organizations: raw.organizations.map((org: any) => ({ ...emptyOrganization(org.name ?? ""), ...org, labels: org.labels ?? [], locations: org.locations?.length ? org.locations : [emptyLocation(org.name ?? "")], deletedAt: org.deletedAt ?? null })),
      // `probability` was a manual per-deal field in early v2 documents; the stage owns
      // it now, so it is dropped on read rather than carried as dead weight.
      deals: raw.deals.map(({ probability: _dropped, ...deal }: any) => ({ ...emptyDeal(deal.organizationId ?? "", deal.title ?? ""), ...deal, stage: stageOf(deal.stage), status: DEAL_STATUS.includes(deal.status) ? deal.status : "Offen", labels: deal.labels ?? [], notes: deal.notes ?? [], files: deal.files ?? [], activities: (deal.activities ?? []).map(normalizeActivity), deletedAt: deal.deletedAt ?? null, closedAt: deal.closedAt ?? null, stageEnteredAt: typeof deal.stageEnteredAt === "string" && deal.stageEnteredAt ? deal.stageEnteredAt : (deal.createdAt ?? now()) })),
    };
  }
  if (raw.accounts) return migrateV1(raw.accounts);
  return seed();
};

export const loadCrm = (): CrmData => {
  try {
    const rawV2 = localStorage.getItem(KEY_V2);
    if (rawV2) return normalize(JSON.parse(rawV2));
    const rawV1 = localStorage.getItem(KEY_V1);
    if (rawV1) { const migrated = migrateV1(JSON.parse(rawV1)); saveCrm(migrated); return migrated; }
    return seed();
  } catch { return seed(); }
};
export const saveCrm = (data: CrmData) => { try { localStorage.setItem(KEY_V2, JSON.stringify(data)); } catch { /* storage unavailable */ } };
