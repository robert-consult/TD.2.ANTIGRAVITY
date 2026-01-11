export type UserTier = "CANDIDATE" | "PERFORMER" | "SELECTED";
export type ContenderTier =
  | "NONE"
  | "CANDIDATE_EMAIL_ONLY"
  | "CANDIDATE_SMS_REQUIRED"
  | "VERIFIED_SMS"
  | "SELECTED_REAL_CAPITAL";

export type AccountState =
  | "ACTIVE_VERIFIED"
  | "ACTIVE_UNVERIFIED_GRACE"
  | "LOCKED_EMAIL_UNVERIFIED"
  | "LOCKED_EMAIL_REVERIFY_OVERDUE"
  | "SUSPENDED_ADMIN";

export type DenyCode =
  | "ADMIN_SUSPENDED"
  | "ACCOUNT_SUSPENDED" // legacy
  | "EMAIL_UNVERIFIED_GRACE_EXPIRED"
  | "EMAIL_NOT_VERIFIED" // legacy
  | "EMAIL_REVERIFY_OVERDUE"
  | "EMAIL_SEND_RATE_LIMIT"
  | "EMAIL_SEND_COOLDOWN"
  | "SMS_NOT_ELIGIBLE"
  | "SMS_NOT_ELIGIBLE_CONTENDER" // legacy
  | "SMS_RATE_LIMIT"
  | "SMS_OTP_TOO_MANY_ATTEMPTS"
  | "KYC_NOT_SELECTED"
  | "KYC_STATE_INVALID"
  | "ACTION_NOT_ALLOWED_IN_STATE"
  | "TRADE_CANCEL_NOT_ALLOWED_WHEN_LOCKED"
  | "TRADE_TARGETS_NOT_ALLOWED_WHEN_LOCKED";

export type PolicyAction =
  | "TRADE_OPEN_OR_INCREASE"
  | "TRADE_CLOSE_OR_REDUCE"
  | "TRADE_PLACE_PENDING"
  | "TRADE_CANCEL_PENDING"
  | "TRADE_MODIFY_SLTP"
  | "EMAIL_RESEND_VERIFICATION"
  | "PHONE_VERIFY_START"
  | "PHONE_VERIFY_CONFIRM"
  | "KYC_VIEW"
  | "KYC_SUBMIT"
  | "PREFERRED_PAYMENT_CURRENCY_SET"
  | "PAYOUT_REQUEST";

export type PolicyDecision = {
  allowed: boolean;
  deny_code?: DenyCode | string;
  deny?: {
    code: DenyCode;
    messageKey: string;
    httpStatus: 401 | 403 | 409 | 429;
    nextStep?: "VERIFY_EMAIL" | "REVERIFY_EMAIL" | "WAIT_COOLDOWN" | "BECOME_CONTENDER" | "CONTACT_SUPPORT";
  };
  accountState?: AccountState;
  showLockedBanner?: boolean;
  redirectTo?: string;
  correlationId?: string;
  derived?: {
    accountState: AccountState;
    contenderEligible: boolean;
    contenderPath1: boolean;
    contenderPath2: boolean;
    isSelectedForKyc: boolean;
    emailInitialDueAt: Date;
    emailReverifyDueAt: Date | null;
    isEmailInitialOverdue: boolean;
    isEmailReverifyOverdue: boolean;
  };
};

export type DecisionContext = {
  now: Date;
  request?: {
    correlationId: string;
    actorType: "USER" | "ADMIN" | "SYSTEM";
    actorUserId: number | null;
    sessionId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  };
  user: {
    id: number;
    email: string;
    username?: string | null;
    createdAt: Date;
    suspendedAt?: Date | null;
    emailVerifiedAt?: Date | null;
    emailInitialDueAt?: Date | null;
    emailReverifyDueAt?: Date | null;
    phoneVerifiedAt?: Date | null;
    userTier: UserTier;
    contenderTier: ContenderTier;
    selectedAt?: Date | null;
    lockedAt?: Date | null;
    lockReason?: string | null;
  };
  metrics: {
    tradesLifetime: number;
    tradesLast90d: number;
    accountAgeDays: number;
    lastTradeDaysAgo?: number | null;
    balancePctOfStart: number;
    returnLast90d: number;
  };
  throttle: {
    emailSendCountDay: number;
    emailLastSentAtMs?: number | null;
    smsSendCountDay: number;
    smsLastSentAtMs?: number | null;
    otpFailCount: number;
    otpLockedUntilMs?: number | null;
  };
  kyc: {
    status: string;
    invitedAtMs?: number | null;
    preferredPaymentCurrency?: string | null;
  };
  tradeIntent?: {
    kind: string;
    side?: string;
    slBefore?: number | null;
    slAfter?: number | null;
  };
};

