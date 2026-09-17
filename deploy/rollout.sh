#!/usr/bin/env bash
# Server-side half of the production rollout: the part that must be provable.
#
#   rollout.sh <release-dir> <revision>
#
# Order is load-bearing: census and backup happen BEFORE anything is replaced,
# and every gate failure restores the previous release from that backup.
set -euo pipefail

RELEASE_DIR="${1:?release dir}"
REVISION="${2:?revision}"
DB=/var/lib/gaia-space/space.db
STATIC=/var/www/gaia-space
BIN=/opt/gaia-space/bin/space-server
LIVEKIT_ROOT="${LIVEKIT_ROOT:-/opt/livekit}"
LIVEKIT_BIN="${LIVEKIT_BIN:-$LIVEKIT_ROOT/livekit-server}"
LIVEKIT_CONFIG_DIR="${LIVEKIT_CONFIG_DIR:-/etc/livekit}"
LIVEKIT_ENV="${LIVEKIT_ENV:-$LIVEKIT_CONFIG_DIR/livekit.env}"
LIVEKIT_CONFIG="${LIVEKIT_CONFIG:-$LIVEKIT_CONFIG_DIR/livekit.yaml}"
CADDY_CONFIG="${CADDY_CONFIG:-/etc/caddy/Caddyfile.space}"
CADDY_MAIN_CONFIG="${CADDY_MAIN_CONFIG:-/etc/caddy/Caddyfile}"
CADDY_IMPORT="# GAIA Space routes: managed by $CADDY_CONFIG"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="/root/gaia-space-backups/$STAMP"

install_caddy_import() {
python3 - "$CADDY_MAIN_CONFIG" "$CADDY_CONFIG" "$CADDY_IMPORT" <<'PYTHON'
from pathlib import Path
import re
import sys

main_path, fragment, marker = sys.argv[1:]
main = Path(main_path)
text = main.read_text()
import_line = f"import {fragment}"
if text.count(import_line) == 1 and text.count(marker) == 1:
    raise SystemExit(0)
if import_line in text or marker in text:
    raise SystemExit("Caddy main config has an incomplete or duplicate GAIA Space import")
indent = r"(?P<indent>[ \t]*)"
block = r"(?P=indent)handle /space/(?:api|hooks)/\* \{\n(?s:.*?)^(?P=indent)\}\n"
legacy = re.compile(
    rf"(?m)^{indent}redir /space /space/ 308\n"
    rf"(?:{block})+"
    rf"(?P=indent)handle_path /space/\* \{{\n(?s:.*?)^(?P=indent)\}}\n"
)
matches = list(legacy.finditer(text))
if len(matches) != 1:
    raise SystemExit("Caddy main config must contain exactly one legacy GAIA Space route block")
match = matches[0]
replacement = f"{match.group('indent')}{marker}\n{match.group('indent')}{import_line}\n"
main.write_text(text[:match.start()] + replacement + text[match.end():])
PYTHON
}
census() { # census <sqlite-path> — table row counts + schema version, one line each
  python3 - "$1" <<'PY'
import sqlite3, sys
conn = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
print("user_version", conn.execute("PRAGMA user_version").fetchone()[0])
print("integrity", conn.execute("PRAGMA integrity_check").fetchone()[0])
for (name,) in sorted(conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")):
    print(name, conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0])
PY
}

echo "== pre-census"
census "$DB" | tee /tmp/census-pre.txt

echo "== backup -> $BACKUP"
install -d -m 700 "$BACKUP"
python3 - "$DB" "$BACKUP/space.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)   # live WAL-safe copy
dst = sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
PY
cp -a "$BIN" "$BACKUP/space-server"
cp -a /etc/gaia-space.env "$BACKUP/gaia-space.env"
cp -a /etc/systemd/system/gaia-space.service "$BACKUP/gaia-space.service"
cp -a /etc/systemd/system/livekit.service "$BACKUP/livekit.service" 2>/dev/null || true
cp -a "$CADDY_CONFIG" "$BACKUP/Caddyfile.space" 2>/dev/null || true
cp -a "$CADDY_MAIN_CONFIG" "$BACKUP/Caddyfile"
tar -C "$STATIC" -czf "$BACKUP/static.tar.gz" .
chmod -R go-rwx "$BACKUP"
census "$BACKUP/space.db" > /tmp/census-backup.txt
diff /tmp/census-pre.txt /tmp/census-backup.txt   # the backup must be a faithful copy

