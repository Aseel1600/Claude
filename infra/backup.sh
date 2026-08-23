#!/usr/bin/env bash
#
# OmniRoute — online SQLite backup.
#
# OmniRoute's own auto-backup is switched off in .app.env
# (DISABLE_SQLITE_AUTO_BACKUP=true) because during a blue/green overlap two
# slots would each run it against the same file. This script is the single
# owner of backups instead, and runs from cron on the host.
#
# `sqlite3 .backup` is used rather than `cp`/`tar`: it takes a consistent
# snapshot of a live WAL database. Copying the file while the app is writing
# can capture a torn page set.
#
set -Eeuo pipefail

APP_DIR="/opt/omniroute"
DB="$APP_DIR/data/storage.sqlite"
DEST_DIR="$APP_DIR/backups"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
OUT="$DEST_DIR/storage-$STAMP.sqlite"

mkdir -p "$DEST_DIR"

if [[ ! -f "$DB" ]]; then
    echo "$(date -u '+%FT%TZ')  no database at $DB — nothing to back up"
    exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "$(date -u '+%FT%TZ')  ERROR: sqlite3 is not installed (apt install -y sqlite3)" >&2
    exit 1
fi

echo "$(date -u '+%FT%TZ')  backing up -> $OUT"
sqlite3 "$DB" ".backup '$OUT'"

# Verify before we let retention delete anything older.
if ! sqlite3 "$OUT" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
    echo "$(date -u '+%FT%TZ')  ERROR: integrity_check failed on $OUT — keeping it, skipping retention" >&2
    exit 1
fi

gzip -9 "$OUT"
echo "$(date -u '+%FT%TZ')  ok -> $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"

find "$DEST_DIR" -name 'storage-*.sqlite.gz' -type f -mtime "+$RETAIN_DAYS" -print -delete
