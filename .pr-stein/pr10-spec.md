# PR-Stein #10 · canonical native reimplementation specification

## Authority, credit, boundary

| item | value |
|---|---|
| native base | `b0946ec7c4456ef8e4ba05d9ae30b5dbfe9e35ef` / local `master` |
| idea credit | PR #10, `jzudeml` / `paloptic_JL`, foreign tip `a7ce75c` |
| evidence | `4b6529d:.pr-stein/{pr10-harvest.md,structure-intent.md,live-ui.md}`; `338f912:.pr-stein/pr10-review.md`; 73 durable screenshots in harvest worktree `.pr-stein/shots/` |
| governing law | `~/projects/law/{00-index,ui,testing,data,process,stack,sins}.md`; `~/.gaia/skills/pr-stein/SKILL.md` |

PR #10 supplies an idea and design reference only. At close credit its author and cite the native SHA. Never merge/copy foreign logic, commands, migrations, tests, or snippets. Copyable design/layout/markup/CSS is adapted—not pixel reproduced—to house law: tokens only; flat 1px borders; zero radius/shadow/gradient/hover-lift; no blue accents; bundled fonts; labelled icon controls. All master file:line citations below are measured against current native base `b0946ec`, never foreign line offsets.

## Standing contract — every atom

- Native base remains authority. TS uses Bun; Tauri stays thin. Values are parameters with defaults, never magic IDs/profiles/ports/routes/timeouts/palette names.
- Server/session determines actor and authoritative organization/project/channel/source; client actor/profile/owner cannot authorize or stamp writes. Missing/denied/not-found renders explicit error/action, never an empty state.
- Identity binding, exactly: `bind_session_identity` (`space-server.rs:2896`, applied to every command at `:3221`) overwrites client-supplied `profile_id/created_by/owner*/author*/actor/voter_id/recipient_id/organizer_id` (`:2900-2921`) with the session profile. It is bypassed for exactly three policies (`space-server.rs:3215-3217`): `AbsenceWrite` (+GlobalAdmin), `DocumentAccessWrite`, `MeetingParticipantWrite`. Atoms 09 (document access) and 10 (participants) land precisely inside that exempt set. ∴ (a) the exempt set is frozen — no atom adds a command to it, and no new exempt policy is introduced; (b) every new command under those three policies carries its own explicit ownership/membership check in the domain fn signature, not only in web policy; (c) each such command ships a **named** negative test (`absence_write_rejects_foreign_owner`, `document_access_write_rejects_non_grantor`, `meeting_participant_write_rejects_non_organizer`) asserting that a payload naming another user's id is denied — not silently accepted, not silently rewritten to the caller. Falsifier is per-command and named; a generic forged-identity test does not discharge it. Completeness of pre-existing ownership checks inside the three exempt policies on head = **UNVERIFIED**.
- Every multi-table write is one transaction with FK enabled on every connection; injected failure leaves no partial/orphan row. New tables name FK/cascade/index policy.
- Web URL is canonical path + History API + semantic `<a href>`; no web hash. On current native base `b0946ec`, a new view requires **three** edits in the same commit — the views array, `registerViews` (`App.tsx:75`), `setAvailableViews` (`App.tsx:86`); a new entity URL requires **both** `router.ts:26 entityRoutes` and `parsePath` (`router.ts:96…`). Missing one leg makes a typed URL fall back silently to `FALLBACK_VIEW` (`router.ts:41`) — that silent fallback is banned here, not merely discouraged: an unregistered URL must yield an explicit not-found surface. Deep-link restores project/container. Desktop may adapt internally. Web-hidden/desktop-only views are unreachable through URL, menu, search, and Goto; settings-hidden navigation groups remain reachable only by canonical URL/Goto as product intent says.
- Dialog/menu/drawer: semantic controls, labelled icons, keyboard access, focus trap, Escape, return focus, contrast. Palette root reaches all portals.
- Persist five independent canvas/nav palettes: `paper`, `sand`, `dusk`, `lagoon`, `deep`; teal=action/open, amber=due/waiting, red=critical/blocked, zero=neutral. Components use semantic tokens, never palette-specific branches.
- Preserve `b0946ec` desktop fix: native Tauri does not mount web login/auth UI or issue its web-login request. Desktop and web prove separately. On current native base, the `online` argument must be threaded through every `isWeb(online)` call site; bare `isWeb()` is a defect class, and desktop must keep `createHashAdapter` (`App.tsx:77`) — a mis-threaded desktop receiving `createPathAdapter` breaks `history.pushState` under `tauri://`.
- Command parity is a **per-atom obligation**, never a debt deferred to atom 03: any atom that adds a backend command extends the command manifest and all three registration legs — `#[tauri::command]` + `invoke_handler` entry (desktop `run()`: `lib.rs:112-591`, 真; the mobile setup-shell `invoke_handler` at `lib.rs:649-652` registers only `app_info`/`connect_space_server`/`open_space_setup` and is **not** a product-command leg), `command_policy` allow-list (`space-server.rs:2500`; missing = 403 `:3201-3202`), `dispatch!` arm (`space-server.rs:5084`; missing = 404) — **in the same commit as the command**, and reruns the leg-removal falsifier in that commit. Dispatch binds arguments by name (`arg(body, stringify!($a))`) ∴ the Rust parameter name **is** the wire ABI; renaming a parameter is a breaking API change and needs its own noted migration. A deliberately desktop-only command is declared `Unavailable` in the policy → **501** (policy branch `space-server.rs:3224-3227`, 真 — `:3223` is `match policy {`; the parallel `dispatch!` 501 fallback arm is `:4233-4237`, and the 404 arm is `:4238`), never left absent → 403. Same rule for routes: an atom adding a view edits all three registration sites in the same commit and proves the unregistered-URL not-found path.

