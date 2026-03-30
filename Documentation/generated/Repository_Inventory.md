---
audience: generated
exposure: internal
owner: documentation-program
canonical_sources:
  - AGENTS.md
  - README.md
  - PROJECT_STRUCTURE.md
  - CAPACITOR.md
  - MOBILE/README.md
  - NATIVE/README.md
  - WEBSITE/README.md
  - WEBSITE/WIRING.md
  - ops/README.md
  - petascale/README.md
last_verified: 2026-03-30
status: generated
generated_from:
  - scripts/docs/generators/repository/index.ts
---

# Repository Inventory

> Generated from the live top-level tree and repo-scoped source-document files.

Top-level entries discovered: **96**.

Tracked source-document files discovered: **68**.

## Classification Counts

| Classification | Count |
| --- | ---: |
| archive | 1 |
| archive-artifact | 1 |
| asset | 1 |
| asset-inputs | 1 |
| build-artifact | 2 |
| build-config | 12 |
| ci | 1 |
| dependency-cache | 1 |
| dependency-config | 1 |
| dependency-lock | 1 |
| editor-local | 4 |
| env-template | 1 |
| governance | 4 |
| infra-config | 2 |
| legal-file | 1 |
| local-artifact | 1 |
| local-secret-config | 1 |
| maintained-docs | 1 |
| module-reference | 1 |
| operator-archive | 1 |
| operator-module | 5 |
| product-module | 8 |
| quality-module | 1 |
| reference-guide | 2 |
| reference-report | 21 |
| repo-config | 2 |
| repo-data | 2 |
| repo-tooling | 2 |
| runtime-artifact | 9 |
| secret-template | 1 |
| support-module | 2 |
| toolchain-config | 1 |
| vcs-metadata | 1 |

## Top-Level Inventory

