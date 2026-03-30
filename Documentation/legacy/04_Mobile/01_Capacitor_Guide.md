# Capacitor Wrapper Guide

> **Diátaxis quadrant:** How-To + Reference
> **Sources:** `CAPACITOR.md`, `MOBILE/AGENTS.md`, `MOBILE/docs/`

---

## Architecture

The Capacitor wrapper runs the web app (`client/`) inside a native WebView. In production, it uses **remote URL mode** pointing to `tradehub.example.com`.

- **User-facing UI** lives in `client/`, NOT `MOBILE/src/mobile/`
- `MOBILE/src/mobile/` is bridge-only: lifecycle, deep links, push registration, session checks

---

## Key Files

| File | Purpose |
|---|---|
| `MOBILE/capacitor.config.ts` | Capacitor configuration |
| `client/src/components/MobileWrapperBridge.tsx` | Bridge activation in web app |
| `client/src/lib/appNavigation.ts` | App navigation helpers |
| `client/src/lib/dashboardUrlState.ts` | Dashboard URL state management |
| `MOBILE/src/mobile/` | Bridge hooks/utilities |

---

## Development Workflow

```bash
cd MOBILE
npm install
npm run sync          # Sync web build to native projects
npm run run:android   # Launch Android emulator
npm run run:ios       # Launch iOS simulator (macOS + Xcode only)
npm run doctor        # Android environment check
```

---

## Additional Guides

| Guide | Location |
|---|---|
| Android SDK Setup | `MOBILE/docs/ANDROID_SDK_SETUP.md` |
| App Signing | `MOBILE/docs/APP_SIGNING_GUIDE.md` |
| Push Notifications | `MOBILE/docs/PUSH_NOTIFICATION_SETUP.md` |
| Security Audit | `MOBILE/docs/SECURITY_AUDIT_GUIDE.md` |
| Testing Checklist | `MOBILE/docs/TESTING_CHECKLIST.md` |

---

## Related Pages

- [Architecture Comparison →](00_Architecture_Comparison.md)
- [App Signing →](03_Signing_Distribution.md)
