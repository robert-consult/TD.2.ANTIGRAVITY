# Mobile Native Audit 2 — Gold Standard Critique And Corrected Fix Plan

> Verified against current tree on 2026-03-10.
> Purpose: keep only fixes that meet current engineering and release standards, reject stale or misleading ones, and preserve local testing ergonomics.
> Scope: 7 findings from Deep Audit 2, re-triaged against the live repo.

---

## Triage Summary

### Accept
- `#4` Consolidate wrapper-side CSRF fetch logic
- `#7` Enable release-only Android wrapper shrinking/obfuscation, with verification
- `#9` Fix the stale Android-specific comment in native auth hook

### Accept With Changes
- `#11` Release Firebase handling: do not stop at a warning-only approach; keep local smoke builds working, but require an explicit deployment-time gate

### Reject / Superseded
- `#5` Deprecated `init-native.sh`: superseded by a repo-local bootstrap fix already in place
- `#3` Native HTTPS tunnel script: rejected as not justified by the current RN runtime model and likely to complicate local testing
- `#12` Safe-area `env()` cleanup: the suggested edit is incomplete and low-value because the helper is currently unused; if touched later, fix the variable contract end-to-end rather than only trimming one function

### Local Testing Caveat
- Do not turn release-only secret checks into blanket local blockers.
- Any release gate for Firebase/signing material must be opt-in for local smoke builds and mandatory in deployment/CI.
- Deployment-only caveats are tracked in `.agents/PRODUCTION_REQUIREMENTS.md`.

---

## Fix #4 — Consolidate Duplicate Wrapper CSRF Fetch Logic

**Why this holds up:** The live tree still has two duplicate wrapper-side `fetchCsrfToken()` implementations in `MOBILE/` that bypass shared constants. Consolidating them is low-risk and improves parity with the shared CSRF contract.

**Files to modify:**

### Step 1: Create a single wrapper-local CSRF utility

**Create** `MOBILE/src/mobile/utils/csrf.ts`:

```typescript
import {
  CSRF_HEADER_NAME,
  CSRF_TOKEN_ENDPOINT,
} from "@shared/security/csrf";

let csrfTokenPromise: Promise<string | null> | null = null;

export async function fetchCsrfToken(): Promise<string | null> {
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = (async () => {
    try {
      const response = await fetch(CSRF_TOKEN_ENDPOINT, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return typeof payload?.csrfToken === "string" ? payload.csrfToken : null;
    } catch {
      return null;
    } finally {
      csrfTokenPromise = null;
    }
  })();

  return csrfTokenPromise;
}

export async function fetchWithCsrf(url: string, init: RequestInit): Promise<Response> {
  const token = await fetchCsrfToken();
  const headers = new Headers(init.headers ?? {});
  if (token) {
    headers.set(CSRF_HEADER_NAME, token);
  }
  return fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
}
```

This utility should stay wrapper-local. Do not try to collapse the web `client/` and React Native `NATIVE/` CSRF layers into one cross-runtime helper; they run in different environments and already have their own abstractions.

### Step 2: Update `session-manager.ts`

**File:** `MOBILE/src/mobile/utils/session-manager.ts`

- **Delete** the local `fetchCsrfToken()` function.
- **Add** import at top: `import { fetchCsrfToken } from "./csrf";`

### Step 3: Update `push-notifications.ts`

**File:** `MOBILE/src/mobile/utils/push-notifications.ts`

- **Delete** the local `fetchCsrfToken()` function.
- **Delete** the local `fetchWithCsrf()` function.
- **Add** import at top: `import { fetchCsrfToken, fetchWithCsrf } from "./csrf";`

### Step 4: Re-export from barrel

**File:** `MOBILE/src/mobile/utils/index.ts`

- **Add** line: `export { fetchCsrfToken, fetchWithCsrf } from "./csrf";`

### Verification

- Run `npm run check` to confirm no type errors.
- Grep for any remaining hardcoded `/api/csrf` in `MOBILE/src/`: should only exist in the new `csrf.ts` if at all (it should use `CSRF_TOKEN_ENDPOINT` from shared).

---

## Fix #5 — Superseded

**Original recommendation:** Mark `NATIVE/init-native.sh` as deprecated and hard-exit.

**Critique:** This is stale. The better fix is not to leave a hazardous deprecated scaffold lying around; it is to make the script repo-local and safe. The current repo already uses the stronger fix:

- `NATIVE/init-native.sh` now bootstraps the checked-in `NATIVE/` directory in place
- `NATIVE/setup.sh` delegates to that safe bootstrap flow
- No sibling `ANDROID_NATIVE/` project should ever be created again

**Action:** No further code action needed. Keep this finding closed as superseded.

---

## Fix #7 — Enable ProGuard on MOBILE Release Builds

**File:** `MOBILE/android/app/build.gradle`

**Why this holds up:** Release-only shrinking/obfuscation is standard Android hardening and does not affect local debug testing when scoped correctly.

**Change**:
```groovy
minifyEnabled true
shrinkResources true
```

The existing `proguardFiles` line on line 47 already references both the default rules and `proguard-rules.pro`, so no further config is needed.

### Verification

