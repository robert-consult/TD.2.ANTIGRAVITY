---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - Documentation/
  - README.md
  - PROJECT_STRUCTURE.md
  - WEBSITE/README.md
  - server/
  - client/
last_verified: 2026-03-27
status: maintained
---

# Repository Documentation Audit

Verified against the current tree on 2026-03-27.

Current findings:

- the legacy `Documentation/` set is broad but too compressed for the size and complexity of the repo
- factual drift exists in API paths, WS message names, tech-version references, and runtime ownership descriptions
- audience boundaries were previously mixed between public, internal, and agent-oriented material
- navigation depended on hand-written summaries instead of source-derived catalogs for the most drift-prone areas

Immediate remediation introduced in this program:

- separate public and internal lanes
- generated reference lane for source-derived catalogs
- documentation-enhancement workspace for audit and migration control
- validation and generation scripts to reduce future drift

Revisit coverage update:

- first-pass maintained docs captured the app runtime and core journeys, but not every top-level repo area explicitly
- whole-repo capture now includes a generated [Repository Inventory](../generated/Repository_Inventory.md) plus maintained internal coverage for mobile/native, infra/ops, and support/archive modules
- support modules and artifacts are now classified instead of being left implicit
