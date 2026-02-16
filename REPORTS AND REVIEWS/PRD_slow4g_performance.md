# PRD: TradeQuip Slow-4G Prefetch + Secure Caching Program (Grounded, Design-Only)

- Product: `TradeQuip` (`TD.2.ANTIGRAVITY`)
- Document version: `2.0` (grounded rewrite)
- Date: `2026-02-15`
- Status: `Draft for implementation planning only`
- Implementation status: `No items in this PRD are implemented yet.`

## 1. Executive Summary
TradeQuip currently uses route-level lazy loading and memory-only query state on web. On slow/high-latency networks this causes delayed first interactive experience and delayed first navigation into lazy tab modules. This PRD defines a secure performance program across web, Capacitor, and native surfaces to deliver fast perceived load while preserving institutional controls (policy gates, jurisdiction restrictions, legal acceptance integrity, CSRF, WS abuse controls, and auditability).

This PRD is grounded in real repo files and current behavior. It also includes explicit security requirements for:
- storage at rest,
- secure transport,
- browser runtime hardening,
- on-device protections,
- end-to-end encryption boundaries.

## 2. Current-State Baseline (Verified)

### 2.1 Web app architecture (today)
- App entry: `client/src/main.tsx` (no Service Worker registration)
- Route shell: `client/src/App.tsx`
- Dashboard tabs lazy loaded via `lazyWithPing`: `client/src/pages/Dashboard.tsx`
- Query client uses `staleTime: Infinity` with no persistence: `client/src/lib/queryClient.ts`
- Live updates via singleton WS provider: `client/src/live/LiveUpdatesProvider.tsx`
- Quotes provider with WS + REST fallback: `client/src/live/QuotesProvider.tsx`
- Auth bootstrap via `/api/auth/current-user`: `client/src/hooks/use-auth.tsx`

### 2.2 Backend architecture (today)
- API + WS in one process: `server/index.ts`, `server/routes.ts`
- WS endpoint: `/ws` with protocol in `shared/ws/protocol.ts`
- Static asset serving and compression: `server/vite.ts`
- `/assets/*` immutable cache headers are already set in production static serving

