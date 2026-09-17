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

§ production · user approval 09:34 CEST
Revision → a31db956accf2826326ca688189ae68764fbee31
CI → https://github.com/pascaldisse/gaia-space/actions/runs/33952953372 · success
Deploy → 2026-09-05T07:44:41Z · index-CYWfDM0s.js · schema 142 unchanged · integrity ok before/after
AUTH-PARITY → app login retained; anonymous /space/api/auth/me → 401; public SPA shell unchanged
Live browser/PAT → /todo normalizes /to-do; My tasks + New task; /to-do also My tasks; screenshots → production/
Blocker → PAT browser receives database-is-locked errors; observed BEFORE deployment → production-before/results.json; live screenshot shows task-load error
Full production browser matrix → FAILED; data loading + remaining routes NOT certified; local matrix remains passing (§ gates)
No task data writes; no authentication changes; stale bridge-password login probe → 401, no session created
Native runtime → UNVERIFIED; hash adapter unit-tested
