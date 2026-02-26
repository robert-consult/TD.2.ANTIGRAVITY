# TD.2.ANTIGRAVITY Petascale Ops Engine

This `ops/` directory acts as the strict operational boundary for the Petascale Infrastructure deployments on OVH Bare Metal. 
It strictly segregates Observability (Dashboards/Alerts), Chaos Engineering, Security Fuzzing, and Incident Response playbooks from the core application source code.

## Sub-Modules

### `/alerts`
Prometheus `Rule` files. Defines the mathematical boundaries for when the on-call engineer should be paged (e.g., Export Pipeline starvation, ClickHouse lag, Queue backup).

### `/chaos`
Active synthetic workload generators and cluster disruption scripts. Used during pre-flight certification drills to prove resiliency under billion-row loads, connection storms, and pod termination events.

### `/dashboards`
Hard-coded, version-controlled Grafana JSON models capturing System Health, ClickHouse Saturation, and Export Pipeline telemetry.

### `/runbooks`
Actionable Incident Response guides indexed directly to the alerts fired by `petascale-alerts.yaml`. Detailed with strict CLI/Kubectl commands relative to this specific application.

### `/security`
Stand-alone scripts, fuzzers, and templates used for neutralizing injection vectors and managing Zero-Trust secrets architectures dynamically.

---
*No business logic, API mappings, or React components should ever be imported into this tree path.*

## Deployment helpers (optional)
- Grafana dashboards: `./ops/deploy-grafana.sh`
- Prometheus OPS alert rules: `./ops/deploy-prometheus-alerts.sh`

## Canonical Kubernetes Apply Path
- Source of truth for ops resources: `ops/kubernetes/`
- Canonical apply command: `kubectl apply -k ops/kubernetes`
- Optional internal-TLS bundle (requires cert-manager CRDs): `kubectl apply -f ops/kubernetes/75-internal-tls.yaml`

### Pre-apply prerequisites
- Ensure dashboard ConfigMaps exist (`tradehub-dashboards`, `pigsty-*`) as referenced by `ops/kubernetes/grafana-deployment.yaml`.
- Create MinIO monitor app/static ConfigMaps:
  - `kubectl create configmap tradehub-minio-monitor-app --from-file=app.py=ops/minio-monitor/app.py -n tradehub --dry-run=client -o yaml | kubectl apply -f -`
  - `kubectl create configmap tradehub-minio-monitor-static --from-file=index.html=ops/minio-monitor/static/index.html --from-file=app.js=ops/minio-monitor/static/app.js --from-file=styles.css=ops/minio-monitor/static/styles.css -n tradehub --dry-run=client -o yaml | kubectl apply -f -`

### Auth-gated admin surfaces
- Headlamp ingress uses app-session auth:
  - `ops/kubernetes/headlamp-ingress.yaml` -> `resource=headlamp`
- Bull-board ingress uses app-session auth:
  - `ops/kubernetes/bull-board-ingress.yaml` -> `resource=bullboard`
- MinIO monitor ingress uses app-session auth:
  - `ops/kubernetes/minio-monitor-deployment.yaml` -> `resource=minio-monitor`
- Auth backend endpoint:
  - `GET /api/admin/ops/ingress-auth?resource=<headlamp|bullboard|minio-monitor|grafana>`
