# Product Requirements Document: Persistent Login, Device Trust & Session Security Hardening

> **Version**: 2.0 — Enriched  
> **Last Updated**: 2026-02-15  
> **Status**: Draft — Pending Review

---

## 1. Executive Summary

This document defines the requirements for implementing a secure **"Remember Me" / Persistent Login** system, a **Trusted Device Registry**, and supporting **session security hardening** for the TradeQuip platform. The system must withstand class-leading attack vectors, integrate with the existing `secureCache` (AES-256-GCM encrypted IndexedDB), `sessionTrail` (geo/device/login-history audit infrastructure), and CSRF protections, and expose all configurable parameters through a new **"Session & Device Security"** card in the Admin System Config panel.

---

## 2. Problem Statement

### Current State
| Area | Current Behaviour | Gap |
|---|---|---|
| **Session Cookie** | `connect.sid`, `HttpOnly`, `Secure`, `SameSite=Lax`, **24-hour MaxAge** | Too short for daily-use traders; forces daily re-auth |
| **Session Store** | PostgreSQL (`connect-pg-simple`) or Valkey/Redis | No persistent token layer; session death = logout |
| **Client Cache** | `secureCache.ts` — AES-256-GCM + PBKDF2(100k) in IndexedDB, user-scoped | Caches user state but cannot re-establish auth |
| **Logout** | `endSession` deletes `userSessions` row, inserts `LOGOUT` history event | No mechanism to clear a "remember me" token |
| **Device Identity** | `deviceFp` + `deviceInstallId` headers captured in `sessionTrail` | No trust/persistent binding — used for grift detection only |
| **CSRF** | Double-submit cookie (`csrf.ts`) — session-scoped | Must remain intact after token-based session restoration |
| **Inactivity Deletion** | `inactivityThresholdDays` + `deletionGraceDays` in `systemConfig` | No configurable "forced re-auth after N days absence" |

### What This Solves
- **Convenience**: Traders stay logged in on trusted devices for configurable durations (up to 90 days).
- **Security**: Persistent tokens are hardened against theft, rotation exploits, and replay attacks.
- **Control**: Admins configure all thresholds (remember-me duration, max devices, forced re-auth window) from the System Config UI.

---

## 3. Goals & Non-Goals

### In Scope
1. "Stay logged in on this device" checkbox on the Login page.
2. Secure persistent token system (series-token with rotation + theft detection).
3. Trusted Device registry with user-visible management (revoke per-device or all).
4. Admin-configurable controls via a new SystemConfig card.
5. Forced re-authentication after configurable absence duration (day-level resolution, ms precision internally).
6. Full integration with existing `secureCache`, `sessionTrail`, and CSRF infrastructure.
7. Comprehensive attack vector and vulnerability mitigation.

### Out of Scope
- Multi-factor authentication (MFA) — future phase.
- Biometric unlock on mobile (Capacitor plugin) — future phase.
- Push notification–based "New Device Login" alerts — future phase.

---

## 4. User Stories

| ID | Role | Story | Priority |
|---|---|---|---|
| US-01 | Trader | I want to check "Stay logged in" so I don't re-enter my password daily. | P0 |
| US-02 | Mobile User | I expect the app to remember me until I explicitly log out. | P0 |
| US-03 | Security-Conscious User | I want to see all my trusted devices and revoke any of them. | P0 |
| US-04 | Trader | If I haven't used the app for a configurable period, I should be re-authenticated securely. | P1 |
| US-05 | Admin | I want to configure remember-me duration, max devices per user, and absence thresholds from the System Config panel. | P0 |
| US-06 | Admin | I want password changes and account locks to immediately invalidate all persistent tokens. | P0 |
| US-07 | Admin | I want to toggle Remember-Me globally (kill switch). | P1 |
| US-08 | Admin | I want to see if token theft was detected for any user and auto-revoke all their sessions. | P2 |

---

## 5. Functional Requirements

