# Production Requirements (Living Ledger)

This file is the canonical ledger for production-only or production-critical requirements discovered during implementation, audits, and bug fixing.

## Update Protocol (Mandatory)
- When any new production requirement is discovered, append it here in the same change.
- Keep entries concrete and testable (no vague statements).
- Never place real secrets or credentials in this file.
- Include where enforcement lives (code path, manifest, runbook, or command).
- Include validation steps so operators can verify compliance.

## Entry Template
```
ID:
Date (UTC):
Scope:
Requirement:
Enforcement:
Validation:
Failure Mode if Missing:
```

## Current Production Requirements

### PRD-ENV-001
- ID: `PRD-ENV-001`
- Date (UTC): `2026-02-09`
- Scope: `Runtime encryption`
- Requirement: `ENCRYPTION_KEY` must be set in production as exactly 64 hex characters (32 bytes).
- Enforcement: `server/index.ts` startup validation and `server/services/crypto.ts` runtime guard.
- Validation:
  - `openssl rand -hex 32` to generate key.
  - Confirm env is set in runtime/secret source.
  - Start app with `NODE_ENV=production`; startup must show `ENCRYPTION_KEY: configured`.
- Failure Mode if Missing: startup aborts in production and encrypted mailbox/inquiry payloads cannot be safely handled.

### PRD-ENV-002
- ID: `PRD-ENV-002`
- Date (UTC): `2026-02-09`
- Scope: `Legal acceptance integrity`
- Requirement: `LEGAL_TERMS_HMAC_SECRET` must be configured and strong (minimum 32 characters).
- Enforcement: `server/index.ts` critical environment validation.
- Validation: start app and verify startup validation reports legal secret as configured.
- Failure Mode if Missing: legal compliance token signing cannot be trusted.

### PRD-ENV-003
- ID: `PRD-ENV-003`
- Date (UTC): `2026-02-09`
- Scope: `Session security`
- Requirement: `SESSION_SECRET` must be configured; minimum 32 characters is required for production-grade strength.
- Enforcement: `server/index.ts` startup validation.
- Validation: startup validation reports `SESSION_SECRET: configured`; rotate with strong random value.
- Failure Mode if Missing: session cookies cannot be securely signed.

### PRD-ENV-004
- ID: `PRD-ENV-004`
- Date (UTC): `2026-02-09`
- Scope: `Verification security hardening`
- Requirement: `EMAIL_VERIFY_TOKEN_SECRET` must be configured in production and should be at least 32 characters.
- Enforcement: `server/index.ts` production validation path.
- Validation: in production boot, verify no missing warning/fatal for email verification token secret.
- Failure Mode if Missing: verification token hashing is not properly keyed for production hardening.

### PRD-K8S-001
- ID: `PRD-K8S-001`
- Date (UTC): `2026-02-09`
- Scope: `Kubernetes secret management`
- Requirement: `tradehub-secrets` must include a real `ENCRYPTION_KEY` value before deploy; placeholders are not valid.
- Enforcement: `k8s/02-secrets.yaml` contract + production startup fail-fast.
- Validation:
  - `kubectl apply --dry-run=client -f k8s/`
  - ensure deployed secret contains valid 64-hex key.
- Failure Mode if Missing: pods fail startup in production due to critical env validation.

### PRD-SEC-001
- ID: `PRD-SEC-001`
- Date (UTC): `2026-02-09`
- Scope: `Partner portal transport security`
- Requirement: All `/api/partner/*` traffic must use HTTPS in production (loopback-only exception for local dev/e2e).
- Enforcement: `server/middleware/requirePartner.ts` transport guard (`PARTNER_HTTPS_REQUIRED` on insecure production transport).
- Validation:
  - Run app with `NODE_ENV=production`.
  - Call `/api/partner/data-room` over `http://` from non-loopback host and verify `426`.
  - Call over HTTPS and verify success path.
- Failure Mode if Missing: partner API keys and inquiry payload metadata can traverse insecure transport.

### PRD-SEC-002
- ID: `PRD-SEC-002`
- Date (UTC): `2026-02-09`
- Scope: `Partner inquiry end-to-end encryption`
- Requirement: Partner inquiry submissions must include valid E2EE envelope payloads and all routed recipient admins must have mailbox public keys.
- Enforcement: `server/routes/partnerPortal.ts` inquiry create validation + `server/services/messaging.ts` E2EE envelope verification + routing key checks in `server/partner/inquiryRouting.ts`.
- Validation:
  - `GET /api/partner/inquiries/recipients` returns `missingKeyCount = 0`.
  - `POST /api/partner/inquiries` without `e2eeEnvelope` fails with `INQUIRY_E2EE_REQUIRED`.
  - Valid envelope submission succeeds and creates mailbox thread linkage.
- Failure Mode if Missing: inquiry confidentiality and recipient-targeted encryption guarantees are broken.

### PRD-ADM-001
- ID: `PRD-ADM-001`
- Date (UTC): `2026-02-09`
- Scope: `Admin lockout prevention`
- Requirement: `scoutTabEnabled` must be managed from `/admin` System Config Controls (not only from Scout UI) so admins can always recover Scout visibility after disabling it.
- Enforcement: `client/src/pages/AdminDashboard.tsx` (System Config → Controls card and top-tab visibility binding) and `server/routes/admin.ts` (`/api/admin/system-config` get/put includes `scoutTabEnabled`).
- Validation:
  - Disable `Enable Scout tab` in System Config Controls and save.
  - Verify Scout top-level tab disappears while System Config remains accessible.
  - Re-enable `Enable Scout tab` in System Config Controls and save; verify Scout tab returns without DB/manual intervention.
- Failure Mode if Missing: disabling Scout can remove the only in-app recovery path, causing admin self-lockout from Scout features.

### PRD-CHL-001
- ID: `PRD-CHL-001`
- Date (UTC): `2026-02-11`
- Scope: `Challenge certificate verification exposure`
- Requirement: Public challenge certificate verification endpoints must be read-only and rate-limited to prevent abuse and enumeration.
- Enforcement: `server/routes/traderTalent.ts` (`traderTalentPublicRouter` verify routes + `consumeChallengeRateLimit` guard with `429` + `Retry-After`).
- Validation:
  - Call `/api/trader/challenges/certificate/:verificationCode/verify` repeatedly from one client.
  - Verify successful reads until limit, then `429 RATE_LIMITED` with `CHALLENGE_CERT_VERIFY_RATE_LIMIT`.
  - Verify endpoint does not require session auth and only returns certificate verification-safe fields.
- Failure Mode if Missing: certificate verification can be abused for scraping/enumeration and service degradation.

### PRD-CHL-002
- ID: `PRD-CHL-002`
- Date (UTC): `2026-02-11`
- Scope: `Challenge config input integrity`
- Requirement: Challenge JSON-config fields (`prizeDistributionJson`, `customRewardJson`, badge `criteriaJson`, progression `tiersJson`) and eligibility-gate inputs must be server-validated before persistence.
- Enforcement: `server/routes/adminScout.ts` Zod schemas (`challengeUpsertSchema`, `challengeSettingsPatchSchema`, `challengeBadgeUpsertSchema`, `challengeProgressionTierUpsertSchema`) with JSON/mode refinements.
- Validation:
  - Submit invalid JSON to each relevant admin endpoint and verify `400 INVALID_PAYLOAD`.
  - Submit valid JSON payloads and verify successful writes.
  - Submit eligibility gate modes (`EMAIL_VERIFIED`, `CONTENDER`) and verify acceptance.
- Failure Mode if Missing: malformed or hostile payloads can bypass validation, causing runtime parse failures and integrity/security regressions.

### PRD-CHL-003
- ID: `PRD-CHL-003`
- Date (UTC): `2026-02-11`
- Scope: `Challenge enrollment admin note confidentiality`
- Requirement: Admin notes persisted on challenge enrollments must be encrypted at rest and decrypted only on authorized admin read paths.
- Enforcement: `server/routes/adminScout.ts` (`encryptChallengeAdminNote`, `decryptChallengeAdminNote`, admin action mutation path + admin enrollment/detail response shaping).
- Validation:
  - Apply an admin enrollment note action and inspect DB `challenge_enrollments.admin_notes`; value must not be plaintext.
  - Fetch admin enrollment detail/list endpoints and verify decrypted note is returned to admin clients.
  - Verify legacy plaintext rows are still readable (backward-compatible decode fallback).
- Failure Mode if Missing: sensitive enforcement/context notes are stored plaintext and can leak through DB exposure.

### PRD-CHL-004
- ID: `PRD-CHL-004`
- Date (UTC): `2026-02-11`
- Scope: `Challenge admin mutation abuse control`
- Requirement: Challenge admin mutation endpoints (enrollment action/override/extend/advance/reset/disqualify/notify and prize approval) must be rate-limited per admin identity.
- Enforcement: `server/routes/adminScout.ts` (`enforceChallengeAdminActionRateLimit` + per-endpoint guards returning `429 CHALLENGE_ADMIN_ACTION_RATE_LIMIT` with `Retry-After`).
- Validation:
  - Repeatedly call a guarded endpoint (for example `PUT /api/admin/challenges/enrollments/:id/override`) above threshold in 60s.
  - Verify `429` response with `code: CHALLENGE_ADMIN_ACTION_RATE_LIMIT` and `Retry-After` header.
  - Verify normal usage under threshold remains unaffected.
- Failure Mode if Missing: a privileged account (or compromised session) can flood high-impact admin mutations causing operational risk and noisy audit/event streams.

### PRD-SEC-003
- ID: `PRD-SEC-003`
- Date (UTC): `2026-02-12`
- Scope: `Repository-wide CSRF enforcement for session-scoped API mutations`
- Requirement: All session-scoped non-safe HTTP requests to `/api/*` must include a valid CSRF token in `x-csrf-token` (or fallback alias), matching both `XSRF-TOKEN` cookie and session-bound token; clients must bootstrap token issuance through `GET /api/csrf`.
- Enforcement: `server/security/csrf.ts` (`issueCsrfToken`, `enforceCsrf`, `csrfTokenHandler`), middleware wiring in `server/routes.ts`, and shared client integration in `client/src/lib/csrf.ts` plus request wrappers (`client/src/lib/fetchWithIdentity.ts`, `client/src/lib/queryClient.ts`, `client/src/lib/axiosIdentity.ts`).
- Validation:
  - Perform authenticated `POST /api/*` without CSRF header and verify `403` with `code: CSRF_TOKEN_INVALID`.
  - Call `GET /api/csrf`, then repeat with `x-csrf-token` and cookie and verify success path.
  - Run type/build checks and at least one E2E suite that performs authenticated mutation requests to confirm no regression.
- Failure Mode if Missing: session cookie credentials can be replayed through cross-site requests, enabling unauthorized state-changing actions.

### PRD-WS-001
- ID: `PRD-WS-001`
- Date (UTC): `2026-02-12`
- Scope: `WebSocket handshake and abuse controls`
- Requirement: `/ws` must enforce origin validation, per-user concurrent connection caps, and message-rate limits to reduce cross-origin abuse and socket flooding risk.
- Enforcement: `server/routes.ts` WebSocket connection pipeline (`isWsOriginAllowed`, `countWsConnectionsForUser`, `consumeWsMessageRate`) with close codes and counters (`ws_origin_rejected_total`, `ws_user_connection_limit_rejected_total`, `ws_message_rate_limited_total`).
- Validation:
  - Connect with disallowed `Origin` and verify immediate reject (`WS_ORIGIN_FORBIDDEN` / close `4403`).
  - Open sockets over `WS_MAX_CONNECTIONS_PER_USER` for one session and verify new socket reject (`WS_CONNECTION_LIMIT_REACHED` / close `4409`).
  - Send messages above `WS_MESSAGE_RATE_LIMIT` within `WS_MESSAGE_RATE_WINDOW_MS` and verify rate-limit close (`4408`).
  - Verify metrics endpoint exposes updated rejection counters.
- Failure Mode if Missing: browser-origin spoofing, session-bound socket fanout abuse, and WS message floods can degrade service and increase unauthorized attack surface.

### PRD-CHL-005
- ID: `PRD-CHL-005`
- Date (UTC): `2026-02-12`
- Scope: `Challenge evaluation scheduler runtime control`
- Requirement: Challenge evaluation cron runtime must be driven by persisted admin settings (`challengeEvalEnabled`, `challengeEvalIntervalMin`, `challengeEvalMaxRows`) without process restart.
- Enforcement: `server/cron/evaluateChallenges.ts` dynamic scheduler (`resolveRuntime`, adaptive `setTimeout` loop) sourcing `server/recruitment/challengesV4/challengeConfig.ts`.
- Validation:
  - Update challenge settings via admin API/UI and verify scheduler logs new runtime values.
  - Disable evaluation (`challengeEvalEnabled=false`) and verify passes stop while periodic disabled polling continues.
  - Re-enable with changed interval/max rows and verify next runs use updated values.
- Failure Mode if Missing: admin-configured evaluation cadence/limits are ignored, causing stale challenge lifecycle progression and unpredictable batch load.

### PRD-CHL-006
- ID: `PRD-CHL-006`
- Date (UTC): `2026-02-12`
- Scope: `Challenge enrollment capacity guardrails`
- Requirement: Trader enrollment route must enforce challenge-level caps for total enrollments (`maxEnrollments`) and concurrent active enrollments (`maxActiveEnrollments`) before activation/creation.
- Enforcement: `server/routes/traderTalent.ts` in `POST /api/trader/challenges/:id/enroll` with pre-write cap checks returning `MAX_ENROLLMENTS_REACHED` / `MAX_ACTIVE_ENROLLMENTS_REACHED`.
- Validation:
  - Configure a challenge with low caps, fill capacity, and attempt another enrollment.
  - Verify API rejects with `409` and cap-specific code.
  - Verify existing active enrollment reuse remains idempotent and unaffected.
- Failure Mode if Missing: challenge participation can exceed intended capacity, breaking fairness and introducing unbounded evaluation/notification load.

### PRD-SUPPLY-001
- ID: `PRD-SUPPLY-001`
- Date (UTC): `2026-02-12`
- Scope: `HTTP client dependency security baseline`
- Requirement: Root dependency `axios` must remain above vulnerable advisory range (`<=1.13.4`) to avoid known DoS exposure in request config merge handling.
- Enforcement: `package.json` / `package-lock.json` resolved version and CI vulnerability scanning (`npm audit`).
- Validation:
  - Run `npm audit --audit-level=high` and verify no axios advisory appears.
  - Confirm lockfile resolves `axios@1.13.5` or newer.
- Failure Mode if Missing: known high-severity dependency vulnerability remains exploitable in production dependency graph.

