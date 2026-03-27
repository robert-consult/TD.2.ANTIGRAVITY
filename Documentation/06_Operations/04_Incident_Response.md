# Incident Response Runbooks

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `ops/runbooks/`, `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md`

---

## Available Runbooks

| Runbook | Location | Trigger |
|---|---|---|
| Analytics staleness | `ops/runbooks/RUNBOOK_ANALYTICS_STALENESS.md` | ClickHouse sync lag |
| Cache collapse | `ops/runbooks/RUNBOOK_CACHE_COLLAPSE.md` | Valkey failure |
| Data exfiltration | `ops/runbooks/RUNBOOK_DATA_EXFILTRATION.md` | Suspected data leak |
| DDoS/DoS response | `ops/runbooks/RUNBOOK_DDOS_DOS_RESPONSE.md` | Traffic spike/attack |
| Export pipeline stall | `ops/runbooks/RUNBOOK_EXPORT_PIPELINE_STALL.md` | Export queue backup |
| Internal TLS | `ops/runbooks/RUNBOOK_INTERNAL_TLS.md` | TLS cert issues |
| Worker canary cutover | `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md` | Rolling deployment |

---

## Related Pages

- [Observability →](01_Observability.md)
- [Deployment Runbook →](03_Deployment_Runbook.md)