export type PolicyConfig = {
  gracePeriodDays: number;
  emailInitialGraceDays: number;
  emailReverifyPeriodDays: number;
  emailReverifyOverdueGraceDays: number;
  initialVerifyReminderDaysAfterSignup: number[];
  reverifyReminderOffsetsDays: number[];
  emailResendCooldownSec: number;
  emailDailySendCap: number;
  smsDailySendCap: number;
  smsResendCooldownSec: number;
  otpMaxAttempts: number;
  otpLockMinutes: number;
  contenderMinAgeDays: number;
  contenderMinTradesLifetime: number;
  contenderMinBalancePct: number;
  contenderPath2MinAgeDays: number;
  contenderPath2MinTradesLast90: number;
  contenderPath2MinReturnLast90: number;
  contenderPath2MaxDaysSinceLastTrade: number;
  allowReduceOnlyWhenLocked: boolean;
  allowCancelPendingWhenLocked: boolean;
  allowRiskReducingSltpChangeWhenLocked: boolean;
  autoPromotePerformer: boolean;
};

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  gracePeriodDays: 14,
  emailInitialGraceDays: 14,
  emailReverifyPeriodDays: 30,
  emailReverifyOverdueGraceDays: 3,
  initialVerifyReminderDaysAfterSignup: [0, 7, 12, 13],
  reverifyReminderOffsetsDays: [-7, -3, -1, 0, 2],
  emailResendCooldownSec: 60,
  emailDailySendCap: 5,
  smsDailySendCap: 5,
  smsResendCooldownSec: 60,
  otpMaxAttempts: 5,
  otpLockMinutes: 30,
  contenderMinAgeDays: 30,
  contenderMinTradesLifetime: 30,
  contenderMinBalancePct: 1.2,
  contenderPath2MinAgeDays: 90,
  contenderPath2MinTradesLast90: 20,
  contenderPath2MinReturnLast90: 0.1,
  contenderPath2MaxDaysSinceLastTrade: 14,
  allowReduceOnlyWhenLocked: true,
  allowCancelPendingWhenLocked: false,
  allowRiskReducingSltpChangeWhenLocked: false,
  autoPromotePerformer: true,
};

function allow(opts?: Partial<PolicyDecision>): PolicyDecision {
  return { allowed: true, ...opts };
}

function denyHttp(code: DenyCode): 401 | 403 | 409 | 429 {
  switch (code) {
    case "EMAIL_SEND_RATE_LIMIT":
    case "EMAIL_SEND_COOLDOWN":
    case "SMS_RATE_LIMIT":
    case "SMS_OTP_TOO_MANY_ATTEMPTS":
      return 429;
    case "KYC_STATE_INVALID":
      return 409;
    default:
      return 403;
  }
}

function deny(
  code: DenyCode,
  opts?: Partial<PolicyDecision>,
  nextStep?: NonNullable<PolicyDecision["deny"]>["nextStep"]
): PolicyDecision {
  return {
    allowed: false,
    deny_code: code,
    deny: {
      code,
      messageKey: `deny.${code}`,
      httpStatus: denyHttp(code),
      nextStep,
    },
    ...opts,
  };
}

export function resolveAccountState(ctx: DecisionContext, cfg: PolicyConfig = DEFAULT_POLICY_CONFIG): AccountState {
  if (ctx.user.suspendedAt) return "SUSPENDED_ADMIN";

  const now = ctx.now.getTime();
  const createdAt = ctx.user.createdAt.getTime();
  const emailInitialDueAt =
    ctx.user.emailInitialDueAt?.getTime() ?? createdAt + cfg.emailInitialGraceDays * 24 * 3600 * 1000;

  if (!ctx.user.emailVerifiedAt) {
    return now < emailInitialDueAt ? "ACTIVE_UNVERIFIED_GRACE" : "LOCKED_EMAIL_UNVERIFIED";
  }

  if (ctx.user.emailReverifyDueAt) {
    const overdueAt =
      ctx.user.emailReverifyDueAt.getTime() + cfg.emailReverifyOverdueGraceDays * 24 * 3600 * 1000;
    if (now >= overdueAt) return "LOCKED_EMAIL_REVERIFY_OVERDUE";
  }

  return "ACTIVE_VERIFIED";
}

