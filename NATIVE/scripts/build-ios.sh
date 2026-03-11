#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: Native iOS builds require macOS with Xcode installed." >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ERROR: xcodebuild is not available. Install Xcode and its command line tools first." >&2
  exit 1
fi

exec xcodebuild -workspace TradeQuipNative.xcworkspace -scheme TradeQuipNative -configuration Release -sdk iphoneos
