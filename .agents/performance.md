# Performance & Bandwidth Checklist (TradeQuip)

## Scope rule
Only analyze code you touched plus adjacent hot paths (callers/callees, shared utilities, schemas).

If you touch quote ingestion, `/ws`, trading routes, or risk checks, assume you are on a hot path.

## Compute efficiency (CPU/memory)
For each changed function/module:
- Complexity: state expected Big‑O; justify any superlinear behavior.
- Allocations: avoid repeated `JSON.stringify`/`JSON.parse`, cloning large objects, or creating per-client/per-tick garbage.
- DB: avoid N+1; verify indexes cover predicates/order; keep trading checks O(1)/O(log n) where possible.
- Caching: avoid rebuilding invariant lookup tables inside request handlers; memoize safely where inputs are immutable.
- Backpressure: do not create unbounded queues (WS fanout, job workers, ingestion).

Project hot spots to treat as “perf critical”:
- `/ws` fanout: `server/routes.ts` (subscriptions + send loops)
- Quote hub: `server/services/quoteHub.ts`
- Quote ingestion: `server/feeds/quoteFeed.ts`
- Order engine: `server/engine/orderEngine.ts`
- Risk middleware: `server/risk.ts`
- Activity/jurisdiction checks: `server/security/sessionTrail.ts`, `server/policy/jurisdictionControl.ts`

## Bandwidth efficiency (HTTP + WebSocket)
- Prefer delta updates over snapshots on `/ws` where feasible (quotes/trades/account).
- Keep WS payloads compact: avoid redundant fields; prefer stable numeric IDs where clients already have lookup tables.
- Batch when it reduces overhead (e.g., multiple quote updates in one frame) but avoid latency spikes.
- Compression tradeoff: remember `compression()` is enabled in non-dev; do not “fix” bandwidth by adding huge JSON.
- Assets: the build runs `scripts/precompressAssets.ts`; do not break precompression assumptions.

## “Do not regress” checks (when touching WS/quotes)
- Validate subscription keying remains stable (avoid per-message recomputation of symbol sets).
- Validate WS send loops don’t block the event loop (avoid sync heavy work in `message` handlers).
- Validate quote staleness logic doesn’t turn into a per-request DB scan (`server/services/quoteService.ts`, `server/risk.ts`).

## Suggested local validation (pick what matches your change)
- WS scale sanity: `npm run loadtest:ws-fanout`
- Quote ingestion sanity: `npm run loadtest:publish-quotes`
- E2E trading flows: `npm run e2e`

