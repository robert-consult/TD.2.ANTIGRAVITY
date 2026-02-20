# DESIGN-001: routes.ts Decomposition

## Phase 1 — Pure Utilities (zero risk)
- [ ] `server/lib/priceUtils.ts` — move toUnixMs, getPrecision, toTicks, ticksToPrice, price comparison fns, normalizeLanguagePreference
- [ ] `server/utils/computeEmailGracePeriod.ts` — move computeEmailGracePeriod
- [ ] `server/services/currentUserRecalc.ts` — move CURRENT_USER_RECALC_STATE, maybeRecalcAccountForCurrentUser

## Phase 2 — Shared Context + Middleware Factories
- [ ] `server/context/routerContext.ts` — RouterContext, WsState, AppMiddleware interfaces
- [ ] `server/context/buildMiddleware.ts` — ensureAuth, ensureDoc1TermsAccepted factory

## Phase 3 — WebSocket Server Extraction
- [ ] `server/routes/ws/wsContext.ts` — WsState, Prometheus counters
- [ ] `server/routes/ws/wsHelpers.ts` — all WS utility functions
- [ ] `server/routes/ws/wsQuotePush.ts` — quote batching and push
- [ ] `server/routes/ws/wsQuotePermissions.ts` — per-client symbol permissions refresh
- [ ] `server/routes/ws/wsMessageHandlers.ts` — onMessage handler body
- [ ] `server/routes/ws/wsConnectionHandler.ts` — onConnection handler body
- [ ] `server/routes/ws/wsLiveEventBridge.ts` — onLiveEvent → broadcast dispatch
- [ ] `server/routes/ws/index.ts` — initWebSocketServer()

## Phase 4 — Public Routes
- [ ] `server/routes/public/status.ts`
- [ ] `server/routes/public/globalSettings.ts`
- [ ] `server/routes/public/signupConfig.ts` — getSignupPublicConfig exported
- [ ] `server/routes/public/waitlist.ts`
- [ ] `server/routes/public/symbols.ts`
- [ ] `server/routes/public/quotes.ts`
- [ ] `server/routes/public/diagnostics.ts`
- [ ] `server/routes/public/index.ts`

## Phase 5 — Auth Routes
- [ ] `server/routes/auth/login.ts`
- [ ] `server/routes/auth/register.ts`
- [ ] `server/routes/auth/logout.ts`
- [ ] `server/routes/auth/currentUser.ts`
- [ ] `server/routes/auth/devices.ts`
- [ ] `server/routes/auth/index.ts`

## Phase 6 — Profile Routes
- [ ] `server/routes/profile/update.ts`
- [ ] `server/routes/profile/changePassword.ts`
- [ ] `server/routes/profile/deactivate.ts`
- [ ] `server/routes/profile/deleteAccount.ts`
- [ ] `server/routes/profile/me.ts`
- [ ] `server/routes/profile/loginHistory.ts`
- [ ] `server/routes/profile/sessions.ts`
- [ ] `server/routes/profile/preferences.ts`
- [ ] `server/routes/profile/kyc.ts`
- [ ] `server/routes/profile/payout.ts`
- [ ] `server/routes/profile/index.ts`

## Phase 7 — Trader Routes
- [ ] `server/routes/trader/trades.ts`
- [ ] `server/routes/trader/tradeOpen.ts`
- [ ] `server/routes/trader/tradeClose.ts`
- [ ] `server/routes/trader/tradeTargets.ts`
- [ ] `server/routes/trader/journal.ts`
- [ ] `server/routes/trader/account.ts`
- [ ] `server/routes/trader/policy.ts`
- [ ] `server/routes/trader/leaderboard.ts`
- [ ] `server/routes/trader/index.ts`

## Phase 8 — Metrics + Cleanup
- [ ] `server/routes/metrics.ts`
- [ ] Slim down `server/routes.ts` to thin orchestrator (~150 lines)
- [ ] Remove @ts-nocheck from routes.ts
- [ ] Run tsc --noEmit, fix type errors

## Verification
- [ ] TypeScript compiles clean (zero errors)
- [ ] Smoke test: login → trade open → trade close → logout
- [ ] WS test: connect → auth:hello → quotes:subscribe → receive quotes
