#!/usr/bin/env bash
# Legacy compatibility wrapper for repo-local native bootstrap.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/init-native.sh" "$@"
