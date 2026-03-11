# WEBSITE Module — Agent Guide

## What This Is

This is the **public-facing marketing website** for TradeQuip, extracted as a standalone module from the TD.2.ANTIGRAVITY repository. It is hosted at `example.com` and has **zero coupling** to the trading application at `tradehub.example.com`.

## Architecture Rules

1. **NO authentication logic** — no `useAuth`, no `AuthProvider`, no `LoginPage`, no session management
2. **NO database access** — no `better-sqlite3`, `drizzle-orm`, `pg`, or any DB driver
3. **NO trading logic** — no order execution, portfolio management, quote feeds, or WebSocket connections
4. **NO shared imports** — never import from `@db/`, `@shared/`, or any path outside `WEBSITE/`
5. **Cross-domain links use native `<a>` tags** — login/signup buttons redirect to `tradehub.example.com` via browser navigation, NOT wouter `<Link>`
6. **Default local port is 5001** — do not reintroduce a collision with the app's `5000`

## Key Files

| File | Purpose |
|------|---------|
| `client/src/lib/app-config.ts` | Central config for all `tradehub.example.com` URLs |
| `client/src/App.tsx` | Public routes only: `/`, `/dashboard`, `/education`, `/contact` |
| `client/src/components/MarketingHeader.tsx` | Header with native `<a>` login/signup links |
| `client/src/modules/tradingview/` | TradingView widget components (chart, ticker, market cards) |
| `server/routes.ts` | Only 3 API routes: `/api/status`, `/api/education/modules`, `/api/contact` |
| `server/content/educationModules.ts` | Website-owned education module dataset |

## Deletion Safety

This entire `WEBSITE/` folder can be deleted without affecting the trading application. The trading app at `tradehub.example.com` has no knowledge of or dependency on this folder.

## Isolation Check

Run `npm run audit:website-isolation` from the repo root after changing website imports or shared boundaries.

## Adding UI Components

Only add the UI components the public pages actually need. Avoid restoring dead extraction residue just because it exists in the main app.