### PRD-AUTH-004
- ID: `PRD-AUTH-004`
- Date (UTC): `2026-02-26`
- Scope: `Login session persistence`
- Requirement: `POST /api/auth/login` must only return `200` after the session is persisted to the configured session store, and must not emit an unnecessary remember-me cookie clear (`tq_rm`) when no remember-me cookie is present in the request.
- Enforcement: `server/routes/auth/login.ts` (explicit `req.session.save()` before `res.json()`; conditional `clearRememberMeCookie()` based on `readRememberMeCookie(req)`).
- Validation:
  - Start the server, then run:
    - `node -e "fetch('http://localhost:5000/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@local.test',password:'changeme'})}).then(r=>{const sc=r.headers.get('set-cookie')||'';const c=(sc.split(';')[0]||'').trim();return fetch('http://localhost:5000/api/auth/current-user',{headers:{Cookie:c}})}).then(r=>{console.log(r.status);return r.text()}).then(console.log)"`
  - Expect `200` and a current-user JSON payload without adding delays/draining the login body first.
- Failure Mode if Missing: intermittent post-login `401` on immediate follow-up calls (including WS auth) and non-browser clients selecting the wrong cookie when multiple `Set-Cookie` headers are present.

### PRD-CHL-007
- ID: `PRD-CHL-007`
- Date (UTC): `2026-02-15`
- Scope: `Challenge certificate verification integrity`
- Requirement: Production must configure `CHALLENGE_CERT_VERIFICATION_SECRET` (minimum 32 characters) and rotate `challengeCertificateVerificationKeyId` when certificate verification keys are rotated.
- Enforcement: `server/recruitment/challengesV4/certificateCode.ts` (HMAC derivation for public verification codes), `server/recruitment/challengesV4/challengeConfig.ts` (runtime key-id config), and `server/routes/adminScout.ts` / `client/src/components/admin/ScoutChallengesPanel.tsx` (admin settings surface for key-id management).
- Validation:
  - Set `CHALLENGE_CERT_VERIFICATION_SECRET` in runtime secret manager and restart service.
  - Issue a new certificate and verify using `/api/public/trader/challenges/certificate/:verificationCode/verify`.
  - Change `challengeCertificateVerificationKeyId`, issue another certificate, and verify both old and new certificates still validate.
- Failure Mode if Missing: certificate verification codes become weakly derived from fallback secrets, and key rotations can cause verification drift or invalid proofs.

### PRD-PERF-001
- ID: `PRD-PERF-001`
- Date (UTC): `2026-02-15`
- Scope: `Web app-shell caching safety boundary`
- Requirement: Service Worker cache strategy must never cache or proxy authenticated API and WebSocket traffic (`/api/*`, `/ws`) and must serve worker script with revalidation semantics (no immutable worker caching).
- Enforcement: Planned implementation in client SW module (`client/src/sw.ts` or `client/public/sw.js`) plus static serving behavior in `server/vite.ts` (worker delivery + SPA fallback exclusions).
- Validation:
  - Register SW and inspect network behavior for `/api/*` and `/ws`; requests must always hit network.
  - Verify worker script (`/sw.js`) is fetched with `Cache-Control: no-cache` semantics and updates are detected after deploy.
  - Validate offline shell still works for static assets without serving stale API data.
- Failure Mode if Missing: stale/poisoned worker state can persist, API responses may be incorrectly cached, and authentication/session behavior may become inconsistent or unsafe.

### PRD-SEC-004
- ID: `PRD-SEC-004`
- Date (UTC): `2026-02-15`
- Scope: `Client encrypted cache isolation and lifecycle`
- Requirement: Any client-side encrypted cache for account/config/query hydration must be user-scoped and fully purged on logout/session-user change.
- Enforcement: Planned cache lifecycle controls in `client/src/lib/secureCache.ts`, logout/session transitions in `client/src/hooks/use-auth.tsx`, and persistence wiring in `client/src/lib/queryPersistence.ts`.
- Validation:
  - Authenticate as User A, populate cache, logout, and verify user-scoped entries are removed.
  - Authenticate as User B on same device/profile and verify no User A cached state is readable/hydrated.
  - Corrupt cache entries and confirm safe fallback to network without state bleed.
- Failure Mode if Missing: cross-account data leakage on shared devices and stale sensitive account data exposure after logout.

### PRD-SEC-005
- ID: `PRD-SEC-005`
- Date (UTC): `2026-02-15`
- Scope: `Browser runtime hardening for persistent client cache`
- Requirement: Before enabling production persistent encrypted cache, server must enforce a Content Security Policy that constrains script execution to trusted sources and blocks obvious inline/eval injection vectors.
- Enforcement: Planned HTTP response header middleware in `server/index.ts` with rollout documentation and compatibility validation.
- Validation:
  - Verify `Content-Security-Policy` header is present on app shell responses in production profile.
  - Run regression checks for app boot, lazy routes, and i18n loading under CSP.
  - Run XSS probe tests confirming blocked inline/eval payloads.
- Failure Mode if Missing: XSS payloads can read/abuse persistent cache and key material, materially increasing account data exposure risk.

### PRD-MOB-001
- ID: `PRD-MOB-001`
- Date (UTC): `2026-02-15`
- Scope: `Mobile/native production transport enforcement`
- Requirement: Production mobile and native builds must reject cleartext backend endpoints (`http://`, `ws://`) and use HTTPS/WSS only.
- Enforcement: Planned release-time config validation in `MOBILE/capacitor.config.ts`, native endpoint configuration in `NATIVE/src/services/api.ts` and `NATIVE/src/services/websocket.ts`, plus Android/iOS network policy manifests.
- Validation:
  - Produce release config and verify configured API/WS endpoints are HTTPS/WSS.
  - Attempt to set production endpoint to cleartext and verify build/release guard fails.
  - Validate runtime connectivity over secure transport only.
- Failure Mode if Missing: credentials/session metadata and trading traffic can traverse insecure channels due to misconfiguration.

### PRD-SEC-006
- ID: `PRD-SEC-006`
- Date (UTC): `2026-02-15`
- Scope: `Mailbox E2EE key material local persistence`
- Requirement: Web mailbox private key material must not remain in plaintext `localStorage` in production; migration path to safer storage must be implemented with backward-compatible cleanup.
- Enforcement: Planned migration in `client/src/lib/e2ee.ts` to secure cache storage layer and cleanup of `tq.mailbox.e2ee.v1.*` localStorage keys.
- Validation:
  - Existing user with legacy localStorage key logs in; key is migrated and legacy key removed.
  - Mailbox encrypt/decrypt still functions after migration.
  - New key generation path writes only to new storage mechanism.
- Failure Mode if Missing: private E2EE key material remains directly script-readable via localStorage, increasing impact of XSS/browser compromise.

### PRD-AUTH-001
- ID: `PRD-AUTH-001`
- Date (UTC): `2026-02-16`
- Scope: `Persistent-login token invalidation parity with session revocation`
- Requirement: Any flow that terminates or revokes user sessions for security/account-state reasons must also revoke associated remember-me tokens, and auth middleware must reject stale stolen/aged tokens before request authorization.
- Enforcement: `server/routes.ts` (`/api/auth/logout`, `/api/profile/change-password`, account deactivate/delete, `/api/auth/devices*`), `server/routes/meSessions.ts` (`/api/me/sessions/logout-others`, `/api/me/logout`), `server/storage.ts` (freeze/disable/bulk-disable paths), `server/middleware/auth.ts` (theft/absence handling + restoration gate), and `server/services/rememberMe.ts` (token revoke/verify primitives).
- Validation:
  - Login with remember-me enabled, then perform password change; verify active session is terminated and remembered session cannot auto-restore.
  - Freeze/disable a user via admin flow and verify remembered device auto-login fails until account state is restored.
  - Run `npm run check`, `npm run db:migrate:drizzle`, `npm run db:audit`, and `npm run e2e` to verify no contract/runtime regression.
- Failure Mode if Missing: revoked or disabled accounts can silently regain access via persistent cookies even after explicit session termination, violating institutional session-control expectations.

### PRD-PERF-002
- ID: `PRD-PERF-002`
- Date (UTC): `2026-02-16`
- Scope: `App-shell availability and service-worker cache safety`
- Requirement: Root app route (`/`) must never emit plaintext health payloads, and service-worker shell cache writes must only persist HTML index responses.
- Enforcement: `server/index.ts` (`/status` probe endpoint + root app-shell passthrough), `client/src/sw.ts` (HTML-only shell caching for `/index.html` and navigation refresh), and `client/src/main.tsx`/`client/index.html` (boot retry fallback path).
- Validation:
  - Request `/` with `Accept: */*` and verify HTML app shell is returned (not `OK` plaintext).
  - Request `/status` and verify `200 OK` plaintext health probe response.
  - Register SW and confirm navigation cache entries are HTML shell documents only.
  - Run `npm run build`, `npm run smoke:admin`, and `npm run e2e` to verify no app-shell/admin regressions.
- Failure Mode if Missing: browsers can land on cached/plaintext non-shell responses (`OK`) that block app boot/login, causing false outage behavior and broken auth/admin entry paths.

### PRD-AUTH-002
- ID: `PRD-AUTH-002`
- Date (UTC): `2026-02-16`
- Scope: `Persistent-login selector abuse control`
- Requirement: Remember-me selector misses (`NOT_FOUND`) must be rate-limited per client IP with bounded retry windows, and middleware must emit explicit 429 responses with retry hints once threshold is exceeded.
- Enforcement: `server/middleware/auth.ts` (`getRememberMeNotFoundRateStatus`, `recordRememberMeTokenNotFound`, and `REMEMBER_ME_SELECTOR_RATE_LIMITED` response path in `tryRestoreSessionFromRememberMe`).
- Validation:
  - Send repeated authenticated requests with forged `tq_rm` cookie selectors from one IP.
  - Verify initial misses return normal unauthenticated behavior, then transition to `429` with `code: REMEMBER_ME_SELECTOR_RATE_LIMITED` and `Retry-After`.
  - Verify valid remember-me restores clear the miss window for that IP.
- Failure Mode if Missing: attackers can enumerate selectors at high volume, driving unnecessary DB lookups and increasing token-discovery risk.

### PRD-OPS-001
- ID: `PRD-OPS-001`
- Date (UTC): `2026-02-16`
- Scope: `Remember-me token retention and maintenance visibility`
- Requirement: Expired remember-me tokens must be purged by the account lifecycle scheduler, and each sweep must log purge counts for operational monitoring.
- Enforcement: `server/services/accountLifecycleSweepScheduler.ts` (invokes `purgeExpiredRememberMeTokens()` and logs `purgedRememberMeTokens` in sweep completion output).
- Validation:
  - Insert expired rows in `remember_me_tokens`, run scheduler sweep routine, and verify rows are removed.
  - Confirm logs include `purgedRememberMeTokens` count for each daily sweep cycle.
  - Run `npm run check` and `npm run e2e` to confirm scheduler integration does not regress auth/admin flows.
- Failure Mode if Missing: expired token rows accumulate indefinitely, increasing table bloat and reducing operator visibility into maintenance effectiveness.

### PRD-PERF-003
- ID: `PRD-PERF-003`
- Date (UTC): `2026-02-16`
- Scope: `Critical route chunk pre-cache + admin performance control safety bounds`
- Requirement: Production builds must publish a same-origin Vite manifest for SW-driven critical chunk pre-caching, and admin-updated client performance defaults must be bounded/rate-limited before broadcast to avoid poll/reconnect amplification.
- Enforcement: `vite.config.ts` (`build.manifest` + `manualChunks`), `client/src/sw.ts` (manifest-driven critical chunk cache), `server/routes/admin.ts` (`/api/admin/global-settings` bounds + save throttling), and `server/routes.ts` (`/api/global-settings` sanitized performance config projection).
- Validation:
  - Build production assets and verify `/.vite/manifest.json` resolves and includes route chunk metadata.
  - Register SW, inspect cache, and confirm critical route chunks are pre-cached with same-origin `200` responses only.
  - Attempt to save out-of-range performance values via `/api/admin/global-settings` and verify `400` rejection; submit rapid consecutive writes and verify `429` throttling.
  - Verify clients receive `global-settings:updated` and apply sanitized settings without reload.
- Failure Mode if Missing: slow-network reopen remains blocked on first chunk fetch, or unsafe admin values trigger request/reconnect amplification that can degrade API/WS stability at scale.

### PRD-IOS-001
- ID: `PRD-IOS-001`
- Date (UTC): `2026-03-10`
- Scope: `Wrapper/native iOS build toolchain`
- Requirement: All checked-in iOS wrapper and React Native iOS commands must run only on macOS hosts with Apple Xcode, `xcodebuild`, `xcrun`, and iPhoneOS SDKs available; non-Darwin hosts must fail fast with explicit guidance instead of entering partial Capacitor/CocoaPods/Xcode flows.
- Enforcement: `MOBILE/scripts/run-ios.sh`, `NATIVE/scripts/pod-install.sh`, `NATIVE/scripts/build-ios.sh`, root `package.json` mobile script delegation, and React Native iOS Podfile compatibility in `NATIVE/ios/Podfile`.
- Validation:
  - On Linux/WSL, run `cd MOBILE && npm run run:ios`, `cd NATIVE && npm run pod:install`, and `cd NATIVE && npm run build:ios`; each command must exit immediately with a clear macOS/Xcode requirement message.
  - On macOS, verify `xcodebuild -version` is present and satisfies the React Native minimum Xcode requirement, then run `cd NATIVE && npm run pod:install` and `cd NATIVE && npm run build:ios`.
  - On macOS, run `cd MOBILE && npm run run:ios` and verify Capacitor launches the iOS target without JSON parsing or preflight-toolchain ambiguity.
- Failure Mode if Missing: Linux/WSL operators hit opaque downstream tool errors, partial Pod installs, and misleading iOS readiness signals instead of clear deployment boundaries.

### PRD-MOBILE-001
- ID: `PRD-MOBILE-001`
- Date (UTC): `2026-03-10`
- Scope: `Mobile/native release signing and Firebase operator material`
- Requirement: Android keystores, `key.properties`, `google-services.json`, and `GoogleService-Info.plist` used for wrapper/native release builds must come from operator-managed release credentials and must not rely on repository placeholders or legacy tracked files as authoritative production secrets.
- Enforcement: `PROJECT_STRUCTURE.md` security notes, `MOBILE/README.md`, `MOBILE/docs/APP_SIGNING_GUIDE.md`, `MOBILE/docs/PUSH_NOTIFICATION_SETUP.md`, `NATIVE/android/ANDROID_TASK.md`, and `NATIVE/ios/IOS_TASK.md`.
- Validation:
  - Before a release build, replace placeholder Firebase files with environment-correct operator configs and verify package IDs/bundle IDs match the target app.
  - Verify Android signing uses the intended operator keystore and alias rather than any checked-in legacy artifact.
  - Verify iOS release signing and push provisioning are configured in Xcode/App Store Connect with operator-managed credentials.
- Failure Mode if Missing: mobile release builds can ship with invalid push configuration, the wrong signing identity, or repository-resident secrets that break rotation and compromise release hygiene.

