# PARITY.md — gaia-space feature parity matrix (☾shadow-crown gate)

Sources: docs/space-knowledge-base/01→08 (KB) + legacy/flutter/ (legacy). Status ∈ {missing, stub, partial, done}. Evidence = path(s) in src/ + src-tauri/. UI styling exempt by decree — function only.

Baseline gates 2026-08-22 (independent run): tsc=0 · cargo check=0 · bun test 99 pass/0 fail · vite build ✓.

NOTE: KB files' own §Gap-Analysis sections = STALE (written vs old lib/ Flutter era). Every row below re-verified against current src/ + src-tauri/ by audit lane. Rows marked UNVERIFIED until lane evidence lands.

## 01 Git & Code Review (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB01 | UNVERIFIED | |

## 02 Planning / Issues / Boards (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB02 | UNVERIFIED | |

## 03 Packages & CI/CD & Deployments (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB03 | UNVERIFIED | |

## 04 Chat / Documents / Meetings / Calendar (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB04 | UNVERIFIED | |

## 05 Platform / Auth / Permissions (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB05 | UNVERIFIED | |

## 06 Personal / Org (todo, absences, profile) (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB06 | UNVERIFIED | |

## 07 Dev Env / Apps / HTTP API (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB07 | UNVERIFIED | |

## 08 Video Calls / Meet (audit lane: pending)
| feature | src | status | evidence |
|---|---|---|---|
| (lane fills) | KB08 | UNVERIFIED | |

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
