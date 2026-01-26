#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

UPSTREAM_URL="${TUNNEL_UPSTREAM_URL:-http://localhost:5000}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-${HOME}/.local/bin/cloudflared}"
NO_SYNC="false"
DETACH="false"

usage() {
  cat <<'EOF'
Usage: trycloudflare-tunnel.sh [options]

Starts a free Cloudflare Quick Tunnel (trusted HTTPS), points CAPACITOR_SERVER_URL at it,
and (by default) runs `npm run sync` so the Android app loads from HTTPS (secure context).

Options:
  --upstream <url>   Upstream backend URL (default: http://localhost:5000)
  --no-sync          Only print the tunnel URL (do not run `npm run sync`)
  --detach           Leave tunnel running in background and exit
  -h, --help         Show this help

Env vars:
  TUNNEL_UPSTREAM_URL  Same as --upstream
  CLOUDFLARED_BIN      Path to cloudflared binary (default: ~/.local/bin/cloudflared)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upstream)
      UPSTREAM_URL="${2:-}"
      if [[ -z "$UPSTREAM_URL" ]]; then
        echo "Missing value for --upstream" >&2
        exit 2
      fi
      shift 2
      ;;
    --no-sync)
      NO_SYNC="true"
      shift
      ;;
    --detach)
      DETACH="true"
      shift
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

install_cloudflared() {
  echo "[tunnel] Installing cloudflared to ${CLOUDFLARED_BIN}"
  mkdir -p "$(dirname "${CLOUDFLARED_BIN}")"
  local arch
  local asset
  arch="$(uname -m || true)"
  case "${arch}" in
    x86_64|amd64) asset="cloudflared-linux-amd64" ;;
    aarch64|arm64) asset="cloudflared-linux-arm64" ;;
    *)
      echo "[tunnel] Unsupported architecture: ${arch}" >&2
      exit 1
      ;;
  esac
  curl -fsSL \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}" \
    -o "${CLOUDFLARED_BIN}"
  chmod +x "${CLOUDFLARED_BIN}"
}

if ! command -v rg >/dev/null 2>&1; then
  echo "Error: ripgrep (rg) is required." >&2
  exit 1
fi

if [[ ! -x "${CLOUDFLARED_BIN}" ]]; then
  install_cloudflared
fi

echo "[tunnel] Upstream: ${UPSTREAM_URL}"
echo "[tunnel] cloudflared: ${CLOUDFLARED_BIN}"

if command -v curl >/dev/null 2>&1; then
  if ! curl -fsS --max-time 2 "${UPSTREAM_URL}/api/grift/ping" >/dev/null 2>&1; then
    echo "[tunnel] Warning: backend not responding at ${UPSTREAM_URL}" >&2
    echo "[tunnel] Start it from repo root with: npm run dev" >&2
  fi
fi

LOG_FILE="$(mktemp -t cloudflared.trycloudflare.XXXXXX.log)"
"${CLOUDFLARED_BIN}" tunnel --url "${UPSTREAM_URL}" --no-autoupdate >"${LOG_FILE}" 2>&1 &
TUNNEL_PID="$!"

cleanup() {
  if [[ "${DETACH}" != "true" ]]; then
    rm -f "${LOG_FILE}" >/dev/null 2>&1 || true
  fi
  if kill -0 "${TUNNEL_PID}" >/dev/null 2>&1; then
    kill "${TUNNEL_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

TUNNEL_URL=""
for _ in {1..80}; do
  TUNNEL_URL="$(rg -o "https://[a-zA-Z0-9-]+\\.trycloudflare\\.com" "${LOG_FILE}" | head -n 1 || true)"
  if [[ -n "${TUNNEL_URL}" ]]; then
    break
  fi
  sleep 0.25
done

if [[ -z "${TUNNEL_URL}" ]]; then
  echo "[tunnel] Failed to obtain trycloudflare URL. Recent logs:" >&2
  tail -n 50 "${LOG_FILE}" >&2 || true
  exit 1
fi

echo "[tunnel] URL: ${TUNNEL_URL}"
echo "[tunnel] Export (manual):"
echo "  export CAPACITOR_SERVER_URL=\"${TUNNEL_URL}\""

if [[ "${NO_SYNC}" != "true" ]]; then
  echo "[tunnel] Syncing Capacitor (updates android/app/src/main/assets/capacitor.config.json)..."
  (
    cd "${MOBILE_DIR}"
    CAPACITOR_SERVER_URL="${TUNNEL_URL}" npm run sync
  )
  echo "[tunnel] Sync complete. Next:"
  echo "  cd \"${MOBILE_DIR}\""
  echo "  npm run run:android"
fi

if [[ "${DETACH}" == "true" ]]; then
  trap - EXIT
  echo "[tunnel] Detached. PID=${TUNNEL_PID} log=${LOG_FILE}"
  exit 0
fi

echo "[tunnel] Leave this running to keep the tunnel alive. Ctrl+C to stop."
wait "${TUNNEL_PID}"
