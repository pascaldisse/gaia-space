# JetBrains Space — Knowledge Base (Master Index)

Built 2026-07-26. Purpose: inform feature-parity work on **gaia-space**
(`~/projects/gaia-space`, Flutter/Riverpod/Drift clone of JetBrains Space).

## Why this exists / how it was built
JetBrains Space (SaaS dev platform, internal codename **`circlet`**) is dead:
cloud shut down June 1 2025, on-prem container registry (`public.registry.jetbrains.space`,
`registry.jetbrains.space`) also dead (AWS ELB up, zero healthy backends — decommissioned,
not just down). `jetbrains.com/help/space/*` docs are mostly 404 live; recovered via
Wayback Machine where needed. No leaked/mirrored server images exist anywhere (checked
Docker Hub, GHCR, Quay, torrents — nothing).

What *did* survive and became the real source of truth:
1. **The Space Desktop app** (Mac/Windows, last version 2023.1.7 — confirmed via JetBrains'
   own product API, `data.services.jetbrains.com/products?code=SPA`) — turned out to be a
   thin Electron shell (window mgmt/updater/tray only), no product logic inside. Dead end
   for RE purposes, confirmed by extraction not assumption.
2. **The Space Android app** (`com.jetbrains.space`, v2024.4.8/222 in hand, pulled via an
   Aptoide direct-download token after official stores/mirrors gated behind JS) — **this
   was the real find**. Decompiled clean with jadx (98.2% success, 35,972 classes) →
   **21,287 Java files under `circlet/`** at
   `~/Downloads/space-clients/android/jadx-out/sources/circlet/`. Kotlin `@Metadata`
   annotations survive jadx's name obfuscation, so recovered field/class names below are
   **exact, not guessed**.
3. Surviving live docs (`blog.jetbrains.com/space/*`, some `jetbrains.com/help/space/*`
   pages, all of `jetbrains.com/help/space-on-premises/*`) + Wayback snapshots of dead pages.

5 domain workers (ghoul-sonnet) fanned out over decompile + docs + gaia-space's own
`lib/` tree in parallel, each producing one file below.

## Domain files
| # | File | Domain |
|---|---|---|
| 01 | [01-git-code-review.md](01-git-code-review.md) | Git hosting & Code Review (merge requests, quality gates, safe merge, stacked reviews, CODEOWNERS) |
| 02 | [02-planning-issues.md](02-planning-issues.md) | Issue Tracking & Planning (boards, sprints, swimlanes, custom fields, time tracking, checklists) |
| 03 | [03-packages-cicd.md](03-packages-cicd.md) | Package Registry (Maven/npm/NuGet/PyPI/Dart/Container/Composer) & CI/CD Automation & Deployments |
| 04 | [04-collaboration.md](04-collaboration.md) | Chat (`m2`), Documents/Knowledge Base, Meetings, Calendar |
| 05 | [05-platform-auth-permissions.md](05-platform-auth-permissions.md) | Rights/Roles/Permissions, Org/Workspace/Teams, Auth (2FA/tokens/OAuth/invites), on-prem architecture |
| 06 | [06-personal-org.md](06-personal-org.md) | Personal/Org layer: To-Dos, Absences/Vacations, Org Chart/Locations, Member Profiles, Blogs, Notifications+Subscriptions, Global Search, Dashboards |
| 08 | [08-video-calls-meet.md](08-video-calls-meet.md) | Video calls via suitenumerique/meet recon (LiveKit stack, booted+verified) — DECISION: native LiveKit (livekit-client + Rust token mint), meet clone at ~/projects/meet = reference |
| 07 | [07-devenv-apps-api.md](07-devenv-apps-api.md) | Dev Environments (verdict: no build lane — cloud-VM out of scope; devfile/"open in IDE" transferable) & Applications/Extensibility (HTTP API, webhooks, chatbots, UI extensions, SDKs — build AFTER foundations) |

**Completeness (audited 07-26): circlet package census (69 dirs) diffed against files — 11 uncovered feature modules found, all captured in 06; 07 covers Dev Environments + Applications; remainder = infra plumbing, deliberately excluded. KB = feature-complete vs decompile.**

