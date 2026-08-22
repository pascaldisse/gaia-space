# PARITY.md — gaia-space feature parity matrix (☾shadow-crown gate)

Sources: docs/space-knowledge-base/01→08 (KB) + legacy/flutter/ (legacy). Status ∈ {missing, stub, partial, done}. Evidence = path(s) in src/ + src-tauri/. UI styling exempt by decree — function only.

Baseline gates 2026-08-22 (independent run): tsc=0 · cargo check=0 · bun test 99 pass/0 fail · vite build ✓.

LEDGER (衝突禁 · same-domain double-start forbidden): WIP:☀ 06 feeds + 07 OAuth/marketplace (worktree ../gaia-space-w2-feeds-oauth, branch feat/w2-feeds-oauth; SCHEMA_V29 feeds, SCHEMA_V31 app OAuth — odd versions reserved by this lane) · ☀build-crown → WIP:☀ 07 (feat/tree-devenv-api merged aeaa227) · WIP:☀ 01 (feat/tree-review) · WIP:☀ 02 (feat/tree-fields) · WIP:☀ 04 (feat/tree-chatdocs) · WIP:☀ 06 (feat/tree-blogsearch) · WIP:☀ 08 (feat/tree-callsx) · ☾shadow builders → WIP:☾ 03 packages (worktree ../gaia-space-pkg, branch feat/parity-03-packages) + WIP:☾ 05 auth (feat/parity-05-auth; rebasing onto master — applications domain ceded to ☀ 07, auth tables→SCHEMA_V27 (reserved; 03 landed as V26 @9f9c367)).

MIGRATION RESERVATIONS (take a number only after adding a row here):
- V29, V31 → feat/w2-feeds-oauth (scoped feeds; app OAuth/marketplace) — merges first
- V32, V33 → feat/w2-pkg (typed registry metadata; immutability + CVE ledger)
- V34 → feat/w2-docs (document publish + KB book grants)
- V35 → reserved ☾
- V36 → feat/w2-auth (B3: OAuth2 authorization-code, TOTP, permanent tokens) ☀
- V37 → feat/w2-rights (B4: full Right taxonomy enforcement) ☀
- V38 → feat/w2-recording-v38 (recording/egress lifecycle, single final DDL) ☀ — merged in master@b9a6f90
- V39 → feat/w3-webhooks (webhook_subscriptions.secret + max_attempts; signed delivery + bounded retry) ☀
- V40 → feat/w3-docs (document rich types: rich text, checklist, code) ☀ — merged
- V41 → feat/w4-secrot (webhook secret rotation / key-ring) ☀ — merged
- V43 → feat/w5-rich-editor (document file uploads) ☀ — merged
- V45 → feat/w5-ide-discovery (IDE sessions/opened repositories) ☀ — merged
- V46 → feat/w5-prefs (server-persisted dashboard widget preferences) ☀ — merged
- V49/V51 → feat/w5-caldav (named calendars · feed attribution) ☀ — merged
- V52 → feat/w6-payload (per-app Ed25519 signing keys for typed application payload dispatch) ☀

TOTALS (8/8 audited, 356 rows): done 44 · partial 171 · stub 4 · missing 137. Matrix NOT green — steering loop active.

RECOUNT METHOD (2026-08-22): `python3 scripts/parity_totals.py --check` parses only Markdown data rows whose third data cell is Status ∈ {done, partial, stub, missing}; it also reconciles ordered 01→08 section headings, canonical report paths, and each immediate section summary. Headings, prose, and `04-collaboration.md` evidence notes do not count. Current committed ledger contains 356, not the claimed 371; 371 has no row source in this tree.

NOTE: KB files' own §Gap-Analysis sections = STALE (written vs old lib/ Flutter era). Every row below re-verified against current src/ + src-tauri/ by audit lane. Rows marked UNVERIFIED until lane evidence lands.

