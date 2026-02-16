# TradeQuip Slow-4G Performance + Security Prompt (Repo-Grounded, Not Implemented)

- Repo: `TD.2.ANTIGRAVITY`
- Scope: `REPORTS AND REVIEWS/PREFETCH & CACHING REFACTOR`
- Date grounded: `2026-02-15`
- Status: `Design/audit only. Nothing in this document is implemented yet.`

## Role
Act as a senior full-stack architect for TradeQuip. Produce an implementation plan and code changes for slow-network performance without regressing security, compliance, WebSocket behavior, or auditability.

## Mandatory grounding rules
1. Use only real modules and real file paths from this repo.
2. Do not assume Service Worker, IndexedDB persistence, route prefetch, or encrypted app cache already exists.
3. Preserve existing institutional controls (policy gates, jurisdiction checks, legal acceptance integrity, CSRF, WS abuse controls, audit trails).
4. Treat security vectors as first-class requirements: storage, transport, browser runtime, on-device mobile, and end-to-end encryption.
5. Explicitly separate current state vs planned state.

## Verified current stack and architecture

### Runtime and platform
- Node + TypeScript monolith: `server/index.ts`, `package.json`, `tsconfig.json`
- Web frontend: React 19 + Vite 7 + Wouter: `client/src/App.tsx`, `vite.config.ts`
- Backend API + WS: Express 5 + `ws`: `server/routes.ts`, `shared/ws/protocol.ts`
- Database: PostgreSQL via Drizzle schema in `shared/schema.pg.ts`
- Cache/pubsub: Valkey integration in `server/services/valkey.ts`
- Mobile wrapper: Capacitor remote URL mode in `MOBILE/capacitor.config.ts`
- Native app: React Native client in `NATIVE/src`

### Verified web routing and lazy-load boundaries
- Top-level lazy routes in `client/src/App.tsx`:
  - `Dashboard`, `LoginPage`, `AdminDashboard`, `JournalPage`, `ProfileSettings`, `PartnerPortal`, `VerifyEmail`, `NotFound`
- Dashboard tab panels lazy-loaded in `client/src/pages/Dashboard.tsx`:
  - `QuotesScreen`, `ChartScreen`, `TradeScreen`, `HistoryScreen`, `LeaderboardScreen`, `AccountScreen`
- `lazyWithPing` workaround for Suspense edge cases: `client/src/lib/lazyWithPing.ts`

### Verified data and live update flow
- Query defaults: `staleTime: Infinity`, no persistence layer: `client/src/lib/queryClient.ts`
- Auth bootstrap: `client/src/hooks/use-auth.tsx` (calls `/api/auth/current-user`)
- Live WS provider: `client/src/live/LiveUpdatesProvider.tsx`
- Quotes streaming + REST fallback: `client/src/live/QuotesProvider.tsx`
- Query invalidation on live config events: `client/src/live/ConfigSync.tsx`
- Account context refresh from `/api/account/summary`: `client/src/live/AccountSummarySync.tsx`