| Entry | Kind | Classification | Maintained Reference | Notes |
| --- | --- | --- | --- | --- |
| `.agents` | directory | governance | `Documentation/internal/00_Documentation_Hub.md`<br>`Documentation/08_Documentation_Enhancement/02_Canonical_Source_Map.md` | Agent checklists, production requirements, and scan-first context map. |
| `.code-workspace.code-workspace` | file | editor-local | `Documentation/generated/Repository_Inventory.md` | Workspace file retained for local editor setup. |
| `.dockerignore` | file | build-config | `Documentation/internal/08_Infrastructure_and_Operations.md` | Container build ignore rules. |
| `.env` | file | local-secret-config | `Documentation/generated/Environment_Catalog.md`<br>`Documentation/generated/Repository_Inventory.md` | Local environment file; never commit secrets from this file. |
| `.env.example` | file | env-template | `Documentation/generated/Environment_Catalog.md` | Environment template and env-catalog source input. |
| `.git` | directory | vcs-metadata | `Documentation/generated/Repository_Inventory.md` | Git metadata; excluded from documentation maintenance scope. |
| `.gitattributes` | file | repo-config | `Documentation/generated/Repository_Inventory.md` | Git attribute rules. |
| `.githooks` | directory | repo-tooling | `Documentation/generated/Repository_Inventory.md` | Repository-local hook automation. |
| `.github` | directory | ci | `Documentation/internal/08_Infrastructure_and_Operations.md`<br>`Documentation/generated/Repository_Inventory.md` | CI workflows and automation entrypoints. |
| `.gitignore` | file | repo-config | `Documentation/generated/Repository_Inventory.md` | Git ignore rules for generated and local artifacts. |
| `.npmrc` | file | dependency-config | `Documentation/generated/Repository_Inventory.md` | npm client configuration. |
| `.replit` | file | editor-local | `Documentation/internal/09_Repo_Supporting_Modules.md` | Environment-specific IDE/runtime config. |
| `.sops.template.yaml` | file | secret-template | `Documentation/internal/08_Infrastructure_and_Operations.md` | Template for SOPS-backed secret-management workflows. |
| `.swift-version` | file | toolchain-config | `Documentation/internal/07_Mobile_and_Native.md` | Swift toolchain version hint for Apple-platform work. |
| `.tmp` | directory | local-artifact | `Documentation/generated/Repository_Inventory.md` | Scratch and audit output directory; not a maintained source module. |
| `.vscode` | directory | editor-local | `Documentation/generated/Repository_Inventory.md` | Workspace editor settings. |
| `admin_data_exports` | directory | runtime-artifact | `Documentation/internal/09_Repo_Supporting_Modules.md` | Generated export artifacts; operational data, not source. |
| `AGENTS.md` | file | governance | `Documentation/internal/00_Documentation_Hub.md`<br>`Documentation/08_Documentation_Enhancement/02_Canonical_Source_Map.md` | Repo-wide operating router and golden command source. |
| `attached_assets` | directory | asset-inputs | `Documentation/internal/09_Repo_Supporting_Modules.md` | Attached prompt or design assets used as working inputs. |
| `AUDIT_COMPLIANCE_STATUS.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md`<br>`Documentation/generated/Repository_Inventory.md` | Compliance audit reference; treat as invariant/supporting reference, not runtime truth. |
| `AUDIT_REPORT_DEACTIVATION.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Focused historical audit note for account deactivation behavior. |
| `AUDIT_REPORT.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md`<br>`Documentation/generated/Repository_Inventory.md` | Primary audit reference for security/compliance invariants. |
| `capacitor.config.ts` | file | build-config | `Documentation/internal/07_Mobile_and_Native.md` | Capacitor wrapper runtime/build config. |
| `CAPACITOR.md` | file | module-reference | `Documentation/internal/07_Mobile_and_Native.md` | Capacitor wrapper mode and same-origin guidance. |
| `client` | directory | product-module | `Documentation/internal/01_Runtime_Topology.md`<br>`Documentation/internal/02_Trader_Journey.md`<br>`Documentation/internal/03_Admin_Journey.md` | Main authenticated web app. |
| `CODEX_COUNTRY_TIMEZONE_CONTROLS.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Jurisdiction and timezone control invariant reference. |
| `components.json` | file | build-config | `Documentation/generated/Repository_Inventory.md` | UI component generator config. |
| `config` | directory | support-module | `Documentation/internal/09_Repo_Supporting_Modules.md` | Application configuration inputs such as market-data provider config. |
| `COT_OUTPUT_EXTRACTION_GUIDE.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Auxiliary workflow guide retained as repo-local reference. |
| `data` | directory | repo-data | `Documentation/internal/09_Repo_Supporting_Modules.md` | Repo-local data inputs or generated support data. |
| `db` | directory | product-module | `Documentation/internal/guides/Adding_Database_Table.md`<br>`Documentation/generated/Environment_Catalog.md` | Drizzle migrations, schema tooling, and seed scripts. |
| `db_backups` | directory | runtime-artifact | `Documentation/internal/09_Repo_Supporting_Modules.md` | Database backup artifacts. |
| `DB_HARDENING_REPORT.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Database hardening audit note. |
| `DEEP_AUDIT_FINDINGS.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Historical deep-audit findings; verify against live tree before reuse. |
| `design` | directory | support-module | `Documentation/internal/09_Repo_Supporting_Modules.md` | Design assets such as badges, certificates, and themes. |
| `design_guidelines.md` | file | reference-guide | `Documentation/internal/09_Repo_Supporting_Modules.md` | UI design guidance for frontend work. |
| `dist` | directory | build-artifact | `Documentation/internal/09_Repo_Supporting_Modules.md` | Build outputs; generated, not edited by hand. |
| `docker-compose.infra.durable.yml` | file | infra-config | `Documentation/internal/08_Infrastructure_and_Operations.md` | Durable local infra compose stack. |
| `docker-compose.infra.yml` | file | infra-config | `Documentation/internal/08_Infrastructure_and_Operations.md` | Primary local Postgres + Valkey compose stack. |
| `Dockerfile` | file | build-config | `Documentation/internal/08_Infrastructure_and_Operations.md` | Primary container build definition. |
| `Documentation` | directory | maintained-docs | `Documentation/internal/00_Documentation_Hub.md`<br>`Documentation/08_Documentation_Enhancement/03_Target_Documentation_Architecture.md` | Maintained docs lanes plus the frozen legacy archive. |
| `drizzle.config.ts` | file | build-config | `Documentation/internal/guides/Adding_Database_Table.md` | Drizzle configuration entrypoint. |
| `e2e` | directory | quality-module | `Documentation/internal/09_Repo_Supporting_Modules.md` | Playwright end-to-end coverage and runbook tests. |
| `fast_load_audit_report.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Performance-focused audit reference. |
| `FINAL_AUDIT_REMAINING_GAPS.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Historical gap register retained for context, not canonical truth. |
| `FIX_TRACKER.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Historical fix tracker retained as supporting evidence. |
| `generate_tree.py` | file | repo-tooling | `Documentation/generated/Repository_Inventory.md` | Local repo tree helper script. |
| `generated-icon.png` | file | asset | `Documentation/internal/09_Repo_Supporting_Modules.md` | Generated image asset stored at the repo root. |
| `gitops` | directory | operator-module | `Documentation/internal/08_Infrastructure_and_Operations.md` | GitOps deployment structure and overlays. |
| `grift_audit_checklist.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Fraud-control audit checklist reference. |
| `grift_verification_report.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Fraud-control verification note. |
| `INMEMORY_TO_POSTGRES_PERSISTENCE_REPORT.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Persistence migration review note. |
| `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Canonical compliance runbook reference. |
| `k8s` | directory | operator-module | `Documentation/internal/08_Infrastructure_and_Operations.md` | Kubernetes manifests and cluster runtime definitions. |
| `LICENSE.txt` | file | legal-file | `Documentation/generated/Repository_Inventory.md` | Repository license file. |
| `migration_imports` | directory | repo-data | `Documentation/internal/09_Repo_Supporting_Modules.md` | Migration import inputs and artifacts. |
| `MIGRATION_REVIEW.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Migration-risk review reference. |
| `MOBILE` | directory | product-module | `Documentation/internal/07_Mobile_and_Native.md` | Capacitor wrapper shells and bridge helpers. |
| `NATIVE` | directory | product-module | `Documentation/internal/07_Mobile_and_Native.md` | React Native app and platform-native shells. |
| `node_modules` | directory | dependency-cache | `Documentation/generated/Repository_Inventory.md` | Installed dependencies; excluded from documentation maintenance scope. |
| `ops` | directory | operator-module | `Documentation/internal/08_Infrastructure_and_Operations.md` | Observability, runbooks, security ops, and cluster operator assets. |
| `output-inline-code.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Auxiliary workflow note retained in the root. |
| `package-lock.json` | file | dependency-lock | `Documentation/generated/Repository_Inventory.md` | Root dependency lockfile. |
| `package.json` | file | build-config | `Documentation/internal/00_Documentation_Hub.md`<br>`Documentation/08_Documentation_Enhancement/05_Docs_Automation_Contract.md` | Root command and dependency manifest. |
| `PATCH_DELIVERY_GUIDE.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Patch-delivery process note. |
| `petascale` | directory | operator-module | `Documentation/internal/08_Infrastructure_and_Operations.md` | ClickHouse and analytics-oriented stack, including vendor sync. |
| `playwright.config.ts` | file | build-config | `Documentation/internal/09_Repo_Supporting_Modules.md` | Playwright configuration. |
| `postcss.config.js` | file | build-config | `Documentation/generated/Repository_Inventory.md` | PostCSS configuration. |
| `PRODUCTION READINESS` | directory | operator-archive | `Documentation/internal/08_Infrastructure_and_Operations.md`<br>`Documentation/internal/09_Repo_Supporting_Modules.md` | Operator-focused readiness material retained in-repo. |
| `PROJECT_STRUCTURE.md` | file | governance | `Documentation/internal/00_Documentation_Hub.md`<br>`Documentation/08_Documentation_Enhancement/02_Canonical_Source_Map.md` | Deep-map of the entire codebase and navigation source of truth. |
| `README.md` | file | governance | `Documentation/public/01_Platform_Overview.md`<br>`Documentation/internal/00_Documentation_Hub.md` | Primary repo overview and quick-start reference. |
| `REAUDIT_REPORT.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Reaudit reference for preserved invariants. |
| `REAUDIT_STATUS_REPORT.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Historical reaudit status note. |
| `replit.md` | file | reference-guide | `Documentation/internal/09_Repo_Supporting_Modules.md` | Environment-specific repo note retained in the root. |
| `REPORTS AND REVIEWS` | directory | archive | `Documentation/internal/09_Repo_Supporting_Modules.md` | Large historical report archive; use as lead material only. |
| `scripts` | directory | product-module | `Documentation/internal/09_Repo_Supporting_Modules.md`<br>`Documentation/08_Documentation_Enhancement/05_Docs_Automation_Contract.md` | Operational tooling, audits, generators, and load tests. |
| `security` | directory | operator-module | `Documentation/internal/08_Infrastructure_and_Operations.md`<br>`Documentation/internal/09_Repo_Supporting_Modules.md` | Security-local materials including vulnerability database inputs. |
| `server` | directory | product-module | `Documentation/internal/01_Runtime_Topology.md`<br>`Documentation/internal/02_Trader_Journey.md`<br>`Documentation/internal/03_Admin_Journey.md`<br>`Documentation/internal/04_Partner_Journey.md` | Express API, WebSocket runtime, trading, security, and worker logic. |
| `server-5000.log` | file | runtime-artifact | `Documentation/generated/Repository_Inventory.md` | Local server log artifact. |
| `server-5000.node.pid` | file | runtime-artifact | `Documentation/generated/Repository_Inventory.md` | Local process PID artifact. |
| `server-5000.pid` | file | runtime-artifact | `Documentation/generated/Repository_Inventory.md` | Local process PID artifact. |
| `sessions.db` | file | runtime-artifact | `Documentation/internal/09_Repo_Supporting_Modules.md` | Local session database artifact. |
| `shared` | directory | product-module | `Documentation/internal/guides/Adding_API_Endpoint.md`<br>`Documentation/internal/guides/Adding_Database_Table.md`<br>`Documentation/generated/WebSocket_Catalog.md` | Shared contracts, schemas, instruments, locale, and WS types. |
| `SHARED_SERVICES_AUDIT.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Shared-service audit reference. |
| `swiftly-x86_64.tar.gz` | file | archive-artifact | `Documentation/generated/Repository_Inventory.md` | Local archived binary payload retained in the workspace. |
| `tailwind.config.cjs` | file | build-config | `Documentation/generated/Repository_Inventory.md` | Tailwind configuration. |
| `TD.2.ANTIGRAVITY.code-workspace` | file | editor-local | `Documentation/generated/Repository_Inventory.md` | Workspace file for local editor setup. |
| `test-results` | directory | build-artifact | `Documentation/internal/09_Repo_Supporting_Modules.md` | Test output artifacts. |
| `TRADE_HISTORY_TASK_LIST.md` | file | reference-report | `Documentation/internal/09_Repo_Supporting_Modules.md` | Historical task list retained as supporting context. |
| `trades.json` | file | runtime-artifact | `Documentation/generated/Repository_Inventory.md` | Local trade data artifact. |
| `trading_app_fixed.db-journal` | file | runtime-artifact | `Documentation/generated/Repository_Inventory.md` | SQLite journal artifact. |
| `trading_app.db` | file | runtime-artifact | `Documentation/internal/09_Repo_Supporting_Modules.md` | Local development SQLite artifact retained in the workspace. |
| `tsconfig.json` | file | build-config | `Documentation/generated/Repository_Inventory.md` | Root TypeScript configuration. |
| `vite.config.ts` | file | build-config | `Documentation/generated/Repository_Inventory.md` | Vite configuration for the web app. |
| `vitest.config.ts` | file | build-config | `Documentation/generated/Repository_Inventory.md` | Vitest configuration. |
| `WEBSITE` | directory | product-module | `Documentation/public/03_Public_Website_and_Education.md`<br>`Documentation/internal/06_Website_and_Education.md` | Standalone public marketing and education site. |

