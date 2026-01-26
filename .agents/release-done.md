# Definition of Done (DoD) — TradeQuip

## A change is DONE only if…
1) **Correctness:** relevant tests pass (or the repo’s best-available verification was run and documented).
2) **Performance:** `@/.agents/performance.md` checklist completed for changed hot paths.
3) **Security:** `@/.agents/security.md` checklist completed for touched security boundaries.
4) **Vulns:** `@/.agents/vuln-db.md` cross-check + dependency scans completed for any dep/build/container changes.
5) **Observability:** `@/.agents/observability.md` updated when behavior changes.
6) **Contracts:** shared schemas/types updated (`shared/schema.pg.ts`) and clients updated (web/mobile) when APIs change.

## Minimal verification matrix (pick what matches your change)

### Web/API changes (typical)
- `npm run check`
- `npm run build`
- If routes or WS changed: `npm run e2e` (and/or a targeted runbook step)

### Database/schema/migrations
- `npm run db:migrate:drizzle`
- `npm run db:audit` (CI enforced when DB/schema changes)
- If seed or migrations changed: `npm run db:seed` and verify critical flows

### Trading/quotes hot paths
- `npm run loadtest:ws-fanout`
- `npm run loadtest:publish-quotes`
- Confirm no WS payload blow-ups and no event-loop blocking

### Mobile
- Capacitor: `cd MOBILE && npm run sync` (if web build changes must propagate)
- React Native: `cd NATIVE && npm test` (and `npm run lint` if touching RN code)

## Documentation updates (when relevant)
- Update runbooks if you changed compliance behavior:
  - `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md`
  - `CODEX_COUNTRY_TIMEZONE_CONTROLS.md`
- Update `PROJECT_STRUCTURE.md` if you added/renamed major modules or scripts.

## Checklist Confirmation (recommended)
Before creating a PR or finalizing changes, confirm you have reviewed the applicable checklists:

- [ ] `@/.agents/performance.md` (if touching hot paths)
- [ ] `@/.agents/security.md` (if touching auth/trading/compliance)
- [ ] `@/.agents/vuln-db.md` (if changing dependencies or security boundaries)
- [ ] `@/.agents/observability.md` (if behavior changes)

**Note**: This is a self-check. Consider adding a pre-commit hook or PR template to enforce.

