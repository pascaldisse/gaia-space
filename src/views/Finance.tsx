import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { financeApi, type FinanceEntry, type FinancePlanRow } from "../api/finance";
import PageHeader, { Chip } from "../components/PageHeader";
import { GhostPill } from "../components/controls";
import { humanError } from "../session";
import "../components/paper.css";
import "./Finance.css";

/** ── FINANCE ────────────────────────────────────────────────────────────────
 *  Plan versus actual for the company's own money: the plan comes from
 *  an imported plan file (`docs/finance-plan-format.md`), position by position; the actual
 *  from a Splitwise export the owner uploads.
 *
 *  WHO SEES THIS is decided by the SERVER (`finance.rs`, table `finance_access`).
 *  This view asks the same gate and reports its refusal in words; it never decides
 *  anything itself, because a view that decides access is a view that can be lied to.
 *
 *  THE MAIN VIEW IS A MONTH MATRIX: rows are the document's blocks and, unfolded,
 *  their named positions; columns are months. What the cells SAY (plan · actual ·
 *  deviation), WHICH blocks are shown (costs · revenue · both) and WHICH months are
 *  in view are three separate switches, and the chosen state outlives a reload.
 *
 *  COSTS AND REVENUE ARE TWO BLOCKS, never one column mixed by its sign — the plan
 *  row itself states which it is.
 *
 *  COLOUR LAW (the owner's rule): a month WITHOUT any actual gets no colour at all.
 *  Green may never mean "nothing booked". Colour appears only where an actual exists:
 *  teal = inside the plan, amber = close to the line, red = over it. Plan cells are
 *  plain ink; they are amounts, not judgements.
 *
 *  NO EMPTY BOXES: without plan rows there is no plan table, without bookings there
 *  is no booking table. What is absent gets no frame around its absence. */

const MONEY = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const euro = (cents: number) => MONEY.format(cents / 100);
const MONTH_LABEL = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const MONTH_SHORT = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" });
const monthLabel = (key: string) => {
  const date = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(date.valueOf()) ? key : MONTH_LABEL.format(date);
};
const monthShort = (key: string) => {
  const date = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(date.valueOf()) ? key : MONTH_SHORT.format(date);
};

/** The horizon of the two documents: August 2026 to March 2027. */
export const FIRST_MONTH = "2026-08";
export const LAST_MONTH = "2027-03";

