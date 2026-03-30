# Public Website Module

> **Diátaxis quadrant:** Reference
> **Sources:** `WEBSITE/AGENTS.md`, `WEBSITE/README.md`

---

## Overview

The `WEBSITE/` directory is a **fully isolated** public-facing marketing website for TradeQuip. It has **zero coupling** to the trading application.

---

## Isolation Rules

1. **NO authentication logic** — no `useAuth`, `AuthProvider`, `LoginPage`, or session management
2. **NO database access** — no `better-sqlite3`, `drizzle-orm`, `pg`, or any DB driver
3. **NO trading logic** — no order execution, portfolio management, quote feeds, or WebSocket connections
4. **NO shared imports** — never import from `@db/`, `@shared/`, or any path outside `WEBSITE/`
5. **Cross-domain links use native `<a>` tags** — login/signup buttons redirect to `tradehub.example.com` via browser navigation, NOT wouter `<Link>`
6. **Default local port is `5001`** — avoids collision with the trading app's `5000`

---

## Key Files

| File | Purpose |
|---|---|
| `WEBSITE/client/src/lib/app-config.ts` | Central config for `tradehub.example.com` URLs |
| `WEBSITE/client/src/App.tsx` | Public routes: `/`, `/dashboard`, `/education`, `/contact` |
| `WEBSITE/client/src/components/MarketingHeader.tsx` | Header with native `<a>` login/signup links |
| `WEBSITE/client/src/modules/tradingview/` | TradingView widget components |
| `WEBSITE/server/routes.ts` | Only 3 API routes: `/api/status`, `/api/education/modules`, `/api/contact` |
| `WEBSITE/server/content/educationModules.ts` | Education content dataset |

---

## Deletion Safety

The entire `WEBSITE/` folder can be deleted without affecting the trading application. Run `npm run audit:website-isolation` from the repo root after changing website imports.

---

## Related Pages

- [System Overview →](00_System_Overview.md)
