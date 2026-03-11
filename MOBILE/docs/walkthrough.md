# Capacitor Wrapper Walkthrough

> Current architecture guide for `MOBILE/`. This is no longer an Android-only or wrapper-local UI project.

## What The Wrapper Actually Does

1. Capacitor launches a native Android or iOS shell.
2. The shell loads the live web app from the canonical host or an explicit local/tunnel override.
3. `client/src/components/MobileWrapperBridge.tsx` activates wrapper-only behavior from inside the web app.
4. `MOBILE/src/mobile/utils/*` provides deep-link parsing, session monitoring, push registration, safe-area helpers, and lifecycle integration.
5. Native shell files in `MOBILE/android/` and `MOBILE/ios/` enforce the host allowlist, transport policy, and screen-capture protections.

## Directory Map

```text
MOBILE/
├── capacitor.config.ts
├── android/                  # Android shell
├── ios/                      # iOS shell
├── src/mobile/
│   ├── hooks/                # platform detection hooks
│   └── utils/                # bridge-only utilities
├── scripts/                  # sync, JDK, tunnel, iOS guard helpers
└── docs/                     # current-state wrapper docs
```

## Source Of Truth

- Trader/support UI stays in `client/`.
- The deleted files under `MOBILE/src/mobile/components/*` had no replacement in `MOBILE/` because the replacement is the actual web application.
- Route state for the dashboard-style wrapper flows is now query-backed:
  - `/`
  - `/?tab=quotes`
  - `/?tab=chart&symbol=USDJPY`
  - `/?tab=trade&symbol=USDJPY`
  - `/?tab=history`
  - `/?tab=leaderboard`
  - `/?tab=account`
  - `/?tab=account&panel=mailbox`

## Commands

```bash
cd MOBILE
npm install
npm run sync
npm run doctor
npm run run:android
npm run build:android:release
npm run run:ios   # macOS + Xcode only
```

## Validation Status

- `npm run sync` is the authoritative wrapper refresh path and syncs both Android and iOS shells.
- Android release builds are runnable from this Linux host.
- iOS execution is intentionally blocked on non-macOS hosts by `scripts/run-ios.sh`.

## Remaining Release Work

- Replace any placeholder or legacy signing / Firebase files with operator-managed release credentials.
- Provide production certificate pin values out of band.
- Complete physical-device Android and iPhone matrix testing from the testing checklist.
