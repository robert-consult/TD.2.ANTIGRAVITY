# Argo CD GitOps CD Plan

Last updated: 2026-03-09

## Repo Layout Implemented

### Application stack

- base: `k8s/base/`
- overlays:
  - `k8s/overlays/staging/`
  - `k8s/overlays/prod/`

### Ops stack

- base: `ops/kubernetes/`
- overlays:
  - `gitops/kustomize/ops/staging/`
  - `gitops/kustomize/ops/prod/`

### Argo CD application definitions

- project: `gitops/argocd/project-tradehub.yaml`
- root app: `gitops/argocd/root-application.yaml`
- environment apps:
  - `gitops/argocd/staging/tradehub-app.yaml`
  - `gitops/argocd/staging/tradehub-ops.yaml`
  - `gitops/argocd/prod/tradehub-app.yaml`
  - `gitops/argocd/prod/tradehub-ops.yaml`

## Recommended Argo CD Model

- app-of-apps bootstrap using `tradehub-root`
- separate Argo applications for:
  - app stack
  - ops stack
- automated sync with prune and self-heal
- promotion controlled by overlay PRs

## Bootstrap Steps

1. Install Argo CD on the RKE2 cluster.
2. Update all `REPLACE_GITHUB_ORG` placeholders.
3. If using private repo auth, configure repository credentials in Argo CD.
4. Apply:

```bash
kubectl apply -f gitops/argocd/root-application.yaml -n argocd
```

5. Confirm Argo CD creates:
   - `tradehub-staging-app`
   - `tradehub-staging-ops`
   - `tradehub-prod-app`
   - `tradehub-prod-ops`

## Promotion Model

1. GitHub Actions builds immutable image tag.
2. `promote-overlay.yml` updates the target overlay.
3. PR is reviewed and merged.
4. Argo CD sees git change and syncs.
5. For production, use worker-canary-first before the final API-affecting cutover.

## Rollback Model

Preferred rollback:

1. revert the overlay PR or run a new promotion to a prior tag
2. allow Argo CD to sync the previous revision
3. if needed, manually use Argo rollback to the previous successful app revision

## Secrets And SOPS

Repo-side readiness exists:

- `.sops.template.yaml`
- placeholder secret manifests named for SOPS usage

Cluster-side work still required:

- install SOPS decryption support in Argo CD repo-server or CMP plugin path
- provide the `age` private key securely to Argo CD
- confirm encrypted manifests decrypt during sync

## Current Gaps

- overlays still contain placeholders
- repo URL placeholders still exist
- SOPS/age decryption is not yet installed in a cluster
- internal TLS exception is still enabled in overlays

## Acceptance Criteria

- Argo CD apps are Healthy and Synced in staging
- sync drift is zero after a clean deploy
- overlay promotion changes only image/tag and approved env-specific patches
- rollback to a previous image tag is proven in staging
