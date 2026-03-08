import dayjs from "dayjs";
import { log } from "../vite";
import { recalcAccount } from "../recalcAccount";
import { getExecutionQuote } from "../services/quoteService";
import { realizedPnlUsd } from "../lib/realizedPnl";
import { requiredMargin } from "../lib/margin";
import { db } from "@db";
import { and, eq, sql } from "drizzle-orm";
import { globalSettings, trades } from "@shared/schema";
import { writeTradeAudit, generateCorrelationId, generateOrderId, generateExecutionId, generatePositionId, calculateSpreadPips } from "../lib/auditWriter";
import type { CloseReasonCode } from "@shared/closeReasons";
import { onLiveEvent, publishLiveEvent } from "../services/liveBus";
import { applyUserBalanceDelta, releaseUserMargin } from "../services/tradeAtomic";
import { createNotification } from "../services/messaging";
import { computeCloseSettlementCosts } from "../services/tradeCosts";
import { clearTradeExcursion, resolveTradeExcursionForCloseDurable } from "../trades/excursionTracking";

// Hardcoded default if missing from schema mapping, ensuring safety priority.
const MARGIN_STOP_OUT_THRESHOLD = Number(process.env.MARGIN_STOP_OUT_PCT ?? 50);
// 15 seconds polling interval for live risk
const MARGIN_CHECK_INTERVAL_MS = 15000;