## Intent ledger / acceptance

| intent | native result |
|---|---|
| chat-first | route-derived rail + channel sidebar + command bar; third layout alongside lossless grouped/flat; More derives from registered views; scoped search/compose/create/org switch work |
| paper system | five palette roots including overlays; native geometry replaces all witnessed rounded/shadow/blue/white-dark-portal defects; settings gets one readable measure |
| common grammar | shared PageHeader/action/metric/empty/error/dialog/prompt/context-menu/drawer/date primitives; one primary action in one place; menu anchors to invoking pointer |
| project/tasks | project workspace route/tab context; one create/edit field form; list-head capture; personal/project/group authorization and atomic writes |
| message work | menu has Task/Ticket/Date; inherited org/project/channel; server resolves authorized message; source anchor + reverse link; deleted source named loudly |
| knowledge | shelves, folder/document create/rename/delete/export, upload and drag filing; ownership; attachment source anchor; duplicate filing DB-impossible |
| meetings/dates | product Date/DateTime control; external `meeting_url` distinct from native call URL; participants on creation; real Join anchor |
| attention/notes | one attention derivation feeds rail/Home/Inbox including threads; append-oriented channel notes reference documents, not copied blobs |
| semantic repairs | rail `+` creates rather than searches; visible-destination control acts; one New meeting; make-work opens real drawer |
| transport | each command has Tauri attribute + `lib.rs` handler and separate web policy + `space-server` dispatch, all identity-authorized |

Design evidence establishes hierarchy/order/forms for rail/sidebar, Home, chat/composer, task drawer/list, knowledge shelves, calendar, meetings, settings, dialogs, date picker and empty states. It does **not** establish native completion.

## Schema / migration contract

Native `b0946ec` is `SCHEMA_VERSION = 132`. Foreign V135/V137 labels are not allocations; foreign DB actually also claims V133 anchors, V134 notes and V136 category. Before Atom 02, re-read current native head, allocate the next unique monotonic rungs for the full retained scope, record them in its commit, and never collide/assume a foreign ladder.

- Meeting URL is nullable, trimmed, validated `http(s)`, and never overwrites native call URL.
- Source type/id is both-or-neither. It is deliberately not a dangling FK when message deletion preserves work; resolver returns explicit unavailable/missing source. Attachment filing uses a partial unique index for non-null paired anchors; legacy unanchored rows remain valid; conflict is deterministic, not read-then-write.
- Additive/table-aware migration: backup copied real DB before mutation; migrate once; second boot proves no schema/data change; rollback restore is byte-checksummed. Update `user_version` only after successful transaction.

### Rung procedure (measured on head, 真)

