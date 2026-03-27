#!/bin/bash
# TradeHub Grafana + All Dashboards — One-Command Deploy
#
# Deploys Grafana OSS with all 64 dashboards auto-provisioned:
#   - 8 TradeHub custom dashboards
#   - 22 Pigsty PostgreSQL dashboards
#   - 2 Pigsty MinIO dashboards
#   - 11 Pigsty Node / Bare Metal dashboards
#   - 11 Pigsty Infrastructure dashboards
#   - 5 Pigsty Redis/Valkey dashboards
#   - 5 additional dashboards (app, mongo)
#
# Usage:
#   chmod +x ops/deploy-grafana.sh
#   ./ops/deploy-grafana.sh
#
# ALL FREE. No paid accounts needed.

set -euo pipefail

NS="tradehub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS="$SCRIPT_DIR"

echo "═══════════════════════════════════════════════════════"
echo "  TradeHub Grafana — Full Dashboard Deployment"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Namespace
echo "→ Ensuring namespace '$NS'..."
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true

# 2. Dashboard ConfigMaps (from pre-copied Pigsty dashboards)
echo "→ Loading TradeHub custom dashboards..."
kubectl create configmap tradehub-dashboards \
  --from-file="$OPS/dashboards/" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

for category in pgsql minio node infra redis; do
  DIR="$OPS/dashboards/pigsty-$category"
  if [ -d "$DIR" ] && ls "$DIR"/*.json >/dev/null 2>&1; then
    echo "→ Loading Pigsty $category dashboards..."
    kubectl create configmap "pigsty-$category-dashboards" \
      --from-file="$DIR/" \
      -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
  fi
done

# 3. Provisioning ConfigMaps
echo "→ Loading Grafana provisioning configs..."
kubectl create configmap grafana-dashboard-provisioning \
  --from-file=tradehub.yaml="$OPS/grafana-config/provisioning/dashboards/tradehub.yaml" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

kubectl create configmap grafana-datasource-provisioning \
  --from-file=tradehub.yaml="$OPS/grafana-config/provisioning/datasources/tradehub.yaml" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

# 4. Deploy Grafana
echo "→ Deploying Grafana OSS..."
kubectl apply -f "$OPS/kubernetes/grafana-deployment.yaml"
kubectl apply -f "$OPS/kubernetes/grafana-ingress.yaml"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Grafana deployed with all dashboards!"
echo ""
echo "  Access:  kubectl port-forward -n $NS svc/tradehub-grafana 3000:3000"
echo "           Then open: http://127.0.0.1:3000/grafana"
echo ""
echo "  Cluster ingress path: /grafana (protected by app-session auth when ingress is deployed)"
echo "  Break-glass local login: use the grafana-admin secret if direct service access prompts for credentials"
echo ""
echo "  Dashboard Folders:"
echo "    📊 TradeHub      — 8 custom dashboards"
echo "    📊 PostgreSQL    — 22 Pigsty dashboards"
echo "    📊 MinIO         — 2 Pigsty dashboards"
echo "    📊 Bare Metal    — 11 Node dashboards"
echo "    📊 Infrastructure — 11 Infra dashboards"
echo "    📊 Valkey/Redis  — 5 Redis dashboards"
echo "═══════════════════════════════════════════════════════"
