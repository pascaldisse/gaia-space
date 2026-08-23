# HANDOFF — w10-cicd lane (L2 ☀Vishnu → successor)

枝 `feat/w10-cicd` · worktree `/Users/pascaldisse/projects/gaia-space-w10-cicd`
HEAD at handoff = `15e9528`
主樹 `/Users/pascaldisse/projects/gaia-space` = `d28b1f0` · clean · 不觸

## atom1 目標(親令)
非manual triggers(push/schedule/etc) + pipeline DSL。

## 着地済(SHA順)
- `5937713` Rust: TriggerDef 7變(tagged, wire tag = **variant名**, rename_all無し) · glob_match · CronSpec 5欄(POSIX dom∪dow, next_after 有界) · StepDef{Shell|Container} · trigger_pipeline_event() 一本化 · due_scheduled_runs(now) poll式
- `7fa02d7` wire tag を Rust 側で文字列固定 + glob/cron 境界
- `395e81d` TS を実wire tagへ(PascalCase) · steps 単数 `script` · scriptDefErrors() = parse_and_validate_script の鏡
- `6500ba3` schedule_fired 純関数抽出(watermark edge)
- `b4c2a0b` validator parity 穴埋め
- `5db0d12` 配線: lib.rs command登録 · space-server dispatch · triggerPipelineEvent/dueScheduledRuns · Pipelines.tsx
- `f2f7d74`/`79e7fe1` HTTP層dispatch試験の**先例**(binary spawn + 実HTTP) + defect pin
- `9a83902` container step を editor往復で保持 · 復元不能なら save阻止
- `31546cc` schedule ticker(opt-in env) + editor warnings
- `baef682` 権限昇格の赤釘
- `03c4d29` policy 二層分割(event=PipelineScriptWrite / due=AppAdmin) + 不正 TICK_SECS で ticker 無効化+警告
- `70c8dee` script create/update/delete に project域ACL · **V64 migration**: `job_runs.fired_minute` + partial unique index `(job_id, fired_minute) WHERE fired_minute IS NOT NULL` = schedule の原子予約(manual/event は NULL ∴ 連打自由)
- `15e9528` 敵対審: 緑化=真の検証 + 巻込/migration/偽装project_id 攻撃 + 下記赤釘

## 未解決の赤釘(最優先)
**[HIGH] 読権が任意shell実行権に化ける** — `src-tauri/tests/pipelines_dispatch_http.rs:733`
`a_read_tier_project_member_reaches_arbitrary_shell_execution` = RED(実測·marker檔が実生成)
因: `PipelineScriptWrite` も `trigger_pipeline_event` も述語が `project_readable`(admin|owner|member)。読層述語を実行権に費している。
要: 書込/実行層述語(owner or 明示grant)。先例 = `package_repository_acl` の WRITER/MANAGER, §`space-server.rs:520`。
直ったら UI も追従要(`Fire event` は現在 member に露出)。

## 次atom候補
1. 上記赤釘を潰す(建=`space-server.rs`)。
2. `due_scheduled_runs(now)` は caller 供給の `now` を fired_minute に使う ∴ 異なる now で同一cron発火を複数分に散らし重複予約できる**疑**(攻撃面は AppAdmin 限定)。
3. Container step の**実行器**(現在は保存可·実行時 FAILED で安全拒否)。
4. `bunx tsc --noEmit` の既存赤2件(`Object.hasOwn` lib設定 / never絞込) — 本lane以前からの債務。
5. `space-server.rs:2280-2298` の一行200字超を **path限定**整形。

## 死枝台帳(骸+理由)
- 常駐cron daemon新設 → poll `due_scheduled_runs` + opt-in server tick へ
- serde untagged 一括 → 誤變推論·誤差エラー不明瞭
- 名前付cron(`@daily`,`MON`) → 未実装·明示err
- Rust側を snake_case へ改名 → 保存済 script source を破壊する
- container 保存拒否(b案) → 既存script編集の全面凍結
- in-process handler試験 → `cmd`/`arg`/`command_policy` は binary crate 私有 → spawn+実HTTPへ
- 「2並行で足る」→ 8並行·80µs重畳でも重複零。窓は db::conn の open+migrate に呑まれる → 32並行×6round
- 「重複発火は推論で足る」→ 実測再現した ∴ 推論不要
- 「INSERT OR IGNORE は行のみ排除、実行threadは二重に走る」→ `pipelines.rs:1588` の `continue` が `thread::spawn` の前 ∴ 真の原子予約
- master 直commit 経路 → 律違反。骸 = 主樹の `salvage/w10-cicd-wiring` 枝(3d8f385 は劣化重複ゆえ廃棄、6869386 は配線として書き直し済)

## 未驗台帳(UNVERIFIED)
- UI 実機操作(型+build緑のみ)
- Container step の実行器(未実装·安全拒否のみ)
- `env` map の tauri invoke 実往復
- 複数**process**/replica 跨ぎの重複(SQLite一意indexで防がれる筈·未実測。試験は単一process内thread並行のみ)
- `run_id` = `job_id::run-{now_nanos}` の衝突可能性
- 指摘2(caller供給 now による重複予約)

## 陣法·家法(必ず継承)
- 子対 = 正確に2(naru-opus + naru-kimi)。round毎に建⇄審 交代。神名も交代(Brahma/Kali → Surya/Durga → 次)。
- 領分固定で同檔衝突を避ける: **建** = `src-tauri/src/**` + `src/api/pipelines.ts` + `src/views/**` / **審** = `src-tauri/tests/**` + `src/**/*.test.ts`。
- 審は欠陥を**先に赤試験**で固定し、修正は建へ差戻す。
- 三律(全て実際に破られた。毎回明記せよ):
  1. 主樹 `/Users/pascaldisse/projects/gaia-space` に commit 絶対禁。毎令 `cd` + `git rev-parse --show-toplevel` 確認。
  2. `cargo fmt` を crate 全体に掛けるな(lane外 M を量産する)。触檔のみ `rustfmt <path>`。
  3. lane外 M を理由に commit を諦めるな。**path限定 `git add`** で必ず commit。自制で lane を殺すな。
- 不誑: 未測は必ず UNVERIFIED と書く(子が二度「未驗=無」と過大申告した)。
- 親は子報を盲信せず、赤→緑は **試験檔の diff が空である事**を自ら確認して真偽を判定せよ。

## gate(handoff時点·`15e9528`)
```
cargo test --lib                          : 287 passed; 0 failed
cargo test --test pipelines_dispatch_http : 12 passed; 1 failed  ← 赤=上記HIGH釘(意図的)
bun test                                  : 182 pass; 0 fail (32 files)
bun run build                             : green
```
