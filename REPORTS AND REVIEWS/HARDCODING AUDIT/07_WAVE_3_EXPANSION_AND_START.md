# Wave 3 Expansion And Completion

Verified against current tree on 2026-03-18.

## Wave 3 objective

Wave 3 is the correctness-sensitive policy pass.

Wave 2 established a runtime control plane for low-risk and controlled-reload settings. Wave 3 is where the platform stops resolving business, risk, abuse, and scheduler rules through multiple competing code paths.

The standard for this wave is stricter than “make it configurable”:

- one canonical resolver per correctness-sensitive domain
- bounded and normalized inputs
- explicit split between runtime policy, controlled-reload scheduler config, deploy-only caps, and code invariants
- the same effective rule set seen by every consumer that can affect money, abuse enforcement, or lifecycle decisions

## Expanded Wave 3 tracks

### Track A - Trading Risk Canonical Snapshot

Goal:
- remove fallback drift across `server/risk.ts`, `server/routes/trader/tradeOpen.ts`, and `server/engine/orderEngine.ts`

Canonical owner:
- `shared/tradingRiskConfig.ts`
- `server/services/runtimeConfig/tradingRisk.ts`

Must cover:
- default leverage
- max position size
- max trades per user
- max trades per instrument
- max concurrent lots
- min price distance
- market hours
- weekend-trading flag
- min hold seconds
- daily and lifetime loss controls

Rules:
- DB-backed global settings remain the business source of truth
- user overrides still take precedence where the product already allows them
- challenge leverage multipliers still apply, but through one reusable leverage resolver
- invalid values clamp into safe bounded ranges instead of creating route-specific behavior

Acceptance gate:
- open-trade route, risk middleware, and pending-order execution all resolve the same effective snapshot
- no route keeps its own risk literal fallback set

### Track B - Business Timings And Schedulers

Goal:
- separate business-owned timing rules from deploy-only safety guards

Focus areas:
- challenge evaluation cadence
- auto-close timing
- stale-close deploy guards

Canonical split:
- DB/runtime policy:
  - challenge interval and batch size
  - auto-close after-days and check frequency
- deploy/env guards:
  - stale-close emergency override
  - scheduler kill switches intended only for deploy control

Acceptance gate:
- scheduler-visible business timing comes from one resolved runtime path
- deploy-only stale guards stay read-only and explicit

### Track C - Grift Runtime Policy Versus Engine Caps

Goal:
- separate admin-editable grift thresholds from internal engine pressure caps

Canonical owner:
- new `server/services/runtimeConfig/griftConfig.ts`

Runtime policy:
- scoring thresholds
- enforcement thresholds
- retention windows
- rule windows tied to business detection logic

Deploy-only engine caps:
- config TTL
- linked-edge write caps
- evidence fanout caps
- batch-row caps

Acceptance gate:
- admin sees configured runtime policy separately from deploy-owned engine caps
- engine caps remain read-only diagnostics
- all nodes invalidate and re-read the same grift config version

### Track D - Bot Guard Split: Operator Controls Versus Versioned Heuristics

Goal:
- keep coarse, operator-safe bot controls in admin while moving scoring-window heuristics out of inline code branching

Operator-safe runtime config:
- enable/disable POW
- POW enforce on signup/login
- challenge score threshold
- difficulty bounds
- TTL
- valkey enable flag

Versioned policy candidate:
- scoring windows by action
- penalty ladders
- label thresholds if they become non-structural policy

Acceptance gate:
- `botGuard.ts` reads one normalized coarse config snapshot
- scoring windows are isolated and prepared for versioned policy extraction rather than buried in mixed handler logic

## Wave 3 execution order

1. Trading risk canonical snapshot
2. Challenge/auto-close timing normalization
3. Grift runtime policy versus engine caps split
4. Bot coarse config normalization and heuristic extraction prep