### PRD-MOBILE-002
- ID: `PRD-MOBILE-002`
- Date (UTC): `2026-03-10`
- Scope: `Wrapper Android release-secret enforcement without harming local testing`
- Requirement: Android wrapper release builds may remain locally smoke-buildable without operator Firebase material, but deployment/CI release builds must set `TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1` (or Gradle property `tradequipRequireGoogleServicesForRelease=1`) so missing `google-services.json` fails before deployment.
- Enforcement: `MOBILE/android/app/build.gradle`, release pipeline/operator build environment, and deployment runbooks.
- Validation:
  - Run `cd MOBILE && bash scripts/with-jdk.sh ./android/gradlew -p android assembleRelease` with the flag unset and verify local release smoke builds still work.
  - Run the same command with `TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1` and no `google-services.json`; verify the build fails with an explicit message.
  - Run deployment release build with the flag enabled and a valid operator-managed `google-services.json`; verify the build succeeds.
- Failure Mode if Missing: local testing gets unnecessarily blocked or, conversely, deployment can emit release artifacts with missing push configuration.

### PRD-PERF-004
- ID: `PRD-PERF-004`
- Date (UTC): `2026-02-16`
- Scope: `WebSocket quote fanout pacing + inbound payload abuse guard`
- Requirement: Runtime must enforce admin-configured `wsPushFrequencyMs` for quote update fanout pacing, and WebSocket transport must cap inbound message payload size with a bounded `maxPayload` limit.
- Enforcement: `server/routes.ts` (`refreshLiveWsPushFrequencyMs`, quote fanout queue/flush path for `WS_MSG_QUOTES_UPDATE`, and `WebSocketServer` `maxPayload` configuration via `WS_MAX_MESSAGE_BYTES`).
- Validation:
  - Set `/api/admin/global-settings.wsPushFrequencyMs` to a non-zero value and verify quote updates are batched to that cadence while preserving latest-per-symbol values.
  - Set `wsPushFrequencyMs` back to `0` and verify quote updates return to immediate push behavior without restart.
  - Send oversized WebSocket frames above `WS_MAX_MESSAGE_BYTES` and verify they are rejected by the WS server transport.
  - Run `npm run check` and `npm run build` after WS changes.
- Failure Mode if Missing: configured WS push controls are inert (admin changes have no runtime effect), and oversized inbound WS payloads can trigger avoidable memory/CPU pressure.

### PRD-PERF-005
- ID: `PRD-PERF-005`
- Date (UTC): `2026-02-16`
- Scope: `Admin-tier performance controls editability + zero-refresh propagation`
- Requirement: Every poll/flush tier value shown in Admin -> System Config -> Market Data must be directly editable, validated, persisted in `global_settings`, and propagated to connected clients immediately on `global-settings:updated` without requiring manual refresh.
- Enforcement: `shared/schema.pg.ts` (tier poll/flush columns), `db/migrations/0032_global_settings_tier_overrides.sql` (backfill), `server/routes/admin.ts` (validation + persistence + live event payload), `server/routes.ts` (`/api/global-settings` sanitized tier projection), `client/src/pages/AdminDashboard.tsx` (editable tier inputs + save), `client/src/live/ConfigSync.tsx` (WS payload cache-merge + invalidation), and `client/src/lib/perfHints.ts` (runtime consumption of tier overrides).
- Validation:
  - Edit all tier poll/flush rows in Admin UI and save; verify values persist after reload and are returned by both `/api/admin/global-settings` and `/api/global-settings`.
  - Keep a second authenticated client connected, save from admin client, and verify new tier values apply immediately without reload.
  - Submit out-of-range or non-numeric tier values to `/api/admin/global-settings` and verify `400` rejection.
  - Run `npm run check`, `npm run build`, `npm run db:migrate:drizzle`, and `npm run db:audit`.
- Failure Mode if Missing: UI shows non-editable/illusory tier controls and saved performance changes do not take effect in live clients, causing stale runtime behavior and operator mistrust.

### PRD-PERF-006
- ID: `PRD-PERF-006`
- Date (UTC): `2026-02-16`
- Scope: `Admin performance save consistency and overwrite isolation`
- Requirement: Performance controls must round-trip verify persisted values after save and must not be overwritten by unrelated risk-parameter save flows.
- Enforcement: `client/src/pages/AdminDashboard.tsx` (`updateMarketPerfMutation` PUT->GET verification + stale-sync guard + schema warning), and `client/src/pages/AdminDashboard.tsx` (`handleSaveRiskParams` payload excludes performance fields).
- Validation:
  - Change performance settings, save, and verify UI values remain stable (no immediate reset) and match fresh `/api/admin/global-settings`.
  - Save risk parameters separately and confirm performance settings remain unchanged.
  - Run `npm run check` and `npm run build`.
- Failure Mode if Missing: admins observe successful save toasts but values snap back due stale hydration or are silently clobbered by unrelated settings saves, breaking trust in runtime controls.

### PRD-OPS-002
- ID: `PRD-OPS-002`
- Date (UTC): `2026-02-16`
- Scope: `Single-version listener integrity on API port`
- Requirement: Port `5000` must not silently load-balance across multiple local processes by default; `reusePort` may only be enabled explicitly via `SERVER_REUSE_PORT=1` in production.
- Enforcement: `server/index.ts` (`server.listen` options gate `reusePort` behind `NODE_ENV=production` and `SERVER_REUSE_PORT=1`, with startup warning log when enabled).
- Validation:
  - Start one server process and verify successful bind on `:5000`.
  - Attempt a second local server process and verify bind conflict occurs by default (prevents mixed-version split-brain).
  - Set `NODE_ENV=production SERVER_REUSE_PORT=1` and verify startup log warns that identical code must be running on all listeners.
  - Run `npm run check` and `npm run build`.
- Failure Mode if Missing: requests can be distributed across mixed code versions on the same port, causing non-deterministic admin save/read behavior and broken propagation guarantees.

### PRD-SEC-007
- ID: `PRD-SEC-007`
- Date (UTC): `2026-02-19`
- Scope: `CSRF double-submit cookie same-site integrity`
- Requirement: `COOKIE_SAMESITE=none` must never be used for CSRF double-submit cookies; runtime must enforce `lax`/`strict` only and reject insecure startup configuration.
- Enforcement: `server/security/csrf.ts` (`resolveCookieSameSite` clamps `none` to `lax` with security log) and `server/index.ts` (`validateEnvVars` treats `COOKIE_SAMESITE=none` as critical startup error).
- Validation:
  - Start server with `COOKIE_SAMESITE=none` and verify startup aborts with critical env error.
  - For runtime fallback safety, call `/api/csrf` with `COOKIE_SAMESITE=none` and verify CSRF cookie is emitted with `SameSite=Lax`.
  - Run `npm run check` and `npm run e2e`.
- Failure Mode if Missing: cross-site contexts can exfiltrate/send CSRF token cookies, collapsing CSRF protection semantics in session-authenticated flows.

### PRD-AUTH-003
- ID: `PRD-AUTH-003`
- Date (UTC): `2026-02-19`
- Scope: `Email verification token keyed hashing`
- Requirement: Email verification token hashing must always be HMAC-based with `EMAIL_VERIFY_TOKEN_SECRET` (minimum 32 chars); plain SHA fallback is forbidden.
- Enforcement: `server/security/emailVerificationToken.ts` (secret validation + HMAC hash), `server/routes.ts`, `server/routes/verification.ts`, and `server/cron/verificationReminders.ts` (all token hash call sites use helper), plus `server/index.ts` production secret validation.
- Validation:
  - Unset `EMAIL_VERIFY_TOKEN_SECRET` and trigger email-token generation path; verify request fails with configuration error (no token row written).
  - Set valid secret and verify token generation + verification succeed in register/profile resend flows.
  - Run `npm run check` and `npm run e2e`.
- Failure Mode if Missing: DB-read attackers can replay/forge verification tokens with unsalted SHA derivation, weakening account-verification security boundaries.

### PRD-LEGAL-001
- ID: `PRD-LEGAL-001`
- Date (UTC): `2026-02-19`
- Scope: `Signup + legal acceptance atomicity`
- Requirement: User creation and mandatory legal acceptance recording must commit in one DB transaction; no account may persist without a corresponding acceptance row.
- Enforcement: `server/routes.ts` (`/api/auth/register` wraps create-user + `recordDoc1Acceptance` in one transaction), `server/storage.ts` (`createUserInTransaction`), and `server/legal/legalAcceptanceService.ts` (`tx`-aware acceptance insert).
- Validation:
  - Force `recordDoc1Acceptance` failure (invalid token/SHA) during signup and verify no user row persists afterward.
  - Verify successful signup still creates user + legal acceptance and subsequent login works.
  - Run `npm run check` and `npm run e2e`.
- Failure Mode if Missing: orphaned accounts can be created without legal acceptance evidence, violating compliance/audit invariants and creating irrecoverable signup states.

### PRD-SEC-008
- ID: `PRD-SEC-008`
- Date (UTC): `2026-02-19`
- Scope: `Login anti-enumeration + explicit brute-force throttling`
- Requirement: `/api/auth/login` must enforce explicit rate limits (IP and IP+email scopes) and return a uniform account-unavailable response for deleted/disabled/frozen/enforced states without leaking internal status metadata.
- Enforcement: `server/security/loginRateLimit.ts` (Valkey-backed + local fallback counters), `server/routes.ts` (`/api/auth/login` limiter gate, `Retry-After`, and uniform `ACCOUNT_UNAVAILABLE` response body).
- Validation:
  - Repeatedly post invalid login attempts from the same IP and verify `429 LOGIN_RATE_LIMITED` with `Retry-After`.
  - Verify deleted/disabled/frozen/grift-enforced accounts all return the same external response shape.
  - Run `npm run check` and `npm run e2e`.
- Failure Mode if Missing: credential-stuffing attempts can scale unchecked, and compromised credentials leak sensitive internal account state classifications.

### PRD-SEC-009
- ID: `PRD-SEC-009`
- Date (UTC): `2026-02-19`
- Scope: `Legal reacceptance fail-closed semantics + impersonation metadata privacy`
- Requirement: If live legal reacceptance computation is unavailable and no trusted requirement snapshot can assert blocking status, `/api/auth/current-user` must fail closed (`legalReacceptRequired=true`, `legalReacceptBlocked=true`, reason `LEGAL_STATUS_UNAVAILABLE`), and impersonated sessions must never expose `realAdminId`/`realAdminEmail` to the impersonated client.
- Enforcement: `server/routes.ts` (`loadLegalReacceptState` fallback policy and current-user payload shaping).
- Validation:
  - Simulate legal compute/snapshot failures and verify current-user response blocks trading via legal gate state.
  - Verify impersonated users receive `isImpersonating` without real admin identity leakage.
  - Run `npm run check` and `npm run e2e`.
- Failure Mode if Missing: legal reacceptance can be bypassed during partial outages, and admin identities can leak to impersonated user surfaces.

### PRD-SEC-010
- ID: `PRD-SEC-010`
- Date (UTC): `2026-02-19`
- Scope: `Cluster-safe CAPTCHA single-use + OTP cryptographic integrity`
- Requirement: Slider CAPTCHA consume must be single-use across multi-process deployments via distributed lock (Valkey `SET NX PX` with local fallback), slider solve/submit TTL semantics must be harmonized to a consistent 10-minute window, and SMS OTP hashing/verification must use keyed HMAC + timing-safe comparison (no plain SHA fallback).
- Enforcement: `server/security/captcha.ts` (distributed consume lock + TTL constants), `server/routes/captchaSlider.ts` (solve TTL application), `server/security/smsOtpToken.ts` (HMAC + timing-safe compare), and `server/routes/verification.ts` (helper integration).
- Validation:
  - Attempt parallel slider-consume submits against the same solved challenge and verify only one succeeds.
  - Verify slider solve and submit remain valid within the intended 10-minute TTL boundary.
  - Verify OTP paths fail closed when keyed secret is unavailable/weak and use timing-safe hash comparison.
  - Run `npm run check` and `npm run e2e`.
- Failure Mode if Missing: CAPTCHA replay windows remain open across workers, TTL behavior remains inconsistent for real users, and OTP material is exposed to offline grinding/timing leakage risks.

### PRD-PERF-007
- ID: `PRD-PERF-007`
- Date (UTC): `2026-02-20`
- Scope: `Client route-prefetch burst tuning persistence`
- Requirement: `global_settings` must include persisted prefetch controls (`prefetch_max_concurrency`, `prefetch_start_delay_ms`) and enforce bounded values (`1..6`, `0..15000`) before broadcasting to clients.
- Enforcement: `db/migrations/0033_global_settings_prefetch_tuning.sql`, `shared/schema.pg.ts`, `server/routes/admin.ts` (`/api/admin/global-settings` validation + persistence), and `server/routes/public/globalSettings.ts` (`/api/global-settings` projection/clamp).
- Validation:
  - Run `npm run db:migrate:drizzle` and verify migration `0033_global_settings_prefetch_tuning` is applied.
  - `GET /api/admin/global-settings` and confirm new fields are present.
  - `PUT /api/admin/global-settings` with out-of-range prefetch values and verify `400`; submit in-range values and verify persistence plus `global-settings:updated` broadcast payload contains updated performance settings.
  - `GET /api/global-settings` and verify clamped values are exposed to clients.
- Failure Mode if Missing: prefetch tuning controls silently fall back to defaults or become non-persistent, causing inconsistent warm-up behavior and loss of operator control for fast-load optimization.

### PRD-DB-001
- ID: `PRD-DB-001`
- Date (UTC): `2026-02-21`
- Scope: `Schema-audit parity for session store + capital defaults`
- Requirement: Every production schema change must be represented by both a committed SQL migration file and a matching `db/migrations/meta/_journal.json` entry, and runtime Postgres session-store table `session` must be migration-managed and modeled in `shared/schema.pg.ts` so `db:audit` remains deterministic across environments.
- Enforcement: `db/migrations/0034_default_capital_settings.sql`, `db/migrations/0035_session_store_schema_alignment.sql`, `db/migrations/meta/_journal.json` (entries `0034` + `0035`), and `shared/schema.pg.ts` (`session` table export).
- Validation:
  - Run `npm run db:migrate:drizzle` and verify both pending migrations apply.
  - Run `npm run db:audit` and verify no missing columns on `global_settings` and no extra unmanaged `session` table warning.
  - Confirm `information_schema.columns` for `global_settings` includes `default_user_starting_balance_usd`, `default_user_starting_equity_usd`, and `default_challenge_virtual_capital_usd`.
- Failure Mode if Missing: migrations can be silently skipped due journal drift, leading to schema/code mismatch in production (`global_settings` missing columns) and non-deterministic audit output due unmanaged runtime-created `session` table.

