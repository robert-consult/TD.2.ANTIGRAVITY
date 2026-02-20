# DESIGN-001: routes.ts Decomposition Plan

> **Design, Audit & Planning Document — No code is modified by this plan.**
> This is a reference implementation guide for a senior developer to execute.

---

## Background & Problem Statement

`server/routes.ts` is a **6272-line, 250 KB** monolith with `@ts-nocheck` at line 1 (a regression — it was previously removed). It is the single most dangerous file in the codebase because:

- A single compilation error blocks the entire server
- Every route is a closure inside `registerRoutes()`, preventing extraction without architectural surgery
- Shared helpers (`ensureAuth`, `ensureDoc1TermsAccepted`, `computeEmailGracePeriod`, `maybeRecalcAccountForCurrentUser`) are all lexically bound closures — not importable
- The WebSocket server (`wss`) is instantiated inside `registerRoutes()` and referenced by 500+ lines of helper functions that also live inside the closure — they hold shared mutable state (`liveWsPushFrequencyMs`, `queuedQuoteRowsBySymbol`, module-level Prometheus counters)
- `SESSION_SECRET` and `sessionStore` are also captured as closure vars for WS session reading

The existing `server/routes/` folder already has 30 sub-files extracted. What remains in `routes.ts` is the hardest core.

---

## Pre-Work: Fix the @ts-nocheck Regression

> [!CAUTION]
> **routes.ts L1 has `@ts-nocheck` restored (regression).** This must be removed as part of the decomposition. It cannot be removed safely in isolation without fixing the typing issues it was masking — which the decomposition will accomplish by moving code to typed files.

---

## Root Architectural Problem: The Closure Anti-Pattern

All routes and helpers inside `registerRoutes()` share a closure scope containing:

| Captured Binding | Type | Used By |
|---|---|---|
| `sessionStore` | `Store` | WS session reader (`getWsSession`, `destroyCookieSession`) |
| `SESSION_SECRET` | `string` | WS cookie parser (`getWsSessionIdFromCookies`) |
| `SESSION_COOKIE_NAME` | `string` | WS cookie parsing, logout |
| `wss` | `WebSocketServer` | broadcast(), all WS helpers, metrics, onLiveEvent handler |
| `liveWsPushFrequencyMs` | `number` (mutable) | Quote push throttling state |
| `queuedQuoteRowsBySymbol` | `Map` (mutable) | Quote batching state |
| `ensureAuth` | middleware | 20+ routes |
| `ensureDoc1TermsAccepted` | middleware | 4 trade routes |
| `getSignupPublicConfig` | async fn | login, register, waitlist |
| `normalizeSignupPhone` | fn | register |
| `computeEmailGracePeriod` | fn | login, current-user |
| `maybeRecalcAccountForCurrentUser` | async fn | current-user |
| `CURRENT_USER_RECALC_STATE` | `Map` (mutable) | recalc throttled state |

**The solution** is a **shared context object** (`RouterContext`) passed as a parameter to each sub-router factory function, replacing the lexical closure.

---

## Solution: RouterContext Pattern

```typescript
// server/context/routerContext.ts
export interface RouterContext {
  sessionStore: import("express-session").Store;
  sessionCookieName: string;
  sessionSecret: string;
  wss: import("ws").WebSocketServer;
  wsState: WsState;           // mutable WS state (push freq, queued quotes)
  middleware: AppMiddleware;  // ensureAuth, ensureDoc1TermsAccepted, etc.
}

export interface WsState {
  liveWsPushFrequencyMs: number;
  queuedQuoteRowsBySymbol: Map<string, any>;
  queuedQuoteSeq: number;
  queuedQuoteAsOf: number;
  queuedQuoteFlushTimer: ReturnType<typeof setTimeout> | null;
  queuedQuoteAnonRowId: number;
}

export interface AppMiddleware {
  ensureAuth: RequestHandler;
  ensureDoc1TermsAccepted: RequestHandler;
}
```

Each new router file exports a factory: `export function createXRouter(ctx: RouterContext): Router`.  
`registerRoutes()` becomes a thin orchestrator that:
1. Creates session middleware + CSRF
2. Builds `RouterContext`
3. Calls each factory
4. Mounts the resulting routers

---

## Target Folder Structure

