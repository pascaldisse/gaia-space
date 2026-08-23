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
- V53 → feat/w7-personal (to-do content kind; absence confidentiality + availability) ☀Kali
- V54 → feat/w7-keys (application SSH/GPG public-key records + revocation) ☀Kali
- V56 → feat/w7-chatbot (two-stage application rights: developer-declared required rights vs. admin-approved authorized rights per context) ☀Vishnu-II
- V57 → feat/w8-auth (predefined role policy; UNSTARTED — reservation only) ☀Kali-VIII
- V58 → feat/w9-rights (Right taxonomy + enforcement) ☀wave9
- V59 → feat/w9-registry (per-format typed detail models; OCI blob store) ☀wave9
- V60 → feat/w9-caldav (CalDAV write-back + multi-calendar) ☀wave9
- V61 → feat/w9-cicd (quality-gate application principals · workers · artifacts) ☀wave9
- V62 → feat/w9-auth (SSO/OAuth remainder · 2FA · permanent tokens; supersedes stale V57 reservation) ☀wave9
- V63 → feat/w9-workers (pipeline workers · artifacts · test reporting) ☀wave9
- V64 → feat/w10-review (quality-gate bypass permissions · CODEOWNERS team owners · external checks) ☀wave10 — UNSTARTED/unconsumed (no schema change required)
- V65 → feat/w10-personal (blogs · subscriptions/feeds · org chart/locations) ☀wave10
- V66 → feat/w10-collab (doc import/publish · meeting rooms/equipment · external attendees) ☀wave10
- V67 → feat/w10-auth (org settings/multi-workspace · SSO/SAML modules · OAuth2 authz-code ledger correction) ☀wave10
- V68 → feat/w10-cicd (non-manual triggers + DSL · deployment integrations/webhooks) ☀wave10
- V69 → feat/w11-review (branch protection remainder · external checks completion) ☀wave11
- V70 → feat/w11-cicd (remaining trigger types · deployment webhook wiring) ☀wave11
- V71 → feat/w11-collab (document importer completion · meeting remainder) ☀wave11
- V72 → feat/w11-personal (personal feed remainder · org chart/locations) ☀wave11
- V73 → feat/w11-auth (OAuth consent UI; implicit/ROPC intentionally excluded: KB §05 deprecated/not recommended) ☀wave11 — no schema migration required
- V74 → feat/w11-devenv (standby pool live run) ☀wave11
- V75 → feat/w11-calls (call recording completion) ☀wave11
- V55 → feat/w7-devenv (cloud dev environment lifecycle: `dev_environments` state/idle-hibernation/standby pool) ☀

TOTALS (8/8 audited, 356 rows): done 61 · partial 183 · stub 4 · missing 108. Matrix NOT green — steering loop active.

RECOUNT METHOD (2026-08-22): `python3 scripts/parity_totals.py --check` parses only Markdown data rows whose third data cell is Status ∈ {done, partial, stub, missing}; it also reconciles ordered 01→08 section headings, canonical report paths, and each immediate section summary. Headings, prose, and `04-collaboration.md` evidence notes do not count. Current committed ledger contains 356, not the claimed 371; 371 has no row source in this tree.

NOTE: KB files' own §Gap-Analysis sections = STALE (written vs old lib/ Flutter era). Every row below re-verified against current src/ + src-tauri/ by audit lane. Rows marked UNVERIFIED until lane evidence lands.
MANUAL-ONLY UNVERIFIED (owner): production ticker delivery to an external receiver, real public DNS/egress, and visible Tauri desktop window startup require owner-operated environment/UI verification. In-process real-socket tests and `space-server` HTTP checks do not verify those deployment/UI facts.

## 01 Git & Code Review (audited ✓ — rows: reports/parity/01-git-code-review.md; Varuna-III stage 3)
52 rows — done 6 · partial 18 · stub 1 · missing 27.
Progress: source-branch root/`.space` CODEOWNERS parsing, last-match-wins glob matching, local user/email/role resolution, and required per-path approvals landed (V21); ordered MR stacks create/list and retarget open children after parent merge landed (V22; `review::tests::merged_stack_parent_retargets_open_children_only`).
Progress (feat/w7-review): quality gates now wait on rule-declared external checks that have never reported (`quality_gate_rules.external_checks_json`, no migration — the V24 column was dormant); stacked reviews gained `listMyStacks`/`removeStack` plus an Unstack control ⇒ "Stacked reviews/cherry-pick/restack" partial→done.
Worst gaps: CODEOWNERS team owners/full gitignore negation remain partial.

