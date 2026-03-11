# GitHub Actions CI Plan

Last updated: 2026-03-09

## Repo Implementation

This task added or updated:

- `.github/workflows/ci.yml`
- `.github/workflows/release-build.yml`
- `.github/workflows/nightly-security.yml`
- `.github/workflows/promote-overlay.yml`

## Workflow Breakdown

### `PR CI`

Purpose:

- compile safety
- targeted unit coverage
- Kustomize render validation

What it does:

- `npm ci`
- `npm run check`
- targeted `vitest` suite
- `npm run build`
- render:
  - app staging/prod overlays
  - ops staging/prod overlays
  - Argo CD application bundle

### `Release Build`

Purpose:

- produce the deployable image artifact
- push to GHCR
- sign it
- generate SBOM
- scan the published image

What it does:

- Buildx build using `Dockerfile`
- push immutable tag `git-${sha}`
- sign with cosign using GitHub OIDC
- generate SBOM
- run grype-based image scan

### `Nightly Security`

Purpose:

- keep dependency and config risk visible outside the PR path

What it does:

- `npm audit --audit-level=high`
- `npm outdated`
- Trivy repo scan for vulnerability, config, and secret findings

### `Promote Overlay`

Purpose:

- update the image tag in the GitOps app overlay via PR

What it does:

- runs `scripts/ops/updateKustomizeImage.ts`
- opens a PR with the overlay change

## Required GitHub Configuration

### Branch protection

Apply to `main`:

- require pull request before merge
- require at least 1 reviewer
- require status checks:
  - `app-ci`
  - `manifest-ci`
  - `db-audit`
- block direct pushes

### Environments

Create:

- `staging`
- `production`

Recommended rules:

- `staging`: optional or light approval
- `production`: required approver(s), no self-approval if your process requires separation

### Packages / Registry

Default plan:

- publish to GHCR

If you must retain `registry.equitywaves.com`, update:

- workflow login target
- overlay image `newName`
- any cluster imagePullSecrets

## How We Should Integrate CI With CD

Recommended operating model:

1. Merge to `main`.
2. `Release Build` publishes `ghcr.io/<org>/tradequip:git-<sha>`.
3. Operator or automation runs `Promote Overlay` for `staging`.
4. Argo CD syncs staging from git.
5. Staging validation passes.
6. Operator runs `Promote Overlay` for `prod`.
7. Production overlay PR is reviewed and merged.
8. Argo CD syncs production.

This keeps:

- build responsibility in GitHub Actions
- deployment authority in Argo CD
- approvals in GitHub PR flow

## Inputs Still Needed From You

- final GitHub org/repo path to replace `REPLACE_GITHUB_ORG`
- confirmation GHCR is acceptable
- repo admin access for branch protection and environments

## Residual Gaps

- workflows have not yet run in the live GitHub repo
- branch protection must be configured manually by a repo admin
- environment approval policy must still be set by a repo admin
