import { createEffect, createSignal, For, Index, Show, on, onCleanup, onMount } from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import ConfirmDialog from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import DateField from "../components/DateField";
import { PillMenu } from "../components/controls";
import { navigate, route } from "../router";
import {
  ACTIVITY_KINDS, CRM_STAGES, PIPELINE_STAGES, WON_PROBABILITY, activitiesOf, activityEntries, closeDeal, convertToDeal, customers as customerOrgs,
  activityState, emptyActivity, filterActivityEntries, setActivityDone,
  archiveLead, archivedLeads, convertLead, leadInbox, restoreLead,
  createDeal, createOrganization, emptyRecordInput,
  dealAmount, dealProbability, dealsOf, emptyLocation, ensureLabel, id, live, loadCrm,
  moveDeal, notesOf, openDeals, organizationOf, purge, restore, restoreActivity, saveCrm, setPipelineStages, softDeleteActivity, softDeleteDeal, softDeleteOrganization,
  purgeActivity, updateActivity, linkActivity,
  stageAge, stageName, stageProbability, trash,
  type Activity, type ActivityKind, type Contact, type CrmData, type CrmStage, type Deal, type DealStatus, type Label, type Location,
  type Organization, type PipelineStage, type RecordInput, type DealInput,
  LEAD_STATE_LABELS,
} from "../crmStore";
import { importLeads, type ImportRow } from "../crmImport";
import CrmImportDialog from "./CrmImportDialog";
import CrmExportDialog from "./CrmExportDialog";
import CrmActivities, { ActivityEditor, draftOfActivity, type ActivityDraft } from "./CrmActivities";
import CrmInsights from "./CrmInsights";
import "./CRM.css";

