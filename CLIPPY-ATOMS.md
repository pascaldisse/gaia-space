# ⚓ w3-clippy atom list (frozen 2026-08-22)

gate: `cd src-tauri && cargo clippy --all-targets -- -D warnings` → 0
non-regression: `cd src-tauri && cargo test` → must stay 163/0 (or ≥ baseline)
律: lint修正のみ · 行動変更禁 · commit毎atom · no /tmp · PARITY.md不觸

## A群 (mechanical, zero-risk)
- src/blogs.rs:229 — `== false` → `!`
- src/documents.rs:8,9 — doc list overindent → 2 spaces
- src/documents.rs:950 — `extensions.contains(&ext)`
- src/debug_server.rs:405,420 — drop `.into()`
- src/debug_server.rs:464 — `format!("location.href={url_json}")`
- src/lib.rs:54 — remove unused `AppHandle`, `Manager`
- src/lib.rs:363 — `std::io::Error::other`
- src/lib.rs:373 — drop `&`
- src/pipelines.rs:2189 — `std::iter::repeat_n(...)`
- src/pipelines.rs:751 — simplify `map_or`

## B群 (judgement)
- src/secretbox.rs:26,39,59 — deprecated `Array::from_slice` → `TryFrom`.
  MUST preserve exact panic/error semantics. crypto: no behaviour drift.
- src/calls.rs:64 — manual `impl Default` → `#[derive(Default)]` only if
  field defaults are byte-identical; else `#[allow]` + reason comment.
- src/debug_server.rs:382 — large `Err` variant → `Box` it, or `#[allow]` w/ reason.
- src/oauth.rs:364 — complex type → `type` alias.
- too_many_arguments: issues.rs:295,330 · pipelines.rs:1328 · review.rs:1381
  → these are tauri `#[command]` fns; signature is the IPC contract.
  DO NOT refactor. Use targeted `#[allow(clippy::too_many_arguments)]`
  with a one-line reason comment. Changing them breaks the front-end.
