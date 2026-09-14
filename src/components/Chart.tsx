import { For, Show, createMemo, createUniqueId, type JSX } from "solid-js";
import { axisShare, axisTicks } from "../chartScale";
import "./Chart.css";

/** ── Charts: the report drawn, and the same report written ───────────────────
 *
 *  Two rules hold this file together.
 *
 *  1. A CHART IS A PICTURE OF NUMBERS THAT ARE ALSO PRINTED. Every chart renders a
 *     `<table>` of exactly the values it draws (collapsed under "Datentabelle", open
 *     to anyone and to a screen reader), and the plot itself is a single `role="img"`
 *     with a spoken summary — because a wall of bar-shaped divs read out one by one is
 *     noise, while one sentence plus a real table is the report.
 *
 *  2. NOTHING IS DRAWN THAT WAS NOT MEASURED. Bars are scaled against a rounded AXIS
 *     (§chartScale), not against the tallest neighbour, and a report whose values are
 *     all zero draws no grid, no stub bars and no clickable emptiness: it prints the
 *     sentence the caller gives it. Empty CATEGORIES inside a report that does have
 *     data stay visible — an empty stage is a finding — but carry `data-empty`.
 *
 *  There is no charting dependency: three bar layouts do not justify one, and a library
 *  would bring its own palette, while the outcome colours here are the app's own
 *  semantics (open = accent, won = success, lost = danger, done/open activities alike). */

export type ChartSeries = {
  key: string;
  label: string;
  /** Maps to `data-tone`, i.e. to the app's outcome palette — never to a chart theme. */
  tone: "open" | "won" | "lost" | "done" | "accent" | "overdue" | "muted";
};
export type ChartDatum = {
  key: string;
  label: string;
  /** A second line under the category label (a probability, a state). */
  note?: string;
  values: Record<string, number>;
  /** What the table prints next to the counted values (weighted sums, money). */
  extra?: Record<string, string>;
  icon?: JSX.Element;
};
export type ChartColumn = { key: string; label: string };

export type ChartProps = {
  data: ChartDatum[];
  series: ChartSeries[];
  /** Axis and table formatting of one value. */
  format: (value: number) => string;
  /** What the measured quantity IS, printed at the axis ("Deals", "Aktivitäten", "€"). */
  unit: string;
  /** Said out loud when there is nothing to draw. */
  empty: string;
  /** Accessible name of the plot; the spoken summary is appended to it. */
  label: string;
  tableCaption: string;
  /** Extra table columns, keyed into `datum.extra`. */
  columns?: ChartColumn[];
  /** Smallest legal axis step — `1` wherever the quantity is a COUNT (§chartScale). */
  minStep?: number;
  onSelect?: (datum: ChartDatum) => void;
  selectHint?: (datum: ChartDatum) => string;
};

const total = (datum: ChartDatum, series: ChartSeries[]) =>
  series.reduce((sum, item) => sum + (datum.values[item.key] ?? 0), 0);

/** The sentence a screen reader hears instead of forty bar elements. */
export const chartSummary = (props: ChartProps): string => {
  const rows = props.data.map(datum => {
    const parts = props.series.length === 1
      ? props.format(datum.values[props.series[0].key] ?? 0)
      : props.series.map(item => `${props.format(datum.values[item.key] ?? 0)} ${item.label.toLowerCase()}`).join(", ");
    return `${datum.label}: ${parts}`;
  });
  return `${props.label}. ${props.unit}. ${rows.join("; ")}.`;
};

const hasData = (props: ChartProps) => props.data.some(datum => total(datum, props.series) > 0);
const maxTotal = (props: ChartProps) => props.data.reduce((top, datum) => Math.max(top, total(datum, props.series)), 0);

