---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/routes.ts
  - server/routes/AGENTS.md
  - .agents/shared-services.md
  - shared/
last_verified: 2026-03-27
status: maintained
---

# Adding An API Endpoint

Current standard:

1. define or reuse shared contracts in `shared/` when the endpoint exposes durable shapes
2. add the route in the correct route domain
3. keep domain `index.ts` files as assemblers only
4. mount new routers through `server/routes.ts` only when mount topology changes
5. apply the correct middleware stack:
   - auth
   - doc/legal gating where required
   - policy gating through `requirePolicy`
   - bot protection where required
   - audit and observability hooks where the action is material

Current repo-specific cautions:

- do not add new monolithic `*Core.ts` files
- do not bypass `requirePolicy`, jurisdiction checks, or legal acceptance enforcement
- route handlers should call into services and shared helpers instead of embedding duplicate business logic
- if the route mutates trading, verification, compliance, or partner state, make the audit path explicit

Verification:

- `npm run check`
- `npm run build`
- `npm run e2e` when the route changes auth, trading, or WS-adjacent behavior
