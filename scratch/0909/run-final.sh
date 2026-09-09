#!/bin/bash
set -u
label="$1"; db="$2"; log="$3"; status="$4"; ui="$5"; bin="$6"
: > "$log"; : > "$ui"
RUST_BACKTRACE=1 SPACE_DB="$db" "$bin" >"$log" 2>&1 & pid=$!
printf 'pid=%s\n' "$pid" > "$status"
restore=0
for i in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then wait "$pid"; rc=$?; printf 'exit=%s\nreason=exited-before-main-%ss\nrestore_prompt=%s\n' "$rc" "$i" "$restore" >> "$status"; exit 0; fi
  state=$(osascript -e 'tell application "System Events" to tell (first process whose unix id is '"$pid"') to get {name of every window, value of every static text of every window, name of every button of every window}' 2>&1)
  printf 't=%ss %s\n' "$i" "$state" >> "$ui"
  if printf '%s' "$state" | grep -q 'unexpectedly quit while reopening windows'; then
    restore=1; osascript -e 'tell application "System Events" to tell (first process whose unix id is '"$pid"') to click button "Don’t Reopen" of first window' >>"$ui" 2>&1 || true; sleep 1; continue
  fi
  if grep -q '\[gaia-space\] debug server on' "$log" || printf '%s' "$state" | grep -q 'GAIA Space'; then
    sleep 2; kill -TERM "$pid" 2>/dev/null || true; wait "$pid"; rc=$?; printf 'exit=%s\nreason=main-window-observed-%ss-killed\nrestore_prompt=%s\n' "$rc" "$i" "$restore" >> "$status"; exit 0
  fi
  sleep 1
done
kill -TERM "$pid" 2>/dev/null || true; wait "$pid"; rc=$?; printf 'exit=%s\nreason=30s-timeout\nrestore_prompt=%s\n' "$rc" "$restore" >> "$status"