Next free rung is **133** (`db.rs:8 pub const SCHEMA_VERSION: i64 = 132;`). Per new rung, in one commit: (1) bump `SCHEMA_VERSION` (`db.rs:8`); (2) add an `if version < N` branch inside `fn migrate` (`db.rs:176`; newest existing branch `version < 132` at `db.rs:971`, tail `pragma_update(user_version, SCHEMA_VERSION)` at `db.rs:974`); (3) update the pinned fixture `assert_eq!(SCHEMA_VERSION, …)` at **`db.rs:2324`** in that same commit — omitting it breaks the build; (4) guard with `table_exists`; (5) use idempotent DDL (`add_column_if_missing` / `IF NOT EXISTS`). Branch order in `migrate` is already non-monotonic on head (`version < 122` sits after `version < 131`, `db.rs:958`) ∴ **idempotence, not ordering, carries correctness**: no migration may depend on branch position, and re-running any branch must be a no-op. Schema rungs land in a **schema-only commit**, never bundled with UI, so the copied-DB second-boot proof is meaningful. Falsifier: on a copy of a real pre-migration DB (never `/tmp`, never the operator DB) open → migrate → `PRAGMA user_version` equals the new constant → migrate a second time on the same file → `sqlite3 <db> .schema | sha256` identical and no error. A green `cargo test` alone does not discharge this (fresh-DB creation and upgrade are different code paths).

### Deletion / rename / confirm contract (owned by atom 09b, lands before atom 12)

Measured on head (真): `ON DELETE CASCADE` appears 110× in `db.rs` and is therefore **non-uniform**; `created_by` is NULL-able on `projects` (`db.rs:1267`), `issues` (`:1271`), `documents` (`:1295`), `doc_versions` (`:1296`) ∴ owner-less legacy rows are legal and `bind_session_identity` never back-fills them; existing `delete_x(id: String)` signatures carry **no DB-layer ownership check** (correct counter-pattern: `personal.rs:690 delete_absence_owned(id, &owner)`); **`delete_project` does not exist** on head — projects use the `archived` column (`db.rs:1267`). ∴ "delete everywhere, ownership by `created_by`" is **new design, not a port**, and is specified here per entity:

- (a) **Soft vs hard, per entity, named explicitly.** `projects` stay **soft** (`archived`) on native head; `delete_project` is **not introduced** absent an explicit product ruling recorded in this spec. Any entity whose row is a container of history defaults to soft; hard delete requires a per-entity line here.
- (b) **Who may delete, enforced at the domain layer.** Every delete/rename takes the owner in the fn signature (`delete_x_owned(id, &owner)` / `rename_x_owned`), so the check survives independently of web policy; web policy is an additional wall, never the only one.
- (c) **Cascade/orphan policy stated per child table**, since cascades are non-uniform on head; a new table declares FK + cascade or explicit orphan-nulling.
- (d) **Legacy `created_by IS NULL` rows have a defined, tested outcome** — named in this spec per entity (default: deletion denied, row surfaced as unowned; never silently deletable by any caller).
- (e) **Confirmation UX**: destructive action is never one click; the dialog states the consequence in a sentence; an ellipsis affordance means "will ask".

#### Deletion matrix — one row per intended deletable entity (真, measured on `b0946ec`; implementation-ready)

This table **is** the completeness obligation: 09b touches exactly these entities, no others; an entity absent here is out of scope for 09b, and a row here that has no test is a failed atom. `無指定` = FK declared with **no** `ON DELETE` clause ∴ under `PRAGMA foreign_keys=ON` (`db.rs:18-20`, applied in `open_at` `:25-31` and `open_in_memory` `:35-38`) the parent delete is **rejected by SQLite**, not cascaded — so "blocked child" is a real, testable outcome and every such child must be explicitly detached, deleted first inside the same transaction, or the delete refused loudly.

