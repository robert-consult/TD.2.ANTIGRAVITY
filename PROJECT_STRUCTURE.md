# TradeQuip Project Structure

> **Last Updated:** March 2026  
> **Purpose:** Comprehensive deep-map for navigating and extending the TradeQuip codebase  
> **NOTE:** Agents — read this file first for orientation before making any structural assumptions.

---

## Quick Reference

| Component | Path | Technology | Dependencies Location |
|-----------|------|------------|----------------------|
| Public Website | `WEBSITE/` | React 18 + Vite + Express + build-time markdown sync | `WEBSITE/node_modules/` |
| Web Frontend | `client/` | React 18 + Vite | `node_modules/` (root) |
| Backend API | `server/` | Express + Node | `node_modules/` (root) |
| Shared Types & Schemas | `shared/` | TypeScript + Zod + Drizzle | `node_modules/` (root) |
| Database Layer | `db/` | Drizzle ORM + PostgreSQL | `node_modules/` (root) |
| Capacitor Wrapper Shells | `MOBILE/` | Capacitor 8 + remote WebView shell (Android + iOS) | `MOBILE/node_modules/` |
| Native Apps | `NATIVE/` | React Native 0.83 (Android + iOS) | `NATIVE/node_modules/` |
| Observability & Ops | `ops/` | Grafana + Prometheus + K8s | N/A (shell/YAML) |
| Petascale Analytics | `petascale/` | ClickHouse + Prometheus | N/A (docker-compose) |
| Kubernetes Deployment | `k8s/` | YAML manifests | N/A |
| E2E Tests | `e2e/` | Playwright | `node_modules/` (root) |

---

## 📁 Complete Folder Structure (Deep Map)

