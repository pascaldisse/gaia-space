/** ── Chart scales: arithmetic only, no drawing ────────────────────────────────
 *
 *  A chart that scales its bars to the largest value it happens to hold has no axis:
 *  the tallest column is always full height, so two reports look identical while
 *  meaning different things. These three functions give the reports a REAL axis —
 *  a rounded top (10, 25, 200, 30.000) with even ticks — so a column's height is
 *  readable against printed numbers instead of against its neighbours.
 *
 *  Nothing here invents a floor or a target: an all-zero report has no axis at all
 *  (`axisTop` = 0, one tick), and the view says "no data" rather than drawing an
 *  empty grid that suggests a measurement was taken. */

/** The next "human" step up from a raw step: 1, 2, 2.5 or 5 times a power of ten. */
export const niceStep = (raw: number): number => {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const factor = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return factor * magnitude;
};

/** Ticks from 0 to a rounded top, `steps` intervals wide. `[0]` when there is nothing
 *  to scale — a report without data gets no grid.
 *  `minStep` is what a COUNT needs: three activities are three, never 2,5, so an axis
 *  over countable things is told its smallest legal step is one. */
export const axisTicks = (max: number, steps = 4, minStep = 0): number[] => {
  if (!(max > 0) || !Number.isFinite(max)) return [0];
  const step = Math.max(niceStep(max / Math.max(1, steps)), minStep);
  if (!step) return [0];
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
};

/** The value the axis ends at; 0 when the report is empty. */
export const axisTop = (max: number, steps = 4, minStep = 0): number => {
  const ticks = axisTicks(max, steps, minStep);
  return ticks[ticks.length - 1] ?? 0;
};

/** A length in percent of the AXIS, not of the biggest neighbour. */
export const axisShare = (value: number, top: number): number =>
  top > 0 ? Math.min(1, Math.max(0, value) / top) : 0;
