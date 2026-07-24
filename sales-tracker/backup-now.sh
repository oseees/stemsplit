#!/usr/bin/env bash
# Pull a copy of the live SalesPal database off Railway to this Mac.
# Railway's own scheduled volume backups are Pro-plan only; this is the
# Hobby-plan stand-in. Writes outside the repo so customer data is never
# committed. Usage: ./backup-now.sh
set -euo pipefail

DEST=~/SalesPal-Backups/$(date +%Y-%m-%d-%H%M)
mkdir -p "$DEST"
cd "$(dirname "$0")"

railway volume files --volume salespal-volume download /salespal.db "$DEST/salespal.db"

# A raw file copy can catch a half-written page; refuse to keep a corrupt one.
if [ "$(sqlite3 "$DEST/salespal.db" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "FAILED: downloaded database is corrupt — not keeping it" >&2
  rm -rf "$DEST"
  exit 1
fi

sqlite3 "$DEST/salespal.db" \
  "SELECT 'users: '||(SELECT COUNT(*) FROM users)||'  invoices: '||(SELECT COUNT(*) FROM invoices)||'  payments: '||(SELECT COUNT(*) FROM payments);"
echo "OK -> $DEST/salespal.db"

# ponytail: keep the last 30, drop the rest.
ls -1dt ~/SalesPal-Backups/*/ | tail -n +31 | xargs -r rm -rf