```
TD.2.ANTIGRAVITY/                        ← Root workspace
│
├── 🤖 AGENT GUIDANCE
│   ├── AGENTS.md                        ← Repo-wide agent router (READ FIRST)
│   ├── PROJECT_STRUCTURE.md             ← This file (deep project map)
│   ├── .agents/                         ← Agent checklists + deep-context map
│   │   ├── PRODUCTION_REQUIREMENTS.md   # Living ledger of production requirements
│   │   ├── deep-context.md              # "Where to look" by domain
│   │   ├── audit-decomposition.md       # Audit/decomposition review policy
│   │   ├── performance.md              # Performance & bandwidth NFRs
│   │   ├── security.md                 # Security checklists
│   │   ├── observability.md            # Monitoring/alerting rules
│   │   ├── shared-services.md          # Reusable shared services guide
│   │   ├── release-done.md             # Definition of Done
│   │   └── vuln-db.md                  # Dependency vulnerability policy
│   └── security/                        ← Repo-local security
│       ├── AGENTS.md                    # Security agent guidance
│       └── vuln-db/                     # Vulnerability database (YAML files)
│
├── 🌍 PUBLIC WEBSITE MODULE
│   └── WEBSITE/                         ← Standalone marketing + education site
│       ├── AGENTS.md                    # Website-specific isolation guidance
│       ├── README.md                    # Runtime/build routes + content pipeline
│       ├── WIRING.md                    # Domain topology + route map
│       ├── package.json                 # Website build, sync, verify scripts
│       ├── client/                      # Public-only React SPA
│       │   └── src/
│       │       ├── App.tsx              # Website router (`/education`, `/platform-guide`, etc.)
│       │       ├── components/education/ # GitBook-style lesson UI + quiz/disclosure components
│       │       ├── lib/educationApi.ts  # Typed website content API paths
│       │       ├── lib/educationTypes.ts # Website content payload types
│       │       └── pages/               # Catalog, module, lesson, and platform-guide pages
│       ├── server/
│       │   └── content/
│       │       ├── contentStore.ts      # Runtime loader for generated education JSON
│       │       ├── generated/           # Website-owned generated catalog/module/lesson payloads
│       │       └── types.ts             # Server content contracts
│       └── scripts/                     # `content:sync` and `content:validate` pipeline
│
├── 🌐 WEB APPLICATION — CLIENT
│   └── client/                          ← React frontend (Vite)
│       ├── AGENTS.md                    # Client-specific agent guidance
│       ├── index.html                   # SPA entry point
│       ├── i18n-manifest.json           # i18n string manifest (~820KB)
│       ├── vite.plugins/               # Custom Vite plugins
│       └── src/
│           ├── App.tsx                  # Root router & route definitions
│           ├── AuthenticatedShell.tsx   # Auth-guarded layout shell
│           ├── main.tsx                 # React bootstrap + providers
│           ├── index.css                # Global styles (Tailwind + custom)
│           ├── sw.ts                    # Service worker (PWA/offline)
│           ├── components/             # UI components (109 items)
│           │   ├── ui/                 # shadcn/ui primitives (48 items)
│           │   ├── admin/              # Admin dashboard components (28)
│           │   ├── forms/              # Form components
│           │   ├── layout/             # Layout wrappers
│           │   ├── partner/            # Partner portal components
│           │   ├── trader/             # Trader-specific components
│           │   ├── Mailbox/            # Messaging UI
│           │   ├── app/                # App-level components
│           │   └── MobileWrapperBridge.tsx  # Capacitor bridge activation
│           ├── hooks/                  # React hooks (15 items)
│           │   └── (use-auth, use-trades, use-mobile, etc.)
│           ├── lib/                    # Utilities & helpers (37 items)
│           │   └── (queryClient, identity, appNavigation, dashboardUrlState, etc.)
│           ├── pages/                  # Route pages (24 items)
│           │   ├── TradeScreen.tsx     # Main trading interface
│           │   ├── AdminDashboard.tsx  # Admin control panel
│           │   ├── PartnerPortal.tsx   # White-label partner portal
│           │   ├── ProfileSettings.tsx # User profile & settings
│           │   ├── HistoryScreen.tsx   # Trade history viewer
│           │   ├── LoginPage.tsx       # Auth & registration
│           │   ├── QuotesScreen.tsx    # Live quotes display
│           │   ├── JournalPage.tsx     # Trading journal
│           │   ├── ChartScreen.tsx     # Charting interface
│           │   ├── LeaderboardScreen.tsx # Trader leaderboard
│           │   ├── AdminCommunications.tsx
│           │   ├── AdminData.tsx
│           │   ├── AdminLegalAcceptances.tsx
│           │   ├── AdminLegalDocs.tsx
│           │   ├── AdminTradeAudit.tsx
│           │   ├── AccountScreen.tsx
│           │   ├── Dashboard.tsx
│           │   ├── VerifyEmail.tsx
│           │   ├── partner-portal/     # Partner portal sub-routes
│           │   └── trade-screen/       # Trade screen sub-components
│           ├── live/                   # WebSocket providers & hooks (6 items)
│           ├── i18n/                   # Internationalization (5 items)
│           ├── utils/                  # Frontend utilities
│           └── test/                   # Client-side test helpers
│
├── ⚙️ WEB APPLICATION — SERVER
│   └── server/                          ← Express backend (279 items total)
│       ├── AGENTS.md                    # Server-specific agent guidance
│       ├── index.ts                     # Server entry point (~27KB)
│       ├── routes.ts                    # Route registration hub
│       ├── storage.ts                   # Data access layer (~57KB)
│       ├── risk.ts                      # Risk management engine (~25KB)
│       ├── recalcAccount.ts             # Account recalculation logic (~14KB)
│       ├── vite.ts                      # Vite dev-server integration
│       │
│       ├── routes/                      # API endpoints (106 items)
│       │   ├── AGENTS.md               # Route architecture rules
│       │   ├── auth/                   # Authentication routes (8 items)
│       │   ├── authCore.ts             # Core auth logic (~39KB)
│       │   ├── admin.ts                # Admin CRUD routes (~70KB)
│       │   ├── adminActivity.ts        # Activity logging
│       │   ├── adminDataExports.ts     # Data export endpoints
│       │   ├── adminDataLegacyCompat.ts
│       │   ├── adminDataRollups.ts
│       │   ├── adminI18n.ts
│       │   ├── adminInstitutionalAudit.ts
│       │   ├── adminKyc.ts             # KYC verification admin
│       │   ├── adminLegal.ts
│       │   ├── adminLegalAcceptances.ts
│       │   ├── adminLegalDocs.ts
│       │   ├── adminMarketData.ts      # Market data admin (~40KB)
│       │   ├── adminMigration.ts
│       │   ├── adminOps.ts             # Operational admin
│       │   ├── adminQuoteSubscriptions.ts
│       │   ├── adminScout/             # Scout discovery admin (6 items)
│       │   ├── adminScout.ts
│       │   ├── adminSecurity.ts
│       │   ├── adminSystemConfig.ts
│       │   ├── adminTraderScouting.ts
│       │   ├── adminUsers.ts
│       │   ├── grift.ts                # Anti-fraud / grift detection (~58KB)
│       │   ├── grift-admin/            # Grift admin panel routes (2 items)
│       │   ├── legal.ts                # Legal document routes
│       │   ├── mailbox.ts              # Messaging routes (~29KB)
│       │   ├── meta.ts                 # System meta endpoints
│       │   ├── partnerPortal.ts        # Partner portal API (~62KB)
│       │   ├── pushDevices.ts          # Push-device registry API
│       │   ├── profile/               # Profile routes (14 items)
│       │   ├── profileCore.ts
│       │   ├── profileMfa.ts           # MFA routes
│       │   ├── public/                # Public (unauthenticated) routes (9 items)
│       │   ├── publicCore.ts
│       │   ├── quotesCore.ts           # Quotes API
│       │   ├── quoteSubscriptions.ts
│       │   ├── trader/                # Trader routes (11 items)
│       │   ├── trader-core/           # Core trader routes (3 items)
│       │   ├── trader-talent/         # Talent marketplace (1 item)
│       │   ├── traderTalent.ts        # Trader talent API (~72KB)
│       │   ├── verification.ts         # User verification (~31KB)
│       │   ├── ws/                    # WebSocket routes (2 items)
│       │   └── wsCore.ts              # WS core logic (~57KB)
│       │
│       ├── services/                   # Business logic layer (38 items)
│       │   ├── accountLifecycle.ts     # Account lifecycle management
│       │   ├── adminAuditTrail.ts      # Audit trail service
│       │   ├── adminDataExportBuild.ts # Data export builder (~53KB)
│       │   ├── adminDataExportBuildClickhouse.ts
│       │   ├── adminDataExportBuildSupport.ts
│       │   ├── adminDataExportQueue.ts
│       │   ├── adminDataExportRepo.ts
│       │   ├── adminDataExportRetention.ts
│       │   ├── adminDataRollups.ts
│       │   ├── clickhouseClient.ts     # ClickHouse integration
│       │   ├── clickhouseSync.ts       # ClickHouse data sync (~40KB)
│       │   ├── crypto.ts              # Cryptographic utilities
│       │   ├── globalSettings.ts      # System-wide settings
│       │   ├── globalSettingsAdmin.ts
│       │   ├── identityAudit.ts       # Identity audit service
│       │   ├── liveBus.ts             # Live event bus (pub/sub)
│       │   ├── messaging.ts           # Messaging engine (~62KB)
│       │   ├── messagingSettings.ts
│       │   ├── objectStorage.ts       # S3/MinIO object store
│       │   ├── petascaleEnv.ts        # Petascale environment config
│       │   ├── pushDevices.ts         # Push-device registry service
│       │   ├── quoteHub.ts            # Quote aggregation hub
│       │   ├── quoteService.ts        # Quote streaming service
│       │   ├── quoteSubscriptions.ts
│       │   ├── rememberMe.ts          # Session persistence
│       │   ├── sessionStore.ts        # Session store (Valkey)
│       │   ├── signupPublicConfig.ts
│       │   ├── tradeAtomic.ts         # Atomic trade execution
│       │   ├── tradeCosts.ts          # Trading cost calculation
│       │   ├── traderScoutQuery.ts    # Scout search queries
│       │   └── valkey.ts              # Valkey (Redis) client
│       │
│       ├── middleware/                 # Express middleware (7 items)
│       │   ├── auth.ts                # Authentication middleware (~18KB)
│       │   ├── jurisdictionSessionGuard.ts  # Jurisdiction enforcement
│       │   ├── requireAdmin.ts
│       │   ├── requirePartner.ts
│       │   ├── requirePartnerGate.ts
│       │   └── requirePolicy.ts       # Policy-based access control
│       │
│       ├── lib/                        # Server utilities (11 items)
│       │   ├── auditWriter.ts         # Audit log writer (~25KB)
│       │   ├── margin.ts              # Margin calculation engine
│       │   ├── priceUtils.ts          # Price formatting/conversion
│       │   ├── realizedPnl.ts         # PnL calculation
│       │   ├── accountEventMirror.ts  # Account event mirroring
│       │   ├── auditContext.ts
│       │   ├── envUtils.ts
│       │   └── saveSession.ts
│       │
│       ├── grift/                      # Anti-fraud system (13 items)
│       │   ├── griftEngine.ts         # Core grift detection engine (~66KB)
│       │   ├── griftAutoEnforcement.ts
│       │   ├── griftDb.ts
│       │   ├── griftDefaults.ts
│       │   ├── griftGeo.ts            # Geolocation-based detection
│       │   ├── griftIp2AsnDataset.ts
│       │   ├── griftIpAsn.ts          # IP/ASN analysis
│       │   ├── griftPublicRouter.ts
│       │   ├── griftRetention.ts
│       │   ├── griftScheduler.ts
│       │   └── griftTypes.ts
│       │
│       ├── security/                   # Security subsystem (13 items)
│       ├── legal/                      # Legal compliance (13 items)
│       ├── recruitment/                # Trader recruitment portal (14 items)
│       ├── marketdata/                 # Market data providers (9 items)
│       ├── cron/                       # Scheduled jobs (7 items)
│       ├── feeds/                      # Dynamic feed system (6 items)
│       ├── i18n/                       # Server-side i18n (7 items)
│       ├── partner/                    # Partner management (5 items)
│       ├── policy/                     # Policy decision engine (4 items)
│       ├── scout/                      # Trader scouting system (3 items)
│       ├── engine/                     # Trading engine core (1 item)
│       ├── trades/                     # Trade processing (1 item)
│       ├── context/                    # Request context (2 items)
│       ├── constants/                  # Server constants (1 item)
│       ├── migration/                  # Data migration utilities (1 item)
│       ├── types/                      # TypeScript type definitions (3 items)
│       ├── utils/                      # General utilities (13 items)
│       └── db/                         # Server-level DB helpers (1 item)
│
├── 🔗 SHARED LAYER
│   └── shared/                          ← Shared TypeScript types & schemas (39 items)
│       ├── AGENTS.md                    # Shared module guidance
│       ├── schema.ts                    # Re-export hub
│       ├── schema.pg.ts                 # PostgreSQL schema aggregator
│       ├── schema.pg.base.ts            # Core tables (~50KB)
│       ├── schema.pg.audit.ts           # Audit tables (~19KB)
│       ├── schema.pg.grift.ts           # Anti-fraud tables (~19KB)
│       ├── schema.pg.identity.ts        # Identity/KYC tables (~8KB)
│       ├── schema.pg.legal.ts           # Legal tables (~12KB)
│       ├── schema.pg.recruitment.ts     # Recruitment tables (~38KB)
│       ├── policyDecision.ts            # Policy decision types (~14KB)
│       ├── partnerProfile.ts            # Partner profile schemas (~14KB)
│       ├── closeReasons.ts              # Trade close reason enums (~13KB)
│       ├── marketDataProviders.ts       # Market data provider configs
│       ├── tradingRules.ts              # Trading rule definitions
│       ├── quoteSubscriptions.ts        # Quote subscription types
│       ├── scalars.ts                   # Scalar type wrappers
│       ├── pips.ts                      # Pip calculation
│       ├── admin/                       # Admin shared types (3 items)
│       ├── challenges/                  # Challenge system types
│       ├── e2ee/                        # End-to-end encryption types
│       ├── identity/                    # Identity verification types (2 items)
│       ├── instruments/                 # Instrument definitions (4 items)
│       ├── locale/                      # Locale types (2 items)
│       ├── security/                    # Security shared types (3 items)
│       ├── time/                        # Timezone/time types (3 items)
│       ├── trading/                     # Trading shared types
│       ├── transport/                   # Transport layer types
│       └── ws/                          # WebSocket message types
│
├── 💾 DATABASE
│   ├── db/                              ← Drizzle ORM layer (56 items)
│   │   ├── AGENTS.md                    # DB agent guidance
│   │   ├── index.ts                     # DB connection & pool
│   │   ├── config.ts                    # DB configuration
│   │   ├── migrate.ts                   # Migration runner
│   │   ├── seed.ts                      # Seed data (~11KB)
│   │   ├── schema.pg.sql               # Full PostgreSQL DDL (~203KB)
│   │   ├── legacySqliteSource.ts        # SQLite legacy migration
│   │   ├── fixSchema.ts / .sql          # Schema repair utilities
│   │   ├── add_margin_fields.ts         # Margin field migration
│   │   ├── create_admin_views.ts        # Admin DB views
│   │   └── migrations/                  # SQL migration files (47 items)
│   ├── drizzle.config.ts               ← Drizzle ORM configuration
│   ├── trading_app.db                   ← SQLite database (legacy, ~90MB)
│   └── sessions.db                      ← Session storage (SQLite)
│
├── 📱 MOBILE APPS
│   ├── MOBILE/                          ← Capacitor wrapper shells (remote URL mode)
│   │   ├── AGENTS.md                    # Mobile agent guidance
│   │   ├── README.md
│   │   ├── capacitor.config.ts          # Canonical host + runtime config
│   │   ├── package.json / package-lock.json
│   │   ├── build-release.sh             # Release build script
│   │   ├── build-android.sh             # Android build script
│   │   ├── android/                     # Android Gradle project (56 items)
│   │   │   └── AGENTS.md                # Android wrapper shell guidance
│   │   ├── ios/                         # Xcode wrapper project (20 items)
│   │   │   └── AGENTS.md                # iOS wrapper shell guidance
│   │   ├── android/README.md            # Android wrapper maintenance notes
│   │   ├── ios/README.md                # iOS wrapper maintenance notes
│   │   ├── src/mobile/                  # Bridge-only hooks and utilities (10 items)
│   │   │   └── AGENTS.md                # Wrapper bridge guidance
│   │   ├── scripts/                     # Build & host guard scripts (6 items)
│   │   ├── docs/                        # Wrapper documentation (8 items)
│   │   ├── design_assets/               # App design assets
│   │   ├── resources/                   # App icons, splash screens
│   │   └── node_modules/                ← MOBILE-specific dependencies
│   │
│   └── NATIVE/                          ← React Native apps (true native UI)
│       ├── AGENTS.md                    # Native agent guidance
│       ├── README.md
│       ├── App.tsx                       # RN root component
│       ├── index.js                     # RN entry point
│       ├── app.json                     # App metadata
│       ├── package.json / package-lock.json
│       ├── tsconfig.json                # TypeScript config (RN)
│       ├── babel.config.js              # Babel config (RN)
│       ├── metro.config.js              # Metro bundler config
│       ├── jest.config.js / jest.setup.js  # Test config
│       ├── init-native.sh / setup.sh    # Repo-local bootstrap scripts
│       ├── android/                     # Android Gradle project (35 items)
│       │   └── AGENTS.md                # Android native shell guidance
│       ├── ios/                         # Xcode project (21 items)
│       │   └── AGENTS.md                # iOS native shell guidance
│       ├── android/README.md            # Android native maintenance notes
│       ├── ios/README.md                # iOS native maintenance notes
│       ├── __tests__/                   # Native tests (8 items)
│       ├── __mocks__/                   # Test mocks
│       ├── scripts/                     # Build scripts + host guards (4 items)
│       ├── src/                         # Shared React Native code
│       │   ├── AGENTS.md                # Shared RN app guidance
│       │   ├── App.tsx                  # App component
│       │   ├── components/              # Native UI components (10 items)
│       │   ├── screens/                 # App screens (12 items)
│       │   ├── hooks/                   # Data hooks (10 items)
│       │   ├── services/                # API/CSRF/WS/runtime services (8 items)
│       │   ├── navigation/              # React Navigation setup
│       │   ├── theme/                   # Design tokens (4 items)
│       │   └── i18n/                    # Native i18n (3 items)
│       └── node_modules/                ← NATIVE-specific dependencies
│
├── 🔭 OBSERVABILITY & OPS
│   └── ops/                             ← Operations infrastructure (156 items)
│       ├── README.md
│       ├── dashboards/                  # Grafana dashboards (65 JSON files)
│       ├── grafana-config/              # Grafana provisioning (14 items)
│       ├── prometheus-config/           # Prometheus rules & config (24 items)
│       ├── alerts/                      # Alerting rules (2 items)
│       ├── runbooks/                    # Incident runbooks (6 items)
│       ├── kubernetes/                  # K8s-specific ops (15 items)
│       ├── bull-board/                  # Job queue dashboard (6 items)
│       ├── headlamp-plugin/             # K8s Headlamp plugin (6 items)
│       ├── minio-monitor/               # MinIO monitoring (5 items)
│       ├── chaos/                       # Chaos engineering tests (5 items)
│       ├── security/                    # Ops security scripts (4 items)
│       ├── deploy-grafana.sh            # Grafana deploy script
│       ├── deploy-prometheus-alerts.sh  # Prometheus alerts deploy
│       └── copy-petascale-dashboards.sh
│
├── 📊 PETASCALE ANALYTICS
│   └── petascale/                       ← ClickHouse analytics stack (48 items)
│       ├── README.md
│       ├── docker-compose.yml           # Petascale stack compose (~11KB)
│       ├── prometheus.yml               # Petascale Prometheus config
│       ├── sync_local_sources.sh        # Source sync script
│       ├── clickhouse/                  # ClickHouse configuration
│       ├── grafana/                     # Petascale Grafana dashboards (3 items)
│       ├── kes/                         # Key encryption service (2 items)
│       ├── prometheus-rules/            # Petascale alert rules
│       └── vendor/                      # Vendored dependencies (37 items)
│
├── ☸️ KUBERNETES DEPLOYMENT
│   └── k8s/                             ← Kubernetes manifests (19 items)
│       ├── AGENTS.md                    # K8s agent guidance
│       ├── 00-namespace.yaml            # Namespace definition
│       ├── 01-configmap.yaml            # Configuration
│       ├── 02-secrets.yaml              # Secrets
│       ├── 03-postgres.yaml             # PostgreSQL StatefulSet
│       ├── 04-pgbouncer.yaml            # PgBouncer connection pool
│       ├── 05-valkey.yaml               # Valkey (Redis) cluster
│       ├── 10-api-deployment.yaml       # API deployment
│       ├── 11-ingestor-deployment.yaml  # Data ingestor
│       ├── 12-worker-deployment.yaml    # Background worker
│       ├── 13-worker-canary-deployment.yaml  # Canary worker
│       ├── 20-service.yaml              # K8s Services
│       ├── 30-ingress.yaml              # Ingress rules
│       ├── 31-network-policies.yaml     # Network policies
│       ├── 40-hpa.yaml                  # Horizontal Pod Autoscaler
│       ├── 50-pdb.yaml                  # Pod Disruption Budget
│       ├── 60-monitoring.yaml           # Monitoring resources (~12KB)
│       ├── 70-petascale-infra.yaml      # Petascale infra (~8KB)
│       └── RUNBOOK_WORKER_CANARY_API_CUTOVER.md  # Canary runbook
│
├── 🛠️ SCRIPTS & TOOLING
│   └── scripts/                         ← Build, audit & utility scripts (36 items)
│       ├── AGENTS.md                    # Scripts agent guidance
│       ├── adminSmoke.ts                # Admin smoke test
│       ├── activityAuditVerify.ts       # Activity audit verification
│       ├── dbAudit.ts                   # Database audit
│       ├── dbDumpSchema.ts              # Schema dumper
│       ├── dbEnsure.ts                  # DB bootstrap/ensure
│       ├── db-backup.sh                 # DB backup script
│       ├── drizzleBootstrap.ts          # Drizzle ORM bootstrap
│       ├── drizzleMigrate.ts            # Migration runner
│       ├── i18nApplyGlossary.ts         # i18n glossary tool
│       ├── i18nRepairLocale.ts          # Locale repair
│       ├── i18nRunWorker.ts             # i18n background worker
│       ├── i18nSqliteToPostgres.ts      # i18n data migration
│       ├── sqliteToPostgres.ts          # SQLite → PostgreSQL migration
│       ├── recoverTradesFromSqlite.ts   # Trade data recovery
│       ├── marketDataIntegrity.ts       # Market data integrity check
│       ├── traderSearchIntegrity.ts     # Search index verification
│       ├── tradeHistoryDurabilityAudit.ts  # Trade durability audit
│       ├── checkDoc2.ts                 # Legal doc checker
│       ├── legalSeedDoc2.ts             # Legal doc seeder
│       ├── fixLotsRangeRisk.ts          # Risk parameter fixer
│       ├── update_max_lots.ts           # Max lots update
│       ├── precompressAssets.ts         # Asset pre-compression (Brotli/gzip)
│       ├── playwrightDeps.ts            # Playwright dep installer
│       ├── startE2E.ts                  # E2E test launcher
│       ├── phase2-init.sh               # Phase 2 initialization
│       ├── deepSystemAudit20Cycles.sh   # Deep system audit runner
│       ├── verifyPetascaleParquetIntegration.sh
│       ├── migrate-mongo.js             # MongoDB migration (legacy)
│       ├── loadtest/                    # Load testing scripts (4 items)
│       └── ops/                         # Operational scripts (3 items)
│
├── 🧪 END-TO-END TESTS
│   └── e2e/                             ← Playwright E2E tests (11 items)
│       ├── AGENTS.md                    # E2E agent guidance
│       ├── utils.ts                     # E2E test utilities
│       ├── runbook.spec.ts              # Operational runbook tests
│       ├── partner-onboarding.spec.ts   # Partner flow tests
│       ├── trade-history.spec.ts        # Trade history tests
│       ├── trade-ui-stability.spec.ts   # Trade UI stability
│       ├── trader-search.spec.ts        # Search functionality
│       ├── scout-ecosystem.spec.ts      # Scout system tests
│       ├── market-data-integrity.spec.ts
│       ├── quote-customization.spec.ts
│       └── view-as-exit.spec.ts
│
├── 🎨 DESIGN
│   └── design/                          ← Design assets (16 items)
│       ├── badges/                      # Achievement badges (8 SVGs)
│       ├── certificates/                # Trading certificates (5 items)
│       └── themes/                      # Theme definitions (3 items)
│
├── ⚙️ CONFIGURATION
│   └── config/                          ← Application config files
│       └── marketdata/                  # Market data provider configs (4 items)
│
├── 📄 DOCUMENTATION (Root-level)
│   ├── README.md                        ← Quick start guide
│   ├── CAPACITOR.md                     ← Capacitor setup docs
│   ├── design_guidelines.md             ← UI/UX design standards
│   ├── replit.md                        ← Replit platform notes
│   ├── output-inline-code.md
│   ├── COT_OUTPUT_EXTRACTION_GUIDE.md   ← CoT extraction guide
│   ├── PATCH_DELIVERY_GUIDE.md          ← Patch delivery procedures
│   ├── CODEX_COUNTRY_TIMEZONE_CONTROLS.md  ← Jurisdiction controls
│   ├── JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md
│   ├── TRADE_HISTORY_TASK_LIST.md       ← Trade history feature tracking
│   ├── INMEMORY_TO_POSTGRES_PERSISTENCE_REPORT.md
│   ├── DB_HARDENING_REPORT.md
│   ├── MIGRATION_REVIEW.md              ← Database migration review
│   ├── fast_load_audit_report.md        ← Performance audit
│   ├── grift_audit_checklist.md         ← Anti-fraud audit checklist
│   ├── grift_verification_report.md     ← Anti-fraud verification
│   ├── FIX_TRACKER.md                   ← Bug fix tracking
│   │
│   ├── 📋 AUDIT REPORTS
│   │   ├── AUDIT_REPORT.md              ← Primary security audit
│   │   ├── REAUDIT_REPORT.md            ← Re-audit findings
│   │   ├── REAUDIT_STATUS_REPORT.md     ← Re-audit status tracking
│   │   ├── AUDIT_COMPLIANCE_STATUS.md   ← Compliance status
│   │   ├── AUDIT_REPORT_DEACTIVATION.md ← Deactivation audit
│   │   ├── DEEP_AUDIT_FINDINGS.md       ← Deep code-level audit
│   │   ├── FINAL_AUDIT_REMAINING_GAPS.md ← Remaining audit gaps
│   │   └── SHARED_SERVICES_AUDIT.md     ← Shared services audit
│   │
│   └── 📚 REPORTS AND REVIEWS/          ← Detailed reports archive (250 items)
│       ├── 1ST CODE REVIEW REPORT/      # Initial code review
│       ├── REVIEW REPORT & BUGS1/       # Bug reports (39 items)
│       ├── Admin/                       # Admin system reports (38 items)
│       ├── RECRUITMENT PORTAL AND ECOSYSTEM WIRING/  # Recruitment docs (19 items)
│       ├── ROUTES.TS REFACTOR/          # Route refactoring docs (14 items)
│       ├── Challenges System/           # Challenge system specs (11 items)
│       ├── COT/                         # Chain of Thought docs (10 items)
│       ├── MESSAGING & NOTIFICATION SYSTEM/  # Messaging specs (10 items)
│       ├── TRADER UI-UX DESIGN RENDERS/ # UI/UX design renders (9 items)
│       ├── CHALLNGES SYSTEM -NOT BUILT/ # Proposed challenge system
│       ├── DYNAMIC FEED SYSTEM/         # Feed system specs (8 items)
│       ├── Decomposition/               # System decomposition docs (7 items)
│       ├── 4G-3G-5G-2G OPTIMIZATIONS/  # Mobile network optimization (6 items)
│       ├── TRADING COSTS/               # Trading cost analysis (6 items)
│       ├── performance scout/           # Performance analysis (6 items)
│       ├── quotes provider config/      # Quote provider setup (5 items)
│       ├── KEEP ME SIGNED IN/           # Session persistence spec (4 items)
│       ├── PREFETCH & CACHING REFACTOR/ # Caching strategy (4 items)
│       ├── TRADE SCREEN ORIGINAL VS IMPLEMENTATION REVIEW/
│       ├── Trading Engine, Websocket, rest, audit trail+data/
│       ├── casa/                        # Country-specific compliance (18 items)
│       ├── database audit/              # DB audit reports (3 items)
│       ├── trade engine, margin and database/
│       └── ui scroll refactor/
│
├── 📦 CONFIG FILES (Root)
│   ├── package.json                     ← Root dependencies (~10KB)
│   ├── package-lock.json                ← Lock file (~433KB)
│   ├── tsconfig.json                    ← TypeScript config
│   ├── vite.config.ts                   ← Vite bundler config (~7KB)
│   ├── vitest.config.ts                 ← Vitest test config
│   ├── playwright.config.ts             ← Playwright E2E config
│   ├── tailwind.config.cjs              ← Tailwind CSS config
│   ├── postcss.config.js                ← PostCSS config
│   ├── drizzle.config.ts                ← Drizzle ORM config
│   ├── capacitor.config.ts              ← Root Capacitor config
│   ├── components.json                  ← shadcn/ui component config
│   ├── .env / .env.example              ← Environment variables
│   ├── .npmrc                           ← npm config
│   ├── .replit                          ← Replit deployment config
│   ├── .gitignore / .gitattributes
│   ├── .dockerignore
│   ├── Dockerfile                       ← Docker build
│   ├── docker-compose.infra.yml         ← Infrastructure (Postgres + Valkey)
│   ├── docker-compose.infra.durable.yml ← Durable infra compose
│   ├── TD.2.ANTIGRAVITY.code-workspace  ← VS Code workspace
│   └── .code-workspace.code-workspace
│
├── 🔄 CI/CD
│   └── .github/                         ← GitHub Actions
│       ├── AGENTS.md                    # CI/CD agent guidance
│       └── workflows/
│           ├── ci.yml                   # Main CI pipeline
│           └── db-audit.yml             # DB audit workflow
│
└── 📁 OTHER
    ├── attached_assets/                 ← Static assets & mockups (306 items)
    ├── data/                            ← Static data files
    │   └── instruments.ts               # Instrument definitions
    ├── admin_data_exports/              ← Admin export output directory
    ├── db_backups/                      ← Database backup storage
    ├── migration_imports/               ← Migration import staging
    ├── dist/                            ← Built web app (generated)
    ├── node_modules/                    ← ROOT npm dependencies
    ├── .vscode/                         ← VS Code settings
    ├── .githooks/                       ← Git hooks
    ├── .tmp/                            ← Temporary files
    ├── test-results/                    ← Test output
    ├── generate_tree.py                 ← Tree generation script
    ├── generated-icon.png               ← Generated app icon
    ├── trades.json                      ← Trade data snapshot
    └── server-5000.log / .pid           ← Server runtime files
```

