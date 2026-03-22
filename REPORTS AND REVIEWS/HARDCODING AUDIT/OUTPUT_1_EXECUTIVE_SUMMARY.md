# Output 1 - Executive Summary

Audit status: deep repo-grounded pass completed on 2026-03-16.

Coverage:
- Guidance read first: `AGENTS.md`, `PROJECT_STRUCTURE.md`, `.agents/audit-decomposition.md`, `.agents/deep-context.md`.
- Live code traced across `server/`, `client/`, `shared/`, `db/`, `config/`, `MOBILE/`, `NATIVE/`, `WEBSITE/`, `k8s/`, `ops/`, `petascale/`, and selected prior reports under `REPORTS AND REVIEWS/`.
- Findings are grouped by effective control surface. Repeated literals that implement the same behavior are catalogued as one finding and cross-referenced to all duplicates.

## Total findings

- Total findings: 44
- Verified date: 2026-03-16
- Audit coverage notes:
  - The heaviest drift is between `shared/schema.pg.base.ts` defaults, route-level fallback objects, service-level cache fallback logic, and client/mobile copies.
  - The highest-risk ambiguity is around `system_config` ownership and market-data provider precedence.
  - The cleanest existing runtime-config surfaces are `quote_subscription_config`, `communication_settings`, and most of `global_settings` performance propagation.

## Count by class

| Class | Count | Notes |
| --- | --- | --- |
| Class 1 - Admin Runtime Config | 7 | Already valuable and mostly runtime-safe: remember-me business fields, signup/waitlist, bot coarse thresholds, quote subscriptions, communications, global performance, grift DB config |
| Class 2 - Admin Config Requiring Controlled Reload | 4 | Feed cadence/staleness, provider file config, auto-close schedule, challenge scheduler cadence |
| Class 3 - Environment / Deployment Config | 11 | Cookie transport flags, provider env fallback toggles, mobile host/build values, k8s/HPA/alerts, petascale deploy knobs |
| Class 4 - Secrets / Sensitive Material | 3 | Captcha secrets, petascale credentials, mobile signing material |
| Class 5 - Code-Level Invariants | 1 | Base React Query retry/staleness policy should remain code-owned |
| Class 6 - Data-Modeled Rules | 2 | Bot scoring heuristics and trading risk rule cluster belong in typed policy models |
| Class 7 - Dead / Legacy / Duplicate / Drifted Config | 16 | Largest bucket: dead fields, fallback duplication, route drift, mobile/web copies, docs drift |

## Count by domain

| Domain | Count | Notes |
| --- | --- | --- |
| Server and API runtime | 10 | `system_config`, remember-me, signup, captcha, bot guard, quote subscriptions, communications |
| Client web | 4 | Query defaults, `QuotesProvider`, page polling sprawl, perf duplicate defaults |
| Shared contracts | 3 | `global_settings` and performance/risk schema defaults acting as hidden config plane |
| Database and migrations | 1 | Singleton bootstrap/seed drift around `system_config` row creation |
| Market data and provider routing | 5 | Provider precedence, provider file config, feed cadence/staleness, dead `quoteRefreshMs` |
| Trading, risk, compliance, grift | 8 | Risk rules, duplicated enforcement fallbacks, auto-close, challenges, grift propagation |
| Mobile, native, website | 7 | Native host/runtime drift, wrapper host/deeplink copies, website URLs, checked-in signing material |
| Infra, ops, petascale, gitops | 5 | ConfigMap deploy values, probes/HPA, alerts, secret boundary, insecure-transport exception |
| Reports/docs drift | 1 | Prior audit docs partially stale against current code |

## Top 25 highest-risk hardcoded items

