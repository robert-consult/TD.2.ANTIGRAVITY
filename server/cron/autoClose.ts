/**
 * Auto-close service for the TradeQuip platform
 * Automatically closes trades based on admin-configurable settings from global_settings
 * Implements Option 1 (real quotes) + Option 2 (defer when market closed/stale)
 * 
 * Hedge-fund grade: Uses canonical close reason codes and writes full trade audits
 */

import dayjs from "dayjs";
import { storage } from "../storage";
import { log } from "../vite";
import { recalcAccount } from "../recalcAccount";
import { getExecutionQuote } from "../services/quoteService";
import { realizedPnlUsd } from "../lib/realizedPnl";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { globalSettings, trades } from "@shared/schema";
import { writeTradeAudit, generateCorrelationId, generateOrderId, generateExecutionId, generatePositionId, calculateSpreadPips } from "../lib/auditWriter";
import type { CloseReasonCode } from "@shared/closeReasons";
import { publishLiveEvent } from "../services/liveBus";

const STALE_DEFER_MAX_MIN = Number(process.env.AUTOCLOSE_STALE_DEFER_MAX_MIN ?? 60);
const ALLOW_STALE_CLOSE = String(process.env.AUTOCLOSE_ALLOW_STALE_CLOSE ?? "true") === "true";

async function getAutoCloseSettings() {
  const gs = await db.query.globalSettings.findFirst({
    where: eq(globalSettings.id, 1),
  });
  return {
    enableAutoClose: gs?.enableAutoClose ?? true,
    autoCloseAfterDays: Number(gs?.autoCloseAfterDays ?? 4),
    autoCloseCheckFrequencyMinutes: Number(gs?.autoCloseCheckFrequencyMinutes ?? 60),
  };
}

