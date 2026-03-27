# Definition of Done

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `.agents/release-done.md`

---

## A change is DONE only if…

1. **Correctness:** Relevant tests pass (or best-available verification was run and documented)
2. **Performance:** `.agents/performance.md` checklist completed for changed hot paths
3. **Security:** `.agents/security.md` checklist completed for touched security boundaries
4. **Vulnerabilities:** `.agents/vuln-db.md` cross-check + dependency scans completed for dep/build/container changes
5. **Observability:** `.agents/observability.md` updated when behavior changes
6. **Contracts:** Shared schemas/types updated (`shared/schema.pg.ts`) and clients updated when APIs change

---

## Verification Matrix

### Web/API Changes
```bash
npm run check
npm run build
npm run e2e          # If routes or WS changed
```

### Database/Schema/Migrations
```bash
npm run db:migrate:drizzle
npm run db:audit
npm run db:seed      # If seed or migrations changed
```

### Trading/Quotes Hot Paths
```bash
npm run loadtest:ws-fanout
npm run loadtest:publish-quotes
```

### Mobile
```bash
cd MOBILE && npm run sync       # If web build changes propagate
cd NATIVE && npm test && npm run lint  # If touching RN code
```

---

## Documentation Updates (When Relevant)

- Update runbooks if compliance behavior changed:
  - `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md`
  - `CODEX_COUNTRY_TIMEZONE_CONTROLS.md`
- Update `PROJECT_STRUCTURE.md` if major modules added/renamed

---

## Checklist Confirmation

Before creating a PR or finalizing changes:

- [ ] `.agents/performance.md` (if touching hot paths)
- [ ] `.agents/security.md` (if touching auth/trading/compliance)
- [ ] `.agents/vuln-db.md` (if changing dependencies or security boundaries)
- [ ] `.agents/observability.md` (if behavior changes)

---

## Related Pages

- [Security Guardrails →](../05_Security_Reference/00_Security_Guardrails.md)
- [Adding an API Endpoint →](01_Adding_API_Endpoint.md)
