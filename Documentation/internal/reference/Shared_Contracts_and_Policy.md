---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - .agents/shared-services.md
  - shared/
  - shared/policyDecision.ts
  - server/middleware/requirePolicy.ts
  - server/policy/buildDecisionContext.ts
  - server/policy/getPolicyConfig.ts
last_verified: 2026-03-29
status: maintained
---

# Shared Contracts And Policy

## Shared-First Contract Surface

`shared/` owns durable cross-surface contracts: schemas, WS message names, identity headers, locale preferences, bot-challenge structures, E2EE envelope limits, instruments, and policy-decision types.

## Policy Model

`shared/policyDecision.ts` defines:

- policy actions such as `TRADE_OPEN_OR_INCREASE`, `TRADE_CLOSE_OR_REDUCE`, `KYC_SUBMIT`, and payout-related actions
- deny codes and account-state model
- the decision object returned to enforcement layers

`server/middleware/requirePolicy.ts` is the server-side enforcement point. It builds context, loads policy config, evaluates `decidePolicy`, writes deny-side audit entries when needed, and returns shaped deny responses.

## Gold-Standard Rules

- define durable action names and message contracts in `shared/`
- enforce policy only on the server
- keep `requirePolicy` and its context builder as the canonical gate path instead of duplicating action-specific eligibility checks in handlers or clients
