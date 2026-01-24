#!/usr/bin/env bash
set -euo pipefail

JDK_MAJOR="${JDK_MAJOR:-21}"
JDK_ROOT="${JDK_ROOT:-$HOME/.local/share/jdks}"
JDK_LINK="${JDK_ROOT}/temurin-${JDK_MAJOR}"

if [[ ! -x "${JDK_LINK}/bin/java" ]]; then
  echo "ERROR: JDK ${JDK_MAJOR} not found at: ${JDK_LINK}" >&2
  echo "Run: bash scripts/install-jdk.sh" >&2
  exit 1
fi

export JAVA_HOME="${JDK_LINK}"
export PATH="${JAVA_HOME}/bin:${PATH}"

exec "$@"

