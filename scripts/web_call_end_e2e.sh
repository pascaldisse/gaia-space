#!/usr/bin/env bash
# Ending a call must disconnect EVERYONE, not just the organizer's browser.
# Proof by artifact: a stand-in LiveKit records what the backend actually sent. Prod
# 2026-09-21 ended the DB row only and left the other party inside a live SFU room.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
work=target/web-call-end-e2e
rm -rf "$work"; mkdir -p "$work"
cleanup() { for p in ${fake:-} ${pid:-}; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
ports=$(python3 - <<'PY'
import socket
out = []
for _ in range(2):
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); out.append(sock.getsockname()[1]); sock.close()
print(" ".join(map(str, out)))
PY
)
read -r port lkport <<<"$ports"
cat >"$work/fake_livekit.py" <<'PY'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
log = open(sys.argv[2], "a", buffering=1)
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)) or 0)
        log.write(json.dumps({"path": self.path, "body": body.decode("utf-8", "replace"),
                              "auth": self.headers.get("authorization", "")[:16]}) + "\n")
        self.send_response(200); self.send_header("content-type", "application/json")
        self.end_headers(); self.wfile.write(b"{}")
    def log_message(self, *_args): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY
python3 "$work/fake_livekit.py" "$lkport" "$work/livekit.log" &
fake=$!
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --bin space-server >/dev/null
SPACE_DB="$root/$work/space.sqlite" SPACE_PORT="$port" SPACE_ADMIN_PASSWORD=call-end-e2e \
  LIVEKIT_HOST=127.0.0.1 LIVEKIT_PORT="$lkport" LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecret-devsecret \
  src-tauri/target/debug/space-server >"$work/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 200); do curl -fsS "http://127.0.0.1:$port/api/auth/me" >/dev/null 2>&1 && break; sleep .05; done
curl -fsS -c "$work/cookie" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"call-end-e2e"}' "http://127.0.0.1:$port/api/auth/login" >/dev/null
cmd() {
  curl -sS -o "$work/$1.json" -w '%{http_code}' -b "$work/cookie" -H 'content-type: application/json' \
    -d "$2" "http://127.0.0.1:$port/api/cmd/$1"
}
channel="chan-call-end"; meeting="meeting-call-end"; now=$(date +%s)
cmd create_channel "{\"channel\":{\"id\":\"$channel\",\"name\":\"call-end\",\"description\":null,\"content_type\":\"public\",\"project_id\":null,\"entity_type\":null,\"entity_id\":null,\"archived\":false},\"memberIds\":[\"profile-admin\"]}" >/dev/null
cmd create_channel_call "{\"meeting\":{\"id\":\"$meeting\",\"title\":\"call end\",\"description\":null,\"starts_at\":$now,\"ends_at\":$((now+600)),\"rrule\":null,\"location\":null,\"organizer_id\":\"profile-admin\",\"channel_id\":\"$channel\",\"visibility\":\"public\",\"modification_preference\":\"organizer-only\",\"archived\":false,\"video_provider\":\"livekit\",\"video_status\":\"scheduled\",\"video_started_at\":null,\"video_ended_at\":null,\"video_ended_by\":null,\"source_entity_type\":null,\"source_entity_id\":null,\"meeting_url\":null}}" >/dev/null
echo "join: $(cmd join_meeting_call "{\"meetingId\":\"$meeting\"}")"
status=$(cmd end_meeting_call "{\"meetingId\":\"$meeting\"}")
echo "end_meeting_call: HTTP $status $(cat "$work/end_meeting_call.json")"
[[ "$status" == 200 ]] || { echo 'end_meeting_call must succeed' >&2; exit 1; }
sleep .3
echo "--- what the backend actually sent to LiveKit ---"
cat "$work/livekit.log"
grep -q '"path": "/twirp/livekit.RoomService/DeleteRoom"' "$work/livekit.log" \
  || { echo 'ending a call did NOT delete the SFU room' >&2; exit 1; }
grep -q "meeting-$meeting" "$work/livekit.log" \
  || { echo 'the wrong room was deleted' >&2; exit 1; }
echo 'OK: ending a call deletes the meeting room, so every participant is disconnected'