# The database is only restored when the migration itself is the casualty.
# A failed HTTP gate must not throw away writes real users made in the
# meantime — rolling the binary back is enough, and older binaries accept a
# newer user_version (migrate() is a no-op when the schema is already ahead).
DB_SUSPECT=0
restore() {
  echo "!! FAILED at: ${STEP:-unknown} — restoring $BACKUP"
  systemctl stop gaia-space || true
  install -o gaia-space -g gaia-space -m 0755 "$BACKUP/space-server" "$BIN"
  install -o root -g root -m 0644 "$BACKUP/gaia-space.service" /etc/systemd/system/gaia-space.service
  systemctl daemon-reload
  install -o root -g root -m 0644 "$BACKUP/Caddyfile" "$CADDY_MAIN_CONFIG"
  if [ -f "$BACKUP/Caddyfile.space" ]; then
    install -o root -g root -m 0644 "$BACKUP/Caddyfile.space" "$CADDY_CONFIG"
  fi
  caddy validate --config "$CADDY_MAIN_CONFIG"
  systemctl reload caddy
  rm -rf "${STATIC:?}/"* && tar -C "$STATIC" -xzf "$BACKUP/static.tar.gz"
  if [ "$DB_SUSPECT" = "1" ]; then
    echo "   migration was the failure — restoring the database too"
    cp -a "$BACKUP/space.db" "$DB" && chown gaia-space:gaia-space "$DB"
  else
    echo "   database left as-is (no migration fault; user writes preserved)"
  fi
  restorecon -RF "$STATIC" || true
  systemctl start gaia-space
  sleep 3
  census "$DB"
  echo "DEPLOYED=false (rolled back to the pre-deploy release)"
  exit 1
}
trap restore ERR

STEP="install"
echo "== install"
test -x "$LIVEKIT_BIN" # provision pinned LiveKit before first rollout; do not fall back to a dev server.
test -f "$LIVEKIT_ENV"
chmod 0600 "$LIVEKIT_ENV"
install -d -o root -g root -m 0755 "$LIVEKIT_CONFIG_DIR"
install -d -o root -g root -m 0755 /var/lib/livekit
install -o root -g root -m 0644 "$RELEASE_DIR/livekit.yaml" "$LIVEKIT_CONFIG"
install -o root -g root -m 0644 "$RELEASE_DIR/livekit.service" /etc/systemd/system/livekit.service
install -o root -g root -m 0644 "$RELEASE_DIR/Caddyfile.space" "$CADDY_CONFIG"
install_caddy_import
caddy validate --config "$CADDY_MAIN_CONFIG"
systemctl stop gaia-space
install -o root -g root -m 0644 "$RELEASE_DIR/gaia-space.service" /etc/systemd/system/gaia-space.service
systemctl daemon-reload
systemctl enable livekit
systemctl restart livekit
systemctl is-active livekit
systemctl reload caddy
install -o gaia-space -g gaia-space -m 0755 "$RELEASE_DIR/space-server" "$BIN"
rsync -a --delete "$RELEASE_DIR/static/" "$STATIC/"
# SELinux: fresh files carry the wrong type and Caddy answers 403 without this.
restorecon -RF "$STATIC"
ls -Z "$STATIC" | head -3
STEP="service start"
DB_SUSPECT=1                 # from here until the census clears, the schema is in play
systemctl start gaia-space
sleep 4

STEP="service active"
systemctl is-active gaia-space

STEP="post-census"
echo "== post-census (migrations run at start)"
census "$DB" | tee /tmp/census-post.txt

STEP="no table lost rows"
echo "== no pre-existing table lost rows"
python3 - <<'PY'
pre = dict(line.rsplit(" ", 1) for line in open("/tmp/census-pre.txt").read().splitlines())
post = dict(line.rsplit(" ", 1) for line in open("/tmp/census-post.txt").read().splitlines())
assert post["integrity"] == "ok", post["integrity"]
# Live service: rows may APPEAR between census and deploy (people keep working).
# V143 intentionally renames retired ticket tables; compare those facts with
# their explicit legacy successors, while every other pre-existing table may
# only grow.
renamed = {name: f"{name}_legacy" for name in (
    "issues", "issue_comments", "issue_activities", "issue_attachments",
    "issue_tracker_links", "issue_links", "issue_assignees",
    "issue_board_positions", "issue_tags",
)}
lost = {k: (pre[k], post.get(renamed.get(k, k))) for k in pre
        if k not in ("user_version", "integrity") and int(post.get(renamed.get(k, k), -1)) < int(pre[k])}
assert not lost, f"rows lost: {lost}"
grew = {k: (pre[k], post[renamed.get(k, k)]) for k in pre
        if k not in ("user_version", "integrity") and int(post.get(renamed.get(k, k), 0)) > int(pre[k])}
print("no rows lost; live growth during deploy:", grew or "none")
print("new tables:", sorted(set(post) - set(pre)))
PY
DB_SUSPECT=0                 # schema survived; later failures must not touch the DB

STEP="local api gate"
echo "== local gates"
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/api/auth/me)" = 401

# Only a release that passed every gate gets to claim the revision.
printf '%s\n' "$REVISION" > /opt/gaia-space/REVISION
trap - ERR
echo "DEPLOYED=true $REVISION (backup $BACKUP)"
