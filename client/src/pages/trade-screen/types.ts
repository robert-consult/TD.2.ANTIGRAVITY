export interface TradeScreenProps {
  selectedSymbol: string;
  currentPrice?: number;
}

export function accountValueToneClass(value: number | null | undefined, baseline: number | null): string {
  if (!Number.isFinite(Number(value)) || baseline == null) return "text-white";
  if (Number(value) > baseline) return "text-green-400";
  if (Number(value) < baseline) return "text-red-400";
  return "text-white";
}

export interface SymbolConfig {
  id: number;
  symbol: string;
  name: string;
  category?: string | null;
  baseCurrency?: string;
  quoteCurrency?: string;
  spread?: number;
  minSpreadPips: number;
  pipDecimals?: number | null;
  quoteDecimals?: number | null;
  enabled: boolean;
  minLot: number;
  maxLot: number;
}

export interface Trade {
  id: number;
  symbolId: number;
  userId: number;
  type: "BUY" | "SELL";
  orderType: string;
  status: string;
  size: number;
  lots: number;
  openPrice: number;
  closePrice: number | null;
  profit: string | null;
  grossProfitUsd?: number | null;
  netProfitUsd?: number | null;
  notionalUsd?: number | null;
  totalCostsUsd?: number | null;
  openCommissionUsd?: number | null;
  closeCommissionUsd?: number | null;
  openOtherFeesUsd?: number | null;
  closeOtherFeesUsd?: number | null;
  financingAccruedUsd?: number | null;
  swapAccruedUsd?: number | null;
  overnightDays?: number | null;
  categorySnapshot?: string | null;
  costModelVersion?: string | null;
  takeProfit: number | null;
  stopLoss: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
  closedAt: Date | string | number | null;
  openedAt?: Date | string | number | null;
  executedAt?: Date | string | number | null;
}
