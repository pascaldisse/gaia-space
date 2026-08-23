# HANDOFF — w11-chat ☀Vishnu

枝=feat/w11-chat·⚓HEAD=<下記SHA>。樹=/Users/pascaldisse/projects/gs-w11-chat。

## 完=②draft永続+typing indicator

SHA列:
- `973a66b` PARITY V115予約
- `c66c4ef` db V115=`message_drafts`+`channel_typing`(表guard·FK CASCADE)
- `760fc5a` chat.rs impl+command·lib.rs IPC·space-server(policy Session+channel ACL+dispatch)
- `568e9ac` UI:`src/api/chat.ts`wrapper·`src/views/Chat.tsx`復元/debounce保存/beat/poll·`Chat.css`
- parity row `Draft persistence and typing indicators` missing→done + totals再計

設計要点:
- draft PK=(channel_id,author_id,thread_key)·`thread_key=''`=channel root(NULL PK重複回避)。空白本文=削除∴clear後の復活無。
- typing=presence beat一行/(channel,profile)。TTL=`TYPING_TTL_SECS_DEFAULT`8s(呼側override可)·読取時に期限切れ掃除∴背景job不要。自分は結果から除外。送信時=即retract。
- UI定数=env上書可:`VITE_CHAT_DRAFT_SAVE_MS`600·`VITE_CHAT_TYPING_POLL_MS`3000·`VITE_CHAT_TYPING_BEAT_MS`4000。
- web ACL=`bind_session_identity`が`author_id`/`profile_id`をsessionへ書換 + channel ACL照合。

## 次

③scheduled→④polls→⑤paging/link-unfurl。schema必要時=V116以降を先PARITY予約。

## gate

`cargo test --manifest-path src-tauri/Cargo.toml` ✓ 342+61+6+13+2 pass/0 fail。
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ✓。
`bunx tsc --noEmit` ✓。
`bun test` ✓ 201/0。
`bun run build` ✓ (chunk-size warningのみ)。
`python3 scripts/parity_totals.py --check` ✓ 356 rows·done95·partial199·stub4·missing58。

## UNVERIFIED

実機(desktop/web)でのdraft復元・typing表示の目視。多クライアント同時typingのE2E。thread composer側のdraft永続=未配線(backendは`thread_key`対応済·UIは channel root のみ)。

## 死枝

- draft/typingをmessages表の列で持つ案=死(履歴でない·archive/pin索引を汚す)。
- typingをWS/eventで押す案=死(現行に汎用push transport無·polling既存パターンに合わせた)。
- `thread_key` NULL許容PK=死(SQLiteはPK内NULLを相異と扱いroot draftが重複する)。
