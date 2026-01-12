import { db, dbClient } from "../../db";
import { sql } from "drizzle-orm";
import { isPostgres } from "../../db/config";

import {
  DEFAULT_POLICY_CONFIG,
  type DecisionContext,
  type UserTier,
  type ContenderTier,
  type PolicyConfig,
} from "../../shared/policyDecision";

type AnyRow = Record<string, any>;

function normalizeTsToMs(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1e12) return Math.floor(n * 1000);
  return Math.floor(n);
}

function toDateOrNull(ms: number | null): Date | null {
  if (!ms) return null;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function dayKeyUtc(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function uniqLower(xs: string[]) {
  return Array.from(new Set(xs.map((x) => x.toLowerCase())));
}

async function rawAll<T = AnyRow>(query: any): Promise<T[]> {
  const anyDb = db as any;
  if (typeof anyDb.$client?.prepare === "function") {
    return anyDb.$client.prepare(query.sql ?? query).all() as T[];
  }
  if (typeof anyDb.$client?.query === "function") {
    const sqlText = query?.sql ?? query;
    const params = Array.isArray(query?.params) ? query.params : undefined;
    const res = await anyDb.$client.query(sqlText, params);
    return (res?.rows ?? []) as T[];
  }
  if (typeof anyDb.all === "function") return anyDb.all(query) as T[];
  if (typeof anyDb.execute === "function") {
    const res = await anyDb.execute(query);
    return (res?.rows ?? res) as T[];
  }
  throw new Error("Drizzle db does not expose .all() or .execute() for raw queries.");
}

async function rawGet<T = AnyRow>(query: any): Promise<T | undefined> {
  const anyDb = db as any;
  if (typeof anyDb.$client?.prepare === "function") {
    return anyDb.$client.prepare(query.sql ?? query).get() as T | undefined;
  }
  if (typeof anyDb.get === "function") return anyDb.get(query) as T | undefined;
  const rows = await rawAll<T>(query);
  return rows[0];
}

async function tableExists(tableName: string): Promise<boolean> {
  if (isPostgres) {
    const res = await dbClient.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = $1 LIMIT 1",
      [tableName]
    );
    return (res.rowCount ?? 0) > 0;
  }
  const row = await rawGet<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}' LIMIT 1`
  );
  return !!row?.name;
}

type ColumnInfo = { name: string; type?: string | null };

const columnCache = new Map<string, string[]>();

async function getTableColumns(tableName: string): Promise<string[]> {
  if (columnCache.has(tableName)) return columnCache.get(tableName)!;
  const exists = await tableExists(tableName);
  if (!exists) {
    columnCache.set(tableName, []);
    return [];
  }
  let cols: string[] = [];
  if (isPostgres) {
    const res = await dbClient.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = $1",
      [tableName]
    );
    cols = res.rows.map((r: any) => String(r.column_name));
  } else {
    const rows = await rawAll<ColumnInfo>(`PRAGMA table_info('${tableName.replace(/'/g, "''")}')`);
    cols = rows.map((r) => String(r.name));
  }
  columnCache.set(tableName, cols);
  return cols;
}

