---
audience: generated
exposure: internal
owner: documentation-program
canonical_sources:
  - .env.example
  - server/index.ts
  - server/routes/wsCore.ts
  - server/routes.ts
last_verified: 2026-03-30
status: generated
generated_from:
  - scripts/docs/generators/env/index.ts
---

# Environment Catalog

> Generated from `.env.example` plus direct `process.env.*` and `requireEnv()` references.

Environment names discovered: **217**.

| Variable | Example Default | Startup Rule | Example Source References |
| --- | --- | --- | --- |
| `ACCOUNT_RECALC_BATCH_INTERVAL_MS` | `250` | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `ACCOUNT_RECALC_THROTTLE_MS` | `250` | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `ADMIN_DATA_EXPORT_ALLOW_PROCESS_FALLBACK` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/adminDataExportQueue.ts` |
| `ADMIN_DATA_EXPORT_BACKOFF_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_LOCAL_DIR` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_LOCAL_LINK_BASE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_MAX_ATTEMPTS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_QUEUE_CONCURRENCY` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_QUEUE_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_QUEUE_NAME` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_QUEUE_PREFIX` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_EXPORT_RETENTION_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/adminDataExportQueue.ts` |
| `ADMIN_DATA_EXPORT_STALL_SECONDS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `ADMIN_DATA_ROLLUP_MAX_AGE_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminDataRollups.ts` |
| `ADMIN_DATA_ROLLUP_REFRESH_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/adminDataRollups.ts` |
| `ADMIN_DATA_ROLLUP_WINDOWS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/adminDataRollups.ts` |
| `ADMIN_EMAIL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/deepSystemAudit20Cycles.sh`<br>`scripts/marketDataIntegrity.ts`<br>`scripts/traderSearchIntegrity.ts` |
| `ADMIN_GLOBAL_SETTINGS_MIN_INTERVAL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/globalSettingsRateLimit.ts` |
| `ADMIN_PASSWORD` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/deepSystemAudit20Cycles.sh`<br>`scripts/marketDataIntegrity.ts`<br>`scripts/traderSearchIntegrity.ts` |
| `ALLOW_ADMIN_HARD_DELETE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminActivity.ts` |
| `ALLOW_INSECURE_INTERNAL_TRANSPORT` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `API_KEY_1FORGE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/utils/forgeOHLC.ts`<br>`server/utils/previousClose.ts` |
| `APP_BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminScout/support.ts` |
| `APP_ROLE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/startE2E.ts`<br>`server/index.ts`<br>`server/observability/tracing.ts`<br>`server/routes/metricsState.ts` |
| `APP_URL` | `http://localhost:5000` | Referenced only; no explicit fail-fast rule discovered. | `MOBILE/capacitor.config.ts`<br>`server/routes/wsCore.ts`<br>`server/services/appLinks.ts` |
| `AUTOCLOSE_ALLOW_STALE_CLOSE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/cron/marginCall.ts`<br>`server/services/runtimeConfig/autoClose.test.ts`<br>`server/services/runtimeConfig/autoClose.ts` |
| `AUTOCLOSE_STALE_DEFER_MAX_MIN` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/autoClose.test.ts`<br>`server/services/runtimeConfig/autoClose.ts` |
| `BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/deepSystemAudit20Cycles.sh` |
| `BULL_BOARD_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminDataExports.ts` |
| `CAPACITOR_SERVER_URL` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `MOBILE/capacitor.config.ts` |
| `CAPTCHA_HCAPTCHA_SECRET` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/captcha.ts` |
| `CAPTCHA_TURNSTILE_SECRET` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/captcha.ts` |
| `CHALLENGE_CERT_VERIFICATION_SECRET` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/recruitment/challengesV4/certificateCode.ts` |
| `CHALLENGE_EVAL_DISABLED_POLL_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/challengeScheduler.test.ts` |
| `CHALLENGE_EVAL_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/challengeScheduler.test.ts`<br>`server/services/runtimeConfig/challengeScheduler.ts` |
| `CHALLENGE_EVAL_INTERVAL_MINUTES` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/challengeScheduler.test.ts` |
| `CHALLENGE_EVAL_MAX_ROWS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/challengeScheduler.test.ts` |
| `CHALLENGE_EVAL_START_DELAY_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/challengeScheduler.test.ts` |
| `CHALLENGE_LEADERBOARD_ANON_PEPPER` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/traderTalent.ts` |
| `CLICKHOUSE_DATABASE` | `tradehub` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `CLICKHOUSE_ENABLED` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `CLICKHOUSE_PASSWORD` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `CLICKHOUSE_REQUEST_TIMEOUT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `CLICKHOUSE_SYNC_ENABLED` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `CLICKHOUSE_URL` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `CLICKHOUSE_USER` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `COOKIE_SAMESITE` | `strict` | Fail-fast when set to `none`. | `server/index.ts`<br>`server/routes.ts`<br>`server/security/csrf.ts`<br>`server/services/rememberMe.ts` |
| `COOKIE_SECURE` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/routes.ts`<br>`server/routes/wsCore.ts`<br>`server/security/csrf.ts` |
| `CURRENT_USER_RECALC_MIN_INTERVAL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/currentUserRecalc.ts` |
| `DAILY_CLOSE_WRITE_INTERVAL_MS` | `60000` | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `DATABASE_URL` | `postgresql://tradehub:tradehub_pw@localhost:5432/tradehub` | Referenced only; no explicit fail-fast rule discovered. | `db/config.ts`<br>`db/seed.ts`<br>`scripts/dbDumpSchema.ts`<br>`scripts/i18nRepairLocale.ts` |
| `DB_DIALECT` | `postgres` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `E2E_DISABLE_BACKGROUND_JOBS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `EMAIL_FROM` | `TradeQuip <noreply@example.com>` | Referenced only; no explicit fail-fast rule discovered. | `server/cron/verificationReminders.ts`<br>`server/routes/auth/register.ts`<br>`server/routes/authCore.ts`<br>`server/routes/profile/update.ts` |
| `EMAIL_VERIFY_TOKEN_SECRET` | `(empty)` | Required in production; short values fail in production. | `server/index.ts`<br>`server/security/emailVerificationToken.ts` |
| `ENCRYPTION_KEY` | `(empty)` | Warn in development, fail-fast in production unless 64 hex chars. | `server/index.ts`<br>`server/services/crypto.ts` |
| `EXPORT_LOCAL_LINK_SIGNING_SECRET` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/objectStorage.ts` |
| `EXPORT_OBJECT_STORAGE_ACCESS_KEY` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_BUCKET` | `admin-data-exports` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_ENABLED` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_ENDPOINT` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_LINK_TTL_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_PORT` | `9000` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_PREFIX` | `admin-data` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_REGION` | `us-east-1` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_SECRET_KEY` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `EXPORT_OBJECT_STORAGE_USE_SSL` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/petascaleEnv.ts` |
| `FORGE_KEY` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerManager.test.ts`<br>`server/routes/publicCore.ts`<br>`server/utils/directForge.ts`<br>`server/utils/forge1DOHLC.ts` |
| `GLOBAL_SETTINGS_CACHE_TTL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/globalSettings.ts` |
| `GRIFT_CONFIG_TTL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/griftConfig.ts` |
| `GRIFT_IP2ASN_TSV_PATH` | No | Referenced only; no explicit fail-fast rule discovered. | `server/grift/griftIp2AsnDataset.ts` |
| `GRIFT_IPTOASN_TIMEOUT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/grift/griftIpAsn.ts` |
| `GRIFT_IPTOASN_TOKEN` | No | Referenced only; no explicit fail-fast rule discovered. | `server/grift/griftIpAsn.ts` |
| `GRIFT_IPTOASN_URL_TEMPLATE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/grift/griftIpAsn.ts` |
| `GRIFT_MAX_EVIDENCE_LINKED_USERS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/griftConfig.ts` |
| `GRIFT_MAX_LINKED_EDGE_BATCH_ROWS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/griftConfig.ts` |
| `GRIFT_MAX_LINKED_EDGE_WRITES_PER_TRIGGER` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/runtimeConfig/griftConfig.ts` |
| `HCAPTCHA_SECRET_KEY` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/captcha.ts` |
| `HOSTNAME` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/controlledReload.ts` |
| `I18N_MAX_ROUNDS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nRunWorker.ts` |
| `I18N_SLEEP_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nRunWorker.ts` |
| `IMAGE_REGISTRY` | `local` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `IMAGE_TAG` | `dev` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `INTEGRITY_BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `INTEGRITY_IMPORT_AND_ENABLE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `INTEGRITY_PROVIDER_KEY` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `INTEGRITY_QUOTES_RETRY_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `INTEGRITY_QUOTES_WAIT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `INTEGRITY_TIMEOUT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `INTEGRITY_WS_REQUIRE_UPDATE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/marketDataIntegrity.ts` |
| `LEGAL_ACCEPTANCE_SERIALIZABLE_MAX_RETRIES` | No | Referenced only; no explicit fail-fast rule discovered. | `server/legal/legalAcceptanceService.ts` |
| `LEGAL_TERMS_HMAC_SECRET` | `change-me-min-32-chars-change-me` | Fail-fast when missing or shorter than 32 chars. | `server/index.ts`<br>`server/legal/cryptoUtils.ts`<br>`server/partner/anonymizeUser.ts`<br>`server/recruitment/challengesV4/certificateCode.ts` |
| `LIVE_ACCOUNT_THROTTLE_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/liveBus.ts` |
| `LIVEBUS_CHANNEL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/publishQuotes.ts`<br>`server/services/liveBus.ts` |
| `LIVEBUS_VALKEY_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/liveBus.ts` |
| `LOADTEST_ADMIN_COOKIE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/adminDataTab.ts`<br>`scripts/loadtest/exportPipeline.ts` |
| `LOADTEST_AUTH_EMAIL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/wsFanout.ts` |
| `LOADTEST_AUTH_PASSWORD` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/wsFanout.ts` |
| `LOADTEST_BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/adminDataTab.ts`<br>`scripts/loadtest/exportPipeline.ts` |
| `LOADTEST_DAY_WINDOWS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/adminDataTab.ts` |
| `LOADTEST_MAX_ERROR_PCT` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/adminDataTab.ts` |
| `LOG_API_BODIES` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `LOGIN_RATE_LIMIT_IP_EMAIL_MAX_ATTEMPTS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/loginRateLimit.ts` |
| `LOGIN_RATE_LIMIT_IP_MAX_ATTEMPTS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/loginRateLimit.ts` |
| `LOGIN_RATE_LIMIT_WINDOW_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/loginRateLimit.ts` |
| `MARGIN_STOP_OUT_PCT` | No | Referenced only; no explicit fail-fast rule discovered. | `server/cron/marginCall.ts` |
| `MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerManager.test.ts`<br>`server/services/runtimeConfig/marketDataProviders.ts` |
| `MARKET_DATA_PROVIDER_CACHE_TTL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerManager.ts`<br>`server/services/runtimeConfig/marketDataProviders.ts` |
| `MARKET_DATA_PROVIDER_CONFIG_DIR` | `config/marketdata/providers` | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerConfigFiles.ts`<br>`server/routes/adminMarketData.ts` |
| `MARKET_DATA_PROVIDER_FILE_SYNC` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `MARKET_DATA_PROVIDER_FILE_SYNC_INCLUDE_EXAMPLES` | No | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerConfigFiles.ts` |
| `MARKET_DATA_PROVIDER_FILE_SYNC_MODE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerConfigFiles.ts` |
| `MARKET_HOURS_CACHE_TTL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/quoteService.ts` |
| `METRICS_AUTH_TOKEN` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `METRICS_REQUIRE_PRIVATE` | `true` | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `MIGRATE_BATCH_SIZE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nSqliteToPostgres.ts`<br>`scripts/sqliteToPostgres.ts` |
| `MIGRATE_DRY_RUN` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nSqliteToPostgres.ts`<br>`scripts/sqliteToPostgres.ts` |
| `MIGRATION_SUPERADMIN_EMAILS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminMigration.ts` |
| `MIGRATION_SUPERADMIN_IDS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminMigration.ts` |
| `NODE_ENV` | `development` | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts`<br>`MOBILE/capacitor.config.ts`<br>`scripts/tradeHistoryDurabilityAudit.ts`<br>`server/index.ts` |
| `OPENAI_API_KEY` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/i18n/providers/openai.ts` |
| `OPENAI_BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `server/i18n/providers/openai.ts` |
| `OTEL_DIAGNOSTIC_LOGGING` | No | Referenced only; no explicit fail-fast rule discovered. | `server/observability/tracing.ts` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | Referenced only; no explicit fail-fast rule discovered. | `server/observability/tracing.ts` |
| `OTEL_SERVICE_NAME` | No | Referenced only; no explicit fail-fast rule discovered. | `server/observability/tracing.ts` |
| `OTEL_TRACING_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/observability/tracing.ts` |
| `PARTNER_ALLOC_SYNC_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/cron/syncPartnerAllocations.ts` |
| `PARTNER_ANON_SALT` | No | Referenced only; no explicit fail-fast rule discovered. | `server/partner/anonymizeUser.ts` |
| `PARTNER_PORTAL_BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminScout/support.ts` |
| `POD_NAME` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/controlledReload.ts` |
| `PORT` | No | Referenced only; no explicit fail-fast rule discovered. | `WEBSITE/server/index.ts` |
| `QUOTE_DB_WRITE_INTERVAL_MS` | `5000` | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `QUOTE_DB_WRITE_MODE` | `append` | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `QUOTE_EXEC_ALLOW_DB_FALLBACK` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/quoteService.ts` |
| `QUOTE_REVALIDATE_ALLOW_EXPECTED_QUOTE_FALLBACK` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/quoteService.ts` |
| `QUOTE_REVALIDATE_MAX_AGE_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/trader/tradeOpen.ts`<br>`server/services/quoteService.ts` |
| `QUOTE_REVALIDATE_MAX_EXEC_PRICE_DRIFT_BPS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/trader/tradeOpen.ts`<br>`server/services/quoteService.ts` |
| `QUOTE_REVALIDATE_TS_REGRESSION_GRACE_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/quoteService.ts` |
| `QUOTE_SNAPSHOT_KEY` | No | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts`<br>`server/services/quoteHub.ts` |
| `QUOTE_SNAPSHOT_TTL_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `QUOTE_SOURCE` | No | Referenced only; no explicit fail-fast rule discovered. | `server/engine/orderEngine.ts`<br>`server/services/quoteService.ts` |
| `QUOTE_STALE_AFTER_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/trader/tradeOpen.ts`<br>`server/services/quoteService.ts` |
| `QUOTE_SUBSCRIPTIONS_CACHE_TTL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/quoteSubscriptions.ts` |
| `QUOTE_SYMBOL_REFRESH_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `QUOTE_SYMBOL_TTL_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `RECOVER_APPLY` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/recoverTradesFromSqlite.ts` |
| `RECOVER_EMAIL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/recoverTradesFromSqlite.ts` |
| `RECOVER_INCLUDE_OPEN` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/recoverTradesFromSqlite.ts` |
| `REDIS_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/publishQuotes.ts`<br>`server/services/sessionStore.ts` |
| `REPAIR_DELETE_TRANSLATIONS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nRepairLocale.ts` |
| `REPAIR_DRY_RUN` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nRepairLocale.ts` |
| `REPAIR_LOCALE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nRepairLocale.ts` |
| `REPAIR_MODE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/i18nRepairLocale.ts` |
| `REPL_SLUG` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/crypto.ts` |
| `RESEND_API_KEY` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/cron/verificationReminders.ts`<br>`server/index.ts`<br>`server/routes/admin.ts`<br>`server/routes/adminScout/support.ts` |
| `RESEND_FROM` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/adminScout/support.ts` |
| `ROLLOVER_CACHE_TTL_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/services/tradeCosts.ts` |
| `SCOUT_METRICS_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/cron/scoutMetrics.ts` |
| `SCOUT_METRICS_QUERY_TIMEOUT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/scout/calcScoutMetrics.ts` |
| `SCOUT_QUERY_TIMEOUT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/scout/scoutService.ts` |
| `SEED_DEFAULT_COUNTRY_ISO2` | No | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts` |
| `SEED_DESTRUCTIVE_NONLOCAL_OK` | No | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts` |
| `SEED_DESTRUCTIVE_OK` | No | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts` |
| `SEED_RELAX_MARKET_HOURS` | No | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts` |
| `SEED_RESET_TRADES` | No | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts` |
| `SEED_RESET_TRADES_CONFIRM` | No | Referenced only; no explicit fail-fast rule discovered. | `db/seed.ts` |
| `SERVER_REUSE_PORT` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/security/captcha.ts` |
| `SESSION_COOKIE_NAME` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/loadtest/wsFanout.ts`<br>`scripts/marketDataIntegrity.ts`<br>`scripts/traderSearchIntegrity.ts` |
| `SESSION_SECRET` | `change-me` | Fail-fast when missing; weak values warned in development. | `server/index.ts`<br>`server/partner/anonymizeUser.ts`<br>`server/recruitment/challengesV4/certificateCode.ts`<br>`server/routes.ts` |
| `SESSION_STORE` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/services/sessionStore.ts` |
| `SMOKE_BASE_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/marketDataIntegrity.ts`<br>`scripts/traderSearchIntegrity.ts` |
| `SMOKE_QUOTES_RETRY_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/marketDataIntegrity.ts` |
| `SMOKE_QUOTES_WAIT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/marketDataIntegrity.ts` |
| `SMOKE_TIMEOUT_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/marketDataIntegrity.ts` |
| `SMOKE_WS_REQUIRE_UPDATE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/adminSmoke.ts`<br>`scripts/marketDataIntegrity.ts` |
| `SMS_OTP_SECRET` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/security/smsOtpToken.ts` |
| `SQLITE_DB_PATH` | No | Referenced only; no explicit fail-fast rule discovered. | `db/legacySqliteSource.ts` |
| `TRADE_AUDIT_VERIFY_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/cron/tradeAuditVerification.ts` |
| `TRADE_AUDIT_VERIFY_FAIL_FAST` | No | Referenced only; no explicit fail-fast rule discovered. | `server/cron/tradeAuditVerification.ts` |
| `TRADE_EXCURSION_DURABLE_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/trades/excursionTracking.ts` |
| `TRADE_EXCURSION_KEY_PREFIX` | No | Referenced only; no explicit fail-fast rule discovered. | `server/trades/excursionTracking.ts` |
| `TRADE_EXCURSION_PUBSUB_CHANNEL` | No | Referenced only; no explicit fail-fast rule discovered. | `server/trades/excursionTracking.ts` |
| `TRADE_EXCURSION_PUBSUB_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/trades/excursionTracking.ts` |
| `TRADE_EXCURSION_TTL_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/trades/excursionTracking.ts` |
| `TRADE_HISTORY_AUDIT_FAIL_ON_EMPTY` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/tradeHistoryDurabilityAudit.ts` |
| `TRADE_HISTORY_AUDIT_FAIL_ON_EPHEMERAL_STORAGE` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/tradeHistoryDurabilityAudit.ts` |
| `TRADE_HISTORY_AUDIT_FAIL_ON_MISSING_TRIGGERS` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/tradeHistoryDurabilityAudit.ts` |
| `TRADE_HISTORY_AUDIT_FAIL_ON_SEQ_SKEW` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/tradeHistoryDurabilityAudit.ts` |
| `TRADE_HISTORY_AUDIT_STRICT` | No | Referenced only; no explicit fail-fast rule discovered. | `scripts/tradeHistoryDurabilityAudit.ts` |
| `TRANSPORT_HEADERS_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `TRANSPORT_HSTS_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `TRANSPORT_HSTS_INCLUDE_SUBDOMAINS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `TRANSPORT_HSTS_MAX_AGE_SEC` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `TRANSPORT_HSTS_PRELOAD` | No | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `TRANSPORT_REQUIRE_TLS` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts` |
| `TRUST_PROXY_GEO_HEADERS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/proxyHeaders.test.ts`<br>`server/security/proxyHeaders.ts` |
| `TURNSTILE_SECRET_KEY` | No | Referenced only; no explicit fail-fast rule discovered. | `server/security/captcha.ts` |
| `TWELVE_DATA_API_KEY` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/marketdata/providerManager.test.ts` |
| `TWILIO_ACCOUNT_SID` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/routes/verification.ts` |
| `TWILIO_AUTH_TOKEN` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/routes/verification.ts`<br>`server/security/smsOtpToken.ts` |
| `TWILIO_FROM_NUMBER` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/routes/verification.ts` |
| `TWILIO_MESSAGING_SERVICE_SID` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | `server/index.ts`<br>`server/routes/verification.ts` |
| `UPSTREAM_WS_FLUSH_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/feeds/quoteFeed.ts` |
| `VALKEY_URL` | `redis://localhost:6379/0` | Referenced only; no explicit fail-fast rule discovered. | `scripts/loadtest/publishQuotes.ts`<br>`server/index.ts`<br>`server/services/petascaleEnv.ts`<br>`server/services/sessionStore.ts` |
| `VITE_API_URL` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `VITE_APP_URL` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `VITE_WS_URL` | `(empty)` | Referenced only; no explicit fail-fast rule discovered. | No source references discovered. |
| `WEBSITE_CONTACT_WEBHOOK_URL` | No | Referenced only; no explicit fail-fast rule discovered. | `WEBSITE/server/routes.ts` |
| `WS_ALLOWED_ORIGINS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_JURISDICTION_RECHECK_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_MAX_CONNECTIONS_PER_USER` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_MAX_MESSAGE_BYTES` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_MESSAGE_RATE_LIMIT` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_MESSAGE_RATE_WINDOW_MS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_ORIGIN_ALLOW_MISSING` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_ORIGIN_VALIDATION_ENABLED` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
| `WS_TRANSPORT_REQUIRE_TLS` | No | Referenced only; no explicit fail-fast rule discovered. | `server/routes/wsCore.ts` |