### PRD-PERF-008
- ID: `PRD-PERF-008`
- Date (UTC): `2026-02-21`
- Scope: `Admin-driven prefetch tier caps + delay floors`
- Requirement: Tier-specific prefetch controls (`prefetch_*_concurrency_cap`, `prefetch_network_*_start_delay_ms`, `prefetch_device_*_start_delay_ms`) must be persisted, range-bounded, exposed on admin/public global settings, and broadcast through `global-settings:updated` so System Config → Market Data card edits propagate immediately.
- Enforcement: `db/migrations/0036_global_settings_prefetch_tier_controls.sql`, `shared/schema.pg.ts`, `server/routes/admin.ts` (`/api/admin/global-settings` parse/range clamp + live event payload), `server/routes/public/globalSettings.ts`, `server/routes/publicCore.ts`, and `client/src/lib/globalSettingsPerformance.ts` (live merge allowlist).
- Validation:
  - Run `npm run db:migrate:drizzle` and verify migration `0036_global_settings_prefetch_tier_controls` is applied.
  - Save new tier-cap/delay fields from System Config → Market Data and verify values persist via `GET /api/admin/global-settings`.
  - Verify `global-settings:updated` websocket payload includes new `performanceSettings` keys and active clients update without reload.
  - Verify `GET /api/global-settings` returns clamped values for the new fields.
- Failure Mode if Missing: admin edits to tier prefetch controls either do not persist or do not propagate live, causing stale/incorrect startup warm-up behavior across sessions and nodes.

### PRD-PERF-009
- ID: `PRD-PERF-009`
- Date (UTC): `2026-02-21`
- Scope: `Live performance-patch cache consistency across admin/client consumers`
- Requirement: `global-settings:updated` performance patches must merge without creating partial cache objects when no prior settings payload exists, and admin/runtime consumers must resolve nested `performanceSettings` overlays so cards/settings reflect live updates immediately.
- Enforcement: `client/src/live/ConfigSync.tsx` (cache-merge guard for absent prior payload), `client/src/lib/globalSettingsPerformance.ts` (nested performance overlay resolver + allowlist sanitation), and `client/src/pages/AdminDashboard.tsx` / `client/src/hooks/use-performance-settings.ts` (resolver usage for immediate view/runtime updates).
- Validation:
  - Connect two authenticated sessions (admin + viewer), save Market Data performance controls from admin, and verify the second session reflects updated card values without page reload.
  - Emit `global-settings:updated` before `/api/global-settings` has been fetched and verify no partial object replaces the query cache.
  - Run `npx vitest run client/src/live/ConfigSync.test.ts client/src/hooks/use-performance-settings.test.tsx`.
- Failure Mode if Missing: live updates can transiently downgrade config cache shape, trigger false schema warnings, or leave admin cards/runtime settings stale until a later refetch.

### PRD-SEC-011
- ID: `PRD-SEC-011`
- Date (UTC): `2026-02-21`
- Scope: `Partner invite token redemption abuse control`
- Requirement: `/api/partner/invite/redeem` must enforce production HTTPS transport and per-IP/per-token redeem rate limits with `Retry-After` hints.
- Enforcement: `server/routes/partnerPortal.ts` (`partnerAuthRouter.post("/invite/redeem")` with `PARTNER_HTTPS_REQUIRED` and `INVITE_REDEEM_RATE_LIMITED` guards + in-memory limiter cleanup).
- Validation:
  - Run with `NODE_ENV=production`, call redeem over non-loopback HTTP, and verify `426 PARTNER_HTTPS_REQUIRED`.
  - Submit repeated redeem attempts above threshold from one IP/token and verify `429 INVITE_REDEEM_RATE_LIMITED` with `Retry-After`.
  - Submit valid redeem request under threshold and verify normal success path.
- Failure Mode if Missing: invite-token brute force and hash-compute floods can degrade partner auth endpoints and expose sensitive bootstrap flow to abuse.

### PRD-API-004
- ID: `PRD-API-004`
- Date (UTC): `2026-02-21`
- Scope: `Admin scout/partner critical mutation idempotency`
- Requirement: Critical admin mutations (`PUT /api/admin/scout/pipeline/:userId`, `POST /api/admin/partners`, `POST /api/admin/partners/invite`) must require `x-idempotency-key` and replay the original response for duplicate keys/payloads.
- Enforcement: `server/routes/adminScout.ts` (`beginIdempotentMutation`, `commitIdempotentMutation`, replay/conflict handling) and `client/src/components/admin/ScoutWorkbench.tsx` (mutation header emission).
- Validation:
  - Call a guarded endpoint without `x-idempotency-key` and verify `400 IDEMPOTENCY_KEY_REQUIRED`.
  - Repeat the same request with identical key/payload and verify replay response with `X-Idempotent-Replay: 1`.
  - Reuse the key with a different payload and verify `409 IDEMPOTENCY_KEY_CONFLICT`.
- Failure Mode if Missing: network retries and duplicate submits can create duplicate partners/invites or apply pipeline updates multiple times.

### PRD-PERF-010
- ID: `PRD-PERF-010`
- Date (UTC): `2026-02-21`
- Scope: `Partner tear-sheet query burst containment`
- Requirement: `/api/partner/tear-sheet/:hashId` must deduplicate in-flight requests and serve a short-lived cached payload for identical partner/hash/day requests.
- Enforcement: `server/routes/partnerPortal.ts` (`tearSheetInflight`, `tearSheetResponseCache`, cache TTL and bounded entry cap).
- Validation:
  - Send concurrent identical tear-sheet requests and verify only one heavy query path executes while others reuse in-flight/cached payload.
  - Reissue same request within cache TTL and verify fast cached response path.
  - Verify cache entries evict beyond max size and expire by TTL.
- Failure Mode if Missing: request bursts fan out redundant heavy SQL work, causing avoidable Postgres CPU spikes and increased latency.

### PRD-WEB-003
- ID: `PRD-WEB-003`
- Date (UTC): `2026-02-21`
- Scope: `Safe service-worker rollout activation`
- Requirement: New service workers must not force immediate takeover; activation must be user-triggered (`sw:activate-now`) with client reload orchestration after controller change.
- Enforcement: `client/src/sw.ts` (remove install-time `skipWaiting`, message-gated activation) and `client/src/main.tsx` (update prompt + `controllerchange` reload flow).
- Validation:
  - Register app with active page open, deploy new build, and verify update prompt appears before activation.
  - Decline prompt and verify active session is not forcibly hijacked.
  - Accept prompt and verify worker activates and page reloads once.
- Failure Mode if Missing: active pages can be hijacked mid-session, producing HTML/chunk mismatch crashes during deploy rollouts.

### PRD-WEB-004
- ID: `PRD-WEB-004`
- Date (UTC): `2026-02-21`
- Scope: `Dynamic-import chunk drift recovery`
- Requirement: Lazy-loaded routes/components must detect chunk-load failures and trigger at most one controlled full reload within cooldown to recover from deploy hash drift.
- Enforcement: `client/src/lib/lazyWithPing.ts` (`isDynamicImportChunkError`, session-scoped reload marker, guarded `window.location.reload()` path).
- Validation:
  - Simulate stale chunk by loading an old page and navigating after deploy; verify one automatic reload attempt occurs.
  - Trigger repeated chunk-load errors within cooldown and verify no reload loop.
  - Verify non-chunk runtime errors still surface to boundaries without forced reload.
- Failure Mode if Missing: users can hit unrecoverable white screens on route transitions after deploy, or enter infinite reload loops if recovery is unbounded.

### PRD-SEC-012
- ID: `PRD-SEC-012`
- Date (UTC): `2026-02-21`
- Scope: `Session cookie SameSite baseline`
- Requirement: Session cookies must default to `SameSite=Strict` unless an explicit deployment override is set (`COOKIE_SAMESITE=lax`).
- Enforcement: `server/routes.ts` express-session cookie config default (`sameSite: "strict"`), startup guard in `server/index.ts` forbidding `COOKIE_SAMESITE=none`.
- Validation:
  - Start app without `COOKIE_SAMESITE`; inspect `Set-Cookie` for session and verify `SameSite=Strict`.
  - Set `COOKIE_SAMESITE=lax` and verify explicit override applies.
  - Set `COOKIE_SAMESITE=none` and verify startup fails.
- Failure Mode if Missing: deployments can unintentionally run weaker default cookie cross-site behavior, increasing CSRF exposure surface.

### PRD-API-005
- ID: `PRD-API-005`
- Date (UTC): `2026-02-21`
- Scope: `Concurrent idempotency key reservation for admin mutations`
- Requirement: Admin idempotency enforcement must reserve keys at mutation start and reject concurrent replays of the same key while the original request is still in flight.
- Enforcement: `server/routes/adminScout.ts` (`beginIdempotentMutation` writes `inFlight` reservation, `commitIdempotentMutation` finalizes replay payload, `releaseIdempotentMutation` clears failed reservations).
- Validation:
  - Submit two concurrent identical requests with the same `x-idempotency-key`; verify exactly one executes and the other returns `409 IDEMPOTENCY_KEY_IN_PROGRESS`.
  - Retry with the same key/payload after completion and verify replay with `X-Idempotent-Replay: 1`.
  - Force the first request to fail and verify a subsequent retry with the same key can proceed (reservation released).
- Failure Mode if Missing: duplicate partner mutations can still execute during network retries/races, creating duplicate writes despite idempotency headers.

### PRD-TRD-005
- ID: `PRD-TRD-005`
- Date (UTC): `2026-02-22`
- Scope: `Cross-pod trade excursion consistency`
- Requirement: Intraday trade excursion bounds (`intradayHigh`, `intradayLow`) used for MFE/MAE must be durably merged in Valkey and resolved on close against durable state so horizontal scaling does not fracture risk analytics.
- Enforcement: `server/trades/excursionTracking.ts` (Valkey max/min merge script + pubsub hydration), `server/engine/orderEngine.ts` (durable close resolver + monotonic DB merge), `server/index.ts` (ingestor-only excursion pubsub initialization).
- Validation:
  - Open a trade, stream quotes through one node, and close from a different node; verify persisted close row retains the full excursion bounds and non-regressed MFE/MAE.
  - Restart an ingestor process mid-trade and verify excursion bounds continue from Valkey state.
  - Confirm pubsub initialization log appears only on ingestor role and non-ingestor roles log skip.
- Failure Mode if Missing: multi-node deployments under-report or regress trade excursions, leading to inconsistent analytics and audit drift.

### PRD-MKT-001
- ID: `PRD-MKT-001`
- Date (UTC): `2026-02-22`
- Scope: `Provider-agnostic quote source attribution`
- Requirement: Quote provenance (`source`) must propagate end-to-end (provider ingest -> Valkey snapshot/per-symbol/rolling buffer -> quote hub -> execution quote selection -> trade audit writes) without hardcoding a single provider identity.
- Enforcement: `server/feeds/quoteFeed.ts`, `server/services/valkey.ts`, `server/routes/wsCore.ts`, `server/services/quoteHub.ts`, `server/services/quoteService.ts`, and `server/engine/orderEngine.ts`.
- Validation:
  - Ingest quotes from two distinct providers/fallback paths and verify `/ws` quote updates expose correct per-row `source`.
  - Verify execution quote retrieval reports expected source (`quote_hub`, `valkey_cache`, `rolling_buffer`, `prev_close_cache`, optional `quotes_db`) across fallback paths.
  - Execute/close trades and verify audit `quoteSource`/`closeSource` matches propagated source rather than static legacy defaults.
- Failure Mode if Missing: provenance is misattributed (for example always reported as one vendor), obscuring latency diagnostics, provider failover analysis, and compliance-grade execution traceability.

### PRD-TRD-006
- ID: `PRD-TRD-006`
- Date (UTC): `2026-02-23`
- Scope: `Execution quote commit-time consistency enforcement`
- Requirement: Market open/close mutations must revalidate execution quotes inside the commit transaction and reject requests when latest quote state is stale, regressed in timestamp, or drifts beyond configured bounds from the decision-time execution quote.
- Enforcement: `server/services/quoteService.ts` (`validateExecutionQuoteAtCommit`) and transaction guards in `server/routes/trader/tradeOpen.ts` and `server/routes/trader/tradeClose.ts`; observability counters in `server/routes/metricsState.ts` and `server/routes/wsCore.ts`.
- Validation:
  - Force quote age beyond `QUOTE_REVALIDATE_MAX_AGE_MS` and verify `409 QUOTE_REVALIDATION_FAILED` with `Retry-After: 1` on trade open/close.
  - Simulate quote timestamp regression and verify rejection `reasonCode = QUOTE_TS_REGRESSED`.
  - Simulate large quote advance drift beyond `QUOTE_REVALIDATE_MAX_EXEC_PRICE_DRIFT_BPS` and verify rejection `reasonCode = QUOTE_PRICE_DRIFT`.
  - Verify `/metrics` increments `trade_open_rejected_quote_revalidation_total` / `trade_close_rejected_quote_revalidation_total` on failures.
- Failure Mode if Missing: trade commits can execute against stale or materially changed market snapshots, causing determinism breaks, execution integrity drift, and weaker audit defensibility under provider latency.

### PRD-OPS-003
- ID: `PRD-OPS-003`
- Date (UTC): `2026-02-23`
- Scope: `Admin session propagation in production-verification scripts`
- Requirement: Release-gate integrity/smoke scripts that authenticate as admin must parse multi-value `Set-Cookie` responses and forward the actual session cookie (`connect.sid`) for subsequent admin API calls.
- Enforcement: `scripts/marketDataIntegrity.ts` and `scripts/traderSearchIntegrity.ts` must parse all returned cookies (`headers.getSetCookie()` preferred), select the configured session cookie (`SESSION_COOKIE_NAME` default `connect.sid`), and reject login probes that do not return a session cookie.
- Validation:
  - Run `npm run start:e2e`, then execute `ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD=changeme npm run integrity:market-data` and `ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD=changeme npm run smoke:trader-search`.
  - Confirm login response includes multiple `Set-Cookie` headers (`tq_rm` + `connect.sid`) and scripts forward `connect.sid` in follow-up requests.
  - Verify admin endpoints no longer fail with immediate `401 Unauthorized` after successful login.
- Failure Mode if Missing: deployment verification can produce false negatives (post-login `401`s), obscuring real platform regressions and reducing trust in release readiness gates.

### PRD-OPS-004
- ID: `PRD-OPS-004`
- Date (UTC): `2026-02-23`
- Scope: `WS fanout load-test assertion integrity under origin enforcement`
- Requirement: WS fanout load testing must send an explicit `Origin` header and fail hard when connection/retention/update thresholds are not met (`min-opened`, `max-failed`, `min-open-before-drain`, `min-quote-updates`).
- Enforcement: `scripts/loadtest/wsFanout.ts` (`origin` support, threshold args, end-of-run assertion gate with non-zero exit on failure).
- Validation:
  - Run `npm run loadtest:ws-fanout -- --url ws://127.0.0.1:5000/ws --origin http://127.0.0.1:5000 --min-opened 20 --min-open-before-drain 10`.
  - Run a negative probe with forbidden origin (`--origin http://evil.example`) and confirm non-zero exit with assertion failure details.
  - Verify success path prints `assertions passed` only when thresholds are satisfied.
- Failure Mode if Missing: WS load tests can report false-green success while production origin policy is rejecting/closing sockets, masking capacity and reliability regressions.

