# ☀Surya探査報 — §06 personal/org · 前端+API面 (Members/Profile)

枝 `explore/s06-surya` · 基 `1ab4ca2` · 只探査·碼改零。
範囲=Members/Profile関連 component·route·store·API client + bridge/。
真=読了実測。假=設計提案。

---
## ① 現存機能表(路徑:行)

### API client 層
|機能|路徑:行|備|
|---|---|---|
|`Profile` 型 = id/username/display_name/email/archived|`src/api/platform.ts:2`|5欄のみ|
|`MemberLocation` 型 = id/profile_id/location/location_type|`src/api/platform.ts:5`|文字列location(参照非)|
|`Team`/`TeamMembership`/`Role`/`Right`/`RoleAssignment` 型|`src/api/platform.ts:6-18`|membershipに `manager_id`·`lead`·`since/till_date` 有|
|profiles/createProfile/updateProfile|`src/api/platform.ts:39-41`|`get_profile` は Rust 有(`src-tauri/src/platform.rs:76`)·client未曝|
|memberLocations/addMemberLocation/removeMemberLocation|`src/api/platform.ts:42-44`||
|teams/memberships/roles/rights/assignments/checkRight|`src/api/platform.ts:46-79`||
|CF engine (定義CRUD·値get/set)|`src/api/platform.ts:105-115`|`entity_type` 汎用·profile値未使用|
|CfType に `profile`/`profile_list`/`team`/`location`/`contact`/`contact_list`|`src/api/platform.ts:20`|contact型は既に語彙内|
|invoke単一口 `call()`|`src/api/platform.ts:26`|Tauri invoke·web は `/api/cmd/{command}`|

### View / component 層
|機能|路徑:行|
|---|---|
|Members画面(3欄:People/Teams/Membership)|`src/views/Members.tsx:1-538`|
|profile作成·編集form(display_name/username/email のみ)|`src/views/Members.tsx:71-112`(節2)|
|archive/restore toggle|`src/views/Members.tsx` `archiveProfile`·行169-175|
|directory検索(name/username/email 部分一致)|`src/views/Members.tsx:177-186`, UI `:67`|
|position filter(role名 via memberships)|`:172-175`,`:183`,UI`:68`|
|location filter|`:176`,`:184`,UI`:69`|
|location付与UI(profile+名+6型select)|`:113-119`|
|deep link `profile` → 編集form開く|`:218-232` + `src/router.ts` entityRoutes `profile→Members/profiles`|
|team CRUD·membership add/remove(role付)|`:181-336`|
|Avatar=名前由来イニシャル(画像無)|`src/components/Avatar.tsx:19-45`|
|profile picker(全件·非paged)|`src/components/Pickers.tsx:22-30`|
|自己同一性 store(profileId·web=自account固定)|`src/session.ts:12-60`|
|Users画面(login account ↔ profile束ね·admin/web専)|`src/views/Users.tsx:1-186`|
|Settings=nav/2FA/token/calendar のみ(個人profile編集無)|`src/views/Settings.tsx:1-139`|
|nav: Members/Users/Admin/Applications/Settings = "Organization"群|`src/nav.ts:19`|

### 保存層(API契約の上限)
|事実|路徑:行|
|---|---|
|`profiles` 表に **`avatar_url`·`external`** 列存在(型/API/UI未曝)|`src-tauri/src/db.rs:655`|
|`member_locations` = id/profile_id/location/type/created_at のみ|`src-tauri/src/db.rs:648`|
|web command allow-list(policy)|`src-tauri/src/bin/space-server.rs:1688,1817,1934`|
|web dispatch表|`src-tauri/src/bin/space-server.rs:4147,4270`|
|`/api/cmd/{command}` route|`src-tauri/src/bin/space-server.rs:4567`|

### bridge/
真=`bridge/` は `room-link` + `telegram` の二つのみ。`bridge/telegram/space.ts`(37行)に profile/member/avatar 語 **零**。
∴ **§06 Members/Profile に該当する bridge endpoint は存在せず**。web API面の実体=`src-tauri/src/bin/space-server.rs` の `/api/cmd`。
死枝:`bridge/` に profile endpoint 追加 → 因=bridgeは外部chat橋であり本layer無関係。

---
## ② 欠落(§06 §4 Member Profile Depth 要求比)

|KB要求|現状|欠落度|
|---|---|---|
|`TD_ProfileName` firstName/lastName 分離|`display_name` 単一|欠|
|avatar/smallAvatar/profilePicture|列 `avatar_url` 有·型/API/UI無|半欠(配線のみ)|
|`languages: List<TD_ProfileLanguage>`·`speaksEnglish`|無|欠|
|`joined`/`leftAt`/`suspended`/`suspendedAt`/`notAMember`|無(`archived` のみ)|欠|
|`external` 旗|列有·型/API/UI無|半欠(配線のみ)|
|4状態分離(suspended≠notAMember≠external≠archived)|1状態に潰れ|欠·KB§4.3明示警告|
|personal-data = CF値(birthday/gender/bio)|CF engine有·profile entity未使用|半欠(利用のみ)|
|`ProfileEmailStatus`(検証状態)|email文字列のみ|欠|
|ContactMessenger(7 protocol + deep link)|無。但CfType `contact` 語彙有|欠|
|自profile編集画面 vs 他者read-only tab viewer|admin風単一編集form(`Members.tsx:71-112`)·両者兼用|欠|
|shared paged batch source + ranking(`WeightedProfile`)|`profiles()` 全件·client側filter|欠(paging/ranking)|
|Principal 抽象(member/app/external)|profile直結|欠|
|directory filter Position+Location|**有**(`Members.tsx:172-186`)|済|

