---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - .agents/release-done.md
  - .agents/performance.md
  - .agents/security.md
  - AGENTS.md
last_verified: 2026-03-29
status: maintained
---

# Definition Of Done

## Required Baseline

A change is only done when the relevant verification has been run and the affected contracts, docs, and guardrails still hold.

## Core Checks

- correctness: run the applicable type/build/test commands
- performance: complete the relevant checks from `.agents/performance.md` when touching hot paths
- security: complete the relevant checks from `.agents/security.md` when touching auth, trading, compliance, or audit boundaries
- contracts: update shared schemas/types when API or cross-surface behavior changes
- docs: update maintained docs when the change affects current behavior, commands, or ownership boundaries

## Common Verification Matrix

- web/API: `npm run check`, `npm run build`
- routes or WS: add `npm run e2e`
- DB/schema: `npm run db:migrate:drizzle`, `npm run db:audit`
- WS/trading hot paths: `npm run loadtest:ws-fanout`, `npm run loadtest:publish-quotes`
- wrapper/native changes: `cd MOBILE && npm run sync` or `cd NATIVE && npm test`
