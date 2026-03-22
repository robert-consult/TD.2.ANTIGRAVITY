# Audit Operating Model

Verified against current tree on 2026-03-16.

## Audit objective

Inventory every meaningful hard-coded or partially hard-coded value across TradeQuip, classify it correctly, map whether it is surfaced and truly wired, and define the path toward a safe, auditable control model.

This audit is repo-specific and multi-surface. It covers:

- `server/`
- `client/`
- `shared/`
- `db/`
- `scripts/`
- `ops/`
- `k8s/`
- `gitops/`
- `config/`
- `petascale/`
- `MOBILE/`
- `NATIVE/`
- `WEBSITE/`
- root docs and archived reports

## Non-negotiable operating rules

- Current-state first. Archived reports are leads, not truth.
- Exact paths first. Every claim must point to live files, schemas, migrations, services, routes, clients, or manifests.
- Cross-layer verification is mandatory. UI, API, DB, worker, websocket, mobile, native, and deployment must be reconciled before classifying a setting.
- Hot-path caution is mandatory. Quote, websocket, trading, risk, and compliance paths cannot be hand-waved into "dynamic" without propagation and performance analysis.
- Security boundaries are mandatory. Secrets, auth/session parameters, crypto assumptions, legal integrity, jurisdiction controls, and trade correctness values require restricted handling.

## What counts as a finding

A finding is any meaningful value or rule that controls behavior and is stored or implied by one or more of:

- literal constant,
- code fallback,
- env var,
- schema default,
- seeded DB row,
- runtime DB config,
- UI-only control,
- deployment manifest value,
- secret reference,
- duplicate or drifted source of truth.

## Mandatory question set for each finding

1. What is the setting, value, or rule?
2. Where exactly is it defined and consumed?
3. What behavior does it control?
4. What is its current value type?
5. What is its current source of truth?
6. Is it surfaced in admin?
7. Is it wired end to end?
8. Is it duplicated elsewhere?
9. Should it be admin-managed?
10. Should it instead be env/deploy config?
11. Should it remain a code invariant?
12. Can it change at runtime safely?
13. If not, what scope is required: reload, restart, deploy, or migration?
14. What is the blast radius if changed badly?
15. What validation and bounds are required?
16. What RBAC scope should own it?
17. What audit event must be written on change?
18. What caches, workers, websockets, or clients must refresh?
19. What tests must exist to stop drift from returning?

## Canonical class model

### Class 1 - Admin Runtime Config

Safe and valuable to edit in admin with runtime propagation.

Examples to look for in this repo:

- global performance knobs already flowing through `global-settings:updated`
- challenge evaluation cadence if worker loop truly re-reads it live
- quote subscription policy if live invalidation is already wired

### Class 2 - Admin Config Requiring Controlled Reload

Admin-managed, but not safe as a pure live mutation. Requires subsystem refresh, worker recycle, cache flush, or rolling restart.

Examples to test for:

- provider routing config that requires quote feed reload
- i18n worker model/provider changes
- batch/export worker queue parameters

### Class 3 - Environment / Deployment Config

Belongs in env, Kubernetes, GitOps, compose, or deployment manifests, not normal admin UI.

Examples to test for:

- hostnames, ports, ingress rules, HPA thresholds, bucket endpoints
- Capacitor server URL override
- website trading-app origin

### Class 4 - Secrets / Sensitive Material

Must never live in plaintext code or broad admin forms.

Examples already visible in repo:

- `SESSION_SECRET`
- `EMAIL_VERIFY_TOKEN_SECRET`
- `LEGAL_TERMS_HMAC_SECRET`
- provider API keys referenced through `env:...`

### Class 5 - Code-Level Invariants

Structural or correctness-critical values that should stay in code.

Examples to test for:

- websocket protocol versioning
- fixed enum mappings that define protocol correctness
- cryptographic envelope or audit-chain invariants

### Class 6 - Data-Modeled Rules

Should move into versioned DB-backed policy/config records instead of living as service logic.

Examples to look for:

- risk gates, jurisdiction policies, eligibility rules, challenge rules, enforcement thresholds

### Class 7 - Dead / Legacy / Duplicate / Drifted Config

Unused, shadow, conflicting, deprecated, or stale settings that should be consolidated or removed.

Examples to look for:

- UI controls with no backend consumer
- DB fields nobody reads
- env vars overridden by code defaults
- mobile/native host copies drifting from server/web behavior

## Governance model to evaluate

Every finding must be placed into a precedence chain:

1. Code invariants
2. Secret store
3. Deployment/env config
4. DB-backed runtime config
5. Tenant/account/role/user override
6. Request/session override if explicitly allowed

If precedence is ambiguous in live code, flag it.

## Safety rules for recommendations

Never recommend unrestricted admin editability for:

- raw secrets,
- crypto assumptions,
- protocol invariants,
- session/cookie/auth core parameters without restricted workflow,
- trade correctness thresholds without hard validation,
- anything that can corrupt quotes, orders, money flows, audit chains, or legal acceptance integrity.

Dangerous settings require:

- restricted RBAC,
- explicit validation bounds,
- change confirmation UX,
- audit logging,
- propagation model,
- rollback path,
- effective-value visibility.

## Evidence standard

- Use literal and semantic search.
- Cite exact file paths for every major claim.
- When using prior reports, state whether live code confirms, disproves, or partially matches them.
- Preserve a clear line between observed evidence and inferred recommendation.

## Required search families

- literal assignments and fallbacks: `const`, `default`, `fallback`, `??`, `||`
- timers and schedulers: `setTimeout`, `setInterval`, cron, `heartbeat`, `refresh`, `ttl`
- transport tuning: `staleTime`, `gcTime`, reconnect, backoff, retry
- limits and thresholds: `pageSize`, `limit`, `max`, `min`, `threshold`, `window`, `retention`
- endpoints and locators: URLs, ports, hostnames, namespaces, bucket names
- schema defaults: `.default(` and Drizzle column defaults
- env parsing and bootstrap defaults
- TODO/HACK/temporary comments that hide transitional config
