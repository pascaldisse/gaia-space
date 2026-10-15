import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import PageHeader from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { BUY_STATUSES, buyApi, formatPrice, parsePriceCents, type BuyItem, type BuyStatus, type BuyVendor } from "../api/buy";
import "./Buy.css";

/** ── BUY ────────────────────────────────────────────────────────────────────
 *  Agent-first ordering (docs/space-buy/DESIGN.md): an agent PROPOSES (status wanted), a human
 *  approves in one click, whoever orders records the order ref. Space moves no money. Layout
 *  mirrors Passwords.tsx: header → toolbar (search + chips) → list | detail → add drawer.
 *  Vendors flagged `agent_allowed=false` (Amazon) are marked: a human places those orders.
 */
type Filter = "all" | BuyStatus;
const CHIPS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, ...BUY_STATUSES.map(s => ({ id: s as Filter, label: s[0].toUpperCase() + s.slice(1) }))];
type Draft = { title: string; url: string; vendor: string; price: string; qty: string; notes: string };
const emptyDraft = (): Draft => ({ title: "", url: "", vendor: "", price: "", qty: "1", notes: "" });

export default function Buy() {
  const [items, setItems] = createSignal<BuyItem[]>([]);
  const [vendors, setVendors] = createSignal<BuyVendor[]>([]);
  const [filter, setFilter] = createSignal<Filter>("all");
  const [search, setSearch] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [drawer, setDrawer] = createSignal<Draft | null>(null);
  const [orderRef, setOrderRef] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function load() {
    try {
      const [i, v] = await Promise.all([buyApi.list(), buyApi.vendors()]);
      setItems(i);
      setVendors(v);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  onMount(load);

  const vendorOf = (name: string) => vendors().find(v => v.name.toLowerCase() === name.toLowerCase());
  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    return items().filter(i => (filter() === "all" || i.status === filter()) && (!q || `${i.title} ${i.vendor} ${i.notes}`.toLowerCase().includes(q)));
  });
  const selected = createMemo(() => items().find(i => i.id === selectedId()) ?? null);
  const count = (f: Filter) => (f === "all" ? items().length : items().filter(i => i.status === f).length);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function saveDrawer(event: Event) {
    event.preventDefault();
    const d = drawer();
    if (!d) return;
    await act(async () => {
      const saved = await buyApi.save({ title: d.title, url: d.url, vendor: d.vendor, price_cents: parsePriceCents(d.price), qty: Math.max(1, Number(d.qty) || 1), notes: d.notes });
      setSelectedId(saved.id);
      setDrawer(null);
    });
  }

  return (
    <section class="buy-view">
      <PageHeader
        icon="package"
        title="Buy"
        subline="Agents propose, you approve, the order ref lands here. No money moves in Space."
        actions={<button type="button" class="ghost-pill" onClick={() => setDrawer(emptyDraft())}>+ Item</button>}
      />
      <Show when={error()}><p class="buy-error" role="alert">{error()}</p></Show>
      <div class="buy-toolbar">
        <div class="buy-search">
          <Icon name="search" size={16} />
          <input aria-label="Search buy items" placeholder="Search" value={search()} onInput={e => setSearch(e.currentTarget.value)} />
        </div>
        <div class="buy-chips" role="tablist" aria-label="Filter by status">
          <For each={CHIPS}>{chip => (
            <button type="button" role="tab" aria-pressed={filter() === chip.id} classList={{ active: filter() === chip.id }} onClick={() => setFilter(chip.id)}>{chip.label} <em>{count(chip.id)}</em></button>
          )}</For>
        </div>
      </div>
      <div class="buy-body">
        <ul class="buy-list" aria-label="Buy items">
          <Show when={filtered().length === 0}><li class="buy-empty">Nothing here.</li></Show>
          <For each={filtered()}>{item => (
            <li>
              <button type="button" class="buy-row" classList={{ active: selectedId() === item.id }} onClick={() => setSelectedId(item.id)}>
                <span class="buy-row-text">
                  <span class="buy-row-title">{item.title}</span>
                  <span class="buy-row-meta">{[item.vendor, formatPrice(item.price_cents, item.currency)].filter(Boolean).join(" · ")}</span>
                </span>
                <span class={`buy-status buy-status-${item.status}`}>{item.status}</span>
              </button>
            </li>
          )}</For>
        </ul>
        <Show when={selected()}>
          {(item) => (
            <div class="buy-detail" aria-label={`Details for ${item().title}`}>
              <header>
                <h2>{item().title}</h2>
                <span class={`buy-status buy-status-${item().status}`}>{item().status}</span>
              </header>
              <div class="buy-field"><span>Qty</span><span>{item().qty}</span></div>
              <Show when={item().price_cents != null}><div class="buy-field"><span>Price</span><span>{formatPrice(item().price_cents, item().currency)}</span></div></Show>
              <Show when={item().vendor}>
                <div class="buy-field">
                  <span>Vendor</span>
                  <span>{item().vendor}<Show when={vendorOf(item().vendor) && !vendorOf(item().vendor)!.agent_allowed}> <em class="buy-blocked" title={vendorOf(item().vendor)!.notes}>agent blocked — human orders</em></Show></span>
                </div>
              </Show>
              <Show when={item().approver}><div class="buy-field"><span>Approved by</span><span>{item().approver}</span></div></Show>
              <Show when={item().order_ref}><div class="buy-field"><span>Order ref</span><span>{item().order_ref}{item().ordered_by ? ` (by ${item().ordered_by})` : ""}</span></div></Show>
              <Show when={item().notes}><div class="buy-field buy-field-notes"><span>Notes</span><p>{item().notes}</p></div></Show>
              <div class="buy-actions">
                <Show when={item().url}><a class="buy-open" href={item().url} target="_blank" rel="noreferrer">Open vendor ↗</a></Show>
                <Show when={item().status === "wanted"}><button type="button" class="primary" disabled={busy()} onClick={() => act(() => buyApi.approve(item().id))}>Approve</button></Show>
                <Show when={item().status === "approved"}>
                  <input aria-label="Order ref" placeholder="Order ref" value={orderRef()} onInput={e => setOrderRef(e.currentTarget.value)} />
                  <button type="button" disabled={busy() || !orderRef().trim()} onClick={() => act(async () => { await buyApi.markOrdered(item().id, orderRef()); setOrderRef(""); })}>Mark ordered</button>
                </Show>
                <Show when={item().status === "ordered"}><button type="button" disabled={busy()} onClick={() => act(() => buyApi.setStatus(item().id, "delivered"))}>Delivered</button></Show>
                <Show when={["wanted", "approved", "ordered"].includes(item().status)}><button type="button" disabled={busy()} onClick={() => act(() => buyApi.setStatus(item().id, "cancelled"))}>Cancel</button></Show>
                <button type="button" disabled={busy()} onClick={() => act(async () => { await buyApi.remove(item().id); setSelectedId(null); })}>Delete</button>
              </div>
            </div>
          )}
        </Show>
      </div>
      <Show when={drawer()}>
        {(draft) => (
          <div class="buy-drawer" role="dialog" aria-label="Add item">
            <form onSubmit={saveDrawer}>
              <h2>Add item</h2>
              <label>Title<input aria-label="Title" value={draft().title} onInput={e => setDrawer({ ...draft(), title: e.currentTarget.value })} required /></label>
              <label>URL<input aria-label="URL" value={draft().url} onInput={e => setDrawer({ ...draft(), url: e.currentTarget.value })} /></label>
              <label>Vendor<input aria-label="Vendor" list="buy-vendors" value={draft().vendor} onInput={e => setDrawer({ ...draft(), vendor: e.currentTarget.value })} /></label>
              <datalist id="buy-vendors"><For each={vendors()}>{v => <option value={v.name} />}</For></datalist>
              <label>Price (EUR)<input aria-label="Price" inputmode="decimal" value={draft().price} onInput={e => setDrawer({ ...draft(), price: e.currentTarget.value })} /></label>
              <label>Qty<input aria-label="Qty" type="number" min={1} value={draft().qty} onInput={e => setDrawer({ ...draft(), qty: e.currentTarget.value })} /></label>
              <label>Notes<textarea aria-label="Notes" value={draft().notes} onInput={e => setDrawer({ ...draft(), notes: e.currentTarget.value })} /></label>
              <div class="buy-drawer-actions">
                <button type="submit" class="primary" disabled={busy()}>Save</button>
                <button type="button" disabled={busy()} onClick={() => setDrawer(null)}>Cancel</button>
              </div>
            </form>
          </div>
        )}
      </Show>
    </section>
  );
}
