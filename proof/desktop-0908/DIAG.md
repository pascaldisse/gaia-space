# desktop→0908·diagnosis

scope→diagnosis only·no /Applications swap·old pid 26247 retained·live `~/Library/Application Support/com.gaia.space/space.db` unopened
staged→`dist/GAIA Space.app`·binary sha256 `e3063d7e65455ea3dc9eae9a48799f26ce1d1f8160c314f8ef4c1ac99b6a684e`
source→`50bc753`; worktree `7618bfb` adds only prior ops/proof files

## 1·crash report

command→`ls -t ~/Library/Logs/DiagnosticReports/ | grep -i 'gaia\|space' | head`
output→`gaia-space-2026-09-08-221645.ips`
path→`~/Library/Logs/DiagnosticReports/gaia-space-2026-09-08-221645.ips`
timestamp→`2026-09-08 22:16:45.00 +0200`
procPath→`/Applications/GAIA Space.app/Contents/MacOS/gaia-space`
crash UUID→`496C1C55-5611-3C5D-BEE1-F1901A1AA460`; staged UUID same; restored old UUID `7DE7197C-C411-30DB-913D-5118E0C36C78`
exception→`EXC_CRASH (SIGABRT)`·termination `Abort trap: 6`·ASI `abort() called`
panic-string→none in `.ips`

crashed-thread→`main`·top 15 frames:
```text
0 __pthread_kill + 8
1 pthread_kill + 296
2 abort + 148
3 std::sys::pal::unix::abort_internal + 12
4 std::process::abort + 12
5 std::panicking::panic_with_hook + 796
6 std::panicking::panic_handler closure + 112
7 std::sys::backtrace::__rust_end_short_backtrace + 12
8 rust_begin_unwind + 32
9 core::panicking::panic_nounwind_fmt + 40
10 core::panicking::panic_nounwind + 32
11 core::panicking::panic_cannot_unwind + 24
12 tao::platform_impl::platform::app_delegate::did_finish_launching + 272
13 __CFNOTIFICATIONCENTER_IS_CALLING_OUT_TO_AN_OBSERVER__ + 148
14 ___CFXRegistrationPost_block_invoke + 92
```

## 2·unified log

command→`log show --predicate 'process == "gaia-space"' --last 20m --style compact | head -80`
output→old process `16682` only; WebKit memory/activity lines; no `thread main panicked`, Rust panic, missing-file, SQLite error
post-isolated-run→macOS AppIntents `NSCocoaErrorDomain Code=4097`; incidental; Rust stderr below supplies fatal error

## 3·bundle sanity

`otool -L dist/GAIA\ Space.app/Contents/MacOS/gaia-space`→system frameworks + `/usr/lib/{libiconv.2,libz.1,libSystem.B}.dylib`; no Homebrew/missing dylib
new Resources→`icon.icns` 98451 bytes only
old Resources→`icon.icns` 98451 bytes only
Info.plist→`diff -u` empty
bundle tree new→`Info.plist`, `MacOS/gaia-space`, `MacOS/space-server`, `Resources/icon.icns`, `_CodeSignature/CodeResources`
bundle tree old→`Info.plist`, `MacOS/gaia-space`, `Resources/icon.icns`
staged/source-bundle executable SHA-256→identical `e3063d7e…a684e`
`codesign --verify --deep --strict`→exit 0
`spctl -a -vvv`→`rejected`; ad-hoc signature; non-causal: staged binary executed and emitted app setup panic

## 4·isolated direct run

resolution→`src-tauri/src/db.rs`: `SPACE_DB` wins over app-data path·`connection()` binds it before `conn()`
scratch→`scratch/isolated-221x/space.db`; copied `~/.gaia/backups/space-local.bak-0908-predesktop.db`
copy SHA-256→`cfb1af2fc8ff4ee72f2e73041eb274c0ed92611ed3e4be0548b017c2171dd53d`
command→`SPACE_DB="$PWD/scratch/isolated-221x/space.db" dist/GAIA\ Space.app/Contents/MacOS/gaia-space >scratch/isolated-221x/stderr.txt 2>&1`
exit→134·`Abort trap: 6`

stderr:
```text
thread 'main' (1838735) panicked at .../tauri-2.11.5/src/app.rs:1425:11:
Failed to setup app: error encountered during setup hook: NOT NULL constraint failed: todos.profile_id
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
thread 'main' ... panicked at .../core/src/panicking.rs:225:5:
panic in a function that cannot unwind
... tao::platform_impl::platform::app_delegate::did_finish_launching ...
thread caused non-unwinding panic. aborting.
```

scratch DB before/after failed transaction→`PRAGMA user_version=142`; `PRAGMA integrity_check=ok`; `todo_links` absent; `issues_legacy` absent
V143 source rows→4; null profile source→one:
```text
issue_id                  issue_created_by  project_created_by  title
issue-18c5d4d940890130-0  NULL              NULL                'Verify CF issue'
```
failed SQL→`SCHEMA_V143`: `INSERT INTO todos(...profile_id...) SELECT i.id,COALESCE(i.created_by,p.created_by),... FROM issues i JOIN projects p ...`; source row yields NULL against `todos.profile_id TEXT NOT NULL`
old pid before/after→`26247 /Applications/GAIA Space.app/Contents/MacOS/gaia-space`; port 9433 listener remains pid 26247
non-cause eliminated→`debug_server::spawn` handles occupied port by stderr+return; no panic

## 5·build recipe·lane diff

recipe→`bun install && bun run tauri build`
`tauri build`→`beforeBuildCommand bun run build`→Vite frontend `dist/`; bundle source `src-tauri/target/release/bundle/macos/GAIA Space.app`
lane `6c87c9c`→same command·build log: Vite 582 modules·release finished·macOS bundle completed
lane `b01c080`→copy source bundle→`dist/GAIA Space.app`; codesign strict exit 0
no VITE/GAIA/SPACE build env recorded in lane log
old-app recipe→HANDOVER specifies `bun run tauri dev`; no separate release recipe
workflow→desktop `cargo check --all-targets`; no packaged-app/migration-with-production-snapshot gate

## result

root-cause→V143 migration rejects legacy issue `issue-18c5d4d940890130-0`: both owner fallbacks NULL; setup returns Err; Tauri `.run(...).expect` panics within non-unwinding macOS launch callback; SIGABRT before window
secondary→ad-hoc bundle rejected by `spctl`; not cause of observed abort
fix-proposal→Before the V143 INSERT, deterministically repair/reject every legacy issue lacking both `issues.created_by` and `projects.created_by` using an existing valid profile (or retain it as explicit migration error shown without `expect`); make V143 atomic/idempotent; add a migration test built from the schema-142 backup shape containing that null-owner row; then package and launch against a copied DB via `SPACE_DB`, requiring schema 144 and a visible window before any /Applications swap.

artifacts→this file·`scratch/isolated-221x/stderr.txt`·`scratch/isolated-221x/space.db`·`~/Library/Logs/DiagnosticReports/gaia-space-2026-09-08-221645.ips`·`reports/desktop-0908/stage-2-build.log`·`proof/desktop-0908/SWAP-RESULT-0908.txt`
