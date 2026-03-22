# Output 3 - Wired Vs Not Wired Matrix

## Surfaced and working

| Finding ID | Setting | Domain | Surface | Source of truth | Evidence |
| --- | --- | --- | --- | --- | --- |
| HC-002 | Remember-me business settings | Server/API | Admin dashboard plus auth flows | `system_config` | `server/routes/admin.ts:943-1018`; `server/services/rememberMe.ts:174-223` |
| HC-004 | Signup freeze and waitlist controls | Server/API | Admin system config plus signup public config | `system_config` | `server/routes/admin.ts:978-1073`; `server/services/signupPublicConfig.ts:8-46` |
| HC-007 | Bot guard coarse thresholds | Server/API | Admin system config; runtime guard | `system_config` | `shared/schema.pg.base.ts:842-853`; `server/security/botGuard.ts:115-133` |
| HC-009 | Quote subscriptions global config | Server/API | Admin quote subscriptions plus runtime invalidation | `quote_subscription_config` | `server/services/quoteSubscriptions.ts:359-386`; `client/src/live/ConfigSync.tsx:72-78` |
| HC-010 | Communication settings | Server/API | Admin communications plus mailbox/notification consumers | `communication_settings` | `server/services/messagingSettings.ts:222-257`; `client/src/hooks/use-mailbox.tsx:203-207`; `client/src/hooks/use-notifications.tsx:100-106` |
| HC-015 | Feed poll/stale/rollover controls | Market data | Admin system config plus live feed reload | `system_config` | `server/routes/admin.ts:1101-1113`; `server/feeds/quoteFeed.ts:276-307` |
| HC-018 | Global performance settings | Shared/client | Admin global settings; public payload; web runtime merge | `global_settings` | `server/routes/public/globalSettingsPayload.ts:61-198`; `client/src/live/ConfigSync.tsx:36-56` |
| HC-021 | Auto-close business timings | Trading/risk | Admin global settings; auto-close scheduler | `global_settings` | `server/cron/autoClose.ts:30-39`; `server/cron/autoClose.ts:342-349` |

## Surfaced but not persisted

No clear surfaced-but-not-persisted finding was verified in this pass. The dominant failure mode in this repo is different: values are usually persisted, but either shadowed, duplicated, or not consumed by the real runtime.

## Persisted but not consumed

| Finding ID | Setting | DB/env location | Missing consumer | Risk |
| --- | --- | --- | --- | --- |
| HC-016 | `quoteRefreshMs` | `system_config.quote_refresh_ms` | Feed runtime only reads `feedPollMs` and `staleThresholdMs` | Operators change a dead control and assume quote timing changed |
| HC-024 | `challengeEvaluationIntervalSec` | `system_config.challenge_evaluation_interval_sec` | `evaluateChallenges.ts` only reads `challengeEvalIntervalMin` and `challengeEvalMaxRows` | Scout admin UI advertises a scheduler control that the scheduler ignores |

## Consumed but not surfaced

| Finding ID | Setting | Current consumer | Missing admin/UI surface | Recommendation |
| --- | --- | --- | --- | --- |
| HC-003 | `COOKIE_SECURE`; `COOKIE_SAMESITE` | `server/services/rememberMe.ts` | No read-only deploy inspector in admin | Show as deploy-owned effective values under `Identity And Session` |
| HC-014 | `MARKET_DATA_PROVIDER_CACHE_TTL_MS`; env legacy fallback flags | `server/marketdata/providerManager.ts` | No provider diagnostics view for cache/fallback mode | Add read-only provider diagnostics pane |
| HC-022 | `AUTOCLOSE_STALE_DEFER_MAX_MIN`; `AUTOCLOSE_ALLOW_STALE_CLOSE` | `server/cron/autoClose.ts` | No admin visibility | Show read-only deploy guard values under auto-close |
| HC-026 | `GRIFT_CONFIG_TTL_MS`; linked-edge write caps | `server/grift/griftEngine.ts` | No grift diagnostics surface | Add read-only engine limits section in grift admin |
| HC-042 | `ALLOW_INSECURE_INTERNAL_TRANSPORT` | `server/services/petascaleEnv.ts` | No admin visibility | Expose read-only infra exception status with owner/runbook link |

## Duplicated or conflicting

