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
