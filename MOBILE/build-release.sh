#!/bin/bash
# Build Release APK/AAB for Play Store
# Run from MOBILE directory

set -e

echo "========================================"
echo "TradeQuip Release Build"
echo "========================================"

cd "$(dirname "$0")"

DEFAULT_SIGNING_HOME="${HOME}/.config/tradequip/android-signing"
KEY_PROPERTIES_PATH="${TRADEQUIP_ANDROID_KEY_PROPERTIES:-${DEFAULT_SIGNING_HOME}/key.properties}"

if [ ! -f "$KEY_PROPERTIES_PATH" ]; then
    echo ""
    echo "ERROR: Android signing config not found at $KEY_PROPERTIES_PATH"
    echo ""
    echo "Create an operator-managed key.properties file outside the repo with:"
    echo "  storePassword=your_password"
    echo "  keyPassword=your_password"
    echo "  keyAlias=tradequip"
    echo "  storeFile=tradequip-release-key.keystore"
    echo ""
    echo "Recommended path: ${DEFAULT_SIGNING_HOME}/key.properties"
    echo "Override with TRADEQUIP_ANDROID_KEY_PROPERTIES=/secure/path/key.properties"
    echo "See docs/APP_SIGNING_GUIDE.md for details."
    exit 1
fi

KEYSTORE_PATH="$(awk -F '=' '/^storeFile=/{print $2}' "$KEY_PROPERTIES_PATH" | tr -d '\r' | xargs)"
if [ -z "$KEYSTORE_PATH" ]; then
    echo ""
    echo "ERROR: storeFile is missing from $KEY_PROPERTIES_PATH"
    echo ""
    exit 1
fi

if [[ "$KEYSTORE_PATH" != /* ]]; then
    KEYSTORE_PATH="$(cd "$(dirname "$KEY_PROPERTIES_PATH")" && pwd)/$KEYSTORE_PATH"
fi

if [ ! -f "$KEYSTORE_PATH" ]; then
    echo ""
    echo "ERROR: Keystore not found at $KEYSTORE_PATH"
    echo ""
    echo "Generate or restore it under $(dirname "$KEY_PROPERTIES_PATH") and reference it from key.properties"
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
./gradlew clean assembleRelease bundleRelease \
  -PtradequipAndroidKeyPropertiesPath="$KEY_PROPERTIES_PATH"

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
