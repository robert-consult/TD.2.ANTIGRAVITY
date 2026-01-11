/**
 * Close Reason Taxonomy (shared across backend + frontend)
 * 
 * Hedge-fund grade close reason system for institutional audit compliance.
 * 
 * Goals:
 * - Consistent values across trades.closeReason and trade_audit.reasonCode
 * - Human-friendly labels for trader UI and admin/audit UI
 * - Backward-compatible normalization for legacy DB values
 * - UI variant hints for badge styling
 */

export type CloseReasonCode =
  // Trader / user initiated
  | "MANUAL_CLOSE"
  | "PARTIAL_CLOSE"
  // Targets / exits
  | "STOP_LOSS_HIT"
  | "TAKE_PROFIT_HIT"
  | "TRAILING_STOP_HIT"
  | "BREAKEVEN_STOP_HIT"
  // Time-based
  | "MAX_HOLD_TIME"
  // Risk / margin / compliance
  | "MARGIN_STOP_OUT"
  | "DAILY_LOSS_LIMIT"
  | "MAX_DRAWDOWN_LIMIT"
  | "MAX_CONCURRENT_LOTS_LIMIT"
  | "MAX_CONCURRENT_TRADES_LIMIT"
  | "SYMBOL_DISABLED"
  | "ACCOUNT_FROZEN"
  // Order-state (pending)
  | "CANCELED_BY_USER"
  | "EXPIRED_PENDING_ORDER"
  | "ORDER_REJECTED"
  // Market / system
  | "MARKET_CLOSED"
  | "MARKET_HALTED"
  | "PRICE_UNAVAILABLE"
  | "SYSTEM_MAINTENANCE"
  // Admin / system discretionary
  | "ADMIN_CLOSE"
  | "SYSTEM_CLOSE";

export type CloseReasonCategory =
  | "USER"
  | "TARGET"
  | "TIME"
  | "MARGIN"
  | "RISK"
  | "ORDER"
  | "MARKET"
  | "SYSTEM"
  | "ADMIN";

export type CloseReasonUiVariant =
  | "success"   // expected "normal exit" (TP hit)
  | "warning"   // cautionary, but not necessarily bad (max hold, admin)
  | "danger"    // risk/forced/stop-out (SL, margin, risk limits)
  | "info"      // neutral/system (market closed, maintenance)
  | "neutral";  // manual close, normal operation

export interface CloseReasonMeta {
  code: CloseReasonCode;
  label: string;
  shortLabel: string;
  category: CloseReasonCategory;
  variant: CloseReasonUiVariant;
  traderFacing: boolean;
  description: string;
}

