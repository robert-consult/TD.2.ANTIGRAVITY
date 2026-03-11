# Current State Readiness Audit

Last updated: 2026-03-09

## Scope

This audit covers:

- runtime boot and secret enforcement
- market-data provider modularity
- Kubernetes deployment state
- CI/CD automation
- GitOps delivery
- secret handling
- observability
- backup/DR posture
- go-live blockers for OVH bare metal

## Executive Verdict

The repo is now staging-bootstrap capable but not production-cutover ready.

What is now implemented in repo:

- app overlays and Argo CD manifests exist
- GitHub Actions CI, release build, nightly security, and promotion workflows exist
- SOPS bootstrap template and secret-generation scripts exist
- Twelve Data is the default provider path in seeds and singleton config creation
- production provider selection no longer silently falls back to `FORGE_KEY`
- active diagnostics and legacy market endpoints now route through the provider manager instead of a hardcoded 1Forge path

What still blocks a direct production deployment:

- no real third-party production credentials are present
- no OVH cluster exists in this workspace
- no Argo CD/SOPS runtime integration has been applied to a cluster
- internal TLS is not yet enforced end-to-end; overlays still use the private-network exception
- backup automation is still a plan, not yet a committed CronJob/operator implementation

## Repo-Grounded Findings

### Runtime and startup controls

Strong points:

- `server/index.ts` already fail-fast validates critical secrets.
- `server/services/petascaleEnv.ts` already rejects insecure internal transport in production unless explicitly allowed.
- `server/routes/wsCore.ts` already exposes internal transport metrics.

Current implementation effect:

- production manifests explicitly set `MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK=0`
- root Kubernetes config keeps `ALLOW_INSECURE_INTERNAL_TRANSPORT=1` to avoid a stricter-but-broken cluster state before service TLS and CA trust are fully wired

Assessment:

- runtime guardrails are strong
- manifest defaults still need final hardening before a zero-exception production launch

### Market-data provider modularity

Strong points:

- provider schema and drivers already existed in `shared/marketDataProviders.ts`, `server/marketdata/providerRegistry.ts`, and `server/marketdata/providers/*`
- admin provider routes already existed in `server/routes/adminMarketData.ts`
- provider file sync already existed in `server/marketdata/providerConfigFiles.ts`

Changes made in this task:

- `server/marketdata/providerManager.ts`
  - production default candidate is now `twelvedata`
  - legacy env fallback is disabled by default in production
  - selection order is deterministic and test-covered
- singleton `system_config` creation now defaults `marketDataActiveProviderKey` to `twelvedata`
- `server/routes/market.ts` now uses the active provider manager
- `server/routes/public/diagnostics.ts` now reports active-provider status instead of 1Forge-only key state

Residual gap:

- several legacy utility files under `server/utils/` still contain 1Forge-specific historical-close helpers. They are not part of the active startup or live market API path, but they should be reviewed before any feature that depends on them is used in production.

### Kubernetes delivery

Implemented:

- base manifest path: `k8s/base/`
- overlay manifests:
  - `k8s/overlays/staging/`
  - `k8s/overlays/prod/`
- base render root: `k8s/kustomization.yaml`
- app overlay secrets are templated in the overlays and ready to be encrypted

Assessment:

- app GitOps structure exists and renders
- secrets are still placeholders
- internal TLS remains staged but not fully activated

### Ops and observability delivery

Implemented:

- ops base remains in `ops/kubernetes/`
- dashboard and MinIO monitor assets are now vendored under `ops/kubernetes/assets/` so Kustomize can render them safely
- ops overlays exist under:
  - `gitops/kustomize/ops/staging/`
  - `gitops/kustomize/ops/prod/`
- Argo CD applications point to those overlays

Assessment:

- Grafana and dashboard provisioning are now repo-renderable
- Grafana admin secret remains placeholder-only until encrypted
- alert receivers and real notification routing still need operator configuration

### CI/CD

Implemented:

- `PR CI`: typecheck, targeted vitest suite, build, Kustomize render
- `Release Build`: image build, GHCR push, cosign signing, SBOM, grype scan
- `Nightly Security`: npm audit, stale dependency report, Trivy repo scan
- `Promote Overlay`: controlled overlay image update via PR

Assessment:

- CI/CD structure now matches the intended GitHub Actions + Argo CD split
- workflows have not yet been exercised in the real GitHub repo
- branch protections and GitHub Environments still must be configured by repo admins

### Secrets and key management

Implemented:

- `.sops.template.yaml`
- `scripts/ops/generateProductionSecrets.ts`
- `scripts/ops/bootstrap_sops_age.sh`
- overlay secret templates for app and Grafana

Assessment:

- repo side bootstrap exists
- workstation and cluster side SOPS/age install is still outstanding
- Argo CD repo-server decryption path is still an operational task, not yet a committed cluster manifest

### Backup and DR

Current state:

- manual Postgres backup helper already exists: `scripts/db-backup.sh`
- app manifests include PVC-backed stateful services

Missing:

- Longhorn snapshot policy manifests
- Postgres WAL/PITR automation
- MinIO replication/export job automation
- ClickHouse backup automation
- restore drill evidence

Assessment:

- not production ready yet

### OVH platform readiness

Current state:

- no OVH-specific IaC exists in repo
- no RKE2 bootstrap scripts are committed
- no StorageClass or Longhorn install manifests are committed

Assessment:

- platform is planned but not yet provisioned
- this remains a major external execution workstream

## Gap Register

### Critical

- Production secrets and third-party credentials are absent.
- OVH bare-metal infrastructure is not yet provisioned.
- Internal TLS is not fully implemented end-to-end.
- Backup automation and restore drills are not yet implemented.

### High

- GitHub Environments, branch protection, and GHCR settings still need admin execution.
- Argo CD decryption/runtime setup for SOPS is not yet applied to any cluster.
- Overlay placeholders still contain `REPLACE_*` values and repo URL placeholders.

### Medium

- Large frontend chunks remain; not a deploy blocker, but an operational efficiency concern.
- Legacy 1Forge historical-close utilities remain in the tree and should be reviewed before use.

## Validation Evidence

- `npm run check`: passed
- `npx vitest run server/marketdata/providerManager.test.ts server/feeds/forgeUtils.test.ts server/feeds/simulationPolicy.test.ts server/routes/quoteSubscriptions.utils.test.ts server/routes/auth/login.session.test.ts`: passed
- `npm run build`: passed
- `kubectl kustomize` render passed for:
  - app staging/prod overlays
  - ops staging/prod overlays
  - Argo CD application bundle
- `kubectl apply --dry-run=client`: blocked in this sandbox by API discovery attempts against `127.0.0.1:6443`

## Deployment Decision

Proceed to:

- toolchain install
- credential intake
- OVH platform bootstrap
- GitHub repo configuration
- staging deployment

Do not proceed to:

- production sync
- live domain cutover
- active user traffic

until the blockers in this document and `10_PREPROD_VALIDATION_CANARY_AND_GO_LIVE.md` are cleared.