| Rank | Finding ID | Setting | Domain | Why high risk | Current source of truth | Recommended target |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | HC-043 | Mobile signing material in repo | Mobile/native/website | Secret leakage and irreversible signing compromise if exposed | Repo files under `MOBILE/android/` | Secret-managed signing pipeline outside git |
| 2 | HC-012 | Provider routing precedence ambiguity | Market data | Can silently choose wrong quote provider in prod | Mixed DB active key; code default `twelvedata`; optional env fallback | Single precedence model with visible effective provider |
| 3 | HC-001 | `system_config` route default drift | Server/API | Admin can read one default set while schema and services enforce another | `server/routes/admin.ts`; `server/routes/adminSystemConfig.ts`; schema defaults | Central default resolver service |
| 4 | HC-011 | Singleton `system_config` bootstrap duplication | Database/migrations | Unrelated modules seed market-data defaults and mask ownership | `db/seed.ts`; `server/i18n/config.ts`; `server/partner/inquiryRouting.ts`; `server/routes/adminScout/candidates.ts` | One bootstrap path only |
| 5 | HC-020 | Risk fallback duplication across server paths | Trading/risk | Trade correctness can diverge by entrypoint | `server/risk.ts`; `server/engine/orderEngine.ts`; `server/routes/trader/tradeOpen.ts` | Shared risk policy resolver |
| 6 | HC-005 | Captcha provider silent downgrade | Server/API | Admin may think TURNSTILE/HCAPTCHA is active while runtime uses slider | `server/security/captcha.ts` | Effective-value inspector and explicit degraded state |
| 7 | HC-027 | Grift config propagation gap | Trading/grift | Multi-node deployments keep stale abuse thresholds until TTL expiry | `server/routes/grift-admin/ops.ts`; `server/grift/griftEngine.ts` | Live-bus invalidation and versioned config |
| 8 | HC-016 | `quoteRefreshMs` surfaced but unused | Market data | Operators can change a dead field and assume quote timing changed | `system_config`; admin UI | Remove or map to real consumer |
| 9 | HC-024 | `challengeEvaluationIntervalSec` shadow field | Trading/challenges | Scheduler ignores surfaced value; UI gives false confidence | Scout challenge admin UI/API plus DB field | Remove or wire the scheduler to one canonical interval |
| 10 | HC-032 | Native host/deep-link constants | Mobile/native/website | Deploy cutovers require rebuilds and drift from web/wrapper | `NATIVE/src/services/runtimeConfig.ts` | Build/deploy config mirror and runtime inspector |
| 11 | HC-041 | Petascale credentials boundary | Infra/ops/petascale | Object storage and ClickHouse access are high-value secrets | Env vars consumed by `server/services/petascaleEnv.ts` | Secret store with restricted rotation workflow |
| 12 | HC-042 | Insecure internal transport exception | Infra/ops/petascale | Allows plaintext internal storage/analytics traffic in production | `ALLOW_INSECURE_INTERNAL_TRANSPORT` | Overlay-specific deploy control with expiry/runbook |
| 13 | HC-015 | Feed cadence and staleness controls | Market data | Bad values can stale quotes or overload providers | `system_config`; `quoteFeed.ts` | Controlled-reload domain with bounds and propagation status |
| 14 | HC-021 | Auto-close schedule | Trading/risk | Bad timing changes can close or miss positions platform-wide | `global_settings`; `autoClose.ts` | Controlled-reload domain with bounded edits |
| 15 | HC-017 | Trading risk rule cluster | Shared/contracts | Core leverage/position/loss rules govern money correctness | `global_settings` defaults in shared schema | Versioned trading policy model |
| 16 | HC-033 | Native WS reconnect drift | Mobile/native/website | Mobile recovery behavior diverges from web runtime assumptions | `NATIVE/src/services/websocket.ts` | Surface-mirrored client transport config |
| 17 | HC-035 | Wrapper/web deep-link host duplication | Mobile/native/website | Deep-link routing breaks on hostname changes or multi-env cutovers | `MOBILE/.../deep-linking.ts`; `client/.../MobileWrapperBridge.tsx` | Shared canonical surface config |
| 18 | HC-029 | `QuotesProvider` refresh windows | Client web | Missed WS events can leave stale permission state or overpoll | `client/src/live/QuotesProvider.tsx` | Central client runtime interval layer |
| 19 | HC-031 | Client perf default duplication | Client web | Same transport knobs drift across admin; client; shared payload | `client/src/lib/perfHints.ts`; admin support pages | One canonical performance resolver |
| 20 | HC-008 | Bot scoring windows | Server/API | Anti-abuse severity can drift silently and is hard to review | `server/security/botGuard.ts` | Versioned abuse policy model |
| 21 | HC-023 | Challenge scheduler runtime knobs | Trading/challenges | Changes are not immediately visible or audited as scheduler state | `evaluateChallenges.ts`; scout admin routes | Controlled-reload config with wake-up event |
| 22 | HC-013 | Provider per-file timeout/batch/rate-limit config | Market data | Wrong values can starve feeds or break provider quotas | `config/marketdata/providers/*.json` | Controlled-reload provider config domain |
| 23 | HC-039 | Deployment/HPA thresholds | Infra/ops | Wrong probes or autoscaling thresholds destabilize the API tier | `k8s/10-api-deployment.yaml`; `k8s/40-hpa.yaml` | Deploy-owned GitOps values |
| 24 | HC-040 | Alert thresholds | Infra/ops | Under/over-sensitive alerting hides outages or burns operators | `ops/prometheus-config/tradehub-alerts.yml` | Deploy-owned observability config |
| 25 | HC-044 | Prior audit doc drift | Reports/docs drift | Engineers can follow stale recommendations and miss current gaps | Prior reports vs live tree | Refresh docs after each config refactor |

