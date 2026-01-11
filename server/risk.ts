import { storage } from './storage';
import { Request, Response, NextFunction } from 'express';
import dayjs from 'dayjs';
import { Trade, globalSettings, systemConfig, symbolConfigs } from '@shared/schema';
import { db } from "@db";
import { eq } from "drizzle-orm";
import { getLatestQuoteRow } from './services/quoteService';

/**
 * Risk management middleware for the TradeQuip platform
 * Enforces risk limits dynamically from global_settings:
 * - Max concurrent trades per user (OPEN + PENDING)
 * - Max concurrent trades per instrument (OPEN + PENDING)
 * - Max concurrent lots across all active trades (OPEN + PENDING)
 * - Daily loss limit (configurable %)
 * - Lifetime loss limit (configurable %, disables account if hit)
 */

const INITIAL_BALANCE_USD = 1_000_000;

const DEFAULTS = {
  maxTradesPerUser: 10,
  maxTradesPerInstrument: 3,
  maxConcurrentLots: 50,
  dailyLossLimitPct: 10,
  lifetimeLossLimitPct: 20,
  enableLossLimits: true,
  minHoldSec: 60,
};

async function getGlobalSettings() {
  const gs = await db.query.globalSettings.findFirst({
    where: eq(globalSettings.id, 1),
  });
  return gs ?? null;
}

async function getSystemConfig() {
  const sc = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  });
  return sc ?? null;
}

/**
 * Checks if trading is allowed based on configured market hours.
 * NOTE: All times are interpreted as UTC. Admin should configure times in UTC format.
 * Example: For US Eastern (EST = UTC-5), if markets open 9:30 AM EST, configure "14:30".
 */
function checkMarketHours(gs: any): { allowed: boolean; reason: string } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 6 = Saturday (use UTC day)
  
  // Check weekend trading
  const allowWeekendTrading = gs?.allowWeekendTrading ?? true;
  if (!allowWeekendTrading && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return { 
      allowed: false, 
      reason: "Weekend trading is disabled. Markets open Monday." 
    };
  }
  
  // Check market hours (configured as UTC)
  const marketOpenTime = gs?.marketOpenTime ?? "00:00";
  const marketCloseTime = gs?.marketCloseTime ?? "23:59";
  
  // Parse times
  const [openHour, openMin] = marketOpenTime.split(":").map(Number);
  const [closeHour, closeMin] = marketCloseTime.split(":").map(Number);
  
  const currentHour = now.getUTCHours();
  const currentMin = now.getUTCMinutes();
  const currentTime = currentHour * 60 + currentMin;
  const openTime = openHour * 60 + openMin;
  const closeTime = closeHour * 60 + closeMin;
  
  // Handle overnight markets (close time < open time means next day)
  let isWithinHours: boolean;
  if (closeTime < openTime) {
    // Overnight market: open at e.g. 22:00, close at 21:00 next day
    isWithinHours = currentTime >= openTime || currentTime < closeTime;
  } else {
    // Normal hours: open at e.g. 08:00, close at 17:00
    isWithinHours = currentTime >= openTime && currentTime < closeTime;
  }
  
  if (!isWithinHours) {
    return { 
      allowed: false, 
      reason: `Trading is only available between ${marketOpenTime} and ${marketCloseTime} UTC.` 
    };
  }
  
  return { allowed: true, reason: "" };
}

async function getEffectiveLimits(userId: number) {
  const gs = await getGlobalSettings();
  const us = await storage.getUserSettingsById(userId);

  const gMaxTradesPerUser = Number(gs?.maxTradesPerUser ?? DEFAULTS.maxTradesPerUser);
  const gMaxTradesPerInstrument = Number(gs?.maxTradesPerInstrument ?? DEFAULTS.maxTradesPerInstrument);
  const gMaxConcurrentLots = Number(gs?.maxConcurrentLots ?? DEFAULTS.maxConcurrentLots);
  const gEnableLossLimits = gs?.enableLossLimits ?? DEFAULTS.enableLossLimits;
  const gDailyLossLimitPct = Number(gs?.dailyLossLimitPct ?? DEFAULTS.dailyLossLimitPct);
  const gLifetimeLossLimitPct = Number(gs?.lifetimeLossLimitPct ?? DEFAULTS.lifetimeLossLimitPct);

  // User overrides take precedence over global (can exceed global limits)
  const effectiveMaxTradesPerUser = Number(us?.maxConcurrent ?? gMaxTradesPerUser);
  const effectiveMaxConcurrentLots = Number(us?.maxConcurrentLots ?? gMaxConcurrentLots);
  const effectiveMaxTradesPerInstrument = Number(us?.maxConcurrentPerInstrument ?? gMaxTradesPerInstrument);

  return {
    maxTradesPerInstrument: effectiveMaxTradesPerInstrument,
    maxTradesPerUser: effectiveMaxTradesPerUser,
    maxConcurrentLots: effectiveMaxConcurrentLots,
    enableLossLimits: gEnableLossLimits,
    dailyLossLimitPct: gDailyLossLimitPct,
    lifetimeLossLimitPct: gLifetimeLossLimitPct,
  };
}

