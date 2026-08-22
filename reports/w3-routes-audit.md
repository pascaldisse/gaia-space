# W3 route-prune reverse audit — Kali / round 3
## Verdict
**MERGEABLE.** Reverse references across `src/`, `bridge/`, mobile shell, desktop Rust, legacy text, and manifests show no consumer of the 18 deleted desktop routes. Remaining router references resolve only active `src/router.ts` views/entities; bridge uses HTTP ingress and no desktop route API.
## Gates
- `rg -n -i "route|legacy|bridge|mobile" src bridge` → PASS; no deleted-route consumer.
- `bun run build` → PASS; existing >500 kB chunk warning only.
- `cargo check --features desktop` (`src-tauri/`) → PASS; existing unused-import/deprecated warnings only.
## Scope
No production restoration required. PARITY untouched.