```
server/
├── context/
│   ├── routerContext.ts          [NEW] RouterContext + WsState + AppMiddleware types
│   └── buildMiddleware.ts        [NEW] Creates ensureAuth, ensureDoc1TermsAccepted
│
├── routes/                       [EXISTING — add new files here]
│   │
│   ├── [EXISTING 30 files — untouched]
│   │
│   ├── auth/                     [NEW sub-folder]
│   │   ├── login.ts              [NEW] POST /api/auth/login
│   │   ├── register.ts           [NEW] POST /api/auth/register
│   │   ├── logout.ts             [NEW] POST /api/auth/logout
│   │   ├── currentUser.ts        [NEW] GET /api/auth/current-user
│   │   ├── devices.ts            [NEW] GET/DELETE /api/auth/devices, /api/auth/devices/:id
│   │   └── index.ts              [NEW] Assembles auth sub-router, exports createAuthRouter(ctx)
│   │
│   ├── profile/                  [NEW sub-folder]
│   │   ├── update.ts             [NEW] POST /api/profile/update
│   │   ├── changePassword.ts     [NEW] POST /api/profile/change-password
│   │   ├── deactivate.ts         [NEW] POST /api/profile/account/deactivate
│   │   ├── deleteAccount.ts      [NEW] POST /api/profile/account/delete
│   │   ├── me.ts                 [NEW] GET /api/profile/me
│   │   ├── loginHistory.ts       [NEW] GET /api/profile/login-history
│   │   ├── sessions.ts           [NEW] GET/DELETE /api/profile/sessions, /api/profile/sessions/:sessionId
│   │   ├── preferences.ts        [NEW] GET/PUT /api/profile/preferences
│   │   ├── kyc.ts                [NEW] GET/POST /api/profile/kyc, /api/profile/kyc/submit
│   │   ├── payout.ts             [NEW] GET/PUT /api/profile/payout, /api/profile/payout/currency
│   │   └── index.ts              [NEW] createProfileRouter(ctx)
│   │
│   ├── trader/                   [NEW sub-folder]
│   │   ├── trades.ts             [NEW] GET /api/trades, /api/trades/history, /api/trades/open, /api/trades/pending
│   │   ├── tradeOpen.ts          [NEW] POST /api/trades (open new trade) — ~500 lines, complex
│   │   ├── tradeClose.ts         [NEW] POST /api/trades/:id/close — ~400 lines
│   │   ├── tradeTargets.ts       [NEW] PATCH /api/trades/:id/targets
│   │   ├── journal.ts            [NEW] GET/POST/PUT/DELETE /api/journal
│   │   ├── account.ts            [NEW] GET /api/account/summary
│   │   ├── policy.ts             [NEW] GET /api/policy/snapshot
│   │   ├── leaderboard.ts        [NEW] GET /api/leaderboard
│   │   └── index.ts              [NEW] createTraderRouter(ctx)
│   │
│   ├── public/                   [NEW sub-folder]
│   │   ├── status.ts             [NEW] GET /api/status
│   │   ├── globalSettings.ts     [NEW] GET /api/global-settings
│   │   ├── signupConfig.ts       [NEW] GET /api/auth/signup-config, /api/auth/waitlist-policy
│   │   ├── waitlist.ts           [NEW] POST /api/waitlist
│   │   ├── symbols.ts            [NEW] GET /api/config/symbols
│   │   ├── quotes.ts             [NEW] GET /api/quotes/latest, /api/quotes/:symbol
│   │   └── diagnostics.ts        [NEW] GET /api/diagnostics/price-feed
│   │
│   └── ws/                       [NEW sub-folder — WS server extraction]
│       ├── wsContext.ts          [NEW] WsState + WsMetrics types, shared mutable state singleton
│       ├── wsHelpers.ts          [NEW] normalizeWsOrigin, getWsSession, destroyCookieSession,
│       │                               getWsSessionIdFromCookies, wsSendJson, wsCloseUnauthorized,
│       │                               wsCloseWithPolicy, broadcast, countWsConnectionsForUser,
│       │                               consumeWsMessageRate, normalizeSymbolsInput, maskUserId,
│       │                               computeQuoteKey, syncClientQuoteKey
│       ├── wsQuotePush.ts        [NEW] applyLiveWsPushFrequencyMs, refreshLiveWsPushFrequencyMs,
│       │                               queueQuoteRowsForBroadcast, flushQueuedQuoteBroadcast,
│       │                               broadcastQuoteRowsUpdate, sendQuoteSnapshot
│       ├── wsQuotePermissions.ts [NEW] refreshWsQuotePermissions, getAllowedSymbols per client
│       ├── wsMessageHandlers.ts  [NEW] onWsMessage() — handles AUTH_HELLO, PING, SUBSCRIBE, etc.
│       ├── wsConnectionHandler.ts [NEW] wss.on("connection", ...) — auth, rate-limit, geo-block logic
│       └── wsLiveEventBridge.ts  [NEW] onLiveEvent subscription → broadcast dispatch (L6194–L6271)
│
├── lib/
│   └── priceUtils.ts             [NEW] getPrecision, toTicks, ticksToPrice, priceLessThan, etc.
│                                        (currently defined at routes.ts L137–171)
│
├── utils/
│   └── [EXISTING utils— no change]
│
└── registerRoutes.ts             [MODIFIED — becomes thin orchestrator, ~100 lines]
    (replaces the body of export async function registerRoutes in routes.ts)
```

---

## Exact File-by-File Breakdown

### 1. `server/lib/priceUtils.ts` [NEW]

**Move from:** `routes.ts:L137–171`  
**Contains:** `getPrecision`, `toTicks`, `ticksToPrice`, `priceLessThan`, `priceGreaterThan`, `priceLessThanOrEqual`, `priceGreaterThanOrEqual`, `normalizeLanguagePreference`, `toUnixMs`  
**Export style:** Named exports, pure functions, zero dependencies — safest to extract first.

> [!NOTE]
> `normalizeLanguagePreference` (L173) references `getI18nConfig()` — import from `./i18n/config`.

---

### 2. `server/utils/computeEmailGracePeriod.ts` [NEW]

**Move from:** `routes.ts:L244–256`  
**Contains:** `computeEmailGracePeriod(createdAt, emailVerified): { inGracePeriod, gracePeriodEndsAt }`  
Uses `toUnixMs` — import from `priceUtils.ts` or move `toUnixMs` here.

---

### 3. `server/context/routerContext.ts` [NEW]

Defines `RouterContext`, `WsState`, `AppMiddleware` as TypeScript interfaces. No runtime logic.

---

### 4. `server/context/buildMiddleware.ts` [NEW]

