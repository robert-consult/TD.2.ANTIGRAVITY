import { describe, expect, it, vi } from "vitest";

vi.mock("@db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {},
      }),
    }),
    query: {
      systemConfig: {
        findFirst: async () => null,
      },
    },
  },
}));
import {
  buildSystemConfigAdminSnapshot,
  buildSystemConfigAllSnapshot,
  buildSystemConfigJurisdictionRestrictionsSnapshot,
  buildSystemConfigPolicySnapshot,
  DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY,
  parseSystemConfigJurisdictionRestrictionsUpdateInput,
  parseSystemConfigPolicyUpdateInput,
} from "./systemConfig";

describe("systemConfig owner service", () => {
  it("builds admin snapshot defaults from the canonical owner", () => {
    expect(buildSystemConfigAdminSnapshot(undefined)).toMatchObject({
      id: 1,
      marketDataActiveProviderKey: DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY,
      marketDataFallbackProviderKeysCsv: "",
      maintenanceMode: false,
      quoteRefreshMs: 870,
      feedPollMs: 870,
      staleThresholdMs: 30000,
      signupCaptchaEnforce: true,
      captchaProvider: "SLIDER",
      rememberMeEnabled: true,
      allowUserTimezoneEdit: true,
      scoutTabEnabled: true,
      migrationChunkingEnabled: false,
      migrationChunkSizeMb: 51200,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("builds policy snapshot with the full PolicyConfig contract plus admin aliases", () => {
    const snapshot = buildSystemConfigPolicySnapshot(undefined);
    expect(snapshot).toMatchObject({
      contenderMinAgeDays: 30,
      contenderMinTradesLifetime: 30,
      contenderMinBalancePct: 1.2,
      contenderPath2MinAgeDays: 90,
      contenderPath2MinTradesLast90: 20,
      contenderPath2MinReturnLast90: 0.1,
      contenderPath2MaxDaysSinceLastTrade: 14,
      autoPromotePerformer: true,
      emailResendCooldownSec: 60,
      emailDailySendCap: 5,
      smsDailySendCap: 5,
      smsResendCooldownSec: 60,
      otpMaxAttempts: 5,
      otpLockMinutes: 30,
      policyContenderPath1MinAgeDays: 30,
      policyContenderPath1MinTradesLifetime: 30,
      policyContenderPath1MinBalancePct: 1.2,
      policyAutoPromotePerformer: true,
      updatedAt: null,
    });
    expect(snapshot.initialVerifyReminderDaysAfterSignup).toEqual([0, 7, 12, 13]);
    expect(snapshot.reverifyReminderOffsetsDays).toEqual([-7, -3, -1, 0, 2]);
  });

  it("builds the shared all-config summary from the same canonical defaults", () => {
    expect(buildSystemConfigAllSnapshot(undefined)).toMatchObject({
      maintenanceMode: false,
      tradingHalt: false,
      closeOnlyMode: false,
      blockOpenOnStaleQuotes: true,
      maintenanceMessage: "System is under maintenance. Trading will resume shortly.",
      quoteRefreshMs: 870,
      feedPollMs: 870,
      staleThresholdMs: 30000,
      legalCoverageEnforce: false,
      policyOtpMaxAttempts: 5,
      policyOtpLockMinutes: 30,
      updatedAt: null,
    });
  });

  it("uses the canonical jurisdiction defaults", () => {
    expect(buildSystemConfigJurisdictionRestrictionsSnapshot(undefined)).toEqual({
      restrictedCountriesCsv: "KP,IR,CU,SY",
      restrictedMessage: "This jurisdiction is not supported due to regulatory restrictions.",
    });
  });

  it("rejects nonsensical policy values in the update parser", () => {
    const parsed = parseSystemConfigPolicyUpdateInput({
      expectedUpdatedAt: 42,
      policyOtpMaxAttempts: 0,
    });

    expect(parsed).toMatchObject({
      ok: false,
      message: expect.stringContaining("policyOtpMaxAttempts"),
    });
  });

  it("parses policy updates with optimistic concurrency metadata", () => {
    const parsed = parseSystemConfigPolicyUpdateInput({
      expectedUpdatedAt: 42,
      policyOtpMaxAttempts: 6,
      policyEmailResendCooldownSec: 90,
    });

    expect(parsed).toEqual({
      ok: true,
      expectedUpdatedAt: 42,
      next: {
        policyOtpMaxAttempts: 6,
        policyEmailResendCooldownSec: 90,
      },
    });
  });

  it("rejects all-invalid jurisdiction CSV updates", () => {
    const parsed = parseSystemConfigJurisdictionRestrictionsUpdateInput({
      restrictedCountriesCsv: "!!!,123",
      restrictedMessage: "blocked",
    });

    expect(parsed).toEqual({
      ok: false,
      message: "restrictedCountriesCsv must include at least one valid ISO2 country code.",
    });
  });

  it("allows message-only jurisdiction updates while preserving default fallback text", () => {
    const parsed = parseSystemConfigJurisdictionRestrictionsUpdateInput({
      restrictedMessage: "",
    });

    expect(parsed).toEqual({
      ok: true,
      next: {
        jurisdictionRestrictedMessage: "This jurisdiction is not supported due to regulatory restrictions.",
      },
    });
  });
});
