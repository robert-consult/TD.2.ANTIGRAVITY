# Native iOS Task Tracker

> Current-state tracker for the iOS shell under `NATIVE/ios/`.

## Shared RN App Status
- [x] Shared React Native screens/hooks/components live in `NATIVE/src/` for both Android and iOS.
- [x] Native transport stack uses canonical runtime config, CSRF bootstrap, legal-signal handling, and shared WS reconnection behavior.
- [x] Deep-link handling maps `tradequip://` and `https://tradehub.example.com` into the shared navigator.

## iOS Shell Status
- [x] Podfile updated to the current RN 0.83 syntax used in this repo
- [x] App delegate, Info.plist, entitlements, and universal-link configuration present
- [x] Non-macOS pod/build commands fail fast with explicit Xcode requirements

## Validated From This Host
- [x] `cd NATIVE && npm test`
- [x] `cd NATIVE && npm run lint`
- [x] Non-Darwin guards for `npm run pod:install` and `npm run build:ios`

## Remaining Operator / macOS Work
- [ ] Run `cd NATIVE && npm run pod:install` on macOS + Xcode
- [ ] Run `cd NATIVE && npm run ios` / `npm run build:ios` on macOS + Xcode
- [ ] Replace placeholder `GoogleService-Info.plist` with environment-correct Firebase/APNs config
- [ ] Configure Apple signing, provisioning profiles, and App Store / TestFlight release flow
- [ ] Execute iPhone/simulator matrix tests for auth, trade flows, mailbox, notifications, and deep links
