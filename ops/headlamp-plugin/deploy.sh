#!/bin/bash
# TradeHub Headlamp Ops Dashboard — One-Command Deploy
#
# Deploys the TradeHub Ops monitoring dashboard into Headlamp.
# No Docker build, no external registries, no paid accounts.
#
# Usage:
#   chmod +x ops/headlamp-plugin/deploy.sh
#   ./ops/headlamp-plugin/deploy.sh
#
# Prerequisites:
#   - kubectl configured for your cluster
#   - Headlamp image already pulled (or available locally)

set -euo pipefail

NAMESPACE="tradehub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "═══════════════════════════════════════════════════════"
echo "  TradeHub Ops — Headlamp Dashboard Deployment"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Ensure namespace exists
echo "→ Ensuring namespace '$NAMESPACE'..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true

# 2. Deploy RBAC (headlamp-viewer ServiceAccount + read-only ClusterRole)
echo "→ Deploying RBAC..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-rbac.yaml"

# 3. Create/update the plugin ConfigMap from pre-compiled JS
echo "→ Loading tradehub-ops plugin into ConfigMap..."
kubectl create configmap tradehub-ops-plugin \
  --from-file=main.js="$REPO_ROOT/ops/headlamp-plugin/dist/main.js" \
  -n "$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Create/update the Headlamp plugins config
echo "→ Applying Headlamp plugins config..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-plugins.yaml"

# 5. Deploy Headlamp (upstream image + plugin mounted via ConfigMap)
echo "→ Deploying Headlamp with TradeHub Ops plugin..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-deployment.yaml"

# 6. Deploy ingress (admin-only access)
echo "→ Applying Headlamp ingress..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-ingress.yaml"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo ""
echo "  Access:  https://<your-domain>/headlamp"
echo "  Or:      kubectl port-forward -n $NAMESPACE svc/tradehub-headlamp 4466:4466"
echo "           Then open: http://localhost:4466"
echo ""
echo "  Sidebar: 'TradeHub Ops' with 7 monitoring views"
echo "═══════════════════════════════════════════════════════"
