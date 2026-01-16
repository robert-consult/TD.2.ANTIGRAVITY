import { ApiError } from "@/lib/queryClient";

const getTemplates = () => ({
  tradeFailedTitle: { text: "Trade Failed" },
  fallbackTradeError: { text: "Failed to execute trade" },
  quoteMissingDesc: { text: "Cannot open trade: no quote data available for {symbol}. Please wait for market data." },
  quoteTimestampInvalidDesc: { text: "Cannot open trade: quote data for {symbol} has no valid timestamp. Please wait for fresh market data." },
  quoteStaleDesc: { text: "Cannot open trade: quote data for {symbol} is stale. Please wait for fresh market data." },
  maxConcurrentTradesDesc: { text: "Maximum {limit} concurrent trades allowed (OPEN + PENDING)." },
  maxTradesPerInstrumentDesc: { text: "Maximum {limit} concurrent trades allowed per instrument (OPEN + PENDING)." },
  maxConcurrentLotsDesc: { text: "Maximum concurrent lots exceeded (OPEN + PENDING). Current={currentLots}, Requested={requestedLots}, Limit={limit}." },
  dailyLossLimitDesc: { text: "Daily loss limit of {limit}% reached. Try again tomorrow." },
  lifetimeLossLimitDesc: { text: "Lifetime loss limit of {limit}% reached. Account has been disabled." },
  maxPositionSizeDesc: { text: "Position size {positionSize} exceeds maximum allowed ({maxPositionSize})." },
  minHoldTimeDesc: { text: "Trade must be held for at least {minHoldSec} seconds. {remainingSec} seconds remaining." },
});

type TemplateVars = Record<string, string | number | boolean | null | undefined>;

const formatTemplate = (template: string, vars: TemplateVars) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const v = vars?.[key];
    return v === null || v === undefined ? "" : String(v);
  });

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

const formatUsd = (value: number | null): string => {
  if (value === null) return "";
  return `$${value.toLocaleString()}`;
};

export type TradeErrorToast = {
  title: string;
  description: string;
};

export function getTradeErrorToast(
  error: unknown,
  opts?: { symbol?: string }
): TradeErrorToast {
  const templates = getTemplates();
  const apiError = error instanceof ApiError ? error : null;
  const data = (apiError?.data ?? {}) as Record<string, unknown>;
  const code = apiError?.code;
  const symbol =
    typeof data.symbol === "string" && data.symbol.trim()
      ? data.symbol
      : opts?.symbol ?? "—";

  const limit = toNumber(data.limit);
  const currentLots = toNumber(data.currentLots);
  const requestedLots = toNumber(data.requestedLots);
  const positionSize = toNumber(data.positionSize);
  const maxPositionSize = toNumber(data.maxPositionSize);
  const minHoldSec = toNumber(data.minHoldSec);
  const remainingSec = toNumber(data.remainingSec);

  let description = "";

  if (code === "QUOTE_DATA_MISSING") {
    description = formatTemplate(templates.quoteMissingDesc.text, { symbol });
  } else if (code === "QUOTE_TIMESTAMP_INVALID") {
    description = formatTemplate(templates.quoteTimestampInvalidDesc.text, { symbol });
  } else if (code === "QUOTE_STALE") {
    description = formatTemplate(templates.quoteStaleDesc.text, { symbol });
  } else if (code === "MAX_CONCURRENT_TRADES") {
    description = formatTemplate(templates.maxConcurrentTradesDesc.text, {
      limit: limit ?? data.limit ?? "",
    });
  } else if (code === "MAX_TRADES_PER_INSTRUMENT") {
    description = formatTemplate(templates.maxTradesPerInstrumentDesc.text, {
      limit: limit ?? data.limit ?? "",
    });
  } else if (code === "MAX_CONCURRENT_LOTS") {
    description = formatTemplate(templates.maxConcurrentLotsDesc.text, {
      currentLots: currentLots ?? data.currentLots ?? "",
      requestedLots: requestedLots ?? data.requestedLots ?? "",
      limit: limit ?? data.limit ?? "",
    });
  } else if (code === "DAILY_LOSS_LIMIT") {
    description = formatTemplate(templates.dailyLossLimitDesc.text, {
      limit: limit ?? data.limit ?? "",
    });
  } else if (code === "LIFETIME_LOSS_LIMIT") {
    description = formatTemplate(templates.lifetimeLossLimitDesc.text, {
      limit: limit ?? data.limit ?? "",
    });
  } else if (code === "MAX_POSITION_SIZE") {
    description = formatTemplate(templates.maxPositionSizeDesc.text, {
      positionSize: formatUsd(positionSize),
      maxPositionSize: formatUsd(maxPositionSize),
    });
  } else if (code === "MIN_HOLD_TIME") {
    description = formatTemplate(templates.minHoldTimeDesc.text, {
      minHoldSec: minHoldSec ?? data.minHoldSec ?? "",
      remainingSec: remainingSec ?? data.remainingSec ?? "",
    });
  }

  if (!description) {
    if (apiError?.message) description = apiError.message;
    else if (error instanceof Error && error.message) description = error.message;
    else description = templates.fallbackTradeError.text;
  }

  return { title: templates.tradeFailedTitle.text, description };
}