## Local Source-Document Index

| Path | Type | Scope |
| --- | --- | --- |
| `.github/AGENTS.md` | AGENTS | `.github` |
| `AGENTS.md` | AGENTS | `repo-root` |
| `attached_assets/AGENTS.md` | AGENTS | `attached_assets` |
| `client/AGENTS.md` | AGENTS | `client` |
| `config/marketdata/providers/README.md` | README | `config/marketdata/providers` |
| `db/AGENTS.md` | AGENTS | `db` |
| `e2e/AGENTS.md` | AGENTS | `e2e` |
| `gitops/AGENTS.md` | AGENTS | `gitops` |
| `k8s/AGENTS.md` | AGENTS | `k8s` |
| `MOBILE/AGENTS.md` | AGENTS | `MOBILE` |
| `MOBILE/android/AGENTS.md` | AGENTS | `MOBILE/android` |
| `MOBILE/android/README.md` | README | `MOBILE/android` |
| `MOBILE/ios/AGENTS.md` | AGENTS | `MOBILE/ios` |
| `MOBILE/ios/App/CapApp-SPM/README.md` | README | `MOBILE/ios/App/CapApp-SPM` |
| `MOBILE/ios/README.md` | README | `MOBILE/ios` |
| `MOBILE/README.md` | README | `MOBILE` |
| `MOBILE/src/mobile/AGENTS.md` | AGENTS | `MOBILE/src/mobile` |
| `NATIVE/AGENTS.md` | AGENTS | `NATIVE` |
| `NATIVE/android/AGENTS.md` | AGENTS | `NATIVE/android` |
| `NATIVE/android/README.md` | README | `NATIVE/android` |
| `NATIVE/ios/AGENTS.md` | AGENTS | `NATIVE/ios` |
| `NATIVE/ios/Pods/boost/README.md` | README | `NATIVE/ios/Pods/boost` |
| `NATIVE/ios/Pods/fast_float/README.md` | README | `NATIVE/ios/Pods/fast_float` |
| `NATIVE/ios/Pods/Firebase/CoreOnly/README.md` | README | `NATIVE/ios/Pods/Firebase/CoreOnly` |
| `NATIVE/ios/Pods/Firebase/README.md` | README | `NATIVE/ios/Pods/Firebase` |
| `NATIVE/ios/Pods/FirebaseCore/README.md` | README | `NATIVE/ios/Pods/FirebaseCore` |
| `NATIVE/ios/Pods/FirebaseCoreExtension/README.md` | README | `NATIVE/ios/Pods/FirebaseCoreExtension` |
| `NATIVE/ios/Pods/FirebaseCoreInternal/README.md` | README | `NATIVE/ios/Pods/FirebaseCoreInternal` |
| `NATIVE/ios/Pods/FirebaseInstallations/README.md` | README | `NATIVE/ios/Pods/FirebaseInstallations` |
| `NATIVE/ios/Pods/FirebaseMessaging/README.md` | README | `NATIVE/ios/Pods/FirebaseMessaging` |
| `NATIVE/ios/Pods/fmt/README.md` | README | `NATIVE/ios/Pods/fmt` |
| `NATIVE/ios/Pods/GoogleDataTransport/README.md` | README | `NATIVE/ios/Pods/GoogleDataTransport` |
| `NATIVE/ios/Pods/GoogleUtilities/README.md` | README | `NATIVE/ios/Pods/GoogleUtilities` |
| `NATIVE/ios/Pods/PromisesObjC/README.md` | README | `NATIVE/ios/Pods/PromisesObjC` |
| `NATIVE/ios/Pods/RCT-Folly/README.md` | README | `NATIVE/ios/Pods/RCT-Folly` |
| `NATIVE/ios/Pods/SocketRocket/README.md` | README | `NATIVE/ios/Pods/SocketRocket` |
| `NATIVE/ios/README.md` | README | `NATIVE/ios` |
| `NATIVE/README.md` | README | `NATIVE` |
| `NATIVE/src/AGENTS.md` | AGENTS | `NATIVE/src` |
| `ops/bull-board/README.md` | README | `ops/bull-board` |
| `ops/headlamp-plugin/README.md` | README | `ops/headlamp-plugin` |
| `ops/README.md` | README | `ops` |
| `petascale/README.md` | README | `petascale` |
| `petascale/vendor/bull-board/README.md` | README | `petascale/vendor/bull-board` |
| `petascale/vendor/bullmq/README.md` | README | `petascale/vendor/bullmq` |
| `petascale/vendor/clickhouse/README.md` | README | `petascale/vendor/clickhouse` |
| `petascale/vendor/grafana/README.md` | README | `petascale/vendor/grafana` |
| `petascale/vendor/headlamp/README.md` | README | `petascale/vendor/headlamp` |
| `petascale/vendor/infra-pkg/README.md` | README | `petascale/vendor/infra-pkg` |
| `petascale/vendor/kes/README.md` | README | `petascale/vendor/kes` |
| `petascale/vendor/minio_monitor/README.md` | README | `petascale/vendor/minio_monitor` |
| `petascale/vendor/minio/README.md` | README | `petascale/vendor/minio` |
| `petascale/vendor/pigsty/README.md` | README | `petascale/vendor/pigsty` |
| `petascale/vendor/prometheus/README.md` | README | `petascale/vendor/prometheus` |
| `petascale/vendor/valkey/README.md` | README | `petascale/vendor/valkey` |
| `PRODUCTION READINESS/AGENTS.md` | AGENTS | `PRODUCTION READINESS` |
| `README.md` | README | `repo-root` |
| `REPORTS AND REVIEWS/HARDCODING AUDIT/README.md` | README | `REPORTS AND REVIEWS/HARDCODING AUDIT` |
| `scripts/AGENTS.md` | AGENTS | `scripts` |
| `scripts/docs/AGENTS.md` | AGENTS | `scripts/docs` |
| `scripts/docs/README.md` | README | `scripts/docs` |
| `security/AGENTS.md` | AGENTS | `security` |
| `server/AGENTS.md` | AGENTS | `server` |
| `server/routes/AGENTS.md` | AGENTS | `server/routes` |
| `shared/AGENTS.md` | AGENTS | `shared` |
| `WEBSITE/AGENTS.md` | AGENTS | `WEBSITE` |
| `WEBSITE/README.md` | README | `WEBSITE` |
| `WEBSITE/WIRING.md` | WIRING | `WEBSITE` |