async function runAutoCloseJob() {
  try {
    const settings = await getAutoCloseSettings();

    if (!settings.enableAutoClose) {
      log("Auto-close is disabled in global settings");
      return;
    }

    log(`Running auto-close check for trades > ${settings.autoCloseAfterDays} days old`);

    const cutoffDate = dayjs().subtract(settings.autoCloseAfterDays, "days").unix();
    const oldTrades = await storage.getOldOpenTrades(cutoffDate);

    if (oldTrades.length === 0) {
      log("No trades need auto-closing");
      return;
    }

    log(`Found ${oldTrades.length} trades to auto-close`);

    for (const trade of oldTrades) {
      try {
        const symbolConfig = await storage.getSymbolConfigById(trade.symbolId);
        if (!symbolConfig) {
          log(`Could not find symbol for trade ID ${trade.id}`);
          continue;
        }

        let q;
        try {
          q = await getExecutionQuote(symbolConfig.symbol, trade.type as any, "CLOSE");
        } catch (quoteError) {
          log(`Quote not available for trade=${trade.id} symbol=${symbolConfig.symbol}: ${quoteError}`);
          continue;
        }

        if (!q.marketOpen) {
          log(`Auto-close deferred (market closed): trade=${trade.id} symbol=${q.symbol}`);
          continue;
        }

        if (q.isStale) {
          const ageMin = (Date.now() - q.quoteTs.getTime()) / 60000;
          if (ageMin <= STALE_DEFER_MAX_MIN) {
            log(`Auto-close deferred (stale quote ${ageMin.toFixed(1)}m): trade=${trade.id} symbol=${q.symbol}`);
            continue;
          }
          if (!ALLOW_STALE_CLOSE) {
            log(`Auto-close deferred (stale quote beyond max, stale-close disabled): trade=${trade.id} symbol=${q.symbol}`);
            continue;
          }
        }

        const openPrice = Number(trade.openPrice);
        const closePrice = q.execPrice;

        const lots = typeof trade.lots === "string" ? Number(trade.lots) : Number(trade.lots ?? 1);
        
        const pnlUsd = await realizedPnlUsd({
          symbol: q.symbol,
          side: trade.type as any,
          lots,
          openPrice,
          closePrice,
        });

        const profit = pnlUsd.toFixed(2);

        const closeReasonCode: CloseReasonCode = "MAX_HOLD_TIME";
        
        const closedTrade = await storage.closeTrade(trade.id, closePrice, profit, {
          closeReason: closeReasonCode,
          closeQuoteTs: q.quoteTs,
          closeSource: q.isStale ? `stale:${q.source}` : q.source,
          closeBid: q.bid,
          closeAsk: q.ask,
          closeMid: q.mid,
          closeSpread: q.spread,
        });

        // Write hedge-fund grade trade audit for auto-close
        try {
          const correlationId = (trade as any).correlationId || generateCorrelationId();
          const orderId = (trade as any).orderId || generateOrderId();
          const positionId = (trade as any).positionId || generatePositionId();
          const executionId = generateExecutionId();

          await db.update(trades)
            .set({
              correlationId,
              orderId,
              positionId,
              lastExecutionId: executionId,
              lastActorType: "SYSTEM",
              lastActorUserId: null,
              lastActorSessionId: null,
              lastActorIp: null,
              lastActorUserAgent: null,
            })
            .where(eq(trades.id, trade.id));
          
          await writeTradeAudit({
            tradeId: trade.id,
            eventType: "POSITION_CLOSED",
            eventCategory: "SYSTEM",
            ctx: {
              correlationId,
              actorType: "SYSTEM",
              actorUserId: null,
              sessionId: null,
              ip: null,
              userAgent: null,
            },
            orderId,
            executionId,
            positionId,
            symbol: symbolConfig.symbol,
            side: trade.type as string,
            qtyLots: lots,
            requestedPrice: closePrice,
            fillPrice: closePrice,
            avgFillPrice: closePrice,
            quoteBid: q.bid,
            quoteAsk: q.ask,
            quoteMid: q.mid,
            quoteSpread: q.spread,
            spreadPips: calculateSpreadPips(symbolConfig.symbol, q.spread),
            quoteTs: q.quoteTs,
            quoteSource: q.isStale ? `stale:${q.source}` : q.source,
            riskResult: "PASS",
            reasonCode: closeReasonCode,
            note: `Auto-closed: max hold time exceeded (${settings.autoCloseAfterDays} days). P/L: ${profit}`,
            payload: {
              closeReason: closeReasonCode,
              profit,
              openPrice,
              closePrice,
              autoCloseAfterDays: settings.autoCloseAfterDays,
              isStaleQuote: q.isStale,
            },
          });
        } catch (auditErr) {
          log(`Error writing auto-close audit for trade=${trade.id}: ${auditErr}`);
        }

        const user = await storage.getUserById(trade.userId);
        if (user) {
          const newBalance = (Number(user.balance) + Number(closedTrade.profit ?? profit)).toFixed(2);
          await storage.updateUserBalance(trade.userId, newBalance);
          await recalcAccount(trade.userId, { emit: true, reason: "AUTO_CLOSE" });
        }

        log(`Auto-closed trade=${trade.id} reason=${closeReasonCode} profit=${profit} symbol=${q.symbol} stale=${q.isStale}`);
        publishLiveEvent({
          type: "trades:updated",
          userId: trade.userId,
          payload: { reason: closeReasonCode, tradeId: trade.id },
        });
      } catch (e) {
        log(`Error auto-closing trade=${trade.id}: ${e}`);
      }
    }

    log("Auto-close job completed successfully");
  } catch (e) {
    log(`Error in auto-close job: ${e}`);
  }
}

// Schedule recurring job (default: every 60 minutes, configured via global_settings)
let currentIntervalId: ReturnType<typeof setInterval> | null = null;

export async function scheduleAutoClose() {
  const settings = await getAutoCloseSettings();
  const intervalMs = settings.autoCloseCheckFrequencyMinutes * 60 * 1000;

  if (currentIntervalId) {
    clearInterval(currentIntervalId);
  }

  log(`Auto-close scheduled to run every ${settings.autoCloseCheckFrequencyMinutes} minutes`);
  currentIntervalId = setInterval(runAutoCloseJob, intervalMs);
}

// Initialize the schedule
scheduleAutoClose();
