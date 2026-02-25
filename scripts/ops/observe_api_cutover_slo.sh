#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-tradehub}"
API_LABEL="${API_LABEL:-app=tradehub-api}"
WORKER_LABEL="${WORKER_LABEL:-app=tradehub-worker-canary}"
INTERVAL_SEC="${INTERVAL_SEC:-300}"
SAMPLES="${SAMPLES:-288}"
OUT_FILE="${OUT_FILE:-/tmp/tradehub-api-cutover-slo-$(date -u +%Y%m%dT%H%M%SZ).csv}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--namespace NS] [--api-label LABEL] [--worker-label LABEL] [--interval-sec N] [--samples N] [--out FILE]

Defaults:
  --namespace      ${NAMESPACE}
  --api-label      ${API_LABEL}
  --worker-label   ${WORKER_LABEL}
  --interval-sec   ${INTERVAL_SEC}
  --samples        ${SAMPLES}
  --out            ${OUT_FILE}

Example 24h observation (5-minute cadence):
  $(basename "$0") --interval-sec 300 --samples 288 --out /tmp/api-cutover-24h.csv
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --api-label)
      API_LABEL="$2"
      shift 2
      ;;
    --worker-label)
      WORKER_LABEL="$2"
      shift 2
      ;;
    --interval-sec)
      INTERVAL_SEC="$2"
      shift 2
      ;;
    --samples)
      SAMPLES="$2"
      shift 2
      ;;
    --out)
      OUT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

metric_value() {
  local metrics_text="$1"
  local name="$2"
  awk -v n="$name" '$1==n {print $2; exit}' <<<"${metrics_text}" 2>/dev/null || true
}

pod_name_by_label() {
  local ns="$1"
  local label="$2"
  kubectl -n "$ns" get pods -l "$label" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true
}

fetch_pod_metrics() {
  local ns="$1"
  local pod="$2"
  if [[ -z "$pod" ]]; then
    echo ""
    return 0
  fi
  kubectl -n "$ns" get --raw "/api/v1/namespaces/${ns}/pods/${pod}:5000/proxy/metrics" 2>/dev/null || true
}

deploy_ready() {
  local ns="$1"
  local deploy="$2"
  local ready replicas
  ready="$(kubectl -n "$ns" get deploy "$deploy" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  replicas="$(kubectl -n "$ns" get deploy "$deploy" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
  if [[ -z "$replicas" ]]; then
    echo "0/0"
    return 0
  fi
  if [[ -z "$ready" ]]; then ready="0"; fi
  echo "${ready}/${replicas}"
}

pod_restart_sum() {
  local ns="$1"
  local label="$2"
  kubectl -n "$ns" get pods -l "$label" -o jsonpath='{range .items[*]}{range .status.containerStatuses[*]}{.restartCount}{"\n"}{end}{end}' 2>/dev/null | awk '{sum+=$1} END {print sum+0}'
}

probe_api_health() {
  local ns="$1"
  local pod="$2"
  if [[ -z "$pod" ]]; then
    echo "NA,NA"
    return 0
  fi
  local start_ms end_ms code
  start_ms="$(date +%s%3N)"
  if kubectl -n "$ns" get --raw "/api/v1/namespaces/${ns}/pods/${pod}:5000/proxy/health" >/dev/null 2>&1; then
    code="200"
  else
    code="000"
  fi
  end_ms="$(date +%s%3N)"
  echo "${code},$((end_ms - start_ms))"
}

echo "ts_utc,api_pod,worker_pod,api_ready,worker_ready,api_restart_sum,worker_restart_sum,health_code,health_latency_ms,queue_waiting,queue_active,export_failed_total,export_succeeded_total,clickhouse_sync_last_success_at,api_ws_active_connections,api_trade_open_revalidation_reject_total" > "${OUT_FILE}"

echo "[observe-api-cutover-slo] writing ${SAMPLES} samples every ${INTERVAL_SEC}s to ${OUT_FILE}"

for ((i=1; i<=SAMPLES; i++)); do
  ts_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  api_pod="$(pod_name_by_label "${NAMESPACE}" "${API_LABEL}")"
  worker_pod="$(pod_name_by_label "${NAMESPACE}" "${WORKER_LABEL}")"

  api_metrics="$(fetch_pod_metrics "${NAMESPACE}" "${api_pod}")"
  worker_metrics="$(fetch_pod_metrics "${NAMESPACE}" "${worker_pod}")"

  api_ready="$(deploy_ready "${NAMESPACE}" "tradehub-api")"
  worker_ready="$(deploy_ready "${NAMESPACE}" "tradehub-worker-canary")"
  api_restart_sum="$(pod_restart_sum "${NAMESPACE}" "${API_LABEL}")"
  worker_restart_sum="$(pod_restart_sum "${NAMESPACE}" "${WORKER_LABEL}")"

  probe="$(probe_api_health "${NAMESPACE}" "${api_pod}")"
  health_code="${probe%%,*}"
  health_latency_ms="${probe##*,}"

  queue_waiting="$(metric_value "${worker_metrics}" "admin_data_export_queue_waiting")"
  queue_active="$(metric_value "${worker_metrics}" "admin_data_export_queue_active")"
  export_failed_total="$(metric_value "${worker_metrics}" "admin_data_export_jobs_failed_total")"
  export_succeeded_total="$(metric_value "${worker_metrics}" "admin_data_export_jobs_succeeded_total")"
  clickhouse_sync_last_success_at="$(metric_value "${worker_metrics}" "clickhouse_sync_last_success_at")"
  api_ws_active_connections="$(metric_value "${api_metrics}" "ws_active_connections")"
  api_trade_open_revalidation_reject_total="$(metric_value "${api_metrics}" "trade_open_rejected_quote_revalidation_total")"

  echo "${ts_utc},${api_pod:-NA},${worker_pod:-NA},${api_ready},${worker_ready},${api_restart_sum:-0},${worker_restart_sum:-0},${health_code:-NA},${health_latency_ms:-NA},${queue_waiting:-NA},${queue_active:-NA},${export_failed_total:-NA},${export_succeeded_total:-NA},${clickhouse_sync_last_success_at:-NA},${api_ws_active_connections:-NA},${api_trade_open_revalidation_reject_total:-NA}" >> "${OUT_FILE}"

  if [[ "$i" -lt "$SAMPLES" ]]; then
    sleep "${INTERVAL_SEC}"
  fi
done

echo "[observe-api-cutover-slo] complete: ${OUT_FILE}"