## Top 25 highest-value admin-config candidates

| Rank | Finding ID | Setting | Domain | Why high value | Runtime-safe? | Recommended admin home |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | HC-018 | `restFallbackPollMs` plus tier poll/flush envelope | Shared/client | Direct control over quote freshness vs bandwidth | Yes | `System And Runtime > Client Runtime` |
| 2 | HC-018 | `wsPushFrequencyMs` | Shared/client | Lets ops tune WS fanout pressure without redeploy | Yes | `System And Runtime > Client Runtime` |
| 3 | HC-015 | `feedPollMs` | Market data | Primary upstream polling knob | Partial | `Market Data > Feed Cadence` |
| 4 | HC-015 | `staleThresholdMs` | Market data | Determines stale-quote gating across trading surfaces | Partial | `Market Data > Feed Cadence` |
| 5 | HC-015 | `fxRolloverTz` and `fxRolloverTime` | Market data | Operationally changes rollover behavior without code edits | Partial | `Market Data > Feed Cadence` |
| 6 | HC-021 | `autoCloseAfterDays` | Trading/risk | Strong ops value for hold-duration policy | Partial | `Trading And Risk > Auto-Close` |
| 7 | HC-021 | `autoCloseCheckFrequencyMinutes` | Trading/risk | Directly controls scheduler cadence and load | Partial | `Trading And Risk > Auto-Close` |
| 8 | HC-023 | `challengeEvalIntervalMin` | Challenges | Needed to control batch cadence after launch | Partial | `Recruitment And Challenges > Scheduler` |
| 9 | HC-023 | `challengeEvalMaxRows` | Challenges | Controls batch size and operational backlog clearance | Partial | `Recruitment And Challenges > Scheduler` |
| 10 | HC-025 | Grift tier thresholds | Grift | Core abuse sensitivity control for review teams | Yes after live invalidation | `Identity And Abuse > Grift` |
| 11 | HC-025 | Grift enforcement freeze/disable thresholds | Grift | High ops value when tuning enforcement posture | Yes after live invalidation | `Identity And Abuse > Grift` |
| 12 | HC-009 | Global quote-mode enablement | Server/API | Clean runtime control already wired | Yes | `Market Data > Quote Subscriptions` |
| 13 | HC-009 | Default quote mode | Server/API | Changes baseline symbol universe experience platform-wide | Yes | `Market Data > Quote Subscriptions` |
| 14 | HC-010 | Messaging target threshold | Server/API | Needed to keep mailbox fanout stable under growth | Yes | `Communications > Delivery Controls` |
| 15 | HC-010 | Async fanout threshold and batch size | Server/API | High operational value for queue pressure | Yes | `Communications > Delivery Controls` |
| 16 | HC-002 | `rememberMeMaxAgeDays` | Server/API | Product/security tradeoff shifts after launch | Yes | `Identity And Session > Remember Me` |
| 17 | HC-002 | `rememberMeMaxDevicesPerUser` | Server/API | Useful fraud and support control | Yes | `Identity And Session > Remember Me` |
| 18 | HC-004 | Signup freeze and waitlist toggles | Server/API | Already valuable for capacity and compliance events | Yes | `Identity And Session > Signup Gates` |
| 19 | HC-004 | Waitlist invite batch cap | Server/API | Ops needs to meter invite release | Yes | `Identity And Session > Signup Gates` |
| 20 | HC-007 | `botScoreThreshold` | Server/API | Coarse anti-bot sensitivity belongs in restricted admin | Yes | `Identity And Abuse > Bot Guard` |
| 21 | HC-007 | PoW difficulty and TTL | Server/API | Useful during attack or false-positive periods | Yes | `Identity And Abuse > Bot Guard` |
| 22 | HC-017 | Position/leverage/trade-count limits | Shared/trading | High business value but requires restricted workflow | Partial | `Trading And Risk > Limits` |
| 23 | HC-017 | `minPriceDistancePips` and market hours | Shared/trading | Directly affects order acceptance and market gating | Partial | `Trading And Risk > Order Guards` |
| 24 | HC-013 | Provider timeout and rate-limit envelope | Market data | Valuable once reload semantics are explicit | No immediate runtime | `Market Data > Providers` |
| 25 | HC-012 | Active provider and fallback list after precedence cleanup | Market data | High operator value during provider outages | Controlled reload | `Market Data > Providers` |

