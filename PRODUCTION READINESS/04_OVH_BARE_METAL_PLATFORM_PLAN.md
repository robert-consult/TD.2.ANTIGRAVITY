# OVH Bare Metal Platform Plan

Last updated: 2026-03-09

## Target State

- 3-node RKE2 cluster on OVH bare metal
- Ubuntu 24.04 LTS on all nodes
- ingress-nginx
- cert-manager
- Argo CD
- Longhorn
- metrics-server

## Recommended Initial Topology

### Minimum production layout

| Node | Role | Suggested Size |
|---|---|---|
| `ovh-tradehub-01` | control-plane + workload | 16 vCPU / 64 GB RAM / NVMe |
| `ovh-tradehub-02` | control-plane + workload | 16 vCPU / 64 GB RAM / NVMe |
| `ovh-tradehub-03` | control-plane + workload | 16 vCPU / 64 GB RAM / NVMe |

Use a separate future scale-out pool for:

- analytics-heavy workloads
- large ClickHouse growth
- public ingress isolation if traffic profile demands it

## Network Model

- public ingress only on `80` and `443`
- SSH only from operator IPs or VPN
- kube API limited to operator/admin network
- all stateful service ports private-only
- if available, place nodes on an OVH private network/vRack for east-west traffic

## Why RKE2

RKE2 is the recommended first implementation here because it gives:

- simpler bootstrap than raw kubeadm
- built-in sensible defaults for a small bare-metal cluster
- easier repeated server bring-up during initial productionization
- a well-understood upgrade path for Kubernetes minor versions

## Required Cluster Add-ons

Install in this order:

1. RKE2
2. metrics-server
3. ingress-nginx
4. cert-manager
5. Longhorn
6. Argo CD

## Storage Plan

The repo already requests persistent volumes for:

- Postgres
- Prometheus
- ClickHouse
- MinIO

Therefore:

- Longhorn or an equivalent dynamic provisioner is mandatory
- do not attempt first production sync without a default `StorageClass`

## TLS Plan

### Public TLS

- use cert-manager with Let’s Encrypt HTTP-01
- ingress hosts:
  - staging: `staging.tradehub.example.com`
  - production: `tradehub.example.com`

### Internal TLS

Current repo state:

- `ops/kubernetes/75-internal-tls.yaml` exists
- app/runtime guardrails exist
- overlays still keep `ALLOW_INSECURE_INTERNAL_TRANSPORT=1`

Meaning:

- the internal TLS program is partially scaffolded
- the repo is not yet on a zero-exception internal transport posture
- complete CA trust, service cert mounts, and client trust wiring before final production hardening

## Bootstrap Sequence

### Host preparation

1. Install Ubuntu 24.04 LTS.
2. Apply OS hardening:
   - disable password SSH
   - install security updates
   - configure NTP
   - enable audit logging if required by ops policy
3. Restrict firewall to:
   - SSH from operator IPs
   - `80/443` public
   - kube control-plane ports only where needed

### RKE2

1. Install first control-plane node.
2. Join the other two nodes.
3. Confirm:
   - node readiness
   - storage visibility
   - CNI health

### Cluster services

1. Install ingress-nginx.
2. Install cert-manager.
3. Install Longhorn and mark the default storage class.
4. Install Argo CD.
5. Install metrics-server.

## OVH Inputs Required From You

- exact server SKUs or current server inventory
- root or sudo SSH access
- whether vRack/private network is available
- public IP layout
- any existing OVH firewall or DDoS policy constraints
- DNS authority location

## Acceptance Criteria

- all 3 nodes are Ready
- default `StorageClass` exists
- ingress-nginx external IP is reachable
- cert-manager can issue a staging certificate
- Argo CD is reachable internally and can sync a test app
- Longhorn can provision and attach PVCs

## Remaining Gaps

- no OVH automation or bootstrap scripts are committed yet
- no cluster exists in this workspace
- internal TLS completion remains a post-bootstrap hardening task
