# Repo Entrypoints And Prior Leads

## 1. Canonical config stores and defaults

| Area | Exact files | Why they matter |
| --- | --- | --- |
| Global/system settings schema | `shared/schema.pg.base.ts` | Defines `global_settings`, `system_config`, `communication_settings`, schema defaults, and many platform-wide config candidates. |
| Recruitment/challenge/provider schema | `shared/schema.pg.recruitment.ts` | Defines challenge, partner, market-data-provider, and related default-heavy tables. |
| SQL truth dump | `db/schema.pg.sql` | Good for checking generated DB defaults and constraints after migrations. |
| Migrations | `db/migrations/*` | Reveals seeded defaults, new config fields, and historical intent. |
| Seed logic | `db/seed.ts` | Reveals dev/demo defaults and environment-gated fallback behavior. |

## 2. Admin and backend config write/read paths

| Domain | Exact files | Notes |
| --- | --- | --- |
| Global settings admin write path | `server/routes/admin.ts`, `server/services/globalSettingsAdmin.ts` | Contains validation bounds, clamps, defaults, and admin update behavior. |
| System config routes | `server/routes/adminSystemConfig.ts`, `server/routes/admin.ts` | Mix of dedicated routes and broad system-config payload handling. |
| Public signup/system read model | `server/services/signupPublicConfig.ts`, `server/routes/publicCore.ts` | Good place to detect DB config vs public fallback drift. |
| Quote subscriptions config | `server/services/quoteSubscriptions.ts`, `server/routes/adminQuoteSubscriptions.ts`, `server/routes/quoteSubscriptions.ts` | Has its own config store, cache TTL, and live invalidation behavior. |
| I18n config | `server/i18n/config.ts`, `server/routes/adminI18n.ts`, `server/i18n/service.ts` | DB-backed config with fallback defaults and cache refresh path. |
| Messaging settings | `server/services/messagingSettings.ts`, `server/services/messaging.ts`, `server/routes/mailbox.ts` | Needed to separate comms runtime config from code invariants. |
| Challenge/recruitment config | `server/recruitment/challengesV4/challengeConfig.ts`, `server/routes/adminScout*.ts`, `server/routes/traderTalent.ts` | Heavy concentration of policy-like defaults and caches. |
| Market data admin | `server/routes/adminMarketData.ts`, `server/marketdata/providerConfigFiles.ts`, `server/marketdata/providerManager.ts` | Needed for file/DB/code precedence and reload behavior. |

## 3. Runtime propagation and cache invalidation

| Layer | Exact files | Notes |
| --- | --- | --- |
| Event bus | `server/services/liveBus.ts` | Defines live invalidation mechanics and throttling behavior. |
| Web client config sync | `client/src/live/ConfigSync.tsx` | Canonical place to verify which live events actually refresh client state. |
| Websocket protocol | `shared/ws/protocol.ts`, `server/routes.ts`, `client/src/live/*`, `NATIVE/src/services/websocket.ts` | Needed for protocol invariants vs dynamic settings. |
| Global settings cache | `server/services/globalSettings.ts` | Caching and fallback behavior for risk/performance settings. |
| Quote subscription caches | `server/services/quoteSubscriptions.ts` | Cache TTL and event-driven invalidation. |
| Challenge config cache | `server/recruitment/challengesV4/challengeConfig.ts` | Short-lived cache that may hide stale-write issues. |
| I18n config cache | `server/i18n/config.ts` | Cached defaults and DB refresh path. |

## 4. Surface-specific runtime config

| Surface | Exact files | Notes |
| --- | --- | --- |
| Web client | `client/src/lib/queryClient.ts`, `client/src/lib/globalSettingsPerformance.ts`, `client/src/lib/wsUrl.ts`, `client/src/lib/perfHints.ts`, `client/src/lib/routePrefetch.ts` | Query defaults, performance tuning, and WS endpoint behavior. |
| Capacitor wrapper | `MOBILE/capacitor.config.ts`, `MOBILE/src/mobile/utils/csrf.ts`, `MOBILE/src/mobile/utils/session-manager.ts`, `client/src/components/MobileWrapperBridge.tsx` | Remote URL mode, host overrides, bridge/runtime drift. |
| React Native | `NATIVE/src/services/runtimeConfig.ts`, `NATIVE/src/services/api.ts`, `NATIVE/src/services/csrf.ts`, `NATIVE/src/services/websocket.ts` | Hardcoded production/dev hosts, deep-link prefixes, push environment. |
| Public website | `WEBSITE/client/src/lib/app-config.ts`, `WEBSITE/server/routes.ts`, `WEBSITE/server/index.ts` | Separate origin assumptions and marketing-site config copies. |

## 5. Deployment and ops config surfaces

| Area | Exact files | Notes |
| --- | --- | --- |
| K8s runtime | `k8s/01-configmap.yaml`, `k8s/02-secrets.yaml`, `k8s/10-api-deployment.yaml`, `k8s/11-ingestor-deployment.yaml`, `k8s/12-worker-deployment.yaml`, `k8s/40-hpa.yaml`, `k8s/60-monitoring.yaml`, `k8s/70-petascale-infra.yaml` | Service-level env, probe timing, autoscaling, retention, infra locators. |
| Kustomize/base | `k8s/base/*`, `k8s/kustomization.yaml` | Needed to catch duplicated or diverged manifest values. |
| GitOps | `gitops/argocd/*` | Source of truth for deployment state and overlay wiring. |
| Petascale | `petascale/*`, `server/services/petascaleEnv.ts`, `server/services/clickhouseClient.ts`, `server/services/clickhouseSync.ts` | Queue, ClickHouse, and export-related env/deploy config. |
| Local infra | `docker-compose.infra.yml` | Dev defaults that may leak into runtime assumptions. |

## 6. High-value report leads to verify against live code

| Prior report | Why it matters | Expected drift checks |
| --- | --- | --- |
| `REPORTS AND REVIEWS/audit_report.md` | Provider/category hardcoding findings | Are category mappings still duplicated across backend and UI? |
| `REPORTS AND REVIEWS/quotes provider config/PROVIDER_CONFIG_SYSTEM_BREAKDOWN.md` | File-driven provider config workflow | Is DB/file precedence still clean and complete? |
| `REPORTS AND REVIEWS/4G-3G-5G-2G OPTIMIZATIONS/audit_2_bug_report.md` | Admin perf config propagation | Are client hooks still honoring admin-configured performance values? |
| `REPORTS AND REVIEWS/KEEP ME SIGNED IN/product_requirements_document.md` | Session/device admin controls | Are all promised session controls live and bounded? |
| `REPORTS AND REVIEWS/Mobile_Native_Audit_2_Fix_Plan.md` | Mobile/native runtime drift | Are CSRF/host/runtime config fixes reflected in current mobile code? |
| `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/mailbox_reaudit_report.md` | Communications config propagation | Do admin messaging controls still propagate correctly? |

## 7. Literal search seed list for this audit

Use these as first-pass search terms when a workstream starts:

- `default`
- `fallback`
- `??`
- `||`
- `setTimeout`
- `setInterval`
- `retry`
- `backoff`
- `timeout`
- `interval`
- `heartbeat`
- `ttl`
- `cache`
- `stale`
- `refresh`
- `gcTime`
- `staleTime`
- `batch`
- `limit`
- `pageSize`
- `threshold`
- `window`
- `retention`
- `http://`
- `https://`
- `ws://`
- `wss://`
- `localhost`
- `127.0.0.1`
- schema `.default(`
- `process.env`
- `TODO`
- `FIXME`
- `HACK`
- `temporary`
