#!/usr/bin/env bash
# TradeQuip NATIVE bootstrap script
# Validates local prerequisites and bootstraps the checked-in NATIVE project in place.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
INSTALL_DEPS=1

usage() {
  cat <<'EOF'
Usage: bash init-native.sh [--no-install] [--help]

Bootstrap the checked-in React Native project under NATIVE/ without creating
any sibling directories outside the repository.

Options:
  --no-install   Validate environment only; skip `npm install`
  --help         Show this message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install)
      INSTALL_DEPS=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh" || true
  fi
fi

echo "======================================"
echo "TradeQuip Native Bootstrap"
echo "======================================"
echo "Project: $PROJECT_DIR"

echo ""
echo "[1/4] Checking core prerequisites..."

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required." >&2
  exit 1
fi
echo "✓ Node.js $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required." >&2
  exit 1
fi
echo "✓ npm $(npm --version)"

echo ""
echo "[2/4] Checking platform prerequisites..."

if command -v java >/dev/null 2>&1; then
  echo "✓ Java $(java -version 2>&1 | head -1)"
else
  echo "! Java not found. Android builds will fail until JDK 17+ is installed."
fi

if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME:-}" ]]; then
  echo "✓ Android SDK at $ANDROID_HOME"
elif [[ -d "$HOME/Android/Sdk" ]]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
  echo "✓ Android SDK at $ANDROID_HOME (auto-detected)"
else
  echo "! ANDROID_HOME not set and ~/Android/Sdk not found. Android runs/builds will be unavailable."
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  if command -v xcodebuild >/dev/null 2>&1; then
    echo "✓ Xcode $(xcodebuild -version | head -1)"
  else
    echo "! Xcode not found. iOS runs/builds will be unavailable."
  fi
else
  echo "! Non-macOS host detected. iOS runs/builds require macOS + Xcode."
fi

echo ""
echo "[3/4] Bootstrapping checked-in project..."

cd "$PROJECT_DIR"

if [[ "$INSTALL_DEPS" -eq 1 ]]; then
  npm install
  echo "✓ npm dependencies installed in-place under NATIVE/"
else
  echo "✓ Skipped npm install (--no-install)"
fi

echo ""
echo "[4/4] Summary"
echo "✓ No sibling ANDROID_NATIVE folder was created."
echo "✓ All work stays inside the checked-in NATIVE/ project."
echo ""
echo "Next steps:"
echo "  cd $PROJECT_DIR"
echo "  npm test"
echo "  npm run lint"
echo "  npm run build:android"
echo "  npm run pod:install   # macOS + Xcode only"
echo "  npm run build:ios     # macOS + Xcode only"