### PRD-RISK-001
- ID: `PRD-RISK-001`
- Date (UTC): `2026-02-23`
- Scope: `Automated close-path stale-quote safety defaults`
- Requirement: System-driven close paths (auto-close and margin-call liquidation) must default to rejecting stale-quote execution unless explicitly overridden by `AUTOCLOSE_ALLOW_STALE_CLOSE=true`.
- Enforcement: `server/cron/autoClose.ts` and `server/cron/marginCall.ts` default `AUTOCLOSE_ALLOW_STALE_CLOSE` to `false`.
- Validation:
  - Start with `AUTOCLOSE_ALLOW_STALE_CLOSE` unset and simulate stale quote inputs; verify scheduler logs deferred/skip behavior instead of executing closes.
  - Set `AUTOCLOSE_ALLOW_STALE_CLOSE=true` and verify stale-close override path is explicitly opt-in.
  - Confirm manual close path still enforces stale-quote rejection independently.
- Failure Mode if Missing: scheduler-driven liquidations can execute on stale prices during feed degradation, weakening execution integrity and audit defensibility.

### PRD-AUD-001
- ID: `PRD-AUD-001`
- Date (UTC): `2026-02-23`
- Scope: `Trade history durability audit release gating`
- Requirement: `audit:trade-history` must support strict, configurable fail gates so production verification can block on durability hazards (empty trades, sequence skew, missing anti-wipe triggers, likely ephemeral storage).
- Enforcement: `scripts/tradeHistoryDurabilityAudit.ts` (`TRADE_HISTORY_AUDIT_STRICT`, `TRADE_HISTORY_AUDIT_FAIL_ON_*` guards with non-zero exit on triggered hard failures).
- Validation:
  - Run with strict mode enabled and selected fail toggles (for example `TRADE_HISTORY_AUDIT_STRICT=1 TRADE_HISTORY_AUDIT_FAIL_ON_MISSING_TRIGGERS=1 npm run audit:trade-history`).
  - Confirm triggered guard(s) produce `FAIL: durability guard(s) triggered` and non-zero exit.
  - Confirm strict mode can be tuned per environment via explicit `TRADE_HISTORY_AUDIT_FAIL_ON_*` overrides.
- Failure Mode if Missing: durability regressions remain warning-only and can ship without release interruption, weakening institutional audit guarantees.

### PRD-TRD-007
- ID: `PRD-TRD-007`
- Date (UTC): `2026-02-23`
- Scope: `Core trade route compile-time safety coverage`
- Requirement: Core trade lifecycle route modules (`tradeOpen`, `tradeClose`, `tradeCancel`, `trades`) must remain under TypeScript checks with explicit session-user narrowing and no file-level `@ts-nocheck`.
- Enforcement: `server/routes/trader/tradeOpen.ts`, `server/routes/trader/tradeClose.ts`, `server/routes/trader/tradeCancel.ts`, `server/routes/trader/trades.ts`.
- Validation:
  - Run `npm run check` and confirm these modules type-check without `@ts-nocheck`.
  - Verify route handlers reject invalid/missing session user IDs with 401 before trade mutations/queries.
  - Execute trading route smoke/e2e checks to confirm behavior parity.
- Failure Mode if Missing: silent type regressions in order-open/close/cancel/history hot paths can bypass compile-time detection and increase runtime defect risk.

### PRD-PERF-011
- ID: `PRD-PERF-011`
- Date (UTC): `2026-02-23`
- Scope: `Startup trader data burst prefetch safety + cache cohesion`
- Requirement: Client startup API warmup must remain tier-bounded and `saveData`-aware, use an allowlisted trader query-key set, dedupe in-flight prefetches, and integrate with encrypted query persistence without routing `/api/*` through service-worker cache.
- Enforcement: `client/src/lib/startupDataPrefetch.ts` (tier-plan gating, allowlist, bounded concurrency, in-flight dedupe), `client/src/main.tsx` and `client/src/AuthenticatedShell.tsx` (public/authenticated startup warmup wiring), `client/src/lib/queryPersistence.ts` (persist/hydrate coverage for warmed keys), and `client/src/sw.ts` (`/api/*` and `/ws` bypass guard).
- Validation:
  - Run `npx vitest run --pool=threads --maxWorkers=1 client/src/lib/startupDataPrefetch.test.ts client/src/lib/perfHints.test.ts client/src/lib/routePrefetch.test.ts client/src/lib/queryPersistence.test.ts client/src/lib/queryPersistence.hydrate.test.ts client/src/live/ConfigSync.test.ts client/src/hooks/use-performance-settings.test.tsx`.
  - Verify `saveData` profiles skip startup data burst prefetch and constrained tiers cap warmup scope/concurrency.
  - Run `npm run check` and `npm run build` to confirm integration/type/build safety.
- Failure Mode if Missing: startup can trigger duplicate or unbounded request bursts, weak-network clients can lose API/WS headroom, and warmed trader state may not hydrate/persist coherently across reloads.

### PRD-GRIFT-001
- ID: `PRD-GRIFT-001`
- Date (UTC): `2026-02-23`
- Scope: `Grift correlation scalability controls (config propagation, edge writes, and read-path indexing)`
- Requirement: Grift runtime must keep config-cache staleness bounded (default 15s, clamped to 5s-120s via `GRIFT_CONFIG_TTL_MS`), write linked-account edges through bounded batched upserts (no per-edge sequential N+1 writes), and ensure Grift correlation indexes from migration `0037_grift_scalability_indexes` are present in production.
- Enforcement: `server/grift/griftEngine.ts` (`CONFIG_TTL_MS` bounded parsing + `recordLinkedEdgesBatch` with `MAX_LINKED_EDGE_BATCH_ROWS`), `db/migrations/0037_grift_scalability_indexes.sql`, and mirrored index metadata in `shared/schema.pg.ts`.
- Validation:
  - Run `npm run db:migrate:drizzle` and confirm migration `0037_grift_scalability_indexes` is applied.
  - Run `npm run db:audit` and confirm schema parity is `OK`.
  - Execute Grift detection paths that trigger `MULTI_ACCOUNT_DEVICE`, `MULTI_ACCOUNT_FINGERPRINT`, and `SHARED_IPASN_CLUSTER`; verify edge writes succeed with bounded batch execution and expected `edgesRecorded` evidence values.
  - Override `GRIFT_CONFIG_TTL_MS` with out-of-range values and confirm runtime clamps to safe bounds (no unbounded staleness / no pathological refresh churn).
- Failure Mode if Missing: multi-pod config changes propagate too slowly, high-volume correlation events create avoidable DB round-trip amplification, and Grift queries degrade under scale due missing predicate-aligned indexes.

### PRD-ACT-001
- ID: `PRD-ACT-001`
- Date (UTC): `2026-02-24`
- Scope: `Admin activity lifecycle (queue/delete/exempt/sweep) abuse and scale safety`
- Requirement: Admin activity payloads must be bounded (`userIds` max 500), expensive activity operations must be rate-limited, inactivity listing/sweep logic must run with bounded batch/scan limits, and supporting lifecycle indexes must be present in production.
- Enforcement: `server/routes/adminActivity.ts` (strict Zod payload/query validation + route rate limits), `server/services/accountLifecycle.ts` (bounded scan/batch chunking + transactional row-lock lifecycle mutations), and `db/migrations/0038_activity_lifecycle_indexes.sql` (activity/sweep index set).
- Validation:
  - Run `npm run db:migrate:drizzle`.
  - Run `npm run db:audit`.
  - Run `npm run audit:activity`.
  - Submit oversized admin activity payloads (`userIds.length > 500`) and verify `400 INVALID_PAYLOAD`.
  - Burst `/api/admin/activity/sweep` requests in a 60s window and verify `429 ACTIVITY_SWEEP_RATE_LIMIT`.
- Failure Mode if Missing: privileged or compromised admin sessions can trigger unbounded CPU/DB workloads (DoS), and lifecycle sweep/list operations degrade predictably as data volume grows.

### PRD-SEC-013
- ID: `PRD-SEC-013`
- Date (UTC): `2026-02-24`
- Scope: `Admin impersonation abuse controls + websocket TTL parity`
- Requirement: `POST /api/admin/view-as/start` must enforce strict request typing (`{ userId: number }`, positive int, no extra fields) and per-admin rate limits (`10` starts / `5` minutes), and impersonated `/ws` sessions must fail closed when impersonation state is malformed or TTL-expired (`15` minutes), with attributable audit events for WS connect and TTL-forced disconnect.
- Enforcement: `server/routes/admin.ts` (`viewAsStartSchema`, `consumeViewAsStartRateLimit`, `429 VIEW_AS_RATE_LIMITED`), `server/middleware/auth.ts` (`IMPERSONATION_TTL_MS` source of truth), and `server/routes/wsCore.ts` (handshake/interval TTL enforcement + `IMPERSONATION_WS_CONNECTED` and `IMPERSONATION_WS_TTL_EXPIRED` identity-audit events).
- Validation:
  - Call `POST /api/admin/view-as/start` with malformed body (for example `{ "userId": "1" }` or extra fields) and verify `400 INVALID_PAYLOAD`.
  - Burst more than 10 valid start requests within 5 minutes from one admin session and verify `429 VIEW_AS_RATE_LIMITED` with `Retry-After`.
  - Create an impersonated session with stale `impersonationStartedAt` and verify websocket handshake closes with `IMPERSONATION_EXPIRED` / close code `1008`.
  - Open an impersonated websocket session and verify `identity_audit` records `IMPERSONATION_WS_CONNECTED`; wait past TTL and verify `IMPERSONATION_WS_TTL_EXPIRED`.
- Failure Mode if Missing: compromised admin sessions can enumerate trader identities at high rate, and impersonated websocket streams can outlive HTTP impersonation policy windows without immutable actor-trace evidence.

### PRD-WEB-005
- ID: `PRD-WEB-005`
- Date (UTC): `2026-02-24`
- Scope: `Client locale preference isolation on shared devices`
- Requirement: Locale preference cache used for translations must be scoped per authenticated account (`i18n.locale.user.<userId>`) and must never let one account inherit another account's stored locale on the same browser/device.
- Enforcement: `shared/locale/preferences.ts` (user-locale key prefix), `client/src/i18n/localeStorage.ts` (account-scoped locale reads/writes + fallback policy), `client/src/i18n/I18nProvider.tsx` (user-scoped locale sync/hydration), and `client/src/hooks/use-auth.tsx` (auth hydration reads account-scoped locale only).
- Validation:
  - Log in as Account A, set language to Portuguese, log out, then log in as Account B with English preference and verify post-login UI language remains English.
  - Confirm localStorage contains separate keys per user (`i18n.locale.user.<A>`, `i18n.locale.user.<B>`) and that active locale updates do not overwrite another user's scoped key.
  - Run `npx vitest run client/src/i18n/localeStorage.test.ts`, `npm run check`, and `npm run build`.
- Failure Mode if Missing: translation language and profile-adjacent locale behavior can leak across accounts on shared devices, causing incorrect localization and cross-account state bleed.

### PRD-WEB-006
- ID: `PRD-WEB-006`
- Date (UTC): `2026-02-24`
- Scope: `Profile preference mutation liveness under degraded network`
- Requirement: Client profile preference/language mutations must fail-fast with bounded request timeouts and must not block language-save side effects on i18n bundle prefetch completion.
- Enforcement: `client/src/pages/ProfileSettings.tsx` (`withTimeout`, bounded mutation timeout constants, non-blocking i18n prefetch in `handleLanguageChange`).
- Validation:
  - Simulate a stalled `GET /api/i18n/bundle?locale=<target>` request and verify language selection still triggers `PUT /api/profile/preferences`.
  - Simulate stalled `PUT /api/profile/preferences` and verify UI exits pending state with timeout toast/error instead of remaining on `Saving...`.
  - Run `npm run check` and `npm run build`.
- Failure Mode if Missing: profile screen can remain indefinitely stuck in `Saving...` on transient network/backend stalls, preventing preference updates and requiring manual reload.

### PRD-ADM-002
- ID: `PRD-ADM-002`
- Date (UTC): `2026-02-24`
- Scope: `Admin global trade-settings consistency + audit traceability`
- Requirement: `PUT /api/admin/global-settings` must enforce optimistic concurrency for existing rows by requiring a numeric `expectedUpdatedAt` token and rejecting stale/missing tokens with `409`; the route must also emit immutable admin audit entries for risk/default-setting deltas (`GLOBAL_SETTINGS_RISK_UPDATED`) in addition to performance-setting deltas.
- Enforcement: `server/routes/admin.ts` (global settings update handler token gate + risk/performance audit append).
- Validation:
  - Call `GET /api/admin/global-settings`, then `PUT /api/admin/global-settings` with changed capital/risk fields and matching `expectedUpdatedAt`; verify `200` and persisted values.
  - Repeat `PUT` using an older `expectedUpdatedAt`; verify `409` conflict response.
  - Verify identity-audit writes include `GLOBAL_SETTINGS_RISK_UPDATED` for risk/default changes and `GLOBAL_SETTINGS_PERFORMANCE_UPDATED` for performance changes.
  - Run `npm run check` and `npm run build`.
- Failure Mode if Missing: concurrent admin updates can overwrite each other silently across sessions/nodes, and critical global risk/default changes can occur without attributable, non-repudiable audit evidence.

### PRD-ADM-003
- ID: `PRD-ADM-003`
- Date (UTC): `2026-02-24`
- Scope: `Admin global trade-settings abuse resistance + schema pipeline unification`
- Requirement: `PUT /api/admin/global-settings` must enforce distributed save throttling (`429` + `Retry-After`) via Valkey key TTLs (with local fallback only for cache outages), and payload handling must use a strict Zod pipeline with no ad-hoc field acceptance (unknown fields rejected, numeric/time coercion bounded, server-side normalization centralized in service functions).
- Enforcement: `server/security/globalSettingsRateLimit.ts` (Valkey-backed per-admin interval limiter), `server/services/globalSettingsAdmin.ts` (strict parse/normalize/write pipeline), and `server/routes/admin.ts` (rate-limit + parser/service wiring).
- Validation:
  - Issue two rapid `PUT /api/admin/global-settings` calls from the same admin session with a valid CSRF token and fresh `expectedUpdatedAt`; verify second call returns `429` and includes `Retry-After`.
  - Call `PUT /api/admin/global-settings` with stale `expectedUpdatedAt` after throttle window; verify `409`.
  - Call `PUT /api/admin/global-settings` with unexpected fields; verify `400`.
  - Update capital defaults + lot card payload and verify persisted values survive a subsequent `GET /api/admin/global-settings`.
  - Run `npm run check`, `npm run build`, and `npm run e2e`.
- Failure Mode if Missing: multi-node admin endpoints can be spammed without durable throttling, malformed payloads can bypass schema contracts, and global trade-setting writes become less predictable/auditable under load.

