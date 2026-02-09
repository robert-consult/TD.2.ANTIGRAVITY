import { db } from "@db";
import { systemConfig } from "@shared/schema";
import {
  COST_MODEL_VERSION,
  buildCostSnapshot,
  calculateCloseSideCosts,
  calculateOpenSideCosts,
  calculateSwapPerOvernightUsd,
  calculateFinancingPerDayUsd,
  calculateHoldDays,
  normalizeNotionalUsd,
  resolveCostProfile,
  type TradeSide,
} from "@shared/instruments/costPolicy";
import { eq } from "drizzle-orm";
import { computeSessionDay, normalizeFxRolloverConfig } from "../utils/quoteSession";

type RolloverConfig = {
  tz: string;
  time: string;
};

const ROLLOVER_CACHE_TTL_MS = Number(process.env.ROLLOVER_CACHE_TTL_MS ?? 30_000);
let rolloverCache: { fetchedAtMs: number; value: RolloverConfig } | null = null;
let rolloverInflight: Promise<RolloverConfig> | null = null;

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function toMs(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? Math.trunc(n * 1000) : Math.trunc(n);
}

function diffCalendarDays(startYmd: string, endYmd: string): number {
  const start = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export async function getRolloverConfig(): Promise<RolloverConfig> {
  const now = Date.now();
  if (rolloverCache && now - rolloverCache.fetchedAtMs < ROLLOVER_CACHE_TTL_MS) {
    return rolloverCache.value;
  }
  if (rolloverInflight) return rolloverInflight;

  rolloverInflight = (async () => {
    try {
      const row = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1),
      });
      const value = normalizeFxRolloverConfig({
        tz: (row as any)?.fxRolloverTz,
        time: (row as any)?.fxRolloverTime,
      });
      rolloverCache = { fetchedAtMs: Date.now(), value };
      return value;
    } catch {
      const value = normalizeFxRolloverConfig({
        tz: "America/New_York",
        time: "17:00",
      });
      rolloverCache = { fetchedAtMs: Date.now(), value };
      return value;
    } finally {
      rolloverInflight = null;
    }
  })();

  return rolloverInflight;
}

export async function getOvernightDays(params: {
  openedAtMs: number;
  closedAtMs: number;
  rollover?: RolloverConfig;
}): Promise<number> {
  const openedAtMs = Number(params.openedAtMs);
  const closedAtMs = Number(params.closedAtMs);
  if (!Number.isFinite(openedAtMs) || !Number.isFinite(closedAtMs) || closedAtMs <= openedAtMs) return 0;

  const rollover = params.rollover ?? (await getRolloverConfig());
  const openSessionDay = computeSessionDay(openedAtMs, rollover);
  const closeSessionDay = computeSessionDay(closedAtMs, rollover);
  return diffCalendarDays(openSessionDay, closeSessionDay);
}

export function inferNotionalUsd(params: {
  notionalUsd?: number | null;
  size?: number | null;
  lots?: number | null;
}): number {
  return normalizeNotionalUsd(params);
}

export function computeOpenSideCosts(params: {
  category: unknown;
  notionalUsd?: number | null;
  size?: number | null;
  lots?: number | null;
  positionSide: TradeSide | string;
}) {
  const notionalUsd = inferNotionalUsd({
    notionalUsd: params.notionalUsd,
    size: params.size,
    lots: params.lots,
  });
  const profile = resolveCostProfile(params.category);
  const openSide = calculateOpenSideCosts({
    category: profile.category,
    notionalUsd,
    positionSide: params.positionSide,
  });
  return {
    costModelVersion: COST_MODEL_VERSION,
    categorySnapshot: profile.category,
    notionalUsd,
    commissionUsd: openSide.commissionUsd,
    otherFeesUsd: openSide.otherFeesUsd,
    totalUsd: openSide.totalUsd,
  };
}

