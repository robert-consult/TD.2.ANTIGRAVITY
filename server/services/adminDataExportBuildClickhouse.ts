import {
  canonicalizeInstrumentCategory,
  normalizeInstrumentCategory,
} from "@shared/instruments/categories";
import type {
  DeactivatedAccountsExportFilters,
  TraderScoutingExportFilters,
} from "@shared/admin/dataExports";
import { queryClickHouseJson } from "./clickhouseClient";

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeCategories(raw: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const rawCategory of raw || []) {
    const canonical = canonicalizeInstrumentCategory(String(rawCategory || ""));
    if (!canonical) continue;
    out.add(normalizeInstrumentCategory(canonical, "unknown"));
  }
  return Array.from(out.values());
}

export async function queryAllTradesFromClickHouse(limit: number): Promise<any[] | null> {
  const rows = await queryClickHouseJson<any>({
    query: `
      SELECT
        id,
        user_id AS user_id,
        username,
        symbol,
        side AS type,
        status,
        lots,
        open_price AS open_price,
        close_price AS close_price,
        opened_at AS opened_at,
        closed_at AS closed_at,
        net_profit_usd AS net_profit_usd
      FROM admin_trades FINAL
      ORDER BY opened_at DESC, id DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      limit: Math.max(1, Math.min(5_000_000, Math.trunc(limit || 50_000))),
    },
  });

  if (!rows) return null;
  return rows;
}

export async function queryDailyPnlFromClickHouse(limitDays: number): Promise<any[] | null> {
  const rows = await queryClickHouseJson<any>({
    query: `
      SELECT
        date,
        sum(profit_day) AS total_profit,
        sum(trades_closed) AS total_trades,
        sum(trades_won) AS winning_trades,
        uniqExact(user_id) AS active_users
      FROM admin_daily_closes
      GROUP BY date
      ORDER BY date DESC
      LIMIT {limitDays:UInt32}
    `,
    query_params: {
      limitDays: Math.max(1, Math.min(3650, Math.trunc(limitDays || 365))),
    },
  });

  if (!rows) return null;
  return rows;
}

export async function queryDeactivatedAccountsFromClickHouse(params: {
  filters: DeactivatedAccountsExportFilters;
  maxUsers: number;
  includeTrades: boolean;
}): Promise<{
  users: any[];
  tradesByUser: Map<number, any[]>;
  truncated: boolean;
} | null> {
  const days = Math.max(0, Math.trunc(params.filters.days ?? 0));
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = days > 0 ? nowSec - days * 86400 : 0;
  const limit = Math.max(1, Math.trunc(params.maxUsers + 1));

  const userRows = await queryClickHouseJson<any>({
    query: `
      WITH latest AS (
        SELECT
          user_id AS user_id,
          argMax(event_type, created_at) AS event_type,
          argMax(reason_code, created_at) AS reason_code,
          argMax(reason_text, created_at) AS reason_text,
          max(created_at) AS action_at
        FROM admin_user_account_events
        WHERE event_type IN ('ACCOUNT_SELF_DEACTIVATED', 'ACCOUNT_SELF_DELETED')
          AND ({applyCutoff:UInt8} = 0 OR created_at >= {cutoff:UInt32})
        GROUP BY user_id
      ),
      trade_stats AS (
        SELECT
          user_id,
          countIf(status = 'CLOSED') AS closed_trades,
          sumIf(net_profit_usd, status = 'CLOSED') AS profit,
          countIf(status = 'CLOSED' AND net_profit_usd > 0) AS winning_trades
        FROM admin_trades FINAL
        GROUP BY user_id
      )
      SELECT
        l.user_id AS user_id,
        u.username AS username,
        u.email AS email,
        l.event_type AS event_type,
        l.reason_code AS reason_code,
        l.reason_text AS reason_text,
        l.action_at AS action_at,
        ifNull(ts.profit, 0) AS profit,
        ifNull(ts.closed_trades, 0) AS trades,
        if(
          ifNull(ts.closed_trades, 0) > 0,
          round((ifNull(ts.winning_trades, 0) / ts.closed_trades) * 100, 2),
          0
        ) AS win_rate
      FROM latest l
      LEFT JOIN admin_users FINAL u ON u.id = l.user_id
      LEFT JOIN trade_stats ts ON ts.user_id = l.user_id
      ORDER BY l.action_at DESC
      LIMIT {limitRows:UInt32}
    `,
    query_params: {
      applyCutoff: cutoff > 0 ? 1 : 0,
      cutoff,
      limitRows: Math.max(1, Math.trunc(limit)),
    },
  });

  if (!userRows) return null;
  const truncated = userRows.length > params.maxUsers;
  const users = truncated ? userRows.slice(0, params.maxUsers) : userRows;

  const tradesByUser = new Map<number, any[]>();
  if (params.includeTrades && users.length > 0) {
    const userIds = users
      .map((row) => Math.max(0, Math.trunc(toFiniteNumber(row.user_id, 0))))
      .filter((id) => id > 0);
    if (userIds.length > 0) {
      const tradeRows = await queryClickHouseJson<any>({
        query: `
          SELECT
            id AS trade_id,
            user_id AS user_id,
            symbol,
            side AS type,
            status,
            lots,
            open_price AS open_price,
            close_price AS close_price,
            net_profit_usd AS net_profit_usd,
            total_costs_usd AS total_costs_usd,
            open_commission_usd AS open_commission_usd,
            close_commission_usd AS close_commission_usd,
            financing_accrued_usd AS financing_accrued_usd,
            swap_accrued_usd AS swap_accrued_usd,
            overnight_days AS overnight_days,
            opened_at AS opened_at,
            closed_at AS closed_at
          FROM admin_trades FINAL
          WHERE has({userIds:Array(UInt32)}, user_id)
          ORDER BY user_id ASC, opened_at DESC
        `,
        query_params: {
          userIds,
        },
      });

      if (tradeRows) {
        for (const row of tradeRows) {
          const userId = Math.max(0, Math.trunc(toFiniteNumber(row.user_id, 0)));
          if (!userId) continue;
          if (!tradesByUser.has(userId)) tradesByUser.set(userId, []);
          tradesByUser.get(userId)!.push({
            tradeId: toFiniteNumber(row.trade_id, 0),
            userId,
            symbol: row.symbol == null ? null : String(row.symbol),
            type: row.type == null ? null : String(row.type),
            status: row.status == null ? null : String(row.status),
            lots: row.lots == null ? null : toFiniteNumber(row.lots, 0),
            openPrice: row.open_price == null ? null : toFiniteNumber(row.open_price, 0),
            closePrice: row.close_price == null ? null : toFiniteNumber(row.close_price, 0),
            netProfitUsd: row.net_profit_usd == null ? null : toFiniteNumber(row.net_profit_usd, 0),
            totalCostsUsd: row.total_costs_usd == null ? null : toFiniteNumber(row.total_costs_usd, 0),
            openCommissionUsd:
              row.open_commission_usd == null ? null : toFiniteNumber(row.open_commission_usd, 0),
            closeCommissionUsd:
              row.close_commission_usd == null ? null : toFiniteNumber(row.close_commission_usd, 0),
            financingAccruedUsd:
              row.financing_accrued_usd == null ? null : toFiniteNumber(row.financing_accrued_usd, 0),
            swapAccruedUsd:
              row.swap_accrued_usd == null ? null : toFiniteNumber(row.swap_accrued_usd, 0),
            overnightDays: row.overnight_days == null ? null : toFiniteNumber(row.overnight_days, 0),
            openedAt: row.opened_at == null ? null : toFiniteNumber(row.opened_at, 0),
            closedAt: row.closed_at == null ? null : toFiniteNumber(row.closed_at, 0),
          });
        }
      }
    }
  }

  return {
    users,
    tradesByUser,
    truncated,
  };
}

export async function queryTraderScoutingFromClickHouse(params: {
  filters: TraderScoutingExportFilters;
  cutoffSec: number;
  exportLimit: number;
}): Promise<{ rows: any[]; truncated: boolean } | null> {
  const filters = params.filters;
  const categories = normalizeCategories(filters.categories);
  const q = String(filters.q || "").trim().slice(0, 200);
  const limitRows = Math.max(1, Math.min(200_000, Math.trunc(params.exportLimit + 1)));

  const rows = await queryClickHouseJson<any>({
    query: `
      WITH ft AS (
        SELECT
          t.user_id AS user_id,
          t.opened_at AS opened_at,
          t.closed_at AS closed_at,
          t.net_profit_usd AS profit,
          t.stop_loss AS stop_loss,
          t.take_profit AS take_profit,
          lower(if(t.category = '', 'unknown', t.category)) AS category
        FROM admin_trades FINAL t
        INNER JOIN admin_users FINAL u ON u.id = t.user_id
        WHERE t.status = 'CLOSED'
          AND t.closed_at > 0
          AND t.closed_at >= {cutoffSec:UInt32}
          AND u.is_admin = 0
          AND ({applyCategories:UInt8} = 0 OR has({categories:Array(String)}, category))
          AND (
            {applySearch:UInt8} = 0
            OR positionCaseInsensitiveUTF8(u.username, {searchQ:String}) > 0
            OR positionCaseInsensitiveUTF8(u.email, {searchQ:String}) > 0
          )
      ),
      agg AS (
        SELECT
          user_id,
          count() AS trades,
          sum(profit) AS net_profit,
          sumIf(profit, profit > 0) AS gross_profit,
          sumIf(profit, profit < 0) AS gross_loss,
          if(count() = 0, 0, sum(if(profit > 0, 1, 0)) / count()) AS win_rate,
          avg(closed_at - opened_at) AS avg_hold_sec,
          max(closed_at - opened_at) AS max_hold_sec,
          min(closed_at - opened_at) AS min_hold_sec,
          if(count() = 0, 0, sum(isNotNull(stop_loss)) / count()) AS sl_usage,
          if(count() = 0, 0, sum(isNotNull(take_profit)) / count()) AS tp_usage
        FROM ft
        GROUP BY user_id
        HAVING trades >= {minTrades:UInt32}
      ),
      candidates AS (
        SELECT
          *,
          if(
            abs(gross_loss) < 0.0001,
            if(gross_profit > 0, 999.0, CAST(NULL, 'Nullable(Float64)')),
            gross_profit / abs(gross_loss)
          ) AS profit_factor
        FROM agg
        WHERE ({applyMinWinRate:UInt8} = 0 OR win_rate >= {minWinRate:Float64})
          AND ({applyMinNetProfit:UInt8} = 0 OR net_profit >= {minNetProfit:Float64})
          AND ({applyMinHold:UInt8} = 0 OR avg_hold_sec >= {minHoldSec:Float64})
          AND ({applyMaxHold:UInt8} = 0 OR avg_hold_sec <= {maxHoldSec:Float64})
          AND ({applyMinSlUsage:UInt8} = 0 OR sl_usage >= {minSlUsage:Float64})
          AND ({applyMinTpUsage:UInt8} = 0 OR tp_usage >= {minTpUsage:Float64})
      ),
      candidates2 AS (
        SELECT *
        FROM candidates
        WHERE ({applyMinProfitFactor:UInt8} = 0 OR (isNotNull(profit_factor) AND profit_factor >= {minProfitFactor:Float64}))
      ),
      day_pnl AS (
        SELECT
          ft.user_id AS user_id,
          toDate(toDateTime(ft.closed_at)) AS day,
          sum(ft.profit) AS pnl
        FROM ft
        INNER JOIN candidates2 c ON c.user_id = ft.user_id
        GROUP BY ft.user_id, day
      ),
      day_equity AS (
        SELECT
          dp.user_id,
          dp.day,
          sum(dp.pnl) OVER (
            PARTITION BY dp.user_id
            ORDER BY dp.day ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cum_pnl
        FROM day_pnl dp
      ),
      day_equity2 AS (
        SELECT
          de.user_id,
          de.day,
          de.cum_pnl,
          max(de.cum_pnl) OVER (
            PARTITION BY de.user_id
            ORDER BY de.day ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS peak_cum_pnl
        FROM day_equity de
      ),
      dd AS (
        SELECT
          de.user_id,
          max(
            if(
              (u.starting_equity + de.peak_cum_pnl) <= 0,
              CAST(NULL, 'Nullable(Float64)'),
              (de.peak_cum_pnl - de.cum_pnl) / nullIf((u.starting_equity + de.peak_cum_pnl), 0)
            )
          ) AS max_drawdown
        FROM day_equity2 de
        INNER JOIN admin_users FINAL u ON u.id = de.user_id
        GROUP BY de.user_id
      ),
      best_day AS (
        SELECT
          user_id,
          max(pnl) AS best_day_pnl,
          sum(pnl) AS total_pnl
        FROM day_pnl
        GROUP BY user_id
      ),
      best_day_pct AS (
        SELECT
          user_id,
          if(total_pnl > 0, best_day_pnl / total_pnl, CAST(NULL, 'Nullable(Float64)')) AS best_day_pct
        FROM best_day
      ),
      mix AS (
        SELECT
          ft.user_id AS user_id,
          ft.category AS category,
          count() AS trades
        FROM ft
        INNER JOIN candidates2 c ON c.user_id = ft.user_id
        GROUP BY ft.user_id, ft.category
      ),
      mix_totals AS (
        SELECT
          user_id,
          sum(trades) AS total_trades
        FROM mix
        GROUP BY user_id
      ),
      mix_fraction AS (
        SELECT
          m.user_id AS user_id,
          m.category AS category,
          if(mt.total_trades = 0, 0.0, m.trades / mt.total_trades) AS fraction
        FROM mix m
        INNER JOIN mix_totals mt ON mt.user_id = m.user_id
      ),
      mix_json AS (
        SELECT
          user_id,
          toJSONString(mapFromArrays(groupArray(category), groupArray(fraction))) AS asset_mix
        FROM mix_fraction
        GROUP BY user_id
      )
      SELECT
        u.id AS user_id,
        u.username AS username,
        u.email AS email,
        c.trades AS trades,
        c.win_rate AS win_rate,
        c.net_profit AS net_profit,
        c.gross_profit AS gross_profit,
        c.gross_loss AS gross_loss,
        c.profit_factor AS profit_factor,
        c.avg_hold_sec AS avg_hold_sec,
        c.max_hold_sec AS max_hold_sec,
        c.min_hold_sec AS min_hold_sec,
        d.max_drawdown AS max_drawdown,
        b.best_day_pct AS best_day_pct,
        c.sl_usage AS sl_usage,
        c.tp_usage AS tp_usage,
        mj.asset_mix AS asset_mix
      FROM candidates2 c
      INNER JOIN admin_users FINAL u ON u.id = c.user_id
      LEFT JOIN dd d ON d.user_id = c.user_id
      LEFT JOIN best_day_pct b ON b.user_id = c.user_id
      LEFT JOIN mix_json mj ON mj.user_id = c.user_id
      WHERE ({applyMaxDrawdown:UInt8} = 0 OR (isNotNull(d.max_drawdown) AND d.max_drawdown <= {maxDrawdown:Float64}))
        AND ({applyMaxBestDayPct:UInt8} = 0 OR (isNotNull(b.best_day_pct) AND b.best_day_pct <= {maxBestDayPct:Float64}))
      ORDER BY c.net_profit DESC, c.trades DESC, u.id ASC
      LIMIT {limitRows:UInt32}
    `,
    query_params: {
      cutoffSec: Math.max(0, Math.trunc(params.cutoffSec || 0)),
      applyCategories: categories.length ? 1 : 0,
      categories,
      applySearch: q.length ? 1 : 0,
      searchQ: q,
      minTrades: Math.max(0, Math.trunc(filters.minTrades ?? 0)),
      applyMinWinRate: filters.minWinRate == null ? 0 : 1,
      minWinRate: toFiniteNumber(filters.minWinRate, 0),
      applyMinNetProfit: filters.minNetProfit == null ? 0 : 1,
      minNetProfit: toFiniteNumber(filters.minNetProfit, 0),
      applyMinHold: filters.minHoldSec == null ? 0 : 1,
      minHoldSec: toFiniteNumber(filters.minHoldSec, 0),
      applyMaxHold: filters.maxHoldSec == null ? 0 : 1,
      maxHoldSec: toFiniteNumber(filters.maxHoldSec, 0),
      applyMinSlUsage: filters.minSlUsage == null ? 0 : 1,
      minSlUsage: toFiniteNumber(filters.minSlUsage, 0),
      applyMinTpUsage: filters.minTpUsage == null ? 0 : 1,
      minTpUsage: toFiniteNumber(filters.minTpUsage, 0),
      applyMinProfitFactor: filters.minProfitFactor == null ? 0 : 1,
      minProfitFactor: toFiniteNumber(filters.minProfitFactor, 0),
      applyMaxDrawdown: filters.maxDrawdown == null ? 0 : 1,
      maxDrawdown: toFiniteNumber(filters.maxDrawdown, 0),
      applyMaxBestDayPct: filters.maxBestDayPct == null ? 0 : 1,
      maxBestDayPct: toFiniteNumber(filters.maxBestDayPct, 0),
      limitRows: limitRows,
    },
  });

  if (!rows) return null;
  const truncated = rows.length > Math.max(0, Math.trunc(params.exportLimit));
  const sliced = truncated ? rows.slice(0, params.exportLimit) : rows;
  return { rows: sliced, truncated };
}
