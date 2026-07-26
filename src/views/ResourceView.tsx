import { createResource, For, Show } from "solid-js";

type Item = Record<string, unknown>;
export function ResourceView(props: { title: string; description: string; load: () => Promise<Item[]>; primary: (item: Item) => string }) {
  const [items] = createResource(props.load);
  return <section class="resource-view"><header><h1>{props.title}</h1><p>{props.description}</p></header><Show when={!items.loading} fallback={<p class="hint">Loading persisted data…</p>}><Show when={items()?.length} fallback={<p class="empty-state">No records yet.</p>}><ul class="resource-list"><For each={items()}>{item => <li><strong>{props.primary(item)}</strong><code>{item.id as string}</code><pre>{JSON.stringify(item, null, 2)}</pre></li>}</For></ul></Show></Show></section>;
}