---

## 🔧 Dependencies Management

### Root `node_modules/` (Web Application)

**Location:** `TD.2.ANTIGRAVITY/node_modules/`

**Used by:** `client/`, `server/`, `shared/`, `db/`, `e2e/`, `scripts/`

**Installation:**
```bash
cd TD.2.ANTIGRAVITY
npm ci          # Preferred (deterministic)
npm install     # Alternative
```

**Key packages:**
- `react`, `react-dom` — Frontend framework
- `express` — Backend server
- `drizzle-orm`, `drizzle-kit` — Database ORM & migrations
- `@tanstack/react-query` — Server-state management
- `zod` — Schema validation
- `tailwindcss` — Styling
- `ws` — WebSocket server
- `passport` — Authentication
- `bull` / `bullmq` — Job queues
- `i18next` — Internationalization

---

### MOBILE `node_modules/` (Capacitor)

**Location:** `TD.2.ANTIGRAVITY/MOBILE/node_modules/`

**Used by:** Capacitor Android/iOS wrapper

**Installation:**
```bash
cd TD.2.ANTIGRAVITY/MOBILE
npm install
```

**Sync after web or plugin changes:**
```bash
npm run sync
```

**Key packages:**
- `@capacitor/core` — Capacitor runtime
- `@capacitor/cli` — Build tools
- `@capacitor/android` / `@capacitor/ios` — Platform shells
- `@capacitor/app`, `@capacitor/keyboard`, `@capacitor/network` — Wrapper lifecycle helpers
- `native-run` — Device deployment

