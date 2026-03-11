# `NATIVE/ios/` AGENTS.md

## Scope
iOS shell for the React Native app.

## Key files
- `Podfile`
- `TradeQuipNative/AppDelegate.mm`
- `TradeQuipNative/Info.plist`
- `TradeQuipNative/*.entitlements`
- `TradeQuipNative.xcodeproj/`

## Rules
- Keep Podfile syntax aligned with the checked-in React Native version.
- Preserve universal-link, push, and privacy configuration alignment with `tradehub.example.com`.
- Treat `GoogleService-Info.plist` as operator material; do not assume the tracked file is production-ready.
- iOS pod/build work requires macOS + Xcode. Keep the guard scripts intact for non-Darwin hosts.

## Checks
- `cd NATIVE && npm run pod:install` on macOS + Xcode only
- `cd NATIVE && npm run build:ios` on macOS + Xcode only
