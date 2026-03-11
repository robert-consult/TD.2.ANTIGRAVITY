# TradeQuip Mobile Wrapper

`MOBILE/` is the Capacitor wrapper for the web app. It targets both Android and iOS and stays in remote-URL mode for production so cookie sessions, CSRF, and `/ws` remain same-origin with the server.

## Source Of Truth

- User-facing trader/support UI lives in `client/`.
- `MOBILE/src/mobile/` is limited to wrapper bridge helpers such as lifecycle, deep-link, push, and session utilities.
- The generated native shells are already physically split and should stay that way:
  - `MOBILE/android/` for the Android wrapper
  - `MOBILE/ios/` for the iOS wrapper

## Runtime Origins

- Production: `https://tradehub.example.com`
- Local Android: `http://localhost:5000` after `adb reverse tcp:5000 tcp:5000`
- Local iOS simulator: `http://localhost:5000`
- Trusted HTTPS tunnel: use `npm run tunnel:android`

`CAPACITOR_SERVER_URL` overrides the runtime origin. If it is unset, production builds fall back to `https://tradehub.example.com`.

## Commands

```bash
cd MOBILE
npm install
npm run sync
npm run doctor
npm run open:android
npm run open:ios
npm run run:android
npm run run:ios   # macOS + Xcode only
npm run build:android:release
```

## Security Notes

- Production wrapper builds are expected to use HTTPS/WSS only.
- Android and iOS shells are constrained to the canonical app host allowlist.
- Placeholder certificate pins are not release-ready; release builds must be supplied with real ops-managed pin material.
- Deep links must resolve only through `tradehub.example.com` or the `tradequip://` scheme.

## Status

The old wrapper-only UI components under `MOBILE/src/mobile/components/` are no longer the source of truth and have been removed. Historical docs that describe a parallel Capacitor feature app should be treated as archival unless revalidated.

Android wrapper sync/build validation is available from this Linux host. iOS wrapper execution still requires macOS + Xcode and will fail fast with a clear guard message on non-Darwin hosts.