Total: ~1710 lines (01-05) + 06/07/08 supplements of researched material, all citing real decompiled class/field
names or direct doc quotes — no fabricated content (each worker explicitly flagged where a
path/page didn't exist rather than guessing).

---

## gaia-space coverage — aggregate scorecard

| Domain | Coverage | One-line verdict |
|---|---|---|
| Git hosting & Code Review | **~35%** | Has PR/branch-protection/CODEOWNERS/diff basics; missing quality gates, safe merge, stacking, turn-based review, suggested edits |
| Planning & Issues | **~15%** | Kanban exists but conflates Task+Card into one `Project` model; no boards/sprints/swimlanes/custom-fields/tags/filters/time-tracking |
| Packages & CI/CD | **0%** | `pipeline_screen.dart` is a bare `EmptyState` placeholder with a TODO FAB. No models, no services, nothing. |
| Collaboration (chat/docs/meetings/calendar) | **~2%** | "Chat" is a Discord-bot bridge (0% native). Documents = flat mocked CRUD (~10%). Meetings/Calendar/KB: 0%. |
| Platform/Auth/Permissions | **~5%** | Login UI is a shell over `_useMockAuth = true` + a fabricated unsigned JWT. `User.roles` is a free-text string list — no Right/Role/Scope model at all. |

**Overall: gaia-space is a UI-first prototype (~10-15% real feature depth), strongest in
Git/Code Review, essentially empty in CI/CD and Collaboration.**

---

## Cross-cutting architectural findings (apply across ALL 5 domains, not domain-specific)

1. **No persistence anywhere, despite Drift being a dependency.** Every service worker
   checked (`PullRequestService`, `BranchProtectionService`, `AuthService`, `DocumentService`
   pattern) holds state in an in-memory `List`/`Map` singleton. `drift`/`sqlite3_flutter_libs`
   sit unused in `pubspec.yaml`. This is a bigger blocker than any single missing feature —
   nothing gaia-space "has" survives an app restart yet.
2. **No generic Custom Fields engine.** Space treats "priority," "notes," "% complete,"
   deploy-target metadata, KB article fields, etc. all as instances of one pluggable
   `CustomField`/`ExtendedType` system (52 concrete `CFType` implementations in the decompile).
   gaia-space hardcodes each of these as fixed Dart fields on `Project`/`Document`/etc. Any
   parity work should build this engine once, generically, rather than keep bolting on
   fixed columns.
3. **No Right/Role/Scope model.** Every domain that touches permissions (branch protection
   approvals, CODEOWNERS roles, board settings edit rights, document sharing, deploy-target
   ownership) in real Space routes through one shared `Right × RightType(Global/Project/
   Team/Channel/Document/Profile) × Role × TD_Membership` model. gaia-space has zero of
   this — permissions are ad-hoc string comparisons (`role == 'Admin'`) wherever they
   appear at all. This is the single highest-leverage foundational gap (05's own
   priority note says the same for its domain, but it's true system-wide).
4. **Space models conflate what gaia-space over-simplifies, or vice versa, in ways that
   block later feature work if not fixed early:**
   - `Issue`/`Task` should be its own model, not embedded in `Project` (blocks boards,
     sprints, backlog, multi-board membership).
   - `Channel`/`Message` (chat) is entirely separate from anything gaia-space has; every
     other domain (code review discussions, KB article comments, deployment notifications,
     meeting chat) *reuses* the chat channel model in real Space — worth building chat
     first since 4 other domains depend on it existing.
   - Documents/KB/Blog all share one `Document`/`DocumentFolder` record with a
     `DocumentContainerInfo` discriminator in real Space; gaia-space's flat `Document` has
     no container concept, so Documents vs. Knowledge Base vs. per-project docs can't be
     distinguished later without a rework.
5. **Real Space has hard product limits worth knowing before over-building:** CI/CD jobs
   in one script always run in **parallel, no dependency graph** between jobs (max 100
   jobs/script, 50 steps/job, 2h max timeout); deployment target **health-check was never
   shipped** ("Not yet available" even at end-of-life) — not a gap to chase.

## Suggested build order (synthesized across all 5 domains' own recommendations)

1. **Foundational, do first (everything else depends on these):**
   a. Wire Drift persistence for real — nothing else matters if state doesn't survive restart.
   b. Build the Right/Role/Scope/Membership permission model (05's priority note).
   c. Build a generic Custom Fields engine (type/value/constraint/default/ordering).
   d. Extract `Issue`/`Task` as its own model, separate from `Project`.
   e. Build native Chat (`Channel`/`Message`/`Thread`/`Reaction`) — 4 other domains
      (code review discussions, KB comments, deployment notices, meeting chat) hang off it.
2. **Then, in roughly priority order per domain file:**
   - Planning: `Status` record → `Board`/`Column` mapping → Sprints/Swimlanes → Tags/Time-tracking.
   - Code review: Quality Gates → Safe Merge/Dry Run → turn-based review → stacked reviews.
   - Collaboration: Documents folders/hierarchy/sharing/versioning → Knowledge Base layer →
     Meetings → Calendar.
   - Packages/CI: pick one package format (Files or Container) → minimal manual-trigger job
     model → deploy targets with manual status transitions → git-push triggers → self-hosted
     workers.

## Raw material locations (if deeper digging is ever needed)
- Decompiled Android source: `~/Downloads/space-clients/android/jadx-out/sources/circlet/`
  (21,287 files) — canonical, kept clean single copy (the first partial jadx run was
  discarded; this is the full 98.2%-clean second run).
- Original APK: `~/Downloads/space-clients/android/jetbrains-space.apk` (v2024.4.8/222).
- Desktop apps (Electron shells, confirmed no product logic): `~/Downloads/space-clients/
  jetbrains-space-2023.1.7.dmg` + `.exe`, extracted to `JetBrains Space.app/` and `win-app/`.
- On-prem `docker-compose.yml` (v2023.2.0, references dead images, still useful as an
  architecture reference): `~/Downloads/space-on-premises/docker-compose.yml`.
