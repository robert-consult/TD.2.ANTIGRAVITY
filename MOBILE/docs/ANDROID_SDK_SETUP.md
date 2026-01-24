# Android SDK Setup for WSL

## Overview

This guide documents how to set up the Android SDK in WSL for building the TradeQuip mobile app.

---

## Install Android SDK in WSL

### 1. Download Command Line Tools

```bash
mkdir -p ~/Android/Sdk/cmdline-tools
cd ~/Android/Sdk/cmdline-tools

# Download latest command line tools
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-*.zip
mv cmdline-tools latest
rm commandlinetools-linux-*.zip
```

### 2. Set Environment Variables

Add to `~/.bashrc` or `~/.zshrc`:

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/build-tools/36.1.0
```

Reload shell:
```bash
source ~/.bashrc
```

### 3. Accept Licenses

```bash
yes | sdkmanager --licenses
```

### 4. Install Required Components

```bash
sdkmanager "platform-tools"
sdkmanager "platforms;android-36"
sdkmanager "build-tools;36.1.0"
sdkmanager "build-tools;35.0.0"  # Fallback version
```

---

## Configure Project

### Create local.properties

```bash
cd /home/bcodex/TD.2.ANTIGRAVITY/MOBILE/android
echo "sdk.dir=/home/bcodex/Android/Sdk" > local.properties
```

---

## Known Build Issues & Fixes

### Issue: Duplicate .gz Assets

**Error**: `Duplicate files copied in APK` for compressed assets

**Solution**: Add to `android/app/build.gradle`:

```gradle
android {
    // ... existing config ...
    
    packagingOptions {
        // Exclude duplicate compressed assets
        exclude 'assets/**/*.gz'
        exclude 'assets/**/*.br'
    }
}
```

This prevents Gradle from including both original and pre-compressed versions of static assets.

### Issue: flatDir Warning

**Warning**: `Using flatDir should be avoided`

**Impact**: Non-critical warning, does not affect build. This is from Capacitor Cordova plugin compatibility layer.

---

## Verify Installation

```bash
# Check SDK location
echo $ANDROID_HOME
ls -la $ANDROID_HOME

# Check tools
adb version
sdkmanager --version

# Test build
cd /home/bcodex/TD.2.ANTIGRAVITY/MOBILE/android
./gradlew :app:assembleDebug
```

---

## Build Outputs

| Build Type | Location |
|------------|----------|
| Debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Release APK | `android/app/build/outputs/apk/release/app-release.apk` |
| Release AAB | `android/app/build/outputs/bundle/release/app-release.aab` |

---

## Troubleshooting

### SDK location not found
- Verify `local.properties` exists with correct `sdk.dir` path
- Check environment variables are set

### License not accepted
- Run `sdkmanager --licenses` and accept all

### Build tools not found
- Install specific version: `sdkmanager "build-tools;36.1.0"`
