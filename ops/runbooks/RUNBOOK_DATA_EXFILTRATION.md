# RUNBOOK: Data Exfiltration Alert

**Trigger Alert:** `SuspiciousExportVolume`

## Symptoms
- Export bytes written rate exceeds 500MB/s for >5m
- A single admin account triggering many concurrent exports

## Immediate Actions (within 5 minutes)

```bash
# 1. Identify the offending admin from job audit trail
kubectl exec -n tradehub deploy/tradehub-api -- \
  node -e "const db=require('./dist/db');
  db.default.query('SELECT admin_id, count(*) FROM admin_data_export_jobs WHERE status=\\'running\\' GROUP BY admin_id').then(r=>console.log(r.rows))"

# 2. Freeze the admin account
kubectl exec -n tradehub deploy/tradehub-api -- \
  node -e "const db=require('./dist/db');
  db.default.query('UPDATE users SET is_active=false WHERE id=\\'ADMIN_ID_HERE\\'')"

# 3. Cancel all running export jobs for that admin
kubectl exec -n tradehub deploy/tradehub-api -- \
  node -e "const db=require('./dist/db');
  db.default.query('UPDATE admin_data_export_jobs SET status=\\'cancelled\\' WHERE admin_id=\\'ADMIN_ID_HERE\\' AND status IN (\\'queued\\',\\'running\\')')"
```

## Forensics

```bash
# 4. Preserve audit logs
kubectl logs -n tradehub -l role=worker --since=1h > /tmp/exfil-worker-logs.txt
kubectl logs -n tradehub -l role=api --since=1h > /tmp/exfil-api-logs.txt

# 5. List recently created MinIO objects
kubectl exec -n tradehub sts/tradehub-minio -- \
  mc ls local/admin-data-exports/ --recursive | tail -50
```

## Post-Incident
- Rotate MinIO access keys
- Review AdminScope session for the compromised account
- File incident report with timestamps and artifact hashes
