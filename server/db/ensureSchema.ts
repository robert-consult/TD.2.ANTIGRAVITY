import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, dbClient } from "@db";
import { isPostgres } from "@db/config";

let migrateOnce: Promise<void> | null = null;

async function ensurePostgresSchema(): Promise<void> {
  if (!isPostgres) {
    throw new Error("Non-Postgres databases are no longer supported.");
  }
  if (!migrateOnce) {
    migrateOnce = migrate(db, {
      migrationsFolder: "db/migrations",
      migrationsSchema: "drizzle",
    }).catch((err) => {
      migrateOnce = null;
      throw err;
    });
  }
  await migrateOnce;
}

async function ensure() {
  await ensurePostgresSchema();
}

export function isPgStatStatementsPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = "code" in error ? (error as { code?: unknown }).code : undefined;
  const maybeMessage = "message" in error ? (error as { message?: unknown }).message : undefined;
  return (
    maybeCode === "42501" &&
    typeof maybeMessage === "string" &&
    maybeMessage.includes('permission denied to create extension "pg_stat_statements"')
  );
}

export async function ensurePgStatStatementsExtension() {
  await ensure();
  try {
    await dbClient.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  } catch (error) {
    if (isPgStatStatementsPermissionError(error)) {
      console.warn(
        "[db] Skipping pg_stat_statements extension ensure; current database user lacks CREATE EXTENSION privileges.",
      );
      return;
    }
    throw error;
  }
}

export async function ensureCoreTradingSchema() {
  await ensure();
}

export async function ensureTradeCloseAuditColumns() {
  await ensure();
}

export async function ensureTradeAuditTable() {
  await ensure();
}

export async function ensureInstitutionalAuditColumns() {
  await ensure();
}

export async function ensureOrderIntentAuditTable() {
  await ensure();
}

export async function ensureQuotesColumns() {
  await ensure();
}

export async function ensureUserSettingsColumns() {
  await ensure();
}

export async function ensureGlobalSettingsTable() {
  await ensure();
}

export async function ensureUsersColumns() {
  await ensure();
}

export async function ensureUserLoginHistoryTable() {
  await ensure();
}

export async function ensureUserAccountEventsTable() {
  await ensure();
}

export async function ensureUserAdminNotesTable() {
  await ensure();
}

export async function ensureLoginHistorySessionColumns() {
  await ensure();
}

export async function ensureSystemConfigTable() {
  await ensure();
}

export async function ensureMarketDailyCloseTable() {
  await ensure();
}

export async function ensureTraderJournalTable() {
  await ensure();
}

export async function ensureAdminActionsTable() {
  await ensure();
}

export async function ensureUserSessionsTable() {
  await ensure();
}

export async function ensureUserSessionIdentityColumns() {
  await ensure();
}

export async function ensureUserSessionGeoColumns() {
  await ensure();
}

export async function ensureLoginHistoryIdentityColumns() {
  await ensure();
}

export async function ensureLoginHistoryGeoColumns() {
  await ensure();
}

export async function ensureTradesProvenanceColumns() {
  await ensure();
}

export async function ensureAuditExportManifestTable() {
  await ensure();
}

export async function ensureMigrationTables() {
  await ensure();
}

export async function ensureUserTierColumns() {
  await ensure();
}

export async function ensureUserVerificationTable() {
  await ensure();
}

export async function ensureVerificationThrottleColumns() {
  await ensure();
}

export async function ensureUserVerificationPolicyColumns() {
  await ensure();
}

export async function ensureEmailVerificationTokensTable() {
  await ensure();
}

export async function ensureSmsOtpTokensTable() {
  await ensure();
}

export async function ensureUserEquityDailyTable() {
  await ensure();
}

export async function ensureUserMfaTable() {
  await ensure();
}

export async function ensureUserKycProfilesTable() {
  await ensure();
}

export async function ensureUserPayoutProfilesTable() {
  await ensure();
}

export async function ensureIdentityAuditTable() {
  await ensure();
}

export async function ensureGriftIdentityLinksTable() {
  await ensure();
}

export async function ensureGriftAlertsTable() {
  await ensure();
}

export async function ensureGriftUserRiskTable() {
  await ensure();
}

export async function ensureGriftEnforcementLogTable() {
  await ensure();
}

export async function ensureGriftLinkedAccountEdgesTable() {
  await ensure();
}

export async function ensureGriftConfigTable() {
  await ensure();
}

export async function ensureGriftDevicesTable() {
  await ensure();
}

export async function ensureGriftDeviceUsersTable() {
  await ensure();
}

export async function ensureGriftSignalsTable() {
  await ensure();
}

export async function ensureGriftObservationsTable() {
  await ensure();
}

export async function ensureGriftCasesTable() {
  await ensure();
}

export async function ensureGriftAdminActionsTable() {
  await ensure();
}

export async function ensureGriftUserScoresTable() {
  await ensure();
}

export async function ensureGriftUserEnforcementsTable() {
  await ensure();
}

export async function ensureAuthEventsTable() {
  await ensure();
}

export async function ensureGriftTradeObservationsTable() {
  await ensure();
}

export async function ensureGriftIpAsnCacheTable() {
  await ensure();
}

export async function ensureGriftIpAsnRangesTable() {
  await ensure();
}

export async function ensureGriftIpAsnDatasetMetaTable() {
  await ensure();
}

export async function ensureGriftDetectionSchema() {
  await ensure();
}

export async function ensureUserVerificationLockoutColumn() {
  await ensure();
}

export async function ensureSessionRevocationColumns() {
  await ensure();
}

export async function ensureTieredAccessSchema() {
  await ensure();
}

export async function ensureLegalComplianceSchema() {
  await ensure();
}

export async function ensureSignupFreezeWaitlistSchema() {
  await ensure();
}

export async function ensureSignupFingerprintSchema() {
  await ensure();
}

export async function ensureDailyFxClosesSchema() {
  await ensure();
}

export async function ensureI18nSchema() {
  await ensure();
}

export async function ensureAccountLifecycleSchema() {
  await ensure();
}

export async function shutdownEnsureSchemaPool() {
  await dbClient.end();
}
