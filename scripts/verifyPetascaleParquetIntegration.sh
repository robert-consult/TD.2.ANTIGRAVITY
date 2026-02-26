#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PETASCALE_PARQUET_DIR="/home/Petascale-data/parquet-format"

pass_count=0
fail_count=0

check_cmd() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[PASS] ${description}"
    pass_count=$((pass_count + 1))
  else
    echo "[FAIL] ${description}"
    fail_count=$((fail_count + 1))
  fi
}

check_file_pattern() {
  local description="$1"
  local file="$2"
  local pattern="$3"
  if rg -n --fixed-strings "$pattern" "$file" >/dev/null 2>&1; then
    echo "[PASS] ${description}"
    pass_count=$((pass_count + 1))
  else
    echo "[FAIL] ${description}"
    echo "       missing pattern: ${pattern} in ${file}"
    fail_count=$((fail_count + 1))
  fi
}

echo "== TradeQuip Petascale/Parquet Integration Verification =="
echo "repo: ${ROOT_DIR}"

check_cmd "Petascale parquet-format repo exists" test -d "$PETASCALE_PARQUET_DIR"
check_cmd "Petascale parquet-format has README" test -f "$PETASCALE_PARQUET_DIR/README.md"

check_file_pattern "Node dependency parquetjs-lite is declared" "$ROOT_DIR/package.json" '"parquetjs-lite"'
check_file_pattern "Shared export schema supports parquet" "$ROOT_DIR/shared/admin/dataExports.ts" '"parquet"'

check_file_pattern "Export builder supports parquet content type" "$ROOT_DIR/server/services/adminDataExportBuild.ts" 'application/vnd.apache.parquet'
check_file_pattern "Trade audit export includes parquet column map" "$ROOT_DIR/server/services/adminDataExportBuild.ts" 'const TRADE_AUDIT_EXPORT_COLUMNS = ['
check_file_pattern "Order intent export includes parquet column map" "$ROOT_DIR/server/services/adminDataExportBuild.ts" 'const ORDER_INTENT_AUDIT_EXPORT_COLUMNS = ['
check_file_pattern "Trade audit export writes parquet" "$ROOT_DIR/server/services/adminDataExportBuild.ts" 'filename: `trade_audit_${Date.now()}.parquet`'
check_file_pattern "Order intent export writes parquet" "$ROOT_DIR/server/services/adminDataExportBuild.ts" 'filename: `order_intent_audit_${Date.now()}.parquet`'

check_file_pattern "Institutional audit route exposes trade parquet export" "$ROOT_DIR/server/routes/adminInstitutionalAudit.ts" '/trade-audit/export/parquet'
check_file_pattern "Institutional audit route exposes order-intent parquet export" "$ROOT_DIR/server/routes/adminInstitutionalAudit.ts" '/order-intent-audit/export/parquet'

check_file_pattern "Trade Audit UI exposes parquet export button" "$ROOT_DIR/client/src/pages/AdminTradeAudit.tsx" 'Export Parquet'
check_file_pattern "Trade Audit UI calls parquet endpoint" "$ROOT_DIR/client/src/pages/AdminTradeAudit.tsx" '/api/admin/trade-audit/export/'
check_file_pattern "Admin Data UI has parquet export actions" "$ROOT_DIR/client/src/pages/AdminData.tsx" 'queueStatsExport("trades", "parquet")'
check_file_pattern "Trader Search UI has parquet export action" "$ROOT_DIR/client/src/components/admin/TraderSearchTab.tsx" 'exportMutation.mutate("parquet")'

check_file_pattern "ClickHouse sync includes admin_trade_audit table" "$ROOT_DIR/server/services/clickhouseSync.ts" 'CREATE TABLE IF NOT EXISTS admin_trade_audit'
check_file_pattern "ClickHouse sync includes admin_order_intent_audit table" "$ROOT_DIR/server/services/clickhouseSync.ts" 'CREATE TABLE IF NOT EXISTS admin_order_intent_audit'

check_file_pattern "Metrics expose export queue backlog" "$ROOT_DIR/server/routes/wsCore.ts" 'admin_data_export_queue_waiting'
check_file_pattern "Metrics expose rollup freshness" "$ROOT_DIR/server/routes/wsCore.ts" 'admin_data_rollup_refresh_last_success_at'


echo ""
echo "summary: pass=${pass_count} fail=${fail_count}"
if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi
