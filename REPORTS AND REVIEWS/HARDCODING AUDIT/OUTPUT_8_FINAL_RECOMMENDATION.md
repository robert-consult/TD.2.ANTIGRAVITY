# Output 8 - Final Recommendation

## Move to admin runtime config now

| Finding ID | Setting | Why now | Propagation path summary |
| --- | --- | --- | --- |
| HC-002 | Remember-me business fields | Already DB-backed and consumed; high business/security value | Admin write to `system_config` subset; invalidate remember-me cache; publish `identity:config-updated`; refresh auth/session consumers |
| HC-004 | Signup freeze; waitlist; invite batch cap | Already operationally useful and runtime-safe | Admin write to `system_config`; publish `signup:config-updated`; refresh signup public config and admin state |
| HC-007 | Bot guard coarse thresholds and PoW toggles | Runtime-safe when bounded and RBAC-restricted | Admin write; publish `abuse:config-updated`; clear bot config cache |
| HC-009 | Quote subscriptions config | Clean existing implementation | Existing write path and live event |
| HC-010 | Communication settings | Clean existing implementation | Existing write path and `communications:config-updated` |
| HC-018 | Global client/runtime performance settings | Strong ops value and already partially live | Admin write to `global_settings`; publish `global-settings:updated`; web merges payload and invalidates |
| HC-025 | Grift DB config | Valuable and mostly ready once propagation gap is fixed | Admin write to `grift_config`; publish `grift:config-updated`; invalidate all node caches |

## Keep as controlled-reload admin config

| Finding ID | Setting | Why controlled reload | Required reload scope |
| --- | --- | --- | --- |
| HC-013 | Provider timeout/batch/rate-limit config | Provider drivers and rate-limit queues should not mutate blindly mid-flight | Provider registry reload plus provider cache clear |
| HC-015 | Feed cadence; staleness; rollover | Feed loop needs explicit reload semantics | Feed config reload on every API node |
| HC-021 | Auto-close business timings | Scheduler interval must reschedule safely | Auto-close scheduler reschedule on each worker/API node |
| HC-023 | Challenge scheduler cadence and max rows | Scheduler must wake and compute new next-run state | Challenge scheduler reschedule on worker/API node |
| HC-012 | Active provider and fallback provider list | Safe and valuable after precedence cleanup, but not as a purely free-form runtime toggle | Provider selection reload plus feed refresh |

## Keep as environment or deployment config

| Finding ID | Setting | Why deploy-owned | Owning surface |
| --- | --- | --- | --- |
| HC-003 | Cookie security and same-site flags | Tied to TLS/origin/deployment topology | Env/K8s |
| HC-014 | Provider cache TTL and legacy env fallback flag | Server startup/runtime infrastructure behavior | Env |
| HC-022 | Auto-close stale-quote guard envs | Operational safety override, not normal admin tuning | Env/K8s |
| HC-032 | Native production/dev base URLs and push env | Build/deploy property of the native app | Native build config |
| HC-034 | Capacitor wrapper server URL and allowed hosts | Wrapper build/deploy property | Capacitor build config |
| HC-037 | Website trading-app URLs | Website deploy config | Website env/build config |
| HC-038 | Export/object-store/ClickHouse endpoints and queue envs | Infra topology and platform ownership | ConfigMap/Secret/GitOps |
| HC-039 | Probes; replicas; resources; HPA thresholds | Pure deployment controls | K8s manifests |
| HC-040 | Prometheus alert thresholds | Ops-owned observability config | Ops/GitOps |
| HC-042 | Insecure internal transport exception | Explicit deployment exception only | Env/overlay |

## Keep as secret-managed

| Finding ID | Setting | Why secret-managed | Rotation workflow needed |
| --- | --- | --- | --- |
| HC-006 | Captcha secrets | Raw secrets must never be broad-admin editable | Secret store plus degraded-health check |
| HC-041 | Petascale credentials | Direct access to object storage and ClickHouse | Secret store plus ops rotation |
| HC-043 | Mobile signing material | Cryptographic signing identity must stay outside repo/admin | Secure signing service or CI signing vault |

## Keep as code-level invariant

| Finding ID | Setting | Why invariant | Failure mode if exposed casually |
| --- | --- | --- | --- |
| HC-028 | Base React Query retry/staleness baseline | Foundation behavior for all queries; too easy to destabilize the UI globally | Arbitrary admin edits can create thundering herds or stale UI state |

## Move into data-modeled policy

| Finding ID | Setting | Why policy/data modeled | Suggested model home |
| --- | --- | --- | --- |
| HC-017 | Trading risk rules | They are business policy with money-flow impact and need versioning/approval | `trading.risk` domain with versioned snapshots |
| HC-008 | Bot scoring windows | Heuristic thresholds should be reviewable and versioned, not buried in code branches | `abuse.bot` policy model with ordered score windows |

## Remove or consolidate first

| Finding ID | Setting | Drift/duplication | Recommended cleanup |
| --- | --- | --- | --- |
| HC-001 | Route-local `system_config` defaults | Conflicting route vs schema defaults | Replace with one system runtime resolver |
| HC-011 | Duplicate singleton bootstrap | Multiple modules seed same row with market-data values | Keep one bootstrap helper only |
| HC-016 | `quoteRefreshMs` | Surfaced dead field | Remove from UI/API and migrate later |
| HC-019 | Global performance duplicate defaults | Shared/server/client/admin all re-default the same knobs | Canonical shared resolver |
| HC-020 | Risk fallbacks in multiple server paths | Same rules with different literals | Shared risk policy service |
| HC-024 | `challengeEvaluationIntervalSec` | Shadowed scheduler field | Remove or replace with actual scheduler controls |
| HC-031 | Client perf literals in admin and runtime helpers | Same knobs defined in several client files | Derive from canonical performance payload |
| HC-035 | Canonical host duplication across wrapper/web | Host/scheme copied into multiple files | Shared surface-config module |
| HC-044 | Prior audit drift | Reports no longer fully match live code | Refresh docs after cleanup lands |

## Governance model to adopt

- One typed runtime-config registry over existing domain tables.
- One explicit precedence order: invariants; secrets; deploy; DB runtime; narrow override.
- One effective-value inspector that always shows configured value, effective value, source, and propagation status.
- Runtime propagation only for domains that have explicit invalidation behavior and bounded validation.
- Controlled-reload domains must display reload scope and acknowledgement state.
- Secrets never appear as plaintext normal-admin fields.
- Dangerous business policy edits require narrow RBAC, audit reason, versioned history, and rollback.
