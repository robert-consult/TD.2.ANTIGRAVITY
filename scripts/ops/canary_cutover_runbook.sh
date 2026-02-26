#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-tradehub}"
WORKER_CANARY_MANIFEST="${WORKER_CANARY_MANIFEST:-k8s/13-worker-canary-deployment.yaml}"
API_DEPLOY_MANIFEST="${API_DEPLOY_MANIFEST:-k8s/10-api-deployment.yaml}"
INGRESS_MANIFEST="${INGRESS_MANIFEST:-k8s/30-ingress.yaml}"
NETWORK_POLICY_MANIFEST="${NETWORK_POLICY_MANIFEST:-k8s/31-network-policies.yaml}"
WORKER_IMAGE="${WORKER_IMAGE:-}"
API_IMAGE="${API_IMAGE:-}"
OBS_INTERVAL_SEC="${OBS_INTERVAL_SEC:-300}"
OBS_SAMPLES="${OBS_SAMPLES:-288}"
WORKER_OBS_OUT="${WORKER_OBS_OUT:-/tmp/worker-canary-$(date -u +%Y%m%dT%H%M%SZ).csv}"
API_OBS_OUT="${API_OBS_OUT:-/tmp/api-cutover-$(date -u +%Y%m%dT%H%M%SZ).csv}"
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --namespace <ns>                  Kubernetes namespace (default: ${NAMESPACE})
  --worker-canary-manifest <path>   Worker canary manifest (default: ${WORKER_CANARY_MANIFEST})
  --api-manifest <path>             API deployment manifest (default: ${API_DEPLOY_MANIFEST})
  --ingress-manifest <path>         Ingress manifest (default: ${INGRESS_MANIFEST})
  --network-policy-manifest <path>  Network policy manifest (default: ${NETWORK_POLICY_MANIFEST})
  --worker-image <image>            Override canary deployment image
  --api-image <image>               Override API deployment image
  --interval-sec <n>                Observation cadence in seconds (default: ${OBS_INTERVAL_SEC})
  --samples <n>                     Observation samples (default: ${OBS_SAMPLES})
  --worker-out <file>               Worker canary CSV output file
  --api-out <file>                  API cutover CSV output file
  --dry-run                         Print commands only
  -h, --help                        Show this help

Example (24h at 5-min cadence):
  $(basename "$0") \\
    --namespace tradehub \\
    --worker-image registry.equitywaves.com/tradehub/app:2026-02-25 \\
    --api-image registry.equitywaves.com/tradehub/app:2026-02-25 \\
    --interval-sec 300 \\
    --samples 288
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --worker-canary-manifest) WORKER_CANARY_MANIFEST="$2"; shift 2 ;;
    --api-manifest) API_DEPLOY_MANIFEST="$2"; shift 2 ;;
    --ingress-manifest) INGRESS_MANIFEST="$2"; shift 2 ;;
    --network-policy-manifest) NETWORK_POLICY_MANIFEST="$2"; shift 2 ;;
    --worker-image) WORKER_IMAGE="$2"; shift 2 ;;
    --api-image) API_IMAGE="$2"; shift 2 ;;
    --interval-sec) OBS_INTERVAL_SEC="$2"; shift 2 ;;
    --samples) OBS_SAMPLES="$2"; shift 2 ;;
    --worker-out) WORKER_OBS_OUT="$2"; shift 2 ;;
    --api-out) API_OBS_OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

run_cmd() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  "$@"
}

run_cmd_script() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  bash -lc "$*"
}

echo "[runbook] namespace=${NAMESPACE}"
echo "[runbook] worker_canary_manifest=${WORKER_CANARY_MANIFEST}"
echo "[runbook] api_manifest=${API_DEPLOY_MANIFEST}"
echo "[runbook] ingress_manifest=${INGRESS_MANIFEST}"
echo "[runbook] network_policy_manifest=${NETWORK_POLICY_MANIFEST}"
echo "[runbook] observation interval=${OBS_INTERVAL_SEC}s samples=${OBS_SAMPLES}"

run_cmd kubectl config current-context
run_cmd kubectl -n "${NAMESPACE}" get ns "${NAMESPACE}"

echo "[runbook] Step 1/4: apply worker canary"
run_cmd kubectl -n "${NAMESPACE}" apply -f "${WORKER_CANARY_MANIFEST}"
if [[ -n "${WORKER_IMAGE}" ]]; then
  run_cmd kubectl -n "${NAMESPACE}" set image deployment/tradehub-worker-canary worker-canary="${WORKER_IMAGE}"
fi
run_cmd kubectl -n "${NAMESPACE}" rollout status deployment/tradehub-worker-canary --timeout=15m

echo "[runbook] Step 2/4: observe worker canary metrics"
run_cmd_script "NAMESPACE='${NAMESPACE}' INTERVAL_SEC='${OBS_INTERVAL_SEC}' SAMPLES='${OBS_SAMPLES}' OUT_FILE='${WORKER_OBS_OUT}' scripts/ops/observe_rollout_metrics.sh"

echo "[runbook] Step 3/4: apply API cutover manifests"
run_cmd kubectl -n "${NAMESPACE}" apply -f "${API_DEPLOY_MANIFEST}"
run_cmd kubectl -n "${NAMESPACE}" apply -f "${INGRESS_MANIFEST}"
run_cmd kubectl -n "${NAMESPACE}" apply -f "${NETWORK_POLICY_MANIFEST}"
if [[ -n "${API_IMAGE}" ]]; then
  run_cmd kubectl -n "${NAMESPACE}" set image deployment/tradehub-api api="${API_IMAGE}"
fi
run_cmd kubectl -n "${NAMESPACE}" rollout status deployment/tradehub-api --timeout=20m

echo "[runbook] Step 4/4: observe API cutover SLO metrics"
run_cmd_script "NAMESPACE='${NAMESPACE}' INTERVAL_SEC='${OBS_INTERVAL_SEC}' SAMPLES='${OBS_SAMPLES}' OUT_FILE='${API_OBS_OUT}' scripts/ops/observe_api_cutover_slo.sh"

echo "[runbook] COMPLETE"
echo "[runbook] worker_observation_csv=${WORKER_OBS_OUT}"
echo "[runbook] api_observation_csv=${API_OBS_OUT}"
echo "[runbook] rollback commands:"
echo "  kubectl -n ${NAMESPACE} rollout undo deployment/tradehub-api"
echo "  kubectl -n ${NAMESPACE} delete deployment tradehub-worker-canary"