**Extracts from routes.ts:** `ensureAuth` (L373–381), `ensureDoc1TermsAccepted` (L384–423)  
**Signature:** `export function buildMiddleware(ctx: RouterContext): AppMiddleware`  
Both middleware functions reference `ensureRequestAuthenticated`, `computeDoc1ReacceptStatus`, `upsertDoc1ReacceptRequirement` — all are already named imports, so they can be imported at module level.

---

### 5. `server/routes/ws/wsContext.ts` [NEW]

Defines `WsState` and process-level Prometheus counter variables. Exports a `createWsState(): WsState` factory and exposes the counter increments.

```typescript
export interface WsState { ... }
export function createWsState(): WsState { ... }
// Prometheus counters (exported for wsHelpers and wsConnectionHandler to increment)
export let metricWsOriginRejectedTotal = 0;
export function incWsOriginRejected() { metricWsOriginRejectedTotal++; }
// ... etc
```

---

### 6. `server/routes/ws/wsHelpers.ts` [NEW]

**Move from:** `routes.ts:L5488–5697`  
All WS utility functions. Takes `WsContext` parameter (subset: sessionStore, SESSION_SECRET, SESSION_COOKIE_NAME, wss, wsState).

```typescript
export interface WsHelperDeps {
  sessionStore: Store;
  sessionCookieName: string;
  sessionSecret: string;
  wss: WebSocketServer;
  wsState: WsState;
  wsUserConnectionLimit: number;
  wsMessageRateLimitPerWindow: number;
  wsMessageRateWindowMs: number;
  wsOriginValidationEnabled: boolean;
  wsAllowMissingOrigin: boolean;
  wsAllowedOrigins: Set<string>;
}
export function buildWsHelpers(deps: WsHelperDeps) { ... }
```

Returns: `{ normalizeWsOrigin, getWsSession, destroyCookieSession, wsSendJson, broadcast, wsCloseUnauthorized, wsCloseWithPolicy, countWsConnectionsForUser, consumeWsMessageRate, computeQuoteKey, syncClientQuoteKey, sendQuoteSnapshot, normalizeSymbolsInput, maskUserId, isWsOriginAllowed, isWsRequestTransportSecure, isWsRequestAndSocketCompatible }`.

---

### 7. `server/routes/ws/wsQuotePush.ts` [NEW]

**Move from:** `routes.ts:L5433–5467, L6098–6175`  
Manages batched quote push logic. Takes `WsState` + `broadcast` fn as deps.  
Exports: `applyLiveWsPushFrequencyMs`, `refreshLiveWsPushFrequencyMs`, `queueQuoteRowsForBroadcast`, `flushQueuedQuoteBroadcast`, `broadcastQuoteRowsUpdate`.

---

### 8. `server/routes/ws/wsQuotePermissions.ts` [NEW]

**Move from:** ~`L5700–5760`  
Manages per-WS-client allowed-symbol refresh.  
Exports: `refreshWsQuotePermissions(targetUserIds?, wss, metricsCallback)`.

---

### 9. `server/routes/ws/wsMessageHandlers.ts` [NEW]

**Move from:** ~`L5760–6094` — the `wss.on("message", ...)` handler body.  
Handles AUTH_HELLO, PING, QUOTE subscribe/unsubscribe, TRADES subscribe/unsubscribe, ACCOUNT subscribe/unsubscribe.  
Takes a `WsMessageHandlerDeps` that includes all helper fns + wss + sessionStore.

---

### 10. `server/routes/ws/wsConnectionHandler.ts` [NEW]

**Move from:** ~`L5700–5757` — the `wss.on("connection", ...)` handler body.  
Contains: TLS enforcement check, origin validation, cookie session reading, userId resolve, per-user connection limit, jurisdiction evaluation, grift context capture.

---

### 11. `server/routes/ws/wsLiveEventBridge.ts` [NEW]

**Move from:** `routes.ts:L6194–6267` — the `onLiveEvent(...)` block.  
Subscribes to `liveBus` and dispatches to WS clients via `broadcast`.  
Exports: `initWsLiveEventBridge(ctx: WsBridgeDeps): void`

---

### 12. `server/routes/ws/index.ts` [NEW]

Assembly file. Exports:
```typescript
export function initWebSocketServer(
  httpServer: Server,
  ctx: RouterContext
): WebSocketServer
```
Internally: creates `wss`, builds all helper instances, registers `wss.on("connection")`, calls `initWsLiveEventBridge`.

---

### 13. `server/routes/public/` [NEW files]

| File | Routes | Special Notes |
|------|--------|---------------|
| `status.ts` | `GET /api/status` | Trivial |
| `globalSettings.ts` | `GET /api/global-settings` | Move `clampInt`, `parsePresetCards` helpers inline |
| `signupConfig.ts` | `GET /api/auth/signup-config`, `GET /api/auth/waitlist-policy` | Extract `getSignupPublicConfig` as exported async fn |
| `waitlist.ts` | `POST /api/waitlist` | Imports `getSignupPublicConfig` from signupConfig.ts |
| `symbols.ts` | `GET /api/config/symbols` | Move symbol filtering logic |
| `quotes.ts` | `GET /api/quotes/latest`, `GET /api/quotes/:symbol` | Move from routes.ts L5196–5262 |
| `diagnostics.ts` | `GET /api/diagnostics/price-feed` | Dynamic import of quoteFeed — keep as-is |
| `index.ts` | assembler | `export function createPublicRouter(): Router` |

---

### 14. `server/routes/auth/` [NEW files]

