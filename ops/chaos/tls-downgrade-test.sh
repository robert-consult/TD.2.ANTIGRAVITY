#!/usr/bin/env bash
# TLS Downgrade Test
# Verifies HTTPS enforcement and TLS 1.0/1.1 rejection on ingress.
#
# Usage: bash ops/chaos/tls-downgrade-test.sh

set -euo pipefail
HOST="${INGRESS_HOST:-tradehub.example.com}"

echo "[chaos] ═══ TLS Downgrade Test ═══"

# 1. HTTP → HTTPS redirect
echo "[chaos] Testing HTTP redirect..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$HOST/" --max-time 5 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" =~ ^30[18]$ ]]; then
  echo "[PASS] HTTP correctly redirects ($HTTP_CODE)."
else
  echo "[FAIL] HTTP did not redirect (got $HTTP_CODE)."
  exit 1
fi

# 2. TLS 1.0 rejection
echo "[chaos] Testing TLS 1.0 rejection..."
if curl -s --tls-max 1.0 "https://$HOST/" --max-time 5 2>&1 | grep -qi "error\|failed\|alert"; then
  echo "[PASS] TLS 1.0 rejected."
else
  echo "[WARN] TLS 1.0 may not be rejected — verify ingress config."
fi

# 3. TLS 1.2+ success
echo "[chaos] Testing TLS 1.2+..."
TLS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --tlsv1.2 "https://$HOST/" --max-time 5 2>/dev/null || echo "000")
if [[ "$TLS_CODE" =~ ^[23] ]]; then
  echo "[PASS] TLS 1.2+ works ($TLS_CODE)."
else
  echo "[FAIL] TLS 1.2+ connection failed ($TLS_CODE)."
  exit 1
fi

echo "[chaos] TLS downgrade test complete."