| entity (`db.rs`) | soft / hard | owner column (NULL?) | domain signature | child tables → cascade / orphan policy | `created_by IS NULL` (legacy) outcome | confirmation | tests |
|---|---|---|---|---|---|---|---|
| `projects` `:1267` | **soft only** (`archived`) — `delete_project` is **not introduced** (absent on head, no product ruling) | `created_by` NULL-able | `archive_project_owned(id, &owner)` / `rename_project_owned(id, &owner, name)` | none traversed: nothing is deleted ∴ no cascade decision. `project_members`/`review_merge_policies`/`project_roles`/`protected_branch_rules`/`devfiles`/`review_stacks`/`dev_environment*` are CASCADE `:1505,:1007,:1156-1157,:1342,:1482,:1437,:1855,:1867`, `todos.project_id` `:200` and `issues/boards/channels/blog_posts/invitations` `:1270-1272,:1278-1280,:1284,:1289,:1397,:1476` are `無指定` ∴ a future hard delete would be **blocked**, recorded here as the reason soft is kept | archive **denied**; row surfaced as unowned, never archivable by an arbitrary caller | ellipsis + consequence sentence ("archived, not deleted") | 4: non-owner denied · NULL-owner denied · archived row still `SELECT`-able · archived row absent from `list_projects` (`platform.rs:1427`) |
| `channels` `:1284` | **soft** (`archived`; `chat.rs:352` list has no archived filter today ∴ 09b adds the filter with the flag) | **no owner column** ∴ authorization is **membership/role**, not `created_by`: `channel_members` `:1285` + project role | `archive_channel_authorized(id, &actor)` (actor must be channel member with admin role; signature carries actor, never payload) | CASCADE: `channel_notification_preferences :1064`, `private_feeds :1072`, `channel_subscriptions :1189`, `document_discussions :1200`, `message_drafts :1669`, `channel_typing :1678`, `scheduled_messages :1693`, `message_polls :1723`, `thread_channels :1776-1777`. `無指定` (would block a hard delete): `channel_members :1285`, `messages :1286`, `read_state :1288`, `reviews :1289`, `review_discussions :1291`, `meetings :1299`. SET NULL: `locations.channel_id :1175`. ∴ **hard delete is forbidden here**; soft only | n/a (no owner column) — instead: actor with no membership row is denied | ellipsis + consequence sentence naming message retention | 4: non-member denied · member-non-admin denied · archived channel still holds its messages · absent from channel list |
| `todos` `:1249` | **hard** | `profile_id` **NOT NULL** ∴ no legacy-NULL class exists for todos | `delete_todo_owned(id, &owner)` replacing `delete_todo(id)` (`personal.rs:381`, no ownership check today) | `todo_assignees.todo_id` CASCADE `:1311` (duplicate DDL `:1320`) — sole child; after delete assignee rows = 0 | n/a — column is NOT NULL; a migration-era row without a profile is impossible, asserted once | two-step `DeleteButton` + consequence sentence | 4: non-owner denied · owner deletes · `todo_assignees` count 0 · `PRAGMA foreign_key_check` empty |
| `documents` `:1295` | **soft** (`archived`; `documents.rs:177/323` currently unfiltered ∴ 09b adds the filter) | `created_by` NULL-able | `archive_document_owned(id, &owner)` / `rename_document_owned(id, &owner, title)`; grant-based access stays under `DocumentAccessWrite` (atom 09) | CASCADE: `document_permissions :1297`, `document_favorites :1124`, `document_discussions :1199`, `document_files :1910`. `無指定`: `doc_versions.document_id :1296`, `blog_posts.draft_id :1476` ∴ both block a hard delete; **history container ∴ soft** | archive **denied**, surfaced as unowned | ellipsis + consequence sentence (versions retained) | 4: non-owner denied · NULL-owner denied · soft row present but unlisted · `doc_versions` rows intact after archive |
| `document_folders` `:1294` | **hard**, only when empty | **no owner column** ∴ authorization = `document_folder_permissions.folder_id` (CASCADE `:1386`, duplicate DDL `:1392`) grant of admin level, in the signature | `delete_folder_authorized(id, &actor)`; refuses unless the folder has zero child folders and zero documents | CASCADE: `document_folder_permissions :1386`, `kb_book_owners :1785`. `無指定`: self-parent `document_folders.parent_id :1294`, `documents.folder_id :1295` ∴ SQLite **blocks** a non-empty delete; the domain fn must therefore pre-check and return a named error, never rely on the FK error text | n/a (no owner column) — actor without an admin grant denied | ellipsis + consequence sentence; non-empty case is an explicit error surface, never a silent no-op | 5: non-grantee denied · non-empty folder refused with named error · empty folder deleted · permission rows 0 after delete · `foreign_key_check` empty |
| `issues` `:1271` | **soft** (`archived` — already the only entity with a real filter: `issues.rs:460`, default `i.archived=0`, `include_archived` opt-out `:431-434,:468-480`) | `created_by` NULL-able | `archive_issue_owned(id, &owner)`; the existing default-filter behaviour is preserved, not re-invented | CASCADE: `issue_assignees :1324`, `issue_tracker_links :1018`, `issue_comments :1030`, `issue_activities :1039`, `issue_attachments :1051`. `無指定`: `issue_board_positions :1277`, `issue_tags :1279`, `checklists :1280`, `time_tracking_entries :1282`, `issue_links :1283` ∴ hard delete blocked; **soft** | archive **denied**, surfaced as unowned | ellipsis + consequence sentence | 3: non-owner denied · NULL-owner denied · archived issue absent from default list yet returned with `include_archived` |
| `doc_versions` `:1296` | **no direct delete** — governed only as a child of `documents` | `created_by` NULL-able | none introduced; explicitly frozen with this reason | it is itself a leaf: no table references `doc_versions` (真) | n/a — no delete path exists | n/a | 1: no `delete_doc_version*` symbol exists after 09b (static assertion) |

