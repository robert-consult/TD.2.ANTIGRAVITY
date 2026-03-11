# Mobile Native Deep Audit 2
## Granular Code-Level Investigation — TradeQuip TD.2.ANTIGRAVITY
**Date:** 2026-03-10 | **Scope:** All files in `MOBILE/`, `NATIVE/`, and cross-repo integration points

---

## Executive Summary

This second-pass audit goes beyond the structural review of Deep Audit 1 and inspects **every source file** in both the Capacitor wrapper (`MOBILE/`) and the React Native app (`NATIVE/`), as well as all cross-repo bridge points in `client/` and `server/`. **12 granular findings** were identified, including 3 critical security issues, 4 architectural concerns, and 5 code-quality items.

> **Update 2026-03-10:** Findings **#4**, **#7**, **#9**, and **#11** have been **RESOLVED**. See individual sections for details.

---

## 1. CRITICAL — Plaintext Signing Credentials Checked Into Repository

**File:** `MOBILE/android/key.properties`

The release keystore password (`tradequip2026`), key password, and key alias are stored in plaintext and tracked by Git. The actual keystore file (`tradequip-release-key.keystore`) is also checked in.

**Impact:** Anyone with repo access can sign APKs as the official app. If this keystore is used for Play Store uploads, it constitutes a **complete signing identity compromise**.

**Remediation:**
- Add `key.properties` and `*.keystore` to `.gitignore` immediately.
- Rotate the keystore and passwords. If ever uploaded to Play Store, use Play App Signing and revoke the upload key.
- Store signing material in CI secrets (GitHub Actions Secrets, Vault, etc.).

---

## 2. CRITICAL — Direct Cross-Subtree Import in MobileWrapperBridge

**File:** `client/src/components/MobileWrapperBridge.tsx` (lines 16–20)

```typescript
import { ... } from "../../../MOBILE/src/mobile/utils";
import type { ... } from "../../../MOBILE/src/mobile/utils";
```

The web client directly imports from `MOBILE/src/mobile/` via a relative `../../../` path. This creates a hard coupling between two supposedly independent subtrees.

**Impact:**
- Breaks if `MOBILE/` is ever moved, renamed, or published as a separate package.
- TypeScript path resolution may fail in production builds depending on bundler config.
- Violates the documented rule that `MOBILE/` and `client/` are independent.

**Remediation:**
- Extract the shared bridge utilities into a `shared/mobile/` or `packages/mobile-bridge/` workspace package.
- Import via a clean alias (e.g., `@shared/mobile-bridge`).

---

## 3. CRITICAL — NATIVE Dev Mode Uses HTTP Which Breaks WebCrypto

**File:** `NATIVE/src/services/runtimeConfig.ts` (lines 8–11)

```typescript
const DEV_APP_URL =
    Platform.OS === 'android'
        ? 'http://10.0.2.2:5000'
        : 'http://localhost:5000';
```

In `__DEV__` mode, the native app connects over plain HTTP. Android WebView and React Native's networking layer require a secure context for `crypto.subtle` (WebCrypto). The MOBILE wrapper documents this risk but the NATIVE app has no equivalent warning or HTTPS tunnel script.

**Impact:** Login and bot-proof identity flows will silently fail in dev unless the developer manually sets up an HTTPS tunnel. New developers will waste time debugging auth failures.

**Remediation:**
- Add a `scripts/tunnel-dev.sh` for NATIVE (mirroring `MOBILE/scripts/trycloudflare-tunnel.sh`).
- Add a runtime warning in dev mode if `crypto.subtle` is unavailable.
- Document the HTTPS tunnel requirement in `NATIVE/README.md`.

---

## 4. ~~WARNING~~ ✅ RESOLVED — Duplicate CSRF Fetch Logic

> **Resolved:** Consolidated into `MOBILE/src/mobile/utils/csrf.ts` which imports `CSRF_HEADER_NAME` and `CSRF_TOKEN_ENDPOINT` from `@shared/security/csrf`. Both `session-manager.ts` and `push-notifications.ts` now import from `./csrf` instead of having their own copies.

---

## 5. WARNING — `init-native.sh` Outputs to Wrong Directory

**File:** `NATIVE/init-native.sh` (line 58)

```bash
NATIVE_DIR="$PARENT_DIR/ANDROID_NATIVE"
```

The initialization script creates a folder named `ANDROID_NATIVE` one level up from `NATIVE/`, which contradicts the current project structure where the native app lives in `NATIVE/`. This script also installs dependencies using raw `npm install` package lists rather than the existing `package.json`.

**Impact:** Running this script will create a parallel directory that conflicts with the established structure.

**Remediation:** Mark this script as deprecated/archival or update it to install in-place.

---

## 6. WARNING — Missing iOS Deep Link / Universal Link Configuration

**Files:** `MOBILE/ios/App/App/` and `NATIVE/ios/`

Neither iOS project contains:
- An `apple-app-site-association` hosting reference
- An `Associated Domains` entitlement file (`.entitlements`)
- URL scheme registration in `Info.plist` for `tradequip://`

Both Android projects have proper intent filters, but iOS deep linking will silently fail without these configurations.

