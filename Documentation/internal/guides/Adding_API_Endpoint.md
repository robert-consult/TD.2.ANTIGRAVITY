---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/routes.ts
  - server/routes/AGENTS.md
  - .agents/shared-services.md
  - shared/
  - server/middleware/requirePolicy.ts
last_verified: 2026-03-30
status: maintained
---

# Adding An API Endpoint

## Current Standard

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

## Repo-Specific Cautions

- do not add new monolithic `*Core.ts` files
- do not bypass `requirePolicy`, jurisdiction checks, or legal acceptance enforcement
- route handlers should call into services and shared helpers instead of embedding duplicate business logic
- if the route mutates trading, verification, compliance, or partner state, make the audit path explicit

## Route Architecture Notes

- `server/routes.ts` is the mount orchestrator; keep it thin
- domain `index.ts` files wire focused route modules and should stay free of business logic
- if a new durable HTTP or WS shape is introduced, update `shared/` first and then the server and clients
- use `requirePolicy` when the action belongs to the account-state and compliance gate model instead of inventing ad hoc authorization checks

## Repo-Grounded Example

```ts
import type { Router, Request, Response } from "express";
import { requirePolicy } from "../../middleware/requirePolicy";
import type { TraderRouterDeps } from "./types";

export function registerExampleRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted } = deps;

  router.post(
    "/api/trader/example-action",
    ensureAuth,
    ensureDoc1TermsAccepted,
    requirePolicy("TRADE_OPEN_OR_INCREASE"),
    async (req: Request, res: Response) => {
      res.json({ ok: true, requestedBy: Number(req.session.userId) });
    },
  );
}
```

That pattern matches the current trader route structure: focused route modules are registered from a domain `index.ts`, and policy/legal/auth checks stay in the server-side route stack instead of the client.

## Verification

- `npm run check`
- `npm run build`
- `npm run e2e` when the route changes auth, trading, or WS-adjacent behavior
