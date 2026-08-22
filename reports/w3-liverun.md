# W3 生走検証 (feat/w3-verify · Brahma L3)

環境: worktree `/Users/pascaldisse/projects/gaia-space-w3-verify` · bun · 全成果物 worktree 内 (no /tmp)。
生証拠: `reports/w3run/http.txt` · `reports/w3run/oauth.txt` · `reports/w3run/db/*.schema` · `reports/w3run/gate-*.log`

## 1. space-server 実起動 — PASS
`cargo build --bin space-server` → `target/debug/space-server`
起動: `SPACE_DB=reports/w3run/db/live.db SPACE_PORT=18790 SPACE_ADMIN_PASSWORD=…`
既存 app / 既存 port 不可触 (18790/18791 のみ, 事前 lsof 空)。

## 2. 主要 route 実 HTTP — PASS(注記付)

| route | 結果 |
|---|---|
| POST /api/auth/login (正) | 200 `{"user":{"id":"admin","role":"admin",…}}` |
| POST /api/auth/login (誤 pw) | 401 `{"error":"invalid username or password","ok":false}` |
| GET /api/auth/me (無 session) | 401 `{"error":"unauthorized"}` |
| GET /api/auth/me (session) | 200 admin |
| cmd/create_issue | 200 `issue-18ce28a757f7e578-0` number=1 |
| cmd/list_issues | 200 上記 issue 1件 |
| cmd/create_document + list_documents | 200 / 200 `live-doc` 往復 |
| cmd/calendar_aggregate {range_start,range_end} | 200 `[]` (引数欠時は 400 型エラー=設計通り) |
| cmd/list_calendar_feeds | 200 `[]` |
| cmd/list_package_repositories | 200 `[]` |
| cmd/list_projects | 200 demo-project |
| cmd/list_channels (chat) | 501 `{"error":"not available in web mode"}` = `CommandPolicy::Unavailable` 設計通り |
| cmd/list_messages (他人channel) | 403 `channel access denied` |

注: chat は web mode で意図的に無効 (`Unavailable`) — 欠陥に非ず。

## 3. OAuth (RFC6749/7636) — 実 flow 通過

- `save_application` (code_flow_enabled, pkce_required) → 200
- POST `/oauth/authorize` → 200 `redirect_to=https://client.example/cb?code=ac-…&state=xyz`
- POST `/oauth/token` (正 verifier 43字) → 200 `{"access_token":"spoa_at-…","token_type":"Bearer","expires_in":3600,"scope":"project:read"}` ← **token_type=Bearer 実測**
- 同 code 再送 (replay) → 400 `invalid authorization code` ← single-use 実測
- grant_type=client_credentials → 400 `unsupported grant_type`
- client_id=nope → 400 `unknown client_id`
- confidential client (`rotate_app_secret`) 誤 secret → 400 `invalid client credentials` / 正 secret → 200 Bearer

### 発見 (FINDING·仕様乖離, 修正は本 lane 範囲外)
1. **error 形式が RFC6749 §5.2 非準拠**: token 端点は `{"ok":false,"error":"unsupported grant_type"}` を返す。規格は `{"error":"unsupported_grant_type"}` / `invalid_client` / `invalid_grant` の予約コード (snake_case, `ok` 包み無) を要求。加えて `invalid_client` は 401 + `WWW-Authenticate` が規定。現状 全て 400。
2. **redirect_uri 登録に HTTP 表面が無い**: `oauth::register_redirect_uri` は `/api/cmd/*` にも `/oauth/*` にも露出せず (grep: 呼出は test のみ)。∴ server 単体では OAuth client 完結登録不能 — 本検証では live DB へ直 INSERT して回避 (`reports/w3run/oauth.txt` に明記)。

## 4. V10→V38 migration 実走 (実 install DB の **copy**) — PASS
原本 `~/Library/Application Support/com.gaia.space/space.db` = **読取のみ・直触無** (`cp` → `reports/w3run/db/install-copy.db`)。
- 前: `PRAGMA user_version` = **10**, table 定義 62行
- 後 (server 起動で migrate): `PRAGMA user_version` = **38**, 180行, table 98個
- V29-V38 系 table 実在: `oauth_redirect_uris` `oauth_auth_codes` `oauth_access_tokens` `meeting_recordings`
- V38 最終形状実測: `CHECK(status IN ('starting','recording','stopping','stopped','failed'))` + partial unique index `meeting_recordings_active` + index `meeting_recordings_meeting`
- migrate 後の DB で server 稼働確認 (18791 → /api/auth/me 401 = 正常応答)
- 証拠: `reports/w3run/db/before.schema` / `after.schema` / `tables.diff`
- V39+ 追加無 (`SCHEMA_VERSION`=38 のまま)。

