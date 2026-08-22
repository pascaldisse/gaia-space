import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { linkProps, useDeepLink } from "../router";

type Item = Record<string, unknown>;
type Props = {
  title: string;
  description: string;
  load: () => Promise<Item[]>;
  primary: (item: Item) => string;
  entityType?: string;
  /** View name used to build an entity URL. Defaults to title for legacy callers. */
  view?: string;
  /** Small, human-readable context below the record name. */
  summary?: (item: Item) => string | undefined;
};
const label = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const display = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(display).join(", ") || "—";
  if (typeof value === "object") return "Related record";
  return String(value);
};
const fieldsOf = (item: Item) => Object.entries(item).filter(([key, value]) => key !== "id" && !key.endsWith("_id") && typeof value !== "object").slice(0, 8);

/**
 * Shared collection/detail surface for routable records.  The router maps an
 * entity type to its owning view; this component keeps that deep link active
 * while exposing readable record fields instead of a developer JSON dump.
 */
export function ResourceView(props: Props) {
  const [items] = createResource(props.load);
  const [selectedId, setSelectedId] = createSignal<string>();
  const [query, setQuery] = createSignal("");
  if (props.entityType) useDeepLink(props.entityType, setSelectedId, () => setSelectedId());
  const selected = createMemo(() => items()?.find(item => item.id === selectedId()));
  const listed = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return items() ?? [];
    return (items() ?? []).filter(item => `${props.primary(item)} ${props.summary?.(item) ?? ""}`.toLowerCase().includes(needle));
  });
  const select = (id: string) => setSelectedId(id);
  const recordLink = (item: Item) => ({ view: props.view ?? props.title, entityType: props.entityType!, entityId: String(item.id) });
  return <section class="resource-view resource-workspace">
    <header><div><h1>{props.title}</h1><p>{props.description}</p></div><Show when={items()}><span class="resource-count">{items()!.length} records</span></Show></header>
    <Show when={items.error}><p class="error" role="alert">{props.title} could not be loaded: {String(items.error)}</p></Show>
    <Show when={items.loading} fallback={<Show when={items()}>
      <div class="resource-toolbar"><input aria-label={`Search ${props.title}`} placeholder={`Search ${props.title.toLowerCase()}`} value={query()} onInput={event => setQuery(event.currentTarget.value)} /></div>
      <div class="resource-layout"><ul class="resource-list" aria-label={`${props.title} records`}>
        <For each={listed()}>{item => {
          const id = String(item.id);
          const contents = <><strong>{props.primary(item)}</strong><Show when={props.summary?.(item)}>{summary => <span class="resource-summary">{summary()}</span>}</Show><code>{id}</code></>;
          return <li classList={{ active: selectedId() === id }}>
            <Show when={props.entityType} fallback={<button type="button" class="resource-row" onClick={() => select(id)}>{contents}</button>}>
              <a class="resource-row row-link" {...linkProps(recordLink(item))} onClick={event => { linkProps(recordLink(item)).onClick(event); select(id); }}>{contents}</a>
            </Show>
          </li>;
        }}</For>
        <Show when={!listed().length}><li class="empty-state">No records match this search.</li></Show>
      </ul>
      <aside class="resource-detail" aria-live="polite"><Show when={selected()} fallback={<p class="hint pad">Select a record to inspect its details.</p>}>{item => <><header><h2>{props.primary(item())}</h2><code>{String(item().id)}</code></header><dl><For each={fieldsOf(item())}>{([key, value]) => <><dt>{label(key)}</dt><dd>{display(value)}</dd></>}</For></dl></>}</Show></aside>
      </div>
    </Show>}><p class="hint">Loading persisted data…</p></Show>
  </section>;
}
