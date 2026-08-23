# HANDOFF — w11-chat ☀Lakshmi-II

枝=feat/w11-chat·⚓HEAD=afeeef2。樹=/Users/pascaldisse/projects/gs-w11-chat。

## 完=①message pinning

SHA=`afeeef2`。

- V114予約→`PARITY.md`; `messages.pinned`+partial index、旧/部分DB guard。
- Rust/IPC/HTTP=`set_message_pinned`(author-only web)·`list_pinned_messages`(channel ACL)。
- UI=message pin/unpin·header pinned panel。
- test=冪等·newest順·archive除外。
- parity=`Message pinning` missing→partial; §04=59 rows·done18·partial36·missing5; total=356·done89·partial186·stub4·missing77。

## 次

②draft永続+typing indicator→③scheduled→④polls→⑤paging/link-unfurl。schema必要時=未使用V115以降を先PARITY予約。

## gate

`cargo test --manifest-path src-tauri/Cargo.toml` ✓。
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ✓。
`bunx tsc --noEmit` ✓。
`bun test` ✓:201/0。
`bun run build` ✓; chunk-size warningのみ。
`python3 scripts/parity_totals.py --check` ✓。

## UNVERIFIED

desktop/web実機pin操作·HTTP pin ACL E2E。
