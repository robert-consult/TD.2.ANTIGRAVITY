# Security Checklist (TradeQuip)

## Scope rule
Review only what you changed plus adjacent security boundaries (middleware, auth/session, policy checks, audit writers, schemas).

## “Financial system” invariants (cannot regress)
- Deterministic state transitions for trades/orders (no invalid transitions, no silent partial writes).
- Idempotency/duplication safety where applicable (order creation/close, background engines).
- Audit trails are append-only and attributable (who/what/when; correlation IDs preserved).
- Policy gating stays server-side and cannot be bypassed from the client.
- Jurisdiction restrictions must be enforced consistently (signup, login, active sessions).
- Legal acceptance integrity must remain tamper-evident (HMAC signing / verification).

## Code-change security review (required)
For every change, explicitly check:
1) **Authn**: session creation/invalidation; cookie flags; session fixation; “remembered” identities.
2) **Authz**: admin checks (`requireAdmin`), policy checks (`requirePolicy`), impersonation boundaries.
3) **Injection**: parameterize DB queries; validate inputs with Zod; avoid unsafe JSON parsing.
4) **Data exposure**: never log secrets; do not leak PII in responses/logs; truncate/shape logs intentionally.
5) **Crypto**: no custom crypto; use existing helpers (`server/legal/cryptoUtils.ts`, `server/services/crypto.ts`).
6) **Rate limits / abuse controls**: keep existing throttles for verification and signup flows.
7) **WS security**: authenticate subscriptions; avoid privilege bleed between clients; validate message types.
8) **Admin safety**: protect against self-lockout; preserve auditability of admin actions.

## Project-specific “where to look”
- Session + device/geo identity: `server/security/sessionTrail.ts`
- Bot defense: `server/security/botGuard.ts`, `server/security/botChallenge.ts`
- Captcha: `server/security/captcha.ts`
- Jurisdiction guard: `server/middleware/jurisdictionSessionGuard.ts`, `server/policy/jurisdictionControl.ts`
- Policy gating: `server/middleware/requirePolicy.ts`, `shared/policyDecision.ts`
- Legal terms signing: `server/legal/cryptoUtils.ts` (and required secret `LEGAL_TERMS_HMAC_SECRET`)
- Trade + identity audit: `server/lib/auditWriter.ts`, `server/services/identityAudit.ts`
- Admin security routes: `server/routes/adminSecurity.ts`

## Secrets & configuration (never weaken)
- Do not bypass startup validation in `server/index.ts` (critical secrets must fail-fast).
- Do not commit `.env`, DB dumps, logs, or keystores.
- Keep production cookie/security defaults strict; test-mode overrides must remain confined to `start:e2e`.

## When you touch these areas, read the audits first
- Trading lifecycle / policy gates / verification: `AUDIT_REPORT.md` and `REAUDIT_REPORT.md`
- Jurisdiction behavior: `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md`
- Country/timezone controls: `CODEX_COUNTRY_TIMEZONE_CONTROLS.md`

