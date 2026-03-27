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
last_verified: 2026-03-27
status: maintained
---

# Admin Journey

The admin surface is a broad operational control plane, not a single CRUD panel.

Major concerns currently exposed through the admin journey:

- user management and impersonation boundaries
- global settings and system config
- KYC review and compliance workflow
- grift detection and enforcement review
- data exports and rollups
- market-data and quote-subscription control
- scouting, recruitment, and challenge administration
- observability access and operational tooling

Primary boundaries:

- `/api/admin/*` is the dominant namespace
- several admin route modules are mounted directly in `server/routes.ts`
- the UI shell is `client/src/pages/AdminDashboard.tsx`
- admin behavior spans multiple domain route files and support services, not just `server/routes/admin.ts`

Use generated and source-derived references for exact route surfaces:

- [REST API Catalog](../generated/REST_API_Catalog.md)
- [Runtime Inventory](../generated/Runtime_Inventory.md)
