# Performance & Bandwidth Checklist (TradeQuip)

## Scope rule
Only analyze code you touched plus adjacent hot paths (callers/callees, shared utilities, schemas).

If you touch quote ingestion, `/ws`, trading routes, risk checks, fetch/prefetch, service worker, query hydration, or tier controls, assume you are on a hot path.

## Performance gate (mandatory)
Before finalizing a change that touches app loading, caching, prefetch, live updates, or tier behavior:
- Complete this checklist and report pass/fail in final summary.
- If your change introduces a new fetch/cache/prefetch/tier behavior not covered here, update this file in the same change.

## Deep-context performance entrypoints
Use these first when evaluating fast-load behavior:
- Prefetch planning: `client/src/lib/perfHints.ts`
- Route prefetch orchestration: `client/src/lib/routePrefetch.ts`
- Service worker cache + burst prefetch: `client/src/sw.ts`
- Startup hydration/persistence: `client/src/lib/queryPersistence.ts`, `client/src/main.tsx`, `client/src/App.tsx`
- Live config propagation: `client/src/live/ConfigSync.tsx`, `client/src/lib/globalSettingsPerformance.ts`
- Admin perf controls: `client/src/pages/AdminDashboard.tsx`, `server/routes/admin.ts`, `server/routes/public/globalSettings.ts`, `server/routes/publicCore.ts`, `shared/schema.pg.ts`
- Hot-path load tests: `scripts/loadtest/wsFanout.ts`, `scripts/loadtest/publishQuotes.ts`

## Fast fetch + cache invariants (must hold)
- No unbounded startup fetch bursts. Prefetch/caching concurrency must stay bounded.
- `saveData` and `MINIMAL` behavior must reduce or disable aggressive prefetch.
- Service worker must never cache/proxy `/api/*` or `/ws`; cache only safe same-origin assets/shell.
- Cache fills must dedupe in-flight requests to avoid duplicate fetches for the same asset.
- App first render must not be blocked by heavy cache hydration (non-critical hydration happens after initial paint).
- Admin performance changes must propagate live via `global-settings:updated` without manual refresh.
- Live performance cache merges must preserve existing global settings shape (no partial-object cache clobber) and support nested `performanceSettings` payloads for immediate admin-card updates.

## Tier matrix checks (required for tier-affecting changes)
Validate behavior for `INSTANT`, `FAST`, `MODERATE`, `CONSTRAINED`, `MINIMAL`:
- Prefetch plan: expected `mode`, `count`, `maxConcurrency`, and `startDelayMs` per tier.
- Warm navigation: route switches after warmup should feel immediate (no avoidable multi-second fetch waits).
- Connectivity safety: weaker tiers must preserve headroom for auth/settings/WS connect and reconnect.
- Data-saver safety: `saveData` must prevent aggressive prefetch bursts.

If tier behavior is changed, include evidence from tests and/or manual tier simulation in PR/task notes.

## Compute efficiency (CPU/memory)
For each changed function/module:
- Complexity: state expected Big-O; justify any superlinear behavior.
- Allocations: avoid repeated `JSON.stringify`/`JSON.parse`, cloning large objects, or per-client/per-tick garbage.
- DB: avoid N+1; verify indexes cover predicates/order; keep trading checks O(1)/O(log n) where possible.
- Caching: avoid rebuilding invariant lookup tables inside request handlers; memoize only when inputs are stable.
- Backpressure: do not create unbounded queues (WS fanout, job workers, ingestion).

Project hot spots to treat as perf critical:
- `/ws` fanout: `server/routes.ts` (subscriptions + send loops)
- Quote hub: `server/services/quoteHub.ts`
- Quote ingestion: `server/feeds/quoteFeed.ts`
- Order engine: `server/engine/orderEngine.ts`
- Risk middleware: `server/risk.ts`
- Activity/jurisdiction checks: `server/security/sessionTrail.ts`, `server/policy/jurisdictionControl.ts`

## Bandwidth efficiency (HTTP + WebSocket)
- Prefer delta updates over snapshots on `/ws` where feasible (quotes/trades/account).
- Keep WS payloads compact: avoid redundant fields; prefer stable IDs where clients already have lookup tables.
- Batch when it reduces overhead, but avoid latency spikes.
- Respect compression/precompression assumptions: `compression()` (non-dev) and `scripts/precompressAssets.ts`.
- Do not increase startup asset fetch volume/concurrency without a tier-aware mitigation plan.

## Do-not-regress checks (WS/quotes/cache)
- Subscription keying remains stable; no per-message recomputation of large symbol sets.
- WS send loops remain non-blocking; no synchronous heavy work in message handlers.
- Quote staleness checks do not degrade into per-request DB scans (`server/services/quoteService.ts`, `server/risk.ts`).
- SW cache strategy remains safe and deterministic for shell/assets only.

## Required local validation (pick what matches your change)
- Type/build baseline: `npm run check` and `npm run build`
- Tier/prefetch/cache logic tests:
  - `npx vitest run client/src/lib/perfHints.test.ts client/src/lib/routePrefetch.test.ts`
  - `npx vitest run client/src/live/ConfigSync.test.ts client/src/hooks/use-performance-settings.test.tsx`
- WS scale sanity: `npm run loadtest:ws-fanout`
- Quote ingestion sanity: `npm run loadtest:publish-quotes`
- Admin propagation sanity: `npm run smoke:admin`
- E2E trading flows when relevant: `npm run e2e`
