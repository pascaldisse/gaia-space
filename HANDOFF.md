# HANDOFF — w11-chat ☀Lakshmi

枝=feat/w11-chat·⚓HEAD=0e045a3。樹=/Users/pascaldisse/projects/gs-w11-chat。主樹不觸。

## 完=§04 atom

attachments lifecycle+mentions。

SHA列:
- `45629ab`→`c4b3ed3`: attachments lifecycle。upload_state/error·実測data-url容量gate·CAS遷移·message scope·冪等retry·HTTP author/admin authz·UI upload/failed/retry/remove。
- `5ba05a4`→`9db9237`: mentions。channel可読target限定·保存/readback·edit diff·inbox/badge·上限100·leave時alert消去。
- `502e594`+`eb3ec1a`: attachments migration=予約済V76へ訂正。V75非使用。
- `0e045a3`: parity status+summary整合。

migration=V76のみ。V75=calls予約、V77=issues予約。

## 次atom列

pin→draft persistence+typing→scheduled→polls→paging+unfurl。

## parity

§04=59 rows·done10·partial34·missing15。全体=356·done59·partial180·stub4·missing113。attachments/mentions: missing→partial 各1。

## gate

`cargo test --manifest-path src-tauri/Cargo.toml` ✓: lib312/0·space-server60/0。
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ✓。
`bunx tsc --noEmit` ✓。
`bun test` ✓:198/0。
`bun run build` ✓。chunk-size warningのみ。
`python3 scripts/parity_totals.py --check` ✓。

## 死枝

pin/V77未commit差分→死:親寿命令・新atom禁。`reset --hard`非行、attachments/mentions/V76保全。

## UNVERIFIED

実機desktop/web UI操作・外部upload transport。