export function computeContenderEligibility(ctx: DecisionContext, cfg: PolicyConfig = DEFAULT_POLICY_CONFIG): {
  eligible: boolean;
  path1: boolean;
  path2: boolean;
} {
  const st = resolveAccountState(ctx, cfg);
  if (st !== "ACTIVE_VERIFIED") {
    return { eligible: false, path1: false, path2: false };
  }

  const path1 =
    ctx.metrics.accountAgeDays >= cfg.contenderMinAgeDays &&
    ctx.metrics.balancePctOfStart >= cfg.contenderMinBalancePct &&
    ctx.metrics.tradesLifetime >= cfg.contenderMinTradesLifetime;
  
  const path2 =
    ctx.metrics.accountAgeDays >= cfg.contenderPath2MinAgeDays &&
    (ctx.metrics.lastTradeDaysAgo ?? Infinity) <= cfg.contenderPath2MaxDaysSinceLastTrade &&
    ctx.metrics.returnLast90d >= cfg.contenderPath2MinReturnLast90 &&
    ctx.metrics.tradesLast90d >= cfg.contenderPath2MinTradesLast90;
  
  return { eligible: path1 || path2, path1, path2 };
}

function isExposureIncreasingTradingAction(action: PolicyAction): boolean {
  return action === "TRADE_OPEN_OR_INCREASE" || action === "TRADE_PLACE_PENDING";
}

function isReduceOnlyTradingAction(action: PolicyAction): boolean {
  return action === "TRADE_CLOSE_OR_REDUCE";
}

export function decidePolicy(
  action: PolicyAction,
  ctx: DecisionContext,
  cfg: PolicyConfig = DEFAULT_POLICY_CONFIG
): PolicyDecision {
  const accountState = resolveAccountState(ctx, cfg);
  const contender = computeContenderEligibility(ctx, cfg);
  const correlationId = ctx.request?.correlationId;

  const emailInitialDueAt =
    ctx.user.emailInitialDueAt ?? new Date(ctx.user.createdAt.getTime() + cfg.emailInitialGraceDays * 24 * 3600 * 1000);
  const emailReverifyDueAt =
    ctx.user.emailReverifyDueAt ??
    (ctx.user.emailVerifiedAt
      ? new Date(ctx.user.emailVerifiedAt.getTime() + cfg.emailReverifyPeriodDays * 24 * 3600 * 1000)
      : null);
  const isEmailInitialOverdue = !ctx.user.emailVerifiedAt && ctx.now >= emailInitialDueAt;
  const isEmailReverifyOverdue = !!emailReverifyDueAt &&
    ctx.now.getTime() >= emailReverifyDueAt.getTime() + cfg.emailReverifyOverdueGraceDays * 24 * 3600 * 1000;

  const selected =
    ctx.user.userTier === "SELECTED" ||
    ctx.user.contenderTier === "SELECTED_REAL_CAPITAL" ||
    !!ctx.user.selectedAt;

  const derived = {
    accountState,
    contenderEligible: contender.eligible,
    contenderPath1: contender.path1,
    contenderPath2: contender.path2,
    isSelectedForKyc: selected,
    emailInitialDueAt,
    emailReverifyDueAt,
    isEmailInitialOverdue,
    isEmailReverifyOverdue,
  };
  const base = { accountState, derived, correlationId };

  if (accountState === "SUSPENDED_ADMIN") {
    return deny("ADMIN_SUSPENDED", { ...base, showLockedBanner: true }, "CONTACT_SUPPORT");
  }

  if (accountState === "LOCKED_EMAIL_UNVERIFIED" || accountState === "LOCKED_EMAIL_REVERIFY_OVERDUE") {
    const lockedCode: DenyCode =
      accountState === "LOCKED_EMAIL_UNVERIFIED" ? "EMAIL_UNVERIFIED_GRACE_EXPIRED" : "EMAIL_REVERIFY_OVERDUE";
    const nextStep = accountState === "LOCKED_EMAIL_UNVERIFIED" ? "VERIFY_EMAIL" : "REVERIFY_EMAIL";

    if (action === "TRADE_CLOSE_OR_REDUCE") {
      return cfg.allowReduceOnlyWhenLocked
        ? allow({ ...base, showLockedBanner: true })
        : deny("ACTION_NOT_ALLOWED_IN_STATE", { ...base, showLockedBanner: true });
    }

    if (
      isExposureIncreasingTradingAction(action) ||
      action === "TRADE_CANCEL_PENDING" ||
      action === "TRADE_MODIFY_SLTP"
    ) {
      return deny(lockedCode, { ...base, showLockedBanner: true, redirectTo: "/verify-email" }, nextStep);
    }
  }

  if (action === "EMAIL_RESEND_VERIFICATION") {
    const nowMs = ctx.now.getTime();
    const last = ctx.throttle.emailLastSentAtMs ?? 0;
    const cooldownMs = cfg.emailResendCooldownSec * 1000;
    
    if (ctx.throttle.emailSendCountDay >= cfg.emailDailySendCap) {
      return deny("EMAIL_SEND_RATE_LIMIT", base, "WAIT_COOLDOWN");
    }
    if (nowMs - last < cooldownMs) {
      return deny("EMAIL_SEND_COOLDOWN", base, "WAIT_COOLDOWN");
    }
    return allow(base);
  }
  
  if (action === "PHONE_VERIFY_START" || action === "PHONE_VERIFY_CONFIRM") {
    if (accountState !== "ACTIVE_VERIFIED") {
      const code: DenyCode = accountState === "LOCKED_EMAIL_REVERIFY_OVERDUE"
        ? "EMAIL_REVERIFY_OVERDUE"
        : "EMAIL_UNVERIFIED_GRACE_EXPIRED";
      const nextStep = accountState === "LOCKED_EMAIL_REVERIFY_OVERDUE" ? "REVERIFY_EMAIL" : "VERIFY_EMAIL";
      return deny(code, { ...base, showLockedBanner: true, redirectTo: "/verify-email" }, nextStep);
    }
    
    if (!contender.eligible) {
      return deny("SMS_NOT_ELIGIBLE", { ...base, showLockedBanner: false }, "BECOME_CONTENDER");
    }
    
    if (action === "PHONE_VERIFY_START") {
      const nowMs = ctx.now.getTime();
      const last = ctx.throttle.smsLastSentAtMs ?? 0;
      const cooldownMs = cfg.smsResendCooldownSec * 1000;
      if (ctx.throttle.smsSendCountDay >= cfg.smsDailySendCap) return deny("SMS_RATE_LIMIT", base, "WAIT_COOLDOWN");
      if (nowMs - last < cooldownMs) return deny("SMS_RATE_LIMIT", base, "WAIT_COOLDOWN");
    }
    
    if (action === "PHONE_VERIFY_CONFIRM") {
      const lockedUntil = ctx.throttle.otpLockedUntilMs ?? null;
      if (lockedUntil && ctx.now.getTime() < lockedUntil) {
        return deny("SMS_OTP_TOO_MANY_ATTEMPTS", base, "WAIT_COOLDOWN");
      }
      if (ctx.throttle.otpFailCount >= cfg.otpMaxAttempts) {
        return deny("SMS_OTP_TOO_MANY_ATTEMPTS", base, "WAIT_COOLDOWN");
      }
    }
    
    return allow(base);
  }
  
  if (action === "KYC_VIEW" || action === "KYC_SUBMIT" || action === "PREFERRED_PAYMENT_CURRENCY_SET" || action === "PAYOUT_REQUEST") {
    if (!selected) return deny("KYC_NOT_SELECTED", { ...base, redirectTo: "/profile" });
    
    if (action === "KYC_SUBMIT") {
      if (!(ctx.kyc.status === "INVITED" || ctx.kyc.status === "REJECTED")) {
        return deny("KYC_STATE_INVALID", base);
      }
    }
    
    return allow(base);
  }
  
  if (action === "TRADE_OPEN_OR_INCREASE" || action === "TRADE_PLACE_PENDING") {
    return allow(base);
  }
  if (action === "TRADE_CLOSE_OR_REDUCE" || action === "TRADE_CANCEL_PENDING") {
    return allow(base);
  }
  
  return allow(base);
}