- Run `cd MOBILE && bash scripts/with-jdk.sh ./android/gradlew -p android assembleRelease` to confirm the release build still succeeds.
- If build fails due to ProGuard stripping needed classes, add keep rules to `MOBILE/android/app/proguard-rules.pro`.

### Local Testing Caveat

- Keep this scoped to the `release` build type.
- Do not add debug-time minification that would slow iteration or obscure local failures.

---

## Fix #9 — Fix Incorrect Comment in `useAuth.ts`

**File:** `NATIVE/src/hooks/useAuth.ts`

**Find** (lines 1–4):
```typescript
/**
 * TradeQuip Android - Auth Hook
 * Aligned with webapp use-auth.tsx
 */
```

**Replace with:**
```typescript
/**
 * TradeQuip Native - Auth Hook
 * Aligned with webapp use-auth.tsx
 */
```

---

## Fix #12 — Optional Cleanup, Not A Priority Fix

**Original recommendation:** remove the `getPropertyValue("env(...)")` calls from `getSafeAreaInsets()`.

**Critique:** The observation is technically correct, but the proposed fix is incomplete and not important enough for this plan. The helper is currently unused, and the broader safe-area contract is already inconsistent:

- `getSafeAreaInsets()` reads `--sat/--sab/--sal/--sar`
- `useSafeArea()` reads `--safe-area-inset-*`
- neither helper is currently used by the live wrapper bridge or app shell

**Gold-standard treatment:** mark this as an optional follow-up. If this area is touched later, either:
- remove the dead helpers entirely, or
- align on one CSS variable contract and document where those variables are set

Do not spend priority budget here ahead of actual runtime, security, or release-hardening work.

---

## Fix #3 — Reject The Native HTTPS Tunnel Proposal

**Original recommendation:** add a `NATIVE/scripts/tunnel-dev.sh` helper and make Cloudflare-tunneled HTTPS part of the native local-dev flow.

**Critique:** This is not gold-standard for the current React Native app. The secure-context argument is based on browser/WebView behavior, not the current RN runtime. Adding a Cloudflare tunnel requirement to `NATIVE/` would increase local-dev complexity and introduce an external-network dependency without evidence that the current `10.0.2.2` / `localhost` setup is broken for the actual native auth path.

**Action:** Reject this item. Keep the existing local Android/iOS dev URLs unless a reproduced native-only secure-context bug justifies a targeted change.

**If a future change is needed:** prefer a small runtime-config override mechanism over a mandatory tunnel workflow.

---

## Fix #11 — Add A Release Gate That Does Not Hurt Local Testing

**File:** `MOBILE/android/app/build.gradle`

**Critique:** Warning-only is not enough for deployment hygiene, but a blanket hard fail would hurt local testing and release smoke builds.

**Gold-standard approach:**
- keep debug/local builds non-blocking
- emit a strong warning on release builds when `google-services.json` is absent
- add an explicit deployment/CI flag so missing Firebase config fails before deployment

**Recommended shape:**
```groovy
def isReleaseTask = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
def requireGoogleServicesForRelease =
    ((project.findProperty("tradequipRequireGoogleServicesForRelease") ?: System.getenv("TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE") ?: "0").toString() == "1")
def servicesJSON = file('google-services.json')
def hasGoogleServices = servicesJSON.exists() && servicesJSON.length() > 0

if (hasGoogleServices) {
    apply plugin: 'com.google.gms.google-services'
} else if (isReleaseTask) {
    logger.warn("WARNING: google-services.json not found — release APK will build without push notification support")
    if (requireGoogleServicesForRelease) {
        throw new GradleException("google-services.json is required for release when TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1")
    }
}
```

**Deployment note:** this is complementary to `.agents/PRODUCTION_REQUIREMENTS.md`; operator-managed Firebase material still must replace placeholders before deployment.

---

## Execution Order (Recommended)

1. **#9** — Trivial comment fix
2. **#4** — Wrapper CSRF consolidation
3. **#7** and **#11** — Android wrapper release hardening together
4. **#5** — No action; already superseded
5. **#12** — Optional cleanup only if that module is being touched anyway
6. **#3** — Reject unless a real native runtime defect is reproduced

## Post-Fix Verification

```bash
# Repo type check
npm run check

# NATIVE tests
cd NATIVE && npm test

# MOBILE Android release build (validates shrinking + release Firebase gate behavior)
cd MOBILE && bash scripts/with-jdk.sh ./android/gradlew -p android assembleRelease
```

### Additional Gate For Deployment Hygiene

```bash
cd MOBILE
TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1 \
  bash scripts/with-jdk.sh ./android/gradlew -p android assembleRelease
```

## Validation Status

- Implemented: `#4`, `#7`, `#9`, and the stronger form of `#11`
- Verified:
  - `npm run check`
  - `cd MOBILE && npm run sync`
  - `cd MOBILE && bash scripts/with-jdk.sh ./android/gradlew -p android assembleRelease`
  - `cd MOBILE && TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1 bash scripts/with-jdk.sh ./android/gradlew -p android assembleRelease`
- Observed behavior:
  - local wrapper release smoke builds still succeed without `google-services.json`
  - deployment-mode release builds fail fast with an explicit message when Firebase material is required but missing
