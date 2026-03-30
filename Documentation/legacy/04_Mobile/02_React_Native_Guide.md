# React Native Guide

> **Diátaxis quadrant:** How-To + Reference
> **Sources:** `NATIVE/AGENTS.md`, `NATIVE/src/AGENTS.md`

---

## Overview

The React Native app (`NATIVE/`) is a true native mobile application with native UI components for both Android and iOS.

---

## Key Entrypoints

| File | Purpose |
|---|---|
| `NATIVE/src/App.tsx` | App + deep-link wiring |
| `NATIVE/src/navigation/` | Screen navigation |
| `NATIVE/src/hooks/` | Data hooks |
| `NATIVE/src/services/api.ts` | API client |
| `NATIVE/src/services/csrf.ts` | CSRF token management |
| `NATIVE/src/services/websocket.ts` | WS with auto-reconnect |
| `NATIVE/src/services/runtimeConfig.ts` | Host, deep links, push env |
| `NATIVE/src/services/pushNotifications.ts` | Push registration |

---

## NFRs

- **Render loop:** Use `React.memo`, `useMemo`, stable callbacks
- **Startup:** Lazy load heavy screens; initialize SDKs after interaction
- **Animations:** Use `react-native-reanimated` (UI thread)
- **Security:** HTTPS only, no sensitive logs in release, Zod input validation
- **Offline:** Graceful degradation with cached data, WS auto-reconnect

---

## Development Workflow

```bash
cd NATIVE
npm install
npm test
npm run lint
npm run build:android
npm run pod:install && npm run build:ios  # macOS only
```

---

## Related Pages

- [Architecture Comparison →](00_Architecture_Comparison.md)
- [App Signing →](03_Signing_Distribution.md)
