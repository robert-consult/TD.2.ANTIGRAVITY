# Native Android Walkthrough

## Architecture

- `NATIVE/src/` contains the shared React Native app code used by both platforms.
- `NATIVE/android/` contains only Android shell concerns: manifest, app links, network security config, splash/icon resources, and activity/application wiring.
- The canonical production host is `https://tradehub.example.com`.

## Important Files

- `NATIVE/src/App.tsx`
- `NATIVE/src/services/runtimeConfig.ts`
- `NATIVE/src/services/api.ts`
- `NATIVE/src/services/csrf.ts`
- `NATIVE/src/services/websocket.ts`
- `NATIVE/android/app/src/main/AndroidManifest.xml`
- `NATIVE/android/app/src/main/java/com/tradequipnative/MainActivity.kt`
- `NATIVE/android/app/src/main/res/xml/network_security_config.xml`

## Current Validation State

- Android release builds are available from this host with `npm run build:android`.
- Shared/native automated tests and linting pass from this repo state.
- Deep links, screenshot blocking, and network-security policies are wired into the Android shell.

## Remaining Release Steps

1. Replace placeholder/operator Firebase config with the correct environment file.
2. Confirm release signing identity and store metadata.
3. Run device-matrix manual tests for authentication, trade flows, mailbox, push, and deep links.
4. Produce the final signed store artifact and release evidence.