## 5. desktop (Tauri) — PASS
- `cargo check --features desktop --bin gaia-space` = 0 · `cargo build` = 0 (`target/debug/gaia-space` 52MB)
- 実起動 (SPACE_DB=worktree内): window 生成実測 `{"windows":[{"label":"main","outerSize":{"height":1200,"width":1600},"scaleFactor":2.0}]}` (`reports/w3run/desktop-info.json`), debug server on 127.0.0.1:9433, DB を V38 で自動生成。
- UNVERIFIED: debug `/eval` は `eval timeout` を返した (webview JS 応答未取得) → **UI 内部描画は未検証**。`cargo tauri dev` は使わず build 済 binary 直起動。

## 6. cargo fmt — 適用済 (整形のみ, 論理変更零)
`cargo fmt` → 7 file 整形 (SHA: style commit)。以後 `cargo fmt --check` 差分無。

## Gate 結果 (実走)
| gate | 結果 |
|---|---|
| cargo check --all-targets | **0 (PASS)** |
| cargo clippy --all-targets | **0 (PASS, warning 65)** |
| cargo clippy -- -D warnings | **101 (FAIL)** — 既存 lint 債務。失敗箇所は本 lane 未触 file 多数 (`debug_server.rs` `secretbox.rs` `lib.rs` `calls.rs` `blogs.rs`) ∴ fmt 起因に非ず。`reports/w3run/gate-clippy.log` |
| bunx tsc --noEmit | **0 (PASS)** |
| bun test | **0 (PASS)** — 115 pass / 0 fail / 473 expect, 23 file |
| bunx vite build | **0 (PASS)** — built in 1.93s |

## 死枝
- 死: `cargo tauri dev` 経路 — 因: GUI dev server 常駐+長時間, build 済 binary 直起動で同等証拠取得可。
- 死: HTTP 経由 redirect_uri 登録 — 因: 表面不在 (§3 発見2)。DB 直 INSERT で代替。

## 永久法遵守
PARITY.md / reports/parity/*.md = **無変更** (356行凍結維持) · migration V39+ 無 · /tmp 不使用 · 原本 DB 不可触。

---

## 追記 (round2 · Brahma建 · @89506bb)

### FINDING 1 塞: RFC 6749 §5.2 token 端点誤形
- `oauth::TokenError{error,error_description}` 導入 · `exchange_code` 戻値 `Result<TokenResponse,TokenError>`。
- 符割当: grant_type違=`unsupported_grant_type` · 未知client_id/秘鍵不整/公開clientに秘鍵=`invalid_client` · code_flow無効=`unauthorized_client` · code/redirect/PKCE不整=`invalid_grant` · 基盤誤(`From<String>`)=`invalid_request`。`TOKEN_ERROR_CODES`=6符。
- HTTP: `invalid_client`→**401 + WWW-Authenticate** · 他→400 · 成否両方 `Cache-Control: no-store` + `Pragma: no-cache`。
- ⨂ 分岐は `/oauth/token` のみ。他端点の `{ok:false,error}` 形=無変更 (UI依存維持)。
- test: `oauth::tests::token_errors_carry_rfc6749_codes_and_statuses` · `tests::oauth_token_errors_speak_rfc6749_section_5_2` (cargo test, curl に非ず)。

### FINDING 2 塞: register_redirect_uri のHTTP表面
- command 追加: `register_redirect_uri(application_id,redirect_uri)` · `list_redirect_uris(application_id)` (`oauth::*_cmd` 薄包)。
- policy = `CommandPolicy::AppAdmin` — app秘鍵系と同門 (allowlist=code配達先決定 ∴ credential面)。
- test: `tests::register_redirect_uri_is_an_admin_only_command` (無session=401 · member=403 · admin=200 · http非localhost=400)。
- 死枝 (round1) 「HTTP経由 redirect_uri 登録=表面不在」 → **解消**。

### Gate (round2 実走)
| gate | 結果 |
|---|---|
| cargo fmt --check | **0 (PASS)** |
| cargo check --all-targets | **0 (PASS)** |
| cargo test --lib | **0 (PASS)** — 159 passed / 0 failed |
| cargo test --bin space-server | **0 (PASS)** — 41 passed / 0 failed |
| cargo clippy --all-targets | **0 (PASS, warning 67)** |
| cargo clippy --all-targets -D warnings | **FAIL (既存債務)** — lib test 22 error 他。本 lane 未着手 (§未驗)。 |

### 未驗
- clippy 債務掃除 (debug_server.rs/secretbox.rs/lib.rs/calls.rs) = **未着手**。
- bunx tsc / bun test / vite build = round2 で再走せず (rust 面のみ変更 ∴ 無影響と**推定**, 実測に非ず)。

### 永久法
PARITY 356行 無変更 · migration 追加零 (V39+無) · /tmp 不使用 · 硬碼無 (policy=既存表)。
