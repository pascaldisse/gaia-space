import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import PageHeader from "../components/PageHeader";
import { entityView, linkProps, useDeepLink } from "../router";
import "./ResourceView.css";

type Item = Record<string, unknown>;
type Props = {
  title: string;
  description: string;
  load: () => Promise<Item[]>;
  primary: (item: Item) => string;
  /** Brief secondary text for each row; record details stay out of the list. */
  summary?: (item: Item) => string | undefined;
  /** Domain UI for an opened record. The fallback is a readable field list. */
  details?: (item: Item) => JSX.Element;
  empty?: string;
  entityType?: string;
  /** Overrides the router's default view for an entity type. */
  view?: string;
};

const label = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
export const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayValue).join(", ") || "—";
  if (typeof value === "object") return "Available";
  return String(value);
};

function DefaultDetails(props: { item: Item }) {
  return <dl class="resource-fields"><For each={Object.entries(props.item).filter(([key]) => key !== "id")}>{([key, value]) => <><dt>{label(key)}</dt><dd>{displayValue(value)}</dd></>}</For></dl>;
}

/**
 * Reusable persisted-resource browser. It is intentionally not a router destination:
 * concrete domain views supply their own routes and pass their entity type here so
 * opened records retain a copyable deep link.
 */
export function ResourceView(props: Props) {
  const [items, { refetch }] = createResource(props.load);
  const [selectedId, setSelectedId] = createSignal<string>();
  if (props.entityType) useDeepLink(props.entityType, setSelectedId, () => setSelectedId());
  const selected = createMemo(() => items()?.find(item => item.id === selectedId()));
  const entityRouteView = () => props.view ?? (props.entityType ? entityView(props.entityType) : undefined);
  const select = (item: Item) => setSelectedId(String(item.id));
  const detail = (item: Item) => props.details ? props.details(item) : <DefaultDetails item={item} />;

  return <section class="resource-view resource-browser">
    <PageHeader title={props.title} subline={props.description} actions={<button type="button" class="ghost" disabled={items.loading} onClick={() => void refetch()}>Refresh</button>} />
    <Show when={items.error}><p class="error" role="alert">Could not load {props.title.toLowerCase()}: {String(items.error)}</p></Show>
    <Show when={items.loading}><p class="hint" role="status">Loading persisted data…</p></Show>
    <Show when={!items.loading && !(items()?.length)}><p class="empty-state">{props.empty ?? "No records yet."}</p></Show>
    <Show when={items()?.length}><div class="resource-browser-grid"><ul class="resource-list" aria-label={props.title}><For each={items()}>{item => {
      const id = String(item.id);
      const isActive = () => selectedId() === id;
      const content = <><span class="resource-row-copy"><strong>{props.primary(item)}</strong><Show when={props.summary?.(item)}>{text => <small>{text()}</small>}</Show></span><code>{id}</code></>;
      const view = entityRouteView();
      return <li classList={{ active: isActive() }}><Show when={props.entityType && view} fallback={<button type="button" class="resource-row-button" aria-pressed={isActive()} onClick={() => select(item)}>{content}</button>}><a class="row-link resource-row-link" {...linkProps({ view: view!, entityType: props.entityType!, entityId: id })} onClick={event => { linkProps({ view: view!, entityType: props.entityType!, entityId: id }).onClick(event); select(item); }}>{content}</a></Show></li>;
    }}</For></ul><aside class="resource-detail" aria-live="polite"><Show when={selected()} fallback={<p class="hint">Select a record to inspect its details.</p>}>{item => <>{detail(item())}</>}</Show></aside></div></Show>
  </section>;
}