---

### NATIVE `node_modules/` (React Native)

**Location:** `TD.2.ANTIGRAVITY/NATIVE/node_modules/`

**Used by:** React Native Android/iOS apps

**Installation:**
```bash
cd TD.2.ANTIGRAVITY/NATIVE
npm install

# iOS only (macOS + Xcode):
npm run pod:install
```

**Key packages:**
- `react-native` — Native framework
- `@react-navigation/*` — Navigation
- `@react-native-firebase/messaging` — Push transport
- `@notifee/react-native` — Native notification presentation
- `react-native-mmkv` — Secure storage
- `zustand` — State management
- `axios` — HTTP client

---

## 📝 Best Practices for Future Additions

### Adding a New Screen (Web)

1. Create page in `client/src/pages/`
2. Add route in `client/src/App.tsx`
3. Create any needed components in `client/src/components/`
4. Add hooks in `client/src/hooks/` if needed

### Adding a New Screen (Native)

1. Create screen in `NATIVE/src/screens/`
2. Add to navigator in `NATIVE/src/navigation/`
3. Use existing hooks from `NATIVE/src/hooks/`

### Adding a New API Endpoint

1. Create route in `server/routes/`
2. Add business logic in `server/services/`
3. Update shared types in `shared/schema.pg.*.ts` or a new shared file
4. Register route in `server/routes.ts`
5. Add corresponding hook in:
   - `client/src/hooks/` (web)
   - `NATIVE/src/hooks/` (native)

