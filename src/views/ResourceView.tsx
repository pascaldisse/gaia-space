import { createResource, createSignal, For, Show } from "solid-js";
import { linkProps, useDeepLink } from "../router";

type Item = Record<string, unknown>;
type Props = { title: string; description: string; load: () => Promise<Item[]>; primary: (item: Item) => string; entityType?: string };
export function ResourceView(props: Props) {
  const [items] = createResource(props.load);
  const [selectedId, setSelectedId] = createSignal<string>();
  if (props.entityType) useDeepLink(props.entityType, setSelectedId, () => setSelectedId());
  return <section class="resource-view"><header><h1>{props.title}</h1><p>{props.description}</p></header><Show when={!items.loading} fallback={<p class="hint">Loading persisted data…</p>}><Show when={items()?.length} fallback={<p class="empty-state">No records yet.</p>}><ul class="resource-list"><For each={items()}>{item => {
    const id = item.id as string;
    return <li classList={{ active: selectedId() === id }}><Show when={props.entityType} fallback={<><strong>{props.primary(item)}</strong><code>{id}</code></>}><a class="row-link" {...linkProps({ view: props.title, entityType: props.entityType!, entityId: id })}><strong>{props.primary(item)}</strong><code>{id}</code></a></Show><pre>{JSON.stringify(item, null, 2)}</pre></li>;
  }}</For></ul></Show></Show></section>;
}