const split = (value: string) => value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const date = (value: string) => value ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "Kein Termin";
const stamp = (value: string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const money = (amount: number, currency: Deal["currency"] = "EUR") => new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

/** The CRM's work views. Each is route state (§router.crmTabs), so the rail can
 *  highlight one and a link opens the same surface. */
type CrmTab = "leads" | "pipeline" | "open" | "won" | "lost" | "trash" | "activities" | "customers" | "insights";
const tabOf = (tab: string | undefined): CrmTab =>
  (["leads", "pipeline", "open", "won", "lost", "trash", "activities", "customers", "insights"] as CrmTab[]).includes(tab as CrmTab) ? tab as CrmTab : "pipeline";
const CRM_OWNERS = ["Nicht zugeteilt", "Jannes", "Bjarne", "Charles", "Pascal"] as const;
const TAB_TITLE: Record<CrmTab, string> = {
  leads: "Leads", pipeline: "Pipeline", open: "Offene Deals", won: "Gewonnene Deals", lost: "Verlorene Deals",
  trash: "Papierkorb", activities: "Aktivitäten", customers: "Kunden", insights: "Einblicke",
};
/** What is being dragged is a RECORD, not a card: a deal moves through stages or to an
 *  outcome, an organization converts into a deal. One model, so the drop zones can say
 *  truthfully what they will do with the thing in flight. */
type DragTarget = { kind: "deal" | "org"; id: string };
type Selection = { kind: "deal" | "org"; id: string } | null;

export default function CRM() {
  const [data, setData] = createSignal<CrmData>(loadCrm());
  const [selected, setSelected] = createSignal<Selection>(null);
  const [query, setQuery] = createSignal("");
  const [labelFilter, setLabelFilter] = createSignal<string[]>([]);
  const [filterOwner, setFilterOwner] = createSignal("Alle");
  const [newOpen, setNewOpen] = createSignal(false);
  /** The inbox has two shelves, not two views: same table, same filters, one flag. */
  const [leadScope, setLeadScope] = createSignal<"inbox" | "archive">("inbox");
  const [convertTarget, setConvertTarget] = createSignal<string | null>(null);
  const [importOpen, setImportOpen] = createSignal(false);
  /** Export is a GLOBAL right, not a view: the data belongs to the person wherever they
   *  stand in the CRM, so the action is offered on every tab and the scope is chosen in
   *  the dialog rather than implied by the list that happens to be open. */
  const [exportOpen, setExportOpen] = createSignal(false);
  const [stageSettingsOpen, setStageSettingsOpen] = createSignal(false);
  const [tab, setTab] = createSignal<CrmTab>(tabOf(route().tab));
  createEffect(() => setTab(tabOf(route().tab)));
  createEffect(() => saveCrm(data()));

  const mutate = (fn: (draft: CrmData) => void) => setData(current => { const next = structuredClone(current); fn(next); return next; });
  const orgOf = (deal: Deal) => organizationOf(data(), deal);
  const labels = () => data().labels;
  const owners = () => ["Alle", ...Array.from(new Set(live(data().organizations).map(org => org.owner).filter(Boolean)))];

  const matchesOrg = (org: Organization | undefined) => {
    if (!org) return false;
    const q = query().trim().toLocaleLowerCase("de");
    const haystack = `${org.name} ${org.locations.map(loc => `${loc.name} ${loc.address}`).join(" ")}`.toLocaleLowerCase("de");
    return (!q || haystack.includes(q)) && (filterOwner() === "Alle" || org.owner === filterOwner());
  };
  const matchesLabels = (own: string[], org: Organization | undefined) =>
    !labelFilter().length || labelFilter().every(labelId => own.includes(labelId) || !!org?.labels.includes(labelId));
  const dealMatches = (deal: Deal) => matchesOrg(orgOf(deal)) && matchesLabels(deal.labels, orgOf(deal));
  const orgMatches = (org: Organization) => matchesOrg(org) && matchesLabels(org.labels, org);

  /** The board renders DEALS. An organization is a record, not a card in a sales stage. */
  const boardDeals = () => openDeals(data()).filter(dealMatches);
  const listFor = (tabName: CrmTab): Deal[] => {
    const all = live(data().deals).filter(dealMatches);
    if (tabName === "open") return all.filter(deal => deal.status === "Offen");
    if (tabName === "won") return all.filter(deal => deal.status === "Gewonnen");
    if (tabName === "lost") return all.filter(deal => deal.status === "Verloren");
    return all;
  };

  const [drag, setDrag] = createSignal<(DragTarget & { x: number; y: number }) | null>(null);
  const [dragOverStage, setDragOverStage] = createSignal<CrmStage | null>(null);
  const [dropHint, setDropHint] = createSignal<string | null>(null);
  let candidate: (DragTarget & { x: number; y: number }) | null = null;
  let suppressClick = false;

  /** Creating is CONTEXT-SPECIFIC: the toolbar offers the record the current tab is
   *  about, and each form asks for that record's facts. All three write through the
   *  store's creation functions (§createOrganization/§createDeal), so a typed record is
   *  indistinguishable from an imported one and the lead invariant holds either way. */
  const addLead = (input: RecordInput) => {
    let created: string | undefined;
    mutate(draft => { created = createOrganization(draft, input).id; });
    setNewOpen(false);
    setLeadScope("inbox");
    navigate({ view: "CRM", tab: "leads" });
    if (created) setSelected({ kind: "org", id: created });
  };
  /** A hand-typed organization is not a customer: nothing has been won yet, so it goes
   *  where untriaged records live and the view SAYS so rather than filing it silently
   *  into a list it does not belong in. */
  const addOrganization = (input: RecordInput) => {
    let created: string | undefined;
    mutate(draft => { created = createOrganization(draft, input).id; });
    setNewOpen(false);
    setLeadScope("inbox");
    navigate({ view: "CRM", tab: "leads" });
    if (created) setSelected({ kind: "org", id: created });
  };
  const addDeal = (input: DealInput) => {
    let created: string | undefined;
    mutate(draft => { created = createDeal(draft, input)?.id; });
    setNewOpen(false);
    if (created) setSelected({ kind: "deal", id: created });
  };
  /** One name for "what does + mean here", read by the button and by the form. */
  const createKind = (): "lead" | "deal" | "organization" | null =>
    tab() === "leads" ? "lead"
      : tab() === "pipeline" || tab() === "open" || tab() === "won" || tab() === "lost" ? "deal"
        : tab() === "customers" ? "organization" : null;
  const createLabel = () => ({ lead: "Neuer Lead", deal: "Neuer Deal", organization: "Neue Organisation" })[createKind() as "lead"] ?? "";
  /** Import writes through the SAME draft mutation as every other CRM change, so the
   *  imported records are persisted, filtered and searched exactly like typed ones. */
  const runImport = (rows: ImportRow[]) => {
    let outcome = { imported: 0, skipped: 0, names: [] as string[] };
    mutate(draft => { outcome = importLeads(draft, rows); });
    if (outcome.imported) { setLeadScope("inbox"); navigate({ view: "CRM", tab: "leads" }); }
    return outcome;
  };
  const addDealFor = (organizationId: string) => {
    let created: string | undefined;
    mutate(draft => { created = convertToDeal(draft, organizationId)?.id; });
    if (created) setSelected({ kind: "deal", id: created });
  };

  /** One place decides what a drop MEANS, so board, list and zones cannot disagree. */
  const applyDrop = (target: DragTarget, action: "stage" | "won" | "lost" | "delete" | "convert", stage?: CrmStage) => {
    mutate(draft => {
      if (target.kind === "org") {
        if (action === "delete") return softDeleteOrganization(draft, target.id);
        const deal = convertToDeal(draft, target.id, stage ?? "Qualified");
        if (deal && action === "won") closeDeal(draft, deal.id, "Gewonnen");
        if (deal && action === "lost") closeDeal(draft, deal.id, "Verloren");
        return;
      }
      if (action === "stage" && stage) moveDeal(draft, target.id, stage);
      if (action === "won") closeDeal(draft, target.id, "Gewonnen");
      if (action === "lost") closeDeal(draft, target.id, "Verloren");
      if (action === "delete") softDeleteDeal(draft, target.id);
    });
  };

  onMount(() => {
    const moved = (event: PointerEvent) => {
      if (!candidate) return;
      if (!drag() && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 6) return;
      setDrag({ ...candidate, x: event.clientX, y: event.clientY });
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-crm-stage], [data-crm-zone]");
      setDragOverStage((element?.dataset.crmStage as CrmStage | undefined) ?? null);
      setDropHint(element?.dataset.crmZone ?? null);
    };
    const released = (event: PointerEvent) => {
      const active = drag();
      if (active) {
        const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-crm-stage], [data-crm-zone]");
        const stage = element?.dataset.crmStage as CrmStage | undefined;
        const zone = element?.dataset.crmZone as "won" | "lost" | "delete" | "convert" | undefined;
        if (stage) applyDrop(active, active.kind === "org" ? "convert" : "stage", stage);
        else if (zone) applyDrop(active, zone, undefined);
        suppressClick = true;
      }
      candidate = null; setDrag(null); setDragOverStage(null); setDropHint(null);
    };
    window.addEventListener("pointermove", moved); window.addEventListener("pointerup", released);
    onCleanup(() => { window.removeEventListener("pointermove", moved); window.removeEventListener("pointerup", released); });
  });
  const startDrag = (target: DragTarget) => (event: PointerEvent) => { candidate = { ...target, x: event.clientX, y: event.clientY }; };
  const openRecord = (selection: Selection) => { if (suppressClick) { suppressClick = false; return; } setSelected(selection); };

  /** Leads are the organizations that stand in the triage, NOT "everything unwon": an
   *  open or lost deal belongs to the pipeline and its lists, never back in the inbox. */
  const inboxLeads = () => leadInbox(data()).filter(orgMatches);
  const archiveLeads = () => archivedLeads(data()).filter(orgMatches);
  const visibleLeads = () => leadScope() === "archive" ? archiveLeads() : inboxLeads();
  const filtersActive = () => !!query().trim() || !!labelFilter().length || filterOwner() !== "Alle";
  const convertOrg = () => data().organizations.find(org => org.id === convertTarget());
  const runConvert = (stage: CrmStage, value: string) => {
    const orgId = convertTarget();
    if (!orgId) return;
    let created: string | undefined;
    mutate(draft => { created = convertLead(draft, orgId, { stage, value })?.id; });
    setConvertTarget(null);
    if (created) setSelected({ kind: "deal", id: created });
  };

  const count = () => tab() === "pipeline" ? boardDeals().length
    : tab() === "leads" ? visibleLeads().length
      : tab() === "customers" ? customerOrgs(data()).filter(orgMatches).length
        // The trash counts what the trash LISTS — a deleted activity is a deleted record,
        // so the header cannot say "0" over a list with a row in it.
        : tab() === "trash" ? trash(data()).deals.length + trash(data()).organizations.length + trash(data()).activities.length
          : tab() === "activities" ? filterActivityEntries(activityEntries(data()), "todo").length
            : tab() === "insights" ? live(data().deals).length : listFor(tab()).length;
  /** Insights carries its OWN filters (date range, owner), so the record-search toolbar
   *  would be a second, contradicting set of controls over the same numbers. */
  const chipLabel = () => tab() === "insights" ? " ausgewertete Deals" : ` ${TAB_TITLE[tab()]}`;
  /** Weighting reads the stage, never the deal: one source of truth for the forecast. */
  const probabilityOf = (stage: CrmStage) => stageProbability(data(), stage);
  const weighted = (deal: Deal) => dealAmount(deal) * dealProbability(data(), deal) / 100;

  return <section class="crm-view">
    <PageHeader icon="columns" title="CRM" subline="Organisationen, Deals und Aktivitäten im Vertrieb." chips={<Chip value={count()} label={chipLabel()} />} />
    <nav class="page-actionbar crm-toolbar" aria-label="CRM actions">
      <Show when={tab() !== "insights"}>
        <div class="crm-search"><Icon name="search" size={17} /><input value={query()} onInput={e => setQuery(e.currentTarget.value)} placeholder="Organisation, Standort oder Adresse suchen" aria-label="CRM durchsuchen" /></div>
        <LabelPicker label="Labels" selected={labelFilter()} library={labels()} onChange={setLabelFilter} />
        <PillMenu class="crm-owner-filter" label="Nach verantwortlicher Person filtern" value={filterOwner()}
          options={owners().map(owner => ({ value: owner, label: owner }))} onChange={setFilterOwner} />
      </Show>
      {/* Importing is a LEAD action: it is offered where leads are triaged, and it names
          what it does — a file becomes records in this inbox, not "data" somewhere. */}
      <Show when={tab() === "leads"}>
        <button class="crm-import-trigger" onClick={() => setImportOpen(true)}><Icon name="upload" size={16} /> Importieren</button>
      </Show>
      {/* Exporting is offered EVERYWHERE, including insights and trash: "how do I get my
          customer data out" must never depend on which tab is open. */}
      <button class="crm-export-trigger" onClick={() => setExportOpen(true)}><Icon name="download" size={16} /> Exportieren</button>
      {/* Trash, activities and insights create nothing: an action that cannot mean
          anything in the current view is not offered. */}
      <Show when={createKind()}>
        <button class="primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={16} /> {createLabel()}</button>
      </Show>
    </nav>
    <Show when={importOpen()}><CrmImportDialog data={data} onImport={runImport} onClose={() => setImportOpen(false)} /></Show>
    <Show when={exportOpen()}><CrmExportDialog data={data} onClose={() => setExportOpen(false)} /></Show>
    <Show when={newOpen() && createKind() === "lead"}><NewLead data={data} owners={CRM_OWNERS} onClose={() => setNewOpen(false)} onSave={addLead} onCreateLabel={name => { let labelId = ""; mutate(draft => { labelId = ensureLabel(draft, name); }); return labelId; }} /></Show>
    <Show when={newOpen() && createKind() === "deal"}><NewDeal data={data} owners={CRM_OWNERS} onClose={() => setNewOpen(false)} onSave={addDeal} /></Show>
    <Show when={newOpen() && createKind() === "organization"}><NewOrganization owners={CRM_OWNERS} onClose={() => setNewOpen(false)} onSave={addOrganization} /></Show>
    <Show when={stageSettingsOpen()}><PipelineSettings stages={data().pipelineStages} onClose={() => setStageSettingsOpen(false)} onSave={stages => { mutate(draft => setPipelineStages(draft, stages)); setStageSettingsOpen(false); }} /></Show>
    <Show when={drag()}>{active => <>
      <div class="crm-drag-ghost" style={{ left: `${active().x + 14}px`, top: `${active().y + 14}px` }}>{active().kind === "deal" ? "Deal verschieben" : "Lead umwandeln"}</div>
    </>}</Show>

    <Show when={tab() === "pipeline"}>
      <section class="crm-pipeline">
        <div class="crm-pipeline-summary"><span><strong>{money(boardDeals().reduce((sum, deal) => sum + dealAmount(deal), 0))}</strong> Gesamtwert · <strong>{money(boardDeals().reduce((sum, deal) => sum + weighted(deal), 0))}</strong> gewichteter Pipelinewert · {boardDeals().length} offene Deals</span>
          <button class="ghost small crm-stage-settings-button" onClick={() => setStageSettingsOpen(true)}><Icon name="settings" size={14} /> Pipeline-Einstellungen</button></div>
        <div class="crm-board" aria-label="Vertriebspipeline">
          <For each={PIPELINE_STAGES}>{stage => {
            const inStage = () => boardDeals().filter(deal => deal.stage === stage);
            return <section class="crm-column" data-crm-stage={stage} classList={{ "is-drop-target": dragOverStage() === stage }}>
              <header><strong>{stageName(data(), stage)}</strong><span>{inStage().length} · {probabilityOf(stage)}% · {money(inStage().reduce((sum, deal) => sum + weighted(deal), 0))} gewichtet</span></header>
              <div class="crm-column-cards"><For each={inStage()}>{deal => <DealCard deal={deal} org={orgOf(deal)} library={labels()} probability={probabilityOf(deal.stage)} onPointerDown={startDrag({ kind: "deal", id: deal.id })} onOpen={() => openRecord({ kind: "deal", id: deal.id })} />}</For></div>
            </section>;
          }}</For>
        </div>
        <DropZones active={drag()} hint={dropHint()} />
      </section>
    </Show>

    {/* THE LEAD INBOX. A list, deliberately not a board: triage is reading a queue and
        deciding — open, convert, archive — not dragging a thing through phases. The
        phases belong to the pipeline, and an unqualified enquiry has none. */}
    <Show when={tab() === "leads"}>
      <section class="crm-directory crm-lead-inbox">
        <header><div><h2>Lead-Posteingang</h2>
          <p>Anfragen, aus denen noch kein Vorgang geworden ist. Sie stehen in keiner Pipeline und in keiner Auswertung — erst das Umwandeln macht daraus einen Deal.</p></div>
          <span>{visibleLeads().length}</span></header>
        {/* Archive is a SHELF of this list, not a second place: same columns, same
            filters, one count each, so "where did it go" is answered on screen. */}
        <div class="crm-lead-scope" role="tablist" aria-label="Lead-Ablage">
          <button role="tab" aria-selected={leadScope() === "inbox"} classList={{ active: leadScope() === "inbox" }} onClick={() => setLeadScope("inbox")}>Posteingang <i>{inboxLeads().length}</i></button>
          <button role="tab" aria-selected={leadScope() === "archive"} classList={{ active: leadScope() === "archive" }} onClick={() => setLeadScope("archive")}>Archiv <i>{archiveLeads().length}</i></button>
        </div>
        <div class="crm-directory-table crm-lead-table">
          <div class="crm-directory-head"><span>Lead · Organisation</span><span>Labels</span><span>Quelle</span><span>Verantwortlich</span><span>Eingegangen</span><span>Nächster Schritt</span><span>Aktionen</span></div>
          <For each={visibleLeads()}>{org => <div class="crm-lead-row" role="button" tabindex="0" onPointerDown={startDrag({ kind: "org", id: org.id })} onClick={() => openRecord({ kind: "org", id: org.id })}>
            <strong>{org.name}</strong>
            <span class="crm-lead-labels"><LabelChips ids={org.labels} library={labels()} /></span>
            {/* The REASON it is still a lead has to be readable: source first, and an
                unnamed source says so instead of leaving a blank cell. */}
            <span classList={{ "crm-lead-unknown": !org.source }}>{org.source || "Quelle unbekannt"}</span>
            <span>{org.owner || "Nicht zugeteilt"}</span>
            <span>{date(org.createdAt.slice(0, 10))}</span>
            <span classList={{ "crm-lead-unknown": !org.nextStep }}>{org.nextStep || "Kein nächster Schritt"}</span>
            <span class="crm-lead-actions" onClick={event => event.stopPropagation()}>
              <Show when={org.leadState === "active"} fallback={<button class="ghost small" onClick={() => mutate(draft => restoreLead(draft, org.id))}>Wiederherstellen</button>}>
                <button class="ghost small" onClick={() => setConvertTarget(org.id)}>In Deal umwandeln</button>
                <button class="ghost small" onClick={() => mutate(draft => archiveLead(draft, org.id))}>Archivieren</button>
              </Show>
              <button class="ghost small danger" aria-label={`Lead ${org.name} in den Papierkorb`} onClick={() => { mutate(draft => softDeleteOrganization(draft, org.id)); }}><Icon name="trash" size={14} /></button>
            </span>
          </div>}</For>
        </div>
        {/* Three different silences, three different sentences: filtered out, emptied
            archive, or nothing has ever arrived. */}
        <Show when={!visibleLeads().length}>
          <p class="crm-empty">{filtersActive() ? "Kein Lead passt zu Suche und Filtern."
            : leadScope() === "archive" ? "Das Archiv ist leer. Archivierte Leads bleiben hier auffindbar und lassen sich wiederherstellen."
              : "Der Posteingang ist leer. Neue Anfragen — Website, Empfehlung, Messe — landen hier und werden von hier aus umgewandelt oder archiviert."}</p>
        </Show>
        <DropZones active={drag()} hint={dropHint()} />
      </section>
    </Show>
    <Show when={convertOrg()}>{org => <ConvertLead org={org()} data={data} onClose={() => setConvertTarget(null)} onConvert={runConvert} />}</Show>

    <Show when={tab() === "open" || tab() === "won" || tab() === "lost"}>
      <DealTable title={TAB_TITLE[tab()]} status={tab() === "won" ? "Gewonnen" : tab() === "lost" ? "Verloren" : "Offen"}
        deals={() => listFor(tab())} data={data} onOpen={dealId => setSelected({ kind: "deal", id: dealId })} onOpenOrg={orgId => setSelected({ kind: "org", id: orgId })} />
    </Show>

    <Show when={tab() === "customers"}>
      <OrganizationTable title="Kunden" hint="Organisationen mit mindestens einem gewonnenen Deal." orgs={() => customerOrgs(data()).filter(orgMatches)} data={data} onOpen={orgId => setSelected({ kind: "org", id: orgId })} />
    </Show>

    <Show when={tab() === "insights"}>
      <CrmInsights data={data} onOpen={target => navigate({ view: "CRM", tab: target })} />
    </Show>

    <Show when={tab() === "activities"}>
      <CrmActivities data={data} mutate={mutate} owners={CRM_OWNERS.map(owner => owner === "Nicht zugeteilt" ? "" : owner)}
        onOpenDeal={dealId => setSelected({ kind: "deal", id: dealId })} onOpenOrg={orgId => setSelected({ kind: "org", id: orgId })} />
    </Show>

    <Show when={tab() === "trash"}>
      <section class="crm-directory">
        <header><div><h2>Papierkorb</h2><p>Gelöschte Datensätze bleiben auffindbar und lassen sich wiederherstellen — Organisationen, Deals und Aktivitäten.</p></div><span>{trash(data()).deals.length + trash(data()).organizations.length + trash(data()).activities.length}</span></header>
        <div class="crm-trash-list">
          <For each={trash(data()).organizations}>{org => <div class="crm-trash-row"><span><strong>{org.name}</strong><small>Organisation · gelöscht {stamp(org.deletedAt!)}</small></span>
            <button class="ghost small" onClick={() => mutate(draft => restore(draft, org.id))}>Wiederherstellen</button>
            <button class="ghost small danger" onClick={() => mutate(draft => purge(draft, org.id))}>Endgültig löschen</button></div>}</For>
          <For each={trash(data()).deals.filter(deal => !trash(data()).organizations.some(org => org.id === deal.organizationId))}>{deal => <div class="crm-trash-row"><span><strong>{deal.title}</strong><small>Deal · {stageName(data(), deal.stage)} · gelöscht {stamp(deal.deletedAt!)}</small></span>
            <button class="ghost small" onClick={() => mutate(draft => restore(draft, deal.id))}>Wiederherstellen</button>
            <button class="ghost small danger" onClick={() => mutate(draft => purge(draft, deal.id))}>Endgültig löschen</button></div>}</For>
          {/* A deleted activity keeps its home, so the row can say where it goes back to. */}
          <For each={trash(data()).activities}>{entry => <div class="crm-trash-row crm-trash-activity"><span><strong>{entry.activity.title || entry.activity.kind}</strong>
            <small>Aktivität · {entry.activity.kind} · {entry.deal ? entry.deal.title : "Posteingang"} · gelöscht {stamp(entry.activity.deletedAt!)}</small></span>
            <button class="ghost small" onClick={() => mutate(draft => { restoreActivity(draft, entry.activity.id); })}>Wiederherstellen</button>
            <button class="ghost small danger" onClick={() => mutate(draft => { purgeActivity(draft, entry.activity.id); })}>Endgültig löschen</button></div>}</For>
        </div>
        <Show when={!trash(data()).deals.length && !trash(data()).organizations.length && !trash(data()).activities.length}><p class="crm-empty">Der Papierkorb ist leer.</p></Show>
      </section>
    </Show>

    <Show when={selected()}>{selection => <>
      <Show when={selection().kind === "deal"}>
        <DealPanel dealId={selection().id} data={data} onMutate={mutate} onClose={() => setSelected(null)} onOpenOrg={orgId => setSelected({ kind: "org", id: orgId })} />
      </Show>
      <Show when={selection().kind === "org"}>
        <OrganizationPanel orgId={selection().id} data={data} onMutate={mutate} onClose={() => setSelected(null)} onOpenDeal={dealId => setSelected({ kind: "deal", id: dealId })} onAddDeal={() => addDealFor(selection().id)} />
      </Show>
    </>}</Show>
  </section>;
}

