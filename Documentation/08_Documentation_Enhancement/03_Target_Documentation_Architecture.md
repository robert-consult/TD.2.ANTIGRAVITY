---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - Documentation/
  - scripts/docs/
last_verified: 2026-03-27
status: maintained
---

# Target Documentation Architecture

Target lanes:

- `Documentation/public/`: public-safe GitBook-oriented docs
- `Documentation/internal/`: engineering, operator, reviewer, and agent docs
- `Documentation/generated/`: source-derived catalogs
- `Documentation/08_Documentation_Enhancement/`: audit, migration, and governance material

Metadata standard for maintained pages:

- `audience`
- `exposure`
- `owner`
- `canonical_sources`
- `last_verified`
- `status`
- `generated_from` for generated pages

Rules:

- generated pages are authoritative for drift-prone factual inventories
- generated pages should also cover whole-repo placement when the repo has multiple non-product support surfaces
- public pages must not reference internal-only material
- internal pages should link to generated catalogs instead of re-stating large inventories
- legacy numbered docs remain migration inputs until replaced or retired
