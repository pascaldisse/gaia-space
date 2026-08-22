# W3 route audit — pre-removal ledger

Scope: desktop `tauri::generate_handler!` at `src-tauri/src/lib.rs:82-376`; UI literal `call()`/`invoke()` scan under `src/**/*.ts{,x}`; tests scan under `**/*test*.{ts,tsx,rs}`.

## Dead desktop registrations

| Route | Registration evidence | UI/test evidence | disposition |
|---|---|---|---|
| `archive_sprint` | `src-tauri/src/lib.rs:201` | no literal UI or test call in audit scope | remove registration |
| `create_project` | `src-tauri/src/lib.rs:146` | no literal UI or test call in audit scope | remove registration |
| `create_review` | `src-tauri/src/lib.rs:245` | no literal UI or test call in audit scope | remove registration |
| `delete_checklist` | `src-tauri/src/lib.rs:212` | no literal UI or test call in audit scope | remove registration |
| `delete_checklist_item` | `src-tauri/src/lib.rs:216` | no literal UI or test call in audit scope | remove registration |
| `delete_planning_tag` | `src-tauri/src/lib.rs:208` | no literal UI or test call in audit scope | remove registration |
| `delete_time_tracking_entry` | `src-tauri/src/lib.rs:219` | no literal UI or test call in audit scope | remove registration |
| `get_issue` | `src-tauri/src/lib.rs:170` | no literal UI or test call in audit scope | remove registration |
| `get_issue_detail` | `src-tauri/src/lib.rs:181` | no literal UI or test call in audit scope | remove registration |
| `get_profile` | `src-tauri/src/lib.rs:132` | no literal UI or test call in audit scope | remove registration |
| `get_project` | `src-tauri/src/lib.rs:145` | no literal UI or test call in audit scope | remove registration |
| `get_role` | `src-tauri/src/lib.rs:151` | no literal UI or test call in audit scope | remove registration |
| `get_team` | `src-tauri/src/lib.rs:136` | no literal UI or test call in audit scope | remove registration |
| `list_job_runs` | `src-tauri/src/lib.rs:316` | no literal UI or test call in audit scope | remove registration |
| `list_jobs` | `src-tauri/src/lib.rs:314` | no literal UI or test call in audit scope | remove registration |
| `project_member_ids` | `src-tauri/src/lib.rs:350` | UI/test use the contract name `list_project_member_ids` | retain through alias; see orphan table |
| `remove_issue_link` | `src-tauri/src/lib.rs:222` | no literal UI or test call in audit scope | remove registration |
| `update_project` | `src-tauri/src/lib.rs:147` | no literal UI or test call in audit scope | remove registration |
| `update_sprint` | `src-tauri/src/lib.rs:198` | no literal UI or test call in audit scope | remove registration |

## Orphan routes

| Route | evidence | disposition |
|---|---|---|
| `add_message_attachment` | UI `src/api/chat.ts:88`; Rust command `src-tauri/src/chat.rs:601`; absent desktop handler | register (1 line) |
| `list_project_member_ids` | UI `src/api/personal.ts:18`; tests `src/views/issues.detail.test.tsx:83`; desktop handler exposes `project_member_ids` at `src-tauri/src/lib.rs:349` | add 5-line Tauri alias to UI contract; retain Rust domain helper/direct callers |
| `connect_space_server` | UI `src/mobile.ts:18`; mobile handler `src-tauri/src/lib.rs:437` | retain: mobile-only handler |
| `open_space_setup` | UI `src/mobile.ts:22`; mobile handler `src-tauri/src/lib.rs:438` | retain: mobile-only handler |

No `PARITY.md` or `reports/parity/*.md` changed.

## Applied result

Removed the 18 confirmed dead desktop registrations. Registered `add_message_attachment`; added `list_project_member_ids` Tauri alias over the existing Rust helper. Mobile-only routes unchanged.