/** The four things a drag can mean, named on screen while the record is in flight. */
function DropZones(props: { active: DragTarget | null; hint: string | null }) {
  const zones = [
    { key: "convert", label: "In Pipeline", tone: "" },
    { key: "won", label: "Gewonnen", tone: "won" },
    { key: "lost", label: "Verloren", tone: "lost" },
    { key: "delete", label: "Papierkorb", tone: "lost" },
  ] as const;
  return <Show when={props.active}>
    <div class="crm-terminal-zones"><span>{props.active?.kind === "deal" ? "Deal ablegen" : "Lead ablegen"}</span>
      <For each={zones.filter(zone => zone.key !== "convert" || props.active?.kind === "org")}>{zone =>
        <div data-crm-zone={zone.key} class={`crm-drop-zone ${zone.tone}`} classList={{ "is-over": props.hint === zone.key }}>{zone.label}</div>}</For>
    </div>
  </Show>;
}

function LabelChips(props: { ids: string[]; library: Label[] }) {
  const chips = () => props.ids.map(labelId => props.library.find(label => label.id === labelId)).filter((label): label is Label => !!label);
  return <Show when={chips().length}><span class="crm-labels"><For each={chips()}>{label =>
    <i style={{ background: `${label.color}1f`, color: label.color }}>{label.name}</i>}</For></span></Show>;
}

/** One searchable multiselect over the CENTRAL label library: filtering and tagging use
 *  the same control, so a label can never exist in two spellings on two surfaces. */