### Adding a Database Table

1. Define schema in `shared/schema.pg.*.ts` (appropriate domain schema file)
2. Generate migration: `npm run db:generate`
3. Apply migration: `npm run db:migrate`
4. Add queries in `server/storage.ts` or appropriate service

### Adding a New Mobile Feature

| Type | Where to Add |
|------|--------------| 
| Capacitor plugin or wrapper shell change | `MOBILE/`, then `npm run sync` |
| Wrapper route/lifecycle bridge | `MOBILE/src/mobile/` plus `client/src/components/MobileWrapperBridge.tsx` |
| Native module | `NATIVE/android/` or `NATIVE/ios/` |
| Shared native screen/component | `NATIVE/src/components/` or `NATIVE/src/screens/` |
| Shared transport/security contract | `shared/` first, then `server/`, `client/`, `NATIVE/src/` |

### Adding Observability

1. Dashboard JSON → `ops/dashboards/`
2. Alert rules → `ops/alerts/` or `ops/prometheus-config/`
3. Runbook → `ops/runbooks/`
4. K8s monitoring → `k8s/60-monitoring.yaml`

---

## 🚀 Build Commands

### Web Application
```bash
# Development (full stack)
npm run dev

# Type checking
npm run check

# Production build
npm run build

# Start production
npm run start
```