/** Legend, plot, table — and, when the document is silent, one honest sentence. */
function ChartFrame(props: ChartProps & { kind: "columns" | "bars"; children: (top: number, ticks: number[]) => JSX.Element }) {
  const id = createUniqueId();
  const ticks = createMemo(() => axisTicks(maxTotal(props), 4, props.minStep ?? 0));
  const top = createMemo(() => ticks()[ticks().length - 1] ?? 0);
  return <figure class="chart" data-kind={props.kind}>
    <Show when={hasData(props)} fallback={<p class="chart-empty" role="status">{props.empty}</p>}>
      <Show when={props.series.length > 1}>
        <ul class="chart-legend">
          <For each={props.series}>{item => <li data-tone={item.tone}><i aria-hidden="true" />{item.label}</li>}</For>
        </ul>
      </Show>
      <div class="chart-plot" role="img" aria-label={chartSummary(props)}>{props.children(top(), ticks())}</div>
      <details class="chart-data">
        <summary id={`chart-table-${id}`}>Datentabelle</summary>
        <table aria-labelledby={`chart-table-${id}`}>
          <caption>{props.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">Kategorie</th>
              <For each={props.series}>{item => <th scope="col">{item.label}</th>}</For>
              <Show when={props.series.length > 1}><th scope="col">Gesamt</th></Show>
              <For each={props.columns ?? []}>{column => <th scope="col">{column.label}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={props.data}>{datum => <tr>
              <th scope="row">{datum.label}{datum.note ? ` (${datum.note})` : ""}</th>
              <For each={props.series}>{item => <td>{props.format(datum.values[item.key] ?? 0)}</td>}</For>
              <Show when={props.series.length > 1}><td>{props.format(total(datum, props.series))}</td></Show>
              <For each={props.columns ?? []}>{column => <td>{datum.extra?.[column.key] ?? "—"}</td>}</For>
            </tr>}</For>
          </tbody>
        </table>
      </details>
    </Show>
  </figure>;
}

/** Vertical columns: categories along the bottom, the measured quantity up the side.
 *  Stacked when more than one series is handed in (activities: done on top of open). */
export function ColumnChart(props: ChartProps) {
  return <ChartFrame {...props} kind="columns">{(top, ticks) =>
    <div class="chart-columns-plot">
      <div class="chart-axis-y" aria-hidden="true">
        <For each={[...ticks].reverse()}>{tick => <span>{props.format(tick)}</span>}</For>
      </div>
      <div class="chart-canvas">
        <div class="chart-grid" aria-hidden="true"><For each={ticks}>{() => <i />}</For></div>
        <ol class="chart-columns">
          <For each={props.data}>{datum => {
            const sum = () => total(datum, props.series);
            const body = <>
              <span class="chart-column-total">{props.format(sum())}</span>
              <span class="chart-stack" style={{ height: `${axisShare(sum(), top) * 100}%` }}>
                <For each={props.series}>{item =>
                  <Show when={(datum.values[item.key] ?? 0) > 0}>
                    <i data-tone={item.tone} style={{ flex: String(datum.values[item.key] ?? 0) }}
                      title={`${datum.label} · ${item.label}: ${props.format(datum.values[item.key] ?? 0)}`} />
                  </Show>}</For>
              </span>
            </>;
            return <li class="chart-column" data-empty={sum() === 0}>
              <Show when={props.onSelect} fallback={<div class="chart-column-body">{body}</div>}>
                <button type="button" class="chart-column-body" title={props.selectHint?.(datum)} onClick={() => props.onSelect?.(datum)}>{body}</button>
              </Show>
              <span class="chart-column-label">{datum.icon}{datum.label}<Show when={datum.note}><i>{datum.note}</i></Show></span>
            </li>;
          }}</For>
        </ol>
      </div>
    </div>}</ChartFrame>;
}

/** Horizontal stacked bars: one row per category, the axis along the bottom.
 *  Used where the category is a NAME (people), which never fits under a column. */
export function BarChart(props: ChartProps) {
  return <ChartFrame {...props} kind="bars">{(top, ticks) =>
    <div class="chart-bars-plot">
      <ol class="chart-bars">
        <For each={props.data}>{datum => {
          const sum = () => total(datum, props.series);
          const body = <>
            <span class="chart-bar-track">
              <span class="chart-stack" style={{ width: `${axisShare(sum(), top) * 100}%` }}>
                <For each={props.series}>{item =>
                  <Show when={(datum.values[item.key] ?? 0) > 0}>
                    <i data-tone={item.tone} style={{ flex: String(datum.values[item.key] ?? 0) }}
                      title={`${datum.label} · ${item.label}: ${props.format(datum.values[item.key] ?? 0)}`} />
                  </Show>}</For>
              </span>
            </span>
            <span class="chart-bar-value">{props.series.map(item => `${props.format(datum.values[item.key] ?? 0)} ${item.label.toLowerCase()}`).join(" · ")}</span>
          </>;
          return <li class="chart-bar" data-empty={sum() === 0}>
            <span class="chart-bar-label">{datum.label}<Show when={datum.note}><i>{datum.note}</i></Show></span>
            <Show when={props.onSelect} fallback={<div class="chart-bar-body">{body}</div>}>
              <button type="button" class="chart-bar-body" title={props.selectHint?.(datum)} onClick={() => props.onSelect?.(datum)}>{body}</button>
            </Show>
          </li>;
        }}</For>
      </ol>
      <div class="chart-axis-x" aria-hidden="true"><For each={ticks}>{tick => <span>{props.format(tick)}</span>}</For></div>
      <p class="chart-axis-caption" aria-hidden="true">{props.unit}</p>
    </div>}</ChartFrame>;
}
