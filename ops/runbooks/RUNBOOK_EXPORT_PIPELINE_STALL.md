# RUNBOOK: Export Pipeline Stall

**Trigger Alert:** `ExportQueueStarvation` / `ExportThroughputStalled`

## Symptoms
- Export queue depth rising with zero completions
- Admin users reporting "stuck" exports in DataTab UI

## Diagnosis

```bash
# 1. Check worker pod status
kubectl get pods -n tradehub -l role=worker

# 2. Check worker logs for errors
kubectl logs -n tradehub -l role=worker --tail=50

# 3. Check queue depth via metrics
curl -s http://tradehub-api.tradehub.svc:5000/metrics | grep admin_data_export

# 4. Check Valkey connectivity from worker
kubectl exec -n tradehub deploy/tradehub-worker -- redis-cli -h valkey.tradehub.svc ping
```

## Resolution

```bash
# If workers are CrashLooping — check OOM or config
kubectl describe pod -n tradehub -l role=worker

# If workers are healthy but stuck — clear stalled jobs
kubectl exec -n tradehub deploy/tradehub-api -- \
  node -e "const q=require('./dist/server/services/adminDataExportQueue');q.cleanStalled()"

# Scale workers if backlog is genuine
kubectl scale deployment/tradehub-worker -n tradehub --replicas=4
```

## Escalation
If unresolved after 15m, page on-call lead and freeze new export submissions via feature flag.