### 2.3 Existing security controls (today)
- API TLS requirement (config-driven): `server/index.ts`
- WS TLS/origin/connection/message-rate controls: `server/routes.ts`
- CSRF middleware for session mutation routes: `server/security/csrf.ts` + `server/routes.ts`
- Existing response headers include:
  - `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
  - conditional HSTS on secure requests
- Mailbox/partner inquiry E2EE envelope flow exists:
  - client crypto: `client/src/lib/e2ee.ts`
  - shared envelope constraints: `shared/e2ee/envelope.ts`
  - server routes/services: `server/routes/mailbox.ts`, `server/routes/partnerPortal.ts`, `server/services/messaging.ts`

### 2.4 Mobile/native baseline (today)
- Capacitor wrapper in remote URL mode: `MOBILE/capacitor.config.ts`
- Native RN app service layer: `NATIVE/src/services/api.ts`, `NATIVE/src/services/websocket.ts`
- Native Android network security config exists; pinning block is placeholder comments: `NATIVE/android/app/src/main/res/xml/network_security_config.xml`
- Mobile Android config also has pinning placeholder comments: `MOBILE/android/app/src/main/res/xml/network_security_config.xml`

### 2.5 Verified missing capabilities
- No Service Worker implementation in `client/src`
- No IndexedDB persistence layer for app/query/auth cache
- No encrypted local cache module for UI state
- E2EE private key material currently persisted in `localStorage` on web (`client/src/lib/e2ee.ts`)
- No CSP header currently emitted by server middleware

## 3. Problem Statement
### 3.1 User experience problem
Traders on slow 4G/high-latency links face delayed first useful render and delayed first navigation to lazy-loaded panels.

### 3.2 Security and architecture problem
Planned local caching/prefetch can increase attack surface if implemented without strict controls for storage encryption, key management, Service Worker boundaries, logout purge, transport enforcement, and runtime hardening.

### 3.3 Product integrity problem
Performance work must not regress financial/compliance invariants or WS hot-path efficiency.

## 4. Goals and Success Criteria

### 4.1 Performance goals
- G1: Render shell-level UI quickly on constrained links using app-shell strategy.
- G2: Reduce first-tab navigation latency after login via controlled prefetch.
- G3: Hydrate non-live state from encrypted cache when safe and available.
- G4: Maintain WS and API efficiency under load (no payload blow-up/regression).

### 4.2 Security goals
- G5: Protect cached financial/user state at rest in browser/device storage.
- G6: Preserve secure transport guarantees for API and WS.
- G7: Keep E2EE boundaries explicit; do not conflate offline cache encryption with end-to-end encryption.
- G8: Ensure logout/account-switch guarantees remove user-scoped cache material.

### 4.3 Compliance and reliability goals
- G9: No regressions to policy/jurisdiction/legal/CSRF/audit controls.
- G10: Rollout must be reversible through flags without downtime.

## 5. Scope and Non-Scope

### 5.1 In scope
- Authenticated route prefetch strategy for trader-facing lazy routes
- Service Worker app-shell caching strategy (static assets/navigation shell only)
- Encrypted local persistence for selected non-live state
- Query persistence/hydration strategy with invalidation and TTL
- Security-vector controls and test plan across web/mobile/native

### 5.2 Out of scope
- SSR/SSG conversion
- Protocol redesign of existing WS message model
- Trading engine or risk model refactor
- Database schema redesign for trading core
- Any claim of "global E2EE" beyond current mailbox/inquiry envelope scope

## 6. Security Vector Model (Mandatory)

## 6.1 Storage at rest

### Current state
- Web:
  - `localStorage` used for multiple preferences/identity values.
  - `client/src/lib/e2ee.ts` stores private key JWK material in `localStorage`.
- Server:
  - selected sensitive fields encrypted at rest using `server/services/crypto.ts`.
- Native:
  - `NATIVE/src/services/api.ts` instantiates `MMKV()` with no explicit encryption key.

### Requirements
- SR-STORE-1: Any new persisted financial/user cache must be encrypted before write.
- SR-STORE-2: Encryption keys used for local cache must be non-extractable where platform allows.
- SR-STORE-3: Cache namespaces must be scoped per authenticated user and environment.
- SR-STORE-4: Logout must purge user cache and key handles.
- SR-STORE-5: Migration from `localStorage` E2EE key storage must be explicit and idempotent.
- SR-STORE-6: Corrupt/undecryptable cache values must fail safely and trigger revalidation.

## 6.2 Secure transport

### Current state
- API transport enforcement exists (`server/index.ts`) with configurable TLS requirement.
- WS transport and origin checks exist (`server/routes.ts`) with rate/concurrency controls.
- Capacitor can be configured with cleartext when URL starts with `http://`.

### Requirements
- SR-TRANS-1: Service Worker must bypass `/api/*` and `/ws` entirely.
- SR-TRANS-2: Production profiles must reject cleartext backend endpoints.
- SR-TRANS-3: Existing API/WS transport gates must remain enabled in production.
- SR-TRANS-4: Partner and admin sensitive paths stay HTTPS enforced.

## 6.3 Browser runtime hardening

### Current state
- CSP not currently set in response headers.
- Once SW + persistent cache are added, XSS impact increases (persistent data + key access risk).

### Requirements
- SR-BROWSER-1: Define and stage CSP policy before enabling sensitive offline cache in production.
- SR-BROWSER-2: Service Worker cache scope must exclude authenticated API responses.
- SR-BROWSER-3: SW update policy must avoid long-lived stale worker lock-in.
- SR-BROWSER-4: Avoid introducing readable global key material for encrypted cache logic.

## 6.4 On-device controls (Capacitor + Native)

### Current state
- Capacitor uses remote URL mode and can permit cleartext based on env URL.
- Mobile/native docs contain security claims that are partially placeholder-based.
- Native persistent storage encryption at rest is not explicitly configured in service layer.

### Requirements
- SR-DEVICE-1: Release channel config must enforce HTTPS/WSS endpoints only.
- SR-DEVICE-2: Storage classes must be documented as encrypted vs plaintext and remediated where needed.
- SR-DEVICE-3: Pinning status must be represented accurately (placeholder != implemented).
- SR-DEVICE-4: No sensitive payloads in device logs for release builds.

## 6.5 End-to-end encryption boundary

### Current state
- E2EE envelope semantics exist for mailbox and partner inquiry flows only.

