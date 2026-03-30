# Production Readiness Checklist

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `PRODUCTION READINESS/01_CURRENT_STATE_READINESS_AUDIT.md`, `02_ACCESS_AND_CREDENTIAL_MATRIX.md`, `03_SECRET_INVENTORY_AND_KEY_GENERATION.md`

---

## Pre-Deployment Checklist

- [ ] All critical env vars configured per [Environment Variables](../00_Getting_Started/03_Environment_Variables.md)
- [ ] Operator toolchain installed (`npm run ops:toolchain-check`)
- [ ] Secrets generated and SOPS-encrypted (`npm run ops:secrets:generate`)
- [ ] K8s overlay placeholders replaced
- [ ] OVH/RKE2 cluster bootstrapped
- [ ] GitHub Actions configured
- [ ] Argo CD installed and root application applied
- [ ] Market data provider credentials loaded
- [ ] Backup/DR procedures validated
- [ ] Observability stack verified (Grafana, Prometheus, alerts)
- [ ] Canary deployment executed successfully

---

## Full Documentation

See `PRODUCTION READINESS/` folder (11 documents) and [Deployment Runbook →](03_Deployment_Runbook.md).

---

## Related Pages

- [Deployment Runbook →](03_Deployment_Runbook.md)
- [Environment Variables →](../00_Getting_Started/03_Environment_Variables.md)
- [Production Requirements →](../05_Security_Reference/04_Production_Requirements.md)
