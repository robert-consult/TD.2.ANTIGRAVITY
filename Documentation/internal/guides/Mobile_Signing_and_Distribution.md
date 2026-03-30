---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - .agents/PRODUCTION_REQUIREMENTS.md
  - MOBILE/android/key.properties.example
  - MOBILE/android/app/build.gradle
  - NATIVE/android/app/build.gradle
  - NATIVE/ios/TradeQuipNative.xcodeproj/project.pbxproj
  - CAPACITOR.md
last_verified: 2026-03-29
status: maintained
---

# Mobile Signing And Distribution

## Source-Of-Truth Rule

Operator-managed release credentials are the source of truth. Checked-in keystores, Firebase config files, or example key-property files in the repo are not authoritative production secrets.

## Wrapper Surface

- Android wrapper release builds use `cd MOBILE && npm run build:android:release`
- signing configuration is shell-specific under `MOBILE/android/`
- iOS wrapper execution and release work still require macOS + Xcode

## Native Surface

- Android native release builds use `cd NATIVE && npm run build:android`
- iOS native release builds use `cd NATIVE && npm run pod:install` and `cd NATIVE && npm run build:ios`
- release provisioning, signing identities, and push entitlements are platform-operator concerns, not repo-default assumptions

## Guardrails

- do not treat repository-resident keystores or plist/json push files as production truth
- align release signing and push provisioning with `.agents/PRODUCTION_REQUIREMENTS.md`
- keep secret material out of docs, source control, and generated artifacts
