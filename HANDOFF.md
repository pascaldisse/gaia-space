# HANDOFF — w11-chat ☀Ganga

枝=feat/w11-chat·樹=/Users/pascaldisse/projects/gs-w11-chat。

## 完=④polls (V117)

SHA列:
- `043179a` PARITY:V117予約(先行)
- `ad32d82` db V117 三表 + chat.rs core(create/vote/close/get/list)+tests3
- `55b1ec5` lib.rs IPC 5命令·space-server policy/bind/ACL/dispatch+test1
- `41b360b` src/poll.ts + src/api/chat.ts wrappers + Chat.tsx composer/card + tests6
- `133f77c` PARITY row分割:polls→done · stickers/saved=missing残。totals再計(357行·done97)

設計要点:
- poll=**運ぶmessageの内容**:`message_polls.message_id UNIQUE REFERENCES messages(id) ON DELETE CASCADE`∴message死→poll死。message id=`poll-{poll id}`(派生)。作成=message+poll+options 一txn。
- content_kind=`poll`(message text=question)。ACL/read-only検査=`create_message_impl`が担う(重複実装せず)。
- option=行(blob非)∴票はFKでoption指名。`vote_poll_impl`は該option所属pollを実測検証→他poll集計への注入不能。
- 票=`PRIMARY KEY(poll_id,voter_id,option_id)`。投票=同txnで**先に自票全削除→再挿入**∴単選が積み上がらぬ·空ballot=撤回。単選+2option要求=拒否。
- close=author限定 CAS on `closed_at IS NULL`∴再試行が締切時刻を動かさぬ。closed→投票拒否。
- 読=集計のみ:`options[].vote_count`+`me_voted`(読者自身)+`voter_count=COUNT(DISTINCT voter_id)`。個票非返∴匿名/非匿名問わずAPIから誰が何に投じたか復元不能。turnout=人数(票数非)。
- web:5命令=Session。`bind_session_identity`に`voter_id`追加(polls専用語)∴他人名義の投票不能·`author_id`既存binding∴他人名義close不能。`create_poll`=channel ACL+`Right::PostMessage`。vote/close/get=`chat_poll_channel`でserver側にchannel解決(caller提供channel_id不信)。
- UI:composer 📊 → question+option行(add/remove·multiple/anonymous)。card=message行内、bar幅=`optionShare`(**電子数割**∴多選は合計>100%可)、author のみ Close。

## gate

`cargo test --manifest-path src-tauri/Cargo.toml` ✓ 348+64+1+6+13+2 pass/0 fail。
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ✓。
`bunx tsc --noEmit` ✓ · `bun test` ✓ 210/0 · `bun run build` ✓(chunk-size警告のみ)。
`python3 scripts/parity_totals.py --check` ✓ 357 rows·done97·partial199·stub4·missing57。

## UNVERIFIED

- 多client同時投票のE2E(txn正しさはunit水準のみ·実並行未走)。
- UI実描画=未実機(card/composerはunit水準の論理のみ·`src/poll.ts`テスト済、TSX描画は未テスト)。
- 匿名flagはUI表示差のみ:読モデルが元より個票を返さぬ∴backend差は無し(意図)。列は将来の個票公開機能の為に保持。
- thread内poll=未配線(root channelのみ)。poll付きscheduled message=未対応。poll編集(option追加/文言修正)=未実装(closeのみ)。

## 死枝

- poll=独立entity(message外)=死:chat履歴に現れぬ内容になる。KB`M2PollContent`は内容型。
- option=JSON blob列=死:票がindex参照になり、後の編集が黙って票を付け替える。
- 単選をUNIQUE(poll,voter)で強制=死:多選と同表を共有できぬ∴PKは三つ組·単選は同txn削除で保証。
- vote時にcaller提供`channel_id`を信用=死:他人のpollを自分の読めるchannel名と対にできる。∴`chat_poll_channel`でserver解決。
- 個票列挙API(`list_poll_votes`)=死:匿名pollの匿名性がAPI一本で消える。集計のみ返す。

## 次

⑤paging/link-unfurl。schema要=V118以降を先にPARITY予約。stickers/saved messages+labels=missing残(同KB行)。
