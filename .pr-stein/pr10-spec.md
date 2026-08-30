# PR-Stein #10 · canonical native reimplementation specification

## Authority, credit, boundary

| item | value |
|---|---|
| native base | `b0946ec7c4456ef8e4ba05d9ae30b5dbfe9e35ef` / local `master` |
| idea credit | PR #10, `jzudeml` / `paloptic_JL`, foreign tip `a7ce75c` |
| evidence | `4b6529d:.pr-stein/{pr10-harvest.md,structure-intent.md,live-ui.md}`; `338f912:.pr-stein/pr10-review.md`; 73 durable screenshots in harvest worktree `.pr-stein/shots/` |
| governing law | `~/projects/law/{00-index,ui,testing,data,process,stack,sins}.md`; `~/.gaia/skills/pr-stein/SKILL.md` |

PR #10 supplies an idea and design reference only. At close credit its author and cite the native SHA. Never merge/copy foreign logic, commands, migrations, tests, or snippets. Copyable design/layout/markup/CSS is adapted—not pixel reproduced—to house law: tokens only; flat 1px borders; zero radius/shadow/gradient/hover-lift; no blue accents; bundled fonts; labelled icon controls.

## Standing contract — every atom

- Native base remains authority. TS uses Bun; Tauri stays thin. Values are parameters with defaults, never magic IDs/profiles/ports/routes/timeouts/palette names.
- Server/session determines actor and authoritative organization/project/channel/source; client actor/profile/owner cannot authorize or stamp writes. Missing/denied/not-found renders explicit error/action, never an empty state.
- Every multi-table write is one transaction with FK enabled on every connection; injected failure leaves no partial/orphan row. New tables name FK/cascade/index policy.
- Web URL is canonical path + History API + semantic `<a href>`; no web hash. Deep-link restores project/container. Desktop may adapt internally. Web-hidden/desktop-only views are unreachable through URL, menu, search, and Goto; settings-hidden navigation groups remain reachable only by canonical URL/Goto as product intent says.
- Dialog/menu/drawer: semantic controls, labelled icons, keyboard access, focus trap, Escape, return focus, contrast. Palette root reaches all portals.
- Persist five independent canvas/nav palettes: `paper`, `sand`, `dusk`, `lagoon`, `deep`; teal=action/open, amber=due/waiting, red=critical/blocked, zero=neutral. Components use semantic tokens, never palette-specific branches.
- Preserve `b0946ec` desktop fix: native Tauri does not mount web login/auth UI or issue its web-login request. Desktop and web prove separately.

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

## Ordered atoms — exactly one accepted commit each

| # commit boundary | dependencies | files/contracts | required proof |
|---|---|---|---|
| 01 `spec(route-session-seam)` | base | `src/{App,router,session,runtime,mobile}.ts`, focused tests | current route/runtime inventory; canonical grammar; native no-login regression |
| 02 `feat(schema-source-meeting)` | 01 | `src-tauri/src/{db,meetings,documents}.rs`, fixtures/tests | fresh rungs; URL/pair/index; copied-real-DB→migrate→second boot→rollback; transaction/FK |
| 03 `feat(command-authority-parity)` | 01-02 | domain modules, `src-tauri/src/lib.rs`, `src-tauri/src/bin/space-server.rs`, web command map/policy | manifest maps name→identity source→Tauri→handler→policy→dispatch; forged identity/owner denial |
| 04 `feat(theme-palette-contract)` | 01 | token/theme CSS, preference store/tests | five roots/portals; semantic colour; scan rejects blue/literal/gradient/radius/shadow |
| 05 `feat(shell-route-layouts)` | 01,04 | router, `App`, shell/nav components/CSS/tests | chat-first/grouped/flat route parity; More/scoped sidebar; hidden-route screen |
| 06 `feat(accessible-primitives)` | 04-05 | header/actions/error/empty/dialog/prompt/menu/drawer/date components/tests | error≠empty, focus lifecycle, pointer anchor, all-palette date portal |
| 07 `feat(project-task-context)` | 02-03,05-06 | workspace/task views, shared form, APIs/tests | inherited context, same fields, list head, owner/scope atomicity |
| 08 `feat(message-work-source)` | 02-03,06-07 | chat action, drawer, resolver/source links, APIs/tests | Task/Ticket/Date; authorized inherited context; reverse/deleted source; rollback |
| 09 `feat(knowledge-library-filing)` | 02-03,06 | document/folder/library/file APIs/views/tests | shelves/ownership/confirmation; drag/file duplicate/ACL/loud export-upload |
| 10 `feat(meeting-date-participants)` | 02-03,06 | meeting/date APIs/views/tests | URL/call distinction; participants; validation/conflict/Join/error |
| 11 `feat(attention-notes-controls)` | 02-03,05-06 | attention, Home/Inbox/badge, notes, settings/tests | one derivative incl threads; notes ACL; visible-destinations; one New meeting |
| 12 `feat(surface-convergence)` | 04-11 | calendar/tasks/knowledge/meetings/chat/settings native views/CSS | all ledger flows compose primitives; all law visual/a11y screens |
| 13 `test(pr10-independent-falsification)` | 01-12 | only tests/evidence ledger | exact gates + adverse/live matrix; no feature code |

## Gates and actual live matrix

Run verbatim in the native worktree; record actual exit/count/log per atom; no foreign claimed count transfers:

```sh
bunx tsc --noEmit
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --bin space-server
```

For changed UI, use isolated native app + copied DB under worktree, non-operator ports, never `/tmp`/operator DB. Drive actions with existing app-tools `/info`, `/eval`, `/console`, `/screenshot`; retain action, DOM, URL, console, shot. Matrix: desktop + web; Paper/Sand/Dusk/Lagoon/Deep; chat-first/grouped/flat; shell/Home/chat/task/drawer/knowledge/calendar/meeting/settings/dialog/date/empty/error. Curl/unit-only is insufficient; unavailable live case is **UNVERIFIED**.

## Independent falsification / close

| claim | independent falsifier |
|---|---|
| authority | forged actor/profile/owner and cross-owner access/write/delete denied loudly |
| schema/atomicity | old DB, migration collision, duplicate index, second boot mutation, rollback checksum mismatch, per-step injected failure |
| URLs/visibility | deep link/history/modifier click; web hash; web-hidden via URL/search/Goto |
| loud failure | forced folder/channel/source/file error is error+retry, not empty |
| visual/a11y | CSS forbidden-token scan; keyboard dialog/menu/drawer; contrast and portals in five palettes; actual pointer positioning |
| transport/desktop fix | remove each registration leg and make manifest test fail; native proves absent login mount/request |

Harvest supplies broad 73-shot desktop design evidence; review independently witnessed only a small Paper shell/settings slice and its app stopped before full capture. Thus both are inputs/risk screens, neither a completion claim. Native close requires all atoms committed, exact gates green, full native evidence matrix, copied-DB second boot+rollback, adverse tests green, foreign-logic-free diff, and independent review acceptance. Only after that, outside this atom: PR credit comment + native SHA, close without merge, ledger PR→intent→SHA→close.

## Dead / UNVERIFIED

- **Dead:** direct foreign merge/copy; importing foreign migration rungs/counts; hash web routing; client identity; silent fallback; curl-only proof; operator DB; `/tmp`; desktop login mount; reproducing foreign rounded/shadow/gradient/blue defects.
- **UNVERIFIED now:** every native gate, migration, flow, visual matrix and foreign claimed gate/interaction. No claim becomes true before the above independent proof.