### Database
```bash
npm run db:generate        # Generate migrations from schema
npm run db:migrate          # Apply migrations (alias: db:migrate:drizzle)
npm run db:ensure           # Bootstrap local DB
npm run db:studio           # Open Drizzle Studio
npm run db:audit            # Run DB audit
npm run db:audit:auto       # Schema dump + audit
```

### Testing
```bash
npm run test               # Unit tests (Vitest)
npm run e2e                # Playwright E2E tests
npm run e2e:install        # Install Playwright browsers
npm run smoke:admin        # Admin smoke test
npm run audit:activity     # Activity audit verify
```

### Load Testing
```bash
npm run loadtest:publish-quotes
npm run loadtest:ws-fanout
```

### Infrastructure
```bash
# Local Postgres + Valkey
docker compose -f docker-compose.infra.yml up -d

# Durable infrastructure
docker compose -f docker-compose.infra.durable.yml up -d

# Petascale analytics stack
cd petascale && docker compose up -d
```

### MOBILE (Capacitor)
```bash
cd MOBILE

# Install/update dependencies
npm install

# Sync the live web build into both shells
npm run sync

# Android diagnostics / build
npm run doctor
npm run run:android
npm run build:android:release

# iOS wrapper (macOS + Xcode only)
npm run run:ios
```

