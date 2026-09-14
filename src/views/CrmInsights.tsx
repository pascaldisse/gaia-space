import { Show, createMemo, createSignal } from "solid-js";
import { Icon } from "../components/Icon";
import DateField from "../components/DateField";
import { PillMenu } from "../components/controls";
import { BarChart, ColumnChart, type ChartDatum, type ChartSeries } from "../components/Chart";
import { ACTIVITY_ICONS, type CrmData } from "../crmStore";
import {
  ALL_OWNERS, INSIGHT_RANGES, INSIGHT_RANGE_LABELS, activityKindBreakdown, activityStateBreakdown,
  insightMetrics, insightOwners, ownerBreakdown, rangeLabel, resolveRange, stageDistribution,
  type InsightRangeKey, type InsightScope,
} from "../crmInsights";

/** ── Vertriebsberichte ───────────────────────────────────────────────────────
 *
 *  This page is a READING of the CRM document, never a second store: every figure comes
 *  from §crmInsights, which counts what is there and returns `null` where the data
 *  cannot answer (a win rate without a single decided deal). Nothing is seeded,
 *  smoothed or projected.
 *
 *  It is a REPORT PAGE, so the charts carry it and the four headline numbers are a
 *  strip above them, not the page itself. Three questions, three shapes (§Chart):
 *    · where the open pipeline sits      → columns per stage, measured in whichever
 *                                          quantity is chosen (count / value / weighted)
 *    · how each person's deals ended     → one stacked bar per person, open/won/lost
 *    · what the worklist looks like      → stacked columns per kind (done vs open),
 *                                          beside the columns per state.
 *  Each chart also prints its own numbers as a table and speaks one summary sentence,
 *  and where the document says nothing, the chart says so in words instead of drawing
 *  a row of clickable zero-height bars.
 *
 *  The cards stay LINKS: a number you cannot open is a dead end, so the won value opens
 *  the won deals, the pipeline opens the board, the rate opens the lost list. */

