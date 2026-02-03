#!/bin/bash
# Build Release APK/AAB for Play Store
# Run from MOBILE directory

set -e

echo "========================================"
echo "TradeQuip Release Build"
echo "========================================"

cd "$(dirname "$0")"

# Check for key.properties
if [ ! -f "android/key.properties" ]; then
    echo ""
    echo "ERROR: android/key.properties not found!"
    echo ""
    echo "Create android/key.properties with:"
    echo "  storePassword=your_password"
    echo "  keyPassword=your_password"
    echo "  keyAlias=tradequip"
    echo "  storeFile=../tradequip-release-key.keystore"
    echo ""
    echo "See docs/APP_SIGNING_GUIDE.md for details."
    exit 1
fi

# Check for keystore
KEYSTORE_PATH="android/tradequip-release-key.keystore"
if [ ! -f "$KEYSTORE_PATH" ]; then
    echo ""
    echo "ERROR: Keystore not found at $KEYSTORE_PATH"
    echo ""
    echo "Generate with:"
    echo "  keytool -genkey -v -keystore tradequip-release-key.keystore \\"
    echo "    -alias tradequip -keyalg RSA -keysize 2048 -validity 10000"
    exit 1
fi

echo ""
echo "[1/3] Building web application..."
cd ..
npm run build
cd MOBILE

echo ""
echo "[2/3] Syncing Capacitor..."
npx cap sync android

echo ""
echo "[3/3] Building release APK and AAB..."
cd android
./gradlew clean assembleRelease bundleRelease

echo ""
echo "========================================"
echo "BUILD COMPLETE!"
echo "========================================"
echo ""
echo "Release APK: android/app/build/outputs/apk/release/app-release.apk"
echo "Release AAB: android/app/build/outputs/bundle/release/app-release.aab"
echo ""
echo "Next steps:"
echo "  1. Test APK on device: adb install android/app/build/outputs/apk/release/app-release.apk"
echo "  2. Upload AAB to Play Console for Play Store release"
echo ""
