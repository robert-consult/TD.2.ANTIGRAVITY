#!/bin/bash
# TradeQuip Mobile Build Script
# Run this script from WSL terminal to build the Capacitor Android app

set -e

echo "========================================"
echo "TradeQuip Capacitor Android Build"
echo "========================================"

cd /home/bcodex/TD.2.ANTIGRAVITY

echo ""
echo "[1/4] Building web application..."
npm run build

echo ""
echo "[2/4] Navigating to MOBILE directory..."
cd MOBILE

echo ""
echo "[3/4] Adding Android platform (if not exists)..."
if [ ! -d "android" ]; then
    npx cap add android
    echo "Android platform added successfully!"
else
    echo "Android platform already exists, skipping..."
fi

echo ""
echo "[4/4] Syncing Capacitor..."
npx cap sync android

echo ""
echo "========================================"
echo "BUILD COMPLETE!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Run 'npx cap open android' to open in Android Studio"
echo "  2. Or run 'npx cap run android' to run on device/emulator"
echo ""
echo "For remote URL mode (recommended for development):"
echo "  export CAPACITOR_SERVER_URL='http://10.0.2.2:5000'"
echo "  npx cap sync android"
echo "  npx cap run android"
echo ""

