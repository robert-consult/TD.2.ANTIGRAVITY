# TradeQuip Native Apps

`NATIVE/` is the React Native app that targets both Android and iOS. It is separate from `MOBILE/` and uses native UI while sharing the same backend, auth, CSRF, WebSocket, locale, and mailbox/E2EE contracts as the web app.

## Current Direction

- Android and iOS are both in scope from this folder.
- Platform shells are intentionally demarcated:
  - `NATIVE/android/` for Android-native project files
  - `NATIVE/ios/` for iOS-native project files
  - `NATIVE/src/` for shared React Native app code
- Production origin is `https://tradehub.example.com`.
- Deep links accept `tradequip://` and `https://tradehub.example.com`.
- Transport/security logic should be reused from shared contracts, not reimplemented per screen.

## Commands

```bash
cd NATIVE
npm test
npm run lint
npm run android
npm run build:android
npm run pod:install   # macOS + Xcode only
npm run ios           # macOS + Xcode only
npm run build:ios     # macOS + Xcode only
```

## Security Notes

- Session-scoped mutations bootstrap CSRF through `/api/csrf`.
- Identity headers, bot-challenge retry, and shared WS protocol are mandatory.
- Push-device registration is session-authenticated and backed by `/api/push/*`.
- Production certificate pin material must come from release configuration, not placeholders in source.

## Scope

This app is for trader/support parity only. Admin and partner surfaces remain out of scope for native parity work.

Android builds are runnable from the current Linux/WSL environment when the Android SDK/JDK are present. iOS pod/build/run commands intentionally fail fast on non-macOS hosts because Apple toolchains are required.
