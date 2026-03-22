# Android App Signing Guide

> Android-only guide. iOS wrapper signing is handled separately in Xcode on macOS. Do not treat any tracked `key.properties` or keystore file as authoritative production signing material; release credentials must come from operator-managed sources.

## Overview

App signing is required for Play Store distribution. This guide covers both debug and release signing.

---

## Generate Release Keystore

```bash
install -d -m 700 ~/.config/tradequip/android-signing
cd ~/.config/tradequip/android-signing

# Generate keystore outside the repo (keep this file secure!)
keytool -genkey -v \
  -keystore tradequip-release-key.keystore \
  -alias tradequip \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# Store credentials securely:
# - Key alias: tradequip
# - Keystore password: [your password]
# - Key password: [your password]
```

> **IMPORTANT**: Back up `tradequip-release-key.keystore` securely! 
> If lost, you cannot update your app on Play Store.

---

## Configure Gradle for Signing

### Create an operator-managed `key.properties` file outside the repo

```properties
storePassword=your_keystore_password
keyPassword=your_key_password
keyAlias=tradequip
storeFile=tradequip-release-key.keystore
```

The wrapper now expects release signing configuration through one of these inputs:

- default local operator path: `~/.config/tradequip/android-signing/key.properties`
- `TRADEQUIP_ANDROID_KEY_PROPERTIES=/secure/path/key.properties`
- `-PtradequipAndroidKeyPropertiesPath=/secure/path/key.properties`

Do not place populated `key.properties` or release keystores under `MOBILE/android/`. Keep the external directory `0700` and the populated `key.properties` / keystore `0600`.

### Reference build.gradle wiring

The current Gradle wiring checks the standard external path first, then allows explicit overrides through the env var or Gradle property. Release builds fail closed if no operator-managed signing file is available.

---

## Build Signed APK/AAB

```bash
cd MOBILE/android

# Build signed APK
./gradlew assembleRelease

# APK location: app/build/outputs/apk/release/app-release.apk

# Build signed AAB (for Play Store)
./gradlew bundleRelease

# AAB location: app/build/outputs/bundle/release/app-release.aab
```

If you keep the signing file somewhere else, override it explicitly:

```bash
TRADEQUIP_ANDROID_KEY_PROPERTIES=/secure/path/key.properties ./gradlew assembleRelease
./gradlew -PtradequipAndroidKeyPropertiesPath=/secure/path/key.properties bundleRelease
```

---

## Play App Signing (Recommended)

Google Play App Signing provides additional security:

1. Go to Play Console → App → Setup → App signing
2. Choose "Use Google-generated key"
3. Upload your app bundle (AAB)
4. Google manages the app signing key

Benefits:
- Smaller download sizes
- Key recovery if lost
- Enhanced security

---

## ProGuard Configuration

Create `android/app/proguard-rules.pro`:

```proguard
# Capacitor
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# WebView
-keepclassmembers class * extends android.webkit.WebView {
    public *;
}

# Keep annotations
-keepattributes *Annotation*
```

---

## Version Management

Update `android/app/build.gradle`:

```gradle
android {
    defaultConfig {
        versionCode 1        // Increment for each release
        versionName "1.0.0"  // Semantic version
    }
}
```

---

## Checklist Before Release

- [ ] Generate release keystore
- [ ] Configure `~/.config/tradequip/android-signing/key.properties` or an equivalent operator-managed override path outside the repo
- [ ] Update versionCode and versionName
- [ ] Test release build on device
- [ ] Enable ProGuard/R8
- [ ] Verify network security config
- [ ] Check app icon renders correctly
- [ ] Test all deep links
- [ ] Verify push notifications work