function LabelPicker(props: { label: string; selected: string[]; library: Label[]; onChange: (ids: string[]) => void; onCreate?: (name: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const matches = () => props.library.filter(label => label.name.toLocaleLowerCase("de").includes(search().trim().toLocaleLowerCase("de")));
  const exact = () => props.library.some(label => label.name.toLocaleLowerCase("de") === search().trim().toLocaleLowerCase("de"));
  const toggle = (labelId: string) => props.onChange(props.selected.includes(labelId) ? props.selected.filter(item => item !== labelId) : [...props.selected, labelId]);
  let root: HTMLDivElement | undefined;
  onMount(() => {
    const away = (event: MouseEvent) => { if (root && !root.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    onCleanup(() => document.removeEventListener("mousedown", away));
  });
  return <div class="crm-labelpicker" ref={root}>
    <button type="button" class="crm-labelpicker-trigger" aria-haspopup="listbox" aria-expanded={open()} onClick={() => setOpen(value => !value)}>
      <Icon name="tag" size={14} />{props.selected.length ? `${props.label} (${props.selected.length})` : props.label}
    </button>
    <Show when={open()}>
      <div class="crm-labelpicker-menu" role="listbox">
        <input autofocus value={search()} onInput={e => setSearch(e.currentTarget.value)} placeholder="Suchen oder neues Label eingeben…" aria-label="Label suchen oder erstellen" />
        <div class="crm-labelpicker-options">
          <For each={matches()}>{label => <label class="crm-labelpicker-option">
            <input type="checkbox" checked={props.selected.includes(label.id)} onChange={() => toggle(label.id)} />
            <i class="crm-label-dot" style={{ background: label.color }} />{label.name}
          </label>}</For>
          <Show when={!matches().length && !search().trim()}><p class="crm-empty">Noch keine Labels angelegt.</p></Show>
        </div>
        <Show when={props.onCreate && !search().trim()}><p class="crm-labelpicker-hint">Neuen Namen eingeben, um ein Label anzulegen.</p></Show>
        <Show when={props.onCreate && search().trim() && !exact()}>
          <button type="button" class="crm-labelpicker-create" onClick={() => { props.onCreate!(search().trim()); setSearch(""); }}>
            <Icon name="plus" size={13} /> „{search().trim()}“ anlegen
          </button>
        </Show>
        <Show when={props.selected.length}><button type="button" class="crm-labelpicker-clear" onClick={() => props.onChange([])}>Auswahl leeren</button></Show>
      </div>
    </Show>
  </div>;
}

/** Aging is shown, never shouted: a thin accent on the card edge carries the tone, the
 *  same fact is spelled out in words for anyone who does not see colour. */
function DealCard(props: { deal: Deal; org: Organization | undefined; library: Label[]; probability: number; onPointerDown: (event: PointerEvent) => void; onOpen: () => void }) {
  const age = () => stageAge(props.deal);
  return <div class="crm-card" data-stage-age={age().tone} role="button" tabindex="0" onPointerDown={props.onPointerDown} onClick={props.onOpen}>
    <strong>{props.deal.title}</strong>
    <span class="crm-card-account">{props.org?.name ?? "Ohne Organisation"}</span>
    <LabelChips ids={[...props.deal.labels, ...(props.org?.labels ?? []).filter(labelId => !props.deal.labels.includes(labelId))]} library={props.library} />
    <Show when={props.deal.nextStep}><span class="crm-card-next"><Icon name="alert" size={14} />{props.deal.nextStep}</span></Show>
    <span class="crm-card-age" data-stage-age={age().tone}><Icon name="clock" size={12} /><span aria-label={age().hint}>{age().label}</span></span>
    <footer><span>{props.deal.owner || "Nicht zugeteilt"}</span><span>{money(dealAmount(props.deal), props.deal.currency)}<Show when={props.probability > 0}> · {props.probability}%</Show></span></footer>
  </div>;
}

function DealTable(props: { title: string; status: Deal["status"]; deals: () => Deal[]; data: () => CrmData; onOpen: (dealId: string) => void; onOpenOrg: (orgId: string) => void }) {
  const outcome = () => props.status;
  const total = () => props.deals().reduce((sum, deal) => sum + dealAmount(deal), 0);
  const outcomeLabel = () => outcome() === "Gewonnen" ? "Gewonnener Deal-Wert" : outcome() === "Verloren" ? "Verlorenes Deal-Volumen" : "Offener Deal-Wert";
  return <section class="crm-directory crm-deal-directory" classList={{ "is-won": outcome() === "Gewonnen", "is-lost": outcome() === "Verloren" }}>
    <header><div><h2>{props.title}</h2><p>Ein Deal ist die Verkaufschance; die Organisation dahinter bleibt bestehen.</p></div><span>{props.deals().length} Deal{props.deals().length === 1 ? "" : "s"}</span></header>
    <Show when={outcome() !== "Offen"}><div class="crm-outcome-summary"><span>{outcome() === "Gewonnen" ? "✓" : "×"} {outcome()}</span><strong>{money(total())}</strong><small>{outcomeLabel()}</small></div></Show>
    <div class="crm-directory-table crm-deal-table">
      <div class="crm-directory-head"><span>Deal</span><span>Organisation</span><span>Status</span><span>Deal-Wert</span><span>Abgeschlossen am</span><span>Verantwortlich</span></div>
      <For each={props.deals()}>{deal => <button onClick={() => props.onOpen(deal.id)}>
        <strong>{deal.title}</strong>
        <span class="crm-link" onClick={event => { event.stopPropagation(); const org = organizationOf(props.data(), deal); if (org) props.onOpenOrg(org.id); }}>{organizationOf(props.data(), deal)?.name ?? "—"}</span>
        <span class="crm-stage-chip">{deal.status === "Offen" ? stageName(props.data(), deal.stage) : deal.status}</span>
        <strong class="crm-deal-value">{money(dealAmount(deal), deal.currency)}</strong>
        <span>{deal.closedAt ? date(deal.closedAt.slice(0, 10)) : "—"}</span><span>{deal.owner || "—"}</span>
      </button>}</For>
    </div>
    <Show when={!props.deals().length}><p class="crm-empty">Keine Einträge in dieser Ansicht.</p></Show>
  </section>;
}

function OrganizationTable(props: { title: string; hint: string; orgs: () => Organization[]; data: () => CrmData; onOpen: (orgId: string) => void }) {
  return <section class="crm-directory">
    <header><div><h2>{props.title}</h2><p>{props.hint}</p></div><span>{props.orgs().length}</span></header>
    <div class="crm-directory-table">
      <div class="crm-directory-head"><span>Organisation</span><span>Standorte</span><span>Deals</span><span>Offene Aktivitäten</span><span>Verantwortlich</span></div>
      <For each={props.orgs()}>{org => <button onClick={() => props.onOpen(org.id)}>
        <strong>{org.name}</strong>
        <span>{org.locations.length}</span>
        <span class="crm-stage-chip">{dealsOf(props.data(), org.id).length} Deal(s)</span>
        <span>{activitiesOf(props.data(), org.id).filter(entry => !entry.activity.done).length}</span>
        <span>{org.owner || "—"}</span>
      </button>}</For>
    </div>
    <Show when={!props.orgs().length}><p class="crm-empty">Keine Einträge in dieser Ansicht.</p></Show>
  </section>;
}

/** Converting is a DECISION, so it asks the one question the pipeline needs (which
 *  phase) and offers the one number that is usually known (the value) — nothing else.
 *  Everything the record already holds travels with it untouched; this dialog says so,
 *  because "will I lose my notes" is the reason people avoid converting at all. */
function ConvertLead(props: { org: Organization; data: () => CrmData; onClose: () => void; onConvert: (stage: CrmStage, value: string) => void }) {
  const [stage, setStage] = createSignal<CrmStage>("Qualified");
  const [value, setValue] = createSignal("");
  return <div class="crm-overlay" role="presentation"><form class="crm-modal" onSubmit={e => { e.preventDefault(); props.onConvert(stage(), value()); }}>
    <header><h2>Lead in Deal umwandeln</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
    <p><strong>{props.org.name}</strong>{props.org.source ? ` · Quelle: ${props.org.source}` : " · Quelle unbekannt"}</p>
    <label>Pipeline-Phase<select value={stage()} onChange={e => setStage(e.currentTarget.value as CrmStage)}>
      <For each={CRM_STAGES}>{item => <option value={item}>{stageName(props.data(), item)} · {stageProbability(props.data(), item)}%</option>}</For></select></label>
    <label>Deal-Wert (optional)<input inputmode="decimal" value={value()} onInput={e => setValue(e.currentTarget.value.replace(/[^0-9,.]/g, ""))} placeholder="z. B. 12.500" /></label>
    <p>Organisation, Standorte, Ansprechpartner, Dateien, Labels und Quelle bleiben an diesem Datensatz und gehen in den Deal über. Der Lead verlässt den Posteingang und kann nur einmal umgewandelt werden.</p>
    <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary">Deal anlegen</button></footer>
  </form></div>;
}

/** ── Creating a LEAD ─────────────────────────────────────────────────────────
 *  An enquiry arrives with a company name and, if we are lucky, a person, a number and
 *  an address. Exactly one field is required, because demanding more is how enquiries
 *  end up unrecorded; everything else is offered and stored where it belongs — the
 *  address and the person on the record's location, not loose on the organization. */
function NewLead(props: { data: () => CrmData; owners: readonly string[]; onClose: () => void; onSave: (input: RecordInput) => void; onCreateLabel: (name: string) => string }) {
  const [form, setForm] = createSignal<RecordInput>(emptyRecordInput({ owner: "", source: "" }));
  const patch = (values: Partial<RecordInput>) => setForm(current => ({ ...current, ...values }));
  const valid = () => !!form().name.trim();
  return <div class="crm-overlay" role="presentation"><form class="crm-modal crm-create-form" onSubmit={e => { e.preventDefault(); if (valid()) props.onSave(form()); }}>
    <header><h2>Neuen Lead anlegen</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
    <p>Ein Lead ist eine Anfrage, noch kein Vorgang: Er steht im Posteingang, in keiner Pipeline und in keiner Auswertung — bis er umgewandelt wird.</p>
    <label>Organisation / Firma<input autofocus required value={form().name} onInput={e => patch({ name: e.currentTarget.value })} placeholder="z. B. Optik Musterstadt" /></label>
    <div class="crm-fields two">
      <label>Quelle<input value={form().source} onInput={e => patch({ source: e.currentTarget.value })} placeholder="z. B. Website-Formular, Messe, Empfehlung" /></label>
      <label>Verantwortliche Person<select value={form().owner} onChange={e => patch({ owner: e.currentTarget.value })}>
        <For each={props.owners}>{owner => <option value={owner === "Nicht zugeteilt" ? "" : owner}>{owner}</option>}</For></select></label>
      <label>Ansprechpartner<input value={form().contactName} onInput={e => patch({ contactName: e.currentTarget.value })} placeholder="Name der Kontaktperson" /></label>
      <label>Position<input value={form().contactRole} onInput={e => patch({ contactRole: e.currentTarget.value })} placeholder="z. B. Inhaberin" /></label>
      <label>E-Mail<input type="email" value={form().email} onInput={e => patch({ email: e.currentTarget.value })} placeholder="kontakt@beispiel.de" /></label>
      <label>Telefon<input value={form().phone} onInput={e => patch({ phone: e.currentTarget.value })} placeholder="030 123456" /></label>
      <label>Website<input value={form().website} onInput={e => patch({ website: e.currentTarget.value })} placeholder="beispiel-optik.de" /></label>
      <label>Standortname<input value={form().locationName} onInput={e => patch({ locationName: e.currentTarget.value })} placeholder="Leer = Name der Organisation" /></label>
    </div>
    <label>Adresse<textarea value={form().address} onInput={e => patch({ address: e.currentTarget.value })} placeholder="Straße, Hausnummer&#10;PLZ Ort" /></label>
    <label>Nächster Schritt<input value={form().nextStep} onInput={e => patch({ nextStep: e.currentTarget.value })} placeholder="z. B. Rückruf vereinbaren" /></label>
    <div class="crm-label-field"><span>Labels</span>
      <LabelPicker label="Labels wählen" selected={form().labels} library={props.data().labels} onChange={labels => patch({ labels })}
        onCreate={name => { const labelId = props.onCreateLabel(name); if (labelId) patch({ labels: [...form().labels, labelId] }); }} />
      <LabelChips ids={form().labels} library={props.data().labels} />
    </div>
    <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary" disabled={!valid()}>Lead anlegen</button></footer>
  </form></div>;
}

/** ── Creating a DEAL ─────────────────────────────────────────────────────────
 *  A deal is always ABOUT an organization, so the form either points at an existing
 *  record or names a new one — never a deal without a counterpart. Probability is not
 *  asked: it belongs to the phase (§PipelineSettings). */
function NewDeal(props: { data: () => CrmData; owners: readonly string[]; onClose: () => void; onSave: (input: DealInput) => void }) {
  const orgs = () => live(props.data().organizations);
  const [form, setForm] = createSignal<DealInput>({
    organizationId: orgs()[0]?.id ?? "", newOrganizationName: "", title: "", stage: "Qualified",
    value: "", currency: "EUR", owner: "", source: "", expectedClose: "",
  });
  const patch = (values: Partial<DealInput>) => setForm(current => ({ ...current, ...values }));
  const [mode, setMode] = createSignal<"existing" | "new">(orgs().length ? "existing" : "new");
  const orgName = () => mode() === "new" ? form().newOrganizationName.trim() : orgs().find(org => org.id === form().organizationId)?.name ?? "";
  const valid = () => !!orgName();
  const submit = () => props.onSave(mode() === "new"
    ? { ...form(), organizationId: "" }
    : { ...form(), newOrganizationName: "" });
  return <div class="crm-overlay" role="presentation"><form class="crm-modal crm-create-form" onSubmit={e => { e.preventDefault(); if (valid()) submit(); }}>
    <header><h2>Neuen Deal anlegen</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
    <label>Titel<input autofocus value={form().title} onInput={e => patch({ title: e.currentTarget.value })} placeholder={orgName() ? `Leer = „${orgName()}“` : "z. B. Filialausstattung 2027"} /></label>
    <div class="crm-deal-org-choice" role="radiogroup" aria-label="Organisation des Deals">
      <label><input type="radio" name="crm-deal-org" checked={mode() === "existing"} disabled={!orgs().length} onChange={() => setMode("existing")} />Bestehende Organisation</label>
      <label><input type="radio" name="crm-deal-org" checked={mode() === "new"} onChange={() => setMode("new")} />Neue Organisation anlegen</label>
    </div>
    <Show when={mode() === "existing"} fallback={
      <label>Name der neuen Organisation<input value={form().newOrganizationName} onInput={e => patch({ newOrganizationName: e.currentTarget.value })} placeholder="z. B. Optik Musterstadt" /></label>}>
      <label>Organisation<select aria-label="Organisation" value={form().organizationId} onChange={e => patch({ organizationId: e.currentTarget.value })}>
        <For each={orgs()}>{org => <option value={org.id}>{org.name}</option>}</For></select></label>
    </Show>
    <div class="crm-fields two">
      <label>Pipeline-Phase<select aria-label="Pipeline-Phase" value={form().stage} onChange={e => patch({ stage: e.currentTarget.value as CrmStage })}>
        <For each={CRM_STAGES}>{stage => <option value={stage}>{stageName(props.data(), stage)} · {stageProbability(props.data(), stage)}%</option>}</For></select></label>
      <label>Verantwortliche Person<select value={form().owner} onChange={e => patch({ owner: e.currentTarget.value })}>
        <For each={props.owners}>{owner => <option value={owner === "Nicht zugeteilt" ? "" : owner}>{owner}</option>}</For></select></label>
      <label>Deal-Wert<input inputmode="decimal" aria-label="Deal-Wert" value={form().value} onInput={e => patch({ value: e.currentTarget.value.replace(/[^0-9,.]/g, "") })} placeholder="z. B. 12.500" /></label>
      <label>Währung<select aria-label="Währung" value={form().currency} onChange={e => patch({ currency: e.currentTarget.value as Deal["currency"] })}>
        <option value="EUR">EUR (€)</option><option value="CHF">CHF</option><option value="USD">USD ($)</option></select></label>
      <label>Quelle<input value={form().source} onInput={e => patch({ source: e.currentTarget.value })} placeholder="z. B. Empfehlung" /></label>
      <label>Erwarteter Abschluss<DateField label="Erwarteter Abschluss" value={form().expectedClose} onChange={expectedClose => patch({ expectedClose })} placeholder="Datum wählen" /></label>
    </div>
    <p>Der Deal erscheint sofort in der Pipeline; die Organisation verlässt damit den Lead-Posteingang.</p>
    <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary" disabled={!valid()}>Deal anlegen</button></footer>
  </form></div>;
}

/** ── Creating an ORGANIZATION ────────────────────────────────────────────────
 *  Typed from the customer list, but a customer it is NOT: nothing has been won yet.
 *  The form says which record it is really making and where to find it afterwards,
 *  instead of filing it into a list whose definition it does not meet. */
function NewOrganization(props: { owners: readonly string[]; onClose: () => void; onSave: (input: RecordInput) => void }) {
  const [form, setForm] = createSignal<RecordInput>(emptyRecordInput({ owner: "", source: "" }));
  const patch = (values: Partial<RecordInput>) => setForm(current => ({ ...current, ...values }));
  const valid = () => !!form().name.trim();
  return <div class="crm-overlay" role="presentation"><form class="crm-modal crm-create-form" onSubmit={e => { e.preventDefault(); if (valid()) props.onSave(form()); }}>
    <header><h2>Neue Organisation anlegen</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
    <label>Name<input autofocus required value={form().name} onInput={e => patch({ name: e.currentTarget.value })} placeholder="z. B. Optik Musterstadt" /></label>
    <div class="crm-fields two">
      <label>Website<input value={form().website} onInput={e => patch({ website: e.currentTarget.value })} placeholder="beispiel-optik.de" /></label>
      <label>Mitarbeitende<input value={form().employees} onInput={e => patch({ employees: e.currentTarget.value })} placeholder="z. B. 12" /></label>
      <label>Entscheider<input value={form().decisionMaker} onInput={e => patch({ decisionMaker: e.currentTarget.value })} placeholder="Name" /></label>
      <label>Branchensoftware<input value={form().software} onInput={e => patch({ software: e.currentTarget.value })} /></label>
      <label>Quelle<input value={form().source} onInput={e => patch({ source: e.currentTarget.value })} placeholder="z. B. Empfehlung" /></label>
      <label>Verantwortliche Person<select value={form().owner} onChange={e => patch({ owner: e.currentTarget.value })}>
        <For each={props.owners}>{owner => <option value={owner === "Nicht zugeteilt" ? "" : owner}>{owner}</option>}</For></select></label>
      <label>Ansprechpartner<input value={form().contactName} onInput={e => patch({ contactName: e.currentTarget.value })} placeholder="Name der Kontaktperson" /></label>
      <label>Position<input value={form().contactRole} onInput={e => patch({ contactRole: e.currentTarget.value })} placeholder="z. B. Inhaberin" /></label>
      <label>E-Mail<input type="email" value={form().email} onInput={e => patch({ email: e.currentTarget.value })} placeholder="kontakt@beispiel.de" /></label>
      <label>Telefon<input value={form().phone} onInput={e => patch({ phone: e.currentTarget.value })} placeholder="030 123456" /></label>
      <label>Standortname<input value={form().locationName} onInput={e => patch({ locationName: e.currentTarget.value })} placeholder="Leer = Name der Organisation" /></label>
      <label>Nächster Schritt<input value={form().nextStep} onInput={e => patch({ nextStep: e.currentTarget.value })} placeholder="z. B. Bedarf klären" /></label>
    </div>
    <label>Adresse<textarea value={form().address} onInput={e => patch({ address: e.currentTarget.value })} placeholder="Straße, Hausnummer&#10;PLZ Ort" /></label>
    <p class="crm-create-hint">Kunde wird diese Organisation erst mit einem <strong>gewonnenen Deal</strong>. Bis dahin steht sie als Lead im Posteingang — dort „In Deal umwandeln“ wählen, um eine Verkaufschance zu starten.</p>
    <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary" disabled={!valid()}>Organisation anlegen</button></footer>
  </form></div>;
}

/** Pipeline settings: rename a phase and set what winning from there is worth. Ids and
 *  order are fixed, so an edit here can never strand a deal or reshuffle the board. */
function PipelineSettings(props: { stages: PipelineStage[]; onClose: () => void; onSave: (stages: PipelineStage[]) => void }) {
  const [draft, setDraft] = createSignal<PipelineStage[]>(props.stages.map(stage => ({ ...stage })));
  const patch = (stageId: CrmStage, values: Partial<PipelineStage>) =>
    setDraft(current => current.map(stage => stage.id === stageId ? { ...stage, ...values } : stage));
  return <div class="crm-overlay" role="presentation"><form class="crm-modal crm-stage-settings" onSubmit={e => { e.preventDefault(); props.onSave(draft()); }}>
    <header><h2>Pipeline-Einstellungen</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
    <p>Die Gewinnwahrscheinlichkeit gehört zur Phase: Jeder Deal in einer Phase rechnet mit diesem Prozentsatz. Gewonnene Deals zählen automatisch mit {WON_PROBABILITY} %.</p>
    <div class="crm-stage-settings-list">
      <div class="crm-stage-settings-head"><span>Phase</span><span>Wahrscheinlichkeit</span></div>
      {/* Index, not For: the rows are a fixed list of stages being EDITED, so a
          keystroke must patch a field, never rebuild the row and drop the caret. */}
      <Index each={draft()}>{stage => <div class="crm-stage-settings-row">
        <input aria-label={`Name der Phase ${stage().id}`} value={stage().name} onInput={e => patch(stage().id, { name: e.currentTarget.value })} />
        <div class="crm-percent-input">
          <input type="number" min="0" max="100" step="5" aria-label={`Wahrscheinlichkeit der Phase ${stage().id}`} value={stage().probability}
            onInput={e => patch(stage().id, { probability: Math.max(0, Math.min(100, Math.round(Number(e.currentTarget.value) || 0))) })} /><span>%</span>
        </div>
      </div>}</Index>
    </div>
    <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary">Speichern</button></footer>
  </form></div>;
}

/** A picture of where the deal stands, not a second set of controls: the stage is
 *  CHANGED in one place only (the PillMenu below), so this is a read-only list — no
 *  buttons, nothing that invites a click it cannot honour. Names come from the
 *  pipeline configuration, so a renamed phase reads the same here as on the board. */
function StageProgress(props: { data: () => CrmData; deal: Deal }) {
  const index = () => PIPELINE_STAGES.indexOf(props.deal.stage);
  const age = () => stageAge(props.deal);
  const currentName = () => stageName(props.data(), props.deal.stage);
  return <section class="crm-stage-progress" aria-label="Pipeline-Fortschritt">
    <ol class="crm-stepper">
      <For each={PIPELINE_STAGES}>{(stage, position) => {
        const state = () => position() < index() ? "done" : position() === index() ? "current" : "todo";
        return <li class="crm-step" data-state={state()} aria-current={state() === "current" ? "step" : undefined}>
          <i aria-hidden="true" /><span>{stageName(props.data(), stage)}</span>
        </li>;
      }}</For>
    </ol>
    <p class="crm-stage-age" data-stage-age={age().tone}>
      <strong>{currentName()}</strong> · seit {age().days} {age().days === 1 ? "Tag" : "Tagen"} in dieser Phase
    </p>
  </section>;
}

const Field = (props: { label: string; value: string; onChange: (value: string) => void }) =>
  <label>{props.label}<input value={props.value} onInput={e => props.onChange(e.currentTarget.value)} /></label>;

/** ── The save bar ────────────────────────────────────────────────────────────
 *  A record's fields are a DRAFT, so the panel must say, permanently and in one place,
 *  what is true right now: stored, or changed and not yet stored. It offers exactly the
 *  three answers to that state — commit everything, put the stored values back, or put
 *  the record in the trash (recoverable, named, never a browser box). */
function SaveBar(props: {
  dirty: boolean; savedAt: string | null; recordLabel: string;
  onSave: () => void; onDiscard: () => void; onDelete: () => void;
}) {
  return <div class="crm-save-bar" data-state={props.dirty ? "dirty" : "saved"} role="status" aria-live="polite">
    <span class="crm-save-state">
      <Icon name={props.dirty ? "alert" : "check"} size={15} />
      <span>
        <strong>{props.dirty ? "Nicht gespeicherte Änderungen" : props.savedAt ? "Änderungen gespeichert" : "Gespeichert"}</strong>
        <small>{props.dirty
          ? `Änderungen am ${props.recordLabel} werden erst mit „Speichern“ übernommen.`
          : props.savedAt ? `Zuletzt gespeichert um ${new Intl.DateTimeFormat("de-DE", { timeStyle: "medium" }).format(new Date(props.savedAt))}`
            : "Alle Felder entsprechen dem gespeicherten Stand."}</small>
      </span>
    </span>
    <span class="crm-save-actions">
      <button type="button" class="ghost" disabled={!props.dirty} onClick={props.onDiscard}>Änderungen verwerfen</button>
      <button type="button" class="primary" disabled={!props.dirty} onClick={props.onSave}><Icon name="check" size={14} /> Speichern</button>
      <button type="button" class="ghost danger crm-trash-action" onClick={props.onDelete}><Icon name="trash" size={14} /> In Papierkorb</button>
    </span>
  </div>;
}

/** The editable fields of a deal, as a form value. Stage, status and deletion are NOT
 *  here: they are decisions with their own buttons, not text being typed. */
type DealDraft = Pick<Deal, "organizationId" | "locationId" | "title" | "value" | "currency" | "source" | "owner" | "expectedClose" | "labels" | "nextStep" | "nextStepDate">;
const EMPTY_DEAL_DRAFT = (): DealDraft => ({
  organizationId: "", locationId: null, title: "", value: "", currency: "EUR", source: "", owner: "",
  expectedClose: "", labels: [], nextStep: "", nextStepDate: "",
});
const dealDraftOf = (deal: Deal): DealDraft => ({
  organizationId: deal.organizationId, locationId: deal.locationId, title: deal.title, value: deal.value,
  currency: deal.currency, source: deal.source, owner: deal.owner, expectedClose: deal.expectedClose,
  labels: [...deal.labels], nextStep: deal.nextStep, nextStepDate: deal.nextStepDate,
});

/** ── The deal panel: the opportunity and everything that happened inside it ────
 *  Typing edits a LOCAL draft; nothing reaches the document until „Speichern“. */
function DealPanel(props: { dealId: string; data: () => CrmData; onMutate: (fn: (draft: CrmData) => void) => void; onClose: () => void; onOpenOrg: (orgId: string) => void }) {
  const [tab, setTab] = createSignal<"Übersicht" | "Aktivitäten" | "Dokumente">("Übersicht");
  const deal = () => props.data().deals.find(item => item.id === props.dealId);
  // The panel follows the DRAFT's organization, so re-pointing a deal shows that
  // organization's locations immediately — while still being an unsaved change.
  const org = () => props.data().organizations.find(item => item.id === form().organizationId);
  const stored = () => { const current = deal(); return current ? dealDraftOf(current) : EMPTY_DEAL_DRAFT(); };
  const [form, setForm] = createSignal<DealDraft>(stored());
  const [savedAt, setSavedAt] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [confirmClose, setConfirmClose] = createSignal(false);
  /** Won and lost CLOSE the panel too, so they fall under the same law as the back
   *  button: a draft is never thrown away without being named. Deciding the outcome is
   *  exactly the moment the last typed figure — the agreed price — is still unsaved. */
  const [confirmOutcome, setConfirmOutcome] = createSignal<Exclude<DealStatus, "Offen"> | null>(null);
  createEffect(on(() => props.dealId, () => { setForm(stored()); setSavedAt(null); setConfirmOutcome(null); }));
  /** No silent loss: leaving with a dirty draft is a QUESTION, never a quiet discard. */
  const requestClose = () => dirty() ? setConfirmClose(true) : props.onClose();
  const finishDeal = (status: Exclude<DealStatus, "Offen">) => {
    props.onMutate(draft => closeDeal(draft, props.dealId, status));
    props.onClose();
    navigate({ view: "CRM", tab: status === "Gewonnen" ? "won" : "lost" });
  };
  const requestOutcome = (status: Exclude<DealStatus, "Offen">) => dirty() ? setConfirmOutcome(status) : finishDeal(status);
  const patch = (values: Partial<DealDraft>) => setForm(current => ({ ...current, ...values }));
  const dirty = () => JSON.stringify(stored()) !== JSON.stringify(form());
  const save = () => { const values = form(); props.onMutate(draft => { const found = draft.deals.find(item => item.id === props.dealId); if (found) Object.assign(found, values); }); setSavedAt(new Date().toISOString()); };
  const discard = () => setForm(stored());
  const withDeal = (fn: (draft: Deal, data: CrmData) => void) => props.onMutate(draft => { const found = draft.deals.find(item => item.id === props.dealId); if (found) fn(found, draft); });
  const [activityEdit, setActivityEdit] = createSignal<{ id: string; draft: ActivityDraft } | null>(null);
  /** Re-linking first, then the field write: the activity may have MOVED to another
   *  deal or to the inbox, and `updateActivity` must find it where it now lives. */
  const saveActivityEdit = (activityId: string, values: ActivityDraft) => props.onMutate(draft => {
    linkActivity(draft, activityId, values.dealId || null);
    updateActivity(draft, activityId, {
      kind: values.kind, title: values.title.trim(), dueDate: values.dueDate, dueTime: values.dueTime,
      duration: values.duration, priority: values.priority, owner: values.owner, outcome: values.outcome.trim(),
    });
  });
  let panel: HTMLElement | undefined;
  createEffect(() => { props.dealId; requestAnimationFrame(() => panel?.scrollTo({ top: 0 })); });
  return <Show when={deal()}>{current => <aside ref={panel} class="crm-detail" aria-label={`Deal ${current().title}`}>
    <header class="crm-detail-head"><div>
      <button class="crm-back" onClick={requestClose}><Icon name="chevron-left" size={17} /> Zurück</button>
      <Show when={org()}><p><button class="crm-link" onClick={() => props.onOpenOrg(org()!.id)}>{org()!.name === current().title ? "Organisation öffnen" : `Organisation: ${org()!.name}`}</button></p></Show>
      <h1>{current().title}</h1><span class="crm-record-kind">Deal</span>
    </div><button class="icon-button" onClick={requestClose} aria-label="Deal schließen"><Icon name="close" /></button></header>
    <ConfirmDialog open={confirmClose()} title="Änderungen verwerfen?"
      body={<>Am Deal <strong>{current().title}</strong> stehen nicht gespeicherte Änderungen. Beim Schließen gehen sie verloren.</>}
      confirmLabel="Verwerfen und schließen" cancelLabel="Weiter bearbeiten"
      onCancel={() => setConfirmClose(false)}
      onConfirm={() => { setConfirmClose(false); discard(); props.onClose(); }} />
    <StageProgress data={props.data} deal={current()} />
    <div class="crm-stage-row">
      <PillMenu class="crm-field-menu crm-stage-menu" label="Pipeline-Phase" value={current().stage} options={CRM_STAGES.map(stage => ({ value: stage, label: `${stageName(props.data(), stage)} · ${stageProbability(props.data(), stage)}%` }))} onChange={stage => props.onMutate(draft => moveDeal(draft, props.dealId, stage as CrmStage))} />
      <button class="ghost success" style={{ background: "#e6f6e8", color: "#118c5c", "border-color": "#118c5c" }} onClick={() => requestOutcome("Gewonnen")}>Gewonnen</button>
      <button class="ghost danger" onClick={() => requestOutcome("Verloren")}>Verloren</button>
    </div>
    <ConfirmDialog open={!!confirmOutcome()} title={`Deal als ${confirmOutcome() ?? ""} markieren?`}
      body={<>Am Deal <strong>{current().title}</strong> stehen nicht gespeicherte Änderungen. Sie werden mit dem Abschluss gespeichert.</>}
      confirmLabel="Speichern und abschließen" cancelLabel="Weiter bearbeiten"
      onCancel={() => setConfirmOutcome(null)}
      onConfirm={() => { const status = confirmOutcome(); setConfirmOutcome(null); if (!status) return; save(); finishDeal(status); }} />
    <p class="crm-status-line">Status: <strong>{current().status}</strong><Show when={current().closedAt}> · {stamp(current().closedAt!)}</Show></p>
    <SaveBar dirty={dirty()} savedAt={savedAt()} recordLabel="Deal" onSave={save} onDiscard={discard} onDelete={() => setConfirmDelete(true)} />
    <ConfirmDialog open={confirmDelete()} title="Deal in den Papierkorb?"
      body={<>Der Deal <strong>{current().title}</strong> verlässt Pipeline und Listen. Er bleibt im Papierkorb auffindbar und lässt sich von dort wiederherstellen.</>}
      confirmLabel="In Papierkorb" cancelLabel="Abbrechen"
      onCancel={() => setConfirmDelete(false)}
      onConfirm={() => { setConfirmDelete(false); props.onMutate(draft => softDeleteDeal(draft, props.dealId)); props.onClose(); }} />
    <nav class="crm-tabs"><For each={["Übersicht", "Aktivitäten", "Dokumente"] as const}>{name => <button classList={{ active: tab() === name }} onClick={() => setTab(name)}>{name}</button>}</For></nav>
    <Show when={tab() === "Übersicht"}><div class="crm-detail-body">
      <section class="crm-section"><h2>Deal</h2><div class="crm-fields two">
        <label>Verknüpfter Kunde / Organisation<select value={form().organizationId} onChange={e => patch({ organizationId: e.currentTarget.value, locationId: null })}><For each={props.data().organizations.filter(item => !item.deletedAt)}>{item => <option value={item.id}>{item.name}</option>}</For></select></label>
        <Field label="Titel" value={form().title} onChange={title => patch({ title })} />
        <label>Deal-Wert<input inputmode="decimal" value={form().value} onInput={e => patch({ value: e.currentTarget.value.replace(/[^0-9,.]/g, "") })} placeholder="z. B. 12.500" /></label>
        <label>Währung<select value={form().currency} onChange={e => patch({ currency: e.currentTarget.value as Deal["currency"] })}><option value="EUR">EUR (€)</option><option value="CHF">CHF</option><option value="USD">USD ($)</option></select></label>
        {/* Probability is not a deal field: it is the phase's, so moving the card is the
            only honest way to change it. Won counts fully, lost not at all. */}
        <label>Gewinnwahrscheinlichkeit<output class="crm-readonly-field">{dealProbability(props.data(), current())}%<small>{current().status === "Offen" ? `aus Phase „${stageName(props.data(), current().stage)}“` : `Status ${current().status}`}</small></output><small>Gewichteter Deal-Wert: {money(dealAmount(current()) * dealProbability(props.data(), current()) / 100, current().currency)}</small></label>
        <Field label="Quelle" value={form().source} onChange={source => patch({ source })} />
        <label>Verantwortliche Person<PillMenu class="crm-field-menu" label="Verantwortliche Person" value={form().owner} options={CRM_OWNERS.map(owner => ({ value: owner === "Nicht zugeteilt" ? "" : owner, label: owner }))} onChange={owner => patch({ owner })} /></label>
        <label>Erwarteter Abschluss<DateField label="Erwarteter Abschluss" value={form().expectedClose} onChange={expectedClose => patch({ expectedClose })} placeholder="Datum wählen" /></label>
        <label>Standort<select value={form().locationId ?? ""} onChange={e => patch({ locationId: e.currentTarget.value || null })}>
          <option value="">Kein bestimmter Standort</option><For each={org()?.locations ?? []}>{loc => <option value={loc.id}>{loc.name || "Unbenannter Standort"}</option>}</For></select></label>
      </div>
      <div class="crm-label-field"><span>Labels</span>
        {/* The label LIBRARY is shared property and is written at once; which labels this
            deal wears is a field of the draft like any other. */}
        <LabelPicker label="Labels wählen" selected={form().labels} library={props.data().labels} onChange={labels => patch({ labels })}
          onCreate={name => { let labelId = ""; props.onMutate(draft => { labelId = ensureLabel(draft, name); }); if (labelId) patch({ labels: [...form().labels, labelId] }); }} />
        <LabelChips ids={form().labels} library={props.data().labels} />
      </div></section>
      <section class="crm-section"><h2>Nächster Schritt</h2><div class="crm-next-fields">
        <Field label="Aufgabe / nächster Kontakt" value={form().nextStep} onChange={nextStep => patch({ nextStep })} />
        <label>Fällig am<DateField label="Fällig am" value={form().nextStepDate} onChange={nextStepDate => patch({ nextStepDate })} placeholder="Datum wählen" /></label>
      </div></section>
      <Notes notes={current().notes} onAdd={(title, body) => withDeal(draft => { if (body.trim()) draft.notes.unshift({ id: id("note"), title: title.trim() || "Notiz", body: body.trim(), author: "Team paloptic", createdAt: new Date().toISOString() }); })} />
    </div></Show>
    <Show when={tab() === "Aktivitäten"}>
      <Activities activities={live(current().activities)}
        onAdd={(kind, title, due, outcome) => withDeal(draft => {
          if (!title.trim()) return;
          draft.activities.unshift(emptyActivity({ kind, title: title.trim(), dueDate: due, outcome: outcome.trim(), owner: draft.owner }));
          if (outcome.trim()) draft.notes.unshift({ id: id("note"), title: `${kind}: ${title.trim()}`, body: outcome.trim(), author: "Team paloptic", createdAt: new Date().toISOString() });
        })}
        onEdit={activity => setActivityEdit({ id: activity.id, draft: draftOfActivity(activity, props.dealId) })}
        onToggle={activityId => props.onMutate(draft => { const found = draft.deals.find(item => item.id === props.dealId)?.activities.find(item => item.id === activityId); if (found) setActivityDone(draft, activityId, !found.done); })} />
    </Show>
    {/* The feed edits the SAME activity with the SAME editor the workspace uses — one
        form, one set of rules, so a deal-owned activity cannot drift from an inbox one. */}
    <Show when={activityEdit()}>{editing =>
      <ActivityEditor data={props.data()} owners={CRM_OWNERS.map(owner => owner === "Nicht zugeteilt" ? "" : owner)} mode="edit" initial={editing().draft}
        onClose={() => setActivityEdit(null)}
        onSave={values => { saveActivityEdit(editing().id, values); setActivityEdit(null); }}
        onDelete={() => { props.onMutate(draft => { softDeleteActivity(draft, editing().id); }); setActivityEdit(null); }} />}</Show>
    <Show when={tab() === "Dokumente"}>
      <Files files={current().files} onAdd={file => withDeal(draft => { draft.files.unshift(file); })} />
    </Show>
  </aside>}</Show>;
}

/** The editable facts of an organization, INCLUDING its locations and their contacts:
 *  an address and a person are location facts, so they belong to the same draft and are
 *  committed by the same „Speichern“ — never half saved. */
type OrgDraft = Pick<Organization, "name" | "website" | "decisionMaker" | "employees" | "software" | "source" | "owner" | "nextStep" | "labels" | "locations">;
const orgDraftOf = (org: Organization): OrgDraft => structuredClone({
  name: org.name, website: org.website, decisionMaker: org.decisionMaker, employees: org.employees,
  software: org.software, source: org.source, owner: org.owner, nextStep: org.nextStep,
  labels: org.labels, locations: org.locations,
});
const EMPTY_ORG_DRAFT = (): OrgDraft => ({ name: "", website: "", decisionMaker: "", employees: "", software: "", source: "", owner: "", nextStep: "", labels: [], locations: [] });

/** ── The organization panel: the durable record, with its deals rolled up ──────
 *  Same law as the deal panel: fields are a draft, „Speichern“ commits, „Änderungen
 *  verwerfen“ restores the stored record, „In Papierkorb“ asks first and is undoable. */
function OrganizationPanel(props: { orgId: string; data: () => CrmData; onMutate: (fn: (draft: CrmData) => void) => void; onClose: () => void; onOpenDeal: (dealId: string) => void; onAddDeal: () => void }) {
  const [tab, setTab] = createSignal<"Stammdaten" | "Deals" | "Verlauf">("Stammdaten");
  const [locationId, setLocationId] = createSignal<string | null>(null);
  const org = () => props.data().organizations.find(item => item.id === props.orgId);
  const stored = () => { const current = org(); return current ? orgDraftOf(current) : EMPTY_ORG_DRAFT(); };
  const [form, setForm] = createSignal<OrgDraft>(stored());
  const [savedAt, setSavedAt] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [confirmClose, setConfirmClose] = createSignal(false);
  createEffect(on(() => props.orgId, () => { setForm(stored()); setSavedAt(null); setLocationId(null); }));
  const requestClose = () => dirty() ? setConfirmClose(true) : props.onClose();
  const patch = (values: Partial<OrgDraft>) => setForm(current => ({ ...current, ...values }));
  const dirty = () => JSON.stringify(stored()) !== JSON.stringify(form());
  const save = () => { const values = structuredClone(form()); props.onMutate(draft => { const found = draft.organizations.find(item => item.id === props.orgId); if (found) Object.assign(found, values); }); setSavedAt(new Date().toISOString()); };
  const discard = () => setForm(stored());
  const location = () => form().locations.find(loc => loc.id === locationId()) ?? form().locations[0];
  const patchLocation = (values: Partial<Location>) => {
    const target = location();
    if (target) patch({ locations: form().locations.map(loc => loc.id === target.id ? { ...loc, ...values } : loc) });
  };
  const deals = () => dealsOf(props.data(), props.orgId);
  const isCustomerNow = () => deals().some(deal => deal.status === "Gewonnen");
  /** ONE line says what this record is right now, and while it is still a lead it also
   *  says WHY — the stored state, not a guess from the absence of a win. */
  return <Show when={org()}>{current => <aside class="crm-detail" aria-label={`Organisation ${current().name}`}>
    <header class="crm-detail-head"><div>
      <button class="crm-back" onClick={requestClose}><Icon name="chevron-left" size={17} /> Zurück</button>
      <p class="crm-record-standing">{isCustomerNow() ? "Kunde"
        : current().leadState === "converted" ? "Organisation mit laufendem Deal"
          : `Lead · ${LEAD_STATE_LABELS[current().leadState]}${current().source ? ` · ${current().source}` : " · Quelle unbekannt"}`}</p>
      <h1>{current().name}</h1><span class="crm-record-kind">Organisation</span>
    </div><button class="icon-button" onClick={requestClose} aria-label="Organisation schließen"><Icon name="close" /></button></header>
    <ConfirmDialog open={confirmClose()} title="Änderungen verwerfen?"
      body={<>An <strong>{current().name}</strong> stehen nicht gespeicherte Änderungen. Beim Schließen gehen sie verloren.</>}
      confirmLabel="Verwerfen und schließen" cancelLabel="Weiter bearbeiten"
      onCancel={() => setConfirmClose(false)}
      onConfirm={() => { setConfirmClose(false); discard(); props.onClose(); }} />
    <div class="crm-stage-row">
      <button class="ghost success" style={{ background: "#e6f6e8", color: "#118c5c", "border-color": "#118c5c" }} onClick={props.onAddDeal}><Icon name="plus" size={14} /> Deal anlegen</button>
      <Show when={current().leadState === "active"}>
        <button class="ghost" onClick={() => props.onMutate(draft => archiveLead(draft, props.orgId))}>Lead archivieren</button>
      </Show>
      <Show when={current().leadState === "archived"}>
        <button class="ghost" onClick={() => props.onMutate(draft => restoreLead(draft, props.orgId))}>Aus Archiv holen</button>
      </Show>
    </div>
    <SaveBar dirty={dirty()} savedAt={savedAt()} recordLabel="Datensatz" onSave={save} onDiscard={discard} onDelete={() => setConfirmDelete(true)} />
    <ConfirmDialog open={confirmDelete()} title="Organisation in den Papierkorb?"
      body={<>Die Organisation <strong>{current().name}</strong> und ihre {deals().length} Deal(s) verlassen alle Listen. Sie bleiben im Papierkorb auffindbar und lassen sich von dort wiederherstellen.</>}
      confirmLabel="In Papierkorb" cancelLabel="Abbrechen"
      onCancel={() => setConfirmDelete(false)}
      onConfirm={() => { setConfirmDelete(false); props.onMutate(draft => softDeleteOrganization(draft, props.orgId)); props.onClose(); }} />
    <nav class="crm-tabs"><For each={["Stammdaten", "Deals", "Verlauf"] as const}>{name => <button classList={{ active: tab() === name }} onClick={() => setTab(name)}>{name}</button>}</For></nav>
    <Show when={tab() === "Stammdaten"}><div class="crm-detail-body">
      <section class="crm-section"><h2>Organisation</h2><div class="crm-fields two">
        <Field label="Name" value={form().name} onChange={name => patch({ name })} />
        <Field label="Website" value={form().website} onChange={website => patch({ website })} />
        <Field label="Entscheider" value={form().decisionMaker} onChange={decisionMaker => patch({ decisionMaker })} />
        <Field label="Mitarbeitende gesamt" value={form().employees} onChange={employees => patch({ employees })} />
        <Field label="Branchensoftware" value={form().software} onChange={software => patch({ software })} />
        <Field label="Quelle" value={form().source} onChange={source => patch({ source })} />
        <label>Verantwortliche Person<PillMenu class="crm-field-menu" label="Verantwortliche Person" value={form().owner} options={CRM_OWNERS.map(owner => ({ value: owner === "Nicht zugeteilt" ? "" : owner, label: owner }))} onChange={owner => patch({ owner })} /></label>
        {/* The lead's one planned move; it travels into the deal on conversion. */}
        <Field label="Nächster Schritt" value={form().nextStep} onChange={nextStep => patch({ nextStep })} />
        <label>Anzahl Standorte<input value={String(form().locations.length)} readOnly /></label>
      </div>
      <div class="crm-label-field"><span>Labels</span>
        <LabelPicker label="Labels wählen" selected={form().labels} library={props.data().labels} onChange={labels => patch({ labels })}
          onCreate={name => { let labelId = ""; props.onMutate(draft => { labelId = ensureLabel(draft, name); }); if (labelId) patch({ labels: [...form().labels, labelId] }); }} />
        <LabelChips ids={form().labels} library={props.data().labels} />
      </div></section>
      <section class="crm-section"><div class="crm-section-title"><h2>Standorte</h2><div class="crm-location-actions">
        <button class="crm-add-location" onClick={() => { const next = emptyLocation(`${form().name} · Neuer Standort`); patch({ locations: [...form().locations, next] }); setLocationId(next.id); }}><Icon name="plus" size={14} /> Standort hinzufügen</button>
        <Show when={location()}>{loc => <button class="ghost small danger" onClick={() => { const remaining = form().locations.filter(item => item.id !== loc().id); patch({ locations: remaining }); setLocationId(remaining[0]?.id ?? null); }}><Icon name="trash" size={14} /> Standort löschen</button>}</Show></div></div>
        <div class="crm-location-list"><For each={form().locations}>{loc => <button classList={{ active: loc.id === location()?.id }} onClick={() => setLocationId(loc.id)}>{loc.name || "Unbenannt"}<small>{loc.address.split("\n")[0] || "Keine Adresse"}</small></button>}</For></div>
        <Show when={location()}>{loc => <>
          <div class="crm-section-title"><h3>Standortdaten</h3></div>
          <Field label="Standortname" value={loc().name} onChange={name => patchLocation({ name })} />
          <Field label="Mitarbeitende an diesem Standort" value={loc().employees} onChange={employees => patchLocation({ employees })} />
          <label>Adresse<textarea value={loc().address} onInput={e => patchLocation({ address: e.currentTarget.value })} placeholder="Straße, Hausnummer&#10;PLZ Ort" /></label>
          <Field label="E-Mail-Adressen" value={loc().emails.join(", ")} onChange={value => patchLocation({ emails: split(value) })} />
          <Field label="Telefonnummern" value={loc().phones.join(", ")} onChange={value => patchLocation({ phones: split(value) })} />
          <div class="crm-section-title"><h3>Ansprechpartner</h3><button class="ghost small" onClick={() => patchLocation({ contacts: [...loc().contacts, { id: id("contact"), name: "", role: "", emails: [], phones: [], preferred: "" }] })}><Icon name="plus" size={14} /> Kontakt</button></div>
          <For each={loc().contacts}>{contact => <ContactForm contact={contact} onPatch={values => patchLocation({ contacts: loc().contacts.map(item => item.id === contact.id ? { ...item, ...values } : item) })} />}</For>
          <Show when={!loc().contacts.length}><p class="crm-empty">Noch keine Ansprechpartner hinterlegt.</p></Show>
        </>}</Show>
      </section>
    </div></Show>
    <Show when={tab() === "Deals"}><div class="crm-detail-body"><section class="crm-section">
      <h2>Deals dieser Organisation</h2>
      <For each={deals()}>{deal => <button class="crm-linked-row" onClick={() => props.onOpenDeal(deal.id)}>
        <span><strong>{deal.title}</strong><small>{deal.status === "Offen" ? stageName(props.data(), deal.stage) : deal.status} · {deal.owner || "Nicht zugeteilt"}</small></span>
        {/* Live work only: an activity in the trash has left every worklist, so counting
            it here would promise a plan that no list can show. */}
        <span class="crm-stage-chip">{deal.notes.length} Notiz(en) · {live(deal.activities).length} Aktivität(en)</span>
      </button>}</For>
      <Show when={!deals().length}><p class="crm-empty">Noch kein Deal. „Deal anlegen“ startet eine Verkaufschance, ohne diesen Datensatz zu verändern.</p></Show>
    </section></div></Show>
    <Show when={tab() === "Verlauf"}><div class="crm-detail-body">
      <section class="crm-section"><h2>Aktivitäten aus allen Deals</h2>
        <p class="crm-muted">Aktivitäten und Notizen gehören zum Deal; hier steht die Zusammenfassung der Organisation.</p>
        <For each={activitiesOf(props.data(), props.orgId)}>{entry => <button class="crm-linked-row" onClick={() => props.onOpenDeal(entry.deal.id)}>
          <span><strong>{entry.activity.kind} · {entry.activity.title}</strong><small>{entry.deal.title} · {date(entry.activity.dueDate)}</small></span>
          <Icon name={entry.activity.done ? "check" : "clock"} size={16} />
        </button>}</For>
        <Show when={!activitiesOf(props.data(), props.orgId).length}><p class="crm-empty">Noch keine Aktivitäten.</p></Show>
      </section>
      <section class="crm-section"><h2>Notizen aus allen Deals</h2>
        <For each={notesOf(props.data(), props.orgId)}>{entry => <details class="crm-note"><summary><strong>{entry.note.title}</strong><small>{entry.deal.title}</small></summary><p>{entry.note.body}</p><small>{entry.note.author} · {stamp(entry.note.createdAt)}</small></details>}</For>
        <Show when={!notesOf(props.data(), props.orgId).length}><p class="crm-empty">Noch keine Notizen.</p></Show>
      </section>
    </div></Show>
  </aside>}</Show>;
}

function ContactForm(props: { contact: Contact; onPatch: (patch: Partial<Contact>) => void }) {
  return <div class="crm-contact"><div class="crm-fields two">
    <Field label="Name" value={props.contact.name} onChange={name => props.onPatch({ name })} />
    <Field label="Rolle" value={props.contact.role} onChange={role => props.onPatch({ role })} />
    <Field label="E-Mail-Adressen" value={props.contact.emails.join(", ")} onChange={value => props.onPatch({ emails: split(value) })} />
    <Field label="Telefonnummern" value={props.contact.phones.join(", ")} onChange={value => props.onPatch({ phones: split(value) })} />
  </div><Field label="Bevorzugter Kontaktweg" value={props.contact.preferred} onChange={preferred => props.onPatch({ preferred })} /></div>;
}

function Notes(props: { notes: Deal["notes"]; onAdd: (title: string, body: string) => void }) {
  const [open, setOpen] = createSignal(false); const [title, setTitle] = createSignal(""); const [body, setBody] = createSignal("");
  return <section class="crm-section"><div class="crm-section-title"><h2>Notizen</h2><button class="ghost small" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Notiz</button></div>
    <Show when={open()}><form class="crm-add-note" onSubmit={e => { e.preventDefault(); props.onAdd(title(), body()); setTitle(""); setBody(""); setOpen(false); }}>
      <input value={title()} onInput={e => setTitle(e.currentTarget.value)} placeholder="Titel, z. B. Gespräch vom 14.09." />
      <textarea value={body()} onInput={e => setBody(e.currentTarget.value)} placeholder="Gesprächsnotiz festhalten…" />
      <div><button type="button" class="ghost" onClick={() => setOpen(false)}>Abbrechen</button><button class="primary">Notiz speichern</button></div>
    </form></Show>
    <div class="crm-notes-list"><For each={props.notes}>{note => <details class="crm-note"><summary><strong>{note.title}</strong><small>{stamp(note.createdAt)}</small></summary><p>{note.body}</p><small>{note.author}</small></details>}</For></div>
    <Show when={!props.notes.length}><button class="crm-add-note-card" onClick={() => setOpen(true)}><Icon name="plus" size={17} /><span>Erste Notiz hinzufügen</span><small>Gespräch, Entscheidung oder wichtige Information dokumentieren</small></button></Show>
  </section>;
}

function Activities(props: { activities: Activity[]; onAdd: (kind: ActivityKind, title: string, due: string, outcome: string) => void; onToggle: (id: string) => void; onEdit: (activity: Activity) => void }) {
  const [kind, setKind] = createSignal<ActivityKind>("Anruf"); const [title, setTitle] = createSignal(""); const [due, setDue] = createSignal(""); const [outcome, setOutcome] = createSignal("");
  return <div class="crm-detail-body">
    <section class="crm-section"><h2>Aktivität planen oder dokumentieren</h2>
      <form class="crm-activity-form" onSubmit={e => { e.preventDefault(); props.onAdd(kind(), title(), due(), outcome()); setTitle(""); setDue(""); setOutcome(""); }}>
        <select aria-label="Art" value={kind()} onChange={e => setKind(e.currentTarget.value as ActivityKind)}><For each={ACTIVITY_KINDS}>{x => <option>{x}</option>}</For></select>
        <input value={title()} onInput={e => setTitle(e.currentTarget.value)} placeholder="Was ist zu tun?" />
        <DateField label="Fällig am" value={due()} onChange={setDue} placeholder="Fällig am" class="crm-activity-date" />
        <textarea value={outcome()} onInput={e => setOutcome(e.currentTarget.value)} placeholder="Gesprächsergebnis oder Entscheidung – wird als Notiz gespeichert" />
        <button class="primary">Hinzufügen</button>
      </form></section>
    <section class="crm-section"><h2>Verlauf</h2>
      {/* The feed states what the worklist states: the same activity, the same tone,
          and — once it is done — WHEN it was completed, not merely that it was. */}
      <For each={props.activities}>{activity => <div class="crm-activity" data-state={activityState(activity)} classList={{ "is-done": activity.done }}>
        <input type="checkbox" checked={activity.done} aria-label={`${activity.title || activity.kind} erledigt`} onChange={() => props.onToggle(activity.id)} />
        <span><strong>{activity.kind} · {activity.title}</strong>
          <small>{date(activity.dueDate)}{activity.dueTime ? ` · ${activity.dueTime}` : ""}{activity.duration ? ` · ${activity.duration} Min.` : ""}{activity.priority !== "Normal" ? ` · Priorität ${activity.priority}` : ""}</small>
          <Show when={activity.done && activity.doneAt}><small>Erledigt {stamp(activity.doneAt!)}</small></Show>
        </span>
        {/* Editing and deleting live where the activity is READ, so the feed is not a
            dead end that forces a trip to the workspace. */}
        <button type="button" class="ghost small crm-activity-edit" aria-label={`Aktivität ${activity.title || activity.kind} bearbeiten`} onClick={() => props.onEdit(activity)}><Icon name="edit" size={14} /> Bearbeiten</button>
      </div>}</For>
      <Show when={!props.activities.length}><p class="crm-empty">Noch keine Aktivitäten geplant.</p></Show>
    </section>
  </div>;
}

function Files(props: { files: Deal["files"]; onAdd: (file: Deal["files"][number]) => void }) {
  const upload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => props.onAdd({ id: id("file"), name: file.name, type: file.type, data: String(reader.result), createdAt: new Date().toISOString() });
    reader.readAsDataURL(file);
  };
  return <div class="crm-detail-body"><section class="crm-section"><h2>Dokumente</h2>
    <label class="crm-upload"><Icon name="upload" size={20} /><span>Datei hinzufügen</span><input type="file" onChange={e => upload(e.currentTarget.files?.[0])} /></label>
    <p class="crm-muted">Angebote und Verträge gehören zum Deal, über den verhandelt wird.</p>
    <For each={props.files}>{file => <a class="crm-file" href={file.data} download={file.name}><Icon name="doc" size={18} /><span><strong>{file.name}</strong><small>{date(file.createdAt.slice(0, 10))}</small></span></a>}</For>
    <Show when={!props.files.length}><p class="crm-empty">Noch keine Dokumente hinterlegt.</p></Show>
  </section></div>;
}