function buildMeta(): Record<CloseReasonCode, CloseReasonMeta> {
  return {
    MANUAL_CLOSE: {
      code: "MANUAL_CLOSE",
      label: "Manual close",
      shortLabel: "Manual",
      category: "USER",
      variant: "neutral",
      traderFacing: true,
      description: "Trader manually closed the position.",
    },
    PARTIAL_CLOSE: {
      code: "PARTIAL_CLOSE",
      label: "Partial close",
      shortLabel: "Partial",
      category: "USER",
      variant: "neutral",
      traderFacing: false,
      description: "Trader partially closed the position.",
    },
    STOP_LOSS_HIT: {
      code: "STOP_LOSS_HIT",
      label: "Stop loss hit",
      shortLabel: "SL hit",
      category: "TARGET",
      variant: "danger",
      traderFacing: true,
      description: "Position closed when stop loss price was reached.",
    },
    TAKE_PROFIT_HIT: {
      code: "TAKE_PROFIT_HIT",
      label: "Take profit hit",
      shortLabel: "TP hit",
      category: "TARGET",
      variant: "success",
      traderFacing: true,
      description: "Position closed when take profit price was reached.",
    },
    TRAILING_STOP_HIT: {
      code: "TRAILING_STOP_HIT",
      label: "Trailing stop hit",
      shortLabel: "TS hit",
      category: "TARGET",
      variant: "danger",
      traderFacing: true,
      description: "Position closed when trailing stop was triggered.",
    },
    BREAKEVEN_STOP_HIT: {
      code: "BREAKEVEN_STOP_HIT",
      label: "Break-even stop hit",
      shortLabel: "BE stop",
      category: "TARGET",
      variant: "warning",
      traderFacing: true,
      description: "Position closed at break-even price.",
    },
    MAX_HOLD_TIME: {
      code: "MAX_HOLD_TIME",
      label: "Max hold time reached",
      shortLabel: "Time limit",
      category: "TIME",
      variant: "warning",
      traderFacing: true,
      description: "Position auto-closed due to maximum hold time exceeded.",
    },
    MARGIN_STOP_OUT: {
      code: "MARGIN_STOP_OUT",
      label: "Stop-out / liquidation",
      shortLabel: "Stop-out",
      category: "MARGIN",
      variant: "danger",
      traderFacing: true,
      description: "Position liquidated due to insufficient margin.",
    },
    DAILY_LOSS_LIMIT: {
      code: "DAILY_LOSS_LIMIT",
      label: "Daily loss limit",
      shortLabel: "Daily loss",
      category: "RISK",
      variant: "danger",
      traderFacing: true,
      description: "Position closed due to daily loss limit exceeded.",
    },
    MAX_DRAWDOWN_LIMIT: {
      code: "MAX_DRAWDOWN_LIMIT",
      label: "Max drawdown limit",
      shortLabel: "Drawdown",
      category: "RISK",
      variant: "danger",
      traderFacing: true,
      description: "Position closed due to maximum drawdown limit exceeded.",
    },
    MAX_CONCURRENT_LOTS_LIMIT: {
      code: "MAX_CONCURRENT_LOTS_LIMIT",
      label: "Max concurrent lots limit",
      shortLabel: "Lots limit",
      category: "RISK",
      variant: "danger",
      traderFacing: true,
      description: "Position closed due to max concurrent lots exceeded.",
    },
    MAX_CONCURRENT_TRADES_LIMIT: {
      code: "MAX_CONCURRENT_TRADES_LIMIT",
      label: "Max concurrent trades limit",
      shortLabel: "Trade limit",
      category: "RISK",
      variant: "danger",
      traderFacing: true,
      description: "Position closed due to max concurrent trades exceeded.",
    },
    SYMBOL_DISABLED: {
      code: "SYMBOL_DISABLED",
      label: "Symbol disabled",
      shortLabel: "Disabled",
      category: "RISK",
      variant: "info",
      traderFacing: true,
      description: "Position closed because the symbol was disabled.",
    },
    ACCOUNT_FROZEN: {
      code: "ACCOUNT_FROZEN",
      label: "Account frozen",
      shortLabel: "Frozen",
      category: "RISK",
      variant: "danger",
      traderFacing: true,
      description: "Position closed due to account being frozen.",
    },
    CANCELED_BY_USER: {
      code: "CANCELED_BY_USER",
      label: "Canceled by user",
      shortLabel: "Canceled",
      category: "ORDER",
      variant: "neutral",
      traderFacing: true,
      description: "Pending order canceled by the trader.",
    },
    EXPIRED_PENDING_ORDER: {
      code: "EXPIRED_PENDING_ORDER",
      label: "Pending order expired",
      shortLabel: "Expired",
      category: "ORDER",
      variant: "neutral",
      traderFacing: true,
      description: "Pending order expired without being filled.",
    },
    ORDER_REJECTED: {
      code: "ORDER_REJECTED",
      label: "Order rejected",
      shortLabel: "Rejected",
      category: "ORDER",
      variant: "danger",
      traderFacing: true,
      description: "Order rejected by risk validation or margin check.",
    },
    MARKET_CLOSED: {
      code: "MARKET_CLOSED",
      label: "Market closed",
      shortLabel: "Mkt closed",
      category: "MARKET",
      variant: "info",
      traderFacing: true,
      description: "Position closed due to market closure.",
    },
    MARKET_HALTED: {
      code: "MARKET_HALTED",
      label: "Market halted",
      shortLabel: "Halted",
      category: "MARKET",
      variant: "info",
      traderFacing: true,
      description: "Position closed due to market halt.",
    },
    PRICE_UNAVAILABLE: {
      code: "PRICE_UNAVAILABLE",
      label: "Price unavailable",
      shortLabel: "No price",
      category: "SYSTEM",
      variant: "info",
      traderFacing: true,
      description: "Position closed due to price feed unavailability.",
    },
    SYSTEM_MAINTENANCE: {
      code: "SYSTEM_MAINTENANCE",
      label: "System maintenance",
      shortLabel: "Maintenance",
      category: "SYSTEM",
      variant: "info",
      traderFacing: true,
      description: "Position closed during scheduled system maintenance.",
    },
    ADMIN_CLOSE: {
      code: "ADMIN_CLOSE",
      label: "Closed by admin",
      shortLabel: "Admin",
      category: "ADMIN",
      variant: "warning",
      traderFacing: true,
      description: "Position closed by platform administrator.",
    },
    SYSTEM_CLOSE: {
      code: "SYSTEM_CLOSE",
      label: "Closed by system",
      shortLabel: "System",
      category: "SYSTEM",
      variant: "info",
      traderFacing: true,
      description: "Position closed by automated system process.",
    },
  };
}

