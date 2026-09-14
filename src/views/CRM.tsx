import { createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import DateField from "../components/DateField";
import { PillMenu } from "../components/controls";
import { navigate, route } from "../router";
import {
  ACTIVITY_KINDS, CRM_STAGES, PIPELINE_STAGES, activitiesOf, closeDeal, convertToDeal, customers as customerOrgs,
  dealsOf, emptyDeal, emptyLocation, emptyOrganization, ensureLabel, id, leads as leadOrgs, live, loadCrm,
  moveDeal, notesOf, openDeals, organizationOf, purge, restore, saveCrm, softDeleteDeal, softDeleteOrganization, trash,
  type Activity, type ActivityKind, type Contact, type CrmData, type CrmStage, type Deal, type Label, type Location,
  type Organization,
} from "../crmStore";
import "./CRM.css";

const split = (value: string) => value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const date = (value: string) => value ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "Kein Termin";
const stamp = (value: string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const dealAmount = (deal: Deal) => Number(String(deal.value).replace(/[^0-9,.-]/g, "").replace(",", ".")) || 0;
const money = (amount: number, currency: Deal["currency"] = "EUR") => new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

/** The CRM's work views. Each is route state (§router.crmTabs), so the rail can
 *  highlight one and a link opens the same surface. */
type CrmTab = "leads" | "pipeline" | "open" | "won" | "lost" | "trash" | "activities" | "customers";
const tabOf = (tab: string | undefined): CrmTab =>
  (["leads", "pipeline", "open", "won", "lost", "trash", "activities", "customers"] as CrmTab[]).includes(tab as CrmTab) ? tab as CrmTab : "pipeline";
const CRM_OWNERS = ["Nicht zugeteilt", "Jannes", "Bjarne", "Charles", "Pascal"] as const;
const TAB_TITLE: Record<CrmTab, string> = {
  leads: "Leads", pipeline: "Pipeline", open: "Offene Deals", won: "Gewonnene Deals", lost: "Verlorene Deals",
  trash: "Papierkorb", activities: "Aktivitäten", customers: "Kunden",
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

  const addOrganization = (name: string, owner: string, withDeal: boolean) => {
    const org = emptyOrganization(name, owner);
    mutate(draft => {
      draft.organizations.unshift(org);
      if (withDeal) draft.deals.unshift({ ...emptyDeal(org.id, name, owner), stage: "Non-Qualified" });
    });
    setSelected({ kind: "org", id: org.id });
    setNewOpen(false);
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

  const count = () => tab() === "pipeline" ? boardDeals().length
    : tab() === "leads" ? leadOrgs(data()).filter(orgMatches).length
      : tab() === "customers" ? customerOrgs(data()).filter(orgMatches).length
        : tab() === "trash" ? trash(data()).deals.length + trash(data()).organizations.length
          : tab() === "activities" ? activityFeed().length : listFor(tab()).length;
  const activityFeed = () => live(data().deals).filter(dealMatches)
    .flatMap(deal => deal.activities.map(activity => ({ deal, activity })))
    .sort((a, b) => (a.activity.dueDate || "9999").localeCompare(b.activity.dueDate || "9999"));

  return <section class="crm-view">
    <PageHeader icon="columns" title="CRM" subline="Organisationen, Deals und Aktivitäten im Vertrieb." chips={<Chip value={count()} label={` ${TAB_TITLE[tab()]}`} />} />
    <nav class="page-actionbar crm-toolbar" aria-label="CRM actions">
      <div class="crm-search"><Icon name="search" size={17} /><input value={query()} onInput={e => setQuery(e.currentTarget.value)} placeholder="Organisation, Standort oder Adresse suchen" aria-label="CRM durchsuchen" /></div>
      <LabelPicker label="Labels" selected={labelFilter()} library={labels()} onChange={setLabelFilter} />
      <select aria-label="Nach verantwortlicher Person filtern" value={filterOwner()} onChange={e => setFilterOwner(e.currentTarget.value)}><For each={owners()}>{owner => <option>{owner}</option>}</For></select>
      <button class="primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={16} /> Organisation</button>
    </nav>
    <Show when={newOpen()}><NewOrganization onClose={() => setNewOpen(false)} onSave={addOrganization} /></Show>
    <Show when={drag()}>{active => <>
      <div class="crm-drag-ghost" style={{ left: `${active().x + 14}px`, top: `${active().y + 14}px` }}>{active().kind === "deal" ? "Deal verschieben" : "Lead umwandeln"}</div>
    </>}</Show>

    <Show when={tab() === "pipeline"}>
      <section class="crm-pipeline">
        <div class="crm-pipeline-summary"><span><strong>{money(boardDeals().reduce((sum, deal) => sum + dealAmount(deal), 0))}</strong> Gesamtwert · <strong>{money(boardDeals().reduce((sum, deal) => sum + dealAmount(deal) * deal.probability / 100, 0))}</strong> gewichteter Pipelinewert · {boardDeals().length} offene Deals</span><span>Pipeline: Vertrieb</span></div>
        <div class="crm-board" aria-label="Vertriebspipeline">
          <For each={PIPELINE_STAGES}>{stage => {
            const inStage = () => boardDeals().filter(deal => deal.stage === stage);
            return <section class="crm-column" data-crm-stage={stage} classList={{ "is-drop-target": dragOverStage() === stage }}>
              <header><strong>{stage}</strong><span>{inStage().length} · {money(inStage().reduce((sum, deal) => sum + dealAmount(deal) * deal.probability / 100, 0))} gewichtet</span></header>
              <div class="crm-column-cards"><For each={inStage()}>{deal => <DealCard deal={deal} org={orgOf(deal)} library={labels()} onPointerDown={startDrag({ kind: "deal", id: deal.id })} onOpen={() => openRecord({ kind: "deal", id: deal.id })} />}</For></div>
            </section>;
          }}</For>
        </div>
        <DropZones active={drag()} hint={dropHint()} />
      </section>
    </Show>

    <Show when={tab() === "leads"}>
      <section class="crm-directory">
        <header><div><h2>Leads</h2><p>Organisationen ohne gewonnenen Deal. Karte auf „In Pipeline“ ziehen, um daraus einen Deal zu machen.</p></div><span>{leadOrgs(data()).filter(orgMatches).length}</span></header>
        <div class="crm-lead-grid"><For each={leadOrgs(data()).filter(orgMatches)}>{org => <div class="crm-card crm-lead-card" role="button" tabindex="0" onPointerDown={startDrag({ kind: "org", id: org.id })} onClick={() => openRecord({ kind: "org", id: org.id })}>
          <strong>{org.name}</strong>
          <span class="crm-card-account">{org.locations.length} Standort{org.locations.length === 1 ? "" : "e"} · {dealsOf(data(), org.id).length} Deal(s)</span>
          <LabelChips ids={org.labels} library={labels()} />
          <footer><span>{org.owner || "Nicht zugeteilt"}</span><button class="ghost small" onClick={event => { event.stopPropagation(); addDealFor(org.id); }}>In Deal umwandeln</button></footer>
        </div>}</For></div>
        <Show when={!leadOrgs(data()).filter(orgMatches).length}><p class="crm-empty">Keine Leads in dieser Ansicht.</p></Show>
        <DropZones active={drag()} hint={dropHint()} />
      </section>
    </Show>

    <Show when={tab() === "open" || tab() === "won" || tab() === "lost"}>
      <DealTable title={TAB_TITLE[tab()]} deals={() => listFor(tab())} data={data} onOpen={dealId => setSelected({ kind: "deal", id: dealId })} onOpenOrg={orgId => setSelected({ kind: "org", id: orgId })} />
    </Show>

    <Show when={tab() === "customers"}>
      <OrganizationTable title="Kunden" hint="Organisationen mit mindestens einem gewonnenen Deal." orgs={() => customerOrgs(data()).filter(orgMatches)} data={data} onOpen={orgId => setSelected({ kind: "org", id: orgId })} />
    </Show>

    <Show when={tab() === "activities"}>
      <section class="crm-directory crm-calendar">
        <header><div><h2>Aktivitäten</h2><p>Alle geplanten und erledigten Aktivitäten – sie gehören immer zu einem Deal.</p></div><span>{activityFeed().length}</span></header>
        <For each={activityFeed()}>{entry => <button class="crm-calendar-row" classList={{ "is-done": entry.activity.done }} onClick={() => setSelected({ kind: "deal", id: entry.deal.id })}>
          <time>{date(entry.activity.dueDate)}</time>
          <span><strong>{entry.activity.kind} · {entry.activity.title}</strong><small>{entry.deal.title} · {orgOf(entry.deal)?.name ?? "Ohne Organisation"}</small></span>
          <Icon name={entry.activity.done ? "check" : "clock"} size={17} />
        </button>}</For>
        <Show when={!activityFeed().length}><p class="crm-empty">Noch keine Aktivitäten erfasst.</p></Show>
      </section>
    </Show>

    <Show when={tab() === "trash"}>
      <section class="crm-directory">
        <header><div><h2>Papierkorb</h2><p>Gelöschte Datensätze bleiben auffindbar und lassen sich wiederherstellen.</p></div><span>{trash(data()).deals.length + trash(data()).organizations.length}</span></header>
        <div class="crm-trash-list">
          <For each={trash(data()).organizations}>{org => <div class="crm-trash-row"><span><strong>{org.name}</strong><small>Organisation · gelöscht {stamp(org.deletedAt!)}</small></span>
            <button class="ghost small" onClick={() => mutate(draft => restore(draft, org.id))}>Wiederherstellen</button>
            <button class="ghost small danger" onClick={() => mutate(draft => purge(draft, org.id))}>Endgültig löschen</button></div>}</For>
          <For each={trash(data()).deals.filter(deal => !trash(data()).organizations.some(org => org.id === deal.organizationId))}>{deal => <div class="crm-trash-row"><span><strong>{deal.title}</strong><small>Deal · {deal.stage} · gelöscht {stamp(deal.deletedAt!)}</small></span>
            <button class="ghost small" onClick={() => mutate(draft => restore(draft, deal.id))}>Wiederherstellen</button>
            <button class="ghost small danger" onClick={() => mutate(draft => purge(draft, deal.id))}>Endgültig löschen</button></div>}</For>
        </div>
        <Show when={!trash(data()).deals.length && !trash(data()).organizations.length}><p class="crm-empty">Der Papierkorb ist leer.</p></Show>
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

function DealCard(props: { deal: Deal; org: Organization | undefined; library: Label[]; onPointerDown: (event: PointerEvent) => void; onOpen: () => void }) {
  return <div class="crm-card" role="button" tabindex="0" onPointerDown={props.onPointerDown} onClick={props.onOpen}>
    <strong>{props.deal.title}</strong>
    <span class="crm-card-account">{props.org?.name ?? "Ohne Organisation"}</span>
    <LabelChips ids={[...props.deal.labels, ...(props.org?.labels ?? []).filter(labelId => !props.deal.labels.includes(labelId))]} library={props.library} />
    <Show when={props.deal.nextStep}><span class="crm-card-next"><Icon name="alert" size={14} />{props.deal.nextStep}</span></Show>
    <footer><span>{props.deal.owner || "Nicht zugeteilt"}</span><span>{money(dealAmount(props.deal), props.deal.currency)}<Show when={props.deal.probability > 0}> · {props.deal.probability}%</Show></span></footer>
  </div>;
}

function DealTable(props: { title: string; deals: () => Deal[]; data: () => CrmData; onOpen: (dealId: string) => void; onOpenOrg: (orgId: string) => void }) {
  return <section class="crm-directory">
    <header><div><h2>{props.title}</h2><p>Ein Deal ist die Verkaufschance; die Organisation dahinter bleibt bestehen.</p></div><span>{props.deals().length}</span></header>
    <div class="crm-directory-table">
      <div class="crm-directory-head"><span>Deal</span><span>Organisation</span><span>Phase</span><span>Nächster Schritt</span><span>Verantwortlich</span></div>
      <For each={props.deals()}>{deal => <button onClick={() => props.onOpen(deal.id)}>
        <strong>{deal.title}</strong>
        <span class="crm-link" onClick={event => { event.stopPropagation(); const org = organizationOf(props.data(), deal); if (org) props.onOpenOrg(org.id); }}>{organizationOf(props.data(), deal)?.name ?? "—"}</span>
        <span class="crm-stage-chip">{deal.status === "Offen" ? deal.stage : deal.status}</span>
        <span>{deal.nextStep || "—"}</span><span>{deal.owner || "—"}</span>
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

function NewOrganization(props: { onClose: () => void; onSave: (name: string, owner: string, withDeal: boolean) => void }) {
  const [name, setName] = createSignal(""); const [owner, setOwner] = createSignal("Jannes"); const [withDeal, setWithDeal] = createSignal(true);
  return <div class="crm-overlay" role="presentation"><form class="crm-modal" onSubmit={e => { e.preventDefault(); if (name().trim()) props.onSave(name().trim(), owner(), withDeal()); }}>
    <header><h2>Neue Organisation anlegen</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
    <label>Name<input autofocus value={name()} onInput={e => setName(e.currentTarget.value)} placeholder="z. B. Optik Musterstadt" /></label>
    <label>Verantwortliche Person<select value={owner()} onChange={e => setOwner(e.currentTarget.value)}><For each={["Jannes", "Bjarne", "Charles", "Pascal"]}>{x => <option>{x}</option>}</For></select></label>
    <label class="crm-check"><input type="checkbox" checked={withDeal()} onChange={e => setWithDeal(e.currentTarget.checked)} />Direkt einen Deal in der Pipeline starten</label>
    <p>Ohne Deal bleibt die Organisation ein Lead und taucht nicht in der Pipeline auf.</p>
    <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary">Anlegen</button></footer>
  </form></div>;
}

const Field = (props: { label: string; value: string; onChange: (value: string) => void }) =>
  <label>{props.label}<input value={props.value} onInput={e => props.onChange(e.currentTarget.value)} /></label>;

/** ── The deal panel: the opportunity and everything that happened inside it ──── */
function DealPanel(props: { dealId: string; data: () => CrmData; onMutate: (fn: (draft: CrmData) => void) => void; onClose: () => void; onOpenOrg: (orgId: string) => void }) {
  const [tab, setTab] = createSignal<"Übersicht" | "Aktivitäten" | "Dokumente">("Übersicht");
  const deal = () => props.data().deals.find(item => item.id === props.dealId);
  const org = () => { const current = deal(); return current ? organizationOf(props.data(), current) : undefined; };
  const patch = (values: Partial<Deal>) => props.onMutate(draft => { const found = draft.deals.find(item => item.id === props.dealId); if (found) Object.assign(found, values); });
  const withDeal = (fn: (draft: Deal, data: CrmData) => void) => props.onMutate(draft => { const found = draft.deals.find(item => item.id === props.dealId); if (found) fn(found, draft); });
  let panel: HTMLElement | undefined;
  createEffect(() => { props.dealId; requestAnimationFrame(() => panel?.scrollTo({ top: 0 })); });
  return <Show when={deal()}>{current => <aside ref={panel} class="crm-detail" aria-label={`Deal ${current().title}`}>
    <header class="crm-detail-head"><div>
      <button class="crm-back" onClick={props.onClose}><Icon name="chevron-left" size={17} /> Zurück</button>
      <Show when={org() && org()!.name !== current().title}><p><button class="crm-link" onClick={() => org() && props.onOpenOrg(org()!.id)}>Organisation: {org()!.name}</button></p></Show>
      <h1>{current().title}</h1><span class="crm-record-kind">Deal</span>
    </div><button class="icon-button" onClick={props.onClose} aria-label="Deal schließen"><Icon name="close" /></button></header>
    <div class="crm-stage-row">
      <PillMenu class="crm-field-menu crm-stage-menu" label="Pipeline-Phase" value={current().stage} options={CRM_STAGES.map(stage => ({ value: stage, label: stage }))} onChange={stage => props.onMutate(draft => moveDeal(draft, props.dealId, stage as CrmStage))} />
      <button class="ghost success" style={{ background: "#e6f6e8", color: "#118c5c", "border-color": "#118c5c" }} onClick={() => { props.onMutate(draft => closeDeal(draft, props.dealId, "Gewonnen")); props.onClose(); navigate({ view: "CRM", tab: "won" }); }}>Gewonnen</button>
      <button class="ghost danger" onClick={() => { props.onMutate(draft => closeDeal(draft, props.dealId, "Verloren")); props.onClose(); navigate({ view: "CRM", tab: "lost" }); }}>Verloren</button>
      <button class="ghost danger" onClick={() => { props.onMutate(draft => softDeleteDeal(draft, props.dealId)); props.onClose(); }} aria-label="Deal in den Papierkorb"><Icon name="trash" size={15} /></button>
    </div>
    <p class="crm-status-line">Status: <strong>{current().status}</strong><Show when={current().closedAt}> · {stamp(current().closedAt!)}</Show></p>
    <nav class="crm-tabs"><For each={["Übersicht", "Aktivitäten", "Dokumente"] as const}>{name => <button classList={{ active: tab() === name }} onClick={() => setTab(name)}>{name}</button>}</For></nav>
    <Show when={tab() === "Übersicht"}><div class="crm-detail-body">
      <section class="crm-section"><h2>Deal</h2><div class="crm-fields two">
        <label>Verknüpfter Kunde / Organisation<select value={current().organizationId} onChange={e => patch({ organizationId: e.currentTarget.value, locationId: null })}><For each={props.data().organizations.filter(item => !item.deletedAt)}>{item => <option value={item.id}>{item.name}</option>}</For></select></label>
        <Field label="Titel" value={current().title} onChange={title => patch({ title })} />
        <label>Deal-Wert<input inputmode="decimal" value={current().value} onInput={e => patch({ value: e.currentTarget.value.replace(/[^0-9,.]/g, "") })} placeholder="z. B. 12.500" /></label>
        <label>Währung<select value={current().currency} onChange={e => patch({ currency: e.currentTarget.value as Deal["currency"] })}><option value="EUR">EUR (€)</option><option value="CHF">CHF</option><option value="USD">USD ($)</option></select></label>
        <label>Gewinnwahrscheinlichkeit<div class="crm-percent-input"><input type="number" min="0" max="100" value={current().probability} onInput={e => patch({ probability: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} /><span>%</span></div><small>Gewichteter Deal-Wert: {money(dealAmount(current()) * current().probability / 100, current().currency)}</small></label>
        <Field label="Quelle" value={current().source} onChange={source => patch({ source })} />
        <label>Verantwortliche Person<PillMenu class="crm-field-menu" label="Verantwortliche Person" value={current().owner} options={CRM_OWNERS.map(owner => ({ value: owner === "Nicht zugeteilt" ? "" : owner, label: owner }))} onChange={owner => patch({ owner })} /></label>
        <label>Erwarteter Abschluss<DateField label="Erwarteter Abschluss" value={current().expectedClose} onChange={expectedClose => patch({ expectedClose })} placeholder="Datum wählen" /></label>
        <label>Standort<select value={current().locationId ?? ""} onChange={e => patch({ locationId: e.currentTarget.value || null })}>
          <option value="">Kein bestimmter Standort</option><For each={org()?.locations ?? []}>{loc => <option value={loc.id}>{loc.name || "Unbenannter Standort"}</option>}</For></select></label>
      </div>
      <div class="crm-label-field"><span>Labels</span>
        <LabelPicker label="Labels wählen" selected={current().labels} library={props.data().labels} onChange={labels => patch({ labels })} onCreate={name => withDeal((draft, data) => { draft.labels = [...draft.labels, ensureLabel(data, name)]; })} />
        <LabelChips ids={current().labels} library={props.data().labels} />
      </div></section>
      <section class="crm-section"><h2>Nächster Schritt</h2><div class="crm-next-fields">
        <Field label="Aufgabe / nächster Kontakt" value={current().nextStep} onChange={nextStep => patch({ nextStep })} />
        <label>Fällig am<DateField label="Fällig am" value={current().nextStepDate} onChange={nextStepDate => patch({ nextStepDate })} placeholder="Datum wählen" /></label>
      </div></section>
      <Notes notes={current().notes} onAdd={(title, body) => withDeal(draft => { if (body.trim()) draft.notes.unshift({ id: id("note"), title: title.trim() || "Notiz", body: body.trim(), author: "Team paloptic", createdAt: new Date().toISOString() }); })} />
    </div></Show>
    <Show when={tab() === "Aktivitäten"}>
      <Activities activities={current().activities}
        onAdd={(kind, title, due, outcome) => withDeal(draft => {
          if (!title.trim()) return;
          draft.activities.unshift({ id: id("activity"), kind, title: title.trim(), dueDate: due, outcome: outcome.trim(), done: false });
          if (outcome.trim()) draft.notes.unshift({ id: id("note"), title: `${kind}: ${title.trim()}`, body: outcome.trim(), author: "Team paloptic", createdAt: new Date().toISOString() });
        })}
        onToggle={activityId => withDeal(draft => { const found = draft.activities.find(item => item.id === activityId); if (found) found.done = !found.done; })} />
    </Show>
    <Show when={tab() === "Dokumente"}>
      <Files files={current().files} onAdd={file => withDeal(draft => { draft.files.unshift(file); })} />
    </Show>
  </aside>}</Show>;
}

/** ── The organization panel: the durable record, with its deals rolled up ────── */
function OrganizationPanel(props: { orgId: string; data: () => CrmData; onMutate: (fn: (draft: CrmData) => void) => void; onClose: () => void; onOpenDeal: (dealId: string) => void; onAddDeal: () => void }) {
  const [tab, setTab] = createSignal<"Stammdaten" | "Deals" | "Verlauf">("Stammdaten");
  const [locationId, setLocationId] = createSignal<string | null>(null);
  const org = () => props.data().organizations.find(item => item.id === props.orgId);
  const location = () => org()?.locations.find(loc => loc.id === locationId()) ?? org()?.locations[0];
  const patch = (values: Partial<Organization>) => props.onMutate(draft => { const found = draft.organizations.find(item => item.id === props.orgId); if (found) Object.assign(found, values); });
  const patchLocation = (values: Partial<Location>) => props.onMutate(draft => {
    const found = draft.organizations.find(item => item.id === props.orgId)?.locations.find(loc => loc.id === location()?.id);
    if (found) Object.assign(found, values);
  });
  const deals = () => dealsOf(props.data(), props.orgId);
  const isCustomerNow = () => deals().some(deal => deal.status === "Gewonnen");
  return <Show when={org()}>{current => <aside class="crm-detail" aria-label={`Organisation ${current().name}`}>
    <header class="crm-detail-head"><div>
      <button class="crm-back" onClick={props.onClose}><Icon name="chevron-left" size={17} /> Zurück</button>
      <p>{isCustomerNow() ? "Kunde" : "Lead"}</p><h1>{current().name}</h1><span class="crm-record-kind">Organisation</span>
    </div><button class="icon-button" onClick={props.onClose} aria-label="Organisation schließen"><Icon name="close" /></button></header>
    <div class="crm-stage-row">
      <button class="ghost success" style={{ background: "#e6f6e8", color: "#118c5c", "border-color": "#118c5c" }} onClick={props.onAddDeal}><Icon name="plus" size={14} /> Deal anlegen</button>
      <button class="ghost danger" onClick={() => { props.onMutate(draft => softDeleteOrganization(draft, props.orgId)); props.onClose(); }}><Icon name="trash" size={15} /> In den Papierkorb</button>
    </div>
    <nav class="crm-tabs"><For each={["Stammdaten", "Deals", "Verlauf"] as const}>{name => <button classList={{ active: tab() === name }} onClick={() => setTab(name)}>{name}</button>}</For></nav>
    <Show when={tab() === "Stammdaten"}><div class="crm-detail-body">
      <section class="crm-section"><h2>Organisation</h2><div class="crm-fields two">
        <Field label="Name" value={current().name} onChange={name => patch({ name })} />
        <Field label="Website" value={current().website} onChange={website => patch({ website })} />
        <Field label="Entscheider" value={current().decisionMaker} onChange={decisionMaker => patch({ decisionMaker })} />
        <Field label="Mitarbeitende gesamt" value={current().employees} onChange={employees => patch({ employees })} />
        <Field label="Branchensoftware" value={current().software} onChange={software => patch({ software })} />
        <Field label="Quelle" value={current().source} onChange={source => patch({ source })} />
        <label>Verantwortliche Person<PillMenu class="crm-field-menu" label="Verantwortliche Person" value={current().owner} options={CRM_OWNERS.map(owner => ({ value: owner === "Nicht zugeteilt" ? "" : owner, label: owner }))} onChange={owner => patch({ owner })} /></label>
        <label>Anzahl Standorte<input value={String(current().locations.length)} readOnly /></label>
      </div>
      <div class="crm-label-field"><span>Labels</span>
        <LabelPicker label="Labels wählen" selected={current().labels} library={props.data().labels} onChange={labels => patch({ labels })}
          onCreate={name => props.onMutate(draft => { const found = draft.organizations.find(item => item.id === props.orgId); if (found) found.labels = [...found.labels, ensureLabel(draft, name)]; })} />
        <LabelChips ids={current().labels} library={props.data().labels} />
      </div></section>
      <section class="crm-section"><div class="crm-section-title"><h2>Standorte</h2>
        <button class="crm-add-location" onClick={() => { const next = emptyLocation(`${current().name} · Neuer Standort`); patch({ locations: [...current().locations, next] }); setLocationId(next.id); }}><Icon name="plus" size={14} /> Standort hinzufügen</button></div>
        <div class="crm-location-list"><For each={current().locations}>{loc => <button classList={{ active: loc.id === location()?.id }} onClick={() => setLocationId(loc.id)}>{loc.name || "Unbenannt"}<small>{loc.address.split("\n")[0] || "Keine Adresse"}</small></button>}</For></div>
        <Show when={location()}>{loc => <>
          <div class="crm-section-title"><h3>Standortdaten</h3><button class="ghost small danger" onClick={() => { const remaining = current().locations.filter(item => item.id !== loc().id); patch({ locations: remaining }); setLocationId(remaining[0]?.id ?? null); }}><Icon name="trash" size={14} /> Standort löschen</button></div>
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
        <span><strong>{deal.title}</strong><small>{deal.status === "Offen" ? deal.stage : deal.status} · {deal.owner || "Nicht zugeteilt"}</small></span>
        <span class="crm-stage-chip">{deal.notes.length} Notiz(en) · {deal.activities.length} Aktivität(en)</span>
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

function Activities(props: { activities: Activity[]; onAdd: (kind: ActivityKind, title: string, due: string, outcome: string) => void; onToggle: (id: string) => void }) {
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
      <For each={props.activities}>{activity => <label class="crm-activity"><input type="checkbox" checked={activity.done} onChange={() => props.onToggle(activity.id)} /><span><strong>{activity.kind} · {activity.title}</strong><small>{date(activity.dueDate)}</small></span></label>}</For>
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