Total 09b deletion tests = **25** (4+4+4+4+5+3+1). A row whose test count is not met is not accepted. Note: `rename_*` functions do **not** exist anywhere on head (真) ∴ every rename in this contract is new surface, subject to the same `*_owned`/`*_authorized` rule as delete.

Falsifiers (each independent of the cascade code): non-owner delete denied; NULL-owner row hits its tested defined outcome; after a parent delete, child row count is 0 **and** `PRAGMA foreign_key_check` is empty; soft-delete entities assert the row still exists **and** is absent from every list query.

## Ordered atoms — exactly one accepted commit each

| # commit boundary | dependencies | files/contracts | required proof |
|---|---|---|---|
| 01 `spec(route-session-seam)` | base | `src/{App,router,session,runtime,mobile}.ts`, focused tests | current route/runtime inventory; canonical grammar; native no-login regression. Explicitly: on current native base `b0946ec`, inventory and **fix-or-explicitly-freeze** `session.ts:55` (bare `isWeb()` in `own`, ignores the threaded `online` ∴ `ensureDefaults` disagrees with App when a shell passes `online=false`) and `session.ts:83` (`authChecked = !isWeb()` evaluated once at module load, never reacts to a later `online` change) and `session.ts:127` (`export const profileLocked = (): boolean => isWeb();` — third bare call site, 真; default `online=true` ∴ a desktop shell passing `online=false` still reports the profile locked). The inventory is the operative form of this obligation ∴ an unlisted bare `isWeb()` site is silently exempt; all three sites are listed here and each is either threaded or recorded frozen with its reason; assert desktop keeps `createHashAdapter` (`App.tsx:77`); record the `mobile.ts:10 hasTauri = isTauriRuntime` coupling so any `runtime.ts` edit also moves mobile detection. Proof = runtime tests extending `src/session.runtime.test.ts` (added by `b0946ec`): with `online=false` pinned, the desktop mount contains **no** login component **and** issues **no** web-login request, and `profileLocked()` (`session.ts:127`) is asserted false under that same pinned `online=false`; frozen items are recorded as frozen with the reason, not left silent |
| 02 `feat(schema-source-meeting)` | 01 | `src-tauri/src/{db,meetings,documents}.rs`, fixtures/tests | fresh rungs; URL/pair/index; copied-real-DB→migrate→second boot→rollback; transaction/FK |
| 03 `feat(command-authority-parity)` | 01-02 | domain modules, `src-tauri/src/lib.rs`, `src-tauri/src/bin/space-server.rs`, web command map/policy | manifest maps name→identity source→Tauri→handler→policy→dispatch; forged identity/owner denial |
| 04 `feat(theme-palette-contract)` | 01 | token/theme CSS, preference store/tests | five roots/portals; semantic colour; scan rejects blue/literal/gradient/radius/shadow |
| 05 `feat(shell-route-layouts)` | 01,04 | router, `App`, shell/nav components/CSS/tests | chat-first/grouped/flat route parity; More/scoped sidebar; hidden-route screen |
| 06a `feat(date-control)` | 04,05 | product Date/DateTime control + portal, tests | one date control everywhere; portal resolves tokens from page scope; computed background of portal root and page canvas share a lightness family under `deep` (measured, not eyeballed) |
| 06b `feat(confirm-prompt-family)` | 04,05 | dialog/prompt/error/empty/header/action primitives, tests | error ≠ empty; focus trap, Escape, focus return; one primary action per surface; consequence sentence on destructive prompts |
| 06c `feat(menu-anchoring)` | 04,05 | context menu + drawer, tests | menu anchored to trigger rect and flipped inside viewport, asserted with a **real pointer event carrying coordinates** (`element.click()` is not the gate) |
| 07 `feat(project-task-context)` | 02-03,05,06a-06c | workspace/task views, shared form, APIs/tests | inherited context, same fields, list head, owner/scope atomicity |
| 08 `feat(message-work-source)` | 02-03,06a-06c,07 | chat action, drawer, resolver/source links, APIs/tests | Task/Ticket/Date; authorized inherited context; reverse/deleted source; rollback |
| 09 `feat(knowledge-library-filing)` | 02-03,06a-06c | document/folder/library/file APIs/views/tests | shelves/ownership/confirmation; drag/file duplicate/ACL/loud export-upload; `DocumentAccessWrite` named negative test |
| 09b `feat(delete-rename-confirm-family)` | 02-03,06a-06c,09 | `db.rs` + domain delete/rename fns, confirm/prompt dialog wiring, tests | the Deletion contract above, entity by entity: soft/hard decision, `*_owned` signature, cascade/orphan per child table, NULL-owner outcome, `PRAGMA foreign_key_check` empty, soft rows present-but-unlisted, consequence sentence |
| 10 `feat(meeting-date-participants)` | 02-03,06a-06c | meeting/date APIs/views/tests | URL/call distinction; participants; validation/conflict/Join/error; `MeetingParticipantWrite` named negative test |
| 11 `feat(attention-notes-controls)` | 02-03,05,06a-06c,10 | attention, Home/Inbox/badge, notes, settings/tests | one derivative incl threads; notes ACL; visible-destinations; one New meeting |
| 12a `feat(convergence-chat-tasks)` | 04-11,09b | chat, composer, task list/drawer views/CSS | chat+task flows compose 06a/06b/06c primitives; measured DOM/computed-style assertion per surface (no "looks right") |
| 12b `feat(convergence-knowledge-calendar-meetings)` | 04-11,09b,12a | knowledge, calendar, meeting views/CSS | same, for those three surfaces; forbidden-geometry scan green |
| 12c `feat(convergence-settings)` | 04-11,09b,12a | settings views/CSS | proper controls only, no raw JSON/file editor; max-measure is a token, width asserted at ≥2 viewport widths |
| 13 `test(pr10-independent-falsification)` | 01-12c | only tests/evidence ledger | exact gates + adverse/live matrix; no feature code; **plus the mechanical scope-traceability gate**: parse `4b6529d:.pr-stein/live-ui.md` §1-§12 (including §3a and §3b), extract every named UI surface, and assert programmatically against the surface→atom table below that (i) every surface has **exactly one** owning atom, (ii) no surface is unowned, (iii) no surface is claimed by two atoms, (iv) the parsed surface count equals the asserted row count. Eyeballing does not discharge this; a split that drops a surface must fail this gate |

