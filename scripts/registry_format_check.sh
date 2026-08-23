#!/usr/bin/env bash
# Per-format wire conformance for the formats the npm/maven check does not cover:
# PyPI (real `pip`), NuGet, Composer and OCI (curl against the published protocol shapes).
# Server runs on a FREE port only; state lives under WORK_DIR (repo-local, never /tmp).
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK_DIR=${WORK_DIR:-"$REPO_ROOT/.work/format-check"}
SERVER_BIN=${SERVER_BIN:-"$REPO_ROOT/src-tauri/target/debug/space-server"}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-format-check-pw}
PYTHON=${PYTHON:-python3}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

PORT=${SPACE_PORT:-$("$PYTHON" -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT already in use - refusing to touch it" >&2
  exit 1
fi

export SPACE_DB="$WORK_DIR/space.db"
export SPACE_PACKAGE_DIR="$WORK_DIR/packages"
export SPACE_ADMIN_PASSWORD="$ADMIN_PASSWORD"
export SPACE_PORT="$PORT"
BASE="http://127.0.0.1:$PORT"

"$SERVER_BIN" >"$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  curl -fsS "$BASE/api/auth/me" >/dev/null 2>&1 && break
  sleep 0.2
done

TOKEN=$(curl -fsS -D - -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | tr -d '\r' | sed -n 's/.*space_session=\([^;]*\).*/\1/p' | head -1)
test -n "$TOKEN"
AUTH=(-H "Cookie: space_session=$TOKEN")

cmd() { curl -fsS -X POST "$BASE/api/cmd/$1" "${AUTH[@]}" -H 'content-type: application/json' -d "$2"; }
mkrepo() {
  cmd create_package_repository \
    "{\"repo\":{\"id\":\"$1\",\"project_id\":null,\"name\":\"$1\",\"format\":\"$2\",\"mode\":\"HOSTING\",\"description\":null,\"archived\":false}}" >/dev/null
}

mkrepo pypirepo pypi
mkrepo nugetrepo nuget
mkrepo composerrepo composer
mkrepo ocirepo container
echo "repositories created on port $PORT"

# ---------- PyPI: real wheel, real `pip install` off the simple index ----------
WHEEL_DIR="$WORK_DIR/wheel"
mkdir -p "$WHEEL_DIR"
WHEEL_NAME="space_demo-1.0.0-py3-none-any.whl"
"$PYTHON" - "$WHEEL_DIR/$WHEEL_NAME" <<'PY'
import base64, hashlib, sys, zipfile
dist = "space_demo-1.0.0.dist-info"
meta = "Metadata-Version: 2.1\nName: space-demo\nVersion: 1.0.0\nSummary: registry conformance fixture\nRequires-Python: >=3.8\nRequires-Dist: requests>=2.0\n"
wheel = "Wheel-Version: 1.0\nGenerator: space-check\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
mod = "VALUE = 42\n"
entries = {"space_demo.py": mod, f"{dist}/METADATA": meta, f"{dist}/WHEEL": wheel}
record = ""
for name, body in entries.items():
    digest = base64.urlsafe_b64encode(hashlib.sha256(body.encode()).digest()).rstrip(b"=").decode()
    record += f"{name},sha256={digest},{len(body)}\n"
record += f"{dist}/RECORD,,\n"
entries[f"{dist}/RECORD"] = record
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for name, body in entries.items():
        z.writestr(name, body)
PY

publish() {
  "$PYTHON" -c "import json,sys;print(json.dumps({'repositoryId':sys.argv[1],'packageName':sys.argv[2],'version':sys.argv[3],'metadataJson':sys.argv[4],'payloadFilename':None,'payloadContent':None,'immutable':False}))" "$@" \
    | curl -fsS -X POST "$BASE/api/cmd/publish_package_version" "${AUTH[@]}" -H 'content-type: application/json' --data-binary @- >/dev/null
}

PYPI_META='{"name":"space-demo","version":"1.0.0","summary":"registry conformance fixture","requires_python":">=3.8","requires_dist":["requests>=2.0"],"files":["space_demo-1.0.0-py3-none-any.whl"]}'
publish pypirepo space-demo 1.0.0 "$PYPI_META"
curl -fsS "${AUTH[@]}" -X PUT --data-binary "@$WHEEL_DIR/$WHEEL_NAME" \
  "$BASE/api/registry/pypirepo/generic/space-demo/1.0.0/$WHEEL_NAME" >/dev/null
echo "pypi: wheel uploaded"

echo "--- pypi simple index ---"
curl -fsS "${AUTH[@]}" "$BASE/api/registry/pypirepo/pypi/space-demo/"
echo
VENV="$WORK_DIR/venv"
"$PYTHON" -m venv "$VENV"
"$VENV/bin/pip" install --no-cache-dir --no-deps --index-url \
  "http://admin:$TOKEN@127.0.0.1:$PORT/api/registry/pypirepo/pypi/" \
  --trusted-host 127.0.0.1 space-demo==1.0.0 2>&1 | tail -3
"$VENV/bin/python" -c 'import space_demo; assert space_demo.VALUE == 42; print("pip install OK:", space_demo.VALUE)'

# ---------- nuget / composer: publish then read the protocol documents ----------
NUGET_META='{"id":"Space.Demo","version":"1.0.0","authors":"Space","description":"nuget fixture","license":"MIT","tags":"demo registry","dependencies":{"Newtonsoft.Json":"13.0.3"}}'
publish nugetrepo Space.Demo 1.0.0 "$NUGET_META"
COMPOSER_META='{"name":"space/demo","version":"1.0.0","description":"composer fixture","type":"library","license":["MIT"],"require":{"php":">=8.1"}}'
publish composerrepo space/demo 1.0.0 "$COMPOSER_META"

echo "--- nuget v3 index ---"
curl -fsS "${AUTH[@]}" "$BASE/api/registry/nugetrepo/nuget/index.json" | "$PYTHON" -m json.tool | head -20
echo "--- composer packages.json ---"
curl -fsS "${AUTH[@]}" "$BASE/api/registry/composerrepo/composer/packages.json" | "$PYTHON" -m json.tool | head -20

# ---------- OCI: blob push + manifest put + pull, distribution-spec shapes ----------
BLOB_BODY='{"architecture":"amd64","os":"linux"}'
BLOB_DIGEST="sha256:$(printf '%s' "$BLOB_BODY" | shasum -a 256 | cut -d' ' -f1)"
BLOB_SIZE=${#BLOB_BODY}
curl -fsS "${AUTH[@]}" -o /dev/null -X POST --data-binary "$BLOB_BODY" \
  "$BASE/api/registry/ocirepo/v2/library/demo/blobs/uploads/?digest=$BLOB_DIGEST"
MANIFEST="{\"schemaVersion\":2,\"mediaType\":\"application/vnd.oci.image.manifest.v1+json\",\"config\":{\"mediaType\":\"application/vnd.oci.image.config.v1+json\",\"digest\":\"$BLOB_DIGEST\",\"size\":$BLOB_SIZE},\"layers\":[{\"mediaType\":\"application/vnd.oci.image.layer.v1.tar+gzip\",\"digest\":\"$BLOB_DIGEST\",\"size\":$BLOB_SIZE}]}"
curl -fsS "${AUTH[@]}" -o /dev/null -X PUT -H 'content-type: application/vnd.oci.image.manifest.v1+json' \
  --data-binary "$MANIFEST" "$BASE/api/registry/ocirepo/v2/library/demo/manifests/1.0.0"
echo "--- oci manifest pull ---"
curl -fsS "${AUTH[@]}" "$BASE/api/registry/ocirepo/v2/library/demo/manifests/1.0.0" | "$PYTHON" -m json.tool
echo "--- oci blob pull ---"
curl -fsS "${AUTH[@]}" "$BASE/api/registry/ocirepo/v2/library/demo/blobs/$BLOB_DIGEST"
echo

# ---------- typed detail per format ----------
detail() { cmd package_version_detail "{\"repositoryId\":\"$1\",\"packageName\":\"$2\",\"version\":\"$3\"}" | "$PYTHON" -m json.tool; }
echo "--- typed detail: pypi ---";      detail pypirepo space-demo 1.0.0
echo "--- typed detail: nuget ---";     detail nugetrepo Space.Demo 1.0.0
echo "--- typed detail: composer ---";  detail composerrepo space/demo 1.0.0
echo "--- typed detail: container ---"; detail ocirepo library/demo 1.0.0

echo "FORMAT CHECKS PASSED (pypi via real pip; nuget/composer/oci via curl - dotnet/composer/docker CLIs absent on this host)"
