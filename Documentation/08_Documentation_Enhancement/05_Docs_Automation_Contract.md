---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - scripts/docs/
  - package.json
  - scripts/docs/README.md
  - scripts/docs/AGENTS.md
last_verified: 2026-03-29
status: maintained
---

# Docs Automation Contract

Commands:

- `npm run docs:generate`
- `npm run docs:validate`
- `npm run docs:check`

Current generators:

- `scripts/docs/generators/rest/index.ts`
- `scripts/docs/generators/ws/index.ts`
- `scripts/docs/generators/env/index.ts`
- `scripts/docs/generators/runtime/index.ts`
- `scripts/docs/generators/repository/index.ts`

Normalized entrypoints:

- `scripts/docs/generate.ts`
- `scripts/docs/validate.ts`

Guidance:

- human reuse guide: `scripts/docs/README.md`
- agent workflow guide: `scripts/docs/AGENTS.md`
- flat `scripts/docs/generate-*.ts`, `scripts/docs/validate-docs.ts`, and `scripts/docs/shared.ts` remain as compatibility shims

Validation expectations:

- generated docs must match current source
- maintained docs must have required metadata
- markdown links must resolve
- path references in maintained docs must resolve
- `npm run` commands in maintained docs must exist in the correct package scope
- public docs must not reference internal-only material
- maintained `public/`, `internal/`, and `generated/` docs must not reference legacy archive paths
- enhancement docs may discuss the legacy archive and migration matrix

Scope:

- maintained docs are the new `public/`, `internal/`, `generated/`, and `08_Documentation_Enhancement/` lanes plus aligned root/module source docs
- whole-repo capture includes a generated repository inventory so non-product modules and runtime artifacts are explicitly classified
- `Documentation/legacy/` is a frozen archive and is intentionally excluded from docs validation
