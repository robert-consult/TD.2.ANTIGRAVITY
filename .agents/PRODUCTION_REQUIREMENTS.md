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