This order matters because trading risk affects money correctness directly, while the later tracks depend on the same pattern: canonical runtime snapshot first, then effective-state visibility, then propagation/governance.

## Completed in this pass

Implemented:

- Trading risk canonical snapshot:
  - added `shared/tradingRiskConfig.ts`
  - added `server/services/runtimeConfig/tradingRisk.ts`
  - routed `server/risk.ts` through the shared resolver for market-hours, concurrency, min-hold, and loss-limit reads
  - routed `server/routes/trader/tradeOpen.ts` through the same resolver for max position size, min price distance, leverage, and max concurrent lots
  - routed `server/engine/orderEngine.ts` through the same resolver for pending-order execution-time limits and leverage

Why this was first:
- it removes the highest-risk drift cluster identified in HC-017 and HC-020
- it produces one reusable pattern for the rest of Wave 3

Then completed:

- Track B - business timings and schedulers:
  - added `server/services/runtimeConfig/autoClose.ts`
  - added `server/services/runtimeConfig/challengeScheduler.ts`
  - routed `server/cron/autoClose.ts` through the runtime-config owner for business timing and deploy-only stale-close guards
  - fixed live reschedule freshness by invalidating the cached global-settings snapshot before auto-close rescheduling
  - routed `server/cron/evaluateChallenges.ts` through the scheduler runtime-config owner and exposed live next-run/runtime state
  - exposed challenge scheduler effective state in `server/routes/adminScout/challenges.ts`
  - exposed auto-close effective state in `server/routes/admin.ts`

- Track C - grift runtime policy versus engine caps:
  - added `server/services/runtimeConfig/griftConfig.ts`
  - moved grift config row normalization and engine-cap ownership out of `server/grift/griftEngine.ts`
  - kept deploy-only engine caps read-only while preserving admin control over runtime policy
  - exposed effective grift config state in `server/routes/grift-admin/ops.ts`
  - added admin UI visibility for policy source and engine-cap diagnostics in `client/src/components/admin/grift/ConfigTab.tsx`

- Track D - bot coarse config versus versioned heuristics:
  - added `server/services/runtimeConfig/botConfig.ts`
  - extracted scoring-window heuristics to `server/security/botGuardHeuristics.ts`
  - routed `server/security/botGuard.ts` through one normalized coarse config snapshot
  - routed `server/services/accountLifecycle.ts` through the same lifecycle-config owner
  - added `activity-config:updated` propagation and effective-state responses in `server/routes/adminActivity.ts`
  - added admin UI visibility for derived trade proof threshold and heuristic version in `client/src/components/admin/UserActivityAdmin.tsx`

- Admin effective-state visibility:
  - challenge settings now show effective scheduler state in `client/src/components/admin/scout-challenges/SettingsTab.tsx`
  - grift config now shows runtime policy versus deploy-owned engine caps
  - activity/bot config now shows coarse config versus derived effective trade proof threshold

Wave 3 is complete for the slices defined in this document.

## Validation standard for Wave 3

- `npm run check`
- `npm run build`
- targeted vitest for trade routes and new runtime-config resolvers
- trade route parity checks for open/close/cancel flows
- scheduler/grift/bot tests for the new runtime-config owners

## Validation completed

- `npm run check`
- `npm run build`
- `npx vitest run server/services/runtimeConfig/tradingRisk.test.ts server/services/runtimeConfig/griftConfig.test.ts server/services/runtimeConfig/botConfig.test.ts server/services/runtimeConfig/autoClose.test.ts server/services/runtimeConfig/challengeScheduler.test.ts server/security/botGuardHeuristics.test.ts server/cron/autoClose.test.ts server/grift/griftEngine.test.ts server/recruitment/challengesV4/challengeSystemConfig.test.ts server/routes/trader/tradeOpen.test.ts server/routes/trader/tradeClose.test.ts server/routes/trader/tradeCancel.test.ts client/src/live/ConfigSync.test.tsx`