async function runMarginCallJob() {
    try {
        // 1. Find users with open trades
        const openTradeUsersQuery = await db.execute(sql`
      SELECT DISTINCT user_id 
      FROM trades 
      WHERE status = 'OPEN'
    `);
        const activeUserIds = openTradeUsersQuery.rows.map(r => Number(r.user_id));

        if (activeUserIds.length === 0) {
            return;
        }

        log(`[MarginCall] Checking margin levels for ${activeUserIds.length} active users`);

        for (const userId of activeUserIds) {
            try {
                // Calculate live floating PnL and active marginLevel using Valkey latest quotes
                const recalcResult = await recalcAccount(userId, { emit: false });

                if (!recalcResult) continue;
                if (recalcResult.pricingStale) {
                    log(`[MarginCall] Skipping user ${userId} due to stale pricing metrics.`);
                    continue;
                }

                const { marginLevel, openPositions } = recalcResult;

                // No margin requirement or no positions = safe.
                if (openPositions === 0 || marginLevel === null) continue;

                // MARGIN CALL LIQUIDATION TRIGGER: Equity / Used Margin < Threshold %
                if (marginLevel <= MARGIN_STOP_OUT_THRESHOLD) {
                    log(`🚨 [MarginCall] LIQUIDATING User ${userId}: Margin Level ${marginLevel.toFixed(2)}% <= Stop Out Level ${MARGIN_STOP_OUT_THRESHOLD}%`);

                    // Fetch user's open trades to liquidate
                    const userTradesToLiquidate = await db.query.trades.findMany({
                        where: and(
                            eq(trades.userId, userId),
                            eq(trades.status, "OPEN")
                        ),
                        with: { symbol: true }
                    });

                    // Liquidate Largest Losing Positions First? For this MVP, we liquidate ALL open positions sequentially.
                    for (const trade of userTradesToLiquidate) {
                        try {
                            const symbolConfig = trade.symbol;
                            if (!symbolConfig) continue;

                            // Safely attempt to fetch current execution quote to close out trade
                            let q;
                            try {
                                q = await getExecutionQuote(symbolConfig.symbol, trade.type as any, "CLOSE");
                            } catch (quoteError) {
                                log(`[MarginCall] Quote not available for trade=${trade.id} symbol=${symbolConfig.symbol}: ${quoteError}`);
                                continue;
                            }

                            if (!q.marketOpen) {
                                log(`[MarginCall] Deferred (market closed): trade=${trade.id} symbol=${q.symbol}`);
                                continue;
                            }
                            // Even if quote is "stale" from spread source perspective, during a Margin Call we may need to force a close if enabled
                            // Defaulting to only liquidating on fresh pricing to prevent slippage anomalies on API outages.
                            if (q.isStale && String(process.env.AUTOCLOSE_ALLOW_STALE_CLOSE ?? "false") !== "true") {
                                log(`[MarginCall] Deferred stale quote during liquidation for trade=${trade.id}.`);
                                continue;
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

                            const closeCostSummary = await computeCloseSettlementCosts({
                                category: trade.categorySnapshot ?? symbolConfig.category,
                                positionSide: trade.type as "BUY" | "SELL",
                                notionalUsd: trade.notionalUsd,
                                size: Number(trade.size ?? lots * 100000),
                                lots,
                                openedAt: trade.openedAt,
                                executedAt: trade.executedAt,
                                closedAtMs: q.quoteTs.getTime(),
                                openCommissionUsd: trade.openCommissionUsd,
                                openOtherFeesUsd: trade.openOtherFeesUsd,
                            });

                            const grossProfitUsd = pnlUsd;
                            const netProfitUsd = grossProfitUsd - closeCostSummary.totalCostsUsd;
                            const closeSettlementUsd = grossProfitUsd - closeCostSummary.closingChargesUsd;
                            const profit = netProfitUsd.toFixed(2);

                            const excursion = await resolveTradeExcursionForCloseDurable({
                                tradeId: trade.id,
                                side: trade.type as "BUY" | "SELL",
                                openPrice,
                                closePrice,
                                intradayHigh: trade.intradayHigh,
                                intradayLow: trade.intradayLow,
                            });

                            const closeReasonCode: CloseReasonCode = "MARGIN_STOP_OUT";
                            const closeSource = q.isStale ? `stale:${q.source}` : q.source;

                            const closeResult = await db.transaction(async (tx) => {
                                const tradeLock = await tx.execute(sql`
                  select id from trades where id = ${trade.id} and status = 'OPEN' for update
                `);
                                if (!tradeLock.rows.length) return null;

                                const userRowRes = await tx.execute(sql`
                  select id, leverage from users where id = ${trade.userId} for update
                `);
                                const leverageNow = Number((userRowRes.rows[0] as any)?.leverage ?? 5);
                                const marginToRelease = requiredMargin(q.symbol, lots, closePrice, leverageNow);

                                const correlationId = trade.correlationId || generateCorrelationId();
                                const orderId = trade.orderId || generateOrderId();
                                const positionId = trade.positionId || generatePositionId();
                                const executionId = generateExecutionId();
                                const closedAt = Math.floor(Date.now() / 1000);

                                const closedRows = await tx.update(trades)
                                    .set({
                                        status: "CLOSED",
                                        closePrice,
                                        profit,
                                        grossProfitUsd,
                                        netProfitUsd,
                                        intradayHigh: excursion.intradayHigh,
                                        intradayLow: excursion.intradayLow,
                                        mae: excursion.mae,
                                        mfe: excursion.mfe,
                                        notionalUsd: closeCostSummary.notionalUsd,
                                        totalCostsUsd: closeCostSummary.totalCostsUsd,
                                        closeCommissionUsd: closeCostSummary.closeCommissionUsd,
                                        closeOtherFeesUsd: closeCostSummary.closeOtherFeesUsd,
                                        financingAccruedUsd: closeCostSummary.financingAccruedUsd,
                                        swapAccruedUsd: closeCostSummary.swapAccruedUsd,
                                        overnightDays: closeCostSummary.overnightDays,
                                        categorySnapshot: closeCostSummary.categorySnapshot,
                                        costModelVersion: closeCostSummary.costModelVersion,
                                        closeReason: closeReasonCode,
                                        closedAt,
                                        closeQuoteTs: Math.floor(q.quoteTs.getTime() / 1000),
                                        closeSource,
                                        closeBid: q.bid,
                                        closeAsk: q.ask,
                                        closeMid: q.mid,
                                        closeSpread: q.spread,
                                        correlationId,
                                        orderId,
                                        positionId,
                                        lastExecutionId: executionId,
                                        lastActorType: "SYSTEM",
                                    })
                                    .where(and(eq(trades.id, trade.id), eq(trades.status, "OPEN")))
                                    .returning();

                                const closedTrade = closedRows[0];
                                if (!closedTrade) return null;

                                await applyUserBalanceDelta(tx, { userId: trade.userId, deltaUsd: closeSettlementUsd });
                                await releaseUserMargin(tx, { userId: trade.userId, marginUsd: marginToRelease });

                                await writeTradeAudit({
                                    tradeId: trade.id,
                                    eventType: "POSITION_CLOSED",
                                    eventCategory: "SYSTEM",
                                    ctx: { correlationId, actorType: "SYSTEM", actorUserId: null, sessionId: null, ip: null, userAgent: null },
                                    orderId, executionId, positionId, symbol: symbolConfig.symbol, side: trade.type as string,
                                    qtyLots: lots, requestedPrice: closePrice, fillPrice: closePrice, avgFillPrice: closePrice,
                                    quoteBid: q.bid, quoteAsk: q.ask, quoteMid: q.mid, quoteSpread: q.spread,
                                    spreadPips: calculateSpreadPips(symbolConfig.symbol, q.spread, symbolConfig.pipDecimals),
                                    quoteTs: q.quoteTs, quoteSource: closeSource, riskResult: "PASS", reasonCode: closeReasonCode,
                                    note: `Stop Out Auto-closed: Margin level ${marginLevel.toFixed(2)}% below ${MARGIN_STOP_OUT_THRESHOLD}%`,
                                    payload: {
                                        closeReason: closeReasonCode, grossProfitUsd, netProfitUsd, balanceDeltaUsd: closeSettlementUsd, marginLevelAtClose: marginLevel
                                    },
                                }, { db: tx });

                                return { closedTrade, closeReasonCode };
                            });

                            if (!closeResult) continue;

                            clearTradeExcursion(trade.id);
                            await recalcAccount(trade.userId, { emit: true, reason: "MARGIN_STOP_OUT" });

                            log(`[MarginCall] Liquidated trade=${trade.id} loss=${profit} symbol=${q.symbol}`);
                            publishLiveEvent({
                                type: "trades:updated",
                                userId: trade.userId,
                                payload: { reason: closeReasonCode, tradeId: trade.id },
                            });

                            void createNotification({
                                userId: trade.userId,
                                type: "TRADE",
                                severity: "CRITICAL",
                                title: "POSITION LIQUIDATED - MARGIN CALL",
                                message: `${q.symbol} position was liquidated because your margin level dropped beneath ${MARGIN_STOP_OUT_THRESHOLD}%.`,
                                sourceEvent: `${closeReasonCode}:${trade.id}:${Math.floor(Date.now() / 1000)}`,
                                link: "/",
                                playSound: true,
                            }).catch((e) => log(`[notifications] failed to create margin-call note: ${e}`));

                        } catch (e) {
                            log(`[MarginCall] Error liquidating trade=${trade.id}: ${e}`);
                        }
                    }
                }
            } catch (e) {
                log(`[MarginCall] Error recalculating user=${userId}: ${e}`);
            }
        }
    } catch (e) {
        log(`[MarginCall] Error in scheduler loop: ${e}`);
    }
}

let currentIntervalId: ReturnType<typeof setInterval> | null = null;
let started = false;

export async function startMarginCallScheduler(): Promise<void> {
    if (started) return;
    started = true;

    log(`Starting Margin Call (Stop Out) Scheduler. Checking every ${MARGIN_CHECK_INTERVAL_MS}ms`);
    currentIntervalId = setInterval(runMarginCallJob, MARGIN_CHECK_INTERVAL_MS);
}