export async function computeCloseSettlementCosts(params: {
  category: unknown;
  positionSide: TradeSide | string;
  notionalUsd?: number | null;
  size?: number | null;
  lots?: number | null;
  openedAt?: unknown;
  executedAt?: unknown;
  closedAtMs?: number;
  openCommissionUsd?: number | null;
  openOtherFeesUsd?: number | null;
  rollover?: RolloverConfig;
}) {
  const notionalUsd = inferNotionalUsd({
    notionalUsd: params.notionalUsd,
    size: params.size,
    lots: params.lots,
  });
  const profile = resolveCostProfile(params.category);
  const closeSide = calculateCloseSideCosts({
    category: profile.category,
    notionalUsd,
    positionSide: params.positionSide,
  });

  const closeMs = Number(params.closedAtMs ?? Date.now());
  const startMs =
    toMs(params.executedAt) ??
    toMs(params.openedAt) ??
    closeMs;
  const holdDays = calculateHoldDays(startMs, closeMs);
  const overnightDays = await getOvernightDays({
    openedAtMs: startMs,
    closedAtMs: closeMs,
    rollover: params.rollover,
  });

  const financingPerDayUsd = calculateFinancingPerDayUsd({
    category: profile.category,
    notionalUsd,
  });
  const swapPerOvernightUsd = calculateSwapPerOvernightUsd({
    category: profile.category,
    notionalUsd,
    positionSide: params.positionSide,
  });
  const financingAccruedUsd = round2(financingPerDayUsd * holdDays);
  const swapAccruedUsd = round2(swapPerOvernightUsd * overnightDays);

  const openCommissionUsd = round2(Math.max(0, Number(params.openCommissionUsd ?? 0)));
  const openOtherFeesUsd = round2(Math.max(0, Number(params.openOtherFeesUsd ?? 0)));
  const openSideTotalUsd = round2(openCommissionUsd + openOtherFeesUsd);
  const closeSideTotalUsd = round2(closeSide.totalUsd);
  const closingChargesUsd = round2(closeSideTotalUsd + financingAccruedUsd + swapAccruedUsd);
  const totalCostsUsd = round2(openSideTotalUsd + closingChargesUsd);

  return {
    costModelVersion: COST_MODEL_VERSION,
    categorySnapshot: profile.category,
    notionalUsd,
    holdDays,
    overnightDays,
    openCommissionUsd,
    openOtherFeesUsd,
    openSideTotalUsd,
    closeCommissionUsd: closeSide.commissionUsd,
    closeOtherFeesUsd: closeSide.otherFeesUsd,
    closeSideTotalUsd,
    financingPerDayUsd,
    swapPerOvernightUsd,
    financingAccruedUsd,
    swapAccruedUsd,
    closingChargesUsd,
    totalCostsUsd,
  };
}

export async function computeOpenTradeAccrualCosts(params: {
  category: unknown;
  positionSide: TradeSide | string;
  notionalUsd?: number | null;
  size?: number | null;
  lots?: number | null;
  openedAt?: unknown;
  executedAt?: unknown;
  asOfMs?: number;
}) {
  const summary = await computeCloseSettlementCosts({
    category: params.category,
    positionSide: params.positionSide,
    notionalUsd: params.notionalUsd,
    size: params.size,
    lots: params.lots,
    openedAt: params.openedAt,
    executedAt: params.executedAt,
    closedAtMs: params.asOfMs ?? Date.now(),
    openCommissionUsd: 0,
    openOtherFeesUsd: 0,
  });

  return {
    holdDays: summary.holdDays,
    overnightDays: summary.overnightDays,
    financingPerDayUsd: summary.financingPerDayUsd,
    swapPerOvernightUsd: summary.swapPerOvernightUsd,
    financingAccruedUsd: summary.financingAccruedUsd,
    swapAccruedUsd: summary.swapAccruedUsd,
    accruedHoldingCostsUsd: round2(summary.financingAccruedUsd + summary.swapAccruedUsd),
  };
}

export function buildFinalTradeCostSnapshot(params: {
  category: unknown;
  notionalUsd: number;
  positionSide: TradeSide | string;
  holdDays: number;
  overnightDays: number;
  openSideAlreadyChargedUsd: number;
}) {
  return buildCostSnapshot({
    category: params.category,
    notionalUsd: params.notionalUsd,
    positionSide: params.positionSide,
    holdDays: params.holdDays,
    overnightDays: params.overnightDays,
    openSideAlreadyChargedUsd: params.openSideAlreadyChargedUsd,
  });
}

