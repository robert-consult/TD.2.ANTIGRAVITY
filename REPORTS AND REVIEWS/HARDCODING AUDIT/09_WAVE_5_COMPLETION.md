# Wave 5 Completion

Verified against current tree on 2026-03-21.

## Scope closed in this wave

Wave 5 finishes governance and visibility for the post-audit control model:

- effective-value inspection is now exposed through a single read-only admin governance endpoint,
- deploy-owned config is visible without becoming writable in admin,
- controlled-reload request/apply history is visible as rollback/apply traces,
- checked-in deployment manifests and audit documents are reconciled against live runtime state instead of remaining implicit.

## Implemented surfaces

### 1. Read-only governance inspector

- New route: `GET /api/admin/runtime-config/governance`
- Route module: `server/routes/adminGovernance.ts`
- Aggregation service: `server/services/runtimeGovernance.ts`
- Shared contract additions: `shared/runtimeConfig.ts`

The inspector reports:

- identity/session effective values,
- market-data configured-versus-applied summaries,
- deploy-owned export/object-storage/ClickHouse visibility,
- scheduler business/runtime versus deploy guards,
- deployment manifest snapshot values,
- controlled-reload traces for `quotes.transport.feed` and `quotes.providers`,
- documentation reconciliation rows for the audit pack, requirements ledger, and rollback runbook.

### 2. Admin dashboard visibility

- New dashboard component: `client/src/components/admin/dashboard/GovernanceVisibilityTab.tsx`
- Integrated into: `client/src/components/admin/dashboard/SystemConfigTab.tsx`

The governance tab now shows:

- effective values with owner classification,
- manifest drift badges,
- secret readiness without secret disclosure,
- reload versions, acknowledgement badges, and last-error visibility,
- document presence and live-check status.

### 3. Live invalidation coverage

- `client/src/live/ConfigSync.tsx` now invalidates the governance inspector query when:
  - `global-settings:updated`,
  - `system-config:updated`,
  - `market-data:providers-updated`
  are observed.

That keeps the governance view aligned with the same mutation events that drive the rest of the admin runtime control plane.

## Governance model after Wave 5

### Visible and editable in admin

- DB-backed runtime settings
- controlled-reload settings

### Visible but not editable in normal admin

- deploy-owned env posture,
- secret readiness,
- K8s deployment sizing/probe/autoscale values,
- rollback/apply traces,
- documentation reconciliation state.

### Explicitly not moved into admin by this wave

- raw secrets,
- K8s replica/resource/HPA controls,
- internal transport exceptions,
- object-storage and ClickHouse credentials,
- provider cache TTL and env fallback flags.

## Verification completed

- `npm run check`
- `npm run build`
- `npx vitest run server/services/runtimeGovernance.test.ts server/routes/adminGovernance.test.ts client/src/components/admin/dashboard/GovernanceVisibilityTab.test.tsx client/src/components/admin/dashboard/SystemConfigTab.test.tsx`

Not run in this wave:

- `npm run e2e`
- load tests

## Remaining posture after Wave 5

The main audit execution waves are now complete:

- Wave 0: containment and false-control cleanup
- Wave 1: canonical `system_config` ownership
- Wave 2: runtime control plane
- Wave 3: correctness-sensitive runtime policy
- Wave 4: cross-surface parity
- Wave 5: governance and visibility

The remaining work is steady-state maintenance:

- keep the requirements ledger current,
- extend governance visibility when new deploy-owned controls are introduced,
- keep docs aligned with live code as new config domains are added.
