# `.github/` AGENTS.md (CI/CD Workflows)

## What this area is
GitHub Actions workflows for continuous integration, deployment, and automated checks.

## Non-negotiables
- **DB audit workflow is critical**: Do not modify `.github/workflows/db-audit.yml` without consulting `MIGRATION_REVIEW.md`.
- **No secrets in workflow files**: Use GitHub Secrets for credentials; never hardcode.
- **Preserve fail-fast behavior**: Do not weaken `npm run db:audit` or other compliance gates.

## Key workflows
| Workflow | Purpose | Modification Risk |
|----------|---------|-------------------|
| `db-audit.yml` | Enforces schema audit on DB/migration changes | **HIGH** - Critical for compliance |

## Secrets expectations
Workflows may reference these GitHub Secrets (never commit values):
- `DATABASE_URL` (if applicable)
- `TURSO_*` credentials (if applicable)
- Signing keys for mobile builds (if applicable)

## Required checks before finalizing
- Test workflow changes on a feature branch before merging to main.
- Ensure no secrets are exposed in workflow logs (use `::add-mask::`).
