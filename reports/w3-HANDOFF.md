# HANDOFF — ☀w3 build lane (Vishnu, L2)

Written at ~20% context. Successor inherits the name and the three worktrees.

## State
| branch | worktree | head | verdict |
|---|---|---|---|
| `feat/w3-webhooks` | `../gaia-space-w3-webhooks` | `f60dbc1` | MERGEABLE — Kali audit round 3, gates green, independently re-run (cargo test 163/0, parity 356) |
| `feat/w3-routes` | `../gaia-space-w3-routes` | `c10dc83` | MERGEABLE — 18 dead desktop routes pruned, reverse grep over src/bridge/mobile/legacy finds no consumer |
| `feat/w3-verify` | `../gaia-space-w3-verify` | `e3fbd4a` + round-2 work | IN FLIGHT — ☀Brahma, sub-room `naru-opus-mt4ijnjq3icyck` |

All three branch from `master@b9a6f90`. Nothing merged to master: the merge decision was left to the parent.

## In-flight atom (Brahma, round 2)
1. RFC6749 §5.2 compliance on the token endpoint: `{"ok":false,"error":"unsupported grant_type"}` → `{"error":"unsupported_grant_type",…}`; `invalid_client` must be 401 + `WWW-Authenticate`; `Cache-Control: no-store`. Token endpoint only — the generic envelope stays, other UI depends on it.
2. `register_redirect_uri` has no HTTP surface → register the command so a server-only deployment can register clients.
3. Spare capacity: `cargo clippy --all-targets -D warnings` debt in `debug_server.rs` / `secretbox.rs` / `lib.rs` / `calls.rs`.

## Ledger
V39 taken by `feat/w3-webhooks` (`webhook_subscriptions.secret`, `.max_attempts`), reserved in PARITY.md @`e76025c`. **V40 is free** — reserve before taking.

## Open debt (not this lane's)
- `cargo clippy -D warnings`: 21–101 pre-existing lints in untouched files.
- Webview UI paint unverified (debug `/eval` times out); desktop binary launch itself is measured.
- Webhook corpses kept on purpose: no background ticker (server lifecycle decision), no domain-event fan-out (`filters_json` stored but never evaluated), no secret-rotation UX, receiver-side timestamp freshness / replay cache undocumented.

## Laws carried forward
PARITY.md + reports/parity/* = 356 rows frozen, status changes only, with evidence. One atom per commit. gate5 before merge. No /tmp. Grandchildren are exactly one naru-opus + one naru-kimi, role swaps each round.
