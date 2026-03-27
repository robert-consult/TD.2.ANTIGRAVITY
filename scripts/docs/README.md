# Docs Toolkit

Reusable documentation automation for this repo lives under `scripts/docs/`.

## Layout

- `lib/`
  - shared filesystem, path, and markdown helpers
- `generators/`
  - one folder per generated documentation surface
  - `index.ts` in each folder exports `build*` and `generate*`
- `validators/`
  - documentation validation logic for maintained docs and generated freshness
- `generate.ts`
  - central runner for all generator tasks
- `validate.ts`
  - central validator entrypoint
- legacy flat files
  - compatibility shims for older imports and commands

## Current Generator Modules

- `generators/rest/`
- `generators/ws/`
- `generators/env/`
- `generators/runtime/`
- `generators/repository/`

## Usage

```bash
npm run docs:generate
npm run docs:validate
npm run docs:check
```

## Reuse Rules

- add new generated surfaces under `scripts/docs/generators/<name>/index.ts`
- keep generator output paths inside the module so each generator is self-contained
- use `scripts/docs/lib/shared.ts` instead of ad hoc file/path helpers
- expose both `build*` and `generate*` so validators can compare expected output without writing files
- update `Documentation/08_Documentation_Enhancement/05_Docs_Automation_Contract.md` when the toolkit surface changes

For agent workflow, read `scripts/docs/AGENTS.md` before changing or running this toolkit.
