---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - config/
  - design/
  - security/
  - REPORTS AND REVIEWS/
  - attached_assets/
  - admin_data_exports/
  - data/
  - migration_imports/
  - db_backups/
  - test-results/
last_verified: 2026-03-27
status: maintained
---

# Repo Supporting Modules

Not every top-level repo area is runtime product code. This page captures the supporting modules, archives, and artifacts so they are not silently omitted from the documentation model.

## Source And Support Modules

- `config/` holds application configuration inputs such as market-data provider config
- `design/` and `design_guidelines.md` hold design assets and UI guidance
- `security/` holds repo-local security materials including the vulnerability database inputs
- `scripts/` and `e2e/` are execution and verification surfaces, not just incidental utilities

## Archives And Historical Inputs

- `REPORTS AND REVIEWS/` is a large archive of historical audits and review material
- root audit and tracker markdown files are supporting references and invariant notes, not substitute documentation for current code
- `attached_assets/` holds local working inputs and prompt/design attachments

## Generated And Runtime Artifacts

- `admin_data_exports/`, `db_backups/`, `dist/`, and `test-results/` are generated outputs
- `data/` and `migration_imports/` are repo-local data inputs or migration support material
- local DB and log files at the repo root are workspace artifacts, not maintained source modules

Use [Repository Inventory](../generated/Repository_Inventory.md) as the authoritative whole-repo index for these areas.