| File | Routes | Key Dependencies |
|------|--------|-----------------|
| `login.ts` | `POST /api/auth/login` | rememberMeConfig, botGuard, rateLimit, griftEngine, legal status |
| `register.ts` | `POST /api/auth/register` | getSignupPublicConfig, jurisdiction, captcha, db.transaction(SERIALIZABLE) |
| `logout.ts` | `POST /api/auth/logout` | rememberMe revoke, session destroy |
| `currentUser.ts` | `GET /api/auth/current-user` | maybeRecalcAccountForCurrentUser, buildCurrentUserPayload |
| `devices.ts` | `GET/DELETE /api/auth/devices`, `DELETE /api/auth/devices` | rememberMe token listing/revocation |
| `index.ts` | assembler | `export function createAuthRouter(ctx: RouterContext): Router` |

> [!IMPORTANT]  
> `maybeRecalcAccountForCurrentUser` (and its `CURRENT_USER_RECALC_STATE` Map + cleanup timer) must move to a dedicated module — `server/services/currentUserRecalc.ts`. It cannot live as a closure inside `registerRoutes()`. The cleanup `setInterval` should be started once at module load time, not per `registerRoutes()` call.

---

### 15. `server/services/currentUserRecalc.ts` [NEW]

**Move from:** `routes.ts:L203–298` (constants, CURRENT_USER_RECALC_STATE Map, cleanup timer, `maybeRecalcAccountForCurrentUser`)

```typescript
// Singleton module — initialized once at import time
const RECALC_STATE = new Map<number, {...}>();
const cleanupTimer = setInterval(...); cleanupTimer.unref?.();
export async function maybeRecalcAccountForCurrentUser(userId: number): Promise<void> { ... }
```

No circular deps — imports only `recalcAccount` (already extracted).

---

### 16. `server/routes/profile/` [NEW files]

| File | Routes | Notes |
|------|--------|-------|
| `update.ts` | `POST /api/profile/update` | Complex — handles email, username, phone, language, timezone, avatar; wraps in audit |
| `changePassword.ts` | `POST /api/profile/change-password` | bcrypt compare + hash |
| `deactivate.ts` | `POST /api/profile/account/deactivate` | Soft-delete with audit |
| `deleteAccount.ts` | `POST /api/profile/account/delete` | Hard-delete gate |
| `me.ts` | `GET /api/profile/me` | Full profile read |
| `loginHistory.ts` | `GET /api/profile/login-history` | sessionTrail query |
| `sessions.ts` | `GET/DELETE /api/profile/sessions, /:sessionId` | sessionTrail |
| `preferences.ts` | `GET/PUT /api/profile/preferences` | Reads/writes `allowUserTimezoneEdit` from systemConfig |
| `kyc.ts` | `GET/POST /api/profile/kyc, /kyc/submit` | KYC form + audit |
| `payout.ts` | `GET/PUT /api/profile/payout, /payout/currency` | Payout profile + payment currency |
| `index.ts` | assembler | `export function createProfileRouter(ctx: RouterContext): Router` |

---

### 17. `server/routes/trader/` [NEW files]

| File | Routes | Notes |
|------|--------|-------|
| `trades.ts` | `GET /api/trades`, `/history`, `/open`, `/pending` | Simple storage queries |
| `tradeOpen.ts` | `POST /api/trades` | **~500 lines** — most complex route; includes risk middleware, ensureDoc1TermsAccepted, price precision, margin, audit, grift |
| `tradeClose.ts` | `POST /api/trades/:id/close` | **~400 lines** — includes PnL calc, settlement costs, trade atomic, audit |
| `tradeTargets.ts` | `PATCH /api/trades/:id/targets` | TP/SL update with quote validation |
| `journal.ts` | `GET/POST/PUT/DELETE /api/journal` | Journal CRUD |
| `account.ts` | `GET /api/account/summary` | Account summary |
| `policy.ts` | `GET /api/policy/snapshot` | Policy decision snapshot |
| `leaderboard.ts` | `GET /api/leaderboard` | Reads `leaderboardMode` from systemConfig |
| `index.ts` | assembler | `export function createTraderRouter(ctx: RouterContext): Router` |

> [!IMPORTANT]
> `tradeOpen.ts` and `tradeClose.ts` are the two most critical files. They must undergo a **zero-tolerance move**: copy the entire handler body verbatim, change only the import paths and the middleware signature. Do NOT refactor logic during move.

---

### 18. `server/routes/metrics.ts` [NEW]

**Move from:** `routes.ts:L5313–5392`  
`GET /metrics` Prometheus endpoint. References `wss.clients.size` — receives `wss` via `RouterContext`.

```typescript
export function createMetricsRouter(ctx: RouterContext): Router {
  const router = Router();
  router.get("/metrics", (_req, res) => { ... });
  return router;
}
```

---

### 19. `server/registerRoutes.ts` [MODIFIED — becomes thin orchestrator]