| Finding ID | Setting | Duplicate sources | Conflict | Recommended consolidation |
| --- | --- | --- | --- | --- |
| HC-001 | `system_config` defaults | `server/routes/admin.ts`; `server/routes/adminSystemConfig.ts`; `shared/schema.pg.base.ts` | Missing-row response in admin route disagrees with schema defaults | Centralize default resolution in one service |
| HC-011 | Market-data singleton bootstrap | `db/seed.ts`; `server/i18n/config.ts`; `server/partner/inquiryRouting.ts`; `server/routes/adminScout/candidates.ts` | Unrelated modules seed the same row and market-data fields | Replace with one bootstrap helper |
| HC-012 | Provider precedence | `system_config`; `providerManager.ts`; env keys | DB; code default; and env fallback all participate | Make precedence explicit and remove prod env fallback |
| HC-019 | Global performance defaults | `shared/schema.pg.base.ts`; `server/routes/public/globalSettingsPayload.ts`; client perf helpers | Same knobs are clamped/defaulted differently by layer | Use one shared resolver |
| HC-020 | Trading risk fallbacks | `server/risk.ts`; `server/engine/orderEngine.ts`; `server/routes/trader/tradeOpen.ts` | Different literal fallbacks backstop the same rules | Route all reads through one policy service |
| HC-031 | Client perf defaults | `client/src/lib/perfHints.ts`; `client/src/pages/AdminDashboard.tsx`; admin support helpers | UI and runtime can drift from public payload | Derive admin/editor defaults from canonical resolver |
| HC-033 | Native WS reconnect defaults | `NATIVE/src/services/websocket.ts`; `global_settings` transport knobs | Native ignores web/global reconnect behavior | Mirror only approved client transport settings |
| HC-035 | Canonical host and deep-link scheme | `MOBILE/src/mobile/utils/deep-linking.ts`; `client/src/components/MobileWrapperBridge.tsx`; `client/src/lib/dashboardUrlState.ts` | Same host is hardcoded in multiple surfaces | Create shared surface-config module |

## Should not be admin-managed

| Finding ID | Setting | Class | Why not admin-managed | Correct home |
| --- | --- | --- | --- | --- |
| HC-003 | Cookie transport flags | Class 3 | Security-sensitive deploy behavior; tied to TLS/origin | Env/K8s/GitOps |
| HC-006 | Captcha secrets | Class 4 | Raw secrets must not be broad-admin editable | Secret store |
| HC-028 | Base React Query defaults | Class 5 | App-level client behavior baseline; easy to misuse from admin | Code |
| HC-038 | Export/object-store/ClickHouse endpoints and queue env | Class 3 | Cluster topology and infra ownership | ConfigMap/Secret/GitOps |
| HC-039 | Replicas; probes; resources; HPA targets | Class 3 | SRE-owned deployment safety controls | K8s manifests |
| HC-040 | Alert thresholds | Class 3 | Observability routing belongs to ops workflow | Prometheus/GitOps |
| HC-041 | Petascale credentials | Class 4 | High-value secrets | Secret store |
| HC-042 | Insecure internal transport exception | Class 3 | Exception policy must stay deploy-owned and auditable | Overlay/env with runbook |
| HC-043 | Mobile signing material | Class 4 | Cryptographic signing assets must never be normal admin data | Secure signing pipeline |

## Drift between docs and live code

| Finding ID | Prior doc | Live code status | Drift type | Action |
| --- | --- | --- | --- | --- |
| HC-044 | `REPORTS AND REVIEWS/quotes provider config/PROVIDER_CONFIG_SYSTEM_BREAKDOWN.md` | File-sync design exists, but unrelated modules still seed provider defaults into `system_config` | Documented but incomplete in live tree | Update provider governance doc after bootstrap cleanup |
| HC-044 | `REPORTS AND REVIEWS/PREFETCH & CACHING REFACTOR/AUDIT 1.md` | Performance payload and client resolver exist, but defaults remain duplicated in schema/server/client/admin | Implemented but still drifted | Refresh caching audit with duplicate-source inventory |
| HC-044 | `REPORTS AND REVIEWS/KEEP ME SIGNED IN/audit_report.md` | Remember-me flow is wired, but cookie transport still depends on env-only flags and is not visible in admin | Implemented with hidden deploy split | Add deploy-owned session inspector |
| HC-044 | `REPORTS AND REVIEWS/Mobile_Native_Deep_Audit_2.md` | Hardcoded hosts and checked-in signing material still exist | Known issue not fully remediated | Re-run mobile secret and host cleanup after runtime mirror work |
