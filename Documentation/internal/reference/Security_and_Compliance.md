---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - AGENTS.md
  - .agents/security.md
  - .agents/PRODUCTION_REQUIREMENTS.md
  - server/index.ts
  - server/routes.ts
  - server/routes/legal.ts
  - server/routes/verification.ts
  - server/middleware/jurisdictionSessionGuard.ts
  - server/middleware/requirePolicy.ts
last_verified: 2026-03-29
status: maintained
---

# Security And Compliance

## Core Invariants

- policy gating stays server-side
- jurisdiction restrictions must be consistent across signup, login, and active sessions
- legal acceptance integrity must remain tamper-evident
- verification, audit, and account-state transitions must stay attributable
- startup secret validation in `server/index.ts` must fail closed for critical secrets

## Request Security Shape

- sessions are established before API route handling
- CSRF issuance and enforcement are mounted on `/api`
- impersonation and jurisdiction guards run before domain handlers
- route-level security adds auth, legal gates, bot controls, policy gates, and audit paths as required

## Compliance Surfaces

- legal document resolution and acceptance live in `server/routes/legal.ts` and `server/legal/`
- email and SMS verification live in `server/routes/verification.ts`
- KYC and payout paths are profile-domain surfaces with policy-gated access
- the production requirement ledger in `.agents/PRODUCTION_REQUIREMENTS.md` is the canonical testable requirement source

## Documentation Boundary

- public docs can describe capabilities and expectations
- internal docs own incident response, readiness, operator access, fraud heuristics, and secret-handling boundaries
