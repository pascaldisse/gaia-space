# proof/git-graph

Headless commit-graph proof: built harness (`vite preview`) + playwright chromium, backend = real git.rs via `git_cli`.

## Run (order matters)
1. `cd src-tauri && cargo build --example git_cli` (or set `GIT_CLI`)
2. `bunx vite build --config vite.proof.config.ts` -> `dist-proof/` (PREREQ: preview serves this; missing/stale = blank/stale page)
3. `GIT_PROOF_PORT=5441 bun proof/git-graph/shoot.mjs` (bun only; port must be free)

Output: `reports/git-ui/graph*.png` + one stats line `{repo, stats:{rows,chips,headMarkers,paths,brokenEdges}, calls}`.

`brokenEdges` = `gitGraph.ts brokenEdges()` over the real `repo_log_graph` feed: for every parent link, its lane must be a passthrough on every row until the parent row, which must sit on that lane. Must be `0`; nonzero -> exit 1.
