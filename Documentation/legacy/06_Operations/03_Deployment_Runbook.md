# Deployment Runbook

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `PRODUCTION READINESS/00_MASTER_EXECUTION_INDEX.md` through `10_PREPROD_VALIDATION_CANARY_AND_GO_LIVE.md`

---

## Execution Order

1. **Access & Credentials** — Gather all missing access per `02_ACCESS_AND_CREDENTIAL_MATRIX.md`
2. **Toolchain** — Run `npm run ops:toolchain-check` and install missing operator tools
3. **Secrets** — Run `npm run ops:secrets:generate` and `npm run ops:sops:bootstrap`
4. **SOPS** — Replace placeholders in overlay secret manifests and encrypt with SOPS
5. **Platform** — Bootstrap OVH/RKE2 per `04_OVH_BARE_METAL_PLATFORM_PLAN.md`
6. **CI** — Configure GitHub repo settings + workflows per `05_GITHUB_ACTIONS_CI_PLAN.md`
7. **GitOps** — Install Argo CD and apply `gitops/argocd/root-application.yaml`
8. **Market Data** — Load Twelve Data credentials per `09_MARKET_DATA_PROVIDER_MODULARITY_AND_TWELVEDATA_CUTOVER.md`
9. **Validate** — Execute backup, observability, and go-live documents in order

---

## Full Documentation

All 11 execution plans are in `PRODUCTION READINESS/`:

| Document | Scope |
|---|---|
| `01_CURRENT_STATE_READINESS_AUDIT.md` | Hard blockers, residual risks |
| `02_ACCESS_AND_CREDENTIAL_MATRIX.md` | Logins, roles, sequence |
| `03_SECRET_INVENTORY_AND_KEY_GENERATION.md` | Bootstrap, storage, rotation |
| `04_OVH_BARE_METAL_PLATFORM_PLAN.md` | Cluster topology, network |
| `05_GITHUB_ACTIONS_CI_PLAN.md` | CI implementation |
| `06_ARGOCD_GITOPS_CD_PLAN.md` | GitOps model |
| `07_STATEFUL_SERVICES_BACKUP_DR_PLAN.md` | Backup/restore |
| `08_OBSERVABILITY_SLOS_SECURITY_OPERATIONS_PLAN.md` | SLOs, alerts |
| `09_MARKET_DATA_PROVIDER_MODULARITY_AND_TWELVEDATA_CUTOVER.md` | Provider cutover |
| `10_PREPROD_VALIDATION_CANARY_AND_GO_LIVE.md` | Canary, go-live |

---

## Related Pages

- [Production Readiness →](06_Production_Readiness.md)
- [Kubernetes →](00_Kubernetes.md)
- [CI/CD →](05_CI_CD.md)