### NATIVE (React Native)
```bash
cd NATIVE

# Development / validation
npm test
npm run lint
npm run android

# Android release
npm run build:android
npm run build:android:bundle

# iOS (macOS + Xcode only)
npm run pod:install
npm run ios
npm run build:ios
```

### Mobile/Native End-to-End
```bash
# Root web/API parity
npm run e2e

# Wrapper validation
cd MOBILE && npm run sync && npm run doctor

# Native validation
cd NATIVE && npm test && npm run lint
```

---

## 📋 Environment Variables

**Location:** `TD.2.ANTIGRAVITY/.env` (see `.env.example` for reference)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session encryption |
| `ADMIN_PASSWORD` | Admin access password |
| `TP_*` | Trading platform configs |
| `CLICKHOUSE_*` | ClickHouse analytics config |
| `VALKEY_URL` | Valkey (Redis) connection |
| `MINIO_*` | Object storage config |
| `TURNSTILE_*` | Cloudflare Turnstile CAPTCHA |

**For NATIVE app:** Configure API URL in `NATIVE/src/services/api.ts`

---

## 🔄 Syncing Changes

### When Web App Changes Affect MOBILE:
```bash
npm run build              # Build web app
cd MOBILE && npx cap sync  # Sync to Capacitor
```

### When API Changes Affect NATIVE:
1. Update endpoint in `server/routes/`
2. Update hook in `NATIVE/src/hooks/`
3. Update service in `NATIVE/src/services/api.ts`