## Scope traceability — `live-ui.md` surface → owning atom (mechanical, gated by atom 13)

Source: `4b6529d:.pr-stein/live-ui.md` §1-§12 including §3a and §3b (真, every §-heading and every named surface read). Asserted row count = **97**; per-atom distribution 12a 15 · 05 12 · 06b 11 · 12b 9 · 11 8 · 10 7 · 06a 7 · 12c 5 · 09 5 · 08 5 · 09b 4 · 07 4 · 04 3 · 06c 2 (sums to 97 by an independent path). Every surface has **exactly one** owning atom; ownership means that atom lands the surface or fails its own proof. Atom 13 parses this table plus `live-ui.md` and fails on any missing, unowned, or doubly-owned surface and on any count mismatch — the prose intent ledger cannot detect those.

| # | § | surface | owning atom |
|---|---|---|---|
| 1 | 1 | icon rail | 05 |
| 2 | 1 | channel sidebar | 05 |
| 3 | 1 | command bar | 05 |
| 4 | 1 | rail More drawer | 05 |
| 5 | 1 | rail create `+` / help button | 05 |
| 6 | 1 | rail unread/attention badge | 11 |
| 7 | 1 | sidebar section head `+` (New channel in scope) | 05 |
| 8 | 1 | conversation search field | 05 |
| 9 | 1 | org switcher | 05 |
| 10 | 1 | nav/canvas palette axes | 04 |
| 11 | 1 | semantic colour roles teal/amber/red | 04 |
| 12 | 2 | Home view | 11 |
| 13 | 2 | PageHeader (kicker/icon tile/title/subtitle) | 06b |
| 14 | 2 | header metric pills | 11 |
| 15 | 2 | `Your month` section head | 11 |
| 16 | 2 | month grid | 06a |
| 17 | 2 | day panel | 11 |
| 18 | 2 | month stepper | 06a |
| 19 | 2 | Home day-panel empty state | 06b |
| 20 | 3 | chat channel view | 12a |
| 21 | 3 | channel topbar | 12a |
| 22 | 3 | pinned/mentions filters | 12a |
| 23 | 3 | Notifications control | 11 |
| 24 | 3 | refresh cadence row | 12a |
| 25 | 3 | chat message list | 12a |
| 26 | 3 | message row | 12a |
| 27 | 3 | composer | 12a |
| 28 | 3 | composer hint line | 12a |
| 29 | 3 | composer tool cluster | 12a |
| 30 | 3 | message hover action row | 08 |
| 31 | 3 | reaction chips | 12a |
| 32 | 3a | `make work` menu (Task/Ticket/Date) | 08 |
| 33 | 3a | task tile context menu | 06c |
| 34 | 3b | WorkItemDrawer | 08 |
| 35 | 3b | drawer Title/Description fields | 08 |
| 36 | 3b | Owner field | 07 |
| 37 | 3b | Contributors field + inline empty state | 07 |
| 38 | 3b | `Due` date trigger | 06a |
| 39 | 3b | `Source` quoted block | 08 |
| 40 | 3b | drawer footer Cancel / Create task | 06b |
| 41 | 4 | DateField portal popup | 06a |
| 42 | 4 | picker month head | 06a |
| 43 | 4 | `Today` button | 06a |
| 44 | 4 | dark-palette portal inheritance case | 06a |
| 45 | 5 | To-Do view | 12a |
| 46 | 5 | To-Do header metrics | 11 |
| 47 | 5 | To-Do action bar (New task / Show done) | 12a |
| 48 | 5 | `Open work` section head + drag hint | 12a |
| 49 | 5 | deadline band heading + count chip | 12a |
| 50 | 5 | task tile | 12a |
| 51 | 5 | TaskRowEdit inline editor | 07 |
| 52 | 5 | TaskRowEdit footer | 09b |
| 53 | 5 | task menu (Open/Postpone/Delete task...) | 06c |
| 54 | 5 | drag-to-file task to sidebar project | 07 |
| 55 | 6 | ConfirmDialog | 06b |
| 56 | 6 | PromptDialog | 06b |
| 57 | 6 | DeleteButton (two-step) | 09b |
| 58 | 6 | destructive ellipsis wording | 09b |
| 59 | 7 | Knowledge library view | 12b |
| 60 | 7 | knowledge action bar | 09 |
| 61 | 7 | SHELVES folder cards | 09 |
| 62 | 7 | DOCUMENTS cards | 09 |
| 63 | 7 | document card menu (Open/Archive/Delete...) | 09b |
| 64 | 7 | drag-to-file document to shelf | 09 |
| 65 | 7 | download / upload path | 09 |
| 66 | 8 | Calendar view | 12b |
| 67 | 8 | calendar action bar | 12b |
| 68 | 8 | view toggle Month/Week/Day/Schedule | 12b |
| 69 | 8 | month grid cell `+` affordance | 12b |
| 70 | 8 | event chip | 12b |
| 71 | 8 | selected-day side column | 12b |
| 72 | 9 | Meetings list pane | 12b |
| 73 | 9 | meetings filter row + quiet search | 12b |
| 74 | 9 | meeting row | 10 |
| 75 | 9 | Meetings filtered-out empty state | 06b |
| 76 | 9 | Meetings detail empty state | 06b |
| 77 | 9 | meeting detail action row | 10 |
| 78 | 9 | meeting form fields incl. MEETING LINK | 10 |
| 79 | 9 | `Room booking` group + Reserve | 10 |
| 80 | 9 | `Participants` group + Invite | 10 |
| 81 | 9 | `Availability` group + Refresh | 10 |
| 82 | 9 | LIVEKIT MEETING block + Join call | 10 |
| 83 | 10 | Settings view | 12c |
| 84 | 10 | NAVIGATION LAYOUT group | 05 |
| 85 | 10 | COLOUR SCHEME group + preview swatches | 04 |
| 86 | 10 | VISIBLE DESTINATIONS group | 11 |
| 87 | 10 | ORGANIZATION group | 12c |
| 88 | 10 | MY CALENDARS group + empty state | 12c |
| 89 | 10 | CONNECTED CALENDARS group + Connect | 12c |
| 90 | 10 | SECURITY / Two-factor group | 12c |
| 91 | 11 | grouped layout | 05 |
| 92 | 11 | flat layout | 05 |
| 93 | 11 | layout switch losslessness | 05 |
| 94 | 12 | EmptyState pattern | 06b |
| 95 | 12 | blogs empty | 06b |
| 96 | 12 | absences empty | 06b |
| 97 | 12 | locations empty | 06b |