```typescript
export async function registerRoutes(app: Express): Promise<Server> {
  // 1. Session + CSRF setup (~30 lines — unchanged)
  const sessionStore = ...;
  app.use(session(...));
  const csrfProtection = createCsrfProtection(...);
  app.use("/api", impersonationGuard);
  app.use("/api", jurisdictionSessionGuard);
  app.get("/api/csrf", csrfProtection.csrfTokenHandler);
  app.use("/api", csrfProtection.issueCsrfToken, csrfProtection.enforceCsrf);
  app.use("/api/captcha", captchaSliderRouter);

  // 2. Build shared context
  const wsState = createWsState();
  const middleware = buildMiddleware();
  const httpServer = createServer(app);
  const wss = initWebSocketServer(httpServer, { sessionStore, sessionCookieName: SESSION_COOKIE_NAME, sessionSecret: SESSION_SECRET, wsState, middleware });
  const ctx: RouterContext = { sessionStore, sessionCookieName: SESSION_COOKIE_NAME, sessionSecret: SESSION_SECRET, wss, wsState, middleware };

  // 3. Mount all routers (order preserved exactly as today)
  app.use("/api", createPublicRouter());
  app.use("/api/auth", createAuthRouter(ctx));
  app.use("/api/profile", createProfileRouter(ctx));
  app.use("/api", createTraderRouter(ctx));
  app.use(createMetricsRouter(ctx));

  // 4. Mount existing already-extracted routers (unchanged)
  registerAdminRoutes(app);
  registerMarketRoutes(app);
  // ... all 30 existing sub-routes ...

  return httpServer;
}
```

Target size: **~150 lines** (down from 6272).

---

## Middleware Chain Order (Must Be Preserved Exactly)

```
[ALL /api/*]
  1. impersonationGuard          — blocks writes during View As
  2. jurisdictionSessionGuard    — fails closed (503 + session destroy)
  3. csrfProtection.issueCsrfToken + enforceCsrf
  4. [route-specific]
     ├── ensureAuth              — session validity + revocation check
     ├── ensureDoc1TermsAccepted — legal gate (trade routes only)
     ├── requirePolicy(...)      — feature-gate check
     ├── riskMiddleware          — position limits (trade open)
     └── botGuard               — PoW + score check
```

> [!WARNING]
> The order of 1–3 is security-critical. If any extracted router accidentally mounts its own session middleware or CSRF before these, it could bypass global protections. All routers must use `express.Router()` with no top-level middleware — only the orchestrator in `registerRoutes.ts` mounts session/CSRF globally.

---

## Loading Performance Strategy

### Fast Path (Critical at Startup)

| Concern | Strategy |
|---------|----------|
| `SESSION_SECRET` | Read once at module load in `registerRoutes.ts`, validated by `validateEnvVars()` in `index.ts` before `registerRoutes` is called |
| `globalSettings` cache | `getGlobalSettingsCached()` already exists in `services/globalSettings.ts` — all route files should use the cached version, not raw DB queries |
| Session store | `resolveSessionStore()` is already async at startup — no change needed |
| WS server | Initialized once in `initWebSocketServer()`, no per-request overhead |
| `CURRENT_USER_RECALC_STATE` | Module-level singleton in `currentUserRecalc.ts` — initialized once, GC'd automatically via `unref()` timer |
| Import chains | Each router file imports only what it needs — Node.js module cache means no repeated initialization |

### Route Registration Order

Mount in this order (preserved from today, security-first):

1. Session + CSRF global middleware  
2. `GET /api/csrf` (token endpoint, before enforcer)  
3. Public routers (no auth required)  
4. Auth routers (login/register/logout — their own auth handling)  
5. Protected routers (profile, trader) — all use `ensureAuth`  
6. Admin routers (existing — use `requireAdmin`)  
7. WS upgrade handler (attached to httpServer, not Express)  
8. `/metrics` (last — internal use only, add IP restrict middleware)

---

## Admin-Configurable Settings Inventory

> These should all be surfaced in the Admin Dashboard (`/admin/system-config` and `/admin/global-settings`) with appropriate UI controls.

### `systemConfig` Table — 200+ Fields in 20 Categories

