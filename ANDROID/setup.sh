#!/bin/bash
# TradeQuip ANDROID - Setup Script
# Run this script from within WSL

set -e

echo "======================================"
echo "TradeQuip ANDROID Setup"
echo "======================================"

# Check Node.js
echo -n "Node.js: "
node --version || { echo "MISSING - Please install Node.js 18+"; exit 1; }

# Check npm
echo -n "npm: "
npm --version || { echo "MISSING"; exit 1; }

# Check Java
echo -n "Java: "
if command -v java &> /dev/null; then
    java -version 2>&1 | head -1
else
    echo "MISSING - Installing OpenJDK 17..."
    sudo apt-get update && sudo apt-get install -y openjdk-17-jdk
fi

# Check ANDROID_HOME
echo -n "Android SDK: "
if [ -d "$ANDROID_HOME" ]; then
    echo "$ANDROID_HOME"
elif [ -d "/home/bcodex/Android/Sdk" ]; then
    export ANDROID_HOME="/home/bcodex/Android/Sdk"
    echo "$ANDROID_HOME (auto-detected)"
else
    echo "MISSING - Please install Android SDK"
    echo "Set ANDROID_HOME environment variable"
    exit 1
fi

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
cd /home/bcodex/TD.2.ANTIGRAVITY/ANDROID
npm install

echo ""
echo "======================================"
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. npx react-native init TradeQuipNative --template react-native-template-typescript"
echo "2. Copy src/ folder to the initialized project"
echo "3. cd android && ./gradlew assembleRelease"
echo "======================================"