const IS_BROWSER = typeof window !== "undefined";
let cachedMeta: Record<CloseReasonCode, CloseReasonMeta> | null = null;

function getMeta(): Record<CloseReasonCode, CloseReasonMeta> {
  if (!IS_BROWSER && cachedMeta) return cachedMeta;
  const meta = buildMeta();
  if (!IS_BROWSER) cachedMeta = meta;
  return meta;
}

/**
 * Get metadata for a close reason code.
 * Handles both canonical codes and legacy values.
 */
export function getCloseReasonMeta(raw: unknown): CloseReasonMeta | null {
  const meta = getMeta();
  const code = normalizeCloseReasonWithMeta(raw, meta);
  if (!code) return null;
  return meta[code] ?? null;
}

/**
 * List all close reasons (for admin/system use).
 */
export function listAllCloseReasons(): CloseReasonMeta[] {
  return Object.values(getMeta());
}

/**
 * List trader-facing close reasons (for dropdown filters in History screen).
 */
export function listTraderFacingCloseReasons(): CloseReasonMeta[] {
  return Object.values(getMeta()).filter((m) => m.traderFacing);
}

/**
 * Normalizes legacy values found in older rows to the canonical CloseReasonCode.
 * Returns null if value is empty/unknown.
 */
function normalizeCloseReasonWithMeta(raw: unknown, meta: Record<CloseReasonCode, CloseReasonMeta>): CloseReasonCode | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return null;

  // Already canonical?
  if (v in meta) return v as CloseReasonCode;

  // Legacy values used previously in this repo
  switch (v) {
    case "MANUAL":
    case "MANUAL_CLOSE_REQUESTED":
      return "MANUAL_CLOSE";
    case "SL":
    case "STOPLOSS":
    case "STOP_LOSS":
      return "STOP_LOSS_HIT";
    case "TP":
    case "TAKEPROFIT":
    case "TAKE_PROFIT":
      return "TAKE_PROFIT_HIT";
    case "AUTO_TIME_LIMIT":
    case "AUTO_TIME":
    case "TIME_LIMIT":
      return "MAX_HOLD_TIME";
    case "USER_CANCEL":
    case "CANCELED":
      return "CANCELED_BY_USER";
    case "REJECTED":
      return "ORDER_REJECTED";
    case "AUTO":
    case "SYSTEM":
      return "SYSTEM_CLOSE";
    case "ADMIN":
      return "ADMIN_CLOSE";
    case "FROZEN":
      return "ACCOUNT_FROZEN";
    default:
      return null;
  }
}

