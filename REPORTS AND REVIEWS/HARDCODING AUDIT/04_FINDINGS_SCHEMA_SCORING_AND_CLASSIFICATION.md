# Findings Schema, Scoring, And Classification

## Canonical finding fields

Every finding recorded during the audit must carry these columns:

```text
finding_id
setting_name
domain
class
file_path
symbol/function/module
current_value
current_value_type
behavior_controlled
current_source_of_truth
duplicate_sources
admin_surface_exists
backend_wired
frontend_wired
mobile_or_native_wired
runtime_adjustable
required_scope
secret
risk_level
blast_radius
recommended_target_source_of_truth
recommended_admin_location
validation_rules
RBAC_scope
audit_event_required
invalidation_dependencies
notes
```

## Status taxonomies

Use only these status values unless the audit proves a new category is needed:

- `admin_surface_exists`: `yes`, `no`, `partial`
- `backend_wired`: `yes`, `no`, `partial`
- `frontend_wired`: `yes`, `no`, `partial`
- `mobile_or_native_wired`: `yes`, `no`, `partial`, `not-applicable`
- `runtime_adjustable`: `yes`, `no`, `partial`
- `required_scope`: `runtime`, `reload`, `restart`, `deploy`, `migration`
- `secret`: `yes`, `no`
- `risk_level`: `critical`, `high`, `medium`, `low`

## Scoring model

Score each dimension from `1` to `5`.

| Dimension | Meaning of 1 | Meaning of 5 |
| --- | --- | --- |
| Operational importance | Minor convenience | Core platform behavior |
| Likelihood of change after deploy | Rarely touched | Frequently adjusted by ops/admin |
| Blast radius | Isolated/local | Cross-platform or financial-system wide |
| Urgency | Cleanup only | Active risk or production blocker |
| Feasibility of admin surfacing | Unsafe or unjustified | Clear and valuable admin control |
| Runtime propagation suitability | Requires full redeploy | Safe to apply live |
| Security sensitivity | Low sensitivity | High abuse/security impact |
| Business/admin value | Low operator value | High operational leverage |

## Priority bands

Use the total score to drive backlog placement:

- `P0`: severe risk or control failure; typically totals at the top of the stack and/or touches security, trading correctness, or major drift
- `P1`: essential admin control missing or badly wired
- `P2`: operational flexibility gain with moderate risk/value
- `P3`: cleanup, consolidation, or legacy removal

Do not let the score override judgment. A Class 4 or Class 5 item can still be `P0` even if it should never be admin-managed.

## Propagation scope definitions

| Scope | Definition | Typical examples in this repo |
| --- | --- | --- |
| `runtime` | Can apply live through validated write + invalidation + cache refresh | query/poll intervals already wired through live bus |
| `reload` | Requires subsystem re-read or targeted recycle but not full deploy | provider manager reload, worker loop refresh |
| `restart` | Needs process restart or rolling restart | bootstrap-only env parsing, startup-seeded host config |
| `deploy` | Deployment manifest/env change | K8s ConfigMap, ingress, HPA, website origin |
| `migration` | Schema/data migration required | moving rules from literals into modeled tables |

## Class assignment guardrails

Assign classes using the most restrictive correct home:

- If it is secret-bearing, use `Class 4`.
- If correctness or protocol breaks when changed casually, prefer `Class 5`.
- If it belongs in K8s/env/GitOps/operator material, use `Class 3`.
- If it is an actual policy/rule set that should be versioned as data, use `Class 6`.
- If the current surface is stale or duplicated, use `Class 7` even if the eventual target is another class.

## Required validation notes per finding

Each finding must state:

- numeric bounds,
- enum allowlist,
- dependency validation,
- unsafe combinations to reject,
- actor/RBAC scope,
- required audit log event name,
- fallback behavior if config store is unavailable.

## Required propagation notes for runtime-eligible findings

If `runtime_adjustable` is `yes` or `partial`, document:

1. admin write path,
2. server validation path,
3. persistence target,
4. invalidation event name,
5. server cache refresh behavior,
6. worker refresh behavior,
7. websocket effect,
8. web client refresh behavior,
9. mobile/native refresh behavior,
10. rollback path,
11. store-unavailable fallback.

## Example class heuristics anchored to this repo

- `global-settings:updated` performance knobs likely trend toward `Class 1`.
- `marketDataActiveProviderKey` may be `Class 2` if quote feed/provider manager reload is required.
- `CAPACITOR_SERVER_URL` belongs to `Class 3`.
- `SESSION_SECRET` belongs to `Class 4`.
- `WS_PROTOCOL_VERSION` belongs to `Class 5`.
- hardcoded risk or eligibility thresholds duplicated across services often trend toward `Class 6`.
- stale DB fields, ignored UI controls, or duplicated host constants belong to `Class 7`.
