# Secret Inventory And Key Generation

Last updated: 2026-03-09

## Repo Artifacts Added

- `.sops.template.yaml`
- `scripts/ops/check_required_toolchain.sh`
- `scripts/ops/bootstrap_sops_age.sh`
- `scripts/ops/generateProductionSecrets.ts`
- overlay secret templates:
  - `k8s/overlays/staging/tradehub-secrets.sops.yaml`
  - `k8s/overlays/prod/tradehub-secrets.sops.yaml`
  - `gitops/kustomize/ops/staging/grafana-admin.sops.yaml`
  - `gitops/kustomize/ops/prod/grafana-admin.sops.yaml`

## Toolchain Audit From This Host

Detected during implementation:

- present:
  - `kubectl`
- missing:
  - `age`
  - `age-keygen`
  - `sops`
  - `kustomize` standalone
  - `helm`
  - `argocd`
  - `cosign`
  - `syft`
  - `grype`
  - `trivy`
  - `jq`
  - `yq`

Run:

```bash
npm run ops:toolchain-check
```

before any real bootstrap work.

## Secret Inventory

### Self-generated application and platform secrets

| Secret | Why It Exists | Source |
|---|---|---|
| `SESSION_SECRET` | session signing | generated |
| `LEGAL_TERMS_HMAC_SECRET` | legal acceptance integrity | generated |
| `ENCRYPTION_KEY` | at-rest encryption | generated |
| `EMAIL_VERIFY_TOKEN_SECRET` | email verification hardening | generated |
| `SMS_OTP_SECRET` | SMS OTP integrity | generated |
| `CHALLENGE_CERT_VERIFICATION_SECRET` | public verification control | generated |
| `EXPORT_LOCAL_LINK_SIGNING_SECRET` | export link signing | generated |
| `METRICS_AUTH_TOKEN` | external metrics auth if needed | generated |
| `POSTGRES_PASSWORD` | database auth | generated |
| `CLICKHOUSE_PASSWORD` | analytics auth | generated |
| `EXPORT_OBJECT_STORAGE_ACCESS_KEY` | MinIO auth | generated |
| `EXPORT_OBJECT_STORAGE_SECRET_KEY` | MinIO auth | generated |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin access | generated |

### Vendor credentials supplied by you

| Secret | System | Required |
|---|---|---|
| `TWELVE_DATA_API_KEY` | Twelve Data | yes |
| `RESEND_API_KEY` | Resend | yes |
| `TWILIO_ACCOUNT_SID` | Twilio | yes |
| `TWILIO_AUTH_TOKEN` | Twilio | yes |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio | preferred |
| `TWILIO_FROM_NUMBER` | Twilio | fallback if no messaging service SID |

### Runtime connection secrets

| Secret | Notes |
|---|---|
| `DATABASE_URL` | generated bootstrap value uses in-cluster service name |
| `VALKEY_URL` | bootstrap value points at in-cluster Valkey service |
| `CLICKHOUSE_USER` | currently fixed to `tradehub` in templates |
| `CLICKHOUSE_PASSWORD` | generated |

## Generation Workflow

### 1. Generate initial secrets

```bash
npm run ops:secrets:generate
```

Outputs are written to:

- `PRODUCTION READINESS/generated/tradehub-production-secrets.env`
- `PRODUCTION READINESS/generated/tradehub-secrets.stringData.yaml`
- `PRODUCTION READINESS/generated/grafana-admin.stringData.yaml`
- `PRODUCTION READINESS/generated/tradehub-production-secrets.json`

These files are intentionally ignored by git.

### 2. Bootstrap local SOPS configuration

```bash
npm run ops:sops:bootstrap
```

This writes:

- local age private key in `PRODUCTION READINESS/generated/tradehub-prod.agekey`
- local `.sops.yaml` rendered from `.sops.template.yaml`

### 3. Replace placeholders in overlay secret templates

Replace every `REPLACE_*` and `SET_ME` value in:

- `k8s/overlays/staging/tradehub-secrets.sops.yaml`
- `k8s/overlays/prod/tradehub-secrets.sops.yaml`
- `gitops/kustomize/ops/staging/grafana-admin.sops.yaml`
- `gitops/kustomize/ops/prod/grafana-admin.sops.yaml`

### 4. Encrypt manifests

After `sops` and `age` are installed:

```bash
sops -e -i k8s/overlays/staging/tradehub-secrets.sops.yaml
sops -e -i k8s/overlays/prod/tradehub-secrets.sops.yaml
sops -e -i gitops/kustomize/ops/staging/grafana-admin.sops.yaml
sops -e -i gitops/kustomize/ops/prod/grafana-admin.sops.yaml
```

## Storage Policy

- generated plaintext files stay only in:
  - `PRODUCTION READINESS/generated/`
- git only stores:
  - encrypted SOPS manifests
  - templates
- age private key must not be committed
- keep at least one offline backup of the age private key controlled by operators

## Rotation Policy

Rotate immediately when:

- an operator workstation is compromised
- a secret is printed or pasted into the wrong system
- a vendor key is suspected exposed
- an ex-operator loses access but still possessed secrets

Baseline rotation cadence:

- vendor keys: every 90-180 days or provider policy
- application signing secrets: every 180 days or after incident
- Grafana admin password: at initial bootstrap and after handoff
- age key: rotate only with planned re-encryption unless compromised

## Incident Response Steps

1. Revoke compromised vendor key at the provider.
2. Generate replacement value locally.
3. Update the SOPS manifest.
4. Commit and merge the encrypted change.
5. Force Argo CD sync or restart affected workloads if needed.
6. Confirm diagnostics and health checks recover.
7. Record the rotation event in the operations log.

## Gaps Still Open

- this host still lacks the required SOPS/age toolchain
- cluster-side Argo CD decryption path is not yet installed
- overlay secret manifests are placeholders until you supply credentials

## Required Inputs From You

- Twilio credentials
- Resend API key
- Twelve Data API key
- confirmation of final staging and prod domains
