# STAGE 2 — cascade-purge 23 remaining zz-proof-% profiles (space.db @ 151.115.73.182)

Backup: `cp space.db /root/gaia-space-backups/space.db.bak-0920-cascade-purge` — 22843392 bytes, `PRAGMA integrity_check` = ok (before AND after).
T = 23 profiles left in place by STAGE1 (`proof/sweep-0920/STAGE1-purge.md`) because they had dependents. Confirmed fresh: `SELECT count(*) FROM profiles WHERE username LIKE 'zz-proof-%'` = 23, exact id match vs STAGE1's dependent table.

## Step 2 — every table referencing profiles (65 declared-FK + named-column pairs checked, `proof/purge-0920/02-count-all.sql|.txt`)
Non-zero against T (STAGE1 only checked team_memberships/channel_members/messages/meetings/meeting_participants/todos/todo_assignees/crm_records/documents/users — missed 3):
| table.column | count |
|---|---|
| channel_members.profile_id | 53 |
| private_feeds.profile_id | 23 | ← not in STAGE1's table
| notifications.recipient_id | 33 | ← not in STAGE1's table
| read_state.profile_id | 19 | ← not in STAGE1's table
| meeting_participants.profile_id | 20 |
| meetings.organizer_id | 10 |
All other 59 pairs (absences, messages, todos, crm_records, documents, users.profile_id, team_memberships, issue_*_legacy, applications, etc.) = 0.

## Step 3 — orphan channels/meetings (`proof/purge-0920/04-channels-full.sql|.txt`, `05-orphan-channel-refs.sql|.txt`)
38 channels touched by T members (23 `private-feed:profile-*` own-feed channels + 4 `zz-proof-call-*` DMs + 6 `zz-proof-channel-*` DMs + 5 `zz-proof-http-*` DMs). **All 38 are 100% orphan**: `total_members == T_members` on every one, `messages.author NOT IN T` = 0 for every one, and I cross-checked every OTHER table with a `channel_id`→`channels` FK (message_drafts, message_polls, channel_notes, channel_notification_preferences, channel_subscriptions, channel_typing, review_discussions, reviews, document_discussions, scheduled_messages, thread_channels, locations) = 0 rows against these 38 channel ids. All 10 meetings: organizer_id ∈ T, both participants ∈ T, channel_id ∈ the 38. **Nothing referencing T touches a real user, real channel, or real project — no exceptions found, nothing withheld.**

## Step 4 — cascade delete (`proof/purge-0920/06-cascade-delete.sql`, exact SQL run via scp'd file, one `BEGIN IMMEDIATE ... COMMIT`)
Children-first order, deleted counts:
| table | deleted |
|---|---|
| read_state | 19 |
| meeting_participants | 20 |
| meetings | 10 |
| notifications | 33 |
| message_attachments | 0 |
| messages | 33 |
| channel_members | 53 |
| private_feeds | 23 |
| channels | 38 |
| users (profile_id∈T) | 0 |
| profiles | 23 |
Post-transaction re-count of all 11 targets = 0 (`06-cascade-delete-output.txt`). `PRAGMA foreign_key_check` after = **not empty**, but identical set of violations exists in the pre-purge backup (`space.db.bak-0920-cascade-purge`) — diffed byte-for-byte same list. These are pre-existing, NOT caused by this transaction:
- `project_members` rowid 20 → profile-b1dbdd62f863 (`zz-proof-naru`, one of STAGE1's own 2 deletes — STAGE1 deleted the profile row but didn't cascade `project_members`)
- `private_feeds` rowid 9,10,11,12,13,14,15,16,17,19-38 (26 rows) → dangling profile_id/channel_id from older, unrelated already-deleted accounts (not zz-proof-a/b pattern, pre-date this lane)
- `issue_statuses` rowid 20,21,22 → dangling project ref, unrelated to profiles entirely
Out of scope for this task (not referencing the 23-profile T set); reported for P, not touched.

## Step 5 — verify
- `profiles` matching `zz-proof-%`: **0**
- every table from step 2: **0** rows referencing T (see step 4 table)
- `bun tools/purge-proof-accounts.ts --dry-run true --verify` on box (PURGE_TOKEN=$SPACE_TOKEN from `/etc/gaia-space/github-push.env`, base_url 127.0.0.1:8090, script copied then removed): `total_users=8 matched=0 eligible=0 deferred=0` / `VERIFY OK: no proof-pattern accounts remain.` — identical to STAGE1's baseline.
- `curl -s -o /dev/null -w '%{http_code}' https://paloptic.com/space/vault/alive` = **200**
- `systemctl is-active gaia-space` = **active**; `PRAGMA integrity_check` = **ok**
- Login check: created ephemeral GlobalAdmin account `verify-purge-0920` via admin API (POST /api/users with PURGE_TOKEN), `bun run shot --login` → `proof/purge-0920/after.png`. **SAW**: sidebar renders full real workspace — GAIA Organization header, channel groups FUNDINGS (EXIST, Funding-General, room-link-live-proof), GAIA SPACE (Gaia Space), PALOPTIC ACADEMY (Academy, Paloptic Academy), THE MVP (MVP Talk), OTHER CHANNELS (Founders Chat, Fundings, Ideas, LOI Page, Website, gaia, pushes...), Home view with calendar/tasks widgets. **Zero zz-proof-/ghost/duplicate channels or DMs visible anywhere in the list.**
- Cleanup: deleted `verify-purge-0920` user via `DELETE /api/users/<id>` → `{"ok":true}`. Found the API delete does NOT cascade (leaves orphan `profiles` row) — same defect class as the pre-existing STAGE1 leftover above. Since I caused this one, cleaned it fully myself (`07-cleanup-verify-account.sql`: 0 deps, deleted profile+its private-feed channel). Post-check: profile gone, `foreign_key_check` back to the same pre-existing baseline only.

## UNVERIFIED
- Whether `DELETE /api/users` never cascading `profiles`/`private_feeds`/`project_members` is a known/ticketed server defect — not investigated, flagged only.
- Root cause/age of the 26 dangling `private_feeds` rows and 3 `issue_statuses` rows unrelated to any zz-proof pattern — not investigated (out of task scope).
