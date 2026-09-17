# KB tables + budget — merge lane
- branch=`feat/kb-tables-budget` · base=`master@92b6083` · merges=`8f1f058`(sheet-v2) → `8702ab2`(budget-core) → `8dbd690`(budget-ui)
- fixes=`379c5e5`(baseline clippy) · `5ad03e7`(budget test assertion) · live=`977c945`.
- contracts: sheet-v2=`text|number|date|person|formula` · formulas client-only/no stored formula cells · Rust shape limits=`64 cols/5000 rows/512 formula chars`; budget=`EUR`+ordered members+five locked columns+integer-cent settlement.
- settlement: empty split→all · remainder→member order · creditor/debtor greedy transfers · document read/edit ACL reuse · quick-add transaction/version/event path · export=new markdown document.
- merge resolutions: `src-tauri/src/documents.rs`→sheet-v2 constants/validator + `KIND_BUDGET`/budget validation; `src/components/SheetEditor.tsx`→sheet-v2 locked-column implementation, readonly prop; `src/api/documents.ts`→v2 types + `budget`; `src/views/Documents.tsx`→sheet + budget paths.
- gate: cargo test=`485 lib + 81 server + 1 + 6 + 13 + 2`, pass · clippy `-D warnings`, clean · tsc, pass · bun test=`720 pass/0 fail` · build, pass; chunk-size warning only.
- live: `proof/kb-budget-live.txt` · copied dev DB → one free-port `space-server` → HTTP login/project/two profiles/budget/3 adds/statement/export/get-document/formula sheet + bogus refusal; statement=`A paid 3501/share 2251/net 1250; B paid 1000/share 2250/net -1250; B→A 1250`.
- UNVERIFIED: interactive browser rendering/person-select/formula footer; live concurrent quick-add race.

# HANDOFF — w11-chat ☀Surya

枝=feat/w11-chat·樹=/Users/pascaldisse/projects/gs-w11-chat。

## 完=⑤paging/link-unfurl (V118)

SHA列:
- `f410095` PARITY:V118予約(先行)
- `6b21280` db V118 (`message_links`+paging索引2) · `chat_links.rs`新 · chat.rs `list_messages_page_impl`/`unfurl_message_links_impl` · lib.rs IPC2 · tests10
- (同上に含む) `db.rs` SCHEMA_VERSION 117→118 + 固定値assert更新
- `3f9d5dd` space-server: policy/bind/ACL/dispatch (list_messages_page · unfurl_message_links) + test1
- `4be75af` src/messagePaging.ts + src/api/chat.ts wrappers + Chat.tsx pager/link card + Chat.css · tests6
- `0d17af2` PARITY row missing→**partial**(discovery/search/notification policy/Slack export 未達∴doneに非ず)。totals再計(357行·done97·partial200·stub4·missing56)

設計要点(paging):
- cursor=**不透明** base64url(`{created_at}:{id}`)。時刻単独=死枝:import群は時刻同値∴同値で行落ち/重複。∴tuple keyset。
- keyset(`created_at<? OR (=? AND id<?)`)ORDER BY created_at DESC,id DESC。OFFSET=死枝:読中に履歴が伸びれば窓がずれ行が重複。
- limit=`clamp(1,MAX_PAGE_LIMIT=100)`·既定`DEFAULT_PAGE_LIMIT=50`。定数のみ、呼側に literal 無し。
- `limit+1`行取得→余りの有無が`has_more`。第二のCOUNT=死枝(自分と食い違う)。
- **ACL=毎page再検査**(`channel_allows_actor`)。cursorは位置であり権能に非ず。thread指定時=root所属channelをserver側で実測、不一致は拒否。
- 索引:`messages_channel_page(channel_id,created_at DESC,id DESC)` · `messages_thread_page(thread_of,…)`。