## Gates and actual live matrix

Run verbatim in the native worktree; record actual exit/count/log per atom; no foreign claimed count transfers:

```sh
bunx tsc --noEmit
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --bin space-server
```

For changed UI, use isolated native app + copied DB under worktree, non-operator ports, never `/tmp`/operator DB. Drive actions with existing app-tools `/info`, `/eval`, `/console`, `/screenshot`; retain action, DOM, URL, console, shot. The live matrix is **exactly these 7 independent risk cells**, one per failure class — a full palette×surface×layout cross-product (≈1170 cells) is unachievable and an unachievable bar is met by fabrication; palettes re-point base tokens globally ∴ extra surfaces repeat one failure mode:

| # | palette | surface / action | layout | falsifies |
|---|---|---|---|---|
| 1 | paper | Settings · all controls + focus | chat-first | light baseline, blue focus ring, measure/half-width |
| 2 | paper | Chat · message + composer | grouped, then flat | the 3 nav layouts, route preserved across switch |
| 3 | sand | Documents + empty state | chat-first | warm-light canvas tokens, empty pattern |
| 4 | dusk | Chat · message + composer | chat-first | dark canvas × purple chrome contrast |
| 5 | lagoon | Home / calendar | chat-first | light canvas × teal chrome |
| 6 | deep | Chat → drawer → DateField portal | chat-first | portal palette inheritance (measured white-on-dark defect) |
| 7 | paper | task `⋯` + `make work` menu, real pointer event | chat-first | menu anchoring to trigger rect |

