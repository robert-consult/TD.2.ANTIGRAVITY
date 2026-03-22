# Gold Standard Recommendation For Fix Execution

Verified against the live tree on 2026-03-16.

## Executive directive

Do not interpret this audit as a mandate to preserve every existing admin field and simply "wire it up."

The correct remediation model for this repo is:
1. contain secret and trust failures immediately
2. decide the canonical control path for each real behavior
3. wire only the canonical control end to end
4. expose effective runtime state for security-sensitive settings
5. add explicit propagation semantics for runtime-safe settings
6. retire shadow, duplicate, and misleading controls

This repo should become more configurable in production, but only by becoming more coherent first.

## The decision model for every finding

Every finding must be resolved with one primary action:

### Action A - Wire

Use when the setting is real, should remain admin-managed, and the current control is the correct canonical surface.

Result:
- DB, API, UI, workers, websocket consumers, and clients all honor the same value

Examples in this repo:
- grift runtime thresholds after propagation is fixed
- global performance settings already close to canonical ownership

### Action B - Merge

Use when the setting is real but the current admin field is only one of several overlapping controls.

Result:
- one canonical control survives
- the overlapping controls are removed or made read-only and deprecated

Examples in this repo:
- `quoteRefreshMs` should not survive as a second quote-cadence knob beside the richer performance model
- `challengeEvaluationIntervalSec` should not survive beside `challengeEvalIntervalMin` if only one drives the scheduler

### Action C - Expose Effective State

Use when the configured value and the effective runtime value can diverge because of fallback, degraded mode, secret readiness, or deploy constraints.

Result:
- admin sees configured value, effective value, source, and degraded/fallback state

Examples in this repo:
- signup CAPTCHA provider selection versus runtime fallback to `SLIDER`

### Action D - Propagate

Use when the setting is already admin-managed but changes do not reach all readers cleanly.

Result:
- write path, cache invalidation, worker refresh, websocket/client refresh, and status visibility are explicit

Examples in this repo:
- grift config changes
- challenge scheduler wake-up
- feed/provider reload acknowledgment

### Action E - Move Out Of Admin

Use when the value is deploy-scoped, secret-scoped, or build-scoped rather than runtime admin config.

Result:
- value lives in env, secret store, CI, Kubernetes, GitOps, or build pipeline
- admin may get read-only visibility but not normal edit authority

Examples in this repo:
- Android release signing assets
- provider API secrets
- deploy-only infra knobs

### Action F - Retire

Use when the field is dead, misleading, duplicate, or no longer the right abstraction.

Result:
- UI removed
- API field removed or deprecated
- schema cleaned up after migration window

Examples in this repo:
- dead quote refresh shadow field after canonical performance path is adopted
- dead challenge evaluation seconds field if minute-based runtime wins

## What success looks like

At the end of the fix program:
- every meaningful behavior has one clear source of truth
- admin surfaces only the settings that should actually be admin-managed
- every admin-editable setting shows configured value and effective value when they can differ
- runtime-safe edits propagate through explicit events
- reload-required edits show acknowledgement and status
- deploy-owned values stay out of normal admin writes
- secrets are removed from repo and managed separately
- web, wrapper, native, website, worker, and API behavior no longer drift silently

## Wave structure

### Wave 0 - Immediate containment and truthfulness

Objective:
- stop the platform from exposing secrets, lying to operators, or silently delaying sensitive control changes

This wave is not about broad refactoring. It is about immediate containment and removing false confidence.

Work package:
- HC-043: move Android release signing material out of git and out of repo-managed build inputs
- HC-005: keep CAPTCHA settings but expose configured provider, effective provider, fallback state, and secret readiness
- HC-027: keep grift config admin-managed but add cluster-wide invalidation and client refresh semantics
- HC-016 and HC-024: mark shadow admin controls as deprecated and stop representing them as trustworthy live controls

Important interpretation:
- for dead or shadow admin controls, do not wire every old field just because it exists
- instead, freeze or remove the misleading control and route the real behavior toward its eventual canonical owner

Why this comes first:
- checked-in signing material is a direct release-identity risk
- hidden effective CAPTCHA state is a security observability failure
- missing grift propagation undermines anti-abuse response
- dead admin fields create false operator confidence during incidents

Acceptance gate:
- no release signing secrets remain tracked in git
- release signing relies on CI or local secret-managed inputs only
- admin shows effective CAPTCHA state, not just requested state
- grift config updates invalidate all nodes and refresh admin views
- shadow controls are visibly deprecated, disabled, or removed from active editing paths

### Wave 1 - Canonicalize control ownership

Objective:
- choose one owner for each real behavior before wiring more admin configurability

Work package:
- HC-001 and HC-011: consolidate `system_config` creation and default resolution
- choose the canonical owner for quote cadence and client quote behavior
- choose the canonical owner for challenge scheduler cadence
- document whether each real behavior belongs to runtime admin config, controlled reload, deploy config, or code invariant

Files to anchor this wave:
- `server/routes/admin.ts`
- `server/routes/adminSystemConfig.ts`
- `server/routes/adminScout/challenges.ts`
- `server/cron/evaluateChallenges.ts`
- `server/recruitment/challengesV4/challengeConfig.ts`
- `server/services/globalSettings.ts`
- `server/services/globalSettingsAdmin.ts`
- new `server/services/systemConfigBootstrap.ts`
- new `server/services/runtimeConfig/*`

Why this comes before more wiring:
- wiring duplicate controls produces more drift, not less
- the platform must first decide which field survives for each behavior

Acceptance gate:
- one shared resolver owns `system_config` defaults
- one bootstrap path owns singleton creation
- each overlapping setting pair has a declared canonical winner
- shadow fields are scheduled for removal rather than silently kept alive

### Wave 2 - Wire the canonical runtime control plane

Objective:
- take the settings that should genuinely be admin-managed and wire them end to end

Work package:
- HC-018 and HC-019 and HC-031: make the performance-settings model the canonical quote/client runtime control plane
- HC-015: keep feed cadence and staleness in controlled-reload semantics with explicit reload acknowledgment
- HC-012 and HC-013 and HC-014: make provider selection and fallback precedence explicit and observable
- replace shadow quote controls with the canonical performance path

Important interpretation:
- this is where hardcoded operational values become truly admin-configurable
- but only through the canonical control surface chosen in Wave 1

Files to anchor this wave:
- `shared/schema.pg.base.ts`
- `server/routes/public/globalSettingsPayload.ts`
- `server/services/globalSettings.ts`
- `server/services/globalSettingsAdmin.ts`
- `client/src/lib/perfHints.ts`
- `client/src/hooks/use-performance-settings.ts`
- `client/src/live/ConfigSync.tsx`
- `server/feeds/quoteFeed.ts`
- `server/marketdata/providerManager.ts`
- `config/marketdata/providers/*.json`

Acceptance gate:
- quote/client performance has one canonical resolver
- no duplicate quote-refresh control remains active
- provider effective selection is explicit and visible
- reload-required operations expose acknowledgement state

### Wave 3 - Wire correctness-sensitive policy and scheduler behavior

Objective:
- take the real business/risk/abuse settings and wire them through the correct runtime or controlled-reload path

Work package:
- HC-017 and HC-020: move trade and risk consumers onto one resolved trading-risk snapshot
- HC-021 and HC-022: keep business timing in DB or policy config, while deploy-only stale guards stay read-only infra values
- HC-023: make challenge scheduler cadence changes take effect through the real scheduler path
- HC-025 and HC-026 and HC-027: finish grift separation between admin policy controls and internal engine caps
- HC-007 and HC-008: keep operator-safe bot controls admin-editable and move scoring-window logic into versioned policy

Important interpretation:
- if a hardcoded threshold should be admin-configurable, this wave is where it is wired
- if a threshold should instead be a versioned policy record or a bounded controlled-reload setting, this wave enforces that boundary

