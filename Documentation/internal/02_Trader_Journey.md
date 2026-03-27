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
last_verified: 2026-03-27
status: maintained
---

# Trader Journey

Primary flow:

1. unauthenticated bootstrap in `client/src/App.tsx`
2. login or registration through `server/routes/auth/`
3. verification and legal-state hydration
4. authenticated shell handoff through `client/src/AuthenticatedShell.tsx`
5. dashboard tabs for quotes, chart, trade, history, leaderboard, and account

Current source-of-truth endpoints:

- auth state: `/api/auth/current-user`
- profile state: `/api/profile/me`
- account summary: `/api/account/summary`
- trade create: `POST /api/trades`
- trade close: `POST /api/trades/:id/close`
- trade list: `GET /api/trades`
- email verification: `/api/verification/email/send` and `/api/verification/email/verify`
- legal acceptance: `/api/legal/doc1/accept`

Important behavioral boundaries:

- policy enforcement stays server-side through `requirePolicy`
- bot protection is applied to trade mutations
- live updates are coordinated through `client/src/live/`
- `orderEngine.ts` is for pending orders and SL/TP processing, not the manual trade-open or trade-close HTTP handlers
- notifications and mailbox are separate trader-facing concerns, not part of the core trade-execution write path
