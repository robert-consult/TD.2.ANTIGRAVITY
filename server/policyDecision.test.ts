// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DecisionContext } from "@shared/policyDecision";
import { decidePolicy } from "@shared/policyDecision";

type DecisionContextOverrides = Partial<DecisionContext> & {
  user?: Partial<DecisionContext["user"]>;
  metrics?: Partial<DecisionContext["metrics"]>;
  throttle?: Partial<DecisionContext["throttle"]>;
  kyc?: Partial<DecisionContext["kyc"]>;
  request?: Partial<NonNullable<DecisionContext["request"]>>;
};

function buildContext(overrides: DecisionContextOverrides = {}): DecisionContext {
  const base: DecisionContext = {
    now: new Date("2026-03-08T12:00:00Z"),
    request: {
      correlationId: "corr-1",
      actorType: "USER",
      actorUserId: 42,
      sessionId: "sess-1",
      ip: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: 42,
      email: "trader@example.test",
      username: "trader",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      suspendedAt: null,
      emailVerifiedAt: new Date("2025-01-02T00:00:00Z"),
      emailInitialDueAt: null,
      emailReverifyDueAt: null,
      phoneVerifiedAt: null,
      userTier: "CANDIDATE",
      contenderTier: "NONE",
      selectedAt: null,
      lockedAt: null,
      lockReason: null,
    },
    metrics: {
      tradesLifetime: 5,
      tradesLast90d: 2,
      accountAgeDays: 10,
      lastTradeDaysAgo: 3,
      balancePctOfStart: 1.01,
      returnLast90d: 0.01,
    },
    throttle: {
      emailSendCountDay: 0,
      emailLastSentAtMs: null,
      smsSendCountDay: 0,
      smsLastSentAtMs: null,
      otpFailCount: 0,
      otpLockedUntilMs: null,
    },
    kyc: {
      status: "NOT_STARTED",
      invitedAtMs: null,
      preferredPaymentCurrency: null,
    },
    tradeIntent: undefined,
  };

  return {
    ...base,
    ...overrides,
    request: {
      ...base.request,
      ...overrides.request,
    },
    user: {
      ...base.user,
      ...overrides.user,
    },
    metrics: {
      ...base.metrics,
      ...overrides.metrics,
    },
    throttle: {
      ...base.throttle,
      ...overrides.throttle,
    },
    kyc: {
      ...base.kyc,
      ...overrides.kyc,
    },
  };
}

describe("decidePolicy", () => {
  it("denies exposure-increasing trading when email verification grace is expired", () => {
    const ctx = buildContext({
      user: {
        emailVerifiedAt: null,
        emailInitialDueAt: new Date("2026-03-01T00:00:00Z"),
      },
    });

    const decision = decidePolicy("TRADE_OPEN_OR_INCREASE", ctx);

    expect(decision.allowed).toBe(false);
    expect(decision.deny?.code).toBe("EMAIL_UNVERIFIED_GRACE_EXPIRED");
    expect(decision.redirectTo).toBe("/verify-email");
  });

  it("allows reduce-only trade closes while the account is email-locked", () => {
    const ctx = buildContext({
      user: {
        emailVerifiedAt: null,
        emailInitialDueAt: new Date("2026-03-01T00:00:00Z"),
      },
    });

    const decision = decidePolicy("TRADE_CLOSE_OR_REDUCE", ctx);

    expect(decision.allowed).toBe(true);
    expect(decision.showLockedBanner).toBe(true);
    expect(decision.accountState).toBe("LOCKED_EMAIL_UNVERIFIED");
  });

  it("denies sms verification when the trader is not contender-eligible", () => {
    const decision = decidePolicy("PHONE_VERIFY_START", buildContext());

    expect(decision.allowed).toBe(false);
    expect(decision.deny?.code).toBe("SMS_NOT_ELIGIBLE");
  });

  it("allows KYC view for selected traders", () => {
    const ctx = buildContext({
      user: {
        userTier: "SELECTED",
        contenderTier: "SELECTED_REAL_CAPITAL",
        selectedAt: new Date("2026-02-01T00:00:00Z"),
      },
    });

    const decision = decidePolicy("KYC_VIEW", ctx);

    expect(decision.allowed).toBe(true);
    expect(decision.accountState).toBe("ACTIVE_VERIFIED");
  });
});
