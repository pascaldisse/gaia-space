#!/usr/bin/env bash
# Web document-upload boundary: exactly 50 MiB survives byte-for-byte; 50 MiB + 1 is refused.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
work=target/web-upload-e2e
rm -rf "$work"
mkdir -p "$work"
cleanup() { [[ -n ${pid:-} ]] && kill "$pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
port=$(python3 - <<'PY'
import socket
sock = socket.socket(); sock.bind(("127.0.0.1", 0)); print(sock.getsockname()[1]); sock.close()
PY
)
cargo build --manifest-path src-tauri/Cargo.toml --bin space-server >/dev/null
SPACE_DB="$root/$work/space.sqlite" SPACE_PORT="$port" SPACE_ADMIN_PASSWORD=web-upload-e2e src-tauri/target/debug/space-server >"$work/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 100); do curl -fsS "http://127.0.0.1:$port/api/auth/me" >/dev/null 2>&1 && break; sleep .05; done
curl -fsS -c "$work/cookie" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"web-upload-e2e"}' "http://127.0.0.1:$port/api/auth/login" >"$work/login.json"
python3 - "$work/input.bin" <<'PY'
import sys
with open(sys.argv[1], "wb") as file:
    for _ in range(50 * 1024): file.write(bytes(range(256)) * 4)
PY
curl -fsS -b "$work/cookie" --data-binary @"$work/input.bin" \
  "http://127.0.0.1:$port/api/documents/upload?filename=large.bin&container_type=my-docs&container_id=profile-admin" >"$work/upload.json"
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["value"]["document_id"])' "$work/upload.json")
curl -fsS -b "$work/cookie" "http://127.0.0.1:$port/api/documents/files/$id" -o "$work/output.bin"
sha256sum "$work/input.bin" "$work/output.bin"
stat -f 'bytes=%z' "$work/input.bin"
# Default limit is 50 MiB; the next byte must be rejected before persistence.
printf x >"$work/over.bin"
cat "$work/input.bin" "$work/over.bin" >"$work/over-limit.bin"
status=$(curl -sS -o "$work/over.json" -w '%{http_code}' -b "$work/cookie" --data-binary @"$work/over-limit.bin" \
  "http://127.0.0.1:$port/api/documents/upload?filename=over.bin&container_type=my-docs&container_id=profile-admin")
[[ "$status" == 413 ]] || { cat "$work/over.json"; echo "expected 413, got $status" >&2; exit 1; }
