#!/bin/bash
# TradeHub Prometheus — OPS Alert Rules Deploy
#
# Creates/updates the ConfigMap mounted by `k8s/60-monitoring.yaml` at `/etc/prometheus-ops`.
# This keeps operational alert rules in `ops/alerts/` while letting Prometheus load them via:
#   rule_files:
#     - /etc/prometheus-ops/*.yaml
#
# Usage:
#   chmod +x ops/deploy-prometheus-alerts.sh
#   ./ops/deploy-prometheus-alerts.sh

set -euo pipefail

NS="tradehub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS="$SCRIPT_DIR"

echo "═══════════════════════════════════════════════════════"
echo "  TradeHub Prometheus — OPS Alerts Deployment"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "→ Ensuring namespace '$NS'..."
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true

echo "→ Loading ops alert rules into ConfigMap tradehub-prometheus-ops-config..."
kubectl create configmap tradehub-prometheus-ops-config \
  --from-file="$OPS/alerts/" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

if kubectl get deployment tradehub-prometheus -n "$NS" >/dev/null 2>&1; then
  echo "→ Restarting Prometheus to ensure rule reload..."
  kubectl rollout restart deployment/tradehub-prometheus -n "$NS" >/dev/null
  kubectl rollout status deployment/tradehub-prometheus -n "$NS" --timeout=180s >/dev/null || true
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ OPS alerts applied"
echo "  ConfigMap: tradehub-prometheus-ops-config"
echo "  Rule path: /etc/prometheus-ops/*.yaml"
echo "═══════════════════════════════════════════════════════"

