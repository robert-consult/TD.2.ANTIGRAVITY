# `server/` AGENTS.md (API + WS + Trading Engine)

## What this area is
Express API, WebSocket server (`/ws`), quote ingestion, trading lifecycle, policy gating, and compliance controls.

## Non-negotiables (institutional-grade controls)
- **Policy gating stays server-side**: do not bypass `requirePolicy()` for trading actions.
- **Jurisdiction enforcement** must remain consistent across signup/login/session activity.
- **Legal acceptance integrity** must remain tamper-evident (HMAC tokens and DB records).
- **Audit trails** are append-only and attributable (preserve correlation IDs).
- **Do not weaken startup secret validation** in `server/index.ts`.

## Key entrypoints
- App bootstrap: `server/index.ts`
- Route wiring + `/ws` + `/metrics`: `server/routes.ts`
- Trading engine: `server/engine/orderEngine.ts`
- Risk middleware: `server/risk.ts`
- Session/identity: `server/security/sessionTrail.ts`
- Bot/captcha: `server/security/botGuard.ts`, `server/security/captcha.ts`
- Legal: `server/legal/*`
- Policy: `server/middleware/requirePolicy.ts`, `server/policy/buildDecisionContext.ts`, `shared/policyDecision.ts`

## WS/quotes performance rules
- Never add per-client/per-tick work that scales as O(clients * symbols * fields).
- Keep message parsing and fanout non-blocking; avoid synchronous heavy computations in WS handlers.
- Prefer stable subscription keying and compact payloads.

## Required checks before finalizing
- Typecheck: `npm run check`
- Build: `npm run build`
- If you touched DB schema or migrations: `npm run db:migrate:drizzle` + `npm run db:audit`
- If you touched trading/auth/ws flows: `npm run e2e`
- If you touched WS hot paths: `npm run loadtest:ws-fanout` (recommended)

