#!/bin/bash
# Database Backup Script - Keeps only the latest 2 versions
# Run this script to create a backup and clean old ones

BACKUP_DIR="db_backups"
DB_FILE="trading_app.db"
MAX_BACKUPS=2

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_FILE" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_NAME="${BACKUP_DIR}/trading_app_${TIMESTAMP}.db"
    
    cp "$DB_FILE" "$BACKUP_NAME"
    echo "Created backup: $BACKUP_NAME"
    
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/trading_app_*.db 2>/dev/null | wc -l)
    
    if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
        DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
        echo "Removing $DELETE_COUNT old backup(s)..."
        ls -1t "$BACKUP_DIR"/trading_app_*.db | tail -n "$DELETE_COUNT" | xargs rm -f
    fi
    
    echo "Current backups:"
    ls -lh "$BACKUP_DIR"/trading_app_*.db
else
    echo "Error: $DB_FILE not found"
    exit 1
fi
