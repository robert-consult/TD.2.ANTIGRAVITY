# Threat Model & Vulnerability Policy

> **Diátaxis quadrant:** Explanation
> **Sources:** `.agents/vuln-db.md`, `security/vuln-db/`

---

## Repo-Local Vulnerability DB

TradeQuip maintains a repo-local vulnerability database beyond standard CVEs:

| File | Domain |
|---|---|
| `security/vuln-db/web.yaml` | UI, sessions, cookies, CORS, XSS, CSRF |
| `security/vuln-db/api.yaml` | Authz, injection, request smuggling, rate limits |
| `security/vuln-db/trading.yaml` | State machine, idempotency, race conditions, quote integrity |
| `security/vuln-db/data.yaml` | PII leakage, retention, encryption, audit immutability |
| `security/vuln-db/ops.yaml` | Misconfig, insecure defaults, excessive privileges, supply chain |

Each entry includes: `id`, `title`, `impact`, `exploit_scenario`, `detection`, `mitigation`, `done_criteria`.

---

## Dependency Scanning

| Subproject | Command |
|---|---|
| Root (web+API) | `osv-scanner --lockfile=package-lock.json` or `npm audit` |
| MOBILE | `osv-scanner --lockfile=MOBILE/package-lock.json` |
| NATIVE | `osv-scanner --lockfile=NATIVE/package-lock.json` |

---

## Related Pages

- [Security Guardrails →](00_Security_Guardrails.md)
- [CI/CD Pipeline →](../06_Operations/05_CI_CD.md)