#### 🔒 Security & Authentication
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sessionCookieMaxAgeHours` | int | 24 | Session cookie lifetime |
| `sessionIdleTimeoutMinutes` | int | 0 | 0 = disabled |
| `rememberMeEnabled` | bool | true | Enable "Remember Me" |
| `rememberMeMaxAgeDays` | int | 30 | Persistent token TTL |
| `rememberMeMaxDevicesPerUser` | int | 10 | Max concurrent devices |
| `rememberMeReauthAfterAbsenceDays` | int | 7 | Force re-auth after X days idle |
| `rememberMeTokenRotationEnabled` | bool | true | Rotate token on use |
| `rememberMeTheftAutoRevokeAll` | bool | true | Revoke all tokens if theft detected |
| `logoutClearAllDeviceTokens` | bool | false | Logout clears all devices |

#### 🤖 Bot Detection
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `botScoreThreshold` | int | 40 | Score above = bot |
| `botPowEnabled` | bool | true | Enable PoW challenges |
| `botPowEnforceSignup` | bool | true | PoW on signup |
| `botPowEnforceLogin` | bool | false | PoW on login |
| `botPowChallengeScore` | int | 25 | Score that triggers PoW |
| `botPowBaseDifficulty` | int | 14 | PoW base difficulty |
| `botPowMaxDifficulty` | int | 20 | PoW max difficulty |
| `botPowTtlSec` | int | 120 | PoW challenge TTL |
| `botValkeyEnabled` | bool | true | Distributed bot state via Valkey |

#### 🌍 Jurisdiction & Geo
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `jurisdictionRestrictedIso2Csv` | text | `KP,IR,CU,SY` | Comma-separated blocked countries |
| `jurisdictionRestrictedMessage` | text | … | Message shown to blocked users |
| `jurisdictionEnforceByIpGeo` | bool | false | Block by IP geolocation |
| `jurisdictionEnforceBySignupCountry` | bool | true | Block by signup country |
| `jurisdictionBlockSignup` | bool | true | Block signup for restricted |
| `jurisdictionBlockLogin` | bool | true | Block login for restricted |

#### 📝 Signup & Waitlist
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `signupCaptchaEnforce` | bool | true | Require captcha on signup |
| `captchaProvider` | text | `SLIDER` | `SLIDER` / `RECAPTCHA` / `TURNSTILE` |
| `signupPhoneEnforce` | bool | true | Require phone on signup |
| `signupFreeze` | bool | false | Freeze all new signups |
| `signupFreezeMessage` | text | … | Message shown when frozen |
| `signupWaitlistEnabled` | bool | true | Enable waitlist when frozen |
| `signupWaitlistInviteSender` | text | … | Invite email sender address |
| `signupWaitlistInviteSubject` | text | … | Invite email subject |
| `signupWaitlistInviteBodyText` | text | … | Invite email body template |
| `signupWaitlistAutoInviteOnUnfreeze` | bool | false | Auto-send invites when unfrozen |
| `signupWaitlistInviteBatchCap` | int | 200 | Max invites per unfreeze batch |
| `signupWaitlistPolicyVersion` | text | `1` | Waitlist privacy policy version |
| `signupWaitlistPolicyContent` | text | … | Full policy text displayed to user |

#### 🏦 Starting Balance & Trading Defaults
| Field | Table | Default | Description |
|-------|-------|---------|-------------|
| `balance` (in users rowdefault) | `users` | `1000000.00` | Starting balance per new user — **currently hardcoded in routes.ts L1337 as `"1000000.00"`** — must be moved to systemConfig |
| `defaultLeverage` | `globalSettings` | 50 | Default leverage |
| `maxConcurrentLots` | `globalSettings` | 50 | Max concurrent lots |
| `maxTradesPerUser` | `globalSettings` | 10 | Max open trades |
| `maxTradesPerInstrument` | `globalSettings` | 3 | Max open per instrument |
| `minPriceDistancePips` | `globalSettings` | 20 | TP/SL min distance |
| `dailyLossLimitPct` | `globalSettings` | 10 | Daily loss limit % |
| `lifetimeLossLimitPct` | `globalSettings` | 20 | Lifetime loss limit % |
| `minHoldSec` | `globalSettings` | 60 | Minimum trade hold time |
| `autoCloseAfterDays` | `globalSettings` | 4 | Auto-close stale trades |
| `enableAutoClose` | `globalSettings` | true | Enable auto-close |
| `allowWeekendTrading` | `globalSettings` | false | Allow weekend trades |

> [!IMPORTANT]
> **The starting balance `"1000000.00"` is hardcoded at `routes.ts:L1337`**. This must be moved to `systemConfig` as a new field `defaultStartingBalanceUsd` with a default of `1000000`. This is a critical admin-configurable setting (prop-firm white-labels need to customize this).

#### 📊 UI & Performance Tuning
| Field | Default | Description |
|-------|---------|-------------|
| `lotPresetCards` | `[1,5,10,25,50]` | Quick-select lot buttons in order form |
| `lotDropdownMax` | 50 | Max lot value in dropdown |
| `restFallbackPollMs` | 500 | REST poll interval when WS unavailable |
| `wsPushFrequencyMs` | 0 | 0 = push immediately, >0 = batch |
| `quoteFlushIntervalMs` | 50 | Quote flush interval |
| `maxWsReconnectAttempts` | 30 | WS reconnect limit |
| `wsReconnectBaseDelayMs` | 1500 | WS reconnect base delay |
| `prefetchStrategy` | `all` | `all` / `critical` / `none` |
| `pollInstantMs` / `pollFastMs` / ... | various | Adaptive polling tier intervals |
| `flushInstantMs` / `flushFastMs` / ... | various | Adaptive flush tier intervals |

#### 🛡️ Trading Safety Switches
| Field | Default | Description |
|-------|---------|-------------|
| `maintenanceMode` | false | Block all trading |
| `tradingHalt` | false | Emergency halt |
| `closeOnlyMode` | false | Only allow closing positions |
| `blockOpenOnStaleQuotes` | true | Block new opens if quotes stale |
| `maintenanceMessage` | … | Message shown in maintenance |
| `staleThresholdMs` | 30000 | Quote staleness threshold |

#### 📡 Market Data
| Field | Default | Description |
|-------|---------|-------------|
| `marketDataActiveProviderKey` | null | Active market data provider |
| `marketDataFallbackProviderKeysCsv` | `""` | Comma-separated fallback providers |
| `quoteRefreshMs` | 870 | Quote refresh interval |
| `feedPollMs` | 870 | Feed poll interval |
| `fxRolloverTz` | `America/New_York` | FX rollover timezone |
| `fxRolloverTime` | `17:00` | FX rollover time |

#### ⚖️ Legal & Compliance
| Field | Default | Description |
|-------|---------|-------------|
| `legalCoverageEnforce` | false | Block signup if no legal coverage |

#### 👤 User Preferences Policy
| Field | Default | Description |
|-------|---------|-------------|
| `allowUserTimezoneEdit` | true | Allow users to change timezone |

#### 📧 Communications (communicationSettings table)
| Field | Default | Description |
|-------|---------|-------------|
| `messagingEnabled` | true | Enable internal mailbox |
| `messagingAutoWelcomeEnabled` | true | Send welcome message on signup |
| `messagingE2eeEnabled` | false | Enable end-to-end encryption |
| `notificationsEnabled` | true | Enable notification center |
| `notificationRealtimeEnabled` | true | Real-time push notifications |
| `notificationSoundDefaultEnabled` | true | Sound on notifications |
| `notificationTradePendingFillEnabled` | true | Notify on pending fills |
| `notificationTradeTakeProfitEnabled` | true | Notify on TP hit |
| `notificationTradeStopLossEnabled` | true | Notify on SL hit |

#### 📧 Email / SMS Policy
| Field | Default | Description |
|-------|---------|-------------|
| `policyEmailResendCooldownSec` | 60 | Email resend cooldown |
| `policyEmailDailySendCap` | 5 | Max emails per day per user |
| `policySmsDailySendCap` | 5 | Max SMS per day per user |
| `policySmsResendCooldownSec` | 60 | SMS resend cooldown |
| `policyOtpMaxAttempts` | 5 | Max OTP verification attempts |
| `policyOtpLockMinutes` | 30 | OTP lockout duration |

#### 🏆 Challenges & Leaderboard
| Field | Default | Description |
|-------|---------|-------------|
| `leaderboardMode` | `PUBLIC` | `PUBLIC` / `TOP_10` / `DISABLED` |
| `challengeAutoAdvancePhase` | true | Auto-advance challenge phases |
| `challengeDefaultDrawdownType` | `STATIC` | Drawdown calculation method |
| `challengeDefaultCapitalMode` | `VIRTUAL` | Capital mode |
| `challengeDefaultMaxRetries` | 3 | Max challenge retries |
| `challengeRewardsEnabled` | true | Enable reward programs |
| `challengePrizePoolsEnabled` | true | Enable prize pools |
| `challengeBadgesEnabled` | true | Enable badge awards |
| `challengeCertificatesEnabled` | true | Enable certificates |
| `challengeLeaderboardEnabled` | true | Enable challenge leaderboards |
| `challengeWarningThresholdPct` | 0.8 | Warning at 80% of limit |
| `challengeMaxActiveEnrollmentsUser` | 5 | Max simultaneous enrollments |
| `challengeEvalEnabled` | true | Enable automated evaluation |
| `challengeEvalIntervalMin` | 60 | Evaluation frequency (minutes) |

#### 🔬 Scout & Recruitment
| Field | Default | Description |
|-------|---------|-------------|
| `scoutTabEnabled` | true | Show scout tab in admin |
| `scoutMinSharpeAlert` | 2.0 | Alert threshold for Sharpe ratio |
| `partnerPortalEnabled` | false | Enable partner portal |
| `traderProProfilesEnabled` | false | Enable Pro trader profiles |
| `traderCompeteEnabled` | false | Enable competitive mode |
| `partnerAllocationsEnabled` | false | Enable vSMA allocations |
| `partnerGatingConfig` | JSON | Per-gate access requirements |
| `partnerPasswordRotationDays` | 90 | Partner password rotation policy |
| `partnerInviteDefaultExpiryDays` | 7 | Partner invite expiry |

#### 🌐 i18n
| Field | Default | Description |
|-------|---------|-------------|
| `i18nEnabled` | true | Enable multi-language UI |
| `i18nDefaultLocale` | `en` | Default locale |
| `i18nSupportedLocalesCsv` | `en,fr,pt,...` | Supported locales |
| `i18nAutoTranslate` | true | Auto-translate new keys |
| `i18nLlmEnabled` | true | Use LLM for translations |
| `i18nLlmProvider` | `openai` | LLM provider |
| `i18nLlmModel` | `gpt-4o-mini` | LLM model |

#### 🔄 Activity & Account Lifecycle
| Field | Default | Description |
|-------|---------|-------------|
| `inactivityThresholdDays` | 90 | Days before account flagged inactive |
| `deletionGraceDays` | 30 | Grace period after flag before soft-delete |
| `activityAutoQueueInactive` | true | Auto-queue inactive accounts |
| `activityAutoSoftDelete` | false | Auto-delete (off by default — manual review) |

#### 📊 Policy Contender Thresholds
| Field | Default | Description |
|-------|---------|-------------|
| `policyContenderPath1MinAgeDays` | 30 | Min account age for Path 1 |
| `policyContenderPath1MinTradesLifetime` | 30 | Min lifetime trades |
| `policyContenderPath1MinBalancePct` | 1.2 | Min balance % for Path 1 |
| `policyAutoPromotePerformer` | true | Auto-promote eligible traders |

---

## Critical Discovery: Hardcoded Starting Balance

> [!CAUTION]
> **`routes.ts:L1337` has `balance: "1000000.00"` hardcoded in user creation.** This is a critical omission — it means every new user always gets exactly $1,000,000 regardless of any admin configuration. For a prop-firm platform this is commercially critical.
>
> **Recommended fix as part of decomposition:** Add `defaultStartingBalanceUsd: decimal("default_starting_balance_usd", { precision: 20, scale: 2 }).notNull().default("1000000.00")` to `systemConfig`, and read it in `register.ts` during user creation.

---

## Migration Strategy: Zero-Regression Move

> [!IMPORTANT]
> Every function must be **copied verbatim** before any refactoring. The decomposition is a **move**, not a refactor. Logic changes, performance optimizations, and type improvements are out of scope here.

### Phase Order (Critical to Non-Critical)

```
Phase 1 — Pure utilities (zero risk, easy validation)
  → server/lib/priceUtils.ts
  → server/utils/computeEmailGracePeriod.ts
  → server/services/currentUserRecalc.ts

