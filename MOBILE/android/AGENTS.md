# `MOBILE/android/` AGENTS.md

## Scope
Android shell for the Capacitor wrapper.

## Key files
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/tradequip/app/MainActivity.java`
- `app/src/main/res/xml/network_security_config.xml`
- `app/build.gradle`

## Rules
- This layer hosts shell configuration only. Feature UI belongs in `client/`.
- Keep the wrapper in remote-URL mode and limited to the canonical host allowlist.
- Dev-only cleartext/localhost exceptions must stay isolated to debug scenarios.
- Screenshot protection, WebView hardening, and release log minimization must not be removed casually.
- Treat signing files as operator material; do not assume tracked artifacts are release-ready.

## Checks
- `cd MOBILE && npm run doctor`
- `cd MOBILE && npm run build:android:release`
