# Kali·審 — 06 Personal/Org 資料層

基点=`1ab4ca2`; 探査のみ。§= `docs/space-knowledge-base/06-personal-org.md`; parity=`reports/parity/06-personal-org.md`。

## ① 現schema表

|表|現col/constraint|源|
|---|---|---|
|`profiles`|`id PK, username UNIQUE, display_name, email, avatar_url, external=0, archived=0, created_at`|`src-tauri/src/db.rs:655`; Rust payload只 `id/username/display_name/email/archived`: `platform.rs:183-237`|
|`teams` / `team_memberships`|team=`parent_id→teams, channel_id, archived`; membership=`profile_id→profiles, team_id→teams, role_id→roles, lead, manager_id→profiles, since_date/till_date, requires_approval, archived`|`db.rs:656-657`; data access=`platform.rs:183-310`|
|`member_locations`|`id PK, profile_id→profiles, location TEXT, type CHECK Region/Campus/Building/Floor/Room/ConferenceRoom, created_at`; no locations master table|`db.rs:648`; API=`platform.rs:239-310`|
|`todos` / `todo_assignees`|todo=`profile_id→profiles, content, due_date, project_id, done, source_entity_type/id paired, notes, content_kind`; junction PK(todo,profile), cascade todo delete|base=`db.rs:644,706`; access=`personal.rs:35-145,440-500`|
|`absences`|`id, profile_id→profiles, reason_type, date_from/to, approved, created_at, CHECK(to>=from)` + additive `reason_confidential=0, availability='away'`; index dates|base=`db.rs:645,650`; Rust=`personal.rs:455-500`|
|`notifications` / `subscription_settings` / `subscription_scopes`|notification recipient/event/title/body/entity paired/read_at; per-profile event toggle; scope target CHECK org/team/project/location/profile/entity|`db.rs:646-647,651,760-762`|
|`user_preferences`|`profile_id PK→profiles, dashboard_hidden_widgets`|`db.rs:1065-1069`|
|blog surface|`blog_posts`: draft/document, author/profile, team, project, untyped `location_id`, lifecycle; `blog_aliases`|`db.rs:15` (SCHEMA_V15; exact table via `rg`); no FK for `location_id`|
|meeting location|`meetings.location TEXT`; later separate `meeting_rooms`, equipment, bookings—not linked to org locations|`db.rs:694;630-634`|

Migration mechanism: single SQLite `PRAGMA user_version`, one unchecked transaction, ordered `if version < N`, final version stamp; FK enforcement on each connection: `db.rs:185-205,330+`; current `SCHEMA_VERSION=74`: `db.rs:8`.

## ② §06との差分

- Profile: core lacks name parts, language, join/left, suspended/notAMember/externalLight, email status, contacts. Generic `cf_definitions/cf_values` exists (`db.rs:663-664`) but profile personal-data payload/UI未接続。
- Locations: `member_locations` は profile→free-text location assignment、`TD_Location` hierarchy/master, timezone/workdays/address/equipment/map/capacity/channel, date range/map-point/history皆無。`location_id` (blog) と `meetings.location` は孤立文字列。
- Absence: no reason catalog, description/location/category/archive/custom fields/approval actor+timestamp; `approved` bool only。HTTP owner/admin policy exists, lead/delegate workflow無 (`space-server.rs:2709-2760`)。
- Todo: no 1:1 list container, archived status/due time/reminder/typed origin; `done` only。Personal vs project分離なし。
- Profile/search: paged/ranked shared picker, Principal actor, own/other-profile surfaces未資料契約。
- Feed/dashboard: no follow graph; preferences only hidden-widget JSON. Notification scopes have target `location` yet no referential location entity.

## ③ 最小 migration 設計（可逆・非破壊）

`V75` additiveのみ、既存表/col rename/drop禁止；`up`=CREATE IF NOT EXISTS + indexes、`down`（開発rollback専用）=新index→新table逆順DROP。既存 `member_locations` は互換read/writeのまま、移行backfillを強制せず `legacy_location_id` nullable bridge。

