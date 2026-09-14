import { For, Show, createMemo, createSignal } from "solid-js";
import { Icon } from "../components/Icon";
import DateField from "../components/DateField";
import { PillMenu } from "../components/controls";
import { ACTIVITY_ICONS, type CrmData } from "../crmStore";
import {
  ALL_OWNERS, INSIGHT_RANGES, INSIGHT_RANGE_LABELS, activityKindBreakdown, activityStateBreakdown,
  insightMetrics, insightOwners, maxOf, ownerBreakdown, rangeLabel, resolveRange, share, stageDistribution,
  type InsightRangeKey, type InsightScope,
} from "../crmInsights";

/** ── Vertriebsberichte ───────────────────────────────────────────────────────
 *
 *  This is a READING of the CRM document, never a second store: every figure comes
 *  from §crmInsights, which counts what is there and returns `null` where the data
 *  cannot answer (a win rate without a single decided deal). Nothing here is seeded,
 *  smoothed or projected.
 *
 *  The bars are drawn by the product — a width in percent of the largest value in the
 *  SAME report — because a charting dependency for four bar lists would buy nothing
 *  and would style itself. Every bar therefore carries its number in text as well, so
 *  the report is readable without seeing the bar at all.
 *
 *  Each headline card is a LINK: a number you cannot open is a dead end, so the won
 *  value opens the won deals, the pipeline opens the board, the rate opens the lost
 *  list, the activity count opens the worklist. */

