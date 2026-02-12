# Shared Services Audit Report

Date: February 12, 2026
Scope: `client/`, `server/`, `NATIVE/`, `shared/`, `e2e/` (read-only investigation)
Status: Audit only. No runtime code changed.

## Executive Summary

The repository has strong domain capability, but critical cross-platform concerns are implemented in parallel stacks (web, native, server) with partial overlap and drift risk. The highest-value centralization target is a shared contract layer for:

1. Time/date semantics and formatting (including conversion from unix to real date/time presentation).
2. Identity/fingerprint header semantics.
3. REST/WS security transport contracts.
4. Bot challenge and E2EE envelope schemas.

## Priority Centralization Matrix

| Priority | Area | Current Duplication Evidence | Proposed Shared Module | Primary Benefit |
|---|---|---|---|---|
| P0 | Time/date parsing + display | `client/src/utils/parseDate.ts`, `client/src/pages/PartnerPortal.tsx`, `NATIVE/src/screens/main/HistoryScreen.tsx`, `NATIVE/src/screens/main/JournalScreen.tsx` | `shared/time/instant.ts`, `shared/time/format.ts`, `shared/time/range.ts` | Consistent real date/time UX and deterministic sec/ms/ISO handling. |
| P0 | Device identity + fingerprint | `client/src/lib/identity.ts`, `client/src/lib/deviceId.ts`, `NATIVE/src/services/api.ts`, `server/security/sessionTrail.ts`, `server/grift/griftGeo.ts` | `shared/identity/device.ts`, `shared/identity/headers.ts` | Consistent cross-surface identity and stronger audit continuity. |
| P0 | REST security protocol | `client/src/lib/fetchWithIdentity.ts`, `client/src/lib/axiosIdentity.ts`, `client/src/lib/queryClient.ts`, `NATIVE/src/services/api.ts`, `server/security/csrf.ts` | `shared/transport/httpProtocol.ts`, `shared/security/csrfContract.ts` | Prevents transport drift across fetch/axios/native stacks. |
| P0 | WS protocol + security contract | `server/routes.ts` WS handlers, `client/src/hooks/use-websocket.tsx`, `NATIVE/src/services/websocket.ts` | `shared/ws/protocol.ts`, `shared/ws/securityContract.ts` | Typed message parity and consistent auth/origin/session expectations. |
| P0 | Bot challenge protocol | `client/src/lib/botProof.ts`, `NATIVE/src/services/api.ts`, `server/security/botChallenge.ts`, `server/security/botGuard.ts` | `shared/security/botChallenge.ts` | One challenge/response schema across web/native/server. |
| P1 | E2EE envelope schema | `client/src/lib/e2ee.ts`, `server/services/messaging.ts`, `server/routes/mailbox.ts`, `server/routes/partnerPortal.ts` | `shared/e2ee/envelope.ts` | Reduced crypto envelope drift and better validation consistency. |
| P1 | IP/header extraction primitives | `server/security/proxyHeaders.ts`, `server/security/sessionTrail.ts`, `server/lib/auditContext.ts`, `server/grift/griftIpAsn.ts` | `shared/security/requestIdentity.ts` or single `server/security/requestIdentity.ts` | Unified trusted header parsing and audit provenance rules. |
| P1 | Locale/country/timezone metadata contract | `server/routes/meta.ts`, `client/src/i18n/store.ts`, `NATIVE/src/i18n/store.ts` | `shared/locale/metadata.ts`, `shared/locale/preferences.ts` | Cross-client locale and timezone consistency. |
| P2 | Auth/admin policy primitives | `server/middleware/auth.ts`, `server/middleware/requireAdmin.ts`, `server/routes/adminSecurity.ts`, inline auth in `server/routes.ts` | `shared/auth/policy.ts` + one middleware implementation | Reduced role-check drift and simpler enforcement review. |

## Detailed Findings

### 1) Time/Date Is Fragmented Across Surfaces

- Multiple ad-hoc formatters and sec/ms conversions exist in web and native views.
- There is no single shared instant normalization contract for `unix sec`, `unix ms`, and `ISO`.
- This directly drives inconsistent display behavior and increases risk of unix-only UX in admin/partner flows.

Recommendation:
- Define one shared parse/normalize API that outputs canonical UTC instant objects.
- Keep user-facing formatting at UI boundary with explicit locale/timezone input.

### 2) Identity/Fingerprint Behavior Is Duplicated

- Web and native each generate identifiers/fingerprints independently with overlapping but not identical logic.
- Server re-implements header extraction and parsing in multiple modules.

Recommendation:
- Move identity header keys, required/optional fields, and normalization into shared contracts.
- Keep platform-specific entropy sources local, but enforce the same output contract.

### 3) REST Transport Security Is Split Across Stacks

- Web uses several request layers with repeated identity + CSRF retry logic.
- Native has its own parallel logic including challenge handling.
- Shared CSRF constants exist, but end-to-end protocol semantics are not centralized.

Recommendation:
- Centralize transport contract types and request metadata requirements.
- Implement one adapter per client stack (fetch, axios, native axios) against the same contract.

### 4) WS Protocol Has No Single Shared Contract

- WS handshake, auth, origin checks, and event routing are mostly server-defined.
- Web and native clients implement event payload assumptions separately.

Recommendation:
- Define shared WS event names, payload schemas, and handshake contract in `shared/ws/*`.
- Treat server runtime checks as enforcement of the same shared schema.

### 5) E2EE Envelope Contract Is Partially Repeated

- Envelope field validation appears in several server routes and client code.
- There is no one shared validator/schema package for envelope transport.

Recommendation:
- Add shared envelope schemas and reusable validators for request/response boundaries.

## Proposed Shared Module Map

```text
shared/
  time/
    instant.ts
    format.ts
    range.ts
  identity/
    device.ts
    headers.ts
  transport/
    httpProtocol.ts
  ws/
    protocol.ts
    securityContract.ts
  security/
    csrfContract.ts
    botChallenge.ts
    requestIdentity.ts
  e2ee/
    envelope.ts
  locale/
    metadata.ts
    preferences.ts
  auth/
    policy.ts
```

## Migration Plan (Low-Risk Sequence)

1. Add shared contracts only (types/constants/validators), no behavior changes.
2. Migrate web usage to shared contracts behind existing adapters.
3. Migrate native usage to the same contracts.
4. Enforce server ingestion/validation against shared schemas.
5. Remove duplicate helpers after parity tests pass.

## Validation Strategy

- Contract tests: sec/ms/ISO parsing parity and timezone determinism.
- REST tests: CSRF/identity/challenge behavior parity across web/native.
- WS tests: handshake and event schema conformance.
- Security tests: negative cases for forged headers, malformed envelope payloads, and replayed challenges.

## Risks To Track During Centralization

- Breaking backward compatibility for existing clients if header/event names change.
- Timezone rendering regressions if formatter defaults are not explicit.
- WS message size growth if schemas are expanded without payload discipline.

## Non-Goals For First Pass

- No UI redesign.
- No transport feature expansion.
- No cryptographic algorithm changes.

## Audit Notes

- Existing shared strengths observed: `shared/policyDecision.ts`, `shared/security/csrf.ts`, `shared/partnerProfile.ts`, `shared/quoteSubscriptions.ts`.
- Potential placeholders observed in native endpoints that should be validated before release:
  - `NATIVE/src/services/api.ts`
  - `NATIVE/src/services/websocket.ts`

## Production Requirements Ledger Note

This task was read-only audit documentation and did not introduce a new runtime or deployment requirement. No update to `.agents/PRODUCTION_REQUIREMENTS.md` is required for this change.
