# HANDOFF — w11-chat ☀Saraswati

枝=feat/w11-chat·樹=/Users/pascaldisse/projects/gs-w11-chat。

## 完=③scheduled/postponed messages (V116)

SHA列:
- `d9b3a99` db V116 `scheduled_messages`(前lane骸·救出)
- `4afe0b3` V116修正:`thread_of REFERENCES messages(id) ON DELETE SET NULL` + `sent_message_id UNIQUE`(☾Durga審指摘)
- `6a376a9` chat.rs:CRUD + lease式delivery + tests3
- `9075e7c` lib.rs IPC 6命令·space-server policy/ACL/dispatch·`spawn_chat_schedule_ticker`
- `5d1a730`+ PARITY row missing→done·totals再計(done96·missing57)

設計要点:
- intent≠履歴:`scheduled_messages`はmessages外。delivery runが実messages行を挿す。
- **lease**:`UPDATE ... SET status='sent', sent_message_id=? WHERE id=? AND status='pending'` 一文で確保∴二tick同時posting不能。due SELECTは候補列挙のみ、権威は条件付UPDATE。
- 実message id=`sched-{intent id}`(派生·非乱数)∴replay=messages PK衝突で冪等。
- insert失敗→leaseを`pending`へ戻し`error`記録(次tickで再試)。
- edit/cancel=CAS on `pending`·author限定(`owned_scheduled`)。cancel冪等。
- 未来時刻必須(`scheduled_at<=now`拒否)。thread root=同channel実在必須。時刻=UTC epoch秒のみ(UI datetime-localが境界で変換)。
- ticker:`SPACE_CHAT_SCHEDULE_TICK_SECS`(既定30·0/不正=無効)·`SPACE_CHAT_SCHEDULE_TICK_BATCH`(既定`SCHEDULED_TICK_LIMIT_DEFAULT`=100)。
- web ACL:5命令=Session(`bind_session_identity`が`author_id`をsessionへ)+ `schedule_message`はchannel ACL + `Right::PostMessage`。`deliver_due_scheduled_messages`=AppAdmin。
- UI:composer 🕒 → datetime-local + Schedule/Reschedule/Dismiss。pending一覧=Edit/Cancel。

## gate

`cargo test --manifest-path src-tauri/Cargo.toml` ✓ 345+63+1+6+13+2 pass/0 fail。
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ✓。
`bunx tsc --noEmit` ✓ · `bun test` ✓ 204/0 · `bun run build` ✓(chunk-size警告のみ)。
`python3 scripts/parity_totals.py --check` ✓ 356 rows·done96·partial199·stub4·missing57。

## UNVERIFIED

- 実機tickerの走行(env未設定の既定30s経路は未実走)。
- 多client同時deliveryのE2E(lease正しさはunit水準のみ)。
- UI:thread composerからのschedule=未配線(backendは`thread_of`対応済)。sent/cancelled履歴のUI表示無(pendingのみ)。
- attachment付きschedule=未対応(text専用)。mention同送=未対応(delivery時`mention_ids`空)。

## 死枝

- V117追加でFK修正案=死(V116消費者未在·未release∴原地修正で足る)。
- due SELECT→行毎delivery(lease無)=死:二tick重複投稿(☾Durga BLOCK)。
- 乱数message id=死:replayが二重投稿になる。派生idはPKで守られる。
- 失敗時に`status='sent'`維持+error=死:配信されぬまま送信済扱いになる。

## 次

④polls → ⑤paging/link-unfurl。schema要=V117以降を先にPARITY予約。