### PRD-ADM-004
- ID: `PRD-ADM-004`
- Date (UTC): `2026-02-24`
- Scope: `Admin trade settings form state integrity`
- Requirement: Trade Settings UI must hydrate local edit state from persisted `/api/admin/global-settings` data before dirty-state detection and save-button gating are evaluated.
- Enforcement: `client/src/pages/AdminDashboard.tsx` (`riskParamsHydrated` bootstrap guard around global-settings sync effect for Trade Settings state).
- Validation:
  - Open `/admin`, switch to `Trade Settings`, and verify save buttons are hidden on initial load when no edits are made.
  - Compare displayed Trade Settings values against `GET /api/admin/global-settings`; they must match on first render.
  - Modify one section and verify only that section becomes dirty until an explicit save.
- Failure Mode if Missing: UI can initialize from hardcoded defaults, producing false dirty states and risking accidental overwrite of production risk/capital/market settings.

### PRD-EXP-001
- ID: `PRD-EXP-001`
- Date (UTC): `2026-02-25`
- Scope: `Admin DataTab export durability and backpressure`
- Requirement: All heavy Admin DataTab exports must execute asynchronously through BullMQ on Valkey-backed queues (`admin-export-v1`) and must not run as synchronous request-path downloads.
- Enforcement: `server/routes/adminDataExports.ts` (job create/list/retry/cancel/download-link API), `server/services/adminDataExportQueue.ts` (queue enqueue/worker execution/backoff), `server/index.ts` (`startAdminDataExportWorker()` under `APP_ROLE=worker`), and DB tables/migration `admin_data_export_jobs` + `admin_data_export_job_events` (`shared/schema.pg.ts`, `db/migrations/0039_admin_data_export_jobs.sql`).
- Validation:
  - `POST /api/admin/data-exports` returns `jobId` immediately for `trader_scouting`, `deactivated_accounts`, `all_trades`, and `daily_pnl`.
  - Verify job status transitions `QUEUED -> RUNNING -> READY|FAILED` in `GET /api/admin/data-exports`.
  - Kill and restart worker process; requeue/retry must continue from durable DB + queue state.
- Failure Mode if Missing: large exports block Node request threads, trigger timeout/OOM risks at high row counts, and remove operational control over retries/cancelation.

### PRD-EXP-002
- ID: `PRD-EXP-002`
- Date (UTC): `2026-02-25`
- Scope: `Export artifact confidentiality and controlled download`
- Requirement: Export files must be stored outside API response memory path in object storage (MinIO preferred, local fallback only for bootstrap), and downloads must use short-lived links with admin authorization checks.
- Enforcement: `server/services/objectStorage.ts` (upload + signed link generation + local fallback resolver), `server/routes/adminDataExports.ts` (`/download-link` authorization + `/files` guarded fallback stream), and `petascale/docker-compose.yml` MinIO/KES wiring.
- Validation:
  - Complete an export and verify DB `object_key` is set and artifact is not returned inline by the create API.
  - `GET /api/admin/data-exports/:jobId/download-link` returns a TTL-bound URL; expired link requests return `410`.
  - Cross-admin access attempt (different admin user) to another job/link returns `403`.
- Failure Mode if Missing: export payloads can leak through long-lived direct links or unbounded in-memory transfer paths, increasing exfiltration and service degradation risk.

### PRD-OBS-001
- ID: `PRD-OBS-001`
- Date (UTC): `2026-02-25`
- Scope: `Export pipeline observability and early warning`
- Requirement: Production telemetry must expose queue/job lifecycle and backlog metrics for admin exports, with alerting on backlog and failure spikes.
- Enforcement: `server/services/adminDataExportMetrics.ts` (export counters/gauges), `server/routes/wsCore.ts` (`/metrics` export metrics exposition), `petascale/prometheus.yml`, and `petascale/prometheus-rules/alerts.yml`.
- Validation:
  - Trigger exports and confirm `/metrics` includes `admin_data_export_*` counters/gauges.
  - Confirm Prometheus target scrape success for `tradehub-worker` and alert rule load.
  - Simulate queue backlog and verify `TradehubAdminExportQueueBacklog` alert fires.
- Failure Mode if Missing: export incidents become invisible until user-facing failures accumulate, reducing recovery speed and increasing operational risk.

### PRD-OLAP-001
- ID: `PRD-OLAP-001`
- Date (UTC): `2026-02-25`
- Scope: `Postgres->ClickHouse replication path for admin analytics/export offload`
- Requirement: Worker role must run bounded incremental sync (`CLICKHOUSE_SYNC_*`) from OLTP tables (`users`, `trades`, `daily_closes`, `user_account_events`) into ClickHouse admin tables, with schema bootstrap guardrails and watermark persistence (`sync_state`) so replay is idempotent after restarts.
- Enforcement: `server/services/clickhouseSync.ts` (scheduler + watermark replication), `server/services/clickhouseClient.ts` (command/insert/query helpers), `server/index.ts` (worker startup wiring), and `petascale/clickhouse/init/00-init.sql` (ClickHouse table/view definitions).
- Validation:
  - Start worker with ClickHouse enabled and verify logs include `[clickhouse-sync] starting ...`.
  - Verify `/metrics` exposes `clickhouse_sync_*` series and `clickhouse_sync_last_success_at` updates after ticks.
  - Query ClickHouse and confirm `admin_users`, `admin_trades`, `admin_daily_closes`, and `admin_user_account_events` receive rows.
  - Restart worker and confirm sync resumes without duplicate growth from old watermark state.
- Failure Mode if Missing: analytics/exports continue hammering OLTP paths at scale, sync drift grows silently, and worker restarts trigger brittle catch-up behavior.

### PRD-EXP-003
- ID: `PRD-EXP-003`
- Date (UTC): `2026-02-25`
- Scope: `Export artifact lifecycle enforcement and automatic expiry cleanup`
- Requirement: Ready export artifacts must be auto-expired and deleted from storage when `expires_at` elapses, with durable status transition to `EXPIRED` and event journaling.
- Enforcement: `server/services/adminDataExportRetention.ts` (retention scheduler), `server/services/adminDataExportRepo.ts` (`listExpiredAdminDataExportJobs`, `markAdminDataExportJobExpired`), `server/services/objectStorage.ts` (`deleteExportArtifact`), and worker bootstrap in `server/index.ts`.
- Validation:
  - Create an export with a short retention window and verify scheduler logs expiry cleanup.
  - Confirm job status transitions from `READY` to `EXPIRED` and `admin_data_export_job_events` captures cleanup evidence.
  - Verify artifact path/object no longer exists in local storage or MinIO.
- Failure Mode if Missing: stale export artifacts persist indefinitely, increasing data-exfiltration window and storage bloat.

### PRD-SEC-014
- ID: `PRD-SEC-014`
- Date (UTC): `2026-02-25`
- Scope: `Admin export download-link integrity and anti-abuse limits`
- Requirement: Local fallback export download links must be HMAC-signed and validated server-side, and admin export create/download/retry endpoints must enforce bounded per-admin rate limits with `429` and `Retry-After`.
- Enforcement: `server/services/objectStorage.ts` (`verifyLocalDownloadLink` + signed link generation), `server/routes/adminDataExports.ts` (signature verification + rate-limit guards), `k8s/02-secrets.yaml` and `petascale/docker-compose.yml` (`EXPORT_LOCAL_LINK_SIGNING_SECRET`).
- Validation:
  - Request a local fallback download link, tamper `key`/`name`/`exp`/`sig`, and verify request is rejected with `403`.
  - Burst export-create and export-download requests from one admin session and verify `429` responses with `Retry-After`.
  - Verify valid signed links still download when within TTL and authorization scope.
- Failure Mode if Missing: local download URLs become tamperable/replay-prone and admin endpoints remain vulnerable to brute-force or abusive export flooding.

### PRD-EXP-004
- ID: `PRD-EXP-004`
- Date (UTC): `2026-02-25`
- Scope: `Legacy Admin export route compatibility with async pipeline`
- Requirement: Legacy export endpoints (`/api/admin/trader-scouting/export`, `/api/admin/deactivated-accounts/export`) must only enqueue background export jobs and return job handles (`202`) instead of streaming large payloads.
- Enforcement: `server/routes/admin.ts` (`enqueueLegacyAdminDataExportJob`, legacy export route handlers), shared schema validation in `@shared/admin/dataExports`.
- Validation:
  - Call both legacy export endpoints and verify `202` with `jobId`, `deduped`, and `pollUrl`.
  - Verify no large response body streaming occurs from these handlers.
  - Verify created jobs appear in `GET /api/admin/data-exports`.
- Failure Mode if Missing: old callers can still trigger synchronous large exports, causing request-path blocking and OOM/timeout risk.

### PRD-ANA-001
- ID: `PRD-ANA-001`
- Date (UTC): `2026-02-25`
- Scope: `Admin DataTab request-path bounded analytics`
- Requirement: DataTab summary endpoints (`/api/admin/kpi-summary`, `/api/admin/signup-funnel`, `/api/admin/user-analytics`, and compliance metrics) must execute bounded SQL aggregates server-side and must not run in-memory full-table loops or N+1 per-user scans.
- Enforcement: `server/routes/admin.ts` (aggregate SQL rewrites for KPI/funnel/user analytics) and `server/storage.ts` (`getVerificationComplianceMetrics` SQL aggregate query).
- Validation:
  - Inspect handlers for removal of `listUsersWithSettings()` + per-user trade/login loops in these endpoints.
  - Run `npm run check`, `npm run build`, and `npm run smoke:admin` successfully.
  - Hit endpoints and verify correct JSON shape with numeric aggregates.
- Failure Mode if Missing: API latency and memory usage scale with row volume, causing collapse under million-user/billion-row datasets.

### PRD-K8S-002
- ID: `PRD-K8S-002`
- Date (UTC): `2026-02-25`
- Scope: `Application pod runtime hardening`
- Requirement: API/worker/ingestor pods must run non-root with `seccomp` and `readOnlyRootFilesystem`, and writable scratch paths must be explicitly mounted (`/tmp` emptyDir).
- Enforcement: `k8s/10-api-deployment.yaml`, `k8s/11-ingestor-deployment.yaml`, `k8s/12-worker-deployment.yaml`, and runtime path config in `k8s/01-configmap.yaml` (`ADMIN_DATA_EXPORT_LOCAL_DIR=/tmp/admin-data-exports`).
- Validation:
  - `kubectl apply --dry-run=client -f k8s/` passes.
  - Verify rendered pod specs contain `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, and `/tmp` `emptyDir` mount.
  - Verify worker export jobs can still produce temporary artifacts in `/tmp`.
- Failure Mode if Missing: container breakout impact and filesystem tampering risk increase, or export workers fail when scratch storage is unavailable.

### PRD-K8S-003
- ID: `PRD-K8S-003`
- Date (UTC): `2026-02-25`
- Scope: `Ingress abuse controls and service-edge TLS`
- Requirement: Public ingress must enforce TLS redirect and baseline request throttling/body-size controls to reduce DOS amplification on admin/data endpoints.
- Enforcement: `k8s/30-ingress.yaml` annotations (`limit-rps`, `limit-connections`, `proxy-body-size`, `ssl-redirect`, `force-ssl-redirect`) and TLS stanza with `tradehub-tls` secret.
- Validation:
  - `kubectl apply --dry-run=client -f k8s/` passes.
  - Inspect ingress annotations and TLS block in rendered manifest.
  - Confirm plain HTTP requests are redirected at ingress and oversized requests are constrained.
- Failure Mode if Missing: edge remains vulnerable to burst abuse and unbounded request bodies, increasing DOS and resource exhaustion risk.

### PRD-K8S-004
- ID: `PRD-K8S-004`
- Date (UTC): `2026-02-25`
- Scope: `Intra-cluster service ingress minimization`
- Requirement: Core petascale services must restrict pod ingress paths to expected namespace/service callers via Kubernetes NetworkPolicy.
- Enforcement: `k8s/31-network-policies.yaml` (policies for `tradehub-api`, `tradehub-worker`, `tradehub-ingestor`, `tradehub-minio`, `tradehub-clickhouse`).
- Validation:
  - `kubectl apply --dry-run=client -f k8s/` passes.
  - Verify selected pods have corresponding NetworkPolicy resources.
  - Confirm allowed intra-namespace traffic remains functional for API/worker/prometheus paths.
- Failure Mode if Missing: lateral movement paths remain broad inside cluster, increasing blast radius after pod compromise.

### PRD-K8S-005
- ID: `PRD-K8S-005`
- Date (UTC): `2026-02-25`
- Scope: `Read-only root filesystem compatibility for migration import runtime path`
- Requirement: Any pod role running with `readOnlyRootFilesystem: true` must mount a writable path at `/app/migration_imports` (or explicitly redirect migration import storage to another writable mount) because migration service bootstrapping creates that directory at process startup.
- Enforcement: `k8s/10-api-deployment.yaml`, `k8s/11-ingestor-deployment.yaml`, `k8s/12-worker-deployment.yaml`, and `k8s/13-worker-canary-deployment.yaml` (`migration-imports` `emptyDir` + mountPath `/app/migration_imports`).
- Validation:
  - `kubectl apply --dry-run=client -f k8s/10-api-deployment.yaml -f k8s/11-ingestor-deployment.yaml -f k8s/12-worker-deployment.yaml -f k8s/13-worker-canary-deployment.yaml` passes.
  - Roll out each deployment and verify pods become `Running/Ready` without `ENOENT ... mkdir '/app/migration_imports'`.
  - Confirm readiness probes remain healthy after restart for API/worker/ingestor roles.
- Failure Mode if Missing: security hardening (`readOnlyRootFilesystem`) causes crash loops during startup, blocking API cutover and worker/ingestor recovery.

### PRD-ANA-002
- ID: `PRD-ANA-002`
- Date (UTC): `2026-02-25`
- Scope: `Admin DataTab bounded rollup snapshots on hot analytics endpoints`
- Requirement: DataTab hot endpoints (`/api/admin/kpi-summary`, `/api/admin/signup-funnel`, `/api/admin/user-analytics`, `/api/admin/analytics/compliance`, `/api/admin/deactivated-accounts/summary`) must be served through a durable Postgres rollup snapshot table (`admin_data_rollups`) with bounded freshness windows so request-path load does not repeatedly execute heavyweight full aggregations.
- Enforcement: `server/routes/adminDataRollups.ts` (rollup-first route handlers + cache-state headers), `server/services/adminDataRollups.ts` (compute/upsert/read + worker scheduler), `db/migrations/0040_admin_data_rollups.sql`, and `shared/schema.pg.ts` (`adminDataRollups` schema).
- Validation:
  - Run `npm run db:migrate:drizzle` and verify `admin_data_rollups` table/index creation.
  - Hit each hot endpoint and verify response headers include `X-Admin-Rollup-*`.
  - Verify worker role logs `[admin-data-rollups] scheduler started` and periodic refreshes complete without errors.
- Failure Mode if Missing: repeated expensive analytics queries stay in request path, increasing latency/CPU and reducing stability under high admin concurrency.

### PRD-SEC-015
- ID: `PRD-SEC-015`
- Date (UTC): `2026-02-25`
- Scope: `Legacy institutional audit export abuse and CSV formula hardening`
- Requirement: Legacy audit export endpoints (`/api/admin/trade-audit/export/csv`, `/api/admin/order-intent-audit/export/csv`, `/api/admin/trade-audit/export/jsonl`) must enforce strict upper bounds on export row counts and neutralize CSV formula-injection payloads before serialization.
- Enforcement: `server/routes/admin.ts` (`clampAuditExportLimit`, `neutralizeCsvFormulaRecord`, capped `.limit(...)` usage in audit export handlers).
- Validation:
  - Request exports with very large `limit` and verify query cap is applied.
  - Include formula-leading text values (`=`, `+`, `-`, `@`) in exportable fields and verify CSV output prefixes with `'`.
  - Confirm existing export manifest hash headers are still emitted.
