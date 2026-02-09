import { normalizeInstrumentCategory, type InstrumentCategoryTag } from "./categories";

export type TradeSide = "BUY" | "SELL";

export const COST_MODEL_VERSION = "v2026_02_08_global_swap10";
export const DEFAULT_NOTIONAL_PER_LOT_USD = 100_000;
export const DEFAULT_FINANCING_PER_DAY_PER_100K_USD = 17.06;
export const DEFAULT_SWAP_PER_OVERNIGHT_PER_100K_USD = 10.0;

type CostProfile = {
  category: InstrumentCategoryTag;
  key: "EQ" | "FX" | "CRYPTO" | "BOND" | "MF";
  commissionPer100kUsd?: number;
  commissionRate?: number;
  commissionMinUsd?: number;
  otherFeesBuyPer100kUsd: number;
  otherFeesSellPer100kUsd: number;
  financingPerDayPer100kUsd: number;
  swapLongPerOvernightPer100kUsd: number;
  swapShortPerOvernightPer100kUsd: number;
};

const SWAP_PER_OVERNIGHT = DEFAULT_SWAP_PER_OVERNIGHT_PER_100K_USD;
const FINANCING_PER_DAY = DEFAULT_FINANCING_PER_DAY_PER_100K_USD;

const CATEGORY_COST_PROFILES: Record<InstrumentCategoryTag, CostProfile> = {
  forex: {
    category: "forex",
    key: "FX",
    // User override: 0.0001 notional rate, min $10/side.
    commissionRate: 0.0001,
    commissionMinUsd: 10,
    otherFeesBuyPer100kUsd: 0,
    otherFeesSellPer100kUsd: 0,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  stocks: {
    category: "stocks",
    key: "EQ",
    commissionPer100kUsd: 20,
    otherFeesBuyPer100kUsd: 0.8,
    otherFeesSellPer100kUsd: 1.58,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  etf: {
    category: "etf",
    key: "EQ",
    commissionPer100kUsd: 20,
    otherFeesBuyPer100kUsd: 0.8,
    otherFeesSellPer100kUsd: 1.58,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  crypto: {
    category: "crypto",
    key: "CRYPTO",
    commissionPer100kUsd: 180,
    otherFeesBuyPer100kUsd: 0,
    otherFeesSellPer100kUsd: 0,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  commodities: {
    category: "commodities",
    key: "EQ",
    commissionPer100kUsd: 20,
    otherFeesBuyPer100kUsd: 0.8,
    otherFeesSellPer100kUsd: 1.58,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  bonds: {
    category: "bonds",
    key: "BOND",
    commissionPer100kUsd: 32.5,
    otherFeesBuyPer100kUsd: 0,
    otherFeesSellPer100kUsd: 0.12,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  funds: {
    category: "funds",
    key: "EQ",
    commissionPer100kUsd: 20,
    otherFeesBuyPer100kUsd: 0.8,
    otherFeesSellPer100kUsd: 1.58,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  mutual_funds: {
    category: "mutual_funds",
    key: "MF",
    commissionPer100kUsd: 14.95,
    otherFeesBuyPer100kUsd: 0,
    otherFeesSellPer100kUsd: 0,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  indices: {
    category: "indices",
    key: "EQ",
    commissionPer100kUsd: 20,
    otherFeesBuyPer100kUsd: 0.8,
    otherFeesSellPer100kUsd: 1.58,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
  unknown: {
    category: "unknown",
    key: "EQ",
    commissionPer100kUsd: 20,
    otherFeesBuyPer100kUsd: 0.8,
    otherFeesSellPer100kUsd: 1.58,
    financingPerDayPer100kUsd: FINANCING_PER_DAY,
    swapLongPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
    swapShortPerOvernightPer100kUsd: SWAP_PER_OVERNIGHT,
  },
};

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function scalePer100k(notionalUsd: number): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return 0;
  return notionalUsd / 100_000;
}

function normalizeSide(raw: unknown): TradeSide {
  return String(raw ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function oppositeSide(side: TradeSide): TradeSide {
  return side === "BUY" ? "SELL" : "BUY";
}

export function normalizeNotionalUsd(params: {
  notionalUsd?: number | null;
  size?: number | null;
  lots?: number | null;
}): number {
  const direct = Number(params.notionalUsd ?? NaN);
  if (Number.isFinite(direct) && direct > 0) return round2(direct);

  const size = Number(params.size ?? NaN);
  if (Number.isFinite(size) && size > 0) return round2(size);

  const lots = Number(params.lots ?? NaN);
  if (Number.isFinite(lots) && lots > 0) return round2(lots * DEFAULT_NOTIONAL_PER_LOT_USD);

  return 0;
}

export function resolveCostProfile(categoryRaw: unknown): CostProfile {
  const category = normalizeInstrumentCategory(categoryRaw, "unknown");
  return CATEGORY_COST_PROFILES[category] ?? CATEGORY_COST_PROFILES.unknown;
}

export function calculateCommissionPerSideUsd(params: {
  category: unknown;
  notionalUsd: number;
}): number {
  const profile = resolveCostProfile(params.category);
  const notional = Number(params.notionalUsd || 0);
  if (!Number.isFinite(notional) || notional <= 0) return 0;

  if (typeof profile.commissionRate === "number") {
    const minUsd = Number(profile.commissionMinUsd ?? 0);
    return round2(Math.max(notional * profile.commissionRate, minUsd));
  }

  const per100k = Number(profile.commissionPer100kUsd ?? 0);
  return round2(per100k * scalePer100k(notional));
}

export function calculateOtherFeesPerSideUsd(params: {
  category: unknown;
  notionalUsd: number;
  side: TradeSide | string;
}): number {
  const profile = resolveCostProfile(params.category);
  const notional = Number(params.notionalUsd || 0);
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  const per100k =
    normalizeSide(params.side) === "SELL"
      ? profile.otherFeesSellPer100kUsd
      : profile.otherFeesBuyPer100kUsd;
  return round2(per100k * scalePer100k(notional));
}

export function calculateFinancingPerDayUsd(params: {
  category: unknown;
  notionalUsd: number;
}): number {
  const profile = resolveCostProfile(params.category);
  const notional = Number(params.notionalUsd || 0);
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  return round2(profile.financingPerDayPer100kUsd * scalePer100k(notional));
}

export function calculateSwapPerOvernightUsd(params: {
  category: unknown;
  notionalUsd: number;
  positionSide: TradeSide | string;
}): number {
  const profile = resolveCostProfile(params.category);
  const notional = Number(params.notionalUsd || 0);
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  const rate =
    normalizeSide(params.positionSide) === "SELL"
      ? profile.swapShortPerOvernightPer100kUsd
      : profile.swapLongPerOvernightPer100kUsd;
  return round2(rate * scalePer100k(notional));
}

export function calculateOpenSideCosts(params: {
  category: unknown;
  notionalUsd: number;
  positionSide: TradeSide | string;
}) {
  const side = normalizeSide(params.positionSide);
  const commissionUsd = calculateCommissionPerSideUsd({
    category: params.category,
    notionalUsd: params.notionalUsd,
  });
  const otherFeesUsd = calculateOtherFeesPerSideUsd({
    category: params.category,
    notionalUsd: params.notionalUsd,
    side,
  });
  return {
    side,
    commissionUsd,
    otherFeesUsd,
    totalUsd: round2(commissionUsd + otherFeesUsd),
  };
}

export function calculateCloseSideCosts(params: {
  category: unknown;
  notionalUsd: number;
  positionSide: TradeSide | string;
}) {
  const closeSide = oppositeSide(normalizeSide(params.positionSide));
  const commissionUsd = calculateCommissionPerSideUsd({
    category: params.category,
    notionalUsd: params.notionalUsd,
  });
  const otherFeesUsd = calculateOtherFeesPerSideUsd({
    category: params.category,
    notionalUsd: params.notionalUsd,
    side: closeSide,
  });
  return {
    side: closeSide,
    commissionUsd,
    otherFeesUsd,
    totalUsd: round2(commissionUsd + otherFeesUsd),
  };
}

export function calculateHoldDays(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return (endMs - startMs) / 86_400_000;
}

export function buildCostSnapshot(params: {
  category: unknown;
  notionalUsd: number;
  positionSide: TradeSide | string;
  holdDays?: number;
  overnightDays?: number;
  openSideAlreadyChargedUsd?: number;
}) {
  const profile = resolveCostProfile(params.category);
  const category = profile.category;
  const notionalUsd = normalizeNotionalUsd({ notionalUsd: params.notionalUsd });
  const holdDays = Math.max(0, Number(params.holdDays ?? 0));
  const overnightDays = Math.max(0, Math.trunc(Number(params.overnightDays ?? 0)));
  const openSide = calculateOpenSideCosts({ category, notionalUsd, positionSide: params.positionSide });
  const closeSide = calculateCloseSideCosts({ category, notionalUsd, positionSide: params.positionSide });
  const financingPerDayUsd = calculateFinancingPerDayUsd({ category, notionalUsd });
  const swapPerOvernightUsd = calculateSwapPerOvernightUsd({
    category,
    notionalUsd,
    positionSide: params.positionSide,
  });
  const financingAccruedUsd = round2(financingPerDayUsd * holdDays);
  const swapAccruedUsd = round2(swapPerOvernightUsd * overnightDays);
  const openSideAlreadyChargedUsd = round2(Math.max(0, Number(params.openSideAlreadyChargedUsd ?? openSide.totalUsd)));
  const totalCostsUsd = round2(openSideAlreadyChargedUsd + closeSide.totalUsd + financingAccruedUsd + swapAccruedUsd);

  return {
    costModelVersion: COST_MODEL_VERSION,
    categorySnapshot: category,
    notionalUsd,
    holdDays,
    overnightDays,
    openSide,
    closeSide,
    financingPerDayUsd,
    swapPerOvernightUsd,
    financingAccruedUsd,
    swapAccruedUsd,
    totalCostsUsd,
  };
}

