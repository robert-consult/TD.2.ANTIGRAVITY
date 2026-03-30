---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/pages/AdminDashboard.tsx
  - server/routes/admin.ts
  - server/routes/adminSecurity.ts
  - server/routes/adminKyc.ts
  - server/routes/adminDataExports.ts
  - server/routes/adminInstitutionalAudit.ts
  - server/routes/adminTraderScouting.ts
  - server/routes/adminOps.ts
  - server/routes/adminSystemConfig.ts
  - server/routes/adminScout.ts
last_verified: 2026-03-29
status: maintained
---

# Admin Journey

The admin surface is a broad operational control plane, not a single CRUD panel.

## Major Concern Areas

- user management and impersonation boundaries
- global settings and system config
- KYC review and compliance workflow
- grift detection and enforcement review
- data exports and rollups
- market-data and quote-subscription control
- scouting, recruitment, and challenge administration
- observability access and operational tooling

## Runtime Shape

- `/api/admin/*` is the dominant namespace
- several admin route modules are mounted directly in `server/routes.ts`
- the UI shell is `client/src/pages/AdminDashboard.tsx`
- admin behavior spans multiple domain route files and support services, not just `server/routes/admin.ts`

## Key Operational Lanes

- user and impersonation: `server/routes/adminUsers.ts`, plus the authenticated-shell impersonation banner and stop flow
- governance/system config/runtime controls: `server/routes/adminGovernance.ts`, `server/routes/adminSystemConfig.ts`, `server/services/runtimeGovernance.ts`
- legal and compliance: `server/routes/adminLegal.ts`, `server/routes/adminLegalDocs.ts`, `server/routes/adminLegalAcceptances.ts`, `server/routes/adminKyc.ts`
- audit and activity: `server/routes/adminInstitutionalAudit.ts`, `server/routes/adminActivity.ts`, `server/services/adminAuditTrail.ts`
- scouting, challenges, and partners: `server/routes/adminScout.ts`, `server/routes/adminTraderScouting.ts`, `server/routes/adminScout/`
- data exports and rollups: `server/routes/adminDataExports.ts`, `server/services/adminDataExportQueue.ts`, `server/services/adminDataRollups.ts`
- ops/browser tooling access: `server/routes/adminOps.ts` and ingress-auth surfaces documented in ops assets

## Documentation Rules

- exact admin endpoint lists belong in [REST API Catalog](../generated/REST_API_Catalog.md)
- queue/worker/operator startup belongs in [Runtime Inventory](../generated/Runtime_Inventory.md)
- incident response, production readiness, and ingress/operator details stay internal and should live in ops/runbook docs, not public docs

Use generated and source-derived references for exact route surfaces:

- [REST API Catalog](../generated/REST_API_Catalog.md)
- [Runtime Inventory](../generated/Runtime_Inventory.md)
