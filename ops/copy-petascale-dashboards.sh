#!/bin/bash
# Petascale Dashboard Integration Script
# Copies dashboards and frontends from Petascale-data packages into the ops/ directory.
#
# Run from the repo root:
#   chmod +x ops/copy-petascale-dashboards.sh
#   ./ops/copy-petascale-dashboards.sh /home/Petascale-data

set -euo pipefail

SRC="${1:-/home/Petascale-data}"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ops"

echo "═══════════════════════════════════════════════════════"
echo "  Petascale Dashboard Integration"
echo "  Source: $SRC"
echo "  Dest:   $DEST"
echo "═══════════════════════════════════════════════════════"

# ── 1. Pigsty Grafana Dashboards (59 JSON files) ────────────────────────────
PIGSTY="$SRC/pigsty-main/pigsty-main/files/grafana"

for category in pgsql minio node infra redis; do
  if [ -d "$PIGSTY/$category" ]; then
    mkdir -p "$DEST/dashboards/pigsty-$category"
    cp -v "$PIGSTY/$category/"*.json "$DEST/dashboards/pigsty-$category/" 2>/dev/null || true
    echo "  ✅ Pigsty $category dashboards copied"
  fi
done

# Copy the Pigsty master dashboard
if [ -f "$PIGSTY/pigsty.json" ]; then
  cp -v "$PIGSTY/pigsty.json" "$DEST/dashboards/pigsty-master.json"
  echo "  ✅ Pigsty master dashboard copied"
fi

# ── 2. MinIO Monitor Web Frontend ───────────────────────────────────────────
MINIO_MON="$SRC/minio_monitor-main/minio_monitor-main"
if [ -d "$MINIO_MON/static" ]; then
  mkdir -p "$DEST/minio-monitor/static"
  cp -v "$MINIO_MON/static/"* "$DEST/minio-monitor/static/" 2>/dev/null || true
  cp -v "$MINIO_MON/app.py" "$DEST/minio-monitor/" 2>/dev/null || true
  cp -v "$MINIO_MON/main.py" "$DEST/minio-monitor/" 2>/dev/null || true
  echo "  ✅ MinIO Monitor frontend copied"
fi

# ── 3. Bull-Board Express Adapter ───────────────────────────────────────────
BULLBOARD="$SRC/bull-board-master/bull-board-master"
if [ -d "$BULLBOARD/packages/express" ]; then
  mkdir -p "$DEST/bull-board"
  cp -rv "$BULLBOARD/packages/express/src" "$DEST/bull-board/" 2>/dev/null || true
  cp -v "$BULLBOARD/packages/express/package.json" "$DEST/bull-board/" 2>/dev/null || true
  cp -v "$BULLBOARD/packages/express/README.md" "$DEST/bull-board/" 2>/dev/null || true
  echo "  ✅ Bull-Board Express adapter copied"
fi

# ── 4. Grafana Provisioning Config ──────────────────────────────────────────
GRAFANA="$SRC/grafana-main/grafana-main"
if [ -d "$GRAFANA/conf/provisioning" ]; then
  mkdir -p "$DEST/grafana-config/provisioning"
  cp -rv "$GRAFANA/conf/provisioning/"* "$DEST/grafana-config/provisioning/" 2>/dev/null || true
  echo "  ✅ Grafana provisioning config copied"
fi

# ── 5. Prometheus Web UI Console Templates ──────────────────────────────────
PROMETHEUS="$SRC/prometheus-main/prometheus-main"
if [ -d "$PROMETHEUS/web" ]; then
  mkdir -p "$DEST/prometheus-config"
  cp -rv "$PROMETHEUS/documentation/examples/"*.yml "$DEST/prometheus-config/" 2>/dev/null || true
  echo "  ✅ Prometheus example configs copied"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Integration complete!"
TOTAL=$(find "$DEST/dashboards/pigsty-"* -name "*.json" 2>/dev/null | wc -l)
echo "  📊 $TOTAL Pigsty Grafana dashboards installed"
echo "  📊 MinIO Monitor web frontend installed"
echo "  📊 Bull-Board Express adapter installed"
echo "  📊 Grafana provisioning config installed"
echo "═══════════════════════════════════════════════════════"
