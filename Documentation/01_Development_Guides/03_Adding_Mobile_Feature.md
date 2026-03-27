# Adding a Mobile Feature

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `PROJECT_STRUCTURE.md` §Adding a New Mobile Feature, `MOBILE/AGENTS.md`, `NATIVE/AGENTS.md`

---

## Decision Matrix

| Question | Capacitor (`MOBILE/`) | React Native (`NATIVE/`) |
|---|---|---|
| Need native UI? | ❌ Web-based UI only | ✅ True native components |
| Update speed? | ✅ Instant (web deploy) | ❌ App store submission |
| Performance critical? | ❌ WebView overhead | ✅ Native rendering |
| Bridge complexity? | Minimal (bridge-only) | Full native app |

---

## Capacitor Workflow

1. **UI changes** → Modify `client/` (web app is the source of truth)
2. **Bridge hooks** → `MOBILE/src/mobile/` (lifecycle, deep links, push, session)
3. **Sync** → `cd MOBILE && npm run sync`
4. **Test** → `npm run run:android` or `npm run run:ios` (macOS + Xcode only)

> User-facing UI lives in `client/`, NOT `MOBILE/src/mobile/`.

---

## React Native Workflow

1. **Services** → `NATIVE/src/services/` (API, CSRF, WS, push, runtime config)
2. **Screens** → `NATIVE/src/screens/` or `NATIVE/src/navigation/`
3. **Hooks** → `NATIVE/src/hooks/`
4. **Test** → `cd NATIVE && npm test && npm run lint`
5. **Build** → `npm run build:android` or `npm run build:ios` (macOS only)

> Reuse `shared/` transport/security contracts. Do not reimplementing host, CSRF, WS, or locale rules per screen.

---

## Related Pages

- [Architecture Comparison →](../04_Mobile/00_Architecture_Comparison.md)
- [Capacitor Guide →](../04_Mobile/01_Capacitor_Guide.md)
- [React Native Guide →](../04_Mobile/02_React_Native_Guide.md)
