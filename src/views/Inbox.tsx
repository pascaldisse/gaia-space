import { createResource, For, Show } from "solid-js";
import { personalApi } from "../api/personal";
import { ProfilePicker } from "../components/Pickers";
import { profileId } from "../session";
import "./Inbox.css";

// Inbox = the human notification feed (mentions, assignments, review requests…)
// pulled from the same store the Dashboard summarises — surfaced here as a
// first-class destination so people, not tooling, sit at the centre of the app.
const when = (ts: number) => new Date(ts * 1000).toLocaleString();

export default function Inbox() {
  const [items, { refetch }] = createResource(profileId, (id) =>
    id ? personalApi.notifications(id, false) : Promise.resolve([]));
  const unread = () => items()?.filter((n) => !n.read_at) ?? [];
  const read = () => items()?.filter((n) => n.read_at) ?? [];
  const markRead = async (id: string) => { await personalApi.markRead(id); refetch(); };
  const markAll = async () => { await Promise.all(unread().map((n) => personalApi.markRead(n.id))); refetch(); };

  return <section class="inbox-view">
    <header class="inbox-head">
      <div><h1>Inbox</h1><p>Everything addressed to you — mentions, assignments, and updates across your projects.</p></div>
      <div class="inbox-head-actions"><ProfilePicker/><Show when={unread().length}><button class="primary" onClick={markAll}>Mark all read</button></Show></div>
    </header>
    <Show when={!profileId()}><p class="inbox-empty">No profile selected — choose one above or add one in People.</p></Show>
    <Show when={items.loading}><p class="inbox-muted">Loading your inbox…</p></Show>
    <Show when={profileId() && !items.loading}>
      <div class="inbox-groups">
        <section>
          <h2>Unread <span>{unread().length}</span></h2>
          <Show when={unread().length} fallback={<p class="inbox-muted">You're all caught up.</p>}>
            <ul class="inbox-list">
              <For each={unread()}>{n =>
                <li class="unread">
                  <div class="inbox-dot"/>
                  <div class="inbox-body"><strong>{n.title}</strong><Show when={n.body}><p>{n.body}</p></Show>
                    <small>{n.event_type} · {when(n.created_at)}</small></div>
                  <button class="ghost" title="Mark read" onClick={() => markRead(n.id)}>Mark read</button>
                </li>}</For>
            </ul>
          </Show>
        </section>
        <Show when={read().length}>
          <section>
            <h2>Earlier</h2>
            <ul class="inbox-list">
              <For each={read()}>{n =>
                <li>
                  <div class="inbox-body"><strong>{n.title}</strong><Show when={n.body}><p>{n.body}</p></Show>
                    <small>{n.event_type} · {when(n.created_at)}</small></div>
                </li>}</For>
            </ul>
          </section>
        </Show>
      </div>
    </Show>
  </section>;
}
