/**
 * THE COLOUR LAW — one source of truth for every pill, tag and dot in the app.
 *
 *   teal  = action / open
 *   amber = due soon / waiting
 *   red   = critical / blocked
 *
 * Nothing else may carry those three colours, and — the rule this module exists to
 * enforce — **one element expresses exactly ONE fact**.
 *
 * The bug that motivated this file: a ticket's STATUS pill read "No status" while its
 * colour was computed from the ticket's DUE DATE. Two rows with identical text ("No
 * status") came out red and teal, because the reader was being shown urgency in the
 * place that claims to show status. A colour that contradicts its own label is worse
 * than no colour at all.
 *
 * So the facts are kept apart, and each has its own function here:
 *
 *   status   -> `statusTone`    (is this work open or resolved?)     never reads a date
 *   urgency  -> `urgencyTone`   (is the deadline near or past?)      never reads a status
 *   priority -> `priorityTone`  (how important is it?)               never reads a date
 *
 * A surface that wants to show two of those facts must render two elements. It must
 * not blend them into one.
 */

/** The entire colour vocabulary. `""` is "no colour" — the quiet default, and by far
 *  the most common correct answer. `"done"` is neutral/greyed, not one of the three. */
export type Tone = "" | "teal" | "amber" | "red" | "done";

/** How a due date stands relative to today. A date fact — it knows nothing of status. */
export type Urgency = "none" | "overdue" | "today" | "soon" | "later";

/** Default window for "soon". Callers with a different horizon pass their own:
 *  a project deadline looks a week ahead, a ticket only three days. */
export const SOON_DAYS = 3;
/** Steering's project-deadline horizon, kept as a named constant so the one surface
 *  that legitimately differs says so out loud instead of hard-coding a 7. */
export const DEADLINE_SOON_DAYS = 7;

/** Today as `YYYY-MM-DD`, local. */
export const todayISO = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** `YYYY-MM-DD`, `days` from now, local. */
export const inDays = (days: number, from: string = todayISO()): string => {
  const [y, m, d] = from.split("-").map(Number);
  const at = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

/** Whole days from `today` to `due`, both `YYYY-MM-DD`. Negative = in the past.
 *  Parsed as UTC midnight on both sides, so no timezone can shift the day. */
export const daysUntil = (due: string, today: string = todayISO()): number =>
  Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * The urgency of a due date. This is the ONLY place the overdue/due-soon comparison
 * is written; it used to be copy-pasted across seven views, each with its own
 * off-by-one and its own idea of how near "soon" is.
 */
export const urgencyOf = (
  due: string | null | undefined,
  today: string = todayISO(),
  soonDays: number = SOON_DAYS,
): Urgency => {
  if (!due) return "none";
  const days = daysUntil(due, today);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= soonDays ? "soon" : "later";
};

/**
 * Urgency -> colour.
 *
 * Past due is the only thing here that is critical, so it is the only red. Due today
 * and due shortly are both "due soon" and share amber; note that due-today is amber
 * and NOT teal — teal means "there is an action open", which is a statement about
 * status, not about the calendar. A date further out is not urgent and gets no
 * colour at all, because colouring everything is the same as colouring nothing.
 */
export const urgencyTone = (urgency: Urgency): Tone =>
  urgency === "overdue" ? "red" : urgency === "today" || urgency === "soon" ? "amber" : "";

/** Convenience: due date straight to a colour, for the date element itself. */
export const dueTone = (due: string | null | undefined, today?: string, soonDays?: number): Tone =>
  urgencyTone(urgencyOf(due, today, soonDays));

/** The word a human reads for an urgency. Paired with the tone, never instead of it. */
export const urgencyLabel = (urgency: Urgency): string =>
  urgency === "overdue" ? "Overdue" : urgency === "today" ? "Due today" : urgency === "soon" ? "Due soon" : "";

/**
 * STATUS -> colour. Deliberately takes only the status, so it is structurally
 * incapable of leaking a due date into a status pill — the defect this module fixes.
 *
 * Open work asks for an action, so it is teal. Resolved work asks for nothing and
 * goes quiet ("done", a neutral grey). A status is never red: a status cannot be
 * "critical" on its own, only a deadline or an explicit blocker can be.
 */
export const statusTone = (status: { resolved?: boolean | null } | null | undefined): Tone =>
  status?.resolved ? "done" : "teal";

/**
 * PRIORITY -> colour. Its own fact, therefore its own element. `URGENT` is the one
 * user-declared "critical" the law allows to be red; `HIGH` is a waiting-room amber.
 * Anything below is unremarkable and gets no colour.
 */
export const priorityTone = (priority: string | null | undefined): Tone => {
  const value = (priority ?? "").toUpperCase();
  if (value === "URGENT" || value === "CRITICAL") return "red";
  if (value === "HIGH") return "amber";
  return "";
};

/**
 * ZERO CARRIES NO TONE.
 *
 * A metric states a quantity; its colour states how much that quantity should worry
 * you. When the quantity is none, there is nothing to worry about, so `0 Overdue`
 * must not be red — a red zero is a warning about nothing, and it trains the reader
 * to ignore the real red next to it.
 *
 * Callers pass the tone the metric would carry if it were non-empty; this decides
 * whether the number earns it. Empty means `0`, `"0"`, `null`, `undefined`, `""` and
 * the em-dash placeholder a surface renders while a figure is still unknown.
 */
export const metricTone = (value: unknown, tone: Tone): Tone => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value === 0 ? "" : tone;
  const text = String(value).trim();
  return text === "" || text === "0" || text === "—" || text === "-" ? "" : tone;
};

/** Legacy class vocabulary used by the project-deadline banner (`.st-deadline.soon`). */
export type DeadlineClass = "overdue" | "soon" | "ok";

/**
 * The project-deadline banner in Steering, expressed through the shared urgency scale
 * so it can never drift from the rest of the app. Its CSS class names predate the
 * teal/amber/red vocabulary, so both are returned: `tone` for the existing stylesheet,
 * `colour` for the law.
 */
export const deadlineTone = (
  deadline: string,
  today: string = todayISO(),
  soonDays: number = DEADLINE_SOON_DAYS,
): { tone: DeadlineClass; colour: Tone; note: string; days: number; urgency: Urgency } => {
  const days = daysUntil(deadline, today);
  const urgency = urgencyOf(deadline, today, soonDays);
  const tone: DeadlineClass = urgency === "overdue" ? "overdue" : urgency === "later" || urgency === "none" ? "ok" : "soon";
  const note =
    days === 0 ? "due today"
    : days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue`
    : `in ${days} day${days === 1 ? "" : "s"}`;
  return { tone, colour: urgencyTone(urgency), note, days, urgency };
};