### 5.1 Login Interface Changes

- **Frontend (`LoginPage.tsx`)**: Add a toggle/checkbox "Stay logged in on this device" below the password field.
  - Pre-checked by default on mobile (Capacitor).
  - Unchecked by default on web (desktop/tablet).
- **API (`POST /api/auth/login`)**: Accept a `rememberMe: boolean` field in the request body.
  - Update `loginSchema` in `shared/schema.pg.ts` accordingly.

### 5.2 Persistent Token (Series-Token Model — OWASP-Aligned)

> [!IMPORTANT]
> The token system uses the **series-identifier pattern** recommended by OWASP for theft detection.

#### Token Structure
- **Selector** (`16 bytes`, hex-encoded = 32 chars): Public lookup key. Stored in DB as plaintext. Indexed for O(1) lookup.
- **Validator** (`32 bytes`, hex-encoded = 64 chars): Secret. **Hashed (SHA-256) before storage** in DB. Never stored in plaintext.
- **Cookie Value**: `selector:validator` (colon-separated, base64url-encoded as a single string).

#### Token Lifecycle (Server)
1. **On Login with `rememberMe=true`**:
   - Generate `selector` via `crypto.randomBytes(16)`.
   - Generate `validator` via `crypto.randomBytes(32)`.
   - Compute `validatorHash = SHA-256(validator)`.
   - Insert into `remember_me_tokens` with `userId`, `selector`, `validatorHash`, `expiresAt`, device/geo metadata.
   - Set `remember_me` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `MaxAge = rememberMeMaxAgeDays` (from SystemConfig).
   - Record `PERSISTENT_TOKEN_ISSUED` event in `userLoginHistory`.

2. **On Session Restoration (expired `connect.sid`, valid `remember_me` cookie)**:
   - Parse cookie → extract `selector` and `validator`.
   - Lookup DB by `selector`.
   - If not found → clear cookie, return 401.
   - If found but expired → delete record, clear cookie, return 401.
   - If found and not expired:
     - Compute `SHA-256(validator)` and **constant-time compare** against stored `validatorHash`.
     - **If match**: Restore session. **Rotate the token** (new selector + validator + hash; delete old record). Set new cookie. Record `SESSION_RESTORED_VIA_TOKEN` event.
     - **If mismatch (same selector, wrong validator)**: **Theft detected.** Revoke ALL persistent tokens for this user. Revoke ALL sessions for this user. Record `TOKEN_THEFT_DETECTED` event. Clear cookie. Return 401.

3. **On Explicit Logout**:
   - Parse `remember_me` cookie → extract selector.
   - Delete matching DB record.
   - Clear `remember_me` cookie.
   - Clear `connect.sid` cookie.
   - Destroy server session.
   - Record `LOGOUT` event (already exists in `sessionTrail`).

4. **On "Logout All Devices"**:
   - Call `revokeAllSessionsForUser` (existing function in `sessionTrail.ts`).
   - Additionally: `DELETE FROM remember_me_tokens WHERE user_id = ?`.
   - Clear current device's cookies.

5. **On Password Change / Account Lock / Account Freeze**:
   - Invalidate ALL `remember_me_tokens` for user.
   - Revoke ALL sessions via existing `revokeAllSessionsForUser`.

### 5.3 Forced Re-Authentication After Absence

> Resolution: day-level (configurable), but tracked with millisecond-precision timestamps internally.

- **Logic**: When restoring a session via persistent token, check `lastActiveAt` on the token record.
  - If `now - lastActiveAt > rememberMeReauthAfterAbsenceDays * 86400 * 1000 ms`:
    - Do NOT auto-restore session.
    - Clear cookies.
    - Redirect to login with `?reason=absence_reauth`.
    - Show user-friendly message: "For your security, please log in again — it's been a while."
- **Admin-Configurable**: `rememberMeReauthAfterAbsenceDays` in SystemConfig (default: 7 days).

### 5.4 Device Recognition & Trusted Devices Listing

