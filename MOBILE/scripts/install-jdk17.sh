#!/usr/bin/env bash
set -euo pipefail

export JDK_MAJOR="${JDK_MAJOR:-17}"
exec "$(dirname "$0")/install-jdk.sh"
