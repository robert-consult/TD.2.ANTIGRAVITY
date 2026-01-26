#!/bin/bash
# TradeQuip ANDROID - React Native Initialization Script
# Run this script from WSL to set up the React Native project

set -e

echo "======================================"
echo "TradeQuip Android Native - Setup"
echo "======================================"

cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)
PARENT_DIR=$(dirname "$PROJECT_DIR")

# Step 1: Check prerequisites
echo ""
echo "[1/6] Checking prerequisites..."

# Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Please install Node.js 18+"
    exit 1
fi
echo "✓ Node.js $(node --version)"

# npm
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found"
    exit 1
fi
echo "✓ npm $(npm --version)"

# Java
if ! command -v java &> /dev/null; then
    echo "Java not found. Installing OpenJDK 17..."
    sudo apt-get update && sudo apt-get install -y openjdk-17-jdk
fi
echo "✓ Java $(java -version 2>&1 | head -1)"

# Android SDK
if [ -z "$ANDROID_HOME" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
        echo "✓ Android SDK at $ANDROID_HOME (auto-detected)"
    else
        echo "ERROR: ANDROID_HOME not set. Please install Android SDK."
        exit 1
    fi
else
    echo "✓ Android SDK at $ANDROID_HOME"
fi

# Step 2: Create React Native project
echo ""
echo "[2/6] Initializing React Native project..."

TEMP_DIR="$PARENT_DIR/TradeQuipNative_temp"
NATIVE_DIR="$PARENT_DIR/ANDROID_NATIVE"

# Clean up any previous temp directory
rm -rf "$TEMP_DIR"

# Initialize RN project
cd "$PARENT_DIR"
npx -y react-native@latest init TradeQuipNative_temp --template react-native-template-typescript --skip-git-init --skip-install

# Step 3: Copy source files
echo ""
echo "[3/6] Copying source files..."

# Remove template src and replace with our src
rm -rf "$TEMP_DIR/src"
cp -r "$PROJECT_DIR/src" "$TEMP_DIR/src"

# Copy config files
cp "$PROJECT_DIR/tsconfig.json" "$TEMP_DIR/tsconfig.json"
cp "$PROJECT_DIR/babel.config.js" "$TEMP_DIR/babel.config.js"

# Step 4: Merge package.json
echo ""
echo "[4/6] Merging dependencies..."

# For now, we'll use the package.json from our ANDROID folder
# but keep the RN scripts from the template
cd "$TEMP_DIR"

# Install our dependencies
npm install \
    @hookform/resolvers \
    @react-navigation/bottom-tabs \
    @react-navigation/native \
    @react-navigation/stack \
    @tanstack/react-query \
    axios \
    date-fns \
    numeral \
    react-hook-form \
    react-native-device-info \
    react-native-gesture-handler \
    react-native-linear-gradient \
    react-native-mmkv \
    react-native-reanimated \
    react-native-safe-area-context \
    react-native-screens \
    react-native-svg \
    react-native-vector-icons \
    zod \
    zustand

# Dev dependencies
npm install -D \
    @types/numeral \
    @types/react-native-vector-icons \
    babel-plugin-module-resolver

# Step 5: Android configuration
echo ""
echo "[5/6] Configuring Android..."

# Update android/local.properties
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# Update android/app/build.gradle to enable vector icons
# (This is handled automatically by react-native-vector-icons)

# Step 6: Rename and finalize
echo ""
echo "[6/6] Finalizing..."

# Rename temp directory
cd "$PARENT_DIR"
rm -rf "$NATIVE_DIR"
mv "$TEMP_DIR" "$NATIVE_DIR"

echo ""
echo "======================================"
echo "SETUP COMPLETE!"
echo "======================================"
echo ""
echo "Project created at: $NATIVE_DIR"
echo ""
echo "Next steps:"
echo "  1. cd $NATIVE_DIR"
echo "  2. Update src/services/api.ts with your API URL"
echo "  3. npx react-native run-android"
echo ""
echo "To build release APK:"
echo "  cd $NATIVE_DIR/android"
echo "  ./gradlew assembleRelease"
echo ""