## 02 Planning / Issues / Boards (audited ✓ — rows: reports/parity/02-issues-boards.md @ 52f0880)
33 rows — done 8 · partial 17 · stub 0 · missing 8.
Worst gaps: swimlane grouping dimensions · matrix reports · external tracker integration.

## 03 Packages & CI/CD & Deployments (audited ✓ — rows: reports/parity/03-packages-cicd.md @ 2fcf30d)
49 rows — done 4 · partial 26 · stub 1 · missing 18.
Worst gaps: per-format typed detail models (Dart still generic) · retention/immutability/CVE/ACLs · workers/artifacts/test-reporting · non-manual triggers+DSL · deployment integrations/webhooks.

Progress (feat/w8-pkg ☀Surya-VIII): registry protocols for the four remaining formats in `src-tauri/src/package_registry.rs` — NuGet V3 (lower-cased id coordinates, service index, flat-container version list), PyPI (PEP 503 normalization, simple project page, distribution resolve), Composer (`packages.json` + `p2/{vendor}/{package}.json`), OCI distribution v2 (verb-driven name split, tagged manifest PUT/GET, tag list, referrers by `subject.digest`). Routes `/api/registry/{repo}/{nuget|pypi|composer|v2}/*` reuse the existing `registry_auth` seam. Retention gained a preview seam: `package_retention_candidates` returns the exact rows cleanup would delete with an `age`/`count`/`age+count` reason grouped per package name (previously grouped by parsing the row id — a real mis-grouping, now fixed), and `apply_package_retention` deletes that set through `delete_package_version` so payload files go too. CVE ledger gained `repository_vulnerability_report(repository_id, min_severity)` — repository-wide, severity-ranked, local ledger only (no scanner, no network). UI: Preview retention / Repository CVEs actions in `src/views/Packages.tsx`. Tests: `package_registry::tests::*` (6), `pipelines::tests::{retention_candidates_group_per_package_and_carry_a_reason,vulnerability_report_filters_by_severity_and_repository}`, `space-server::tests::format_registry_protocols_are_reachable_over_http` (publish→resolve per format + 401 on unauthenticated). No migration needed at w8 time; V60 was later consumed by feat/w9-caldav (CalDAV-owned VEVENTs). UNVERIFIED (updated w9): real `pip install` verified against a live server (scripts/registry_format_check.sh); dotnet/composer/docker CLIs absent on this machine — those formats curl-verified only. OCI blob (digest) addressing implemented in w9 (content-addressed store), 501 resolved.

## 04 Chat / Documents / Meetings / Calendar (audited ✓ — rows: reports/parity/04-collab.md @ 039cca2)
59 rows — done 10 · partial 32 · missing 17.
Progress: CalDAV named-calendar discovery + VEVENT PUT/DELETE write-back landed (V60); Google exposure remains absent. · document sharing+KB permissions/search remains UNVERIFIED. · document importer (local/Confluence export: `.md` editable; all other files preserved) landed V71; publish/rich-types remain partial. · meeting rooms/equipment/external attendees.

## 05 Platform / Auth / Permissions (audited ✓ — rows: reports/parity/05-auth-permissions.md @ 67f0243)
32 rows — done 7 · partial 17 · missing 8.
Worst gaps: remaining operational right enforcement · org settings/multi-workspace · SSO/SAML external modules · OAuth consent UI depth.

