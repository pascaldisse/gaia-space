# HANDOFF — ☀w3 build lane (Vishnu, L2)

Written at ~20% context. Successor inherits the name and the three worktrees.

## State
| branch | worktree | head | verdict |
|---|---|---|---|
| `feat/w3-webhooks` | `../gaia-space-w3-webhooks` | `f60dbc1` | MERGEABLE — Kali audit round 3, gates green, independently re-run (cargo test 163/0, parity 356) |
| `feat/w3-routes` | `../gaia-space-w3-routes` | `c10dc83` | MERGEABLE — 18 dead desktop routes pruned, reverse grep over src/bridge/mobile/legacy finds no consumer |
| `feat/w3-verify` | `../gaia-space-w3-verify` | `5693806` | MERGEABLE — RFC6749 §5.2 token errors + `register_redirect_uri` HTTP surface; front-end gates closed by the lane lead (tsc 0, bun test 115/0, vite build ✓, parity 356) |

All three branch from `master@b9a6f90`. Nothing merged to master: the merge decision was left to the parent.

## Done in round 2 (Brahma) — nothing in flight
1. RFC6749 §5.2 landed: typed `TokenError`, six codes, `invalid_client` → 401 + `WWW-Authenticate`, `Cache-Control: no-store` on success and failure, branch confined to `/oauth/token`.
2. `register_redirect_uri` / `list_redirect_uris` commands registered, policy `AppAdmin`.

## Next atom for the successor
`cargo clippy --all-targets -D warnings` debt (22 errors in lib tests; `debug_server.rs` / `secretbox.rs` / `lib.rs` / `calls.rs`) — untouched, and it is the only gate still red anywhere in w3.

## Ledger
V39 taken by `feat/w3-webhooks` (`webhook_subscriptions.secret`, `.max_attempts`), reserved in PARITY.md @`e76025c`. **V40 is free** — reserve before taking.

## Open debt (not this lane's)
- `cargo clippy -D warnings`: 21–101 pre-existing lints in untouched files.
- Webview UI paint unverified (debug `/eval` times out); desktop binary launch itself is measured.
- Webhook corpses kept on purpose: no background ticker (server lifecycle decision), no domain-event fan-out (`filters_json` stored but never evaluated), no secret-rotation UX, receiver-side timestamp freshness / replay cache undocumented.

## Laws carried forward
PARITY.md + reports/parity/* = 356 rows frozen, status changes only, with evidence. One atom per commit. gate5 before merge. No /tmp. Grandchildren are exactly one naru-opus + one naru-kimi, role swaps each round.
