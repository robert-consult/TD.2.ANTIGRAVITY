#!/bin/bash
set -euo pipefail

# Postgres backup script - keeps only the latest N dumps.
#
# Requires:
#   - DATABASE_URL
#   - pg_dump available on PATH
#
# Output:
#   - db_backups/pg_YYYYmmdd_HHMMSS.dump

BACKUP_DIR="db_backups"
MAX_BACKUPS="${MAX_BACKUPS:-2}"
DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_NAME="${BACKUP_DIR}/pg_${TIMESTAMP}.dump"

pg_dump --format=custom --no-owner --no-privileges --file "$BACKUP_NAME" "$DATABASE_URL"
echo "Created backup: $BACKUP_NAME"

BACKUP_COUNT="$(ls -1 "$BACKUP_DIR"/pg_*.dump 2>/dev/null | wc -l | tr -d ' ')"
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  echo "Removing $DELETE_COUNT old backup(s)..."
  ls -1t "$BACKUP_DIR"/pg_*.dump | tail -n "$DELETE_COUNT" | xargs rm -f
fi

echo "Current backups:"
ls -lh "$BACKUP_DIR"/pg_*.dump
