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
ASSET_DIR="$REPO_ROOT/ops/kubernetes/assets/headlamp-plugin"

echo "═══════════════════════════════════════════════════════"
echo "  TradeHub Ops — Headlamp Dashboard Deployment"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Ensure namespace exists
echo "→ Ensuring namespace '$NAMESPACE'..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true

# 2. Ensure the plugin artifact is current
if [ ! -x "$REPO_ROOT/node_modules/.bin/esbuild" ]; then
  echo "Root dependencies are missing. Run 'npm ci' at the repo root before deploying the plugin." >&2
  exit 1
fi

echo "→ Building Headlamp plugin..."
npm run build --prefix "$SCRIPT_DIR"

echo "→ Syncing built plugin into kustomize assets..."
mkdir -p "$ASSET_DIR"
cp "$SCRIPT_DIR/dist/main.js" "$ASSET_DIR/main.js"

# 3. Deploy RBAC (headlamp-viewer ServiceAccount + read-only ClusterRole)
echo "→ Deploying RBAC..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-rbac.yaml"

# 4. Create/update the plugin ConfigMap from the built JS
echo "→ Loading tradehub-ops plugin into ConfigMap..."
kubectl create configmap tradehub-ops-plugin \
  --from-file=main.js="$ASSET_DIR/main.js" \
  -n "$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Create/update the Headlamp plugins config
echo "→ Applying Headlamp plugins config..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-plugins.yaml"

# 6. Deploy Headlamp (upstream image + plugin mounted via ConfigMap)
echo "→ Deploying Headlamp with TradeHub Ops plugin..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-deployment.yaml"

# 7. Deploy ingress (superadmin-only access)
echo "→ Applying Headlamp ingress..."
kubectl apply -f "$REPO_ROOT/ops/kubernetes/headlamp-ingress.yaml"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo ""
echo "  Access:  https://<your-domain>/headlamp"
echo "  Or:      kubectl port-forward -n $NAMESPACE svc/tradehub-headlamp 4466:4466"
echo "           Then open: http://127.0.0.1:4466/"
echo ""
echo "  Sidebar: 'TradeHub Ops' with 8 monitoring views"
echo "═══════════════════════════════════════════════════════"