## 01 Git & Code Review (audited ✓ — rows: reports/parity/01-git-code-review.md; Varuna-III stage 3)
52 rows — done 2 · partial 22 · stub 1 · missing 27.
Progress: source-branch root/`.space` CODEOWNERS parsing, last-match-wins glob matching, local user/email/role resolution, and required per-path approvals landed (V21); ordered MR stacks create/list and retarget open children after parent merge landed (V22; `review::tests::merged_stack_parent_retargets_open_children_only`).
Worst gaps: stacked cherry-pick/restack UI · quality gates external checks; CODEOWNERS team owners/full gitignore negation remain partial.

## 02 Planning / Issues / Boards (audited ✓ — rows: reports/parity/02-issues-boards.md @ 52f0880)
33 rows — done 8 · partial 17 · stub 0 · missing 8.
Worst gaps: swimlane grouping dimensions · matrix reports · external tracker integration.

## 03 Packages & CI/CD & Deployments (audited ✓ — rows: reports/parity/03-packages-cicd.md @ 2fcf30d)
49 rows — done 5 · partial 20 · stub 1 · missing 23.
Worst gaps: per-format registry protocols · retention/immutability/CVE/ACLs · workers/artifacts/test-reporting · non-manual triggers+DSL · deployment integrations/webhooks.

## 04 Chat / Documents / Meetings / Calendar (audited ✓ — rows: reports/parity/04-collab.md @ 039cca2)
59 rows — done 9 · partial 31 · missing 19.
Progress: chat attachment persistence/preview + selected-mention notifications landed (`af6fbbf`, `d095404`, `7fe7776`); document sharing+KB permissions/search remains UNVERIFIED. · doc import/publish/rich-types · meeting rooms/equipment/external attendees · CalDAV+multi-calendar+Day/Schedule views.

## 05 Platform / Auth / Permissions (audited ✓ — rows: reports/parity/05-auth-permissions.md @ 67f0243)
32 rows — done 4 · partial 14 · missing 14.
Worst gaps: Right taxonomy+enforcement · org settings/multi-workspace · SSO/OAuth/2FA/permanent tokens · OAuth app consent · invitations with role preassignment.

## 06 Personal / Org (audited ✓ — rows: reports/parity/06-personal-org.md @ d495902)
54 rows — done 6 · partial 25 · stub 2 · missing 21.
Progress (feat/w2-feeds-oauth @7e43228): scoped subscriptions landed (SCHEMA_V29 `subscription_scopes`, org/team/project/location/profile/entity targets, wildcard `*` event, precedence scope→setting→default) + Inbox subscription editor rail ⇒ “Subscription editor / personal feeds” stub→partial, “Whole-org/team/project/location subscription targets” missing→partial. Tests: `personal::tests::scoped_subscription_beats_event_default_and_wildcard`, `invalid_subscription_target_is_rejected`.
Worst gaps: locations/org-directory stub · dashboard personalization · subscription/feeds system · blog calendar/chat/subscription integrations.

