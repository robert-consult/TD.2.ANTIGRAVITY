# `server/routes/` AGENTS.md (Route Architecture Guardrails)

## Purpose
This folder defines the API/WS route surface. Keep route code modular, auditable, and scalable.

Primary goals for all route changes:
- No route-file bloat or monolith growth.
- Preserve security gates and middleware ordering.
- Keep hot paths fast and allocation-light.
- Make upgrades easy by using small, composable modules.

## Required Read Order
1. `AGENTS.md` (repo root)
2. `server/AGENTS.md`
3. `server/routes/AGENTS.md` (this file)

## Route Design Standard (mandatory)
- Organize by domain folder (`public/`, `auth/`, `profile/`, `trader/`, `ws/`, etc.).
- Keep route handlers in focused files (single responsibility per route group/action).
- Keep each domain `index.ts` as an assembler only: register route modules, avoid business logic.
- Keep `server/routes.ts` thin: global middleware + mount order orchestration only.
- Move shared business logic to `server/services/`, `server/lib/`, `server/policy/`, or `server/security/` rather than duplicating in handlers.

## Index Update Rule (mandatory)
When adding or moving routes, update all relevant indices in the same change:
- Domain assembler: `server/routes/<domain>/index.ts`
- App mount orchestrator: `server/routes.ts` (only if new router mount or mount order changes)
- Deep-context map: `.agents/deep-context.md` (if you introduce a new route domain or major entrypoint)

If a route file is added but not wired in the domain `index.ts`, the change is incomplete.

## Security / Compliance Invariants
- Do not bypass `ensureAuth`, `ensureDoc1TermsAccepted`, `requirePolicy`, or bot controls where previously required.
- Preserve global middleware order in `server/routes.ts`:
  1) `impersonationGuard`
  2) `jurisdictionSessionGuard`
  3) CSRF issue + enforce
  4) route-specific middleware
- Do not relax jurisdiction checks, legal acceptance flows, or audit write paths.
- Never add raw SQL string interpolation. Parameterized SQL only.
- Do not use `@ts-nocheck` in new route modules.

## Performance / Scaling Rules
- Avoid per-request or per-message heavy sync work in handlers.
- Reuse shared cached loaders/services for config and quote paths.
- WS paths must avoid O(clients * symbols * fields) fanout patterns.
- Keep payloads compact and avoid repeated serialization in fanout loops.

## Anti-Bloat Rules
- Do not add new `*Core.ts` monoliths.
- If a file becomes hard to reason about, split it before adding more logic.
- Keep mutable process state out of general route files; isolate state in dedicated modules.

## Verification Before Finalizing
- `npm run check`
- `npm run build`
- If auth/trading/ws paths changed: `npm run e2e`
- If WS hot path changed: `npm run loadtest:ws-fanout` (recommended)
- Route parity sanity (when doing decomposition moves):
  - Compare method/path list before/after and confirm no unintended additions/removals.

