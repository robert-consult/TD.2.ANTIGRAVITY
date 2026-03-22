# Output 5 - Runtime Config Architecture

## Recommended target model

This repo already has the raw building blocks:
- DB-backed runtime tables: `global_settings`; `system_config`; `quote_subscription_config`; `communication_settings`; `grift_config`
- event fanout: `server/services/liveBus.ts`
- live client invalidation: `client/src/live/ConfigSync.tsx`

What is missing is a single typed config registry that defines:
- ownership
- precedence
- default resolution
- propagation scope
- effective-value visibility

### Central source of truth

- Code invariants stay in code and never appear as normal admin fields.
- Secret values stay outside DB config rows; DB stores only secret refs or capability flags.
- Deploy-varying values stay in env/K8s/GitOps and are shown read-only in admin.
- Runtime-safe business controls live in typed DB-backed domains.
- Narrow overrides exist only where already intentional, such as user quote subscription mode or user trade constraints.

### Suggested config namespaces

| Namespace | Current backing source | Recommended service owner | Propagation event | Intended scope |
| --- | --- | --- | --- | --- |
| `system.runtime` | `system_config` | `server/services/runtimeConfig/systemRuntime.ts` | `system-config:updated` | maintenance; signup gates; legal visibility; session business settings |
| `trading.risk` | `global_settings` | `server/services/runtimeConfig/tradingRisk.ts` | `global-settings:updated` | leverage; lot caps; market hours; loss limits; price-distance rules |
| `quotes.transport` | `global_settings` plus `system_config` | `server/services/runtimeConfig/quoteTransport.ts` | `global-settings:updated`; `feed:config-updated` | client poll/flush/reconnect profile and feed cadence/staleness |
| `quotes.providers` | `market_data_providers`; `system_config`; provider files | `server/services/runtimeConfig/marketDataProviders.ts` | `market-data:providers-updated` | active provider; fallback list; controlled-reload provider limits |
| `identity.session` | `system_config` plus deploy cookie flags | `server/services/runtimeConfig/sessionConfig.ts` | `identity:config-updated` | remember-me business controls and visible deploy transport flags |
| `identity.signup` | `system_config` plus captcha secret health | `server/services/runtimeConfig/signupConfig.ts` | `signup:config-updated` | captcha; phone enforce; freeze; waitlist |
| `abuse.bot` | `system_config` | `server/services/runtimeConfig/botGuardConfig.ts` | `abuse:config-updated` | coarse bot thresholds and PoW controls |
| `abuse.grift` | `grift_config` | `server/services/runtimeConfig/griftConfig.ts` | `grift:config-updated` | grift thresholds; retention; enforcement |
| `communications.runtime` | `communication_settings` | existing service with registry wrapper | `communications:config-updated` | mailbox and notification runtime settings |
| `recruitment.challenge` | `system_config` | `server/services/runtimeConfig/challengeConfig.ts` | `challenges:config-updated` | challenge scheduler; defaults; reward toggles |
| `clients.surface` | build env plus mirrored DB/runtime view | `server/services/runtimeConfig/clientSurfaceConfig.ts` | `client-runtime:updated` | web; native; wrapper; website host/deeplink/runtime mirrors |
| `infra.visibility` | env/K8s/ops manifests | read-only aggregator | none; snapshot endpoint only | deploy-owned values visible in admin but not writable there |

## Secret handling boundary

- Secret refs remain in provider JSON and provider DB records, for example `env:TWELVE_DATA_API_KEY`.
- Raw captcha secrets, object storage credentials, ClickHouse credentials, and mobile signing material must never enter normal admin payloads.
- Secret-backed settings show:
  - configured secret reference
  - presence/absence health
  - last validation result
  - rotation workflow link

## Cache strategy

| Domain | Current pattern | Target pattern |
| --- | --- | --- |
| `global_settings` | TTL cache plus `global-settings:updated` invalidation | Keep TTL as safety net; move all reads through one resolver |
| `system_config` | mixed direct DB reads; route literals; some local invalidation | Centralize through domain resolvers; no route-local fallback objects |
| `quote subscriptions` | TTL cache plus live invalidation | Keep |
| `communications` | local cache plus live invalidation | Keep |
| `grift` | local TTL only | Add live-bus invalidation and node ack tracking |
| mobile/native/website | build-time constants | Replace with build config plus runtime mirror endpoint |

