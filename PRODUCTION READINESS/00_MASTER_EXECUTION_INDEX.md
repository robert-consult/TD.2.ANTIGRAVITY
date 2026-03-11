# TradeQuip Production Readiness Master Index

Last updated: 2026-03-09

## Objective

Target deployment path:

- OVH bare metal
- Ubuntu 24.04 LTS
- RKE2 Kubernetes
- GitHub Actions for CI
- Argo CD for GitOps CD
- SOPS + age for secrets
- Full day-one stack: app, Postgres, Valkey, MinIO, ClickHouse, Prometheus, Grafana

This folder is the execution control plane for taking the current repo to direct production deployment. Every document here is tied to live repo state and the implementation artifacts added in this task.

## Current Status Snapshot

- Repo implementation added:
  - `k8s/base/` plus app overlays under `k8s/overlays/`
  - GitOps ops overlays under `gitops/kustomize/ops/`
  - Argo CD application definitions under `gitops/argocd/`
  - CI/CD workflows under `.github/workflows/`
  - SOPS template and bootstrap scripts
  - production secret-generation script
  - provider-selection hardening for Twelve Data default and no implicit production `FORGE_KEY` fallback
- Verified locally:
  - `npm run check`
  - targeted `vitest` suite for provider and route helpers
  - `npm run build`
  - `kubectl kustomize` renders for:
    - `k8s/overlays/staging`
    - `k8s/overlays/prod`
    - `gitops/kustomize/ops/staging`
    - `gitops/kustomize/ops/prod`
    - `gitops/argocd`
- Not fully validated from this workspace:
  - `kubectl apply --dry-run=client -f ...`
  - real GitHub Actions execution
  - actual OVH/RKE2 cluster bootstrap
  - SOPS/age install on this host
- High-priority remaining blockers:
  - third-party keys not yet supplied: Twilio, Resend, Twelve Data
  - OVH and DNS access not yet supplied
  - local operator toolchain is missing most production CLIs
  - internal TLS is scaffolded but not yet fully enforced end-to-end; current overlays keep `ALLOW_INSECURE_INTERNAL_TRANSPORT=1`

## Documents

| File | Purpose | Primary Outcome |
|---|---|---|
| `01_CURRENT_STATE_READINESS_AUDIT.md` | Repo-grounded readiness audit | hard blockers, implemented state, residual risk |
| `02_ACCESS_AND_CREDENTIAL_MATRIX.md` | Access matrix | exact logins, roles, sequence, ownership |
| `03_SECRET_INVENTORY_AND_KEY_GENERATION.md` | Secrets and key operations | bootstrap, storage, rotation, incident response |
| `04_OVH_BARE_METAL_PLATFORM_PLAN.md` | OVH/RKE2 platform plan | cluster topology, network, storage, bootstrap |
| `05_GITHUB_ACTIONS_CI_PLAN.md` | CI implementation and rollout | branch gates, build, scan, release workflows |
| `06_ARGOCD_GITOPS_CD_PLAN.md` | Argo CD operating model | app-of-apps, overlays, promotion, rollback |
| `07_STATEFUL_SERVICES_BACKUP_DR_PLAN.md` | Backup and DR | service-by-service backup/restore execution |
| `08_OBSERVABILITY_SLOS_SECURITY_OPERATIONS_PLAN.md` | Ops and security posture | dashboards, alerts, SLOs, incident actions |
| `09_MARKET_DATA_PROVIDER_MODULARITY_AND_TWELVEDATA_CUTOVER.md` | Market-data cutover | Twelve Data production activation path |
| `10_PREPROD_VALIDATION_CANARY_AND_GO_LIVE.md` | Final release execution | preprod gates, canary, cutover, rollback |

## Live Repo Artifacts Added Or Updated

- CI/CD
  - `.github/workflows/ci.yml`
  - `.github/workflows/release-build.yml`
  - `.github/workflows/nightly-security.yml`
  - `.github/workflows/promote-overlay.yml`
- GitOps
  - `gitops/argocd/`
  - `gitops/kustomize/ops/`
- Kubernetes
  - `k8s/base/`
  - `k8s/overlays/staging/`
  - `k8s/overlays/prod/`
  - `k8s/kustomization.yaml`
- Secrets/bootstrap
  - `.sops.template.yaml`
  - `scripts/ops/check_required_toolchain.sh`
  - `scripts/ops/bootstrap_sops_age.sh`
  - `scripts/ops/generateProductionSecrets.ts`
  - `scripts/ops/updateKustomizeImage.ts`
- Runtime hardening
  - `server/marketdata/providerManager.ts`
  - `server/routes/market.ts`
  - `server/routes/public/diagnostics.ts`
  - `server/services/priceFeedDiagnostics.ts`
  - defaults in `db/seed.ts`, `server/i18n/config.ts`, `server/partner/inquiryRouting.ts`, `server/routes/admin.ts`, `server/routes/adminScout/candidates.ts`

## Execution Order

1. Read `02_ACCESS_AND_CREDENTIAL_MATRIX.md` and gather all missing access.
2. Run `npm run ops:toolchain-check` and install missing operator tooling.
3. Run `npm run ops:secrets:generate` and `npm run ops:sops:bootstrap`.
4. Replace placeholders in overlay secret manifests and encrypt them with SOPS.
5. Bootstrap OVH servers and RKE2 per `04_OVH_BARE_METAL_PLATFORM_PLAN.md`.
6. Configure GitHub repository settings and workflows per `05_GITHUB_ACTIONS_CI_PLAN.md`.
7. Install Argo CD and apply `gitops/argocd/root-application.yaml`.
8. Load Twelve Data credentials and complete the provider cutover in `09_MARKET_DATA_PROVIDER_MODULARITY_AND_TWELVEDATA_CUTOVER.md`.
9. Execute backup, observability, and go-live validation documents in order.

## User Inputs Still Required

- GitHub org/repo canonical URL to replace `REPLACE_GITHUB_ORG`
- production and staging domains
- OVH server inventory and access
- operator SSH source IPs / VPN model
- Twilio credentials
- Resend API key and sending domain
- Twelve Data API key
- alert destination endpoints
- decision on GHCR vs existing private registry

## Validation Notes

- `kubectl kustomize` render passed for the new app, ops, and Argo paths.
- `kubectl apply --dry-run=client` still attempted API discovery against `127.0.0.1:6443` in this sandbox. Final manifest validation must be re-run against a host with a usable `kubectl` client environment or an actual cluster context.

## Program Outcome

The repo is now materially closer to production execution:

- deployment paths exist
- GitOps paths exist
- CI/CD workflows exist
- bootstrap scripts exist
- provider modularity is hardened

The repo is not yet ready for immediate production sync without external actions:

- credentials and access must be supplied
- operator toolchain must be installed
- overlay placeholders must be replaced and encrypted
- OVH cluster and DNS must be provisioned
- internal TLS hardening still needs completion before a no-exception production posture
