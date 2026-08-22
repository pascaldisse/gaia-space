# PARITY.md — gaia-space feature parity matrix (☾shadow-crown gate)

Sources: docs/space-knowledge-base/01→08 (KB) + legacy/flutter/ (legacy). Status ∈ {missing, stub, partial, done}. Evidence = path(s) in src/ + src-tauri/. UI styling exempt by decree — function only.

Baseline gates 2026-08-22 (independent run): tsc=0 · cargo check=0 · bun test 99 pass/0 fail · vite build ✓.

LEDGER (衝突禁 · same-domain double-start forbidden): ☀build-crown → WIP:☀ 07 (feat/tree-devenv-api merged aeaa227) · WIP:☀ 01 (feat/tree-review) · WIP:☀ 02 (feat/tree-fields) · WIP:☀ 04 (feat/tree-chatdocs) · WIP:☀ 06 (feat/tree-blogsearch) · WIP:☀ 08 (feat/tree-callsx) · ☾shadow builders → WIP:☾ 03 packages (worktree ../gaia-space-pkg, branch feat/parity-03-packages) + WIP:☾ 05 auth (feat/parity-05-auth; rebasing onto master — applications domain ceded to ☀ 07, auth tables→SCHEMA_V16).

TOTALS (8/8 audited, 358 rows): done 33 · partial 130 · stub 25 · missing 170. Matrix NOT green — steering loop active.

NOTE: KB files' own §Gap-Analysis sections = STALE (written vs old lib/ Flutter era). Every row below re-verified against current src/ + src-tauri/ by audit lane. Rows marked UNVERIFIED until lane evidence lands.

## 01 Git & Code Review (audited ✓ — rows: reports/parity/01-git-code-review.md @ 88a03d7)
52 rows — done 2 · partial 20 · stub 1 · missing 29.
Worst gaps: Safe Merge (preview only, no CI/final merge) · protected-branch permissions · CODEOWNERS · stacked reviews · quality gates CI/external checks.

## 02 Planning / Issues / Boards (audited ✓ — rows: reports/parity/02-issues-boards.md @ 52f0880)
33 rows — done 6 · partial 16 · stub 1 · missing 10.
Worst gaps: custom-field types incomplete · swimlanes backend-only · board card config · matrix reports · external tracker integration.

## 03 Packages & CI/CD & Deployments (audited ✓ — rows: reports/parity/03-packages-cicd.md @ 2fcf30d)
49 rows — done 2 · partial 14 · stub 1 · missing 32.
Worst gaps: per-format registry protocols · retention/immutability/CVE/ACLs · workers/artifacts/test-reporting · non-manual triggers+DSL · deployment integrations/webhooks.

## 04 Chat / Documents / Meetings / Calendar (audited ✓ — rows: reports/parity/04-collab.md @ 039cca2)
61 rows — done 8 · partial 30 · missing 21.
Worst gaps: chat attachments/mentions/scheduled/pins/polls · doc sharing+KB permissions/search · doc import/publish/rich-types · meeting rooms/equipment/external attendees · CalDAV+multi-calendar+Day/Schedule views.

## 05 Platform / Auth / Permissions (audited ✓ — rows: reports/parity/05-auth-permissions.md @ 67f0243)
32 rows — done 3 · partial 12 · missing 17.
Worst gaps: Right taxonomy+enforcement · org settings/multi-workspace · SSO/OAuth/2FA/permanent tokens · OAuth app consent · invitations with role preassignment.

## 06 Personal / Org (audited ✓ — rows: reports/parity/06-personal-org.md @ d495902)
54 rows — done 2 · partial 20 · stub 3 · missing 29.
Worst gaps: blogs absent · locations/org-directory stub · full-text search absent (Goto=substring) · dashboard personalization · subscription/feeds system.

## 07 Dev Env / Apps / HTTP API (audited ✓ — rows: reports/parity/07-devenv-api.md @ 539fb5f)
42 rows — done 0 · partial 6 · stub 19 · missing 17.
Worst gaps: devfile/deep-links unwired · apps/webhooks/chatbots/extensions backend unreachable from UI · no app OAuth/HTTP-API/marketplace · no webhook delivery/retry · no slash-command/app-rights integration.

## 08 Video Calls / Meet (audited ✓ — rows: reports/parity/08-video-calls.md)
35 rows — done 10 · partial 15 · missing 10.
Worst gaps: deployed Egress/storage/webhook proof · multi-client lobby admission proof · persistent video_provider · call lifecycle model.
Note: lane reported 1 dashboard test fail; independent re-run (crown) = 99 pass/0 fail — not reproduced.

## Legacy-Flutter features (cross-cutting; owned by lane 01 unless noted)
| feature | legacy path | status | evidence |
|---|---|---|---|
| repo create/clone/detail | ui/screens/home/*repository*.dart | UNVERIFIED | |
| fork + fork relationship | fork_service.dart | UNVERIFIED | |
| branch protection | branch_protection_service.dart | UNVERIFIED | |
| pull requests | pull_request_service.dart | UNVERIFIED | |
| commit graph / diff viewer / image diff | ui/widgets/git/* | UNVERIFIED | |
| custom commands | custom_command_service.dart | UNVERIFIED | |
| discord integration | discord_service.dart | UNVERIFIED | |
| virtual directory browser | virtual_directory_browser.dart | UNVERIFIED | |
| repo benchmark | repository_benchmark_service.dart | UNVERIFIED | |
| auth login/register | ui/screens/auth/* | UNVERIFIED | |
| documents | document_screen.dart | UNVERIFIED | (lane 04) |
| pipelines | pipeline_screen.dart | UNVERIFIED | (lane 03) |
| tasks/projects/workspace | task_screen, project_screen, workspace_screen | UNVERIFIED | (lane 02) |