const money = (amount: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
const percent = (value: number) => `${Math.round(value * 100)} %`;
const bar = (value: number, max: number) => `${Math.round(share(value, max) * 100)}%`;

export type InsightsTarget = "won" | "pipeline" | "lost" | "activities" | "open";

export default function CrmInsights(props: { data: () => CrmData; onOpen: (tab: InsightsTarget) => void }) {
  const [rangeKey, setRangeKey] = createSignal<InsightRangeKey>("90");
  const [custom, setCustom] = createSignal({ start: "", end: "" });
  const [owner, setOwner] = createSignal(ALL_OWNERS);

  const range = createMemo(() => resolveRange(rangeKey(), custom()));
  const scope = createMemo<InsightScope>(() => ({ range: range(), owner: owner() }));
  const owners = createMemo(() => insightOwners(props.data()));
  const metrics = createMemo(() => insightMetrics(props.data(), scope()));
  const stages = createMemo(() => stageDistribution(props.data(), scope()));
  const byOwner = createMemo(() => ownerBreakdown(props.data(), scope()));
  const byState = createMemo(() => activityStateBreakdown(props.data(), scope()));
  const byKind = createMemo(() => activityKindBreakdown(props.data(), scope()));

  return <section class="crm-directory crm-insights">
    <header>
      <div>
        <h2>Einblicke</h2>
        <p>Vertriebsberichte aus den eigenen CRM-Daten. Alles hier ist gezählt, nichts ist geschätzt – fehlt die Grundlage, steht es da.</p>
      </div>
      <span>{rangeLabel(rangeKey(), range())}</span>
    </header>

    <div class="crm-insight-filters" role="group" aria-label="Berichte filtern">
      <PillMenu class="crm-insight-range" label="Zeitraum" value={rangeKey()}
        options={INSIGHT_RANGES.map(value => ({ value, label: INSIGHT_RANGE_LABELS[value] }))}
        onChange={value => setRangeKey(value as InsightRangeKey)} />
      <Show when={rangeKey() === "custom"}>
        <div class="crm-insight-custom">
          <DateField label="Zeitraum von" value={custom().start} placeholder="von" onChange={start => setCustom(current => ({ ...current, start }))} />
          <DateField label="Zeitraum bis" value={custom().end} placeholder="bis" onChange={end => setCustom(current => ({ ...current, end }))} />
        </div>
      </Show>
      <PillMenu class="crm-insight-owner" label="Verantwortlich" value={owner()}
        options={owners().map(value => ({ value, label: value }))} onChange={setOwner} />
      <Show when={owner() !== ALL_OWNERS || rangeKey() !== "90"}>
        <button type="button" class="crm-link" onClick={() => { setRangeKey("90"); setOwner(ALL_OWNERS); setCustom({ start: "", end: "" }); }}>Filter zurücksetzen</button>
      </Show>
    </div>

    <div class="crm-insight-cards">
      <Card title="Gewonnener Deal-Wert" tone="won" hint={`${metrics().won.count} gewonnene Deal${metrics().won.count === 1 ? "" : "s"} im Zeitraum`}
        value={metrics().won.count ? money(metrics().won.value) : null} empty="Kein gewonnener Deal in diesem Zeitraum."
        action="Gewonnene Deals öffnen" onOpen={() => props.onOpen("won")} />
      <Card title="Gewichtete offene Pipeline" tone="open" hint={`${metrics().openPipeline.count} offene Deals · ${money(metrics().openPipeline.gross)} ungewichtet`}
        value={metrics().openPipeline.count ? money(metrics().openPipeline.value) : null} empty="Keine offenen Deals in diesem Zeitraum."
        action="Pipeline öffnen" onOpen={() => props.onOpen("pipeline")} />
      <Card title="Gewinnquote" tone="rate"
        hint={metrics().winRate.rate === null ? "Quote braucht abgeschlossene Deals" : `${metrics().winRate.won} gewonnen · ${metrics().winRate.lost} verloren`}
        value={metrics().winRate.rate === null ? null : percent(metrics().winRate.rate!)}
        empty="Noch kein Deal gewonnen oder verloren – es gibt keine Quote."
        action="Verlorene Deals öffnen" onOpen={() => props.onOpen("lost")} />
      <Card title="Offene Aktivitäten" tone={metrics().activities.overdue ? "overdue" : "open"}
        hint={metrics().activities.overdue ? `davon ${metrics().activities.overdue} überfällig` : "nichts überfällig"}
        value={metrics().activities.total ? String(metrics().activities.open) : null}
        empty="Für diesen Zeitraum ist keine Aktivität geplant."
        action="Aktivitäten öffnen" onOpen={() => props.onOpen("activities")} />
    </div>

    <section class="crm-insight-report" aria-label="Verteilung der Pipeline nach Phase">
      <header><h3>Pipeline nach Phase</h3><small>Offene Deals, gewichtet mit der in den Pipeline-Einstellungen hinterlegten Wahrscheinlichkeit.</small></header>
      <Show when={stages().some(slice => slice.count > 0)} fallback={<p class="crm-empty">Keine offenen Deals in diesem Zeitraum. Die Phasen bleiben leer, bis ein Deal darin liegt.</p>}>
        {(() => {
          const max = () => maxOf(stages().map(slice => slice.value));
          return <div class="crm-insight-bars">
            <For each={stages()}>{slice =>
              <button type="button" class="crm-insight-bar" data-empty={slice.count === 0} onClick={() => props.onOpen("pipeline")}>
                <span class="crm-insight-bar-label">{slice.name}<i>{slice.probability} %</i></span>
                <span class="crm-insight-bar-track"><i style={{ width: bar(slice.value, max()) }} /></span>
                <span class="crm-insight-bar-value">
                  <strong>{slice.count}</strong> Deal{slice.count === 1 ? "" : "s"} · {money(slice.value)}
                  <small>{money(slice.weighted)} gewichtet</small>
                </span>
              </button>}</For>
          </div>;
        })()}
      </Show>
    </section>

    <section class="crm-insight-report" aria-label="Deal-Status nach verantwortlicher Person">
      <header><h3>Deals nach verantwortlicher Person</h3><small>Jeder Deal im Zeitraum, aufgeteilt nach Ausgang.</small></header>
      <Show when={byOwner().length} fallback={<p class="crm-empty">Für diesen Zeitraum und Filter gibt es keine Deals.</p>}>
        {(() => {
          const max = () => maxOf(byOwner().map(slice => slice.total));
          return <div class="crm-insight-owners">
            <For each={byOwner()}>{slice =>
              <div class="crm-insight-owner-row">
                <span class="crm-insight-bar-label">{slice.owner}</span>
                <span class="crm-insight-stack" style={{ width: bar(slice.total, max()) }}>
                  <Show when={slice.open}><i class="open" style={{ flex: slice.open }} title={`${slice.open} offen`} /></Show>
                  <Show when={slice.won}><i class="won" style={{ flex: slice.won }} title={`${slice.won} gewonnen`} /></Show>
                  <Show when={slice.lost}><i class="lost" style={{ flex: slice.lost }} title={`${slice.lost} verloren`} /></Show>
                </span>
                <span class="crm-insight-bar-value">
                  <strong>{slice.open}</strong> offen · <strong>{slice.won}</strong> gewonnen · <strong>{slice.lost}</strong> verloren
                  <small>{money(slice.openValue)} offen · {money(slice.wonValue)} gewonnen</small>
                </span>
              </div>}</For>
            <p class="crm-insight-legend"><i class="open" /> Offen <i class="won" /> Gewonnen <i class="lost" /> Verloren</p>
          </div>;
        })()}
      </Show>
    </section>

    <section class="crm-insight-report" aria-label="Aktivitäten nach Status und Art">
      <header><h3>Aktivitäten</h3><small>Der Arbeitsvorrat im Zeitraum – nach Status und nach Art der Arbeit.</small></header>
      <Show when={metrics().activities.total} fallback={<p class="crm-empty">Im gewählten Zeitraum ist keine Aktivität geplant.</p>}>
        <div class="crm-insight-split">
          <div class="crm-insight-bars">
            <For each={byState()}>{slice =>
              <button type="button" class="crm-insight-bar" data-state={slice.state} data-empty={slice.count === 0} onClick={() => props.onOpen("activities")}>
                <span class="crm-insight-bar-label">{slice.label}</span>
                <span class="crm-insight-bar-track"><i data-state={slice.state} style={{ width: bar(slice.count, maxOf(byState().map(item => item.count))) }} /></span>
                <span class="crm-insight-bar-value"><strong>{slice.count}</strong></span>
              </button>}</For>
          </div>
          <div class="crm-insight-bars">
            <For each={byKind()}>{slice =>
              <button type="button" class="crm-insight-bar" data-empty={slice.count === 0} onClick={() => props.onOpen("activities")}>
                <span class="crm-insight-bar-label"><Icon name={ACTIVITY_ICONS[slice.kind]} size={13} />{slice.kind}</span>
                <span class="crm-insight-bar-track"><i style={{ width: bar(slice.count, maxOf(byKind().map(item => item.count))) }} /></span>
                <span class="crm-insight-bar-value"><strong>{slice.count}</strong><small>{slice.open} offen · {slice.done} erledigt</small></span>
              </button>}</For>
          </div>
        </div>
      </Show>
    </section>
  </section>;
}

/** A headline number with exactly two states: a counted value, or an honest blank. */
function Card(props: { title: string; hint: string; tone: string; value: string | null; empty: string; action: string; onOpen: () => void }) {
  return <button type="button" class="crm-insight-card" data-tone={props.tone} data-empty={props.value === null} onClick={props.onOpen} title={props.action}>
    <span class="crm-insight-card-title">{props.title}</span>
    <Show when={props.value !== null} fallback={<span class="crm-insight-card-empty">{props.empty}</span>}>
      <strong class="crm-insight-card-value">{props.value}</strong>
      <small class="crm-insight-card-hint">{props.hint}</small>
    </Show>
    <span class="crm-insight-card-action">{props.action} <Icon name="chevron-right" size={13} /></span>
  </button>;
}