- **User Settings Page**: New "Trusted Devices" section.
  - List: `deviceType`, `browser`, `os`, `lastUsedAt`, `createdAt`, `city/country`.
  - Actions: "Revoke this device", "Revoke all other devices".
- **Backend API**:
  - `GET /api/auth/devices` — list user's trusted devices.
  - `DELETE /api/auth/devices/:id` — revoke a specific device token.
  - `DELETE /api/auth/devices` — revoke all device tokens for user.

### 5.5 Admin System Config Card

> New card: **"Session & Device Security"** under the Controls minitab in the System Config admin page.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `rememberMeEnabled` | boolean | `true` | Global kill switch for Remember Me |
| `rememberMeMaxAgeDays` | integer | `30` | Max duration for persistent tokens (days) |
| `rememberMeMaxDevicesPerUser` | integer | `10` | Max trusted devices per user |
| `rememberMeReauthAfterAbsenceDays` | integer | `7` | Force re-auth after N days of absence |
| `rememberMeTokenRotationEnabled` | boolean | `true` | Rotate tokens on every use |
| `rememberMeTheftAutoRevokeAll` | boolean | `true` | Auto-revoke all sessions on theft detection |
| `sessionAbsoluteTimeoutDays` | integer | `1` | Default session cookie max-age (existing, surfaced here) |
| `sessionIdleTimeoutMinutes` | integer | `0` | Idle timeout (0 = disabled) |
| `logoutClearAllDeviceTokens` | boolean | `false` | Whether explicit logout clears ALL device tokens or just current |

### 5.6 Caching & Prefetch Integration

- **Service Worker (`sw.ts`)**: No changes needed — already caches shell assets. The persistent token restoration happens server-side via cookie, which is transparently included in fetch requests.
- **`secureCache` (`secureCache.ts`)**: 
  - The `user-state` store already caches a non-sensitive "last known user" object for UX (show name/avatar instantly).
  - On token-based session restoration, the hook (`useAuth.tsx`) will update `secureCache` with the restored user data — no change needed.
  - **On logout/revocation**: `secureClearAll()` is already called — this clears all AES-encrypted IndexedDB stores.

---

## 6. Security Requirements & Attack Vector Analysis

### 6.1 Attack Vector Taxonomy

| # | Attack Vector | Severity | Affected Component | Mitigation |
|---|---|---|---|---|
| AV-01 | **XSS → Token Theft** | Critical | `remember_me` cookie | `HttpOnly` flag — JS cannot access |
| AV-02 | **CSRF with persistent cookie** | High | Session restoration | Existing CSRF double-submit pattern (`csrf.ts`) applies — new session gets new CSRF token |
| AV-03 | **Session Fixation** | High | `connect.sid` | Regenerate session ID on every token-based restoration (`req.session.regenerate()`) |
| AV-04 | **Token Replay (stolen cookie)** | Critical | `remember_me` cookie | Token rotation on every use — stolen token works only once, then triggers theft detection |
| AV-05 | **Database Leak → Token Compromise** | Critical | `remember_me_tokens` table | Validator stored as SHA-256 hash — cannot be reversed from DB dump |
| AV-06 | **Timing Attack on Token Lookup** | Medium | Selector/validator verification | Use `selector` for DB lookup (fast), then `crypto.timingSafeEqual` for validator comparison |
| AV-07 | **Cookie Injection / Manipulation** | Medium | `remember_me` cookie | `SameSite=Lax`, `Secure`, `HttpOnly`; validator is 32 bytes of entropy — cannot guess |
| AV-08 | **Infinite Session via Never-Expiring Token** | Medium | Token lifecycle | Hard `expiresAt` ceiling enforced server-side; admin-configurable max |
| AV-09 | **Device Sprawl / Ungoverned Trust** | Low | Trusted devices | `rememberMeMaxDevicesPerUser` — oldest token evicted when limit hit |
| AV-10 | **Stale Token After Password Change** | Critical | Token validity | All tokens invalidated on password change, account lock, or freeze |
| AV-11 | **Client-side Cache Leak (IndexedDB)** | Medium | `secureCache` | Already AES-256-GCM encrypted with user-scoped PBKDF2 key; `secureClearAll()` on logout |
| AV-12 | **Man-in-the-Middle** | Critical | Cookie transmission | `Secure` flag enforces HTTPS-only; `HSTS` recommended |
| AV-13 | **Absence-Based Account Takeover** | Medium | Long-absence re-login | Configurable forced re-auth after N days of absence |

