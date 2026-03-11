#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: React Native iOS pod installation requires macOS with Xcode, xcrun, and Apple iPhoneOS SDKs." >&2
  exit 1
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "ERROR: CocoaPods is not available. Install Ruby/CocoaPods first." >&2
  exit 1
fi

exec pod install --repo-update
