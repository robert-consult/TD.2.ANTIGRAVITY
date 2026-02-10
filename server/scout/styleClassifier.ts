export type StyleCluster = "SNIPER" | "SCALPER" | "SWING" | "NEWS";

export type StyleInput = {
  tradesPerDay: number;
  avgHoldSec: number;
  winRate: number;
  avgWinLossRatio: number;
};

function safe(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function classifyStyleCluster(input: StyleInput): StyleCluster {
  const tradesPerDay = Math.max(0, safe(input.tradesPerDay));
  const avgHoldSec = Math.max(0, safe(input.avgHoldSec));
  const winRate = Math.max(0, Math.min(1, safe(input.winRate)));
  const avgWinLossRatio = Math.max(0, safe(input.avgWinLossRatio));

  if (tradesPerDay >= 20 && avgHoldSec <= 5 * 60) return "SCALPER";
  if (avgHoldSec >= 24 * 3600) return "SWING";
  if (winRate >= 0.7 && tradesPerDay < 3 && avgWinLossRatio >= 2) return "SNIPER";
  return "NEWS";
}
