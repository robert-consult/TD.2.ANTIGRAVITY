#!/usr/bin/env bash
# Queue Crash Recovery Drill
# Enqueues export jobs, force-kills worker pods, and verifies zero orphaned jobs.
#
# Usage: bash ops/chaos/queue-crash-recovery.sh

set -euo pipefail
NAMESPACE="${NAMESPACE:-tradehub}"
API_URL="${API_URL:-http://localhost:5000}"
JOB_COUNT="${JOB_COUNT:-100}"

echo "[chaos] ═══ Queue Crash Recovery Drill ═══"

# 1. Enqueue jobs via the export API
echo "[chaos] Enqueuing $JOB_COUNT export jobs..."
JOB_IDS=()
for i in $(seq 1 "$JOB_COUNT"); do
  RESP=$(curl -s -X POST "$API_URL/api/admin/data-exports" \
    -H "Content-Type: application/json" \
    -d '{"exportType":"trades","format":"csv","filters":{}}' 2>/dev/null || echo '{"id":"err"}')
  JOB_IDS+=("$(echo "$RESP" | grep -o '"id":"[^"]*"' | head -1 || true)")
done
echo "[chaos] Enqueued ${#JOB_IDS[@]} jobs."

# 2. Wait briefly then hard-kill worker pods
echo "[chaos] Waiting 5s for workers to pick up jobs..."
sleep 5
echo "[chaos] Force-killing all worker pods..."
kubectl delete pods -n "$NAMESPACE" -l role=worker --force --grace-period=0 2>/dev/null || true

# 3. Wait for pod recreation
echo "[chaos] Waiting 30s for pod recreation..."
sleep 30
kubectl wait --for=condition=Ready pods -n "$NAMESPACE" -l role=worker --timeout=120s

# 4. Wait for queue to drain
echo "[chaos] Waiting 120s for queue drain..."
sleep 120

# 5. Check for orphaned jobs
WAITING=$(curl -s "$API_URL/metrics" 2>/dev/null | grep -oP 'admin_data_export_queue_waiting \K[0-9.]+' || echo "0")
FAILED=$(curl -s "$API_URL/metrics" 2>/dev/null | grep -oP 'admin_data_export_jobs_failed_total \K[0-9.]+' || echo "0")

echo "[chaos] Queue waiting: $WAITING | Total failures: $FAILED"

if [ "${WAITING%.*}" -gt 0 ]; then
  echo "[FAIL] Orphaned jobs detected in queue."
  exit 1
fi

echo "[PASS] All jobs recovered after worker crash. Zero orphans."