### 6.2 Security Hardening Requirements

#### Cookie Security
- `remember_me` cookie: `HttpOnly=true`, `Secure=true`, `SameSite=Lax`, `Path=/`, `MaxAge` from config.
- Cookie name: `tq_rm` (short, non-descriptive to avoid fingerprinting).
- On any cookie operation, always validate parsed values have correct format before DB queries.

#### Token Security
- Selector: `crypto.randomBytes(16)` → 128 bits of entropy.
- Validator: `crypto.randomBytes(32)` → 256 bits of entropy.
- Validator hashing: `SHA-256` (using existing `sha256Hex` from `server/services/crypto.ts`).
- Comparison: `crypto.timingSafeEqual` to prevent timing attacks.
- Rotation: On every successful use, the old `(selector, validatorHash)` is atomically replaced with a new pair.

#### Session Security
- On token-based session restoration: always call `req.session.regenerate()` to prevent session fixation.
- New CSRF token issued after session restoration (handled by existing `issueCsrfToken` middleware).
- `express-session` cookie `maxAge` remains at 24h (short-lived session; remember-me token is the long-lived layer).

#### E2E Encryption Integration
- The `secureCache` already uses AES-256-GCM with PBKDF2 (100,000 iterations) for all client-side data.
- Stores: `query-cache`, `user-state`, `e2ee-keys` — all encrypted at rest in IndexedDB.
- Encryption scope is user-bound: switching users (via `setSecureCacheUserScope`) rotates the encryption key.
- On logout: `secureClearAll()` wipes all encrypted stores, ensuring no residual plaintext.

#### Secure Storage Model
- **Server**: Token validator hashes in PostgreSQL (`remember_me_tokens` table). Never stored in Valkey/Redis (to avoid volatility-based token loss).
- **Client**: Raw cookie value is the ONLY client-side storage — no additional `localStorage` or `IndexedDB` copies of the token.
- **Client Cache**: `secureCache` stores only non-sensitive display data (username, display name, avatar URL), encrypted, for instant UX on app load.

### 6.3 Vulnerability Categories to Address

| Category | Items |
|---|---|
| **Authentication Bypass** | Token replay, session fixation, expired-token acceptance |
| **Token Lifecycle** | Missing rotation, missing expiration, missing invalidation on password change |
| **Cookie Integrity** | Missing `HttpOnly`/`Secure`/`SameSite`, predictable values, URL exposure |
| **Data-at-Rest** | Plaintext tokens in DB, unencrypted client cache |
| **Data-in-Transit** | Non-HTTPS cookie transmission, missing HSTS |
| **Rate Limiting** | Brute-force selector/validator guessing |
| **Audit & Forensics** | Missing audit trail for token issuance/rotation/revocation/theft events |
| **Resource Exhaustion** | Unbounded device registration, expired-token accumulation |
| **Cross-Site Attacks** | CSRF with persistent cookies, XSS-based cookie exfiltration |
| **Privacy** | PII in token metadata, IP/geo logging compliance |

---

## 7. Mobile (Capacitor) Specifics

- Default `rememberMe = true` on mobile platforms (detect via `Capacitor.isNativePlatform()`).
- Capacitor's `CapacitorCookies` plugin handles `HttpOnly` cookies natively — no special handling needed.
- `secureCache` IndexedDB works within Capacitor's WebView without modification.
- On mobile app force-close and re-open: the `remember_me` cookie persists in the WebView cookie jar → seamless session restoration on next `checkAuth()` call.