### Requirements
- SR-E2EE-1: PRD/docs must distinguish E2EE (message confidentiality end-to-end) from local cache at-rest encryption.
- SR-E2EE-2: Any cache change must not weaken envelope validation constraints in `shared/e2ee/envelope.ts`.
- SR-E2EE-3: Do not claim E2EE coverage for data paths that are only transport-encrypted or at-rest encrypted.

## 7. Feature Requirements (Planned Architecture)

## 7.1 Feature A: Authenticated route prefetch
- Trigger after confirmed authenticated state in `client/src/App.tsx`.
- Priority order should favor trader workflow routes first.
- Respect constrained-network hints from `client/src/lib/perfHints.ts`.
- Must be cancelable on logout/session loss.
- Must not prefetch admin-only routes for non-admin users.

### Acceptance
- First navigation to prefetched tabs avoids network wait in normal case.
- Prefetch load is throttled/deferred on constrained devices.

## 7.2 Feature B: Service Worker app-shell strategy
- Add SW implementation and registration path.
- Cache static shell assets and navigation shell only.
- Explicitly bypass `/api/*`, `/ws`, and dev/HMR paths.
- Ensure SW script delivery/update semantics avoid stale lock-in.

### Acceptance
- Offline/poor-network shell render works without caching API responses.
- SW updates are detected and applied predictably.

## 7.3 Feature C: Encrypted cache layer
- Create encrypted local persistence wrapper for browser web runtime.
- Store selected non-live state only (config/account snapshots/preferences), never authoritative live quote stream.
- User-scoped keys and purge policies are mandatory.

### Acceptance
- Stored blobs are unreadable plaintext in browser devtools.
- Decryption failure falls back to network revalidation.

## 7.4 Feature D: Query persistence/hydration
- Persist allowlisted query keys only.
- Hydrate during startup sequence before network refresh when feasible.
- Use TTL/versioning and live invalidation hooks (`ConfigSync` etc).

### Acceptance
- Cached data appears quickly and is replaced by fresh data without stale confusion.

## 7.5 Feature E: Hybrid state merge
- Render with last-known safe state, then merge live WS/API data.
- Visual stale-state indicator until fresh data confirmed.
- Never present stale quote cache as current market truth.

### Acceptance
- UX indicates "updating" when data is cached and not yet confirmed live.

## 8. Non-Functional Requirements

## 8.1 Performance and compute
- Avoid new hot-path CPU spikes in WS/message fanout.
- Avoid large allocations and repeated serialization in realtime paths.
- Keep prefetch concurrency bounded.

## 8.2 Bandwidth
- Avoid broad over-prefetch in constrained mode.
- Keep WS payload model unchanged unless justified.
- Do not increase API chatter due to persistence loop bugs.

## 8.3 Reliability
- Feature-flagged rollout with immediate kill switch.
- Graceful degradation if SW/IndexedDB unavailable.

## 9. Known Architecture Vulnerabilities and Bug Register

| ID | Severity | Current State | Evidence | Required Mitigation |
|---|---|---|---|---|
| KAV-001 | High | Mailbox private key JWK in localStorage | `client/src/lib/e2ee.ts` | Migrate key material out of localStorage with secure lifecycle and purge semantics |
| KAV-002 | High | No CSP in server headers | `server/index.ts` | Define and stage CSP before enabling sensitive persistent client cache |
| KAV-003 | High | User-scoped encrypted cache lifecycle not yet defined | no `secureCache` module exists | Define key scope, TTL, logout purge, and account-switch isolation |
| KAV-004 | Medium | Mobile docs overstate SSL pinning readiness | `MOBILE/README.md`, `MOBILE/android/.../network_security_config.xml` | Correct docs and gate production release on real pin configuration |
| KAV-005 | Medium | Native storage encryption at rest not explicit in service layer | `NATIVE/src/services/api.ts` (`MMKV()`) | Document/enforce encrypted storage policy for sensitive local data |
| KAV-006 | Medium | Native WS auth/transport documentation mismatch risk | `NATIVE/README.md`, `NATIVE/src/services/websocket.ts` | Validate and align native WS auth model with server session controls |
| KAV-007 | Medium | SW not present now; future SW could become persistence vector | no SW files in `client/src` | Restrict scope/cache rules and enforce update strategy |
| KAV-008 | Medium | Cleartext endpoint risk if production URL/config mis-set in mobile wrappers | `MOBILE/capacitor.config.ts`, native dev URLs | Add release-time config guardrails for HTTPS/WSS only |