Files to anchor this wave:
- `server/risk.ts`
- `server/engine/orderEngine.ts`
- `server/routes/trader/tradeOpen.ts`
- `server/cron/autoClose.ts`
- `server/cron/evaluateChallenges.ts`
- `server/security/botGuard.ts`
- `server/routes/grift-admin/ops.ts`
- `server/grift/griftEngine.ts`
- `server/recruitment/challengesV4/challengeConfig.ts`

Acceptance gate:
- every trade path uses the same resolved risk policy
- challenge cadence is controlled by one field and one scheduler path
- grift thresholds propagate immediately and consistently
- bot and abuse thresholds are bounded, auditable, and not duplicated in multiple layers

### Wave 4 - Eliminate cross-surface drift

Objective:
- make web, wrapper, native, and website agree on environment-sensitive runtime values

Work package:
- HC-032 through HC-037: create one shared surface-config model for hostnames, deep-link schemes, and runtime origins
- keep build-owned values build-owned
- add read-only effective-value visibility where admin needs awareness without editability

Files to anchor this wave:
- `NATIVE/src/services/runtimeConfig.ts`
- `NATIVE/src/services/websocket.ts`
- `MOBILE/capacitor.config.ts`
- `MOBILE/src/mobile/utils/deep-linking.ts`
- `MOBILE/src/mobile/utils/session-manager.ts`
- `client/src/components/MobileWrapperBridge.tsx`
- `client/src/lib/appUrl.ts`
- `client/src/lib/wsUrl.ts`
- `client/src/lib/dashboardUrlState.ts`
- `WEBSITE/client/src/lib/app-config.ts`
- `server/services/appLinks.ts`
- new `shared/appSurfaceConfig.ts`
- new `shared/appLinks.ts`

Acceptance gate:
- one canonical host and deep-link model exists
- native reconnect policy is either shared or explicitly separate by design
- website, wrapper, and native all show the same effective trading-app origin

### Wave 5 - Deploy visibility and doc reconciliation

Objective:
- finish governance, make deploy-owned values visible, and close the drift loop in documentation

Work package:
- HC-038 through HC-042: add read-only deploy inspector for env, Kubernetes, alerts, and petascale runtime
- HC-044: reconcile older audits with the final live implementation

Files to anchor this wave:
- `server/services/petascaleEnv.ts`
- new `server/routes/admin/deployConfigInspector.ts`
- `k8s/01-configmap.yaml`
- `k8s/10-api-deployment.yaml`
- `k8s/40-hpa.yaml`
- `ops/prometheus-config/tradehub-alerts.yml`
- audit docs under `REPORTS AND REVIEWS/`

Acceptance gate:
- deploy-owned values are visible but not editable in normal admin
- docs reflect the final canonical control model

## The Wave 0 clarifications that must govern execution

### Clarification 1 - "Admin controls that do nothing" does not mean "delete admin configurability"

It means:
- do not preserve a misleading control just because it already exists
- if the behavior is real, wire the right canonical control
- if the current field is only a shadow of the real control path, retire or merge it

Correct examples:
- do not wire `quoteRefreshMs` as a second quote-cadence control if the real control belongs in the richer performance model
- do not wire `challengeEvaluationIntervalSec` if the real scheduler reads `challengeEvalIntervalMin`

### Clarification 2 - "Security settings whose effective runtime state is hidden" does not mean "remove the setting"

It means:
- keep the setting if it is legitimate
- preserve the real runtime fallback logic
- surface configured value, effective value, and degraded state so operators know what is actually active

Correct example:
- CAPTCHA provider should remain configurable, but admin must show when requested `TURNSTILE` or `HCAPTCHA` is effectively running as `SLIDER`

### Clarification 3 - "Anti-abuse config changes that do not propagate cleanly" means "fix propagation"

It means:
- keep the admin control if it belongs in admin
- add explicit invalidation and refresh semantics across nodes, workers, and clients
- stop relying on passive TTL convergence for incident-sensitive controls

