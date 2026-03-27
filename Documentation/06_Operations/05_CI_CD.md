# CI/CD Pipeline

> **Diátaxis quadrant:** Reference
> **Sources:** `.github/workflows/`, `PRODUCTION READINESS/05_GITHUB_ACTIONS_CI_PLAN.md`

---

## GitHub Actions Workflows

| Workflow | File | Trigger |
|---|---|---|
| CI (lint, test, build) | `.github/workflows/ci.yml` | Push, PR |
| DB audit | `.github/workflows/db-audit.yml` | Schema/migration changes |
| Release build | `.github/workflows/release-build.yml` | Tag push |
| Nightly security | `.github/workflows/nightly-security.yml` | Cron (nightly) |
| Overlay promotion | `.github/workflows/promote-overlay.yml` | Manual dispatch |

---

## CI Pipeline Stages

1. **Install** — `npm ci` (lockfile-pinned)
2. **Type check** — `npm run check`
3. **Build** — `npm run build`
4. **DB audit** — `npm run db:audit` (when schema changes)
5. **Security scan** — `npm audit` / `osv-scanner`
6. **E2E tests** — `npm run e2e` (when routes/WS change)

---

## GitOps (Argo CD)

| Component | Location |
|---|---|
| Application definitions | `gitops/argocd/` |
| Ops overlays | `gitops/kustomize/ops/` |
| Root application | `gitops/argocd/root-application.yaml` |

---

## Related Pages

- [Deployment Runbook →](03_Deployment_Runbook.md)
- [Kubernetes →](00_Kubernetes.md)
