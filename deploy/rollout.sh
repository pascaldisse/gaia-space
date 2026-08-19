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
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="/root/gaia-space-backups/$STAMP"

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
systemctl stop gaia-space
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
# Only a LOSS is a migration fault.
lost = {k: (pre[k], post.get(k)) for k in pre
        if k not in ("user_version", "integrity") and int(post.get(k, -1)) < int(pre[k])}
assert not lost, f"rows lost: {lost}"
grew = {k: (pre[k], post[k]) for k in pre
        if k not in ("user_version", "integrity") and int(post.get(k, 0)) > int(pre[k])}
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
