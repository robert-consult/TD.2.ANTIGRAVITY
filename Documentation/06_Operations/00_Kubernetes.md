# Kubernetes Deployments

> **Diátaxis quadrant:** Reference
> **Sources:** `k8s/` manifests, `k8s/AGENTS.md`, `PRODUCTION READINESS/04_OVH_BARE_METAL_PLATFORM_PLAN.md`

---

## Infrastructure

| Component | Manifest | Purpose |
|---|---|---|
| App deployment | `k8s/base/`, `k8s/overlays/` | API, worker, ingestor pods |
| Secrets | `k8s/02-secrets.yaml` | `tradehub-secrets` |
| PgBouncer | included in k8s stack | Connection pooling |
| Valkey | included in k8s stack | Session + quote cache |
| Monitoring | `k8s/60-monitoring.yaml` | Prometheus scrape config |
| HPA/PDB | included in overlays | Horizontal scaling, disruption budget |
| Network policies | included in overlays | Pod-level network isolation |

---

## Overlays

| Overlay | Path |
|---|---|
| Staging | `k8s/overlays/staging/` |
| Production | `k8s/overlays/prod/` |

---

## Render/Verify

```bash
kubectl kustomize k8s/overlays/staging
kubectl kustomize k8s/overlays/prod
kubectl apply --dry-run=client -f k8s/
```

---

## Related Pages

- [Deployment Runbook →](03_Deployment_Runbook.md)
- [Production Readiness →](06_Production_Readiness.md)