---
## ③ 最小実装設計(前端/API層のみ·後端は別lane)

### 假A. 型拡張(1 commit)
`src/api/platform.ts:2` の `Profile` へ既存列を曝すのみ:
```ts
export type Profile = { id; username; display_name; email: string|null;
  avatar_url: string|null; external: boolean; archived: boolean };
```
∵ 列は既に `db.rs:655` に在る → Rust側 `platform.rs:53-99` の SELECT/UPDATE 欄追加だけで前端が乗る。新表不要。

### 假B. 状態4分(1 commit)
列追加 `suspended`·`suspended_at`·`not_a_member`·`joined`·`left_at`(`db.rs` SCHEMA新版)→ `Profile` 型 → `Members.tsx` list 表示を pill 化(Archived/Suspended/External/Left)。UI=既存 `classList={{archived}}`(`:137`)を `classList={{archived, suspended, external}}` へ拡張。

### 假C. Profile 詳細画面(最大の欠落·2 commit)
- 新 component `src/views/Profile.tsx`。route は **新規追加せず** 既存 `profile→Members/profiles`(`src/router.ts` entityRoutes)を再束ね:`Members.tsx` の deep-link handler(`:218-232`)を「編集form開く」から「詳細panel描画」へ差替。
- panel tab = About(CF値) / Teams(`memberships(undefined, profileId)`) / Locations / Contacts。
- 自分(`session.profileId()` 一致)なら編集可·他者なら read-only → KB§4.3 の二画面差を一component内 `editable()` memo で満たす(最小)。

### 假D. personal-data = CF(0新API·1 commit)
既存 `cfGetValues("profile", id)` / `cfSetValue` を Profile画面 About tab に配線。新backend命令零。birthday/gender/bio は CF定義として Admin から作られる → KB§4.3 の「hardcoded列にするな」を満たす。

### 假E. Contacts(1 commit)
最小=CF `contact_list`(既存 CfType `:20`)で messenger contacts を保持し、前端で `protocol:login` を解析して deep-link URI を組む小helper `src/contacts.ts`。専用表/命令を作らぬのが最小。
死枝:専用 `profile_contacts` 表+4命令 → 因=CF engine が既に同義·二重engineはKB§6.3の反省に反す。

### 假F. paged/ranked member search(1 commit·API層)
新命令 `search_profiles(term, limit, offset)` → `platformApi.searchProfiles` → `Pickers.tsx` と `Members.tsx` 検索欄が共用。allow-list `CommandPolicy::Session` 追加必須(下記④)。

順序=A→B→D→C→E→F(A/B/Dが土台·Cが器)。

---
## ④ 衝突位點

1. **view名 `Profile`** — `src/router.ts` の `entityRoutes.profile = {view:"Members", segment:"profiles"}`。新view名 "Profile" を `registerViews`(`src/App.tsx:66`)に足すと slug `profile` と segment `profiles` が近接·`slugToView[segment] ??=` の既定を踏む恐れ。∴ 新viewを立てず Members内 panel が安全(假C採用理由)。
2. **`Members` vs `Users`** — `src/views/Users.tsx` は login account 管理(`users` 表)、Members は `profiles` 表。命名衝突は既存·語彙混乱源。新UIは "Member profile" 語で統一。
3. **web allow-list 二重門** — 新命令は `src-tauri/src/bin/space-server.rs:1817/1934` 近傍の policy match と `:4147/4270` の dispatch 表 **両方** 登録要。片方漏れ=web で沈黙失敗(Tauriでは動く)→ 検出困難。
4. **`profileId` store の web固定** — `src/session.ts:44-50` は web で常に自account profile へ強制。自profile編集UIは `profileId()` を信頼可、但 desktop は自由選択 → 「自分」判定は `isWeb() ? currentUser().profile_id : profileId()` を要す。素朴に `profileId()` 比較すると desktop で他者profileを自分と誤認。
5. **`MemberLocation.location` = 自由文字列** — 假 §3 の `TD_Location` 参照型を後で入れる lane と衝突。`location_type` の CHECK制約は既に `db.rs:648` に有り 6型固定 → 参照化時は表移行要。今回は触らぬ。
6. **`Profile` 型が全view横断** — `session.ts`·`Pickers.tsx`·`TaskMeta.tsx`·`Goto.tsx` 等が import。欄追加(假A)は非破壊だが、欄 **改名**(display_name→name構造体)は横断破壊 ∴ 却下。

---
## ⑤ 死枝+因
- 死:bridge/ に profile endpoint → 因=bridge=telegram/room-link のみ·本layer無関係(真:`space.ts` に語零)。
- 死:新 top-level route `/profile/:id` → 因=③衝突1·既存 `profiles` segment と二重。
- 死:専用 contacts 表 → 因=CF engine 重複(④·KB§6.3 idiom)。
- 死:`display_name` を firstName/lastName へ分解 → 因=横断型破壊·利得小。表示名は保持し、名/姓は CF で足すのが最小。
- 死:avatar 画像upload → 因=前端範囲外(blob storage無)·`avatar_url` 文字列曝しで足る。

---
## 未驗(UNVERIFIED)
- 碼未実行·gate未走(任=只探査)。行番号は読了時点 `1ab4ca2`。
- `src-tauri/src/platform.rs` の SELECT 欄が `avatar_url`/`external` を含むか未精査(型に無いので恐らく非選択)→ 假A実装lane が確認要。