設計要点(unfurl):
- URL抽出=**書込時**(create/update)→`message_links`行(position=文中順·message死→cascade)。読時再parse=死枝。
- preview列=**message行に同居**。global `url→preview` cache=死枝:cache hitが「その URL を私語した private channel が有る」を任意者に漏らすoracle。∴ACLはmessageのchannel ACLに一致。
- fetchは**read pathで絶対に起きぬ**。明示command `unfurl_message_links(message_id)` のみ。web=channel読ACL(message_idからserver側でchannel解決·caller提供channel不信)。
- SSRF=既存 `payload_dispatch::guard_endpoint_with` 再利用(重複実装=死枝)。IP literal直判定+DNS解決全アドレス検査(loopback/private/link-local/ULA/IPv4-mapped)。redirectは手動追跡(`Policy::none`)·**毎hop再guard**·≤`MAX_REDIRECTS=3`。timeout 5s·body ≤256KiB(`Read::take`)·MIMEは text/html·xhtml·text/plain のみ、他=refused。private許可はenv `GAIA_SPACE_UNFURL_ALLOW_PRIVATE` (既定off·app dispatchのenvとは別物)。
- 出力=**plain textのみ**:og:title/og:description/og:site_name(無ければ`<title>`)、entity復号、制御文字潰し、長さ上限。**image/thumbnail URLは保存も返却もせぬ**∴clientが第三者URLを取りに行く経路が存在せぬ。
- status={pending,ok,refused,failed}=終局記録。refused/failedは再fetchせぬ(死んだhostへの再ダイヤル防止)。
- 上限:message当り`MAX_LINKS_PER_MESSAGE=5`·URL≤2048B。

UI:
- 生窓=最新page(`PAGE_SIZE=50`)。「Load older messages」→cursor継続。
- `src/messagePaging.ts`=純関数(framework非依存·test済):order=(created_at,id)昇順=server同一順 · dedupはid鍵(後勝ち∴再取得が二重化せぬ) · race=**ticket制**(古いticketの遅延応答は破棄·channel切替reset もticket前進∴前channelのpageは着地不能) · error=cursor/hasMore不変∴Retryは同じpageを再要求。
- link card=text only + `rel="noopener noreferrer nofollow"`。pendingは「Show preview」押下で初めてserverがfetch。

## gate

`cargo test --manifest-path src-tauri/Cargo.toml` ✓ 359+65+1+6+13+2 pass/0 fail。
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ✓。
`bunx tsc --noEmit` ✓ · `bun test` ✓ 216/0 · `bun run build` ✓(chunk-size警告のみ)。
`python3 scripts/parity_totals.py --check` ✓ 357行·done97·partial200·stub4·missing56。

## UNVERIFIED

- 実socket unfurl(公開HTTPSへの実fetch)=未走。走ったのはguard拒否路(169.254.169.254)+注入transportのみ∴redirect追跡/MIME/256KiB打切りの**実網**挙動は未測。
- UI描画=未実機。paging論理は`src/messagePaging.ts`でunit済、TSX描画自体は未テスト(既存lane同様)。
- 並行:paging中の新規投稿flood下での重複/欠落=論理上mergeで吸収する筈だがE2E未走。
- thread paneはまだ全件取得(`list_thread_replies`)。thread paging はbackend(`thread_of`引数)に在るがUI未配線。
- 検索/discovery·notification policy設定·Slack export=未着手(∴row=partial)。

## 死枝

- 時刻単独cursor=死(同時刻群で行が落ちる/重複する)。
- OFFSET paging=死(生きた履歴で窓がずれる)。
- cursorを権能扱い(page毎ACL省略)=死(cursor共有で私channel読出)。
- global url→preview cache=死(cross-channel oracle)。
- 読時unfurl=死(履歴表示が任意URLへの外部要求になる·N件表示=N回発火)。
- reqwest自動redirect追従=死(guardが初手URLしか見ぬ∴302で内部網に到達)。
- preview image/thumbnail URL保存=死(clientが第三者へ要求し閲覧を漏らす)。
- 独自SSRF判定の再実装=死(既存guardと乖離する)。∴`payload_dispatch::guard_endpoint_with`共有。
- caller提供`channel_id`でunfurl認可=死。message_idからserver解決。

## 次

⑥候補:(a) history search/discovery(同KB行の残·V119要否は全文索引の設計次第) · (b) thread paging のUI配線 · (c) stickers/saved messages+labels=missing残(別KB行) · (d) notification policy設定/Slack export。

## proof lanes

proof lanes: create accounts with prefix `zz-proof-`, run `tools/purge-proof-accounts.ts --verify` at lane end.
