# STAGE 1 — PURGE orphan proof profiles (space.db @ 151.115.73.182)

## (a) Backup
```
cp /var/lib/gaia-space/space.db /root/gaia-space-backups/space.db.bak-0920-orphan-purge
-rw-------. 1 root root 22843392 Sep 20 17:30 /root/gaia-space-backups/space.db.bak-0920-orphan-purge
```

## Schema check
```
profiles(id TEXT PK, username TEXT UNIQUE, display_name TEXT, email TEXT, avatar_url TEXT,
          external INT, archived INT, created_at INT)
users(id TEXT PK, username TEXT UNIQUE, password_hash, display_name, profile_id TEXT FK->profiles,
      role, active, created_at, global_role)
```
No `zz-proof-%` rows existed in `users` at any point (confirmed both before and after).

## (b) zz-proof-% profiles found: 25

| profile id | username |
|---|---|
| profile-a50e1eb294fe | zz-proof-a-1788550766634-26530e97 |
| profile-45f7c24907fb | zz-proof-b-1788550766634-26530e97 |
| profile-aac421a2c037 | zz-proof-a-1788550859194-8585cc45 |
| profile-32c52a3a65cb | zz-proof-b-1788550859194-8585cc45 |
| profile-7f9e2093feed | zz-proof-a-1788550919050-11335b63 |
| profile-958c16daaecc | zz-proof-b-1788550919050-11335b63 |
| profile-df145a20a0ac | zz-proof-a-1788550978582-d1c1c4e6 |
| profile-13d2ea312faf | zz-proof-b-1788550978582-d1c1c4e6 |
| profile-ac9e55146780 | zz-proof-b-1788551354178-f863fa65 |
| profile-d264ef33b4ed | zz-proof-a-1788551370604-f79df450 |
| profile-4b68218d43ad | zz-proof-a-1788551657975-42c6cb9e |
| profile-f9fa261c6c32 | zz-proof-b-1788551657975-42c6cb9e |
| profile-269c110cd75d | zz-proof-a-1788553906342-046a8b80 |
| profile-27321953fef1 | zz-proof-b-1788553906342-046a8b80 |
| profile-8d81cab2dd22 | zz-proof-a-1788553943433-2542dc16 |
| profile-c1752aad1b2b | zz-proof-b-1788553943433-2542dc16 |
| profile-2edac9d32451 | zz-proof-a-1788553986124-ce85d9f2 |
| profile-9d29557fbec2 | zz-proof-b-1788553986124-ce85d9f2 |
| profile-fd349faa72a9 | zz-proof-a-1788554014394-3ed2aae6 |
| profile-5599c1396365 | zz-proof-b-1788554014394-3ed2aae6 |
| profile-b853718f23bf | zz-proof-a-1788554067216-16facf79 |
| profile-576a9e8a9c65 | zz-proof-a-1788554088788-98e2339f |
| profile-31ab39273b9a | zz-proof-b-1788554088788-98e2339f |
| profile-e6601602b085 | zz-proof-store-member |
| profile-b1dbdd62f863 | zz-proof-naru |

## Dependent counts (all 0 unless noted)

| profile id | team_memberships(profile_id/manager_id) | channel_members | messages(author_id) | meetings(organizer_id/video_ended_by) | meeting_participants | todos(profile_id) | todo_assignees | crm_records(updated_by) | documents(created_by) | users(profile_id) | DELETED |
|---|---|---|---|---|---|---|---|---|---|---|---|
| profile-a50e1eb294fe | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-45f7c24907fb | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-aac421a2c037 | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-32c52a3a65cb | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-7f9e2093feed | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-958c16daaecc | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-df145a20a0ac | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-13d2ea312faf | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-ac9e55146780 | 0/0 | **1** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-d264ef33b4ed | 0/0 | **1** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-4b68218d43ad | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-f9fa261c6c32 | 0/0 | **2** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-269c110cd75d | 0/0 | **3** | 0 | **2**/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-27321953fef1 | 0/0 | **3** | 0 | 0/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-8d81cab2dd22 | 0/0 | **3** | 0 | **2**/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-c1752aad1b2b | 0/0 | **3** | 0 | 0/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-2edac9d32451 | 0/0 | **3** | 0 | **2**/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-9d29557fbec2 | 0/0 | **3** | 0 | 0/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-fd349faa72a9 | 0/0 | **3** | 0 | **2**/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-5599c1396365 | 0/0 | **3** | 0 | 0/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-b853718f23bf | 0/0 | **1** | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | no |
| profile-576a9e8a9c65 | 0/0 | **3** | 0 | **2**/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-31ab39273b9a | 0/0 | **3** | 0 | 0/0 | **2** | 0 | 0 | 0 | 0 | 0 | no |
| profile-e6601602b085 | 0/0 | 0 | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | **YES** |
| profile-b1dbdd62f863 | 0/0 | 0 | 0 | 0/0 | 0 | 0 | 0 | 0 | 0 | 0 | **YES** |

23/25 have dependents (mostly `channel_members`, several also `meetings`/`meeting_participants`) → **left in place, reported here**, not deleted (would orphan FK rows). Only 2 had zero dependents everywhere:
- `profile-e6601602b085` (zz-proof-store-member) — DELETED
- `profile-b1dbdd62f863` (zz-proof-naru) — DELETED

No `users` rows referenced either of these (users_ref=0 for all 25 before deletion), so no `users` row deletion was needed.

## (c) DELETE executed
```sql
DELETE FROM profiles WHERE id IN ('profile-e6601602b085','profile-b1dbdd62f863');
```
Post-check: `SELECT count(*) FROM profiles WHERE id IN (...)` → 0. `SELECT count(*) FROM users WHERE profile_id IN (...)` → 0.

## (d) bun tools/purge-proof-accounts.ts --verify
Run on the box (copied script to /root/, used SPACE_TOKEN from /etc/gaia-space/github-push.env, base_url default 127.0.0.1:8090 where space-server actually listens; deleted the copy after):
```
base_url=http://127.0.0.1:8090 pattern="^(calls-proof|cw-calls|cw-slim|cw-video|cw-inspect|proof-|zz-proof-)|proof|inspect|CW CSS|CW Video Live|CW Slim" min_age_minutes=20 dry_run=true verify=true
total_users=8 matched=0 eligible=0 deferred=0
VERIFY OK: no proof-pattern accounts remain.
```
(This checks the `users`/account layer via the admin API — always clean, since no zz-proof accounts ever existed there; the orphans were `profiles`-only rows.)

## (e) Re-count after purge
- `profiles` matching zz-proof-%: **23** (exactly the dependent-having rows listed above, left intact)
- `users` matching zz-proof-%: **0**

`vault-proof-0917@paloptic.com` — not touched, not matched by any zz-proof pattern.
