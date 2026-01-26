# `client/` AGENTS.md (Web UI)

## What this area is
React + Vite frontend for TradeQuip. It consumes `/api/*` and `/ws` and must stay bandwidth-efficient.

## Non-negotiables
- Do not change API contracts without updating:
  - shared schemas (`shared/schema.pg.ts`)
  - server handlers (`server/routes.ts` and/or `server/routes/*`)
  - client hooks/pages using the contract
  - E2E coverage where applicable (`e2e/`)
- Treat `/ws` payload size as a first-class constraint (high fanout).

## Key entrypoints
- Routing/pages: `client/src/pages/`, `client/src/App.tsx`
- Data layer: `client/src/hooks/`, `client/src/lib/`
- Live updates: `client/src/live/`
- i18n: `client/src/i18n/`, `client/i18n-manifest.json`

## Performance rules (web)
- Avoid unnecessary re-renders on quote-heavy screens (memoize selectors; keep derived state minimal).
- Prefer incremental/delta updates for live data; avoid replacing entire arrays/objects per tick.
- Keep charting/table rendering efficient (virtualize if list sizes grow).

## Required checks before finalizing
- Typecheck: `npm run check`
- Build: `npm run build`
- If you changed trading/auth/ws flows: `npm run e2e`

