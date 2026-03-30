---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/App.tsx
  - client/src/AuthenticatedShell.tsx
  - client/src/pages/Dashboard.tsx
  - client/src/pages/TradeScreen.tsx
  - server/routes/auth/
  - server/routes/profile/
  - server/routes/trader/
  - server/routes/verification.ts
  - server/routes/legal.ts
  - client/src/lib/dashboardUrlState.ts
  - client/src/live/
last_verified: 2026-03-30
status: maintained
---

# Trader Journey

## Primary Flow

1. unauthenticated bootstrap in `client/src/App.tsx`
2. login or registration through `server/routes/auth/`
3. verification and legal-state hydration
4. authenticated shell handoff through `client/src/AuthenticatedShell.tsx`
5. dashboard tabs for quotes, chart, trade, history, leaderboard, and account

## Repo-Grounded Flow Map

```mermaid
flowchart TD
  A[App.tsx bootstrap] --> B[AuthProvider + I18nProvider + MobileWrapperBridge]
  B --> C{Authenticated?}
  C -- no --> D[/login or /verify-email/]
  C -- yes --> E[AuthenticatedShell.tsx]
  E --> F[LiveUpdatesProvider + QuotesProvider]
  F --> G[ConfigSync + AccountSummarySync]
  G --> H[Dashboard route state via dashboardUrlState.ts]
  H --> I[Quotes / Chart / Trade / History / Leaderboard / Account]
  I --> J[POST /api/trades]
  I --> K[POST /api/trades/:id/close]
  I --> L[/api/mailbox + /api/notifications + /api/push]
  J --> M[tradeOpen.ts]
  K --> N[tradeClose.ts]
  M --> O[ensureAuth + doc1 + requirePolicy + botGuard + riskMiddleware]
  N --> O
  O --> P[server-authoritative quote lookup + audit writes + live broadcasts]
  P --> Q[/ws subscriptions refresh trades/account/notifications]
```

## Current Source-Of-Truth Endpoints

- auth state: `/api/auth/current-user`
- profile state: `/api/profile/me`
- account summary: `/api/account/summary`
- trade create: `POST /api/trades`
- trade close: `POST /api/trades/:id/close`
- trade list: `GET /api/trades`
- email verification: `/api/verification/email/send` and `/api/verification/email/verify`
- legal acceptance: `/api/legal/doc1/accept`

## Intentional Boundaries

- profile, sessions, preferences, KYC, and payout are part of the trader account surface and are mounted through the decomposed profile router
- dashboard navigation is query-state driven through `client/src/lib/dashboardUrlState.ts`, not a separate internal router tree per tab
- quote and account state are hydrated by live providers rather than every screen owning its own socket transport
- verification and legal checks are not optional side quests; they directly control what the trader can do next

## Trading Lifecycle

- manual open is handled by `server/routes/trader/tradeOpen.ts`
- manual close is handled by `server/routes/trader/tradeClose.ts`
- those handlers layer `ensureAuth`, legal acceptance, `requirePolicy`, bot protection, risk checks, quote revalidation, audit writes, and live broadcasts
- `server/engine/orderEngine.ts` is not the manual trade-open/close path; it processes pending orders and SL/TP execution against live quotes

## Account, Mailbox, And Notifications

- account summary and account panel state stay separate from the trade write path
- mailbox routes live at `/api/mailbox`
- notification routes live at `/api/notifications`
- push-device registration lives at `/api/push`

## Behavioral Boundaries

- policy enforcement stays server-side through `requirePolicy`
- bot protection is applied to trade mutations
- live updates are coordinated through `client/src/live/`
- `orderEngine.ts` is for pending orders and SL/TP processing, not the manual trade-open or trade-close HTTP handlers
- notifications and mailbox are separate trader-facing concerns, not part of the core trade-execution write path

Use [REST API Catalog](../generated/REST_API_Catalog.md) for exact route coverage and [WebSocket Catalog](../generated/WebSocket_Catalog.md) for live-event names.