## 06 Personal / Org (audited ✓ — rows: reports/parity/06-personal-org.md @ d495902)
54 rows — done 9 · partial 26 · stub 2 · missing 17.
Progress (feat/w2-feeds-oauth @7e43228): scoped subscriptions landed (SCHEMA_V29 `subscription_scopes`, org/team/project/location/profile/entity targets, wildcard `*` event, precedence scope→setting→default) + Inbox subscription editor rail ⇒ “Subscription editor / personal feeds” stub→partial, “Whole-org/team/project/location subscription targets” missing→partial. Tests: `personal::tests::scoped_subscription_beats_event_default_and_wildcard`, `invalid_subscription_target_is_rejected`.
Progress (feat/w7-personal ☀Kali, SCHEMA_V53): to-do bodies carry a `content_kind` (text|markdown) rendered through a token renderer that never emits HTML; `postpone_todo` rolls an overdue task over to today before shifting it and the task view groups Today/Later/No date/Done; `convert_todo_to_issue` promotes a project to-do into that project's issue, closing the to-do and anchoring it to the issue it became; absences separate a possibly confidential reason from a public availability (away|partial|available), redacted to `Private` for every reader but the person and admins at the web chokepoint. Tests: `personal::dashboard_preference_tests::{postponing_an_overdue_task_rolls_it_over_to_today_first,a_todo_body_is_text_or_markdown_and_nothing_else,a_confidential_reason_is_hidden_from_colleagues_but_the_availability_is_not,availability_is_a_closed_set,v53_columns_land_on_a_pre_v53_database_with_todays_behaviour}` + `src/markdownLite.test.ts`. UNVERIFIED: `convert_todo_to_issue` has no automated test (it needs the process-global database) — the handler path is compile-checked and wired only.
Worst gaps: locations/org-directory stub · dashboard personalization · subscription/feeds system · blog calendar/chat/subscription integrations.

## 07 Dev Env / Apps / HTTP API (audited ✓ — rows: reports/parity/07-devenv-api.md @ 539fb5f)
42 rows — done 5 · partial 27 · stub 0 · missing 10.
Progress (feat/w11-devenv ☀Vayu, V74): standby pools now have a durable target per project+IDE+instance type. Save/refill commands and the Dev Environments view materialize exactly the target number of unowned `STANDBY` rows; each successful conditional claim immediately replenishes its matching pool. Test: `devenv::tests::pool_target_refills_after_a_claim_without_reassigning_the_claimed_environment` proves first fill, idempotent refill, transfer, and restoration. The lifecycle remains record-only: no VM/container provisioner, so §3.1 #1 and physical pre-warming remain missing; hot-pool row stays partial.
Progress (feat/w5-events ☀Surya): domain event taxonomy `src-tauri/src/events.rs` — closed `domain.action` constant set (`issue.created/updated/archived`, `document.updated`, `git.commit`, `review.created/updated/merged`) + `list_event_types` command (Tauri + `/api/cmd`, `CommandPolicy::Session`). Real write points now fan out through the existing `enqueue_event` seam: `issues::{create,update,archive}_issue`, `documents::save_document` (taxonomy name + pre-taxonomy alias `DocumentWebhookEvent`, so old subscriptions keep firing), `git::repo_commit` (`{commit:{repo_path,id,message,branch}}`), `review::{create_review,update_review,open_merge_request,attempt_merge}` ⇒ the “hand-fired test payload only” state is gone. No migration needed (no schema change) — V42 left unclaimed. Tests: `applications::delivery_tests::{a_review_write_enqueues_only_the_matching_subscription,a_git_commit_enqueues_the_matching_subscription,a_document_save_serves_both_the_taxonomy_name_and_the_legacy_alias}` + `events::tests::*`. Rows stay partial: package/pipeline/chat domains still emit nothing, filters remain untyped dot-paths, no inbound app HTTP API/SDK. Live-receiver delivery now VERIFIED (☠Bhairava, `99d3d9d`): `applications::delivery_tests::a_real_merge_reaches_a_live_receiver_with_a_verifiable_signature` drives a real `review::attempt_merge` on a throwaway repo, sweeps the queue to a real socket, and recomputes the HMAC over the received bytes; `review.merged` firing is covered by the same test. That audit found two defects, both fixed on this branch: `enqueue_event` wrote `next_attempt_at` NULL while `due_webhook_deliveries` requires it non-NULL, so **every** fan-out event was queued and never deliverable; and `attempt_merge` updated the target ref with `force=false`, which always fails on an existing branch, so no real safe merge could finalize (defect pre-existing on master).
Progress (feat/w4-secrot ☀Agni): V41 `webhook_secrets` key ring (one ACTIVE signer, N RETIRING co-signers pruned at `expires_at`); `rotate_webhook_secret(webhook_id, overlap_seconds)` presents the new secret once, `list_webhook_secrets` returns metadata only; delivery signs with ACTIVE in `x-gaia-space-signature` and every still-valid retiring secret in `x-gaia-space-signature-retiring`, so receivers cut over without a gap. Both commands are `CommandPolicy::AppAdmin`. Overlap default is configurable (`GAIA_SPACE_WEBHOOK_SECRET_OVERLAP_SECONDS`, 86400s). Tests: `applications::secret_ring_tests::*` (6) + HTTP regression `space-server::tests::webhook_secret_rotation_is_admin_only_and_shows_the_secret_once`. Docs: `docs/webhook-receiver-guide.md` §Secret rotation ⇒ “Richly filterable cross-domain webhooks” stub→partial.
Progress (feat/w2-feeds-oauth @64ec368): app OAuth client_credentials grant (SCHEMA_V31 `app_secrets`/`app_tokens`, argon2-hashed secret+token, TTL, rotation revokes outstanding tokens, verify/revoke/list) + marketplace listing metadata and install records (`marketplace_apps`, `app_installs` with MARKETPLACE/LINK/MANUAL/JENKINS/TEAMCITY kinds), wired to Applications view ⇒ “App OAuth flows/credentials” stub→partial, “Marketplace app metadata” + “AppInstallInfo install flows” missing→partial. Tests: `applications::oauth_tests::*` (4) + HTTP regression `space-server::tests::app_credentials_are_admin_only`. Web policy: credential commands (rotate/issue/verify/revoke/list + marketplace writes) are `CommandPolicy::AppAdmin` — admin-only, since `applications` has no owner column (☾Kali finding). Webhook delivery/retry=partial: receiver replay guide `docs/webhook-receiver-guide.md:25-32`; durable delivery-ID header `src-tauri/src/applications.rs:352`; retry assertion `src-tauri/src/applications.rs:1044-1065`. UNVERIFIED: no external HTTP API surface consumes the bearer token yet; PKCE/code flow still absent.
Worst gaps: no cloud dev-environment lifecycle · automatic domain-event webhook/chatbot/extension dispatch incomplete · no external HTTP app API · app rights model exists but nothing enforces it yet.