### When Schema Changes:
1. Update schema in `shared/schema.pg.*.ts`
2. Generate migration: `npm run db:generate`
3. Apply migration: `npm run db:migrate`
4. Update `server/storage.ts` queries
5. Update client hooks as needed

---

## 📁 Folder Creation Guidelines

When adding new folders:

1. **Use UPPERCASE** for major project modules (e.g., `NATIVE/`, `MOBILE/`)
2. **Use lowercase** for code directories (e.g., `hooks/`, `components/`)
3. **Create AGENTS.md** in new major folders with domain-specific guidance
4. **Add to this document** under the appropriate section
5. **Separate node_modules** for independent build systems
6. **Update `.agents/PRODUCTION_REQUIREMENTS.md`** if new production requirements

---

## 🔐 Security Notes

| Folder/File | Contains Secrets | Git Ignored |
|-------------|------------------|-------------|
| `.env` | Yes | ✅ |
| `.sops.agekey` / `*.agekey` | Yes | ✅ |
| `MOBILE/android/key.properties` | Must not exist populated in repo | ✅ (ignored; use external operator path) |
| `MOBILE/android/*.keystore` | Must not exist populated in repo | ✅ (ignored; use external operator path) |
| `NATIVE/android/app/google-services.json` | Firebase config | No (tracked placeholder/operator file) |
| `NATIVE/ios/TradeQuipNative/GoogleService-Info.plist` | Firebase config | No (tracked placeholder/operator file) |
| `k8s/02-secrets.yaml` | Template only | No (template tracked; values must stay external) |
| `node_modules/` | No | ✅ |
| `dist/` | No | ✅ |
| `trading_app.db` | User data | ✅ |
| `sessions.db` | Session data | ✅ |
| `db_backups/` | DB snapshots | ✅ |
| `admin_data_exports/` | Export data | ✅ |
| `PRODUCTION READINESS/generated/` | Generated operator material | ✅ |

---

## 📞 Quick Reference Commands

```bash
# Start everything (development)
npm run dev

# Database operations
npm run db:generate        # Generate migrations
npm run db:migrate          # Apply migrations
npm run db:ensure           # Bootstrap local DB
npm run db:studio           # Open Drizzle Studio
npm run db:audit            # Audit DB schema

# Testing
npm run test               # Unit tests
npm run e2e                # Playwright E2E
npm run smoke:admin        # Admin smoke test

# Infrastructure
docker compose -f docker-compose.infra.yml up -d    # Postgres + Valkey

# Mobile / native
cd MOBILE && npm run sync
cd MOBILE && npm run build:android:release
cd MOBILE && npm run run:ios        # macOS + Xcode only
cd NATIVE && npm test && npm run lint
cd NATIVE && npm run build:android
cd NATIVE && npm run build:ios      # macOS + Xcode only

# Load tests
npm run loadtest:publish-quotes
npm run loadtest:ws-fanout
```

---

## 🗂️ AGENTS.md Location Index

Every major subsystem has its own `AGENTS.md` with domain-specific guidance:

| Path | Scope |
|------|-------|
| `AGENTS.md` | **Repo-wide router** (read first) |
| `.agents/*.md` | Agent checklists & deep-context docs |
| `client/AGENTS.md` | Frontend conventions |
| `server/AGENTS.md` | Backend conventions |
| `server/routes/AGENTS.md` | Route architecture rules |
| `shared/AGENTS.md` | Shared types conventions |
| `db/AGENTS.md` | Database conventions |
| `security/AGENTS.md` | Security policies |
| `scripts/AGENTS.md` | Script conventions |
| `e2e/AGENTS.md` | E2E test conventions |
| `k8s/AGENTS.md` | Kubernetes conventions |
| `.github/AGENTS.md` | CI/CD conventions |
| `MOBILE/AGENTS.md` | Capacitor conventions |
| `MOBILE/android/README.md` | Wrapper Android maintenance notes |
| `MOBILE/src/mobile/AGENTS.md` | Wrapper bridge conventions |
| `MOBILE/android/AGENTS.md` | Wrapper Android shell conventions |
| `MOBILE/ios/AGENTS.md` | Wrapper iOS shell conventions |
| `MOBILE/ios/README.md` | Wrapper iOS maintenance notes |
| `NATIVE/AGENTS.md` | React Native conventions |
| `NATIVE/android/README.md` | Native Android maintenance notes |
| `NATIVE/src/AGENTS.md` | Shared React Native app conventions |
| `NATIVE/android/AGENTS.md` | Native Android shell conventions |
| `NATIVE/ios/AGENTS.md` | Native iOS shell conventions |
| `NATIVE/ios/README.md` | Native iOS maintenance notes |

---

## March 2026 Deployment Additions

New deployment-readiness and GitOps paths added during the OVH/Kubernetes productionization work:

| Path | Purpose |
|------|---------|
| `PRODUCTION READINESS/` | Deployment readiness reports, gap analysis, and execution plans |
| `PRODUCTION READINESS/AGENTS.md` | Guidance for maintaining readiness docs |
| `gitops/` | Argo CD application manifests and GitOps overlays |
| `gitops/AGENTS.md` | Guidance for GitOps updates |
| `gitops/argocd/` | Argo CD project, app-of-apps, and environment app definitions |
| `gitops/kustomize/ops/` | GitOps overlays for the ops/observability stack |
| `k8s/base/` | Kustomize-compatible app base copied from flat manifests |
| `k8s/overlays/` | staging/prod app overlays and secret templates |
| `ops/kubernetes/assets/` | vendored Grafana dashboard and MinIO monitor assets for Kustomize-safe rendering |
| `scripts/ops/check_required_toolchain.sh` | operator workstation tool audit |
| `scripts/ops/bootstrap_sops_age.sh` | local SOPS + age bootstrap |
| `scripts/ops/generateProductionSecrets.ts` | self-hosted secret generation |
| `scripts/ops/updateKustomizeImage.ts` | overlay image promotion helper |