export function featureGates(ctx: DecisionContext, cfg: PolicyConfig = DEFAULT_POLICY_CONFIG) {
  const st = resolveAccountState(ctx, cfg);
  const contender = computeContenderEligibility(ctx, cfg);
  const selected =
    ctx.user.userTier === "SELECTED" ||
    ctx.user.contenderTier === "SELECTED_REAL_CAPITAL" ||
    !!ctx.user.selectedAt;
  
  return {
    accountState: st,
    contenderEligible: contender.eligible,
    canTradeOpenOrIncrease: decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, cfg).allowed,
    canTradeCloseOrReduce: decidePolicy("TRADE_CLOSE_OR_REDUCE", ctx, cfg).allowed,
    canTradeCancelPending: decidePolicy("TRADE_CANCEL_PENDING", ctx, cfg).allowed,
    canTradeModifySltp: decidePolicy("TRADE_MODIFY_SLTP", ctx, cfg).allowed,
    canStartSms: decidePolicy("PHONE_VERIFY_START", ctx, cfg).allowed,
    canViewKyc: selected && decidePolicy("KYC_VIEW", ctx, cfg).allowed,
    canSetPreferredPaymentCurrency: selected && decidePolicy("PREFERRED_PAYMENT_CURRENCY_SET", ctx, cfg).allowed,
    canRequestPayout: ctx.user.userTier === "SELECTED",
  };
}