Correct example:
- grift config updates should publish a live-bus event and invalidate caches cluster-wide

### Clarification 4 - "Exposed signing credentials" does not wait for the rest of the program

It means:
- remove tracked release signing material immediately
- migrate to secret-managed signing inputs
- continue testing with debug signing or secret-injected release signing

This is a containment issue, not a later polish item.

## Non-negotiable execution rules

### Rule 1 - No more inline defaults in routes

Routes may validate and shape payloads.
Routes may not invent a second default model.

### Rule 2 - No more unrelated singleton bootstrap writes

Only one bootstrap path may create `system_config` row `id=1`.

### Rule 3 - No new admin control without propagation semantics

Every new admin-editable setting must declare one of:
- runtime
- controlled reload
- restart
- deploy
- migration

### Rule 4 - No new runtime control without effective-value visibility when runtime can degrade or fall back

Every such control must show:
- configured value
- effective value
- source
- last updated by
- last propagated at
- degraded or fallback reason where applicable

### Rule 5 - No secrets in repo and no secrets in broad admin payloads

This is especially important for:
- mobile signing assets
- CAPTCHA secrets
- object storage credentials
- ClickHouse credentials
- provider API keys

### Rule 6 - Do not wire duplicate controls just to satisfy the audit

If two fields represent one behavior:
- pick the canonical owner
- migrate consumers to it
- retire the shadow field

## What not to do

Do not:
- move all env values into admin
- treat every current admin field as sacred
- wire duplicate settings in parallel just because both already exist
- expose provider env fallback toggles as normal runtime knobs
- expose secrets or build-time values through broad admin payloads
- merge all fixes into one giant branch
- let web and native each invent their own runtime mirrors again

## Recommended delivery model

Use one short-lived branch per wave.

Recommended PR shape:
- PR 1: containment and truthfulness
- PR 2: canonical ownership and bootstrap cleanup
- PR 3: runtime control-plane wiring
- PR 4: correctness-sensitive policy and scheduler wiring
- PR 5: cross-surface surface-config alignment
- PR 6: deploy inspector and doc reconciliation

Keep each PR internally coherent. Do not mix:
- provider governance with mobile host cleanup
- risk refactors with deploy inspector work
- secret cleanup with UI polish

## Required validation by wave

### Every wave

- `npm run check`
- `npm run build`

### Wave 0 additionally

- verify tracked signing secrets are removed
- verify release build now depends on secret-managed signing inputs
- verify CAPTCHA admin read path exposes effective state
- verify grift updates invalidate caches beyond the current process

### Wave 1 additionally

- verify missing-row behavior is identical across all `system_config` readers
- verify only one bootstrap helper can create singleton rows

### Wave 2 additionally

- run `npm run smoke:admin`
- verify global performance updates propagate through `ConfigSync`
- verify provider change acknowledgment and effective provider visibility

### Wave 3 additionally

- run challenge scheduler and grift path tests
- verify risk-policy consumers resolve the same effective snapshot
- verify challenge cadence changes affect the actual scheduler path

### Wave 4 additionally

- verify wrapper, native, and website surface the same effective origin model
- test Android and iOS runtime config resolution where applicable

### Wave 5 additionally

- verify deploy inspector is read-only
- verify audit docs match the final implemented ownership model

## Recommended owner split

- Platform/backend: Waves 1 through 3
- Security/platform release owner: Wave 0 signing and secret handling
- Admin UI owner: effective-value visibility, deprecation UX, propagation status UX
- Mobile/native owner: Wave 4 surface-config alignment
- Ops/platform owner: Wave 5 deploy inspector and manifest alignment

## Final instruction

Proceed with fixes using this order:
1. contain secrets and misleading controls
2. choose canonical owners
3. wire the canonical runtime controls
4. fix correctness-sensitive propagation and policy behavior
5. align cross-surface consumers
6. expose deploy state and reconcile docs

That is the gold-standard path to a platform that is actually configurable, rather than merely full of editable fields.