export function normalizeCloseReason(raw: unknown): CloseReasonCode | null {
  return normalizeCloseReasonWithMeta(raw, getMeta());
}

/**
 * Get the full label for a close reason (for detailed views).
 */
export function closeReasonLabel(raw: unknown, fallback: string = "—"): string {
  const meta = getCloseReasonMeta(raw);
  return meta?.label ?? fallback;
}

/**
 * Get the short label for a close reason (for table cells/badges).
 */
export function closeReasonShortLabel(raw: unknown, fallback: string = "—"): string {
  const meta = getCloseReasonMeta(raw);
  return meta?.shortLabel ?? meta?.label ?? fallback;
}

/**
 * Get the UI variant for styling close reason badges.
 */
export function closeReasonVariant(raw: unknown): CloseReasonUiVariant {
  const meta = getCloseReasonMeta(raw);
  return meta?.variant ?? "neutral";
}

/**
 * Get the category for a close reason.
 */
export function closeReasonCategory(raw: unknown): CloseReasonCategory | null {
  const meta = getCloseReasonMeta(raw);
  return meta?.category ?? null;
}

/**
 * Check if a close reason code is valid (canonical).
 */
export function isValidCloseReasonCode(code: string): code is CloseReasonCode {
  return code in getMeta();
}

/**
 * Trader-facing filter options for History screen dropdown.
 * Grouped by category for better UX.
 */
export const TRADER_CLOSE_REASON_FILTER_OPTIONS: CloseReasonCode[] = [
  "MANUAL_CLOSE",
  "TAKE_PROFIT_HIT",
  "STOP_LOSS_HIT",
  "TRAILING_STOP_HIT",
  "BREAKEVEN_STOP_HIT",
  "MAX_HOLD_TIME",
  "MARGIN_STOP_OUT",
  "DAILY_LOSS_LIMIT",
  "MAX_DRAWDOWN_LIMIT",
  "MAX_CONCURRENT_LOTS_LIMIT",
  "MAX_CONCURRENT_TRADES_LIMIT",
  "SYMBOL_DISABLED",
  "ACCOUNT_FROZEN",
  "CANCELED_BY_USER",
  "ORDER_REJECTED",
  "ADMIN_CLOSE",
  "SYSTEM_CLOSE",
];

/**
 * Map of close reason codes that are "position closes" vs "order-state" changes.
 * Useful for filtering in different views.
 */
export const POSITION_CLOSE_REASONS: CloseReasonCode[] = [
  "MANUAL_CLOSE",
  "PARTIAL_CLOSE",
  "STOP_LOSS_HIT",
  "TAKE_PROFIT_HIT",
  "TRAILING_STOP_HIT",
  "BREAKEVEN_STOP_HIT",
  "MAX_HOLD_TIME",
  "MARGIN_STOP_OUT",
  "DAILY_LOSS_LIMIT",
  "MAX_DRAWDOWN_LIMIT",
  "MAX_CONCURRENT_LOTS_LIMIT",
  "MAX_CONCURRENT_TRADES_LIMIT",
  "SYMBOL_DISABLED",
  "ACCOUNT_FROZEN",
  "MARKET_CLOSED",
  "MARKET_HALTED",
  "PRICE_UNAVAILABLE",
  "SYSTEM_MAINTENANCE",
  "ADMIN_CLOSE",
  "SYSTEM_CLOSE",
];

export const ORDER_STATE_REASONS: CloseReasonCode[] = [
  "CANCELED_BY_USER",
  "EXPIRED_PENDING_ORDER",
  "ORDER_REJECTED",
];
