# Native Android Task Tracker

> Current-state tracker for the Android shell under `NATIVE/android/`.

## Shared RN App Status
- [x] Shared React Native screens/hooks/components live in `NATIVE/src/` for both Android and iOS.
- [x] Native transport stack uses canonical runtime config, CSRF bootstrap, legal-signal handling, and shared WS reconnection behavior.
- [x] Deep-link handling maps `tradequip://` and `https://tradehub.example.com` into the shared navigator.

## Android Shell Status
- [x] App links and custom scheme intent filters configured
- [x] Network security config present
- [x] Screenshot blocking / shell hardening present in `MainActivity.kt`
- [x] Release Android build path available through `npm run build:android`

## Validated From This Host
- [x] `cd NATIVE && npm test`
- [x] `cd NATIVE && npm run lint`
- [x] `cd NATIVE && npm run build:android`

## Remaining Operator / Device Work
- [ ] Replace placeholder `android/app/google-services.json` with environment-correct Firebase config
- [ ] Validate production signing identity and store release process
- [ ] Execute physical-device Android matrix tests for auth, trade flows, mailbox, notifications, and deep links
- [ ] Complete Play Console release review
