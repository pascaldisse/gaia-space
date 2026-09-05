§ 2026-09-05 · restore task URLs
Base → origin/master 2a0fc5a
Cause → 5eb6944: ledger registered /todo; original Todo retained /to-do
Fix → /todo alias → /to-do; ledger → /task-ledger; Todo component/CSS/data unchanged

§ gates
bun run check → exit 0
bun test → 786 pass · 0 fail · 114 files
bun run build --mode web → exit 0
Browser → built dist-web + real space-server + isolated incident DB copy; no API mocks
app-tools → own headless instance; app-eval confirms /todo → /to-do · My tasks · 2 rows
Playwright → § browser-proof.ts; 1440px + 390px; personal 2 · team 5 · ledger 329; no horizontal overflow; composer open/cancel; reload → My tasks; pageerrors 0
Evidence → browser-results.json · todo-1440.png · todo-390.png · new-task.png
Reproduce → SPACE_PROOF_URL=<preview>/space SPACE_PROOF_SESSION=<local-copy-session> bun reports/restore-tasks/browser-proof.ts

§ boundary
Production unchanged · no push/deploy/restart
Native runtime → UNVERIFIED; hash adapter unit-tested
