# Worker Canary + API Cutover Runbook (OVH Bare Metal / Kubernetes)

This runbook executes the production rollout sequence for the admin export/analytics stack:
1. worker-only canary (`APP_ROLE=worker`) for 24h observation,
2. API cutover with ingress + network policy hardening,
3. post-cutover SLO observation.

## Preconditions

1. `kubectl` context points to target production cluster.
2. Manifests are present:
   - `k8s/13-worker-canary-deployment.yaml`
   - `k8s/10-api-deployment.yaml`
   - `k8s/30-ingress.yaml`
   - `k8s/31-network-policies.yaml`
3. Prometheus metrics are reachable through pod proxy (`/metrics` on port `5000`).
4. New app image has already passed local branch validation (`npm run check`, `npm run build`, `npm run e2e`, load tests).

## Step 0: Validate Manifests (no changes yet)

```bash
kubectl apply --dry-run=client -f k8s/13-worker-canary-deployment.yaml
kubectl apply --dry-run=client -f k8s/10-api-deployment.yaml
kubectl apply --dry-run=client -f k8s/30-ingress.yaml
kubectl apply --dry-run=client -f k8s/31-network-policies.yaml
```

## Step 1: Worker-only Canary (24h)

```bash
export NS=tradehub
export IMAGE=registry.equitywaves.com/tradehub/app:<release-tag>

kubectl -n "$NS" apply -f k8s/13-worker-canary-deployment.yaml
kubectl -n "$NS" set image deployment/tradehub-worker-canary worker-canary="$IMAGE"
kubectl -n "$NS" rollout status deployment/tradehub-worker-canary --timeout=15m

# Observe queue/export/clickhouse metrics every 5 minutes for 24h (288 samples).
NAMESPACE="$NS" INTERVAL_SEC=300 SAMPLES=288 OUT_FILE=/tmp/worker-canary-24h.csv \
  scripts/ops/observe_rollout_metrics.sh
```

## Step 2: Canary Gate Checklist (must pass before API cutover)

1. `tradehub-worker-canary` remains Ready (`1/1`) through observation window.
2. No sustained export backlog growth (`admin_data_export_queue_waiting` stabilizes/drains).
3. No sustained export failure growth (`admin_data_export_jobs_failed_total`).
4. `clickhouse_sync_last_success_at` keeps advancing (no stale sync window).

Useful spot checks:

```bash
tail -n 20 /tmp/worker-canary-24h.csv
awk -F, 'NR>1 && $6!="NA" {if($6+0>max) max=$6+0} END{print "max_queue_waiting="max}' /tmp/worker-canary-24h.csv
awk -F, 'NR==2{start=$8+0} END{print "failed_delta="($8+0-start)}' /tmp/worker-canary-24h.csv
```

## Step 3: API Cutover

```bash
export NS=tradehub
export IMAGE=registry.equitywaves.com/tradehub/app:<release-tag>

kubectl -n "$NS" apply -f k8s/10-api-deployment.yaml
kubectl -n "$NS" apply -f k8s/30-ingress.yaml
kubectl -n "$NS" apply -f k8s/31-network-policies.yaml
kubectl -n "$NS" set image deployment/tradehub-api api="$IMAGE"
kubectl -n "$NS" rollout status deployment/tradehub-api --timeout=20m

# Observe API error/latency/backlog SLOs for 24h.
NAMESPACE="$NS" INTERVAL_SEC=300 SAMPLES=288 OUT_FILE=/tmp/api-cutover-24h.csv \
  scripts/ops/observe_api_cutover_slo.sh
```

## Step 4: API Cutover SLO Checklist

1. API health probes remain successful (`health_code=200`).
2. No unexpected restart spikes (`api_restart_sum`, `worker_restart_sum`).
3. Queue backlog remains controlled (`queue_waiting`, `queue_active`).
4. Export failure growth remains bounded (`export_failed_total`).
5. WS/latency behavior remains stable (`api_ws_active_connections`, health latency trend).

Quick checks:

```bash
tail -n 20 /tmp/api-cutover-24h.csv
awk -F, 'NR>1 && $8!="200" {bad++} END{print "non200_health_samples="(bad+0)}' /tmp/api-cutover-24h.csv
awk -F, 'NR==2{start=$13+0} END{print "export_failed_delta="($13+0-start)}' /tmp/api-cutover-24h.csv
```

## One-command Orchestration (same sequence)

The scripted runbook executes all steps above:

```bash
scripts/ops/canary_cutover_runbook.sh \
  --namespace tradehub \
  --worker-image registry.equitywaves.com/tradehub/app:<release-tag> \
  --api-image registry.equitywaves.com/tradehub/app:<release-tag> \
  --interval-sec 300 \
  --samples 288
```

For command preview only:

```bash
scripts/ops/canary_cutover_runbook.sh --dry-run
```

## Rollback

```bash
kubectl -n tradehub rollout undo deployment/tradehub-api
kubectl -n tradehub delete deployment tradehub-worker-canary
```