Phase 2 — Shared context + middleware factories
  → server/context/routerContext.ts
  → server/context/buildMiddleware.ts

Phase 3 — WebSocket server (highest complexity, isolated impact)
  → server/routes/ws/* (7 files)
  Test: WS connection test, quote subscription, trade event

Phase 4 — Public routes (no auth, easiest to validate)
  → server/routes/public/* (7 files)
  Test: curl each endpoint, check response shape

Phase 5 — Auth routes (high security, zero tolerance for error)
  → server/routes/auth/* (5 files + index)
  Test: full login/logout/register flow, remember-me, devices

Phase 6 — Profile routes (medium complexity)
  → server/routes/profile/* (10 files + index)
  Test: profile CRUD, preferences, KYC, payout

Phase 7 — Trade routes (highest business risk)
  → server/routes/trader/* (8 files + index)
  Test: open/close/history, journal CRUD, account summary

Phase 8 — Cleanup
  → Replace routes.ts body with thin orchestrator
  → Remove @ts-nocheck
  → Run tsc --noEmit
```

### Zero-Regression Validation Protocol

For each phase:
1. **Before:** snapshot all affected endpoint responses with `curl` + store as fixture
2. **After:** compare new responses against fixtures (keys, status codes, error codes)
3. Run `tsc --noEmit` — must be zero errors after @ts-nocheck removal
4. Run existing test suite: `npm test` in `/server` and `/client`
5. **Manual smoke test:** login → trade open → trade close → logout cycle

---

## Security Preservation Checklist

Every extracted route file must be audited against this checklist:

- [ ] `ensureAuth` applied to all protected routes
- [ ] `ensureDoc1TermsAccepted` applied to all 4 trade routes (tradeOpen, tradeClose, tradeTargets, and any pending order routes)
- [ ] `requirePolicy(...)` copied exactly as in original
- [ ] `botGuard` called on login, signup, and all trade actions
- [ ] No cross-route state leakage (no module-level mutable user state)
- [ ] All DB queries use parameterized Drizzle ORM (no raw SQL string interpolation)
- [ ] Error responses use uniform codes (no new error codes not in original)
- [ ] Session writes use `req.session.save()` where needed (do not rely on auto-save)
- [ ] `@ts-nocheck` not added to any new file
- [ ] All new Zod schemas match original validation exactly

---

## WebSocket Security Preservation

The WS server has multiple security layers that must be preserved exactly:

| Layer | Implemented In | Must Preserve |
|-------|---------------|---------------|
| TLS enforcement | `wsConnectionHandler.ts` | `wsTransportTlsRequired` env check |
| Origin validation | `wsHelpers.ts` | `isWsOriginAllowed()` + `wsAllowedOrigins` set |
| Per-user connection limit | `wsHelpers.ts` | `countWsConnectionsForUser()` + `wsUserConnectionLimit` |
| Message rate limiting | `wsHelpers.ts` | `consumeWsMessageRate()` sliding window |
| Session validation | `wsConnectionHandler.ts` | Cookie parse + sessionStore.get() |
| Jurisdiction blocking | `wsConnectionHandler.ts` | `evaluateLoginJurisdiction()` + session destroy |
| Prometheus counters | `wsContext.ts` | All 6 metric counters |

---

## Verification Plan

### Automated Tests (Existing)
- `npm test` — runs all existing tests in the monorepo
- `npx tsc --noEmit --project server/tsconfig.json` — must pass with 0 errors after `@ts-nocheck` removal

### Per-Phase Smoke Tests (Manual, using curl or browser)

```bash
# Phase 4 — Public routes
curl http://localhost:5000/api/status          # → {"message":"TradeQuip API"}
curl http://localhost:5000/api/global-settings # → JSON with lotDropdownMax etc.
curl http://localhost:5000/api/auth/signup-config  # → captcha + phone fields
curl http://localhost:5000/api/quotes/latest   # → array of quotes

# Phase 5 — Auth routes
POST /api/auth/login  (valid creds)   → 200 + user object + session cookie
POST /api/auth/login  (bad creds)     → 401 Invalid credentials
POST /api/auth/login  (rate-limited)  → 429 LOGIN_RATE_LIMITED
GET  /api/auth/current-user           → 200 + user object
POST /api/auth/logout                 → 200 + session cleared

# Phase 7 — Trade routes
GET  /api/trades/open   → 200 + array
POST /api/trades (legal blocked) → 409 LEGAL_REACCEPT_REQUIRED
POST /api/trades/:id/close → 200 + updated trade

# WS Phase
wscat -c ws://localhost:5000/ws
→ Send: {"type":"auth:hello"}
→ Expect: {"type":"auth:ok",...}
→ Send: {"type":"quotes:subscribe","symbols":["EURUSD"]}
→ Expect: quote snapshot within 5s
```

### Regression Sentinel

Before starting Phase 1, save the current route map:
```bash
grep -n 'app\.\(get\|post\|put\|patch\|delete\)(' server/routes.ts > /tmp/routes_before.txt
```
After completing all phases, verify the final `registerRoutes.ts` produces the same map.

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| `routes.ts` size | 6272 lines | ~150 lines |
| `@ts-nocheck` | Yes (regression) | Removed |
| Shared helpers | Closure-bound | Imported modules |
| WS server | Monolithic closure | 7 files + WsContext |
| Route files | 30 | 30 + ~35 new |
| Admin-configurable fields surfaced | ~120 (partially) | **200+** (complete) |
| Starting balance | Hardcoded `$1M` | Admin-configurable |
| Type safety | @ts-nocheck bypass | Full TypeScript strict |
