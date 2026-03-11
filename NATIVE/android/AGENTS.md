# `NATIVE/android/` AGENTS.md

## Scope
Android shell for the React Native app.

## Key files
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/tradequipnative/MainActivity.kt`
- `app/src/main/java/com/tradequipnative/MainApplication.kt`
- `app/src/main/res/xml/network_security_config.xml`
- `app/build.gradle`

## Rules
- Keep native business logic in `NATIVE/src/` unless it must be Android-only.
- Preserve app links, screenshot blocking, and network-security constraints.
- Treat `google-services.json` as operator material; do not assume the tracked file is a release credential.
- Keep release log stripping and hardened manifest settings intact.

## Checks
- `cd NATIVE && npm run build:android`