### Verified transport and security controls already in repo
- API transport TLS guard (`426` when required): `server/index.ts`
- WS transport TLS/origin/rate/connection controls: `server/routes.ts`
- CSRF issuance + enforcement for session mutation routes: `server/security/csrf.ts`, wiring in `server/routes.ts`
- Security response headers currently set:
  - `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, conditional HSTS in `server/index.ts`
- Existing E2EE path (mailbox/partner inquiry envelopes):
  - client crypto/envelope handling: `client/src/lib/e2ee.ts`
  - shared envelope validation: `shared/e2ee/envelope.ts`
  - server validation/use: `server/routes/mailbox.ts`, `server/routes/partnerPortal.ts`, `server/services/messaging.ts`

## Verified missing pieces (must be treated as not implemented)
- No Service Worker registration or SW module exists in `client/src`
- No IndexedDB cache/persistence module exists in `client/src`
- No encrypted offline app-state cache exists for query/auth/account snapshots
- E2EE private key material is still persisted in `localStorage` in `client/src/lib/e2ee.ts`
- No CSP header is currently emitted by server middleware in `server/index.ts`
- Native app does not currently implement mailbox E2EE flow (`NATIVE/src` has no E2EE modules)

## Primary objective
Deliver an implementation design that creates an "instant-load feel" on slow networks while maintaining security controls expected for a trading system.

## Performance objectives (target state)
- Faster cold-start UX on Slow-4G via app-shell + hydrated cached state
- Near-instant tab transitions after authenticated prefetch
- Preserve low-overhead WS fanout characteristics and avoid hot-path regressions
- Keep API/WS payload discipline and avoid accidental bandwidth inflation

## Security vector requirements (must all be addressed)

### 1) Storage at rest
- Browser:
  - Any persisted user financial/cache state must be encrypted before storage.
  - Cache keys/data must be namespaced by `userId` and tenant/session context.
  - Logout must purge user-scoped cache material.
  - E2EE local key migration from `localStorage` to safer persistence must be explicit and auditable.
- Server:
  - Do not weaken existing encrypted-at-rest fields (for example, encrypted mailbox/notification and MFA secrets).
  - Do not bypass `ENCRYPTION_KEY` startup validation in production.
- Native/mobile:
  - Document storage class explicitly (what is plain vs encrypted) and close known gaps before rollout.

### 2) Secure transport
- Preserve and test existing `/api` TLS guard and `/ws` TLS/origin/rate controls.
- Service Worker must never cache or proxy `/api/*` or `/ws`.
- Capacitor and native release profiles must not allow accidental cleartext production endpoints.
- Keep partner/API key pathways HTTPS-enforced in production.

### 3) Browser runtime hardening
- Add CSP design requirements before introducing persistent encrypted cache (XSS + persistent cache is high-impact).
- Service Worker strategy must prevent cache poisoning and stale-worker lock-in.
- Avoid storing sensitive key material in readable runtime globals.

### 4) On-device controls (Capacitor + React Native)
- Capacitor remote URL mode must document strict production URL and cleartext prohibitions.
- Native storage and session handling must document whether values are encrypted at rest.
- Explicitly state certificate pinning status (implemented vs placeholder) with no ambiguous wording.

### 5) End-to-end encryption boundary
- Distinguish clearly between:
  - E2EE message payload security (mailbox/inquiries), and
  - local-at-rest encrypted cache for performance.
- Do not claim full-platform E2EE where not implemented.
- Preserve envelope validation constraints in `shared/e2ee/envelope.ts` and server routes.

## Known architecture vulnerabilities and bug risks to address in plan

1. `client/src/lib/e2ee.ts`: mailbox private key JWK is in `localStorage` (XSS-readable).
2. `server/index.ts`: CSP is not currently emitted; adding persistent cache without CSP increases exposure.
3. No user-scoped encrypted offline cache exists yet; logout/cache-clear semantics are undefined.
4. `MOBILE/README.md` claims SSL pinning as configured, but Android network pin block is placeholder in `MOBILE/android/app/src/main/res/xml/network_security_config.xml`.
5. `NATIVE/src/services/api.ts` creates `MMKV()` without an encryption key; at-rest confidentiality is not guaranteed by default config.
6. `NATIVE/src/services/websocket.ts` and `NATIVE/README.md` transport/auth narrative is not aligned with current web session-bound WS model and needs explicit verification.
7. Service Worker is absent; once added, SW cache scope and update lifecycle can become a persistence vector if not tightly constrained.

## Non-negotiable constraints
- Do not weaken policy gates, jurisdiction controls, legal acceptance flow, CSRF, or auditability.
- Do not expand WS payload shape/volume without quantified bandwidth mitigation.
- Do not cache live quote ticks as authoritative offline truth.
- Do not claim completed implementation steps in docs before code exists.

## Required deliverables

### Deliverable A: Implementation plan (phased)
- Phase 0: baseline instrumentation and threat model
- Phase 1: route prefetch + app-shell performance foundation
- Phase 2: encrypted cache + query persistence + hydration
- Phase 3: hardening (CSP, SW cache rules, logout purge, key migration)
- Phase 4: mobile/native parity and release controls

### Deliverable B: Security control matrix
Map each vector to:
- threat,
- control,
- enforcement location,
- validation test,
- failure mode.

### Deliverable C: Test and rollback plan
Include:
- Slow-4G profiling checks,
- WS and API regression checks,
- security regression checks,
- feature flags and rollback triggers.

## File-level implementation targets (planned)
- `client/src/lib/routePrefetch.ts` (new)
- `client/src/lib/secureCache.ts` (new)
- `client/src/lib/queryPersistence.ts` (new)
- `client/src/sw.ts` or `client/public/sw.js` (new)
- `client/src/main.tsx` (SW registration + bootstrap sequence)
- `client/src/App.tsx` (authenticated prefetch trigger)
- `client/src/lib/e2ee.ts` (key storage migration path)
- `server/vite.ts` (SW serving + no-cache behavior)
- `server/index.ts` (runtime security header evolution, if approved)
- Mobile/native docs and configs where production transport/storage controls are specified

## Acceptance gates
- Performance gains demonstrated on Slow-4G profile (before/after evidence).
- No regressions to existing compliance/security controls.
- Security-vector checklist complete for storage, transport, browser runtime, device runtime, and E2EE boundary.
- Documentation says exactly what is implemented vs pending.

## Output style required from implementation assistant
- Start with current-state facts from this repo.
- Then show target architecture and migration sequence.
- Then show risk register and mitigations.
- Then show exact file deltas and validation commands.
- Clearly label any assumptions or unknowns.
