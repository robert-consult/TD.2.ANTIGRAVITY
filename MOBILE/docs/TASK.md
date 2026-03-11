# Capacitor Wrapper Task Tracker

> Current-state tracker for `MOBILE/`. The wrapper now targets Android and iOS, and the web client is the only source of trader/support UI.

## Architecture Foundation
- [x] Wrapper-only architecture enforced; deleted `MOBILE/src/mobile/components/*` shadow UI is not coming back.
- [x] `client/src/components/MobileWrapperBridge.tsx` activates wrapper lifecycle, deep-link, push, and session bridge behavior from the live web app.
- [x] Dashboard/query navigation contract is normalized through `client/src/lib/dashboardUrlState.ts` and `client/src/lib/appNavigation.ts`.
- [x] Canonical production host is `https://tradehub.example.com`.

## Platform Shells
- [x] Android Capacitor shell present and synced.
- [x] iOS Capacitor shell present and wired.
- [x] Android network-security configuration and screenshot mitigation implemented.
- [x] iOS associated domains, ATS policy, and snapshot shielding implemented.
- [x] Non-macOS iOS execution is guarded and fails fast with explicit Xcode requirements.

## Wrapper Runtime
- [x] Same-origin session and CSRF behavior routed through the live web app.
- [x] Deep links and notification taps resolve to real web routes instead of deleted wrapper-local screens.
- [x] Push-device registration uses `/api/push/register` and logout-safe revocation uses `/api/push/unregister`.
- [x] Background/network/session monitoring is live from the wrapper bridge.

## Verified From This Host
- [x] `cd MOBILE && npm run sync`
- [x] `cd MOBILE && npm run build:android:release`
- [x] `cd MOBILE && npm run doctor` for Android
- [x] Wrapper bridge utility tests in `MOBILE/src/mobile/utils/*.test.ts`

## Still Operator / Device Bound
- [ ] Run the iOS wrapper on macOS with Xcode (`npm run run:ios`)
- [ ] Replace placeholder or legacy signing / Firebase material with operator-managed release credentials
- [ ] Finalize production certificate pin values from ops-managed release inputs
- [ ] Execute physical Android/iPhone manual matrix tests from `MOBILE/docs/TESTING_CHECKLIST.md`