function pickColumn(cols: string[], candidates: string[]): string | null {
  const lower = new Map(cols.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const hit = lower.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function pickAnyColumnByIncludes(cols: string[], includesAnyOf: string[]): string | null {
  const lc = cols.map((c) => c.toLowerCase());
  for (let i = 0; i < cols.length; i++) {
    for (const inc of includesAnyOf) {
      if (lc[i].includes(inc.toLowerCase())) return cols[i];
    }
  }
  return null;
}

function coalesceExpr(cols: (string | null | undefined)[]): string | null {
  const xs = cols.filter(Boolean) as string[];
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  return `COALESCE(${xs.join(", ")})`;
}

function clampTier(v: any): UserTier {
  const s = String(v ?? "").toUpperCase();
  if (s === "CANDIDATE" || s === "PERFORMER" || s === "SELECTED") return s;
  return "CANDIDATE";
}

function clampContenderTier(v: any): ContenderTier {
  const s = String(v ?? "").toUpperCase();
  const allowed = uniqLower([
    "NONE",
    "CANDIDATE_EMAIL_ONLY",
    "CANDIDATE_SMS_REQUIRED",
    "VERIFIED_SMS",
    "SELECTED_REAL_CAPITAL",
  ]);
  if (allowed.includes(s.toLowerCase())) return s as ContenderTier;
  return "NONE";
}

function normalizeKycStatus(v: any): DecisionContext["kyc"]["status"] {
  const s = String(v ?? "NOT_STARTED").toUpperCase();
  if (
    s === "INVITED" ||
    s === "SUBMITTED" ||
    s === "APPROVED" ||
    s === "REJECTED" ||
    s === "UNDER_REVIEW" ||
    s === "PENDING_DOCS" ||
    s === "PENDING"
  ) {
    return s;
  }
  return "NOT_STARTED";
}

async function computeReturnLast90d(params: {
  tradesTable: string;
  tradesUserIdCol: string;
  tradesClosedAtExpr: string | null;
  tradesPnlCol: string | null;
  equityTable?: string | null;
  equityUserIdCol?: string | null;
  equityDayKeyCol?: string | null;
  equityEquityCol?: string | null;
  equityNow?: number | null;
  userId: number;
  nowMs: number;
  startingEquity: number;
  windowDays: number;
}): Promise<number> {
  const {
    tradesTable,
    tradesUserIdCol,
    tradesClosedAtExpr,
    tradesPnlCol,
    equityTable,
    equityUserIdCol,
    equityDayKeyCol,
    equityEquityCol,
    equityNow,
    userId,
    nowMs,
    startingEquity,
    windowDays,
  } = params;
  const window = Math.max(1, Math.floor(windowDays));

  if (equityTable && equityUserIdCol && equityDayKeyCol && equityEquityCol && equityNow != null) {
    const sinceKey = dayKeyUtc(nowMs - window * 86400000);
    const eqRow = await rawGet<{ equity: any }>(`
      SELECT ${equityEquityCol} AS equity
      FROM ${equityTable}
      WHERE ${equityUserIdCol} = ${userId}
        AND ${equityDayKeyCol} <= '${sinceKey}'
      ORDER BY ${equityDayKeyCol} DESC
      LIMIT 1
    `);
    const base = Number(eqRow?.equity ?? 0);
    if (Number.isFinite(base) && base > 0 && Number.isFinite(Number(equityNow))) {
      return (Number(equityNow) - base) / base;
    }
  }

  if (!tradesClosedAtExpr || !tradesPnlCol) return 0;
  if (!startingEquity || startingEquity <= 0) return 0;

  const since = nowMs - window * 86400000;
  const q = `
    SELECT COALESCE(SUM((${tradesPnlCol})::numeric), 0) AS pnl
    FROM ${tradesTable}
    WHERE ${tradesUserIdCol} = ${userId}
      AND ${tradesClosedAtExpr} IS NOT NULL
      AND ${tradesClosedAtExpr} >= ${since}
  `;

  const row = await rawGet<{ pnl: any }>(q);
  const pnl = Number(row?.pnl ?? 0);
  if (!Number.isFinite(pnl)) return 0;
  return pnl / startingEquity;
}

function computeBalancePctOfStart(equity: number, startingEquity: number): number {
  if (!Number.isFinite(equity) || equity <= 0) return 1.0;
  if (!Number.isFinite(startingEquity) || startingEquity <= 0) return 1.0;
  return equity / startingEquity;
}

export async function buildDecisionContext(input: {
  userId: number;
  nowMs?: number;
  email?: string;
  username?: string | null;
  createdAtMs?: number | null;
  userTier?: UserTier | null;
  suspendedAtMs?: number | null;
  tradeIntent?: DecisionContext["tradeIntent"];
  request?: DecisionContext["request"];
  policyConfig?: PolicyConfig;
}): Promise<DecisionContext> {
  const cfg = input.policyConfig ?? DEFAULT_POLICY_CONFIG;
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const todayKey = dayKeyUtc(nowMs);
  const rawWindowDays = Number.isFinite(cfg.contenderPath2MinAgeDays) ? cfg.contenderPath2MinAgeDays : 90;
  const path2WindowDays = Math.max(1, Math.floor(rawWindowDays));

  const usersCols = await getTableColumns("users");
  const tradesCols = await getTableColumns("trades");
  const uvCols = await getTableColumns("user_verification");
  const kycCols = await getTableColumns("user_kyc_profiles");
  const payoutCols = await getTableColumns("user_payout_profiles");
  const equityCols = await getTableColumns("user_equity_daily");

  const usersIdCol = pickColumn(usersCols, ["id"]) ?? "id";
  const usersEmailCol = pickColumn(usersCols, ["email", "userEmail"]) ?? "email";
  const usersUsernameCol = pickColumn(usersCols, ["username", "userName", "handle"]) ?? null;

  const usersCreatedAtCol =
    pickColumn(usersCols, ["createdAt", "created_at", "created_on", "created"]) ??
    pickAnyColumnByIncludes(usersCols, ["created"]) ??
    null;

  const usersTierCol = pickColumn(usersCols, ["userTier", "user_tier", "tier"]) ?? null;
  const usersSelectedAtCol = pickColumn(usersCols, ["selectedAt", "selected_at"]) ?? null;
  const usersTierPromotedAtCol =
    pickColumn(usersCols, ["tierPromotedAt", "tier_promoted_at"]) ??
    pickAnyColumnByIncludes(usersCols, ["tier_promoted"]) ??
    null;

  const usersSuspendedAtCol =
    pickColumn(usersCols, ["suspendedAt", "suspended_at", "disabledAt", "disabled_at", "frozenAt", "frozen_at"]) ??
    null;

  const usersIsDisabledCol =
    pickColumn(usersCols, ["disabled", "isDisabled", "is_disabled", "frozen", "isFrozen", "is_frozen"]) ??
    null;

  const usersEquityCol =
    pickColumn(usersCols, ["equity"]) ??
    pickColumn(usersCols, ["accountEquity", "account_equity"]) ??
    pickColumn(usersCols, ["balance"]) ??
    null;

  const usersStartingEquityCol =
    pickColumn(usersCols, ["startingEquity", "starting_equity", "initialEquity", "initial_equity", "startingBalance", "starting_balance"]) ??
    null;

  const userRow = await rawGet<AnyRow>(`
    SELECT *
    FROM users
    WHERE ${usersIdCol} = ${input.userId}
    LIMIT 1
  `);

  if (!userRow) {
    const createdAt = new Date(nowMs);
    return {
      now,
      user: {
        id: input.userId,
        email: input.email ?? "unknown@invalid",
        username: input.username ?? null,
        createdAt,
        suspendedAt: null,
        emailVerifiedAt: null,
        emailInitialDueAt: new Date(createdAt.getTime() + cfg.emailInitialGraceDays * 86400000),
        emailReverifyDueAt: null,
        phoneVerifiedAt: null,
        userTier: "CANDIDATE",
        contenderTier: "NONE",
        selectedAt: null,
      },
      metrics: {
        tradesLifetime: 0,
        tradesLast90d: 0,
        accountAgeDays: 0,
        lastTradeDaysAgo: null,
        balancePctOfStart: 1.0,
        returnLast90d: 0.0,
      },
      throttle: {
        emailSendCountDay: 0, // Maps from DB column emailResendCountDay
        emailLastSentAtMs: null, // Maps from DB column emailLastResendAt
        smsSendCountDay: 0,
        smsLastSentAtMs: null,
        otpFailCount: 0,
      },
      kyc: {
        status: "NOT_STARTED",
        invitedAtMs: null,
      },
      tradeIntent: input.tradeIntent,
    };
  }

  const email = input.email ?? String(userRow[usersEmailCol] ?? "");
  const username = input.username ?? (usersUsernameCol ? (userRow[usersUsernameCol] ?? null) : null);

  const createdAtMsFromRow = usersCreatedAtCol ? normalizeTsToMs(userRow[usersCreatedAtCol]) : null;
  const createdAtMs = input.createdAtMs ?? createdAtMsFromRow ?? nowMs;
  const createdAt = new Date(createdAtMs);

  let userTier: UserTier = input.userTier ?? (usersTierCol ? clampTier(userRow[usersTierCol]) : "CANDIDATE");
  const selectedAtMsFromUser = usersSelectedAtCol ? normalizeTsToMs(userRow[usersSelectedAtCol]) : null;
  const tierPromotedAtMsFromUser = usersTierPromotedAtCol ? normalizeTsToMs(userRow[usersTierPromotedAtCol]) : null;

  let suspendedAtMs: number | null = input.suspendedAtMs ?? null;

  if (!suspendedAtMs && usersSuspendedAtCol) {
    suspendedAtMs = normalizeTsToMs(userRow[usersSuspendedAtCol]);
  }
  if (!suspendedAtMs && usersIsDisabledCol) {
    const v = userRow[usersIsDisabledCol];
    if (v === 1 || v === true || String(v).toLowerCase() === "true") {
      suspendedAtMs = nowMs;
    }
  }

  let selectedAtMs: number | null = selectedAtMsFromUser;
  if (!selectedAtMs && userTier === "SELECTED") {
    selectedAtMs = tierPromotedAtMsFromUser ?? nowMs;
  }

  const equity = usersEquityCol ? Number(userRow[usersEquityCol] ?? 0) : 0;
  const startingEquity = usersStartingEquityCol ? Number(userRow[usersStartingEquityCol] ?? 0) : 0;
  const balancePctOfStart = computeBalancePctOfStart(equity, startingEquity);

  let emailVerifiedAtMs: number | null = null;
  let emailInitialDueAtMs: number | null = null;
  let emailReverifyDueAtMs: number | null = null;
  let phoneVerifiedAtMs: number | null = null;
  let contenderTier: ContenderTier = "NONE";
  let lockedAtMs: number | null = null;
  let lockReason: string | null = null;

  let emailResendCountDay = 0;
  let emailLastResendAtMs: number | null = null;

  let smsSendCountDay = 0;
  let smsLastSentAtMs: number | null = null;

  let otpFailCount = 0;
  let otpLockedUntilMs: number | null = null;

  if (uvCols.length) {
    const uvUserIdCol = pickColumn(uvCols, ["userId", "user_id"]) ?? "user_id";

    const uvEmailVerifiedCol = pickColumn(uvCols, ["emailVerifiedAt", "email_verified_at"]) ?? null;
    const uvEmailInitialDueCol =
      pickColumn(uvCols, ["emailInitialDueAt", "email_initial_due_at", "emailInitialDueAtMs", "email_initial_due_at_ms"]) ??
      null;
    const uvEmailReverifyDueCol = pickColumn(uvCols, ["emailReverifyDueAt", "email_reverify_due_at"]) ?? null;

    const uvSmsVerifiedCol = pickColumn(uvCols, ["smsVerifiedAt", "sms_verified_at", "phoneVerifiedAt", "phone_verified_at"]) ?? null;

    const uvContenderTierCol = pickColumn(uvCols, ["contenderTier", "contender_tier"]) ?? null;
    const uvLockedAtCol = pickColumn(uvCols, ["lockedAt", "locked_at"]) ?? null;
    const uvLockReasonCol = pickColumn(uvCols, ["lockReason", "lock_reason"]) ?? null;

    const uvEmailResendCountCol = pickColumn(uvCols, ["emailResendCountDay", "email_resend_count_day"]) ?? null;
    const uvEmailLastResendCol = pickColumn(uvCols, ["emailLastResendAt", "email_last_resend_at"]) ?? null;
    const uvEmailResendDayKeyCol = pickColumn(uvCols, ["emailResendDayKey", "email_resend_day_key"]) ?? null;

    const uvSmsSendCountCol = pickColumn(uvCols, ["smsSendCountDay", "sms_send_count_day"]) ?? null;
    const uvSmsLastSentCol = pickColumn(uvCols, ["smsLastSentAt", "sms_last_sent_at"]) ?? null;
    const uvSmsSendDayKeyCol = pickColumn(uvCols, ["smsSendDayKey", "sms_send_day_key"]) ?? null;

    const uvOtpFailCol = pickColumn(uvCols, ["smsVerifyFailCount", "sms_verify_fail_count", "otpFailCount", "otp_fail_count"]) ?? null;
    const uvOtpLockedUntilCol = pickColumn(uvCols, ["smsOtpLockedUntil", "sms_otp_locked_until"]) ?? null;

    const uvRow = await rawGet<AnyRow>(`
      SELECT *
      FROM user_verification
      WHERE ${uvUserIdCol} = ${input.userId}
      LIMIT 1
    `);

    if (uvRow) {
      emailVerifiedAtMs = uvEmailVerifiedCol ? normalizeTsToMs(uvRow[uvEmailVerifiedCol]) : null;
      emailInitialDueAtMs = uvEmailInitialDueCol ? normalizeTsToMs(uvRow[uvEmailInitialDueCol]) : null;
      emailReverifyDueAtMs = uvEmailReverifyDueCol ? normalizeTsToMs(uvRow[uvEmailReverifyDueCol]) : null;

      phoneVerifiedAtMs = uvSmsVerifiedCol ? normalizeTsToMs(uvRow[uvSmsVerifiedCol]) : null;

      contenderTier = uvContenderTierCol ? clampContenderTier(uvRow[uvContenderTierCol]) : "NONE";
      lockedAtMs = uvLockedAtCol ? normalizeTsToMs(uvRow[uvLockedAtCol]) : null;
      lockReason = uvLockReasonCol ? String(uvRow[uvLockReasonCol] ?? "") || null : null;

      const emailResendDayKey = uvEmailResendDayKeyCol ? String(uvRow[uvEmailResendDayKeyCol] ?? "") : "";
      emailResendCountDay = uvEmailResendCountCol ? Number(uvRow[uvEmailResendCountCol] ?? 0) : 0;
      emailLastResendAtMs = uvEmailLastResendCol ? normalizeTsToMs(uvRow[uvEmailLastResendCol]) : null;
      if (!emailResendDayKey || emailResendDayKey !== todayKey) {
        emailResendCountDay = 0;
      }

      const smsSendDayKey = uvSmsSendDayKeyCol ? String(uvRow[uvSmsSendDayKeyCol] ?? "") : "";
      smsSendCountDay = uvSmsSendCountCol ? Number(uvRow[uvSmsSendCountCol] ?? 0) : 0;
      smsLastSentAtMs = uvSmsLastSentCol ? normalizeTsToMs(uvRow[uvSmsLastSentCol]) : null;
      if (!smsSendDayKey || smsSendDayKey !== todayKey) {
        smsSendCountDay = 0;
      }

      otpFailCount = uvOtpFailCol ? Number(uvRow[uvOtpFailCol] ?? 0) : 0;
      otpLockedUntilMs = uvOtpLockedUntilCol ? normalizeTsToMs(uvRow[uvOtpLockedUntilCol]) : null;
    }
  }

  const emailInitialDueAt =
    toDateOrNull(emailInitialDueAtMs) ?? new Date(createdAt.getTime() + cfg.emailInitialGraceDays * 86400000);

  const emailVerifiedAt = toDateOrNull(emailVerifiedAtMs);
  const emailReverifyDueAt = toDateOrNull(
    emailReverifyDueAtMs ??
      (emailVerifiedAt ? emailVerifiedAt.getTime() + cfg.emailReverifyPeriodDays * 86400000 : null)
  );

  let kycStatus: DecisionContext["kyc"]["status"] = "NOT_STARTED";
  let kycInvitedAtMs: number | null = null;
  let preferredPaymentCurrency: string | null = null;

  if (kycCols.length) {
    const kycUserIdCol = pickColumn(kycCols, ["userId", "user_id"]) ?? "user_id";
    const kycStatusCol = pickColumn(kycCols, ["status"]) ?? "status";
    const kycInvitedAtCol = pickColumn(kycCols, ["invitedAt", "invited_at"]) ?? null;

    const kycRow = await rawGet<AnyRow>(`
      SELECT *
      FROM user_kyc_profiles
      WHERE ${kycUserIdCol} = ${input.userId}
      LIMIT 1
    `);

    if (kycRow) {
      kycStatus = normalizeKycStatus(kycRow[kycStatusCol]);
      kycInvitedAtMs = kycInvitedAtCol ? normalizeTsToMs(kycRow[kycInvitedAtCol]) : null;
    }
  }

  if (payoutCols.length) {
    const payoutUserIdCol = pickColumn(payoutCols, ["userId", "user_id"]) ?? "user_id";
    const payoutCurrencyCol = pickColumn(payoutCols, ["preferredPaymentCurrency", "preferred_payment_currency"]) ?? null;
    const payoutRow = await rawGet<AnyRow>(`
      SELECT *
      FROM user_payout_profiles
      WHERE ${payoutUserIdCol} = ${input.userId}
      LIMIT 1
    `);
    if (payoutRow && payoutCurrencyCol) {
      const raw = payoutRow[payoutCurrencyCol];
      preferredPaymentCurrency = raw ? String(raw) : null;
    }
  }

  const tradesUserIdCol =
    pickColumn(tradesCols, ["userId", "user_id", "uid", "accountId", "account_id"]) ??
    "user_id";

  const tradesCreatedAtCol =
    pickColumn(tradesCols, ["createdAt", "created_at", "openTime", "open_time", "openedAt", "opened_at"]) ??
    pickAnyColumnByIncludes(tradesCols, ["created", "open"]) ??
    null;

  const tradesClosedAtCol =
    pickColumn(tradesCols, ["closedAt", "closed_at", "closeTime", "close_time", "closedTime", "closed_time"]) ??
    pickAnyColumnByIncludes(tradesCols, ["closed", "close"]) ??
    null;

  const tradesPnlCol =
    pickColumn(tradesCols, ["pnl", "profit", "realizedPnl", "realized_pnl"]) ??
    null;

  const tradesActivityExpr = coalesceExpr([tradesClosedAtCol, tradesCreatedAtCol]);

  const equityUserIdCol = pickColumn(equityCols, ["userId", "user_id"]) ?? null;
  const equityDayKeyCol = pickColumn(equityCols, ["dayKey", "day_key"]) ?? null;
  const equityEquityCol = pickColumn(equityCols, ["equity", "equity_value"]) ?? null;

  const tradesLifetimeRow = await rawGet<{ n: any }>(
    `SELECT COUNT(1) AS n FROM trades WHERE ${tradesUserIdCol} = ${input.userId}`
  );
  const tradesLifetime = Number(tradesLifetimeRow?.n ?? 0) || 0;

  let tradesLast90d = 0;
  let lastTradeAtMs: number | null = null;

  if (tradesActivityExpr) {
    const since = nowMs - path2WindowDays * 86400000;

    const last90Row = await rawGet<{ n: any }>(
      `
        SELECT COUNT(1) AS n
        FROM trades
        WHERE ${tradesUserIdCol} = ${input.userId}
          AND ${tradesActivityExpr} >= ${since}
      `
    );
    tradesLast90d = Number(last90Row?.n ?? 0) || 0;

    const lastRow = await rawGet<{ t: any }>(
      `
        SELECT MAX(${tradesActivityExpr}) AS t
        FROM trades
        WHERE ${tradesUserIdCol} = ${input.userId}
      `
    );
    lastTradeAtMs = normalizeTsToMs(lastRow?.t);
  }

  const accountAgeDays = daysBetween(now, createdAt);
  const lastTradeDaysAgo = lastTradeAtMs ? daysBetween(now, new Date(lastTradeAtMs)) : null;

  const returnLast90d = await computeReturnLast90d({
    tradesTable: "trades",
    tradesUserIdCol,
    tradesClosedAtExpr: tradesClosedAtCol ?? null,
    tradesPnlCol,
    equityTable: equityCols.length ? "user_equity_daily" : null,
    equityUserIdCol,
    equityDayKeyCol,
    equityEquityCol,
    equityNow: Number.isFinite(equity) ? equity : null,
    userId: input.userId,
    nowMs,
    startingEquity,
    windowDays: path2WindowDays,
  });

  const ctx: DecisionContext = {
    now,
    request: input.request,
    user: {
      id: input.userId,
      email,
      username,
      createdAt,
      suspendedAt: toDateOrNull(suspendedAtMs),
      emailVerifiedAt,
      emailInitialDueAt,
      emailReverifyDueAt,
      phoneVerifiedAt: toDateOrNull(phoneVerifiedAtMs),
      userTier,
      contenderTier,
      selectedAt: toDateOrNull(selectedAtMs),
      lockedAt: toDateOrNull(lockedAtMs),
      lockReason,
    },
    metrics: {
      tradesLifetime,
      tradesLast90d,
      accountAgeDays,
      lastTradeDaysAgo,
      balancePctOfStart: Number.isFinite(balancePctOfStart) ? balancePctOfStart : 1.0,
      returnLast90d: Number.isFinite(returnLast90d) ? returnLast90d : 0.0,
    },
    throttle: {
      emailSendCountDay: Number.isFinite(emailResendCountDay) ? emailResendCountDay : 0,
      emailLastSentAtMs: emailLastResendAtMs ?? null,
      smsSendCountDay: Number.isFinite(smsSendCountDay) ? smsSendCountDay : 0,
      smsLastSentAtMs: smsLastSentAtMs ?? null,
      otpFailCount: Number.isFinite(otpFailCount) ? otpFailCount : 0,
      otpLockedUntilMs: otpLockedUntilMs ?? null,
    },
    kyc: {
      status: kycStatus,
      invitedAtMs: kycInvitedAtMs,
      preferredPaymentCurrency,
    },
    tradeIntent: input.tradeIntent,
  };

  return ctx;
}