Stale-read tolerance:
- low-risk client tuning: up to 15 seconds
- signup/session/grift: last validated value only; stale state visible
- trade correctness: use last validated value or fail closed; never re-default silently to weaker values

## Invalidation event strategy

Keep existing live-bus foundation and add typed domain events where gaps exist:

- existing and keep:
  - `global-settings:updated`
  - `system-config:updated`
  - `quote-subscriptions:updated`
  - `market-data:providers-updated`
  - `communications:config-updated`
- add:
  - `grift:config-updated`
  - `challenges:config-updated`
  - `signup:config-updated`
  - `identity:config-updated`
  - `client-runtime:updated`

Every event payload should include:
- domain
- version
- updatedAt
- updatedBy
- changedKeys
- requiredScope

## WebSocket impact strategy

- Protocol shapes remain code invariants. No admin control over message schema or opcodes.
- Existing sockets may accept runtime transport changes only when:
  - the server can apply them without reconnect, for example `wsPushFrequencyMs`
  - the client can merge the payload safely, as in `ConfigSync.tsx`
- Reconnect-required settings must explicitly show `existing sockets keep prior behavior until reconnect`.
- Provider or feed cadence edits should not mutate protocol shape; only the freshness of data and server-side cadence.

## Worker refresh strategy

| Class | Refresh model |
| --- | --- |
| Class 1 | Domain resolver listens to live event; caches invalidated immediately |
| Class 2 | Worker/feed/scheduler subscribes to a reload event and records next effective run |
| Class 3 | Rolling restart or deploy only |
| Class 4 | Secret rotation workflow with targeted process restart if required |

Repo-specific requirements:
- `quoteFeed.ts` should reload on `feed:config-updated`
- `autoClose.ts` should continue to reschedule on `global-settings:updated`
- `evaluateChallenges.ts` needs a new wake-up subscription to `challenges:config-updated`
- `griftEngine.ts` must subscribe to `grift:config-updated`

## Mobile/native refresh model

- Web:
  - uses live WS invalidation already
  - pulls `/api/global-settings` for client runtime profile
- Wrapper:
  - follows web runtime for business behavior
  - build/deploy values such as server host and allowed navigation remain deploy-owned
- Native:
  - fetches a small runtime mirror document on app foreground and startup
  - host or deep-link scheme changes remain build/deploy controlled
  - reconnect policy and surface-specific feature mirrors can update at runtime if explicitly allowed
- Website:
  - consumes build/deploy trading-app URL config only
  - admin should show it as read-only effective value

## Config versioning

Add versioning only where the blast radius warrants rollback:
- `trading.risk`
- `quotes.providers`
- `identity.signup`
- `abuse.grift`
- `recruitment.challenge`

Minimal version record:
- domain
- version
- before snapshot
- after snapshot
- actor
- reason
- requiredScope
- propagation result

## Rollout and rollback model

- Runtime-safe domains:
  - save validated config
  - publish event
  - wait for node acknowledgements
  - expose effective version in admin
- Controlled-reload domains:
  - save config
  - emit reload request
  - show `pending until next worker/feed ack`
- Deploy-owned domains:
  - show source manifest/env var only
  - rollback via GitOps/deploy tooling

## Validator model

- Shared Zod validators live under `shared/` and are imported by both routes and services.
- Per-domain validators enforce:
  - numeric bounds
  - enum values
  - dependency ordering such as `tierMed <= tierHigh <= tierCritical`
  - reload scope
  - secret presence prerequisites for feature enablement
- Validation errors must mention the domain key and the effective bounds, not generic `invalid payload`.

## Precedence model to enforce

1. code invariants
2. secret store / secret presence
3. deploy/env/GitOps
4. runtime DB config
5. narrower override such as tenant/account/user only when intentionally supported
6. request/session override only where explicitly designed

Ambiguities to eliminate first:
- provider selection precedence in `providerManager.ts`
- `system_config` default precedence between schema and route fallback objects
- native/wrapper/website host precedence versus `APP_URL`

## Fallback policy

- No silent downgrade from stronger security control to weaker control.
- No route-local magic defaults that differ from shared schema defaults.
- For safety-critical runtime domains:
  - keep last validated value
  - emit degraded-health signal
  - show degraded state in admin effective-value inspector
- For client tuning domains:
  - bounded last-known-good fallback is acceptable
  - stale indicator required