/**
 * Get effective minimum hold time in seconds for a user.
 * User-level override takes precedence over global default.
 */
export async function getEffectiveMinHoldSec(userId: number): Promise<number> {
  const gs = await getGlobalSettings();
  const us = await storage.getUserSettingsById(userId);

  const globalMinHoldSec = Number(gs?.minHoldSec ?? DEFAULTS.minHoldSec);
  
  // User override takes precedence (if set and > 0)
  if (us?.minHoldSec != null && Number(us.minHoldSec) > 0) {
    return Number(us.minHoldSec);
  }
  
  return globalMinHoldSec;
}

export async function riskMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = (req.session as any).userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await storage.getUserById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  // Block disabled accounts from opening new positions
  if ((user as any).isDisabled) {
    return res.status(403).json({ message: "Account is disabled." });
  }
  
  // Block frozen accounts from opening new positions
  if ((user as any).isFrozen) {
    return res.status(403).json({ 
      message: "Account is frozen. Trading is temporarily suspended.",
      reasonCode: (user as any).freezeReasonCode
    });
  }

  // Check system config controls (trading halt, close-only mode, etc.)
  const sysConfig = await getSystemConfig();
  
  // Trading halt - hard stop all new trades
  if (sysConfig?.tradingHalt) {
    return res.status(503).json({ 
      message: "Trading is temporarily halted. Please try again later." 
    });
  }
  
  // Close-only mode - prevent opening new positions
  if (sysConfig?.closeOnlyMode) {
    return res.status(403).json({ 
      message: "Platform is in close-only mode. New positions are not allowed." 
    });
  }
  
  // Maintenance mode - block trading for non-admins
  if (sysConfig?.maintenanceMode && !(user as any).isAdmin) {
    return res.status(503).json({ 
      message: sysConfig.maintenanceMessage || "System is under maintenance. Trading will resume shortly." 
    });
  }
  
  // Block open on stale quotes - check if the requested symbol's quote is stale
  if (sysConfig?.blockOpenOnStaleQuotes && req.body.symbolId) {
    const symId = Number(req.body.symbolId);
    // Look up symbol from symbolConfigs
    const symbolConfig = await db.query.symbolConfigs.findFirst({
      where: eq(symbolConfigs.id, symId),
    });
    
    if (symbolConfig) {
      const quoteRow = getLatestQuoteRow(symbolConfig.symbol);
      const staleThresholdMs = Number(sysConfig.staleThresholdMs ?? 30000);
      
      // No quote data at all - treat as stale
      if (!quoteRow) {
        return res.status(409).json({ 
          message: `Cannot open trade: no quote data available for ${symbolConfig.symbol}. Please wait for market data.`,
          symbol: symbolConfig.symbol,
          staleThresholdMs
        });
      }
      
      // Check staleness using configurable threshold (default 30000ms)
      const lastApiRaw = quoteRow.last_api_update ?? quoteRow.updated_at;
      
      // Missing or invalid timestamp - treat as stale
      if (lastApiRaw === null || lastApiRaw === undefined || !Number.isFinite(Number(lastApiRaw))) {
        return res.status(409).json({ 
          message: `Cannot open trade: quote data for ${symbolConfig.symbol} has no valid timestamp. Please wait for fresh market data.`,
          symbol: symbolConfig.symbol,
          staleThresholdMs
        });
      }
      
      const lastApiNum = Number(lastApiRaw);
      const lastApiMs = lastApiNum < 1e12 ? lastApiNum * 1000 : lastApiNum;
      const now = Date.now();
      const isStale = Number(quoteRow.is_stale ?? 0) === 1 || (now - lastApiMs) > staleThresholdMs;
      
      if (isStale) {
        return res.status(409).json({ 
          message: `Cannot open trade: quote data for ${symbolConfig.symbol} is stale. Please wait for fresh market data.`,
          symbol: symbolConfig.symbol,
          staleThresholdMs
        });
      }
    }
  }

  // Check market hours enforcement
  const gs = await getGlobalSettings();
  const marketHoursCheck = checkMarketHours(gs);
  if (!marketHoursCheck.allowed) {
    return res.status(403).json({ 
      message: marketHoursCheck.reason,
      marketOpen: gs?.marketOpenTime ?? "00:00",
      marketClose: gs?.marketCloseTime ?? "23:59",
      allowWeekendTrading: gs?.allowWeekendTrading ?? true
    });
  }

  const limits = await getEffectiveLimits(userId);

  // Get OPEN + PENDING trades (count both as "active/concurrent")
  const openTrades = await storage.getOpenTradesByUserId(userId);
  const pendingTrades = await storage.getPendingTradesByUserId(userId);
  const activeTrades = [...openTrades, ...pendingTrades];

  // 1. Check max concurrent trades per user (OPEN + PENDING)
  if (activeTrades.length >= limits.maxTradesPerUser) {
    return res.status(400).json({
      message: `Maximum ${limits.maxTradesPerUser} concurrent trades allowed (OPEN + PENDING).`,
      activeTrades: activeTrades.length,
      limit: limits.maxTradesPerUser,
    });
  }

  // 2. Check max concurrent trades per instrument (OPEN + PENDING)
  const symbolId = req.body.symbolId;
  if (symbolId) {
    const activePerSymbol = activeTrades.filter(t => Number(t.symbolId) === Number(symbolId)).length;
    if (activePerSymbol >= limits.maxTradesPerInstrument) {
      return res.status(400).json({
        message: `Maximum ${limits.maxTradesPerInstrument} concurrent trades allowed per instrument (OPEN + PENDING).`,
        symbolId,
        activePerSymbol,
        limit: limits.maxTradesPerInstrument,
      });
    }
  }

  // 3. Check max concurrent lots across ALL active trades (OPEN + PENDING)
  const requestedLots = Number(req.body.lots ?? req.body.size ?? 0);
  if (requestedLots > 0) {
    const currentLots = activeTrades.reduce((sum, t) => sum + Number((t as any).lots ?? 0), 0);
    if (currentLots + requestedLots > limits.maxConcurrentLots) {
      return res.status(409).json({
        message: `Maximum concurrent lots exceeded (OPEN + PENDING). Current=${currentLots}, Requested=${requestedLots}, Limit=${limits.maxConcurrentLots}.`,
        currentLots,
        requestedLots,
        limit: limits.maxConcurrentLots,
      });
    }
  }

  // 4. Check daily loss limit (only if enabled)
  if (limits.enableLossLimits) {
    const todayStart = dayjs().startOf('day').unix();
    const dailyTrades = await storage.getClosedTradesByDateRange(userId, todayStart);

    let dailyPnL = 0;
    dailyTrades.forEach((trade: Trade) => {
      if (trade.profit) {
        dailyPnL += parseFloat(trade.profit);
      }
    });

    const dailyLossPercent = dailyPnL < 0 ? Math.abs(dailyPnL) / INITIAL_BALANCE_USD * 100 : 0;

    if (dailyLossPercent >= limits.dailyLossLimitPct) {
      return res.status(403).json({
        message: `Daily loss limit of ${limits.dailyLossLimitPct}% reached. Try again tomorrow.`,
        dailyLossPercent,
        limit: limits.dailyLossLimitPct,
      });
    }

    // 5. Check lifetime loss limit
    const currentBalance = parseFloat(user.balance);
    const lifetimeLossPercent = (INITIAL_BALANCE_USD - currentBalance) / INITIAL_BALANCE_USD * 100;

    if (lifetimeLossPercent >= limits.lifetimeLossLimitPct) {
      await storage.disableUserAccount(userId);
      return res.status(403).json({
        message: `Lifetime loss limit of ${limits.lifetimeLossLimitPct}% reached. Account has been disabled.`,
        lifetimeLossPercent,
        limit: limits.lifetimeLossLimitPct,
      });
    }
  }

  // All risk checks passed
  next();
}