- Failure Mode if Missing: privileged endpoints can trigger oversized synchronous exports and CSV artifacts remain vulnerable to spreadsheet formula execution vectors.

### PRD-TEST-003
- ID: `PRD-TEST-003`
- Date (UTC): `2026-02-25`
- Scope: `Admin analytics/export loadtest coverage`
- Requirement: Repository test tooling must include dedicated load generators for Admin DataTab hot read endpoints and async export pipeline lifecycle.
- Enforcement: `scripts/loadtest/adminDataTab.ts`, `scripts/loadtest/exportPipeline.ts`, and `package.json` scripts (`loadtest:admin-data-tab`, `loadtest:export-pipeline`).
- Validation:
  - Run `npm run loadtest:admin-data-tab` with `LOADTEST_ADMIN_COOKIE` and verify p95/error assertions pass.
  - Run `npm run loadtest:export-pipeline` with `LOADTEST_ADMIN_COOKIE` and verify queued jobs reach terminal READY state with valid download links.
- Failure Mode if Missing: scale regressions in admin analytics/export paths are discovered late and are more likely to reach production.

### PRD-TEST-004
- ID: `PRD-TEST-004`
- Date (UTC): `2026-02-25`
- Scope: `CSRF-correct write-path load testing`
- Requirement: Any loadtest that performs authenticated `POST/PUT/PATCH/DELETE` against `/api/*` must model the full CSRF double-submit contract (session cookie + CSRF cookie + CSRF header), not only bearer/session identity.
- Enforcement: `scripts/loadtest/exportPipeline.ts` (`fetchCsrfToken` + merged cookie jar propagation in create/poll/download flow).
- Validation:
  - Run `npm run loadtest:export-pipeline` with `LOADTEST_ADMIN_COOKIE`.
  - Confirm job creation succeeds without `CSRF_TOKEN_INVALID` and reaches terminal READY with valid download link checks.
- Failure Mode if Missing: write-path loadtests produce false negatives (`403 CSRF_TOKEN_INVALID`) and fail to validate real queue/export behavior.

### PRD-AUD-004
- ID: `PRD-AUD-004`
- Date (UTC): `2026-02-25`
- Scope: `Hedge-fund-grade Admin Audit Trail report completeness + linkage`
- Requirement: `/api/admin/audit-trail` must include deep trade/order audit events with exhaustive forensic fields and explicit linkage maps (correlation ID, session ID, user ID) so audit reports can reconstruct full lifecycle chains across signup/login/admin/identity/trade systems.
- Enforcement: `server/services/adminAuditTrail.ts` (deep event fetchers + linkage builders), `server/routes/admin.ts` (`/api/admin/audit-trail` response enrichment), and `server/storage.ts` (`getAllLoginHistory` session/device fields).
- Validation:
  - Call `/api/admin/audit-trail?limit=200&includeDeepTrade=1&includeLinkage=1` and verify response includes `tradeAuditEvents`, `orderIntentEvents`, and `linkage.byCorrelationId/bySessionId/byUserId`.
  - Verify trade/order events include chain columns (`prevHash`, `eventHash`) and lifecycle IDs (`correlationId`, `orderId`, `executionId`, `positionId`, `sessionId`).
  - Verify Admin Dashboard Audit Trail tab renders these events and linkage details without client errors.
- Failure Mode if Missing: audit operators cannot reliably correlate events across subsystems, reducing forensic confidence and weakening institutional reporting/auditability.

### PRD-AUD-005
- ID: `PRD-AUD-005`
- Date (UTC): `2026-02-25`
- Scope: `Institutional audit export offload and decomposed admin audit routing`
- Requirement: Institutional audit exports (`/api/admin/trade-audit/export/csv|jsonl`, `/api/admin/order-intent-audit/export/csv|jsonl`) must enqueue durable background jobs instead of synchronous request-path file generation, and deep audit endpoints (`/api/admin/trade-audit`, `/api/admin/order-intent-audit`, `/api/admin/audit-trail`, `/api/admin/export-manifests`) must be served from a dedicated decomposed router mounted before legacy `admin.ts`.
- Enforcement: `server/routes/adminInstitutionalAudit.ts` (decomposed endpoint implementations + async export queueing), `server/routes.ts` (mount order for `adminInstitutionalAuditRouter` before `registerAdminRoutes`), `shared/admin/dataExports.ts` (new export types/filters), and `server/services/adminDataExportBuild.ts` (trade/order audit artifact builders).
- Validation:
  - Request each institutional export path and verify `202` JSON with `jobId` and `pollUrl` is returned, then confirm readiness/download via `/api/admin/data-exports/:jobId`.
  - Verify `/api/admin/audit-trail?includeDeepTrade=1&includeLinkage=1` still returns deep event/linkage payload from decomposed router.
  - Run `npm run check`, `npm run build`, and `npm run e2e`.
- Failure Mode if Missing: large forensic exports block API workers and can trigger latency spikes/OOM under high-volume audit datasets, while monolith route bloat continues to increase regression risk.

### PRD-AUD-006
- ID: `PRD-AUD-006`
- Date (UTC): `2026-02-25`
- Scope: `Admin route decomposition safety against duplicate-path regression`
- Requirement: Once a `/api/admin/*` path is decomposed into a dedicated router, the legacy `server/routes/admin.ts` handler must not continue to register on the same public path; legacy handlers must be moved behind explicit non-canonical paths (for example `/api/admin/_legacy/*`) or removed to prevent accidental route-order regressions.
- Enforcement: `server/routes/admin.ts` (`/api/admin/_legacy/*` remap for rollup + institutional audit duplicates) and canonical mounts in `server/routes.ts` (`adminDataRollupsRouter`, `adminInstitutionalAuditRouter` before `registerAdminRoutes`).
- Validation:
  - Confirm canonical paths exist only in decomposed routers:
    - `/api/admin/kpi-summary`, `/api/admin/signup-funnel`, `/api/admin/user-analytics`, `/api/admin/analytics/compliance`, `/api/admin/deactivated-accounts/summary`
    - `/api/admin/trade-audit`, `/api/admin/order-intent-audit`, `/api/admin/audit-trail`, `/api/admin/export-manifests`, and institutional export queue routes.
  - Confirm legacy equivalents exist only under `/api/admin/_legacy/*`.
  - Run `npm run check`, `npm run build`, and route smoke/load tests to verify no behavior regressions.
- Failure Mode if Missing: future mount-order or refactor changes can silently reactivate stale synchronous handlers on public paths, reintroducing request-path heavy queries/exports and security drift.

### PRD-AUD-007
- ID: `PRD-AUD-007`
- Date (UTC): `2026-02-25`
- Scope: `User Management export scalability + parquet artifact generation`
- Requirement: User-management exports (full user list and per-user timeline) must run through durable background export jobs (`type=users`, `type=user_timeline`) with format support `csv|jsonl|parquet`; worker runtime must provide writable temp storage sized for the largest configured artifact because export files are built locally before object-storage upload.
- Enforcement: `shared/admin/dataExports.ts` (new export types/filters/formats), `server/services/adminDataExportBuild.ts` (users/timeline builders + parquet writer + temp-file creation), `server/routes/adminDataExports.ts` (`/users` and `/user-timeline` queue endpoints), and `client/src/pages/AdminDashboard.tsx` (User Management + timeline dialog now queue jobs instead of direct sync downloads).
- Validation:
  - `POST /api/admin/data-exports/users` and `POST /api/admin/data-exports/user-timeline` with `format=parquet`, poll until `READY`, then verify download content type/extension and row counts.
  - Verify Admin Dashboard User Management and timeline export buttons return queued job IDs (no synchronous file response path).
  - Run `npm run check`, `npm run build`, and `npm run loadtest:export-pipeline`.
  - In production, confirm worker node `/tmp` free space comfortably exceeds maximum export size plus retry headroom.
- Failure Mode if Missing: high-volume user exports stay request-path/synchronous and can trigger API latency or memory spikes; parquet jobs can fail with `ENOSPC` under large artifacts, causing export backlog and admin-operability degradation.

### PRD-SEC-016
- ID: `PRD-SEC-016`
- Date (UTC): `2026-02-25`
- Scope: `Metrics endpoint exposure control`
- Requirement: `/metrics` must not be anonymously readable from public internet in production; it must be restricted to private/loopback sources by default, with optional explicit token-based access (`METRICS_AUTH_TOKEN`) for controlled external scrapers.
- Enforcement: `server/routes/wsCore.ts` (`canAccessMetrics`, private-IP gate, optional bearer/header token check).
- Validation:
  - In production mode, request `/metrics` from non-private source without token and verify `403`.
  - Request `/metrics` from private cluster source (Prometheus pod/service path) and verify scrape success.
  - Request `/metrics` with valid `Authorization: Bearer <METRICS_AUTH_TOKEN>` and verify success when token is configured.
- Failure Mode if Missing: unauthenticated internet users can enumerate internal topology/queue/load telemetry and use it for attack planning or abuse timing.

### PRD-SEC-017
- ID: `PRD-SEC-017`
- Date (UTC): `2026-02-25`
- Scope: `Export queue durability posture and fallback safety`
- Requirement: In production, in-process export fallback must be an explicit opt-in (`ADMIN_DATA_EXPORT_ALLOW_PROCESS_FALLBACK=1`); otherwise queue unavailability must fail fast and mark jobs failed rather than silently switching to non-durable execution.
- Enforcement: `server/services/adminDataExportQueue.ts` (`inProcessFallbackAllowed` gate in enqueue/retry/worker startup paths, fail-fast job marking).
- Validation:
  - With queue unavailable and fallback disabled, create export and verify job transitions to `FAILED` with queue-unavailable reason.
  - With fallback explicitly enabled, verify queue-unavailable mode still executes in-process for controlled emergency operation.
  - Verify normal BullMQ path remains unchanged when queue is healthy.
- Failure Mode if Missing: production can silently degrade from durable queue semantics to in-process execution, increasing data-loss risk during restarts and complicating failure recovery.

### PRD-SEC-018
- ID: `PRD-SEC-018`
- Date (UTC): `2026-02-25`
- Scope: `Explicit insecure-transport risk acceptance for petascale dependencies`
- Requirement: Production runtime must reject insecure ClickHouse/Object Storage transport by default; insecure internal HTTP usage requires explicit opt-in (`ALLOW_INSECURE_INTERNAL_TRANSPORT=1`) as an acknowledged risk exception.
- Enforcement: `server/services/petascaleEnv.ts` (production validation for `CLICKHOUSE_URL` and `EXPORT_OBJECT_STORAGE_USE_SSL`), `k8s/01-configmap.yaml` (explicit opt-in flag when private-cluster HTTP is intentionally used).
- Validation:
  - Run with production env and insecure transport + no opt-in flag; verify startup fails with clear transport error.
  - Set `ALLOW_INSECURE_INTERNAL_TRANSPORT=1`; verify startup succeeds and services connect.
  - Set secure URLs/TLS and remove opt-in; verify startup succeeds without insecure exception.
- Failure Mode if Missing: insecure internal transport can remain unintentionally enabled in production, increasing interception and credential exposure risk.

### PRD-SEC-019
- ID: `PRD-SEC-019`
- Date (UTC): `2026-02-25`
- Scope: `Sensitive error/log output redaction`
- Requirement: External provider error payloads and runtime exception logs must be sanitized before logging to prevent accidental secret/token leakage in operational logs.
- Enforcement: `server/security/logSanitizer.ts` (redaction/sanitization primitives), `server/i18n/providers/openai.ts`, `server/i18n/worker.ts`, `server/cron/verificationReminders.ts`, and `server/index.ts` (sanitized error logging path).
- Validation:
  - Force provider failures and verify logs do not print bearer tokens/API keys/raw secret-like blobs.
  - Verify error logs remain actionable (status/type/code/message) after sanitization.
  - Run `npm run check` to confirm sanitizer integration is type-safe.
- Failure Mode if Missing: secrets and sensitive payloads can leak into central logs, expanding breach blast radius and complicating incident response.

### PRD-OBS-002
- ID: `PRD-OBS-002`
- Date (UTC): `2026-02-25`
- Scope: `Admin data freshness and backlog early-warning SLOs`
- Requirement: Production Prometheus must evaluate explicit alert rules for export backlog/failure/stall and rollup freshness/failure using app-exposed metrics (`admin_data_export_*`, `admin_data_rollup_*`, `clickhouse_sync_*`), and Prometheus config must load those rule files at startup.
- Enforcement: `server/services/adminDataRollups.ts` (rollup runtime metrics), `server/routes/wsCore.ts` (`/metrics` publication of rollup/export/clickhouse gauges/counters), `k8s/60-monitoring.yaml` (`rule_files` + `alerts-admin-data-slo.yml` rules), and `petascale/prometheus-rules/alerts.yml` (petascale rule pack parity).
- Validation:
  - `kubectl apply --dry-run=client -f k8s/60-monitoring.yaml` passes.
  - Scrape `/metrics` and verify presence of `admin_data_rollup_refresh_last_success_at`, `admin_data_rollup_refresh_failed_total`, `admin_data_export_queue_waiting`, and `clickhouse_sync_last_success_at`.
  - Trigger synthetic backlog/failure conditions and confirm corresponding alerts fire.
- Failure Mode if Missing: export queues and analytics freshness can degrade silently until admin UX breaks, causing delayed incident detection and prolonged backlog recovery.

### PRD-OPS-005
- ID: `PRD-OPS-005`
- Date (UTC): `2026-02-25`
- Scope: `Worker-canary gate before API cutover for export/analytics infrastructure changes`
- Requirement: Any production rollout that changes admin export queueing, analytics rollups, ClickHouse sync, ingress, or network policies must execute a worker-only canary first, observe queue/export/sync metrics for a full gate window (target 24h), and only then cut over API pods with ingress/network policy changes.
- Enforcement: `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md`, `scripts/ops/canary_cutover_runbook.sh`, `scripts/ops/observe_rollout_metrics.sh`, `scripts/ops/observe_api_cutover_slo.sh`, and manifests `k8s/13-worker-canary-deployment.yaml`, `k8s/10-api-deployment.yaml`, `k8s/30-ingress.yaml`, `k8s/31-network-policies.yaml`.
- Validation:
  - Run `scripts/ops/canary_cutover_runbook.sh --dry-run` to verify command plan.
  - Run worker canary phase and produce CSV evidence (`worker-canary-24h.csv`) with stable queue backlog/failure/sync metrics.
  - Execute API cutover phase and produce CSV evidence (`api-cutover-24h.csv`) with healthy probes and bounded restart/error/backlog metrics.
