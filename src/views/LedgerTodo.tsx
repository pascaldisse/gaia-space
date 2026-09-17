import { createMemo, createSignal, For, Show } from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import ledger from "../../data/todo.json";
import "./LedgerTodo.css";

type LedgerItem = {
  id: string;
  category: string;
  date: string;
  status: string;
  repeats: number;
  ask: string;
  next: string;
  source: string;
};

type Ledger = {
  generatedAt: string;
  summary: Record<string, string>;
  items: LedgerItem[];
  mergeCandidates: unknown[];
};

const data = ledger as Ledger;
const priority = (status: string) => status === "REGRESSED" ? 0 : 1;
const needsPascal = (item: LedgerItem) => /needs Pascal/i.test(item.next);

export default function LedgerTodo() {
  const [category, setCategory] = createSignal("all");
  const [status, setStatus] = createSignal("all");
  const [pascalOnly, setPascalOnly] = createSignal(false);
  const categories = createMemo(() => [...new Set(data.items.map(item => item.category))].sort((a, b) => a.localeCompare(b)));
  const statuses = createMemo(() => [...new Set(data.items.map(item => item.status))].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)));
  const items = createMemo(() => data.items
    .filter(item => category() === "all" || item.category === category())
    .filter(item => status() === "all" || item.status === status())
    .filter(item => !pascalOnly() || needsPascal(item))
    .slice().sort((left, right) => priority(left.status) - priority(right.status)
      || right.repeats - left.repeats
      || left.date.localeCompare(right.date)
      || left.category.localeCompare(right.category)
      || left.ask.localeCompare(right.ask)));
  const count = (metric: string) => data.summary[metric] ?? "—";

  return <section class="personal-view ledger-todo-view">
    <PageHeader
      icon="check"
      title="Task Ledger"
      subline={<>Generated {new Date(data.generatedAt).toLocaleString()} · {data.items.length} active items</>}
      chips={<><Chip value={count("regressed")} label="Regressed" tone="red" /><Chip value={count("open")} label="Open" tone="amber" /><Chip value={count("claimed unverified")} label="Unverified" /></>}
    />
    <ContentHead icon="check" title="Work needing a clear next action" line={data.summary.sort} />
    <div class="ledger-summary" aria-label="Ledger summary">
      <span><strong>{count("source task rows")}</strong> source rows</span>
      <span><strong>{count("unique asks")}</strong> unique asks</span>
      <span><strong>{count("done omitted")}</strong> done omitted</span>
      <span><strong>{count("superseded")}</strong> superseded</span>
      <span><strong>{data.mergeCandidates.length}</strong> merge candidates</span>
    </div>
    <div class="ledger-filters" aria-label="Task Ledger filters">
      <label>Category<select value={category()} onInput={event => setCategory(event.currentTarget.value)}><option value="all">All categories</option><For each={categories()}>{item => <option value={item}>{item}</option>}</For></select></label>
      <label>Status<select value={status()} onInput={event => setStatus(event.currentTarget.value)}><option value="all">All statuses</option><For each={statuses()}>{item => <option value={item}>{item}</option>}</For></select></label>
      <label class="ledger-pascal"><input type="checkbox" checked={pascalOnly()} onChange={event => setPascalOnly(event.currentTarget.checked)} /> Needs Pascal</label>
      <span class="ledger-result-count" aria-live="polite">{items().length} shown</span>
    </div>
    <div class="ledger-list">
      <For each={items()}>{item => <article class="ledger-row" data-task-id={item.id}>
        <div class="ledger-row-head"><span class={`ledger-status status-${item.status.toLowerCase()}`}>{item.status}</span><span class="ledger-category">{item.category}</span><span>{item.date}</span><span>{item.repeats}×</span></div>
        <h2>{item.ask}</h2>
        <dl>
          <div><dt>Next</dt><dd>{item.next}</dd></div>
          <div><dt>Source</dt><dd>{item.source}</dd></div>
        </dl>
      </article>}</For>
      <Show when={!items().length}><p class="ledger-empty">No tasks match these filters.</p></Show>
    </div>
  </section>;
}