const money = (amount: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
const moneyShort = (amount: number) => amount >= 10000
  ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: amount >= 100000 ? 0 : 1 }).format(amount / 1000)} Tsd. €`
  : money(amount);
const count = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
const percent = (value: number) => `${Math.round(value * 100)} %`;

export type InsightsTarget = "won" | "pipeline" | "lost" | "activities" | "open";

/** The pipeline chart answers one question at a time — "how many deals" and "how much
 *  money" are different reports — and the table underneath always prints all three. */
const STAGE_MEASURES = ["count", "value", "weighted"] as const;
type StageMeasure = typeof STAGE_MEASURES[number];
const STAGE_MEASURE_LABELS: Record<StageMeasure, string> = { count: "Anzahl Deals", value: "Deal-Wert", weighted: "Gewichteter Wert" };

const OUTCOME_SERIES: ChartSeries[] = [
  { key: "open", label: "Offen", tone: "open" },
  { key: "won", label: "Gewonnen", tone: "won" },
  { key: "lost", label: "Verloren", tone: "lost" },
];
const ACTIVITY_SERIES: ChartSeries[] = [
  { key: "open", label: "Offen", tone: "open" },
  { key: "done", label: "Erledigt", tone: "done" },
];

export default function CrmInsights(props: { data: () => CrmData; onOpen: (tab: InsightsTarget) => void }) {
  const [rangeKey, setRangeKey] = createSignal<InsightRangeKey>("90");
  const [custom, setCustom] = createSignal({ start: "", end: "" });
  const [owner, setOwner] = createSignal(ALL_OWNERS);
  const [measure, setMeasure] = createSignal<StageMeasure>("count");

  const range = createMemo(() => resolveRange(rangeKey(), custom()));
  const scope = createMemo<InsightScope>(() => ({ range: range(), owner: owner() }));
  const owners = createMemo(() => insightOwners(props.data()));
  const metrics = createMemo(() => insightMetrics(props.data(), scope()));
  const stages = createMemo(() => stageDistribution(props.data(), scope()));
  const byOwner = createMemo(() => ownerBreakdown(props.data(), scope()));
  const byState = createMemo(() => activityStateBreakdown(props.data(), scope()));
  const byKind = createMemo(() => activityKindBreakdown(props.data(), scope()));

  const stageData = createMemo<ChartDatum[]>(() => stages().map(slice => ({
    key: slice.stage, label: slice.name, note: `${slice.probability} %`,
    values: { amount: measure() === "count" ? slice.count : measure() === "value" ? slice.value : slice.weighted },
    extra: { count: count(slice.count), value: money(slice.value), weighted: money(slice.weighted) },
  })));
  const ownerData = createMemo<ChartDatum[]>(() => byOwner().map(slice => ({
    key: slice.owner, label: slice.owner,
    values: { open: slice.open, won: slice.won, lost: slice.lost },
    extra: { openValue: money(slice.openValue), wonValue: money(slice.wonValue) },
  })));
  const kindData = createMemo<ChartDatum[]>(() => byKind().map(slice => ({
    key: slice.kind, label: slice.kind,
    values: { open: slice.open, done: slice.done },
    icon: <Icon name={ACTIVITY_ICONS[slice.kind]} size={13} />,
  })));
  const stateData = createMemo<ChartDatum[]>(() => byState().map(slice => ({
    key: slice.state, label: slice.label, values: { count: slice.count },
  })));
  const stateSeries = createMemo<ChartSeries[]>(() => [{ key: "count", label: "Aktivitäten", tone: "accent" }]);

  const stageFormat = (value: number) => measure() === "count" ? count(value) : moneyShort(value);

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

    <div class="crm-insight-dashboard">
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

    <section class="crm-insight-report" aria-label="Offene Pipeline nach Phase">
      <header>
        <div>
          <h3>Pipeline nach Phase</h3>
          <small>Offene Deals je Phase. Gewichtet wird mit der in den Pipeline-Einstellungen hinterlegten Wahrscheinlichkeit.</small>
        </div>
        <PillMenu class="crm-insight-measure" label="Maßeinheit" value={measure()}
          options={STAGE_MEASURES.map(value => ({ value, label: STAGE_MEASURE_LABELS[value] }))}
          onChange={value => setMeasure(value as StageMeasure)} />
      </header>
      <ColumnChart
        data={stageData()} series={[{ key: "amount", label: STAGE_MEASURE_LABELS[measure()], tone: "open" }]}
        format={stageFormat} unit={STAGE_MEASURE_LABELS[measure()]} minStep={measure() === "count" ? 1 : 0}
        label="Offene Pipeline nach Phase"
        empty="Keine offenen Deals in diesem Zeitraum – es gibt nichts zu zeichnen. Die Phasen erscheinen wieder, sobald ein Deal darin liegt."
        tableCaption="Offene Deals je Phase: Anzahl, Deal-Wert und gewichteter Wert."
        columns={[{ key: "count", label: "Deals" }, { key: "value", label: "Deal-Wert" }, { key: "weighted", label: "Gewichtet" }]}
        onSelect={() => props.onOpen("pipeline")} selectHint={datum => `Pipeline öffnen (${datum.label})`} />
    </section>

    <section class="crm-insight-report" aria-label="Deal-Ausgang nach verantwortlicher Person">
      <header><div><h3>Deal-Ausgang nach verantwortlicher Person</h3><small>Jeder Deal im Zeitraum, aufgeteilt nach Ausgang: offen, gewonnen, verloren.</small></div></header>
      <BarChart
        data={ownerData()} series={OUTCOME_SERIES} format={count} unit="Anzahl Deals" minStep={1}
        label="Deal-Ausgang nach verantwortlicher Person"
        empty="Für diesen Zeitraum und Filter gibt es keine Deals – daher auch keine Verteilung nach Person."
        tableCaption="Deals je Person nach Ausgang, mit offenem und gewonnenem Wert."
        columns={[{ key: "openValue", label: "Offener Wert" }, { key: "wonValue", label: "Gewonnener Wert" }]}
        onSelect={() => props.onOpen("pipeline")} selectHint={datum => `Deals öffnen (${datum.label})`} />
    </section>

    <section class="crm-insight-report" aria-label="Aktivitäten nach Art und Status">
      <header><div><h3>Aktivitäten: erledigt und offen</h3><small>Der Arbeitsvorrat im Zeitraum – nach Art der Arbeit und nach Status.</small></div></header>
      <div class="crm-insight-split">
        <ColumnChart
          data={kindData()} series={ACTIVITY_SERIES} format={count} unit="Anzahl Aktivitäten" minStep={1}
          label="Aktivitäten nach Art, erledigt und offen"
          empty="Im gewählten Zeitraum ist keine Aktivität geplant – keine Art von Arbeit zu zeigen."
          tableCaption="Aktivitäten je Art: offen und erledigt."
          onSelect={() => props.onOpen("activities")} selectHint={datum => `Aktivitäten öffnen (${datum.label})`} />
        <ColumnChart
          data={stateData()} series={stateSeries()} format={count} unit="Anzahl Aktivitäten" minStep={1}
          label="Aktivitäten nach Status"
          empty="Im gewählten Zeitraum ist keine Aktivität geplant – es gibt keinen Status zu zählen."
          tableCaption="Aktivitäten je Status."
          onSelect={() => props.onOpen("activities")} selectHint={datum => `Aktivitäten öffnen (${datum.label})`} />
      </div>
    </section>
    </div>
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