## 07 Dev Env / Apps / HTTP API (audited ✓ — rows: reports/parity/07-devenv-api.md @ 539fb5f)
42 rows — done 0 · partial 27 · stub 0 · missing 15.
Progress (feat/w5-events ☀Surya): domain event taxonomy `src-tauri/src/events.rs` — closed `domain.action` constant set (`issue.created/updated/archived`, `document.updated`, `git.commit`, `review.created/updated/merged`) + `list_event_types` command (Tauri + `/api/cmd`, `CommandPolicy::Session`). Real write points now fan out through the existing `enqueue_event` seam: `issues::{create,update,archive}_issue`, `documents::save_document` (taxonomy name + pre-taxonomy alias `DocumentWebhookEvent`, so old subscriptions keep firing), `git::repo_commit` (`{commit:{repo_path,id,message,branch}}`), `review::{create_review,update_review,open_merge_request,attempt_merge}` ⇒ the “hand-fired test payload only” state is gone. No migration needed (no schema change) — V42 left unclaimed. Tests: `applications::delivery_tests::{a_review_write_enqueues_only_the_matching_subscription,a_git_commit_enqueues_the_matching_subscription,a_document_save_serves_both_the_taxonomy_name_and_the_legacy_alias}` + `events::tests::*`. Rows stay partial: package/pipeline/chat domains still emit nothing, filters remain untyped dot-paths, no inbound app HTTP API/SDK. Live-receiver delivery now VERIFIED (☠Bhairava, `99d3d9d`): `applications::delivery_tests::a_real_merge_reaches_a_live_receiver_with_a_verifiable_signature` drives a real `review::attempt_merge` on a throwaway repo, sweeps the queue to a real socket, and recomputes the HMAC over the received bytes; `review.merged` firing is covered by the same test. That audit found two defects, both fixed on this branch: `enqueue_event` wrote `next_attempt_at` NULL while `due_webhook_deliveries` requires it non-NULL, so **every** fan-out event was queued and never deliverable; and `attempt_merge` updated the target ref with `force=false`, which always fails on an existing branch, so no real safe merge could finalize (defect pre-existing on master).
Progress (feat/w4-secrot ☀Agni): V41 `webhook_secrets` key ring (one ACTIVE signer, N RETIRING co-signers pruned at `expires_at`); `rotate_webhook_secret(webhook_id, overlap_seconds)` presents the new secret once, `list_webhook_secrets` returns metadata only; delivery signs with ACTIVE in `x-gaia-space-signature` and every still-valid retiring secret in `x-gaia-space-signature-retiring`, so receivers cut over without a gap. Both commands are `CommandPolicy::AppAdmin`. Overlap default is configurable (`GAIA_SPACE_WEBHOOK_SECRET_OVERLAP_SECONDS`, 86400s). Tests: `applications::secret_ring_tests::*` (6) + HTTP regression `space-server::tests::webhook_secret_rotation_is_admin_only_and_shows_the_secret_once`. Docs: `docs/webhook-receiver-guide.md` §Secret rotation ⇒ “Richly filterable cross-domain webhooks” stub→partial.
Progress (feat/w2-feeds-oauth @64ec368): app OAuth client_credentials grant (SCHEMA_V31 `app_secrets`/`app_tokens`, argon2-hashed secret+token, TTL, rotation revokes outstanding tokens, verify/revoke/list) + marketplace listing metadata and install records (`marketplace_apps`, `app_installs` with MARKETPLACE/LINK/MANUAL/JENKINS/TEAMCITY kinds), wired to Applications view ⇒ “App OAuth flows/credentials” stub→partial, “Marketplace app metadata” + “AppInstallInfo install flows” missing→partial. Tests: `applications::oauth_tests::*` (4) + HTTP regression `space-server::tests::app_credentials_are_admin_only`. Web policy: credential commands (rotate/issue/verify/revoke/list + marketplace writes) are `CommandPolicy::AppAdmin` — admin-only, since `applications` has no owner column (☾Kali finding). Webhook delivery/retry=partial: receiver replay guide `docs/webhook-receiver-guide.md:25-32`; durable delivery-ID header `src-tauri/src/applications.rs:352`; retry assertion `src-tauri/src/applications.rs:1044-1065`. UNVERIFIED: no external HTTP API surface consumes the bearer token yet; PKCE/code flow still absent.
Worst gaps: no cloud dev-environment lifecycle · automatic domain-event webhook/chatbot/extension dispatch incomplete · no external HTTP app API · no slash-command/app-rights integration.

## 08 Video Calls / Meet (audited ✓ — rows: reports/parity/08-video-calls.md @ 963dd13)
35 rows — done 10 · partial 15 · missing 10.
Worst gaps: recording/egress · lobby/admission · remote audio playback · persistent video_provider · call lifecycle model.
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
