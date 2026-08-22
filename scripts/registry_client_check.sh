#!/usr/bin/env bash
# Real-client verification of the per-format registry wire protocols.
# Starts space-server on a FREE port only (never touches a running instance), publishes with
# real npm and installs with real bun, then exercises the Maven layout end to end.
# Every path is parameterized; state lives under WORK_DIR (default: repo-local .work/registry).
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK_DIR=${WORK_DIR:-"$REPO_ROOT/.work/registry"}
SERVER_BIN=${SERVER_BIN:-"$REPO_ROOT/src-tauri/target/debug/space-server"}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-registry-check-pw}
MAVEN_HOME=${MAVEN_HOME:-"$WORK_DIR/apache-maven"}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# Free port: bind port 0, read what the kernel handed out, release it.
PORT=${SPACE_PORT:-$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')}
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT already in use — refusing to touch it" >&2
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

# The session token is only ever handed out as a Set-Cookie value.
TOKEN=$(curl -fsS -D - -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | tr -d '\r' | sed -n 's/.*space_session=\([^;]*\).*/\1/p' | head -1)
test -n "$TOKEN"
AUTH=(-H "Cookie: space_session=$TOKEN")

cmd() { curl -fsS -X POST "$BASE/api/cmd/$1" "${AUTH[@]}" -H 'content-type: application/json' -d "$2"; }

cmd create_package_repository '{"repo":{"id":"npmrepo","project_id":null,"name":"npm repo","format":"npm","mode":"HOSTING","description":null,"archived":false}}' >/dev/null
cmd create_package_repository '{"repo":{"id":"mvnrepo","project_id":null,"name":"maven repo","format":"maven","mode":"HOSTING","description":null,"archived":false}}' >/dev/null
echo "repositories created on port $PORT"

# ---------- npm: real `npm publish` then real `bun add` ----------
NPM_REGISTRY="$BASE/api/registry/npmrepo/npm/"
PKG_DIR="$WORK_DIR/npm-pkg"
mkdir -p "$PKG_DIR"
cat >"$PKG_DIR/package.json" <<'JSON'
{ "name": "@space/registry-demo", "version": "1.0.0", "main": "index.js" }
JSON
echo 'module.exports = 42;' >"$PKG_DIR/index.js"
cat >"$PKG_DIR/.npmrc" <<EOF
registry=$NPM_REGISTRY
//127.0.0.1:$PORT/api/registry/npmrepo/npm/:_authToken=$TOKEN
EOF
(cd "$PKG_DIR" && npm publish --registry "$NPM_REGISTRY" 2>&1 | tail -5)
echo "npm publish OK"

curl -fsS -H "Cookie: space_session=$TOKEN" "$BASE/api/registry/npmrepo/npm/@space%2fregistry-demo" | python3 -m json.tool | head -30

CONSUMER="$WORK_DIR/npm-consumer"
mkdir -p "$CONSUMER"
echo '{"name":"consumer","version":"1.0.0"}' >"$CONSUMER/package.json"
cat >"$CONSUMER/bunfig.toml" <<EOF
[install]
registry = { url = "$NPM_REGISTRY", token = "$TOKEN" }
EOF
(cd "$CONSUMER" && bun add @space/registry-demo@1.0.0 2>&1 | tail -5)
test -f "$CONSUMER/node_modules/@space/registry-demo/index.js"
echo "bun add OK: $(cat "$CONSUMER/node_modules/@space/registry-demo/index.js")"

# ---------- maven: real `mvn deploy` + `mvn dependency:get` when a JDK-driven mvn exists ----------
if [ -x "$MAVEN_HOME/bin/mvn" ] || command -v mvn >/dev/null 2>&1; then
  MVN=$(command -v mvn || echo "$MAVEN_HOME/bin/mvn")
  MVN_PROJECT="$WORK_DIR/mvn-project"
  mkdir -p "$MVN_PROJECT/src/main/java/demo"
  cat >"$MVN_PROJECT/src/main/java/demo/Demo.java" <<'JAVA'
package demo;
public class Demo { public static int answer() { return 42; } }
JAVA
  cat >"$MVN_PROJECT/pom.xml" <<EOF
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>registry-demo</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties>
  <distributionManagement>
    <repository><id>space</id><url>$BASE/api/registry/mvnrepo/maven</url></repository>
  </distributionManagement>
</project>
EOF
  cat >"$WORK_DIR/settings.xml" <<EOF
<settings>
  <localRepository>$WORK_DIR/m2</localRepository>
  <servers><server><id>space</id><username>admin</username><password>$ADMIN_PASSWORD</password></server></servers>
</settings>
EOF
  (cd "$MVN_PROJECT" && "$MVN" -q -s "$WORK_DIR/settings.xml" deploy 2>&1 | tail -20)
  echo "mvn deploy OK"
  rm -rf "$WORK_DIR/m2/com/example"
  "$MVN" -q -s "$WORK_DIR/settings.xml" dependency:get -DremoteRepositories="space::::$BASE/api/registry/mvnrepo/maven" \
    -Dartifact=com.example:registry-demo:1.0.0 2>&1 | tail -20
  echo "mvn dependency:get OK"
else
  echo "MAVEN CLIENT UNVERIFIED — no mvn on PATH; running HTTP-layer maven layout check instead"
fi

# Maven layout check over HTTP (runs always; identical routes the client uses).
MAVEN_BASE="$BASE/api/registry/mvnrepo/maven/com/example/http-demo"
printf 'jar-bytes' >"$WORK_DIR/http-demo-1.0.0.jar"
curl -fsS -u "admin:$ADMIN_PASSWORD" -X PUT --data-binary @"$WORK_DIR/http-demo-1.0.0.jar" "$MAVEN_BASE/1.0.0/http-demo-1.0.0.jar" >/dev/null
curl -fsS -u "admin:$ADMIN_PASSWORD" -X PUT --data-binary '<project/>' "$MAVEN_BASE/1.0.0/http-demo-1.0.0.pom" >/dev/null
echo "maven PUT OK"
curl -fsS -u "admin:$ADMIN_PASSWORD" "$MAVEN_BASE/1.0.0/http-demo-1.0.0.jar"; echo
curl -fsS -u "admin:$ADMIN_PASSWORD" "$MAVEN_BASE/1.0.0/http-demo-1.0.0.jar.sha1"; echo
curl -fsS -u "admin:$ADMIN_PASSWORD" "$MAVEN_BASE/maven-metadata.xml"
echo "maven GET + generated metadata OK"