**Remediation:**
- Add `tradequip` URL scheme to both iOS `Info.plist` files.
- Configure Associated Domains entitlement for `tradehub.example.com`.
- Host the `apple-app-site-association` file at the production domain.

---

## 7. ~~WARNING~~ ✅ RESOLVED — No ProGuard / R8 Minification on Release Builds

> **Resolved:** `MOBILE/android/app/build.gradle` now has `minifyEnabled true` and `shrinkResources true` in the release build type. Debug builds remain unaffected.

---

## 8. INFO — WebSocket Singleton Initialized at Module Load

**File:** `NATIVE/src/services/websocket.ts` (lines 236–240)

```typescript
export const wsService = new WebSocketService({
    baseUrl: getWsBaseUrl(),
    ...
});
```

The WebSocket service URL is resolved at import time. If `runtimeConfig` is ever refactored to support dynamic config (e.g., environment switching), the WS URL will be stale.

**Remediation:** Consider lazy initialization or a `configure()` method.

---

## 9. ~~INFO~~ ✅ RESOLVED — `useAuth` Hook Comment Says "Android" But Applies to Both Platforms

> **Resolved:** Comment updated to `TradeQuip Native - Auth Hook` in `NATIVE/src/hooks/useAuth.ts`.

---

## 10. INFO — Push Notification Tests Are Minimal

**File:** `NATIVE/__tests__/pushNotifications.test.ts` (934 bytes)

At 934 bytes, this test file likely contains only basic smoke tests. Given the complexity of the push notification lifecycle (registration, token refresh, server sync, unregistration, notification tapping), this surface needs more coverage.

**Remediation:** Add tests for token refresh, server sync failure, and notification tap deep-link resolution.

---

## 11. ~~INFO~~ ✅ RESOLVED — Missing `google-services.json` Guard Silently Disables Push

> **Resolved:** `MOBILE/android/app/build.gradle` now emits a warning on release builds when `google-services.json` is missing, and hard-fails if `TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1` is set. Debug builds remain non-blocking.

---

## 12. INFO — `getSafeAreaInsets()` Uses Non-Standard CSS Properties

**File:** `MOBILE/src/mobile/utils/mobile-utils.ts` (lines 215–218)

```typescript
style.getPropertyValue("--sat") || style.getPropertyValue("env(safe-area-inset-top)")
```

`getComputedStyle` cannot read `env()` functions directly — they resolve in CSS but not via JavaScript's `getPropertyValue()`. The fallback `--sat` custom property is the actual mechanism, but the `env()` call is dead code that always returns empty string.

**Remediation:** Remove the misleading `env()` fallbacks and document that `--sat` etc. must be set by a CSS rule.

---

## Cross-Repo Flow Summary

| Flow | Source | Destination | Status |
|------|--------|-------------|--------|
| Wrapper bridge activation | `client/MobileWrapperBridge.tsx` | `MOBILE/src/mobile/utils` | ⚠️ Direct relative import |
| Deep-link parsing | `MOBILE/src/mobile/utils/deep-linking.ts` | `client/lib/appNavigation.ts` | ✅ Correct |
| Push device registration | `MOBILE/utils/push-notifications.ts` | `server/routes/pushDevices.ts` | ✅ Correct |
| Push device DB ops | `server/routes/pushDevices.ts` | `server/services/pushDevices.ts` | ✅ Correct with zod + audit |
| CSRF token flow | `NATIVE/src/services/csrf.ts` | `@shared/security/csrf` | ✅ Uses shared contracts |
| CSRF token flow (wrapper) | `MOBILE/src/mobile/utils/csrf.ts` | `@shared/security/csrf` | ✅ Now uses shared contracts |
| WebSocket protocol | `NATIVE/src/services/websocket.ts` | `@shared/ws/protocol` | ✅ Uses shared contracts |
| Auth state management | `NATIVE/src/hooks/useAuth.ts` | `NATIVE/src/services/api.ts` | ✅ Correct |
| Dashboard URL state | `client/lib/dashboardUrlState.ts` | `client/lib/appNavigation.ts` | ✅ Correct |

---

## Severity Matrix

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| 1 | Plaintext signing credentials in repo | 🔴 Critical | Low |
| 2 | Direct cross-subtree import | 🔴 Critical | Medium |
| 3 | HTTP dev mode breaks WebCrypto | 🔴 Critical | Low |
| 4 | ~~Duplicate CSRF fetch logic~~ | ✅ Resolved | — |
| 5 | `init-native.sh` outputs to wrong dir | 🟠 Warning | Low |
| 6 | Missing iOS deep link config | 🟠 Warning | Medium |
| 7 | ~~No ProGuard on release builds~~ | ✅ Resolved | — |
| 8 | WS singleton at module load | 🔵 Info | Low |
| 9 | ~~Incorrect comment in useAuth~~ | ✅ Resolved | — |
| 10 | Minimal push notification tests | 🔵 Info | Medium |
| 11 | ~~Silent push disable without firebase config~~ | ✅ Resolved | — |
| 12 | Dead `env()` calls in safe area util | 🔵 Info | Trivial |
