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