Plus **one** web run covering the canonical-URL screen (deep link cold-open, no `#`, `<a href>` in DOM, unregistered URL → explicit not-found) and the no-desktop-login screen. All remaining palette×surface combinations are covered by a **static computed-token audit** (computed CSS custom properties vs the token map, asserted programmatically); that audit may **never** be promoted to a live visual claim. Curl/unit-only is insufficient; an unavailable live case is **UNVERIFIED**.

## Independent falsification / close

| claim | independent falsifier |
|---|---|
| authority | forged actor/profile/owner and cross-owner access/write/delete denied loudly |
| schema/atomicity | old DB, migration collision, duplicate index, second boot mutation, rollback checksum mismatch, per-step injected failure |
| URLs/visibility | deep link/history/modifier click; web hash; web-hidden via URL/search/Goto |
| loud failure | forced folder/channel/source/file error is error+retry, not empty |
| visual/a11y | CSS forbidden-token scan; keyboard dialog/menu/drawer; the 7 risk cells above; portal vs canvas computed-lightness comparison; actual pointer positioning with coordinates |
| deletion | non-owner delete denied; NULL-`created_by` legacy row hits its declared outcome; post-delete `PRAGMA foreign_key_check` empty (path independent of the cascade code); soft-deleted row still present yet absent from every list query |
| exempt policies | payload naming another user under `AbsenceWrite` / `DocumentAccessWrite` / `MeetingParticipantWrite` is denied by the named negative test, not silently rewritten |
| migration | copied real DB → migrate → `user_version` == constant → migrate again → identical `.schema` sha256; pinned `db.rs:2324` fixture updated in the same commit |
| transport/desktop fix | remove each registration leg and make manifest test fail; native proves absent login mount/request |

Harvest supplies broad 73-shot desktop design evidence; review independently witnessed only a small Paper shell/settings slice and its app stopped before full capture. Thus both are inputs/risk screens, neither a completion claim. Native close requires all atoms committed, exact gates green, full native evidence matrix, copied-DB second boot+rollback, adverse tests green, foreign-logic-free diff, and independent review acceptance. Only after that, outside this atom: PR credit comment + native SHA, close without merge, ledger PR→intent→SHA→close.

## Dead / UNVERIFIED

- **Dead:** `delete_project` as a port of foreign intent — killed, projects are soft (`archived`) on head and no product ruling exists; atom 15 as a standalone parity atom — killed, parity is per-atom or it is debt; the full palette×surface×layout visual cross-product — killed as unachievable, replaced by 7 risk cells + static token audit; monolithic atoms 06 and 12 — killed as ungateable, split into 06a/06b/06c and 12a/12b/12c; direct foreign merge/copy; importing foreign migration rungs/counts; hash web routing; client identity; silent fallback; curl-only proof; operator DB; `/tmp`; desktop login mount; reproducing foreign rounded/shadow/gradient/blue defects.
- **UNVERIFIED now:** every native gate, migration, flow, visual matrix and foreign claimed gate/interaction. No claim becomes true before the above independent proof.
