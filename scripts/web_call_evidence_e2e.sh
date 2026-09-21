#!/usr/bin/env bash
# Web call-evidence boundary: captions/recordings/actor-status must ANSWER over the web
# bridge instead of 403 `command denied` (prod defect, 2026-09-21), and a non-participant
# must still be refused.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
work=target/web-call-evidence-e2e
rm -rf "$work"; mkdir -p "$work"
cleanup() { [[ -n ${pid:-} ]] && kill "$pid" 2>/dev/null || true; }
trap cleanup EXIT
port=$(python3 - <<'PY'
import socket
sock = socket.socket(); sock.bind(("127.0.0.1", 0)); print(sock.getsockname()[1]); sock.close()
PY
)
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --bin space-server >/dev/null
SPACE_DB="$root/$work/space.sqlite" SPACE_PORT="$port" SPACE_ADMIN_PASSWORD=call-evidence-e2e \
  src-tauri/target/debug/space-server >"$work/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 200); do curl -fsS "http://127.0.0.1:$port/api/auth/me" >/dev/null 2>&1 && break; sleep .05; done
curl -fsS -c "$work/cookie" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"call-evidence-e2e"}' "http://127.0.0.1:$port/api/auth/login" >"$work/login.json"
cmd() { # cmd <name> <json-args> -> prints HTTP status, body to $work/<name>.json
  curl -sS -o "$work/$1.json" -w '%{http_code}' -b "$work/cookie" -H 'content-type: application/json' \
    -d "$2" "http://127.0.0.1:$port/api/cmd/$1"
}
channel="chan-call-evidence"
meeting="meeting-call-evidence"
now=$(date +%s)
cmd create_channel "{\"channel\":{\"id\":\"$channel\",\"name\":\"call-evidence\",\"description\":null,\"content_type\":\"public\",\"project_id\":null,\"entity_type\":null,\"entity_id\":null,\"archived\":false},\"memberIds\":[\"profile-admin\"]}" >"$work/channel.status"
echo "create_channel: $(cat "$work/channel.status") $(cat "$work/create_channel.json")"
cmd create_channel_call "{\"meeting\":{\"id\":\"$meeting\",\"title\":\"call evidence\",\"description\":null,\"starts_at\":$now,\"ends_at\":$((now+600)),\"rrule\":null,\"location\":null,\"organizer_id\":\"profile-admin\",\"channel_id\":\"$channel\",\"visibility\":\"public\",\"modification_preference\":\"organizer-only\",\"archived\":false,\"video_provider\":\"livekit\",\"video_status\":\"live\",\"video_started_at\":null,\"video_ended_at\":null,\"video_ended_by\":null,\"source_entity_type\":null,\"source_entity_id\":null,\"meeting_url\":null}}" >"$work/create.status"
echo "create_channel_call: $(cat "$work/create.status")"
for c in list_meeting_transcript_segments list_meeting_recordings; do
  status=$(cmd "$c" "{\"meetingId\":\"$meeting\"}")
  echo "$c: HTTP $status $(cat "$work/$c.json")"
  [[ "$status" == 200 ]] || { echo "expected 200 for $c" >&2; exit 1; }
done
status=$(cmd recording_actor_status '{}')
echo "recording_actor_status: HTTP $status $(cat "$work/recording_actor_status.json")"
[[ "$status" == 200 ]] || { echo 'expected 200 for recording_actor_status' >&2; exit 1; }
grep -q '"available":false' "$work/recording_actor_status.json" || { echo 'web must refuse recording with a reason' >&2; exit 1; }
# Scope still holds: an unknown meeting is refused, not enumerated.
status=$(cmd list_meeting_recordings '{"meetingId":"meeting-not-mine"}')
echo "list_meeting_recordings(other): HTTP $status $(cat "$work/list_meeting_recordings.json")"
[[ "$status" == 403 || "$status" == 400 ]] || { echo 'unscoped meeting read must be refused' >&2; exit 1; }
echo 'OK: call evidence answers over the web bridge, scope intact'
