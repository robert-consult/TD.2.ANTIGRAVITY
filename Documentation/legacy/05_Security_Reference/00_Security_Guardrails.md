# Security Guardrails

> **Diátaxis quadrant:** Reference
> **Sources:** `.agents/security.md`, `server/AGENTS.md`, `.agents/PRODUCTION_REQUIREMENTS.md`

> [!IMPORTANT]
> For every code change, review the full security checklist in `.agents/security.md`.

---

## Financial System Invariants (Cannot Regress)

1. **Deterministic state transitions** for trades/orders — no invalid transitions, no silent partial writes
2. **Idempotency/duplication safety** where applicable (order creation/close, background engines)
3. **Audit trails are append-only** and attributable (who/what/when; correlation IDs preserved)
4. **Policy gating stays server-side** and cannot be bypassed from the client
5. **Jurisdiction restrictions** enforced consistently (signup, login, active sessions)
6. **Legal acceptance integrity** remains tamper-evident (HMAC signing/verification)

---

## Code-Change Security Review

| Area | What to Check |
|---|---|
| **Authn** | Session creation/invalidation, cookie flags, session fixation, remembered identities |
| **Authz** | Admin checks (`requireAdmin`), policy checks (`requirePolicy`), impersonation boundaries |
| **KYC/AML** | KYC lifecycle integrity (INVITED→SUBMITTED→APPROVED/REJECTED), policy gates (`KYC_VIEW`, `KYC_SUBMIT`), identity verification audit trail |
| **Verification** | Email verification HMAC tokens (`EMAIL_VERIFY_TOKEN_SECRET`), SMS OTP keyed hashing, CAPTCHA single-use with distributed lock |
| **Legal** | HMAC-signed legal acceptance, coverage gate fail-closed semantics, region rules, atomic signup+acceptance |
| **Jurisdiction** | Country/timezone access controls, consistent enforcement across signup/login/active sessions |
| **Injection** | Parameterized DB queries, Zod input validation, no unsafe JSON parsing |
| **Data exposure** | No logging secrets, no PII leakage in responses/logs, truncated/shaped logs |
| **Crypto** | No custom crypto — use `server/legal/cryptoUtils.ts`, `server/services/crypto.ts` |
| **Rate limits** | Keep existing throttles for verification and signup flows |
| **WS security** | Authenticated subscriptions, no privilege bleed, validated message types |
| **Admin safety** | Protect against self-lockout, preserve auditability |

---

## CSRF Enforcement

- All session-scoped non-safe requests must include `x-csrf-token`
- `COOKIE_SAMESITE=none` is **forbidden** (startup aborts)
- Session cookies default to `SameSite=Strict`

---

## Key Security Files

| File | Purpose |
|---|---|
| `server/security/sessionTrail.ts` | Session + device/geo identity |
| `server/security/botGuard.ts` | Bot defense scoring |
| `server/security/botChallenge.ts` | Bot challenge |
| `server/security/captcha.ts` | Captcha verification |
| `server/security/loginRateLimit.ts` | Login brute-force throttling |
| `server/middleware/jurisdictionSessionGuard.ts` | Jurisdiction enforcement |
| `server/middleware/requirePolicy.ts` | Policy gating |
| `server/middleware/auth.ts` | Auth middleware + remember-me |

---

## Related Pages

- [Threat Model →](03_Threat_Model.md)
- [Legal & Compliance →](02_Legal_Compliance.md)
- [Production Requirements →](04_Production_Requirements.md)
- [Trading Engine →](../02_Architecture_Reference/07_Trading_Engine.md)
