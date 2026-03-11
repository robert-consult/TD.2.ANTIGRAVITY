# Native iOS Walkthrough

## Architecture

- `NATIVE/src/` contains the shared React Native app code used by both platforms.
- `NATIVE/ios/` contains only iOS shell concerns: Podfile, entitlements, Info.plist, AppDelegate, asset catalogs, and Xcode project wiring.
- The canonical production host is `https://tradehub.example.com`.

## Important Files

- `NATIVE/src/App.tsx`
- `NATIVE/src/services/runtimeConfig.ts`
- `NATIVE/src/services/api.ts`
- `NATIVE/src/services/csrf.ts`
- `NATIVE/src/services/websocket.ts`
- `NATIVE/ios/Podfile`
- `NATIVE/ios/TradeQuipNative/AppDelegate.mm`
- `NATIVE/ios/TradeQuipNative/Info.plist`
- `NATIVE/ios/TradeQuipNative/*.entitlements`

## Current Validation State

- Shared/native automated tests and linting pass from this repo state.
- iOS shell files are present and aligned with the current RN version in the repo.
- Non-macOS pod/build paths fail fast by design to avoid misleading partial readiness on Linux/WSL.

## Remaining Release Steps

1. Run CocoaPods and build flows on macOS with Xcode installed.
2. Replace placeholder/operator Firebase/APNs material with environment-correct release config.
3. Configure Apple signing, provisioning profiles, and release archives in Xcode.
4. Run simulator and physical iPhone matrix tests for authentication, trades, mailbox, push, and deep links.