```sql
CREATE TABLE locations (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('Region','Campus','Building','Floor','Room','ConferenceRoom')),
 timezone TEXT, workdays_json TEXT, address TEXT, description TEXT, capacity INTEGER,
 map_id TEXT, channel_id TEXT REFERENCES channels(id), archived INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX locations_parent_kind ON locations(parent_id,kind);
CREATE TABLE location_equipment (location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE, name TEXT NOT NULL, PRIMARY KEY(location_id,name));
CREATE TABLE profile_location_assignments (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT, map_point_json TEXT,
 since_date TEXT, till_date TEXT, archived INTEGER NOT NULL DEFAULT 0,
 CHECK(till_date IS NULL OR since_date IS NULL OR till_date>=since_date)
);
CREATE INDEX profile_location_assignments_profile_dates ON profile_location_assignments(profile_id,since_date,till_date);
CREATE TABLE absence_reasons (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, default_availability TEXT NOT NULL DEFAULT 'away', approval_required INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE absence_details (
 absence_id TEXT PRIMARY KEY REFERENCES absences(id) ON DELETE CASCADE,
 reason_id TEXT REFERENCES absence_reasons(id) ON DELETE RESTRICT, description TEXT,
 location_id TEXT REFERENCES locations(id) ON DELETE RESTRICT, category TEXT NOT NULL DEFAULT 'None' CHECK(category IN ('None','RemoteWork')),
 archived INTEGER NOT NULL DEFAULT 0, approved_by TEXT REFERENCES profiles(id) ON DELETE SET NULL, approved_at INTEGER
);
CREATE INDEX absence_details_reason ON absence_details(reason_id);
CREATE INDEX absence_details_location ON absence_details(location_id);
```

次段 (`V76`) profile contacts/status/extended flags; `V77` todo lifecycle/reminder/list; 分割理由=V75の location + absence FK導入を可逆な独立境界に保つ。migration test: V74 fixture→V75, FK violation, cascade, date CHECK, up/down schema round-trip。

## ④ 衝突位點

- `member_locations.location` / `.type` は既存自由文字列+type。新 `locations` と同名不可；旧tableをrename/rebuildすると既存 `platform::list/add/remove_member_location` (`platform.rs:247-310`) と APIを破る。
- `blog_posts.location_id` は既存非FK TEXT：FK追加には table rebuild必要。V75では触れず、dual-read/backfill検証後の専用Vに隔離。
- `meetings.location TEXT` と V66 `meeting_rooms` は既存予約系。`locations.channel_id→channels` と room bookingを混同不可。
- `absences.reason_type` はNOT NULL既存自由文字列。`absence_details.reason_id` を併設し、reason_type削除/NOT NULL変更不可。`approved` bool と `approved_by/at` は二重真実化防止: handlerは同一transactionで details approval更新→`absences.approved` projection同期。
- SQLite FK規則: `ON DELETE RESTRICT` が archived reason/locationの履歴を守る; `CASCADE` は detail/assignment junctionのみ。全接続FK ON (`db.rs:185-205`)。
- HTTP command allow-list+policyは新 command 每件更新必須 (`space-server.rs:1688-1715`); absence read redaction chokepoint (`3938-3957`)を bypass不可。

## ⑤ 死枝

- 死=`ALTER TABLE absences ADD reason_id ... NOT NULL REFERENCES absence_reasons`：既存rows/backfill catalog不明、SQLite制約追加と可逆性を同時に満たさず。
- 死=`member_locations` を `locations` に改名：既存API contract破壊、意味もassignment≠physical-location。
- 死=`locations` だけ先作りして `blog_posts.location_id` FK化：SQLite rebuild +未解決legacy IDで非破壊に非ず。
- 死=absence approvalを既存`approved`のみで保持：承認者/audit §06要件を表現不能。

UNVERIFIED: migration実装/compile/test未実行（任=探査、碼改禁）。
