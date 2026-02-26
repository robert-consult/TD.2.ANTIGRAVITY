#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/certs"
KEY_PATH="$CERT_DIR/kes.key"
CERT_PATH="$CERT_DIR/kes.crt"

mkdir -p "$CERT_DIR"

if [[ -f "$KEY_PATH" && -f "$CERT_PATH" ]]; then
  echo "[kes] certs already exist: $KEY_PATH $CERT_PATH"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "[kes] openssl is required to generate dev certs" >&2
  exit 1
fi

echo "[kes] generating self-signed dev certs..."
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -days 3650 \
  -subj "/CN=tradehub-kes"

chmod 600 "$KEY_PATH"
chmod 644 "$CERT_PATH"

echo "[kes] generated: $KEY_PATH $CERT_PATH"