## Most dangerous propagation gaps

| Finding ID | Gap | Affected surfaces | Failure mode | Required fix |
| --- | --- | --- | --- | --- |
| HC-027 | Grift config updates only invalidate the local process cache | Admin node; worker/API peers | Different nodes enforce different abuse thresholds for up to TTL | Publish `grift:config-updated` on live bus and re-read config on receipt |
| HC-005 | Captcha provider silently falls back to `SLIDER` when secret missing | Admin UI; signup API; operators | Effective security posture is weaker than configured posture | Show configured value; effective value; secret presence; and degraded status |
| HC-012 | Provider manager falls back through DB; code default; optional env keys | Feed ingestor; admin; startup sync | Wrong provider may become active without visible operator intent | Eliminate legacy env fallback in prod and make candidate order explicit |
| HC-023 | Challenge scheduler has no live wake-up event | Scout admin; cron worker | Interval changes wait until the old timer fires | Publish `challenges:config-updated` and reschedule on receipt |
| HC-032 | Native host/deep-link values are build constants with no shared inspector | Native app; wrapper; website; support | Deploy cutover leaves surfaces pointing at different origins | Centralize surface config and expose read-only effective values |
| HC-011 | Unrelated modules insert singleton `system_config` row with market-data defaults | i18n; partner routing; scout admin; seed path | Ownership is ambiguous and missing-row behavior is hidden | Replace ad hoc inserts with one bootstrap service |
| HC-019 | Global performance defaults are duplicated in schema; server payload; client perf resolver; admin helpers | Web; admin; `/ws`; quote polling | Admin edits propagate partly while duplicated literals remain stale | Generate one canonical resolver used by server and client |

## Quick wins vs deeper refactors

### Quick wins

| Finding ID | Action | Why low effort | Expected risk reduction |
| --- | --- | --- | --- |
| HC-016 | Remove or hard-deprecate `quoteRefreshMs` from admin API and UI | No verified runtime consumer exists | Removes a false control and operator confusion |
| HC-024 | Remove or repurpose `challengeEvaluationIntervalSec` | Scheduler already uses `challengeEvalIntervalMin` and `challengeEvalMaxRows` | Removes shadow config and bad assumptions |
| HC-011 | Add one shared `ensureSystemConfigRow()` service and stop route/module-specific inserts | Existing duplication is localized | Clarifies singleton ownership quickly |
| HC-027 | Publish live-bus invalidation on grift config update | Route already invalidates local cache | Eliminates multi-node abuse-policy drift |
| HC-005 | Expose effective captcha provider and secret-health in admin | Validation logic already exists | Prevents silent security downgrade |
| HC-035 | Move canonical host and scheme into one shared client/mobile surface module | Copies are easy to trace | Reduces deploy drift across wrapper and web |
| HC-031 | Make client perf helpers resolve from `/api/global-settings` only | Existing payload already contains most knobs | Shrinks duplicated defaults quickly |

### Deeper architectural refactors

| Theme | Why it is deeper | Dependency chain | Expected payoff |
| --- | --- | --- | --- |
| Central runtime-config registry | Requires standardizing default resolution; validation; cache invalidation; and audit metadata across tables | `system_config`; `global_settings`; `communication_settings`; `grift_config`; admin routes; client config consumers | One explicit control plane instead of route-level ad hoc config |
| Market-data governance cleanup | Provider files; DB records; env fallback; startup sync; feed reload all currently interact | `config/marketdata`; `providerManager.ts`; admin provider routes; `quoteFeed.ts`; `server/index.ts` | Deterministic provider selection and safer outage handling |
| Trading-risk policy extraction | Risk rules are scattered through middleware; order engine; trade routes; and challenge overlays | `global_settings`; `risk.ts`; `orderEngine.ts`; `tradeOpen.ts`; shared policy helpers | Prevents money-flow drift and makes change review safer |
| Multi-surface runtime mirror | Web; wrapper; native; and website all own overlapping host/deep-link/runtime values | `client/`; `MOBILE/`; `NATIVE/`; `WEBSITE/`; build env | Eliminates cross-surface deploy drift and support confusion |
