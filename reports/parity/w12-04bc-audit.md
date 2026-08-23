# §04(b)(c) audit — thread scheduled/paging UI · article comment channel

lane: feat/w12-chatdocs · base 72cc7c2 · 神名 ☀Brahma(建)
scope: 監査のみ。碼未改。

## (b) thread scheduled / paging UI

背骨=既存。缺=UI結線のみ。

- 背骨真:
  - `src-tauri/src/chat.rs:1112,1120` `schedule_message_impl(thread_of)` + `validate_scheduled_thread` (同channel強制)
  - `src-tauri/src/chat.rs:709,718` `list_messages_page_impl(thread_of)` — per-thread keyset paging有
  - `src/api/chat.ts:207-226` `scheduleMessage({threadOf})` 受口有 · `:173-179` `listMessagesPage({threadOf})` 有
  - `src/messagePaging.ts` 純関数(ticket/merge/order) — thread再利用可
- 缺(真, UI):
  1. `src/views/Chat.tsx:425` — `scheduleMessage` 呼出に `threadOf` 不渡し ⇒ thread内schedule不能(root専用)
  2. `src/views/Chat.tsx:372-449` schedule panel = root composer専属。thread pane(`:481-` threadDraft系)に無
  3. `:392-403` `refreshScheduled` filter = channelのみ ⇒ thread別表示不能
  4. `src/views/Chat.tsx:196` `threadReplies` = `listThreadReplies` 全件resource ⇒ thread史paging無(root `:147-161` は有)
- 案(小段, 各1commit):
  - a1: `submitSchedule` に `threadOf: threadRootId()` 追加 + schedule panel を thread pane へ再利用(共有component化)
  - a2: scheduled一覧を `thread_of` で分割表示(root=channel scheduled · thread pane=当該thread分)
  - a3: thread repliesを `listMessagesPage({threadOf})` + 第二 `PagingState` へ移行、`messagePaging.ts` 無改造で流用。resetはthreadKey変化時
  - test: `src/api/chat.scheduled.test.ts` 拡張 + `Chat.tsx` view test(thread schedule送出でthreadOf渡る·Load older二重押し不増殖)
- 死枝: 新migration追加 — 因=背骨(V116/V118)充分, schema変更不要

## (c) article comment channel

実体=`documents` の entity discussion channel (V109 done)。缺=chat原語との落差。

- 現状真: `src/views/Documents.tsx:378-381,393-403,414-434` `CommentPanel`
  - `listMessages(channelId)` 全件 · 送信 `createMessage(thread_of:null)` · reaction有 · meeting bind有 · #Spacebox feed購読有
- 缺(真):
  1. 著者名/時刻非表示(`:429` は `message.text` のみ) ⇒ 誰の発言か不明
  2. paging無(全件fetch) — `listMessagesPage` 未使用
  3. thread返信無(`thread_of` 常にnull)
  4. 編集/削除/pin無 · mentions無(`message_mentions` 未結線) · attachment無 · unfurl表示無
  5. polling無(refetchは自送信時のみ) ⇒ 他者コメント非追随
- 案:
  - c1: comment row に author表示(profiles map)+ `created_at` locale表示
  - c2: `listMessagesPage` + `messagePaging.ts` で "Load older"
  - c3: mention autocomplete をChatから抽出し共有(§04 row76 の残件と合流)
  - c4: 軽polling(既存 pollMs 規約に倣う)
- 死枝: comment専用table — 因=V109 で channel primitive 共有済, 二重真理生む

## gate

未実行(監査のみ) — UNVERIFIED: 上記案は未実装·未測。
