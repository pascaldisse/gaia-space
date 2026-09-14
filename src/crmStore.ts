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

export type Label = { id: string; name: string; color: string };
export type Contact = { id: string; name: string; role: string; emails: string[]; phones: string[]; preferred: string };
export type Note = { id: string; title: string; body: string; author: string; createdAt: string };
export type Activity = { id: string; kind: ActivityKind; title: string; dueDate: string; outcome: string; done: boolean };
export type CrmFile = { id: string; name: string; type: string; data: string; createdAt: string };
export type Location = { id: string; name: string; address: string; employees: string; emails: string[]; phones: string[]; contacts: Contact[] };
export type Organization = {
  id: string; name: string; website: string; employees: string; decisionMaker: string; software: string; source: string;
  owner: string; labels: string[]; locations: Location[]; createdAt: string; deletedAt: string | null;
};
export type Deal = {
  id: string; organizationId: string; locationId: string | null; title: string; stage: CrmStage; status: DealStatus;
  owner: string; source: string; value: string; currency: "EUR" | "CHF" | "USD"; probability: number; expectedClose: string; labels: string[]; nextStep: string; nextStepDate: string;
  notes: Note[]; activities: Activity[]; files: CrmFile[]; createdAt: string; closedAt: string | null; deletedAt: string | null;
};
export type CrmData = { version: 2; organizations: Organization[]; deals: Deal[]; labels: Label[] };

export const LABEL_COLORS = ["#00C2A8", "#2F6BFF", "#6B3D8B", "#B2500F", "#0F1B33", "#118C5C", "#8B2E5A", "#5A6473"] as const;

const KEY_V2 = "gaia.crm.prototype.v2";
const KEY_V1 = "gaia.crm.prototype.v1";
export const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export const emptyLocation = (name = ""): Location =>
  ({ id: id("location"), name, address: "", employees: "", emails: [], phones: [], contacts: [] });
export const emptyOrganization = (name: string, owner = ""): Organization =>
  ({ id: id("org"), name, website: "", employees: "", decisionMaker: "", software: "", source: "", owner, labels: [], locations: [emptyLocation(name)], createdAt: now(), deletedAt: null });
export const emptyDeal = (organizationId: string, title: string, owner = ""): Deal =>
  ({ id: id("deal"), organizationId, locationId: null, title, stage: "Non-Qualified", status: "Offen", owner, source: "", value: "", currency: "EUR", probability: 0, expectedClose: "", labels: [], nextStep: "", nextStepDate: "", notes: [], activities: [], files: [], createdAt: now(), closedAt: null, deletedAt: null });

/** ── Label library ───────────────────────────────────────────────────────── */
export const labelByName = (data: CrmData, name: string) =>
  data.labels.find(label => label.name.toLocaleLowerCase("de") === name.trim().toLocaleLowerCase("de"));
export const makeLabel = (name: string, index: number): Label =>
  ({ id: id("label"), name: name.trim(), color: LABEL_COLORS[index % LABEL_COLORS.length] });
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

/** ── Mutations (pure on a draft) ─────────────────────────────────────────── */
export const moveDeal = (data: CrmData, dealId: string, stage: CrmStage) => {
  const deal = data.deals.find(item => item.id === dealId);
  if (deal) { deal.stage = stage; deal.status = "Offen"; deal.closedAt = null; }
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
  const data: CrmData = { version: 2, organizations: [], deals: [], labels: [] };
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
        owner: raw.owner ?? org.owner, source: raw.source ?? org.source, value: raw.value ?? "", expectedClose: raw.expectedClose ?? "",
        labels: (raw.labels ?? account.labels ?? []).map(label), nextStep: raw.nextStep ?? "", nextStepDate: raw.nextStepDate ?? "",
        notes: [...(raw.notes ?? []), ...(index === 0 ? (account.locations ?? []).flatMap((loc: any) => loc.notes ?? []) : [])]
          .map((note: any) => ({ id: note.id ?? id("note"), title: note.title ?? "Notiz", body: note.body ?? "", author: note.author ?? "", createdAt: note.createdAt ?? now() })),
        activities: [...(raw.activities ?? []), ...(index === 0 ? (account.locations ?? []).flatMap((loc: any) => loc.activities ?? []) : [])],
        files: [...(raw.files ?? []), ...(index === 0 ? (account.locations ?? []).flatMap((loc: any) => loc.files ?? []) : [])],
        createdAt: raw.createdAt ?? now(), closedAt: wasWon || wasLost ? (raw.closedAt ?? now()) : null, deletedAt: null,
      });
    });
  }
  return data;
};

export const seed = (): CrmData => {
  const org = emptyOrganization("Beispiel Optik GmbH", "Jannes");
  org.employees = "12"; org.source = "Beispieldaten";
  org.locations = [
    { ...emptyLocation("Beispiel Optik · Mitte"), address: "Musterstraße 12\n10115 Berlin", employees: "7", emails: ["kontakt@beispiel-optik.de"], phones: ["030 123456"], contacts: [{ id: id("contact"), name: "Max Mustermann", role: "Inhaber", emails: ["max@beispiel-optik.de"], phones: ["030 123456"], preferred: "Telefon" }] },
    { ...emptyLocation("Beispiel Optik · Prenzlauer Berg"), address: "Musterallee 4\n10405 Berlin", employees: "5" },
  ];
  const data: CrmData = { version: 2, organizations: [org], deals: [], labels: [] };
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
      labels: (raw.labels ?? []).map((label: any, index: number) => ({ id: label.id ?? id("label"), name: label.name ?? "", color: label.color ?? LABEL_COLORS[index % LABEL_COLORS.length] })),
      organizations: raw.organizations.map((org: any) => ({ ...emptyOrganization(org.name ?? ""), ...org, labels: org.labels ?? [], locations: org.locations?.length ? org.locations : [emptyLocation(org.name ?? "")], deletedAt: org.deletedAt ?? null })),
      deals: raw.deals.map((deal: any) => ({ ...emptyDeal(deal.organizationId ?? "", deal.title ?? ""), ...deal, stage: stageOf(deal.stage), status: DEAL_STATUS.includes(deal.status) ? deal.status : "Offen", labels: deal.labels ?? [], notes: deal.notes ?? [], activities: deal.activities ?? [], files: deal.files ?? [], deletedAt: deal.deletedAt ?? null, closedAt: deal.closedAt ?? null })),
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
