# `security/` AGENTS.md (Vulnerability Database & Security Artifacts)

## What this area is
Repo-local vulnerability database and security-related artifacts. This is NOT application code—it's documentation and threat intelligence.

## Non-negotiables
- **Append-only mentality**: Do not delete vuln-db entries; mark them as `status: mitigated` or `status: wontfix` with rationale.
- **Cross-reference**: When fixing a security issue in code, update or add the corresponding entry in `vuln-db/*.yaml`.
- **No secrets**: Never store credentials, keys, or tokens in this folder.

## Folder structure
```
security/
└── vuln-db/
    ├── web.yaml      # UI/session/cookies/CORS/XSS/CSRF
    ├── api.yaml      # authz, injection, rate limits
    ├── trading.yaml  # state machine, idempotency, race conditions
    ├── data.yaml     # PII leakage, retention, encryption
    └── ops.yaml      # misconfig, insecure defaults, supply chain
```

## Entry format (YAML)
Each vulnerability entry must include:
```yaml
- id: VULN-XXX-NNNN
  title: Short description
  impact: critical | high | medium | low
  exploit_scenario: |
    How an attacker could exploit this.
  detection: |
    Grep patterns, test commands, or heuristics.
  mitigation: |
    How to fix or prevent.
  done_criteria: |
    What counts as "fixed".
  status: open | mitigated | wontfix
  references: []
```

## Required checks before finalizing
- Ensure new entries have unique IDs following the pattern `VULN-{AREA}-{NNNN}`.
- Cross-check with `.agents/security.md` and `.agents/vuln-db.md`.
