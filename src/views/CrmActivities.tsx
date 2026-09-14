import { For, Show, createMemo, createSignal } from "solid-js";
import { Icon } from "../components/Icon";
import DateField from "../components/DateField";
import { PillMenu } from "../components/controls";
import { monthCells, startOfLocalDay } from "../calendar";
import {
  ACTIVITY_DURATIONS, ACTIVITY_ICONS, ACTIVITY_KINDS, ACTIVITY_PRIORITIES, ACTIVITY_VIEWS, ACTIVITY_VIEW_LABELS,
  activitiesOnDay, activityEntries, activityState, addActivity, dayKey, filterActivityEntries, linkActivity, live,
  organizationOf, toggleActivity,
  type ActivityEntry, type ActivityKind, type ActivityPriority, type ActivityView, type CrmData, type Deal,
} from "../crmStore";

/** ── The activity workspace ──────────────────────────────────────────────────
 *
 *  Activities are the only part of the CRM that is a WORKLIST rather than a record:
 *  the question is never "what is stored" but "what do I owe today". So this surface
 *  is one list with filters over it (§crmStore.matchesActivityView) and one calendar
 *  showing the same entries on the days they were planned for — two readings of the
 *  same data, never two stores.
 *
 *  Two rules it must not break:
 *    · the model stays DEAL-OWNED — an activity that belongs to an opportunity lives
 *      on the deal, and completing it here is the same write the deal panel makes;
 *    · no native date control ever appears — the month grid and DateField are the
 *      product's own (§components/DateField), so the calendar looks like the app.
 */

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;
const dateLabel = (value: string) => value
  ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`))
  : "Kein Termin";
const durationLabel = (minutes: number) => minutes ? (minutes >= 60 ? `${minutes / 60} h`.replace(".", ",") : `${minutes} Min.`) : "—";
const STATE_LABELS: Record<ReturnType<typeof activityState>, string> = {
  done: "Erledigt", overdue: "Überfällig", today: "Heute", planned: "Geplant", unscheduled: "Ohne Termin",
};

/** The times a working day is actually planned in: half-hour slots, no native picker. */
const TIME_SLOTS = Array.from({ length: 28 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  return `${`${Math.floor(minutes / 60)}`.padStart(2, "0")}:${`${minutes % 60}`.padStart(2, "0")}`;
});

export type ActivityDraft = {
  kind: ActivityKind; title: string; dueDate: string; dueTime: string; duration: number;
  priority: ActivityPriority; owner: string; outcome: string; dealId: string;
};

export default function CrmActivities(props: {
  data: () => CrmData;
  mutate: (fn: (draft: CrmData) => void) => void;
  owners: readonly string[];
  onOpenDeal: (dealId: string) => void;
  onOpenOrg: (orgId: string) => void;
}) {
  const [mode, setMode] = createSignal<"list" | "calendar">("list");
  const [view, setView] = createSignal<ActivityView>("todo");
  const [kind, setKind] = createSignal<ActivityKind | "Alle">("Alle");
  const [composer, setComposer] = createSignal<{ dealId: string; dueDate: string } | null>(null);
  const [cursor, setCursor] = createSignal(startOfLocalDay(new Date()));
  const [selectedDay, setSelectedDay] = createSignal(startOfLocalDay(new Date()));

  const entries = createMemo(() => activityEntries(props.data()));
  const shown = createMemo(() => filterActivityEntries(entries(), view(), kind()));
  const countOf = (candidate: ActivityView) => filterActivityEntries(entries(), candidate, kind()).length;
  const linkable = createMemo(() => live(props.data().deals).filter(deal => deal.status === "Offen"));
  const dayEntries = createMemo(() => activitiesOnDay(kind() === "Alle" ? entries() : entries().filter(entry => entry.activity.kind === kind()), selectedDay()));

  const toggle = (activityId: string) => props.mutate(draft => { toggleActivity(draft, activityId); });
  const link = (activityId: string, dealId: string) => props.mutate(draft => { linkActivity(draft, activityId, dealId || null); });
  const save = (draft: ActivityDraft) => {
    props.mutate(data => {
      addActivity(data, draft.dealId || null, {
        kind: draft.kind, title: draft.title.trim(), dueDate: draft.dueDate, dueTime: draft.dueTime,
        duration: draft.duration, priority: draft.priority, owner: draft.owner, outcome: draft.outcome.trim(),
      });
    });
    setComposer(null);
  };

  const openOn = (day: Date) => setComposer({ dealId: "", dueDate: dayKey(day) });

  return <section class="crm-directory crm-activities">
    <header>
      <div><h2>Aktivitäten</h2><p>Ein Arbeitsvorrat, keine Ablage: was offen ist, was überfällig ist und was heute ansteht.</p></div>
      <div class="crm-activity-head-actions">
        <div class="crm-mode-toggle" role="group" aria-label="Ansicht">
          <button type="button" classList={{ active: mode() === "list" }} aria-pressed={mode() === "list"} onClick={() => setMode("list")}><Icon name="menu" size={14} /> Liste</button>
          <button type="button" classList={{ active: mode() === "calendar" }} aria-pressed={mode() === "calendar"} onClick={() => setMode("calendar")}><Icon name="calendar" size={14} /> Kalender</button>
        </div>
        <button class="primary crm-new-activity" onClick={() => setComposer({ dealId: "", dueDate: mode() === "calendar" ? dayKey(selectedDay()) : "" })}>
          <Icon name="plus" size={15} /> Neue Aktivität
        </button>
      </div>
    </header>

    <div class="crm-activity-filters" role="group" aria-label="Aktivitäten filtern">
      <For each={ACTIVITY_VIEWS}>{candidate =>
        <button type="button" class="crm-filter-chip" classList={{ active: view() === candidate }} aria-pressed={view() === candidate}
          data-filter={candidate} onClick={() => setView(candidate)}>
          {ACTIVITY_VIEW_LABELS[candidate]}<span>{countOf(candidate)}</span>
        </button>}</For>
      <PillMenu class="crm-kind-filter" label="Nach Art filtern" value={kind()} options={[{ value: "Alle", label: "Alle Arten" }, ...ACTIVITY_KINDS.map(value => ({ value, label: value }))]} onChange={value => setKind(value as ActivityKind | "Alle")} />
    </div>

    <Show when={mode() === "list"}>
      <div class="crm-activity-table" role="table" aria-label="Aktivitätenliste">
        <div class="crm-activity-head" role="row">
          <span role="columnheader">Erledigt</span><span role="columnheader">Art</span><span role="columnheader">Betreff</span>
          <span role="columnheader">Deal</span><span role="columnheader">Organisation</span><span role="columnheader">Verantwortlich</span>
          <span role="columnheader">Fällig</span><span role="columnheader">Dauer</span><span role="columnheader">Priorität</span>
        </div>
        <For each={shown()}>{entry => <ActivityRow entry={entry} deals={linkable} onLink={link} onToggle={toggle} onOpenDeal={props.onOpenDeal} onOpenOrg={props.onOpenOrg} />}</For>
      </div>
      <Show when={!shown().length}>
        <p class="crm-empty">Keine Aktivitäten in diesem Filter. „Neue Aktivität“ plant die nächste – mit oder ohne Deal.</p>
      </Show>
    </Show>

    <Show when={mode() === "calendar"}>
      <section class="crm-calendar-month" aria-label="Aktivitätenkalender">
        <header class="crm-month-head">
          <button class="crm-month-nav" aria-label="Vorheriger Monat" onClick={() => setCursor(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><Icon name="chevron-left" size={16} /></button>
          <strong>{MONTHS[cursor().getMonth()]} {cursor().getFullYear()}</strong>
          <button class="crm-month-nav" aria-label="Nächster Monat" onClick={() => setCursor(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><Icon name="chevron-right" size={16} /></button>
          <button class="crm-month-today" onClick={() => { const today = startOfLocalDay(new Date()); setCursor(today); setSelectedDay(today); }}>Heute</button>
        </header>
        <div class="crm-month">
          <div class="crm-month-weekdays" aria-hidden="true"><For each={WEEKDAYS}>{day => <b>{day}</b>}</For></div>
          <div class="crm-month-grid" role="grid">
            <For each={monthCells(cursor())}>{day => {
              const onDay = () => activitiesOnDay(kind() === "Alle" ? entries() : entries().filter(entry => entry.activity.kind === kind()), day);
              return <div class="crm-month-cell" role="gridcell"
                classList={{
                  muted: day.getMonth() !== cursor().getMonth(),
                  today: dayKey(day) === dayKey(new Date()),
                  selected: dayKey(day) === dayKey(selectedDay()),
                  "has-items": !!onDay().length,
                }}
                data-day={dayKey(day)} onClick={() => setSelectedDay(day)}>
                <div class="crm-month-cell-head">
                  <time>{day.getDate()}</time>
                  <button class="crm-month-add" aria-label={`Aktivität am ${dateLabel(dayKey(day))} planen`} onClick={event => { event.stopPropagation(); setSelectedDay(day); openOn(day); }}>+</button>
                </div>
                <For each={onDay().slice(0, 3)}>{entry =>
                  <button class="crm-month-entry" data-state={activityState(entry.activity)} title={`${entry.activity.kind} · ${entry.activity.title}`}
                    onClick={event => { event.stopPropagation(); setSelectedDay(day); if (entry.deal) props.onOpenDeal(entry.deal.id); }}>
                    <Icon name={ACTIVITY_ICONS[entry.activity.kind]} size={11} />
                    <Show when={entry.activity.dueTime}><i>{entry.activity.dueTime}</i></Show>
                    <span>{entry.activity.title || entry.activity.kind}</span>
                  </button>}</For>
                <Show when={onDay().length > 3}><small>+{onDay().length - 3} weitere</small></Show>
              </div>;
            }}</For>
          </div>
          <aside class="crm-month-agenda" aria-label="Ausgewählter Tag">
            <header><strong>{dateLabel(dayKey(selectedDay()))}</strong><span>{dayEntries().length} Aktivität{dayEntries().length === 1 ? "" : "en"}</span></header>
            <For each={dayEntries()}>{entry => <div class="crm-agenda-row" data-state={activityState(entry.activity)}>
              <input type="checkbox" checked={entry.activity.done} aria-label={`${entry.activity.title} erledigt`} onChange={() => toggle(entry.activity.id)} />
              <span>
                <strong>{entry.activity.title || entry.activity.kind}</strong>
                <small>{entry.activity.kind}{entry.activity.dueTime ? ` · ${entry.activity.dueTime}` : ""}{entry.activity.duration ? ` · ${durationLabel(entry.activity.duration)}` : ""}</small>
              </span>
              <Show when={entry.deal} fallback={<LinkPicker deals={linkable()} onLink={dealId => link(entry.activity.id, dealId)} />}>
                {deal => <button class="crm-link" onClick={() => props.onOpenDeal(deal().id)}>{deal().title}</button>}
              </Show>
            </div>}</For>
            <Show when={!dayEntries().length}>
              <p class="crm-empty">Für diesen Tag ist nichts geplant.</p>
            </Show>
            <button class="crm-agenda-add" onClick={() => openOn(selectedDay())}><Icon name="plus" size={14} /> Für diesen Tag planen</button>
          </aside>
        </div>
      </section>
    </Show>

    <Show when={composer()}>{draft =>
      <ActivityComposer data={props.data()} owners={props.owners} initial={draft()} onClose={() => setComposer(null)} onSave={save} />}</Show>
  </section>;
}

/** An inbox activity is missing exactly one thing, so it offers exactly one control:
 *  the deal it should belong to. Choosing MOVES it onto that deal (§linkActivity). */
function LinkPicker(props: { deals: Deal[]; onLink: (dealId: string) => void }) {
  return <select class="crm-activity-link" aria-label="Deal zuordnen" value="" onChange={event => { const value = event.currentTarget.value; event.currentTarget.value = ""; if (value) props.onLink(value); }}>
    <option value="">Ohne Deal – zuordnen…</option>
    <For each={props.deals}>{deal => <option value={deal.id}>{deal.title}</option>}</For>
  </select>;
}

function ActivityRow(props: { entry: ActivityEntry; deals: () => Deal[]; onLink: (activityId: string, dealId: string) => void; onToggle: (id: string) => void; onOpenDeal: (id: string) => void; onOpenOrg: (id: string) => void }) {
  const activity = () => props.entry.activity;
  const state = () => activityState(activity());
  return <div class="crm-activity-row" role="row" data-state={state()} classList={{ "is-done": activity().done }}>
    <span role="cell" class="crm-activity-check">
      <input type="checkbox" checked={activity().done} aria-label={`${activity().title || activity().kind} erledigt`} onChange={() => props.onToggle(activity().id)} />
    </span>
    <span role="cell" class="crm-activity-kind" title={activity().kind}><Icon name={ACTIVITY_ICONS[activity().kind]} size={15} />{activity().kind}</span>
    <span role="cell" class="crm-activity-subject">
      <strong>{activity().title || activity().kind}</strong>
      <Show when={activity().outcome}><small>{activity().outcome}</small></Show>
    </span>
    <span role="cell">
      <Show when={props.entry.deal} fallback={<LinkPicker deals={props.deals()} onLink={dealId => props.onLink(activity().id, dealId)} />}>
        {deal => <button class="crm-link" onClick={() => props.onOpenDeal(deal().id)}>{deal().title}</button>}
      </Show>
    </span>
    <span role="cell">
      <Show when={props.entry.org} fallback={<span>—</span>}>
        {org => <button class="crm-link" onClick={() => props.onOpenOrg(org().id)}>{org().name}</button>}
      </Show>
    </span>
    <span role="cell">{activity().owner || props.entry.deal?.owner || "Nicht zugeteilt"}</span>
    <span role="cell" class="crm-activity-due" data-state={state()}>
      {dateLabel(activity().dueDate)}<Show when={activity().dueTime}><i>{activity().dueTime}</i></Show>
      <small>{STATE_LABELS[state()]}</small>
    </span>
    <span role="cell">{durationLabel(activity().duration)}</span>
    <span role="cell"><i class="crm-priority" data-priority={activity().priority}>{activity().priority}</i></span>
  </div>;
}

/** The composer: one form for planned work, linked or not. A deal is OPTIONAL, so the
 *  first activity of a working day never has to wait for an opportunity to exist. */
function ActivityComposer(props: {
  data: CrmData; owners: readonly string[]; initial: { dealId: string; dueDate: string };
  onClose: () => void; onSave: (draft: ActivityDraft) => void;
}) {
  const [draft, setDraft] = createSignal<ActivityDraft>({
    kind: "Anruf", title: "", dueDate: props.initial.dueDate, dueTime: "", duration: 30,
    priority: "Normal", owner: props.owners[0] ?? "", outcome: "", dealId: props.initial.dealId,
  });
  const patch = (values: Partial<ActivityDraft>) => setDraft(current => ({ ...current, ...values }));
  const deals = () => live(props.data.deals).filter(deal => deal.status === "Offen" || deal.id === draft().dealId);
  const orgName = (dealId: string) => {
    const deal = props.data.deals.find(item => item.id === dealId);
    return deal ? organizationOf(props.data, deal)?.name ?? "" : "";
  };
  return <div class="crm-overlay" role="presentation">
    <form class="crm-modal crm-activity-composer" onSubmit={event => { event.preventDefault(); if (draft().title.trim()) props.onSave(draft()); }}>
      <header><h2>Neue Aktivität</h2><button type="button" class="icon-button" onClick={props.onClose}><Icon name="close" /></button></header>
      <div class="crm-composer-kinds" role="group" aria-label="Art der Aktivität">
        <For each={ACTIVITY_KINDS}>{value =>
          <button type="button" classList={{ active: draft().kind === value }} aria-pressed={draft().kind === value} onClick={() => patch({ kind: value })}>
            <Icon name={ACTIVITY_ICONS[value]} size={14} /> {value}
          </button>}</For>
      </div>
      <label>Betreff<input autofocus value={draft().title} onInput={event => patch({ title: event.currentTarget.value })} placeholder="z. B. Angebot nachfassen" /></label>
      <label>Deal
        <select aria-label="Verknüpfter Deal" value={draft().dealId} onChange={event => patch({ dealId: event.currentTarget.value })}>
          <option value="">Ohne Deal (Posteingang)</option>
          <For each={deals()}>{deal => <option value={deal.id}>{deal.title}{orgName(deal.id) && orgName(deal.id) !== deal.title ? ` · ${orgName(deal.id)}` : ""}</option>}</For>
        </select>
      </label>
      <div class="crm-composer-grid">
        <label>Fällig am<DateField label="Fällig am" value={draft().dueDate} onChange={dueDate => patch({ dueDate })} placeholder="Datum wählen" /></label>
        <label>Uhrzeit
          <select aria-label="Uhrzeit" value={draft().dueTime} onChange={event => patch({ dueTime: event.currentTarget.value })}>
            <option value="">Ganztägig</option>
            <For each={TIME_SLOTS}>{slot => <option value={slot}>{slot}</option>}</For>
          </select>
        </label>
        <label>Dauer
          <select aria-label="Dauer" value={String(draft().duration)} onChange={event => patch({ duration: Number(event.currentTarget.value) })}>
            <For each={ACTIVITY_DURATIONS}>{minutes => <option value={String(minutes)}>{minutes ? durationLabel(minutes) : "Ohne Angabe"}</option>}</For>
          </select>
        </label>
        <label>Priorität
          <select aria-label="Priorität" value={draft().priority} onChange={event => patch({ priority: event.currentTarget.value as ActivityPriority })}>
            <For each={ACTIVITY_PRIORITIES}>{value => <option value={value}>{value}</option>}</For>
          </select>
        </label>
        <label>Verantwortlich
          <select aria-label="Verantwortliche Person" value={draft().owner} onChange={event => patch({ owner: event.currentTarget.value })}>
            <For each={props.owners}>{owner => <option value={owner}>{owner || "Nicht zugeteilt"}</option>}</For>
          </select>
        </label>
      </div>
      <label>Notiz<textarea value={draft().outcome} onInput={event => patch({ outcome: event.currentTarget.value })} placeholder="Worum geht es? Wird an der Aktivität gespeichert." /></label>
      <p>Ohne Deal landet die Aktivität im Posteingang und kann später einem Deal zugeordnet werden.</p>
      <footer><button type="button" class="ghost" onClick={props.onClose}>Abbrechen</button><button class="primary" disabled={!draft().title.trim()}>Aktivität anlegen</button></footer>
    </form>
  </div>;
}
