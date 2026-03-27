# `scripts/docs/` AGENTS.md

## What this area is
Reusable documentation automation for generated catalogs and maintained-doc validation.

## Non-negotiables
- Do not edit generated docs by hand when the source can be derived from code.
- Update live code, source docs, and canonical references first. Run the generators only after the source of truth is current.
- If the docs toolkit changes, update `Documentation/08_Documentation_Enhancement/05_Docs_Automation_Contract.md` in the same change.
- If a repo surface moves or a new top-level module appears, update the repository inventory generator and maintained coverage docs before finalizing.

## Required workflow before running generators
1. Verify the current tree, not historical docs.
2. Update the live source of truth first:
   - route changes: `server/routes.ts`, `server/routes/**`, shared contracts
   - WS changes: `shared/ws/protocol.ts`, `server/routes/wsCore.ts`, `client/src/live/**`
   - env changes: `.env.example`, startup validation, direct source references
   - repo/module-map changes: root docs, module READMEs, `PROJECT_STRUCTURE.md`, maintained internal docs
3. Update maintained docs that describe intent or ownership boundaries.
4. Run `npm run docs:generate`.
5. Run `npm run docs:check`.
6. Only then review generated diffs.

## Structure
- `lib/` shared helpers
- `generators/<surface>/index.ts` normalized generator modules
- `validators/index.ts` normalized validation logic
- flat `generate-*.ts`, `validate-docs.ts`, and `shared.ts` are compatibility shims

## When adding a new generator
- create `scripts/docs/generators/<name>/index.ts`
- export `build*` and `generate*`
- register it in `scripts/docs/generators/index.ts`
- wire any generated file freshness checks into `scripts/docs/validators/index.ts`
- update the docs automation contract and any affected maintained docs
