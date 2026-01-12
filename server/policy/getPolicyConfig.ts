import { db } from "@db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";
import { DEFAULT_POLICY_CONFIG, type PolicyConfig } from "@shared/policyDecision";

type ConfigRow = Partial<typeof systemConfig.$inferSelect> | undefined;

const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: PolicyConfig } | null = null;

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function mergePolicyConfig(row: ConfigRow): PolicyConfig {
  const cfg = { ...DEFAULT_POLICY_CONFIG };
  if (!row) return cfg;

  return {
    ...cfg,
    contenderMinAgeDays: toNumber(row.policyContenderPath1MinAgeDays, cfg.contenderMinAgeDays),
    contenderMinTradesLifetime: toNumber(row.policyContenderPath1MinTradesLifetime, cfg.contenderMinTradesLifetime),
    contenderMinBalancePct: toNumber(row.policyContenderPath1MinBalancePct, cfg.contenderMinBalancePct),
    contenderPath2MinAgeDays: toNumber(row.policyContenderPath2MinAgeDays, cfg.contenderPath2MinAgeDays),
    contenderPath2MinTradesLast90: toNumber(row.policyContenderPath2MinTradesLast90, cfg.contenderPath2MinTradesLast90),
    contenderPath2MinReturnLast90: toNumber(row.policyContenderPath2MinReturnLast90, cfg.contenderPath2MinReturnLast90),
    contenderPath2MaxDaysSinceLastTrade: toNumber(
      row.policyContenderPath2MaxDaysSinceLastTrade,
      cfg.contenderPath2MaxDaysSinceLastTrade
    ),
    autoPromotePerformer: toBool(row.policyAutoPromotePerformer, true),
    emailResendCooldownSec: toNumber(row.policyEmailResendCooldownSec, cfg.emailResendCooldownSec),
    emailDailySendCap: toNumber(row.policyEmailDailySendCap, cfg.emailDailySendCap),
    smsDailySendCap: toNumber(row.policySmsDailySendCap, cfg.smsDailySendCap),
    smsResendCooldownSec: toNumber(row.policySmsResendCooldownSec, cfg.smsResendCooldownSec),
    otpMaxAttempts: toNumber(row.policyOtpMaxAttempts, cfg.otpMaxAttempts),
    otpLockMinutes: toNumber(row.policyOtpLockMinutes, cfg.otpLockMinutes),
  };
}

export async function loadPolicyConfig(): Promise<PolicyConfig> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const row = (await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  })) as ConfigRow;
  const merged = mergePolicyConfig(row);
  cached = { at: now, value: merged };
  return merged;
}