## 10. Implementation Plan (Phased)

## Phase 0: Baseline and threat model
- Capture current performance baseline (slow-4G profile).
- Capture current security baseline and header posture.
- Produce explicit threat model for SW + encrypted cache.

## Phase 1: Route prefetch foundation
- Implement bounded authenticated prefetch strategy.
- Add constrained-network policy integration.
- Measure navigation latency improvement.

## Phase 2: SW shell caching
- Introduce SW with strict route exclusions.
- Integrate version/update semantics and cache cleanup.
- Validate offline shell and no API caching.

## Phase 3: Encrypted cache + query persistence
- Implement encrypted cache wrapper.
- Add query allowlist persistence and hydration.
- Add user-scope and logout purge.

## Phase 4: Security hardening completion
- Migrate E2EE key local storage path.
- Add CSP rollout plan and policy testing.
- Close mobile/native transport/storage documentation gaps.

## Phase 5: Rollout and monitoring
- Feature flags on each major capability.
- Canary rollout with kill-switch.
- Monitor regressions and security signals.

## 11. Validation and Acceptance Plan

## 11.1 Performance validation
- Baseline and compare:
  - initial shell paint,
  - time to usable route,
  - first-switch tab latency,
  - constrained-network behavior.
- Validate no adverse WS fanout impact under load.

## 11.2 Security validation
- Verify API/WS transport gates still active.
- Verify CSRF mutation protections unchanged.
- Verify cache content confidentiality at rest.
- Verify logout/account switch cache purge behavior.
- Verify SW cannot serve or cache `/api/*` and `/ws`.
- Verify E2EE mailbox/inquiry flows remain valid.

## 11.3 Compliance/regression validation
- Verify no regressions to:
  - jurisdiction session guard,
  - legal re-accept gating,
  - policy middleware,
  - audit trail behavior.

## 11.4 Mobile/native validation
- Validate production profile uses HTTPS/WSS only.
- Validate documentation claims match real configs.
- Validate storage classification and risk posture.

## 12. Rollout, Feature Flags, and Rollback
- Feature flags required per phase (`prefetch`, `sw_shell`, `secure_cache`, `query_persist`).
- Rollback path must disable each flag independently.
- If security control validation fails, feature remains disabled.

## 13. Dependencies and Constraints
- Must preserve existing protocol constants in `shared/ws/protocol.ts`.
- Must preserve current compliance/security requirements and startup guards.
- Must avoid hot-path regressions in WS and quote processing.

## 14. Open Decisions (Need explicit closure before build)
1. Cache-key derivation model for browser encrypted cache (entropy source and rotation policy).
2. CSP rollout strategy compatible with current frontend bundle/runtime behavior.
3. Exact production enforcement for mobile/native endpoint scheme validation.
4. Native storage encryption policy scope (what is sensitive and must be encrypted at rest).

## 15. Traceability to Real Repo Files
- Router/lazy boundaries: `client/src/App.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/lib/lazyWithPing.ts`
- Query behavior: `client/src/lib/queryClient.ts`
- Auth bootstrap: `client/src/hooks/use-auth.tsx`
- Live updates: `client/src/live/LiveUpdatesProvider.tsx`, `client/src/live/QuotesProvider.tsx`, `client/src/live/ConfigSync.tsx`, `client/src/live/AccountSummarySync.tsx`
- Static serving and cache headers: `server/vite.ts`
- Transport/security headers: `server/index.ts`
- WS controls: `server/routes.ts`
- CSRF: `server/security/csrf.ts`
- E2EE envelope and route usage: `client/src/lib/e2ee.ts`, `shared/e2ee/envelope.ts`, `server/routes/mailbox.ts`, `server/routes/partnerPortal.ts`, `server/services/messaging.ts`
- Mobile wrapper configs: `MOBILE/capacitor.config.ts`, `MOBILE/android/app/src/main/res/xml/network_security_config.xml`
- Native transport/storage services: `NATIVE/src/services/api.ts`, `NATIVE/src/services/websocket.ts`

---

### Implementation Status Declaration
As of `2026-02-15`, this PRD describes planned architecture and controls only. No performance/caching/security changes from this PRD have been implemented in the application codebase yet.