- Failure Mode if Missing: infrastructure or policy regressions can be introduced directly on API path without early isolation, increasing outage risk, queue backlogs, and delayed incident detection.

### PRD-PERF-012
- ID: `PRD-PERF-012`
- Date (UTC): `2026-02-25`
- Scope: `Trader-scouting export memory profile under large row counts`
- Requirement: Trader-scouting export generation must not materialize a second full normalized row array before writing artifacts; CSV/JSONL/Parquet writers must stream row-by-row from source result sets.
- Enforcement: `server/services/adminDataExportBuild.ts` (`buildTraderScoutingExport` uses `createStreamingExportWriter` and bounded row iteration without `normalizedRows = sliced.map(...)` duplication).
- Validation:
  - Run `npm run check` and `npm run build`.
  - Run authenticated export smoke (`npm run loadtest:export-pipeline` with `LOADTEST_EXPORT_JOB_COUNT>=2`) and confirm `READY` status and valid download links.
  - Review memory profile during large trader-scouting jobs; confirm no second full in-memory mapped array is created.
- Failure Mode if Missing: large trader-scouting exports can double in-memory footprint (raw rows + normalized copy), increasing OOM and latency risk under high cardinality datasets.

### PRD-SEC-020
- ID: `PRD-SEC-020`
- Date (UTC): `2026-02-26`
- Scope: `Impersonation escape control availability under compliance gate overlays`
- Requirement: While an admin is in `View As` mode, the `Exit View As` control must remain visually and interactively above mandatory legal re-acceptance overlays so admins can always terminate impersonation.
- Enforcement: `client/src/AuthenticatedShell.tsx` (`ImpersonationBanner` fixed top stacking order `z-[260]` above dialog overlays).
- Validation:
  - Start admin impersonation (`/api/admin/view-as/start`) for a trader with pending DOC1 re-acceptance.
  - Confirm legal gate dialog is open and `Exit View As` remains clickable in front.
  - Click `Exit View As` and verify session returns to admin context and `/admin` route.
- Failure Mode if Missing: admins can be trapped in impersonation sessions behind compliance modals, requiring disruptive session resets and delaying operational response.

### PRD-PERF-013
- ID: `PRD-PERF-013`
- Date (UTC): `2026-02-26`
- Scope: `Admin route snappiness with strict trader/admin bundle containment`
- Requirement: Admin route code (`AdminDashboard`) may be preloaded only behind admin-intent signals (admin header menu open/hover/focus/touch), while trader sessions must not prefetch or load admin chunks.
- Enforcement: `client/src/lib/adminRoutePrefetch.ts` (deduped admin chunk preloader), `client/src/components/Header.tsx` (admin-only intent-triggered prefetch wiring), and runbook guardrails in `e2e/runbook.spec.ts`.
- Validation:
  - Login as trader and verify admin chunk requests remain `0` before/after `/admin` navigation attempt.
  - Login as admin and navigate to `/admin`; verify admin chunk loads and dashboard renders.
  - Open admin header menu and verify prefetch path does not execute for non-admin sessions.
- Failure Mode if Missing: admin navigation remains latency-heavy and/or trader sessions can accidentally download privileged admin bundles, increasing bandwidth and containment risk.

### PRD-PETASCALE-001
- ID: `PRD-PETASCALE-001`
- Date (UTC): `2026-02-26`
- Scope: `ClickHouse OLAP analytics offload`
- Requirement: Production deployment must include a ClickHouse instance (`k8s/70-petascale-infra.yaml`) with the incremental sync worker (`server/services/clickhouseSync.ts`) running under `APP_ROLE=worker`, configured with `CLICKHOUSE_ENABLED=true`, `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USER`, and `CLICKHOUSE_PASSWORD` (and `ALLOW_INSECURE_INTERNAL_TRANSPORT=1` only when explicitly accepting plaintext internal transport).
- Enforcement: `server/services/clickhouseClient.ts` (client factory), `server/services/clickhouseSync.ts` (sync worker), `k8s/70-petascale-infra.yaml` (StatefulSet), `server/services/petascaleEnv.ts` (env validation).
- Validation:
  - `kubectl get statefulset tradehub-clickhouse -n tradehub` and verify `READY 1/1`.
  - Verify `/metrics` emits `clickhouse_sync_last_success_at` with recent timestamp.
  - Run `npm run loadtest:admin-data-tab` and verify CH-backed reads succeed when ClickHouse is enabled.
- Failure Mode if Missing: heavy aggregate/export queries fall back to Postgres request path, causing OOM and timeout at billion-row scale.

### PRD-PETASCALE-002
- ID: `PRD-PETASCALE-002`
- Date (UTC): `2026-02-26`
- Scope: `MinIO object storage for export artifacts`
- Requirement: Production deployment must include a MinIO instance (or S3-compatible object storage) with server-side encryption enabled (`X-Amz-Server-Side-Encryption: AES256`), configured with `EXPORT_OBJECT_STORAGE_ENABLED=true`, `EXPORT_OBJECT_STORAGE_ENDPOINT`, `EXPORT_OBJECT_STORAGE_PORT`, `EXPORT_OBJECT_STORAGE_USE_SSL`, `EXPORT_OBJECT_STORAGE_ACCESS_KEY`, `EXPORT_OBJECT_STORAGE_SECRET_KEY`, and `EXPORT_OBJECT_STORAGE_BUCKET`.
- Enforcement: `server/services/objectStorage.ts` (SSE header on `fPutObject`), `server/services/petascaleEnv.ts` (transport validation), `k8s/70-petascale-infra.yaml` (StatefulSet), `k8s/01-configmap.yaml` and `k8s/02-secrets.yaml` (env entries).
- Validation:
  - `kubectl get statefulset tradehub-minio -n tradehub` and verify `READY 1/1`.
  - Run an export job and verify artifact object key has prefix in MinIO bucket.
  - Verify object metadata includes `X-Amz-Server-Side-Encryption: AES256`.
- Failure Mode if Missing: export artifacts are stored unencrypted or on local disk with no redundancy, risking data loss and compliance violations.

### PRD-PETASCALE-003
- ID: `PRD-PETASCALE-003`
- Date (UTC): `2026-02-26`
- Scope: `BullMQ export queue on Valkey`
- Requirement: Production deployment must have `ADMIN_DATA_EXPORT_QUEUE_ENABLED=true` with Valkey connected (`VALKEY_URL`), and the export worker started under `APP_ROLE=worker` via `startAdminDataExportWorker()`.
- Enforcement: `server/services/adminDataExportQueue.ts` (queue/worker lifecycle), `server/index.ts` (worker startup), `server/services/petascaleEnv.ts` (env validation).
- Validation:
  - Submit `POST /api/admin/data-exports` and verify job enters `QUEUED` state.
  - Verify worker processes job to `READY` state with download link.
  - Verify `/metrics` emits `admin_data_export_jobs_succeeded_total` incrementing.
- Failure Mode if Missing: export requests block the Express event loop, causing API timeout and OOM under concurrent admin usage.

### PRD-PETASCALE-004
- ID: `PRD-PETASCALE-004`
- Date (UTC): `2026-02-26`
- Scope: `Shared DataTab Zod validation schemas`
- Requirement: All Admin DataTab endpoints must validate request parameters through shared Zod schemas in `shared/admin/dataTab.ts` with bounded pagination and range-limited filters (days/limit/offset clamped, structural invalids rejected like `minHoldSec > maxHoldSec`).
- Enforcement: `shared/admin/dataTab.ts` (Zod schemas), `server/routes/adminDataRollups.ts`, `server/routes/adminOps.ts`, `server/routes/adminTraderScouting.ts` (schema parsing + bounds).
- Validation:
  - `npm run check` passes with schema imports.
  - Submit out-of-range parameters to DataTab endpoints and verify values are bounded (clamped) instead of triggering full scans.
  - Submit invalid structural parameters (e.g., `minHoldSec > maxHoldSec`) and verify `400` rejection.
- Failure Mode if Missing: unbounded or malformed admin query parameters can trigger full-table scans, causing Postgres CPU exhaustion.

### PRD-OPS-001
- ID: `PRD-OPS-001`
- Date (UTC): `2026-02-26`
- Scope: `Ops ingress auth boundary for admin surfaces`
- Requirement: Headlamp (`/headlamp`), bull-board (`/api/admin/data-exports/queues`), and MinIO monitor (`/minio-monitor`) ingress paths must call app-session auth gate `GET /api/admin/ops/ingress-auth?resource=...` and deny non-authorized users before upstream routing.
- Enforcement: `server/routes/adminOps.ts` (`/ingress-auth` resource policy), `ops/kubernetes/headlamp-ingress.yaml`, `ops/kubernetes/bull-board-ingress.yaml`, `ops/kubernetes/minio-monitor-deployment.yaml`.
- Validation:
  - `kubectl apply --dry-run=client -k ops/kubernetes`.
  - Request each ingress path without valid admin session and verify `401/403`.
  - Request as super-admin session and verify access succeeds.
- Failure Mode if Missing: admin operations UIs can be exposed to unauthorized users at ingress layer.

### PRD-OBS-001
- ID: `PRD-OBS-001`
- Date (UTC): `2026-02-26`
- Scope: `Prometheus rule integrity and export volume anomaly alerting`
- Requirement: OPS Prometheus rule files must be parse-clean with `promtool`, and `SuspiciousExportVolume` alert inputs must be emitted as `admin_data_export_bytes_written_total`.
- Enforcement: `ops/alerts/internal-tls-alerts.yaml` (valid PromQL), `server/services/adminDataExportMetrics.ts` + `server/services/objectStorage.ts` + `server/routes/wsCore.ts` (counter emission).
- Validation:
  - `docker run --rm --entrypoint /bin/promtool -v "$PWD/ops/alerts:/alerts:ro" prom/prometheus:v2.54.1 check rules /alerts/internal-tls-alerts.yaml`.
  - Hit `/metrics` after successful export and verify `admin_data_export_bytes_written_total` exists and increments.
- Failure Mode if Missing: alert pipelines break at load time or fail to detect abnormal high-volume export behavior.

### PRD-OBS-002
- ID: `PRD-OBS-002`
- Date (UTC): `2026-02-26`
- Scope: `Grafana datasource parity for imported Pigsty dashboards`
- Requirement: All provisioned dashboards must reference existing datasource UIDs/types (`ds-prometheus`, `ds-vlogs`, `ds-static`, `ds-meta`, `grafana`) and required plugins must be installed at Grafana startup.
- Enforcement: `ops/grafana-config/provisioning/datasources/tradehub.yaml`, `ops/kubernetes/grafana-provisioning.yaml`, `ops/kubernetes/grafana-deployment.yaml`, normalized dashboard JSON under `ops/dashboards/**`.
- Validation:
  - Run dashboard datasource parity audit script (JSON scan) and verify zero unresolved UID/type references.
  - Start Grafana pod and verify plugin install logs include `victoriametrics-logs-datasource` and `marcusolsson-static-datasource`.
- Failure Mode if Missing: dashboards import but render with broken panels and missing-query errors.

### PRD-SCM-001
- ID: `PRD-SCM-001`
- Date (UTC): `2026-02-26`
- Scope: `Repository history data artifact hygiene`
- Requirement: Any accidental commit of `admin_data_exports/**` artifacts must trigger immediate history purge before release branch promotion.
- Enforcement: release process + Git history rewrite runbook (`git filter-branch ... -- admin_data_exports`) and force-push coordination.
- Validation:
  - `git log --all --name-only -- admin_data_exports` returns no tracked artifact paths after rewrite.
  - Verify downstream clones are reset/re-cloned to rewritten history.
- Failure Mode if Missing: sensitive export artifacts remain permanently accessible in Git history.

### PRD-MDATA-001
- ID: `PRD-MDATA-001`
- Date (UTC): `2026-03-09`
- Scope: `Production market-data provider selection`
- Requirement: Production runtime must select the active market-data provider from persisted provider configuration (`system_config.marketDataActiveProviderKey` and fallback keys) with `MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK=0`; implicit env-only fallback must not decide the production provider.
- Enforcement: `server/marketdata/providerManager.ts`, `k8s/01-configmap.yaml`, `k8s/base/01-configmap.yaml`, `k8s/overlays/*/patch-configmap.yaml`, and singleton config defaults in `db/seed.ts`, `server/i18n/config.ts`, `server/partner/inquiryRouting.ts`, `server/routes/admin.ts`, `server/routes/adminScout/candidates.ts`.
- Validation:
  - Start the app in production mode with `MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK=0`.
  - Confirm diagnostics route reports the configured active provider.
  - Remove `FORGE_KEY` and verify live provider selection still resolves `twelvedata` from persisted config.
- Failure Mode if Missing: production quote routing can silently drift based on env state and bypass admin/system-config provider control.

### PRD-GITOPS-001
- ID: `PRD-GITOPS-001`
- Date (UTC): `2026-03-09`
- Scope: `GitOps image promotion source of truth`
- Requirement: Production and staging image promotion must happen by updating the overlay image reference in git, not by editing live Deployment images directly.
- Enforcement: `scripts/ops/updateKustomizeImage.ts`, `.github/workflows/promote-overlay.yml`, `k8s/overlays/*/kustomization.yaml`, `gitops/argocd/*`.
- Validation:
  - Run `npx tsx scripts/ops/updateKustomizeImage.ts --overlay staging --image ghcr.io/<org>/tradequip:git-<sha>`.
  - Confirm only the overlay `newName/newTag` changes.
  - Render the overlay with `kubectl kustomize` and verify the target image matches the promoted tag.
- Failure Mode if Missing: deployed image state can diverge from git, breaking rollback and auditability.

### PRD-SECRETS-001
- ID: `PRD-SECRETS-001`
- Date (UTC): `2026-03-09`
- Scope: `GitOps secret encryption before sync`
- Requirement: Any GitOps-managed app or ops secret manifest must be encrypted with SOPS before Argo CD sync; placeholder plaintext manifests are bootstrap templates only.
- Enforcement: `.sops.template.yaml`, `scripts/ops/bootstrap_sops_age.sh`, `scripts/ops/generateProductionSecrets.ts`, app overlay secret templates in `k8s/overlays/*`, and Grafana secret templates in `gitops/kustomize/ops/*`.
- Validation:
  - Generate secrets with `npm run ops:secrets:generate`.
  - Bootstrap local SOPS config with `npm run ops:sops:bootstrap`.
  - Encrypt each `*.sops.yaml` file and confirm no `REPLACE_*` placeholders remain.
- Failure Mode if Missing: production credentials are either absent at deploy time or stored unencrypted in git/GitOps paths.
