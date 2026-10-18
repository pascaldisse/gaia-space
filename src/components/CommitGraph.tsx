import { For, Show } from "solid-js";
import { UI_LOCALE } from "../calendar";
import type { Commit } from "../api";
import { edgePath, type GraphLayout } from "../gitGraph";
import "../views/Repos.css";

/* The commit-graph row, extracted from views/Repos.tsx so the project Repository tab renders
 * the SAME row (lane column, ref badges, short sha, relative date) instead of a second copy.
 * The styles (`.graph-row` & co) stay in Repos.css, imported here. */
export type Ref = { label: string; kind: "head" | "branch" | "remote" | "tag" };
export const ROW_H = 30;
const LANE_W = 16;
const LANE_PAD = 8;
/* Reused, not invented: the accent teal already used app-wide for the current
 * branch/HEAD, plus the three already-used badge hexes from the status list
 * below (`App.css` `.badge.modified/.renamed/.new`). Cycling through EXISTING
 * on-brand colours is what keeps a multi-lane graph legible without adding a
 * new palette to the theme. */
const LANE_COLORS = ["var(--accent, #00c2a8)", "var(--attn-amber, #f0a742)", "#7ab8f5", "#7cd68a"];
function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}
function laneX(lane: number): number {
  return LANE_PAD + lane * LANE_W;
}

export function when(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(UI_LOCALE, {
    year: "2-digit",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
/** "3d ago", "2mo ago" — the relative-date column Fork-class graphs use so a row
 *  reads at a glance without doing date arithmetic in your head. Falls back to
 *  seconds for anything under a minute. */
export function relativeTime(ts: number): string {
  const rtf = new Intl.RelativeTimeFormat(UI_LOCALE, { numeric: "auto" });
  const deltaSec = ts - Date.now() / 1000;
  const abs = Math.abs(deltaSec);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(deltaSec / secs), unit);
  }
  return rtf.format(Math.round(deltaSec), "second");
}

/** One row of the commit graph: the SVG lane column, flexible summary/ref badges,
 *  then fixed-width SHA/date. Pure render over an already-computed `LaneNode` — all the graph MATH lives in
 *  `gitGraph.ts` and is unit-tested there; this only turns lanes into pixels. */
export function GraphRow(props: {
  commit: Commit;
  node: GraphLayout["nodes"][number] | undefined;
  refs: Ref[];
  laneCount: number;
  active: boolean;
  /** This commit is what HEAD points at: drawn with an outer ring. */
  isHead?: boolean;
  onSelect: () => void;
}) {
  const width = () => LANE_PAD * 2 + Math.max(props.laneCount, 1) * LANE_W;
  return (
    <div class="graph-row" classList={{ active: props.active }} onClick={props.onSelect} role="row">
      <svg class="graph-cell" width={width()} height={ROW_H} viewBox={`0 0 ${width()} ${ROW_H}`} aria-hidden="true">
        <Show when={props.node}>
          {(node) => (
            <>
              <For each={node().passthroughLanes}>
                {(lane) => (
                  <line x1={laneX(lane)} y1={0} x2={laneX(lane)} y2={ROW_H} stroke={laneColor(lane)} stroke-width="2" />
                )}
              </For>
              <line
                x1={laneX(node().lane)}
                y1={0}
                x2={laneX(node().lane)}
                y2={ROW_H / 2}
                stroke={laneColor(node().lane)}
                stroke-width="2"
              />
              <For each={node().parentLanes}>
                {(link) => (
                  <path
                    d={edgePath(laneX(node().lane), ROW_H / 2, laneX(link.lane), ROW_H)}
                    fill="none"
                    stroke={laneColor(link.lane === node().lane ? node().lane : link.lane)}
                    stroke-width="2"
                  />
                )}
              </For>
              <Show when={props.isHead}>
                <circle cx={laneX(node().lane)} cy={ROW_H / 2} r={7.5} fill="none" stroke={laneColor(node().lane)} stroke-width="1.5" data-head-marker="true" />
              </Show>
              <circle cx={laneX(node().lane)} cy={ROW_H / 2} r={4.5} fill={laneColor(node().lane)} />
            </>
          )}
        </Show>
      </svg>
      <span class="graph-summary">
        {/* Fork order: ref chips lead the message so they survive the ellipsis. */}
        <For each={props.refs}>{(r) => <span class={`ref-badge ref-${r.kind}`}>{r.label}</span>}</For>
        {props.commit.summary || "(no summary)"}
      </span>
      <span class="graph-sha">{props.commit.short_id}</span>
      <span class="graph-date" title={when(props.commit.time)}>{relativeTime(props.commit.time)}</span>
    </div>
  );
}

