# Space-Buy — agent-first ordering

## Thesis
- agent = first-class buyer; human = approver. Agent proposes → human 1-click approve → agent orders → human sees order ref.
- why: 2026-10-15 Amazon blocks grok/agent bots from ordering; Musk "start a competitor"; Pascal: "space-buy, about time".
- Space = system of record for wants. Vendors that hate bots are flagged, never scraped/evaded.
- no money moves inside Space v1. Space holds intent + approval + receipt ref only.

## Data model (SQLite, schema V149, additive)
`buy_items`
- id TEXT PK (`buy-<nanos>-<n>`) · project_id TEXT? (FK projects, SET NULL) · title · url · vendor (→ buy_vendors.name, soft)
- price_cents INTEGER? · currency TEXT default EUR · qty INTEGER ≥1 default 1 (money = cents, as budget.rs)
- status ∈ wanted|approved|ordered|delivered|cancelled (CHECK) · notes
- approver TEXT? (profile id, session-bound) · ordered_by TEXT? (profile id, session-bound) · order_ref TEXT?
- created_by · created_at · updated_at (unix secs)
`buy_vendors`
- name TEXT PK · kind ∈ api|browser|manual · agent_allowed INTEGER bool · notes
- seed row: `Amazon` kind=manual agent_allowed=0 notes="blocks agent checkout"

## Status machine
- wanted →approve→ approved →mark_ordered(order_ref)→ ordered →delivered
- wanted|approved|ordered →cancel→ cancelled
- `approver` stamped by server from session on approve (client value ignored: `actor` bound by bind_session_identity)
- `ordered_by` same, on mark_ordered. mark_ordered from `wanted` = rejected (approval required)
- agent_allowed=0 vendor → agent may propose + deep-link only; a HUMAN session marks ordered. Enforced in UI v1, server check v2.

## Flows
1. propose: agent (PAT) `save_buy_item` status=wanted (server forces `wanted` on create)
2. approve: human clicks Approve → `approve_buy_item` → approver+status
3. execute: agent reads approved items; per vendor.kind:
   - manual → hands human the deep link (url); human buys
   - browser → "open in browser" link (human or agent-driven browser session); no scraping
   - api → v2 (adapter slot, not built)
4. receipt: whoever ordered calls `mark_buy_item_ordered(id, order_ref)`; UI shows ref; later `delivered`

## Wire (mirrors existing /api/cmd bridge, not a new REST tree)
- `POST /api/cmd/<name>` + `Authorization: Bearer spat_…` PAT or session cookie — src-tauri/src/bin/space-server.rs `command_policy` + `dispatch!`
- list_buy_items(status?) · save_buy_item(item) · approve_buy_item(id, actor) · mark_buy_item_ordered(id, order_ref, actor) · set_buy_item_status(id, status) · delete_buy_item(id)
- list_buy_vendors() · save_buy_vendor(vendor) · delete_buy_vendor(name)
- policy `Session` (any authed member/PAT); module src-tauri/src/buy.rs; client src/api/buy.ts

## v1 scope / non-goals
- adapters: manual deep link + open-in-browser only
- no scraping, no captcha/bot evasion, no stored card data, no auto-purchase, no live orders
- seed: tools/space-sync.ts `--buy shopping-list.md` → dry-run prints requests (apply needs SPACE_PAT)
- v2: api adapters (vendors with real APIs), server-side agent_allowed gate, PAT-vs-cookie approve split, price watch (e.g. Saros Z70 ≤€760 rule)
