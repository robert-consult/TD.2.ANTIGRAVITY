import {
  ensureAdminActionsTable,
  ensureAuditExportManifestTable,
  ensureAccountLifecycleSchema,
  ensureCoreTradingSchema,
  ensureDailyFxClosesSchema,
  ensureGlobalSettingsTable,
  ensureI18nSchema,
  ensureInstitutionalAuditColumns,
  ensureLegalComplianceSchema,
  ensureLoginHistoryGeoColumns,
  ensureLoginHistoryIdentityColumns,
  ensureLoginHistorySessionColumns,
  ensureMarketDailyCloseTable,
  ensureMigrationTables,
  ensurePgStatStatementsExtension,
  ensureOrderIntentAuditTable,
  ensureQuotesColumns,
  ensureSignupFingerprintSchema,
  ensureSignupFreezeWaitlistSchema,
  ensureSystemConfigTable,
  ensureTieredAccessSchema,
  ensureTradeAuditTable,
  ensureTradeCloseAuditColumns,
  ensureTradesProvenanceColumns,
  ensureTraderJournalTable,
  ensureUserAccountEventsTable,
  ensureUserAdminNotesTable,
  ensureUserLoginHistoryTable,
  ensureUserSessionGeoColumns,
  ensureUserSessionIdentityColumns,
  ensureUserSessionsTable,
  ensureUserSettingsColumns,
  ensureUsersColumns,
  shutdownEnsureSchemaPool,
} from "../server/db/ensureSchema";
import { bootstrapDoc1Seed } from "../server/legal/bootstrapDoc1Seed";

async function main() {
  try {
    await ensureCoreTradingSchema();
    await ensurePgStatStatementsExtension();

    await ensureSystemConfigTable();
    await ensureGlobalSettingsTable();
    await ensureAccountLifecycleSchema();

    await ensureQuotesColumns();
    await ensureUserSettingsColumns();
    await ensureUsersColumns();

    await ensureUserLoginHistoryTable();
    await ensureLoginHistorySessionColumns();
    await ensureUserAccountEventsTable();
    await ensureUserAdminNotesTable();

    await ensureUserSessionsTable();
    await ensureUserSessionIdentityColumns();
    await ensureUserSessionGeoColumns();
    await ensureLoginHistoryIdentityColumns();
    await ensureLoginHistoryGeoColumns();

    await ensureTradeAuditTable();
    await ensureInstitutionalAuditColumns();
    await ensureOrderIntentAuditTable();
    await ensureTradeCloseAuditColumns();
    await ensureTradesProvenanceColumns();

    await ensureTraderJournalTable();
    await ensureAdminActionsTable();
    await ensureAuditExportManifestTable();
    await ensureMigrationTables();

    await ensureTieredAccessSchema();
    await ensureLegalComplianceSchema();
    await ensureSignupFreezeWaitlistSchema();
    await ensureSignupFingerprintSchema();

    await ensureMarketDailyCloseTable();
    await ensureDailyFxClosesSchema();
    await ensureI18nSchema();

    await bootstrapDoc1Seed();

    console.log("[db] Schema ensure complete");
  } catch (e) {
    console.error("[db] Schema ensure failed:", e);
    process.exitCode = 1;
  } finally {
    await shutdownEnsureSchemaPool();
  }
}

void main();
