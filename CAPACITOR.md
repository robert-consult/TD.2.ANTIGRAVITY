# Capacitor (Android/iOS) readiness

This repo is a Vite + React web app served by an Express server. Capacitor can wrap the same UI for Android/iOS.

## Status
- Web app: `npm run dev` (dev) / `npm run build && npm run start` (prod)
- Capacitor packages: installed (`@capacitor/*` v8)
- Capacitor config: `capacitor.config.ts`

## Recommended approach (keeps cookie sessions working)
Use **remote URL mode** so the UI and `/api` + `/ws` stay **same-origin**.

Set `CAPACITOR_SERVER_URL` to your deployed domain (or to your local dev server for emulator/device testing), then sync/open:

```bash
CAPACITOR_SERVER_URL="https://YOUR_DOMAIN" npm run cap:sync
npm run cap:add:android
npm run cap:open:android
```

Common local dev URLs (secure context required for WebCrypto-based identity):
- Android emulator/device (recommended) → `http://localhost:5000` (after `adb reverse tcp:5000 tcp:5000`)
- Android emulator/device (trusted HTTPS tunnel) → `https://<random>.trycloudflare.com`
- iOS simulator → `http://localhost:5000` (macOS only)

## Bundled assets mode (optional)
If you **do not** set `CAPACITOR_SERVER_URL`, Capacitor loads `dist/public` locally. In that mode you must point API/WS at a backend explicitly:
- `VITE_API_URL` or `VITE_APP_URL` for REST (`/api/*`)
- `VITE_WS_URL` or `VITE_APP_URL` for WebSockets (`/ws`)

Note: because the app uses **cookie sessions**, cross-origin REST/WS requires careful server-side CORS + cookie settings (e.g. `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` over HTTPS). Remote URL mode avoids this.

## Native toolchains (not in this repo)
- Android builds require: JDK + Android Studio/SDK + emulator/device setup
- iOS builds require: macOS + Xcode (+ CocoaPods, typically)
