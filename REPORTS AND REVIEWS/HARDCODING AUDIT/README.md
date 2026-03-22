# Hardcoding / Configurability Audit Pack

Verified against current tree on 2026-03-18.

This folder decomposes the repo-wide hardcoding/configurability audit into bounded workstreams and output documents. It is an execution pack, not a completed finding set. Use it to run the audit in controlled passes without losing cross-system coverage.

## Grounding completed before this pack was written

- Repo router: `AGENTS.md`
- Structure guide: `PROJECT_STRUCTURE.md`
- Audit policy: `.agents/audit-decomposition.md`
- Deep-context map: `.agents/deep-context.md`
- Definition of done: `.agents/release-done.md`
- Performance checklist: `.agents/performance.md`
- Security checklist: `.agents/security.md`
- Production requirements ledger: `.agents/PRODUCTION_REQUIREMENTS.md`
- Subtree guidance: `server/AGENTS.md`, `client/AGENTS.md`, `shared/AGENTS.md`, `db/AGENTS.md`, `MOBILE/AGENTS.md`, `MOBILE/src/mobile/AGENTS.md`, `NATIVE/AGENTS.md`, `NATIVE/src/AGENTS.md`, `WEBSITE/AGENTS.md`, `k8s/AGENTS.md`, `gitops/AGENTS.md`, `scripts/AGENTS.md`

## Confirmed live config control-plane entrypoints

- DB-backed config tables: `shared/schema.pg.base.ts`, `shared/schema.pg.recruitment.ts`, `db/migrations/*`, `db/seed.ts`
- Admin/system config routes: `server/routes/admin.ts`, `server/routes/adminSystemConfig.ts`, `server/routes/adminMarketData.ts`, `server/routes/adminQuoteSubscriptions.ts`, `server/routes/adminI18n.ts`
- Config services/read models: `server/services/globalSettings.ts`, `server/services/globalSettingsAdmin.ts`, `server/services/signupPublicConfig.ts`, `server/services/messagingSettings.ts`, `server/services/quoteSubscriptions.ts`, `server/i18n/config.ts`, `server/recruitment/challengesV4/challengeConfig.ts`
- Propagation layer: `server/services/liveBus.ts`, `client/src/live/ConfigSync.tsx`, `client/src/live/LiveUpdatesProvider.tsx`
- Mobile/native runtime config: `MOBILE/capacitor.config.ts`, `MOBILE/src/mobile/*`, `NATIVE/src/services/runtimeConfig.ts`, `NATIVE/src/services/websocket.ts`, `NATIVE/src/services/csrf.ts`
- Website/runtime links: `WEBSITE/client/src/lib/app-config.ts`, `WEBSITE/server/routes.ts`
- Deployment config surfaces: `k8s/*.yaml`, `k8s/base/*.yaml`, `gitops/argocd/*`, `config/marketdata/providers/*`, `petascale/*`

## Existing report leads to cross-check, not trust blindly

- `REPORTS AND REVIEWS/audit_report.md`
- `REPORTS AND REVIEWS/quotes provider config/PROVIDER_CONFIG_SYSTEM_BREAKDOWN.md`
- `REPORTS AND REVIEWS/4G-3G-5G-2G OPTIMIZATIONS/audit_2_bug_report.md`
- `REPORTS AND REVIEWS/KEEP ME SIGNED IN/product_requirements_document.md`
- `REPORTS AND REVIEWS/Mobile_Native_Audit_2_Fix_Plan.md`
- `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/mailbox_reaudit_report.md`

## Folder map

- `01_AUDIT_OPERATING_MODEL.md`
  - Rules, classes, governance, evidence standard, safety boundaries.
- `02_MASTER_FLOW_AND_WORKSTREAMS.md`
  - Phase flow, dependency graph, manageable workstreams, expected output per pass.
- `03_REPO_ENTRYPOINTS_AND_PRIOR_LEADS.md`
  - Exact repo paths to inspect per domain and the archived reports that may contain drift.
- `04_FINDINGS_SCHEMA_SCORING_AND_CLASSIFICATION.md`
  - Canonical finding schema, risk/scoring model, propagation scopes, status taxonomy.
- `05_OUTPUT_ASSEMBLY_PLAN.md`
  - How the nine required outputs are assembled from the workstreams.
- `06_GOLD_STANDARD_FIX_EXECUTION_RECOMMENDATION.md`
  - Execution-order recommendation for fixing the audit findings without increasing drift.
- `07_WAVE_3_EXPANSION_AND_START.md`
  - Expanded Wave 3 tracks, canonical-owner model, and the completed implementation record for trading risk, scheduler timing, grift runtime policy, and bot coarse-config normalization.
- `08_WAVE_4_COMPLETION.md`
  - Completed Wave 4 implementation record for cross-surface app-origin, deep-link, and session-path alignment across web, wrapper, native, server-generated links, and website CTA links.
- `09_WAVE_5_COMPLETION.md`
  - Completed Wave 5 implementation record for effective-value inspection, deploy-owned config visibility, rollback/apply trace visibility, and doc/live reconciliation.
- `OUTPUT_1_EXECUTIVE_SUMMARY.md` through `OUTPUT_9_EVIDENCE_APPENDIX.md`
  - Output-ready report shells to be filled during the audit.

## Use sequence

1. Read `01_AUDIT_OPERATING_MODEL.md`.
2. Execute `02_MASTER_FLOW_AND_WORKSTREAMS.md` in order.
3. Use `03_REPO_ENTRYPOINTS_AND_PRIOR_LEADS.md` to keep scans repo-grounded.
4. Record every finding using `04_FINDINGS_SCHEMA_SCORING_AND_CLASSIFICATION.md`.
5. Fill the nine output docs in the order defined by `05_OUTPUT_ASSEMBLY_PLAN.md`.
6. Use `06_GOLD_STANDARD_FIX_EXECUTION_RECOMMENDATION.md` to sequence remediation work.
7. Use `07_WAVE_3_EXPANSION_AND_START.md` for the completed Wave 3 execution breakdown and validation record.
8. Use `08_WAVE_4_COMPLETION.md` for the completed Wave 4 execution breakdown, cross-surface precedence model, and validation record.
9. Use `09_WAVE_5_COMPLETION.md` for the completed Wave 5 governance inspector, deploy-visibility model, and reconciliation record.

## Important constraint

Do not treat this folder as permission to move every setting into admin. The audit must separate:

- runtime admin config,
- controlled-reload admin config,
- environment/deployment config,
- secrets,
- code invariants,
- data-modeled policy,
- dead/duplicate/drifted config.