export function monthsBetween(from: string, to: string): string[] {
  if (from > to) return [from];
  const months: string[] = [];
  let [year, month] = from.split("-").map(Number);
  for (let guard = 0; guard < 240; guard += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= to) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

/** The one place the plan/actual comparison becomes a colour.
 *  `planned` and `actual` are signed cents (negative = out). Costs and revenue are
 *  judged by the same question — "did we stay on the good side of the plan?" — which
 *  is why the sign of the plan, not a category list, decides the direction. */
export function deviationTone(planned: number, actual: number): "" | "teal" | "amber" | "red" {
  const deviation = actual - planned;
  if (deviation === 0) return "";
  if (planned === 0) return actual > 0 ? "teal" : "red";
  const ratio = actual / planned; // 1 = exactly on plan
  if (planned < 0) {
    // A cost: spending less than planned is good.
    if (ratio <= 0.9) return "teal";
    return ratio <= 1 ? "amber" : "red";
  }
  // Revenue: earning at least the plan is good.
  if (ratio >= 1) return "teal";
  return ratio >= 0.9 ? "amber" : "red";
}

/** German or plain notation, both accepted: "1.234,50", "1234.5", "-250 €". */
export function parseEuroToCents(raw: string): number | undefined {
  const text = raw.replace(/[€\s]/g, "").replace(/−/g, "-");
  if (!text || !/^-?[\d.,]+$/.test(text)) return undefined;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

type Mode = "plan" | "actual" | "deviation";
type Scope = "cost" | "revenue" | "both";
type Layout = "matrix" | "month";
type ViewState = { layout: Layout; mode: Mode; scope: Scope; from: string; to: string; month: string; open: string[]; withOptional: boolean };

const STATE_KEY = "finance.view.v1";
/** OPTIONAL POSITIONS ARE OUT BY DEFAULT. The owner's rule: a position marked
 *  `optional` in the plan file is paid only once the income carries it. A plan that
 *  spends money nobody has decided to spend is not a plan, it is a fear. The switch
 *  takes them back in, and both sums are shown either way, so nothing is hidden by
 *  the default. */
const DEFAULT_STATE: ViewState = {
  layout: "matrix", mode: "plan", scope: "both",
  from: FIRST_MONTH, to: LAST_MONTH, month: FIRST_MONTH, open: [], withOptional: false,
};

/** The chosen view is part of the work, not of the session: it survives a reload.
 *  A broken or absent entry is not an error — it is simply the default. */
export function readViewState(store: Pick<Storage, "getItem"> | undefined = safeStorage()): ViewState {
  try {
    const raw = store?.getItem(STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const saved = JSON.parse(raw) as Partial<ViewState>;
    return {
      ...DEFAULT_STATE, ...saved,
      open: Array.isArray(saved.open) ? saved.open : [],
      withOptional: saved.withOptional === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function safeStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

type ItemLine = {
  item: string;
  optional: boolean;
  estimated: boolean;
  assumption?: string | null;
  origin: string;
  plan: Map<string, number>;
  rowIds: Map<string, string>;
};
type Block = {
  category: string;
  kind: "cost" | "revenue";
  items: ItemLine[];
  /** Every position of the block. */
  plan: Map<string, number>;
  /** Only the positions nobody may switch off — what the plan costs at minimum. */
  planCore: Map<string, number>;
  actual: Map<string, number>;
  /** True when EVERY position in it is optional (the salaries are such a block). */
  optional: boolean;
};

const sum = (values: Map<string, number>, months: string[]) =>
  months.reduce((total, month) => total + (values.get(month) ?? 0), 0);

/** ONE SIGN, ONE TOOLTIP. Three pills next to a name pushed the name out of sight;
 *  what the document says about a position is a footnote, not a headline. */
export function lineMark(line: { optional: boolean; estimated: boolean; assumption?: string | null }, counted: boolean): { sign: string; title: string } | undefined {
  const notes: string[] = [];
  if (line.optional) notes.push(counted ? "Optional — eingerechnet" : "Optional — im Standard nicht eingerechnet");
  if (line.estimated) notes.push("Im Dokument geschätzt");
  if (line.assumption) notes.push(`Annahme: ${line.assumption}`);
  if (notes.length === 0) return undefined;
  return { sign: line.optional ? "○" : "*", title: notes.join(" · ") };
}

export default function Finance() {
  const [access, { refetch: refetchAccess }] = createResource(financeApi.access);
  const allowed = () => access()?.allowed === true;
  const saved = readViewState();
  const [layout, setLayout] = createSignal<Layout>(saved.layout);
  const [mode, setMode] = createSignal<Mode>(saved.mode);
  const [scope, setScope] = createSignal<Scope>(saved.scope);
  const [from, setFrom] = createSignal(saved.from);
  const [to, setTo] = createSignal(saved.to);
  const [month, setMonth] = createSignal(saved.month);
  const [open, setOpen] = createSignal<string[]>(saved.open);
  const [withOptional, setWithOptional] = createSignal(saved.withOptional);
  const [notice, setNotice] = createSignal("");
  const [failure, setFailure] = createSignal("");
  const [sortAscending, setSortAscending] = createSignal(false);
  const [editing, setEditing] = createSignal<{ category: string; item: string; month: string } | null>(null);
  const [draft, setDraft] = createSignal("");
  let csvInput: HTMLInputElement | undefined;
  let planInput: HTMLInputElement | undefined;

  // ONE place writes the remembered state; every switch below simply sets a signal.
  createEffect(() => {
    const state: ViewState = { layout: layout(), mode: mode(), scope: scope(), from: from(), to: to(), month: month(), open: open(), withOptional: withOptional() };
    try { safeStorage()?.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* a private window is not a failure */ }
  });

  const months = createMemo(() => (layout() === "month" ? [month()] : monthsBetween(from(), to())));
  const rangeKey = () => `${months()[0]}:${months()[months().length - 1]}`;
  const [entries, { refetch: refetchEntries }] = createResource(
    () => (allowed() ? rangeKey() : undefined),
    (key: string) => {
      const [first, last] = key.split(":");
      return financeApi.listEntries(`${first}-01`, `${last}-31`);
    },
  );
  const [plan, { refetch: refetchPlan }] = createResource(() => (allowed() ? true : undefined), financeApi.listPlan);
  const [members, { refetch: refetchMembers }] = createResource(() => (allowed() ? true : undefined), financeApi.listAccess);
  const [grantId, setGrantId] = createSignal("");

  /** The two-level plan, folded into blocks and their named positions, plus the
   *  actuals — which only ever arrive per CATEGORY, because a Splitwise line knows a
   *  category and not which position of the document it belongs to. That is said out
   *  loud in the view instead of inventing a split. */
  const blocks = createMemo<Block[]>(() => {
    const byCategory = new Map<string, Block>();
    const block = (category: string, kind: "cost" | "revenue") => {
      const found = byCategory.get(category);
      if (found) return found;
      const created: Block = { category, kind, items: [], plan: new Map(), planCore: new Map(), actual: new Map(), optional: false };
      byCategory.set(category, created);
      return created;
    };
    for (const row of plan() ?? []) {
      if (!months().includes(row.month)) continue;
      const kind: "cost" | "revenue" = row.kind === "revenue" || (!row.kind && row.planned_cents > 0) ? "revenue" : "cost";
      const target = block(row.category, kind);
      target.plan.set(row.month, (target.plan.get(row.month) ?? 0) + row.planned_cents);
      const name = row.item || row.category;
      let line = target.items.find(entry => entry.item === name);
      if (!line) {
        // The origin line says something NEW or it says nothing: where the det[]
        // entry and the position carry the same words, the block it came from is
        // the fact worth printing.
        const origin = [row.source_detail, row.source_block].find(text => text && text !== name) ?? "";
        line = { item: name, optional: row.optional, estimated: row.estimated, assumption: row.assumption, origin, plan: new Map(), rowIds: new Map() };
        target.items.push(line);
      }
      line.optional ||= row.optional;
      line.estimated ||= row.estimated;
      line.assumption ??= row.assumption;
      line.plan.set(row.month, (line.plan.get(row.month) ?? 0) + row.planned_cents);
      line.rowIds.set(row.month, row.id);
    }
    for (const entry of entries() ?? []) {
      const key = entry.entry_date.slice(0, 7);
      if (!months().includes(key)) continue;
      const target = block(entry.category, entry.amount_cents > 0 ? "revenue" : "cost");
      target.actual.set(key, (target.actual.get(key) ?? 0) + entry.amount_cents);
    }
    // The block's TWO sums are built from its positions, once, here: the full plan
    // and the plan without anything switchable. A block is optional only when every
    // position in it is; one obligatory position makes the whole block obligatory.
    for (const block of byCategory.values()) {
      for (const line of block.items) {
        if (line.optional) continue;
        for (const [key, cents] of line.plan) block.planCore.set(key, (block.planCore.get(key) ?? 0) + cents);
      }
      block.optional = block.items.length > 0 && block.items.every(line => line.optional);
    }
    return [...byCategory.values()]
      .map(entry => ({ ...entry, items: entry.items.sort((a, b) => a.item.localeCompare(b.item, "de")) }))
      .sort((a, b) => a.category.localeCompare(b.category, "de"));
  });

  /** What a block CONTRIBUTES to a sum — the only place the switch is read.
   *  A booking is never split by position (Splitwise knows a category, not a
   *  position), so an actual leaves the reckoning only with a WHOLLY optional block. */
  const blockPlan = (block: Block, key: string) =>
    (withOptional() ? block.plan.get(key) : block.planCore.get(key)) ?? 0;
  const blockActual = (block: Block, key: string) =>
    (withOptional() || !block.optional ? block.actual.get(key) : 0) ?? 0;
  const blockHasActual = (block: Block, key: string) =>
    (withOptional() || !block.optional) && block.actual.has(key);
  const blockCounted = (block: Block) => withOptional() || !block.optional;
  const overMonths = (read: (key: string) => number) => months().reduce((total, key) => total + read(key), 0);

  const shownBlocks = () => blocks().filter(entry => scope() === "both" || entry.kind === scope());
  const groups = createMemo(() => {
    const kinds: ("cost" | "revenue")[] = scope() === "revenue" ? ["revenue"] : scope() === "cost" ? ["cost"] : ["cost", "revenue"];
    return kinds
      .map(kind => ({ kind, label: kind === "cost" ? "Kosten" : "Umsatz", blocks: blocks().filter(entry => entry.kind === kind) }))
      .filter(group => group.blocks.length > 0);
  });

  const totalActual = () => shownBlocks().reduce((total, entry) => total + overMonths(key => blockActual(entry, key)), 0);
  const totalPlanned = () => shownBlocks().reduce((total, entry) => total + overMonths(key => blockPlan(entry, key)), 0);
  /** The other reading of the same range — shown next to it, never instead of it. */
  const totalPlannedOther = () =>
    shownBlocks().reduce((total, entry) =>
      total + sum(withOptional() ? entry.planCore : entry.plan, months()), 0);
  const optionalCount = () =>
    shownBlocks().reduce((count, entry) => count + entry.items.filter(line => line.optional).length, 0);
  const totalDeviation = () => totalActual() - totalPlanned();
  /** No booking in the whole range means there is no actual and no deviation —
   *  a chip that says "1.652 € deviation" against nothing is a claim, not a number. */
  const anyActual = () => shownBlocks().some(block => block.actual.size > 0);
  const assumptions = () =>
    blocks().flatMap(entry => entry.items.filter(line => line.assumption)).length;

  const sortedEntries = () =>
    [...(entries() ?? [])].sort((a, b) =>
      sortAscending() ? a.entry_date.localeCompare(b.entry_date) : b.entry_date.localeCompare(a.entry_date),
    );

  // A refusal from any of the three reads is NAMED. It replaces content; it never
  // turns into an empty state, which would claim there is no money data when we
  // simply were not allowed to read it.
  createEffect(() => {
    const reason = entries.error ?? plan.error ?? members.error;
    if (reason) setFailure(humanError(reason));
  });

  const run = async (work: () => Promise<string>) => {
    setFailure("");
    try {
      setNotice(await work());
    } catch (reason) {
      setNotice("");
      setFailure(humanError(reason));
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    await run(async () => {
      const summary = await financeApi.importSplitwise(text);
      await refetchEntries();
      // ONE line, in ONE place — the import reports itself where it was started.
      const errors = summary.errors.length ? ` · ${summary.errors.length} unreadable: ${summary.errors[0]}` : "";
      return `${summary.imported} imported · ${summary.skipped_duplicates} already known${errors}`;
    });
  };

  /** The plan is DATA: it arrives as a file, exactly like the Splitwise export, and
   *  reports itself in the same one line at the same place. A cell the owner
   *  corrected by hand is skipped, never silently rewritten. */
  const importPlanFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    await run(async () => {
      const summary = await financeApi.importPlan(text);
      await refetchPlan();
      const errors = summary.errors.length ? ` · ${summary.errors.length} unreadable: ${summary.errors[0]}` : "";
      const replaced = summary.replaced_summary_rows ? ` · ${summary.replaced_summary_rows} Sammelzeilen ersetzt` : "";
      return `${summary.inserted} neu · ${summary.updated} geändert · ${summary.skipped} unverändert · ${summary.positions} Posten in ${summary.categories} Kategorien${replaced}${errors}`;
    });
  };

  const isOpen = (category: string) => open().includes(category);
  const toggleCategory = (category: string) =>
    setOpen(current => (current.includes(category) ? current.filter(name => name !== category) : [...current, category]));

  const startEdit = (category: string, item: string, key: string, cents: number) => {
    if (mode() !== "plan") return;
    setEditing({ category, item, month: key });
    setDraft(String(cents / 100));
  };

  const commitEdit = (line: ItemLine, category: string, kind: "cost" | "revenue") => {
    const cell = editing();
    if (!cell) return;
    const cents = parseEuroToCents(draft());
    setEditing(null);
    if (cents === undefined) { setFailure(`„${draft()}“ ist kein Betrag`); return; }
    void run(async () => {
      await financeApi.upsertPlan({
        id: line.rowIds.get(cell.month) ?? "",
        category,
        item: line.item === category ? "" : line.item,
        month: cell.month,
        planned_cents: cents,
        kind,
        optional: line.optional,
        estimated: line.estimated,
        assumption: line.assumption ?? null,
      });
      await refetchPlan();
      return `${line.item} · ${monthShort(cell.month)} = ${euro(cents)}`;
    });
  };

  /** One cell. Says what the mode asks for, and carries colour ONLY where an actual
   *  exists — a month nobody booked in is not "green", it is silent. */
  const cellText = (planned: number, actual: number, hasActual: boolean) => {
    if (mode() === "plan") return planned === 0 ? "·" : euro(planned);
    if (!hasActual) return "·";
    return mode() === "actual" ? euro(actual) : euro(actual - planned);
  };
  const cellTone = (planned: number, actual: number, hasActual: boolean) =>
    mode() === "plan" || !hasActual ? "" : deviationTone(planned, actual);

  return <section class="finance-view">
    <PageHeader
      icon="target"
      title="Finance"
      subline="Plan versus actual — the plan from the finance documents, position by position; the actual from Splitwise."
      chips={<Show when={allowed()}>
        <Chip value={anyActual() ? euro(totalActual()) : "·"} label=" actual" />
        <Chip value={euro(totalPlanned())} label=" plan" />
        <Chip value={anyActual() ? euro(totalDeviation()) : "·"} label=" deviation" />
      </Show>}
    />
    <Show when={access.loading}><p class="paper-loading" role="status">Checking finance access…</p></Show>
    {/* Not allowed is an ANSWER, not an error banner: it is said once, plainly. */}
    <Show when={access() && !allowed()}>
      <p class="finance-refusal" role="status">{access()?.reason ?? "Finance is restricted to its named owners."}</p>
    </Show>
    <Show when={allowed()}>
      <nav class="page-actionbar" aria-label="Finance actions">
        <span class="actionbar-view-controls">
          <span class="segmented finance-switch" role="group" aria-label="View">
            <button type="button" classList={{ active: layout() === "matrix" }} aria-pressed={layout() === "matrix"} onClick={() => setLayout("matrix")}>Monatsmatrix</button>
            <button type="button" classList={{ active: layout() === "month" }} aria-pressed={layout() === "month"} onClick={() => setLayout("month")}>Einzelmonat</button>
          </span>
          <span class="segmented finance-switch" role="group" aria-label="Cells">
            <button type="button" classList={{ active: mode() === "plan" }} aria-pressed={mode() === "plan"} onClick={() => setMode("plan")}>Plan</button>
            <button type="button" classList={{ active: mode() === "actual" }} aria-pressed={mode() === "actual"} onClick={() => setMode("actual")}>Ist</button>
            <button type="button" classList={{ active: mode() === "deviation" }} aria-pressed={mode() === "deviation"} onClick={() => setMode("deviation")}>Abweichung</button>
          </span>
          <span class="segmented finance-switch" role="group" aria-label="Blocks">
            <button type="button" classList={{ active: scope() === "cost" }} aria-pressed={scope() === "cost"} onClick={() => setScope("cost")}>Kosten</button>
            <button type="button" classList={{ active: scope() === "revenue" }} aria-pressed={scope() === "revenue"} onClick={() => setScope("revenue")}>Umsatz</button>
            <button type="button" classList={{ active: scope() === "both" }} aria-pressed={scope() === "both"} onClick={() => setScope("both")}>Beides</button>
          </span>
          {/* The switch that decides what the sums mean — next to the readings it
              changes, not hidden in a menu. */}
          <button type="button" class="finance-optional-toggle" aria-pressed={withOptional()}
            title="Optionale Posten werden erst gezahlt, wenn Einnahmen sie tragen — die Plandatei sagt, welche das sind."
            onClick={() => setWithOptional(value => !value)}>
            <span aria-hidden="true">{withOptional() ? "◉" : "○"}</span> Optionale Posten einrechnen
          </button>
          <Show when={layout() === "matrix"} fallback={
            <label class="finance-month">Monat
              <input type="month" aria-label="Month" value={month()} onInput={event => setMonth(event.currentTarget.value)} />
            </label>
          }>
            <label class="finance-month">Von
              <input type="month" aria-label="From month" value={from()} onInput={event => setFrom(event.currentTarget.value)} />
            </label>
            <label class="finance-month">Bis
              <input type="month" aria-label="To month" value={to()} onInput={event => setTo(event.currentTarget.value)} />
            </label>
          </Show>
          {/* One action, one place: the importer IS the button. The browser's own file
              widget ("Choose File / no file selected") speaks a different language than
              every other control in this row, so it stays hidden behind the button and
              the result is said in ONE line where the import was started. */}
          <GhostPill onClick={() => csvInput?.click()}>Import Splitwise CSV</GhostPill>
          <input ref={csvInput} class="finance-csv-input" type="file" accept=".csv,text/csv" aria-label="Splitwise CSV" tabindex="-1"
            onChange={event => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          <GhostPill onClick={() => planInput?.click()}>Plan importieren</GhostPill>
          <input ref={planInput} class="finance-csv-input" type="file" accept=".json,application/json" aria-label="Finanzplan JSON" tabindex="-1"
            onChange={event => { void importPlanFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          <GhostPill onClick={() => { void refetchEntries(); void refetchPlan(); }} disabled={entries.loading}>Refresh</GhostPill>
        </span>
      </nav>
      {/* The answer stands where the action was taken — one line, no box. */}
      <Show when={notice()}><p class="finance-notice" role="status">{notice()}</p></Show>
      <Show when={failure()}><p class="finance-error" role="alert">{failure()}</p></Show>
      <p class="finance-month-title">
        {layout() === "month" ? monthLabel(month()) : `${monthLabel(months()[0])} – ${monthLabel(months()[months().length - 1])}`}
      </p>
      <Show when={access()?.missing.length}>
        <p class="finance-notice" role="status">Without a profile on this installation: {access()?.missing.join(", ")}</p>
      </Show>

      {/* ── THE MATRIX ──────────────────────────────────────────────────────── */}
      {/* NO PLAN YET — one line saying what to do, in the language of the button
          that does it. Not a box: an empty plan is a missing file, not an event. */}
      <Show when={!plan.loading && (plan() ?? []).length === 0}>
        <p class="finance-notice" role="status">Noch kein Plan — „Plan importieren" und die Plandatei wählen (Format: docs/finance-plan-format.md).</p>
      </Show>
      <Show when={layout() === "matrix" && groups().length > 0}>
        {/* ONE TABLE, ONE COLUMN AXIS. `table-layout: fixed` plus this colgroup means
            every row — category, position, sum — measures its months against the same
            edges; the indent of a position lives inside the first column and can no
            longer push the numbers sideways. The box scrolls, not the page, so the
            month header and the name column can stay in sight. */}
        <div class="finance-scroll">
        <table class="paper-card finance-table finance-matrix">
          <caption>
            {mode() === "plan" ? "Plan" : mode() === "actual" ? "Ist" : "Abweichung"} je Monat · Kategorie aufklappen für die Posten
            <Show when={mode() === "plan"}><span class="finance-hint"> · Zelle anklicken, um den Planwert zu korrigieren</span></Show>
          </caption>
          <colgroup>
            <col class="finance-col-name" />
            <For each={months()}>{() => <col class="finance-col-month" />}</For>
            <col class="finance-col-sum" />
          </colgroup>
          <thead><tr>
            <th scope="col">Kategorie · Posten</th>
            <For each={months()}>{key => <th scope="col" class="finance-num">{monthShort(key)}</th>}</For>
            <th scope="col" class="finance-num">Σ</th>
          </tr></thead>
          <For each={groups()}>{group =>
            <tbody class="finance-block" data-kind={group.kind}>
              <tr class="finance-block-head"><th scope="row" colSpan={months().length + 2}>{group.label}</th></tr>
              <For each={group.blocks}>{block => <>
                <tr class="finance-category" data-category={block.category}
                  classList={{ "finance-excluded": !blockCounted(block) }}>
                  <th scope="row">
                    <button type="button" class="finance-disclose" aria-expanded={isOpen(block.category)} onClick={() => toggleCategory(block.category)}>
                      <span aria-hidden="true">{isOpen(block.category) ? "▾" : "▸"}</span> {block.category}
                      <Show when={block.items.length > 1}><span class="finance-count"> · {block.items.length} Posten</span></Show>
                    </button>
                    <Show when={block.optional}>
                      <span class="finance-mark" title={blockCounted(block) ? "Optional — eingerechnet" : "Optional — im Standard nicht eingerechnet"}>{blockCounted(block) ? "◉" : "○"}</span>
                    </Show>
                  </th>
                  {/* A wholly optional block keeps showing ITS OWN numbers even while
                      it is out of the reckoning — struck out of the sum, never out of
                      sight, so nobody thinks the money vanished. */}
                  <For each={months()}>{key => {
                    const planned = () => (block.optional ? block.plan.get(key) ?? 0 : blockPlan(block, key));
                    const actual = () => block.actual.get(key) ?? 0;
                    const hasActual = () => block.actual.has(key);
                    const text = () => cellText(planned(), actual(), hasActual());
                    return <td class="finance-num" data-month={key}
                      classList={{
                        [`tone-${cellTone(planned(), actual(), hasActual())}`]: cellTone(planned(), actual(), hasActual()) !== "",
                        "finance-cell-empty": text() === "·",
                      }}>
                      {text()}
                    </td>;
                  }}</For>
                  <td class="finance-num finance-sum">{cellText(
                    block.optional ? sum(block.plan, months()) : overMonths(key => blockPlan(block, key)),
                    sum(block.actual, months()), block.actual.size > 0)}</td>
                </tr>
                <Show when={isOpen(block.category)}>
                  <For each={block.items}>{line =>
                    <tr class="finance-item" data-category={block.category} data-item={line.item}
                      classList={{ "finance-excluded": line.optional && !withOptional() }}>
                      <th scope="row">
                        <span class="finance-item-name">{line.item}</span>
                        {/* ONE quiet sign, everything the document says in its tooltip. */}
                        <Show when={lineMark(line, withOptional())}>{mark =>
                          <span class="finance-mark" classList={{ "finance-mark-optional": line.optional }} title={mark().title}>{mark().sign}</span>
                        }</Show>
                        <Show when={line.origin}><span class="finance-origin">{line.origin}</span></Show>
                      </th>
                      <For each={months()}>{key => {
                        const planned = () => line.plan.get(key) ?? 0;
                        const isEditing = () => {
                          const cell = editing();
                          return cell?.category === block.category && cell.item === line.item && cell.month === key;
                        };
                        return <td class="finance-num finance-editable" data-month={key}
                          classList={{ "finance-cell-empty": mode() !== "plan" || planned() === 0 }}>
                          <Show when={isEditing()} fallback={
                            <Show when={mode() === "plan"} fallback={<span class="finance-noactual" title="Ist-Werte kommen nur je Kategorie an — ein Splitwise-Beleg kennt keinen Posten">·</span>}>
                              <button type="button" class="finance-cell-edit" onClick={() => startEdit(block.category, line.item, key, planned())}
                                aria-label={`${line.item} ${monthShort(key)} bearbeiten`}>{planned() === 0 ? "·" : euro(planned())}</button>
                            </Show>
                          }>
                            <input class="finance-cell-input" aria-label={`${line.item} ${monthShort(key)} in Euro`} value={draft()} autofocus
                              onInput={event => setDraft(event.currentTarget.value)}
                              onBlur={() => commitEdit(line, block.category, block.kind)}
                              onKeyDown={event => {
                                if (event.key === "Enter") commitEdit(line, block.category, block.kind);
                                if (event.key === "Escape") setEditing(null);
                              }} />
                          </Show>
                        </td>;
                      }}</For>
                      <td class="finance-num finance-sum">{mode() === "plan" ? euro(sum(line.plan, months())) : "·"}</td>
                    </tr>
                  }</For>
                </Show>
              </>}</For>
              <tr class="finance-block-total" data-total={group.kind}>
                <th scope="row">{group.label} gesamt</th>
                <For each={months()}>{key => {
                  const planned = () => group.blocks.reduce((total, block) => total + blockPlan(block, key), 0);
                  const actual = () => group.blocks.reduce((total, block) => total + blockActual(block, key), 0);
                  const hasActual = () => group.blocks.some(block => blockHasActual(block, key));
                  return <td class="finance-num" data-month={key}>{cellText(planned(), actual(), hasActual())}</td>;
                }}</For>
                <td class="finance-num finance-sum">
                  {cellText(
                    group.blocks.reduce((total, block) => total + overMonths(key => blockPlan(block, key)), 0),
                    group.blocks.reduce((total, block) => total + overMonths(key => blockActual(block, key)), 0),
                    group.blocks.some(block => months().some(key => blockHasActual(block, key))),
                  )}
                </td>
              </tr>
              {/* THE OTHER SUM, SAID OUT LOUD. A default that quietly drops the
                  largest block would be a lie of omission; the reading not in force
                  stands beside the one that is, in the same column axis. */}
              <Show when={group.blocks.some(block => block.items.some(line => line.optional))}>
                <tr class="finance-block-total finance-total-other" data-total-other={group.kind}>
                  <th scope="row">{group.label} gesamt {withOptional() ? "ohne" : "inkl."} optionale Posten</th>
                  <For each={months()}>{key => {
                    const planned = () => group.blocks.reduce((total, block) =>
                      total + ((withOptional() ? block.planCore.get(key) : block.plan.get(key)) ?? 0), 0);
                    return <td class="finance-num" data-month={key}>{planned() === 0 ? "·" : euro(planned())}</td>;
                  }}</For>
                  <td class="finance-num finance-sum">
                    {euro(group.blocks.reduce((total, block) => total + sum(withOptional() ? block.planCore : block.plan, months()), 0))}
                  </td>
                </tr>
              </Show>
            </tbody>
          }</For>
          <tfoot>
            <tr class="finance-grand-total">
              <th scope="row">Saldo</th>
              <For each={months()}>{key => {
                const planned = () => shownBlocks().reduce((total, block) => total + blockPlan(block, key), 0);
                const actual = () => shownBlocks().reduce((total, block) => total + blockActual(block, key), 0);
                const hasActual = () => shownBlocks().some(block => blockHasActual(block, key));
                return <td class="finance-num" data-month={key}>{cellText(planned(), actual(), hasActual())}</td>;
              }}</For>
              <td class="finance-num finance-sum">{cellText(totalPlanned(), totalActual(), shownBlocks().some(block => months().some(key => blockHasActual(block, key))))}</td>
            </tr>
            <Show when={optionalCount() > 0}>
              <tr class="finance-grand-total finance-total-other">
                <th scope="row">Saldo {withOptional() ? "ohne" : "inkl."} optionale Posten</th>
                <For each={months()}>{key => {
                  const planned = () => shownBlocks().reduce((total, block) =>
                    total + ((withOptional() ? block.planCore.get(key) : block.plan.get(key)) ?? 0), 0);
                  return <td class="finance-num" data-month={key}>{planned() === 0 ? "·" : euro(planned())}</td>;
                }}</For>
                <td class="finance-num finance-sum">{euro(totalPlannedOther())}</td>
              </tr>
            </Show>
          </tfoot>
        </table>
        </div>
        <Show when={optionalCount() > 0}>
          <p class="finance-notice" role="status">
            {optionalCount()} optionale Posten {withOptional() ? "sind eingerechnet" : "stehen außerhalb der Rechnung"} (Zeichen ○) — der Schalter „Optionale Posten einrechnen“ kehrt das um; die andere Summe steht jeweils darunter.
          </p>
        </Show>
        <Show when={assumptions() > 0}>
          <p class="finance-notice" role="status">
            {assumptions()} Posten tragen eine Annahme zur Monatsverteilung (Kennzeichen „Annahme“, Text im Tooltip) — Planwerte sind hier direkt korrigierbar.
          </p>
        </Show>
      </Show>

      {/* ── ONE MONTH, THE OLD READING ──────────────────────────────────────── */}
      <Show when={layout() === "month" && shownBlocks().length > 0}>
        <table class="paper-card finance-table">
          <caption>Plan versus actual by category</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">Plan</th><th scope="col">Actual</th><th scope="col">Deviation</th></tr></thead>
          <tbody>
            <For each={shownBlocks()}>{block => {
              // The same switch decides here: an optional block reads as its own
              // number, dimmed, and contributes nothing while it is switched off.
              const planned = () => (block.optional ? sum(block.plan, months()) : overMonths(key => blockPlan(block, key)));
              const actual = () => sum(block.actual, months());
              const hasActual = () => block.actual.size > 0;
              return <tr classList={{ "finance-excluded": !blockCounted(block) }}>
                <th scope="row">{block.category}</th>
                <td>{euro(planned())}</td>
                <td>{hasActual() ? euro(actual()) : "·"}</td>
                {/* The ONLY toned cell, and only where an actual exists. */}
                <td class="finance-deviation" classList={{ [`tone-${hasActual() ? deviationTone(planned(), actual()) : ""}`]: hasActual() && deviationTone(planned(), actual()) !== "" }}>
                  {hasActual() ? euro(actual() - planned()) : "·"}
                </td>
              </tr>;
            }}</For>
          </tbody>
        </table>
      </Show>

      <Show when={(entries()?.length ?? 0) > 0}>
        <table class="paper-card finance-table finance-bookings">
          <caption>Bookings</caption>
          <thead><tr>
            <th scope="col">
              <button type="button" class="finance-sort" onClick={() => setSortAscending(value => !value)} aria-label={`Sort by date, ${sortAscending() ? "newest" : "oldest"} first`}>
                Date {sortAscending() ? "↑" : "↓"}
              </button>
            </th>
            <th scope="col">Description</th><th scope="col">Category</th><th scope="col">Amount</th><th scope="col">Source</th>
          </tr></thead>
          <tbody>
            <For each={sortedEntries()}>{(entry: FinanceEntry) => <tr>
              <td><time dateTime={entry.entry_date}>{entry.entry_date}</time></td>
              <td>{entry.description}</td>
              <td>{entry.category}</td>
              <td class="finance-amount">{euro(entry.amount_cents)}</td>
              <td>{entry.source}</td>
            </tr>}</For>
          </tbody>
        </table>
      </Show>

      {/* Access is administered where it is felt. Small, last, and only for people
          who already passed the gate. */}
      <section class="finance-owners" aria-label="Finance access">
        <h2>Who may see Finance</h2>
        <ul>
          <For each={members() ?? []}>{member => <li>
            <span>{member.display_name}</span>
            <button type="button" class="finance-revoke" aria-label={`Remove finance access for ${member.display_name}`}
              onClick={() => void run(async () => { await financeApi.revoke(member.profile_id); await refetchMembers(); return `${member.display_name} removed`; })}>Remove</button>
          </li>}</For>
        </ul>
        <form onSubmit={event => {
          event.preventDefault();
          const id = grantId().trim();
          if (!id) return;
          void run(async () => { await financeApi.grant(id); setGrantId(""); await refetchMembers(); await refetchAccess(); return "Access granted"; });
        }}>
          <input aria-label="Profile id to grant" placeholder="Profile id" value={grantId()} onInput={event => setGrantId(event.currentTarget.value)} />
          <GhostPill onClick={() => {
            const id = grantId().trim();
            if (!id) return;
            void run(async () => { await financeApi.grant(id); setGrantId(""); await refetchMembers(); await refetchAccess(); return "Access granted"; });
          }}>Add person</GhostPill>
        </form>
      </section>
    </Show>
  </section>;
}

/** A plan row of the old, one-level shape reads as a category with no position. */
export type { FinancePlanRow };