---

## 8. Database Schema Changes

### New Table: `remember_me_tokens`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | serial | PK | Auto-increment |
| `user_id` | integer | FK → users.id, ON DELETE CASCADE | Token owner |
| `selector` | text | NOT NULL, UNIQUE, indexed | Public lookup key (16 bytes hex) |
| `validator_hash` | text | NOT NULL | SHA-256 hash of the secret validator |
| `expires_at` | integer | NOT NULL | Unix timestamp (seconds) of token expiry |
| `last_used_at` | integer | NOT NULL, DEFAULT now | Unix timestamp of last successful use |
| `created_at` | integer | NOT NULL, DEFAULT now | Unix timestamp of token creation |
| `user_agent` | text | nullable | UA string at token creation |
| `ip` | text | nullable | IP at token creation |
| `device_type` | text | nullable | Derived: desktop/mobile/tablet |
| `browser` | text | nullable | Derived from UA |
| `os` | text | nullable | Derived from UA |
| `device_fp` | text | nullable | Browser fingerprint hash |
| `device_install_id` | text | nullable | Client-generated UUID |
| `country_code` | text | nullable | Geo-enrichment |
| `city` | text | nullable | Geo-enrichment |

### Modified Table: `system_config`
Add the columns listed in §5.5 above.

### New Login History Event Types
| `eventType` value | Trigger |
|---|---|
| `PERSISTENT_TOKEN_ISSUED` | Token created on login |
| `SESSION_RESTORED_VIA_TOKEN` | Session re-established from persistent token |
| `TOKEN_ROTATED` | Token successfully rotated |
| `TOKEN_THEFT_DETECTED` | Selector matched but validator mismatched |
| `PERSISTENT_TOKEN_REVOKED` | User or admin explicitly revoked a device |
| `ALL_TOKENS_INVALIDATED` | Password change, account lock, or admin action |
| `ABSENCE_REAUTH_REQUIRED` | Session restoration denied due to absence threshold |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Token theft via XSS | Low (HttpOnly blocks JS access) | Critical | `HttpOnly`, `Secure`, `SameSite`; CSP headers |
| Token theft via database breach | Low | Critical | Validator hashed (SHA-256); selector alone is useless |
| Token replay after theft | Medium | Critical | Single-use rotation; theft detection triggers global revocation |
| Expired-token database bloat | Medium | Low | Scheduled cron purge of expired records; `rememberMeMaxDevicesPerUser` limit |
| User confusion about session state | Medium | Low | Clear "Resuming session..." UI state; "Trusted Devices" management page |
| Admin misconfiguration (e.g., 999-day token) | Low | Medium | Validation bounds: max 90 days; warnings in config UI |
| Race condition during token rotation | Low | Medium | Atomic DB transaction for delete-old / insert-new |

---

## 10. Dependencies

| Existing Component | Integration Point |
|---|---|
| [sessionTrail.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/security/sessionTrail.ts) | `createUserSession`, `endSession`, `revokeAllSessionsForUser`, `recordLoginAttempt` |
| [sessionStore.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/services/sessionStore.ts) | `destroyStoredSession` for session cleanup |
| [crypto.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/services/crypto.ts) | `sha256Hex`, `randomToken` for token generation and hashing |
| [csrf.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/security/csrf.ts) | CSRF token re-issuance after session restoration |
| [secureCache.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts) | `secureClearAll()` on logout, `securePut()` on session restoration |
| [use-auth.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-auth.tsx) | `login()`, `logout()`, `checkAuth()` — all need updates |
| [routes.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/routes.ts) | Login/logout/current-user endpoints |
| [auth.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/middleware/auth.ts) | `requireAuth` middleware — add token fallback |
| [schema.pg.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts) | New `rememberMeTokens` table + `systemConfig` columns |