Progress (feat/w7-chatbot ☀Vishnu-II): chatbot slash-command callback `src-tauri/src/chatbot.rs` — `list_chatbot_commands(chatbot_id,user_id,prefix)` signs a typed `ListCommandsPayload` through the existing dispatcher, accepts the wrapped `Commands` object or a bare `CommandDetail` list, filters/de-duplicates by the typed prefix and falls back to the registration's declared `commands_json` while reporting the endpoint error. Two-stage application rights `src-tauri/src/app_rights.rs` (V56 `app_required_rights`/`app_authorized_rights`): declaration/request is stage 1, per-context grant/approve/revoke is stage 2, `scope_approval_status` returns APPROVED/PARTIAL/PENDING/NOT_REQUESTED plus grants no longer declared; `app_has_right` is the enforcement seam. Commands are Tauri + `/api/cmd` `CommandPolicy::Session`; UI in `src/views/Applications.tsx`. Tests: `chatbot::chatbot_tests::*` (6) + `app_rights::app_rights_tests::*` (5). UNVERIFIED: no call path consumes `app_has_right` yet; the chat composer does not yet call command discovery.

Progress (feat/w8-apps ☀Vishnu-VIII): the two-stage rights model is now *consumed*, which was its only open UNVERIFIED — `app_rights::app_has_right_anywhere` (project grant, else org-wide) gates the external application API: `/api/app/projects` answers with only the projects the app was authorized to view, and the first external write `POST /api/app/projects/{project_id}/issues` refuses without `Project.CreateIssues` even with a `write` token (OAuth scope ≠ authorization). No migration. Test: `space-server::tests::the_app_api_shows_and_writes_only_what_the_rights_model_authorized` ⇒ "Two-stage app required-rights…" partial→done. Chat composer slash menu landed (`src/chatCommands.ts`, `src/views/Chat.tsx`): typing `/` asks every registered chatbot endpoint for its commands, debounced and prefix-filtered, same-named commands stay per-bot, a live answer beats that bot's declared fallback (`src/chatCommands.test.ts`); row stays partial because typed menu parameter forms are still absent. Tauri CLI 死枝: the reported "bun tauri missing" premise is false — `@tauri-apps/cli` 2.11.4 is already a devDependency and the invocation is `bun run tauri` (`bun run tauri info` reports a complete toolchain, desktop feature compiles under `cargo clippy --all-targets`). Desktop window startup itself stays MANUAL-ONLY UNVERIFIED (owner's eyes).
## 08 Video Calls / Meet (audited ✓ — rows: reports/parity/08-video-calls.md @ 963dd13)
35 rows — done 12 · partial 20 · missing 3.
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
