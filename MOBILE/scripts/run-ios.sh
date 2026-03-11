#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: iOS wrapper runs require macOS with Xcode installed." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ERROR: xcodebuild is not available. iOS wrapper runs require macOS with Xcode installed." >&2
  exit 1
fi

exec npx cap run ios
