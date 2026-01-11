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
} from "../server/db/ensureSchema";
import { bootstrapDoc1Seed } from "../server/legal/bootstrapDoc1Seed";

async function main() {
  try {
    ensureCoreTradingSchema();

    ensureSystemConfigTable();
    ensureGlobalSettingsTable();
    ensureAccountLifecycleSchema();

    ensureQuotesColumns();
    ensureUserSettingsColumns();
    ensureUsersColumns();

    ensureUserLoginHistoryTable();
    ensureLoginHistorySessionColumns();
    ensureUserAccountEventsTable();
    ensureUserAdminNotesTable();

    ensureUserSessionsTable();
    ensureUserSessionIdentityColumns();
    ensureUserSessionGeoColumns();
    ensureLoginHistoryIdentityColumns();
    ensureLoginHistoryGeoColumns();

    ensureTradeAuditTable();
    ensureInstitutionalAuditColumns();
    ensureOrderIntentAuditTable();
    ensureTradeCloseAuditColumns();
    ensureTradesProvenanceColumns();

    ensureTraderJournalTable();
    ensureAdminActionsTable();
    ensureAuditExportManifestTable();
    ensureMigrationTables();

    ensureTieredAccessSchema();
    ensureLegalComplianceSchema();
    ensureSignupFreezeWaitlistSchema();
    ensureSignupFingerprintSchema();

    ensureMarketDailyCloseTable();
    ensureDailyFxClosesSchema();
    ensureI18nSchema();

    bootstrapDoc1Seed();

    console.log("[db] Schema ensure complete");
  } catch (e) {
    console.error("[db] Schema ensure failed:", e);
    process.exitCode = 1;
  }
}

void main();
