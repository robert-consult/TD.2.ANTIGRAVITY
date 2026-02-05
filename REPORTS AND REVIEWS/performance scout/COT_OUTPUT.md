# Trader Performance & Scouting - Final Output

## Overview
Implementation of the "Trader Scouting" feature for the Admin Dashboard, enabling filtering and analysis of trader performance based on institutional metrics (Drawdown, Win Rate, Asset Mix, Best Day %, etc.).

## 1. Database Schema Updates
**File:** `shared/schema.pg.ts`

Added provider metadata columns to `symbolConfigs` and ensured `jsonb` is imported.

```typescript
// Inserted into shared/schema.pg.ts within symbolConfigs table definition:

  // Provider metadata (used for analytics filters + Twelve Data symbol ingestion)
  assetClass: text("asset_class"), // fx | stock | etf | bond | crypto | commodity | index | mutual_fund | unknown
  exchange: text("exchange"),
  country: text("country"),
  currency: text("currency"),
  instrumentType: text("instrument_type"),
  provider: text("provider"),
  providerMeta: jsonb("provider_meta"),
```

## 2. Server Endpoints
**File:** `server/routes/admin.ts`

Added three new endpoints for analytics and drilling down into trader performance.

```typescript
  // TRADER SCOUTING (performance search + filters)
  // This is used by Admin > Data > Trader Scouting.
  // Note: trades.opened_at / closed_at are epoch seconds (int).
  app.get("/api/admin/trader-scouting/search", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = req.query.days ? Math.max(0, parseInt(req.query.days as string, 10)) : 30;
      const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const q = qRaw.length ? `%${qRaw}%` : null;

      const assetClassesRaw = typeof req.query.assetClasses === "string" ? req.query.assetClasses : "";
      const assetClasses = assetClassesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const minTrades = req.query.minTrades ? Math.max(0, parseInt(req.query.minTrades as string, 10)) : 10;
      const minWinRatePct = req.query.minWinRatePct ? Number(req.query.minWinRatePct) : null;
      const maxBestDayPct = req.query.maxBestDayPct ? Number(req.query.maxBestDayPct) : null;
      const maxDrawdown = req.query.maxDrawdown ? Number(req.query.maxDrawdown) : null;
      const minProfit = req.query.minProfit ? Number(req.query.minProfit) : null;
      const limit = req.query.limit ? Math.min(500, Math.max(1, parseInt(req.query.limit as string, 10))) : 200;

      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

      const sqlText = `
WITH ft AS (
  SELECT
    t.user_id,
    t.id AS trade_id,
    t.opened_at,
    t.closed_at,
    COALESCE(NULLIF(t.profit, '')::numeric, 0) AS profit,
    t.stop_loss,
    t.take_profit,
    COALESCE(NULLIF(sc.asset_class, ''), 'unknown') AS asset_class
  FROM trades t
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND ($1::int = 0 OR t.closed_at >= $1::int)
    AND ($2::text[] IS NULL OR COALESCE(NULLIF(sc.asset_class, ''), 'unknown') = ANY($2::text[]))
),
agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS trades,
    SUM(profit) AS net_profit,
    SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) AS gross_profit,
    SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END) AS gross_loss,
    (SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS win_rate,
    AVG((closed_at - opened_at)::float) AS avg_hold_sec,
    MAX((closed_at - opened_at)::float) AS max_hold_sec,
    MIN((closed_at - opened_at)::float) AS min_hold_sec,
    (SUM(CASE WHEN stop_loss IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS sl_usage,
    (SUM(CASE WHEN take_profit IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS tp_usage
  FROM ft
  GROUP BY user_id
),
equity AS (
  SELECT
    user_id,
    closed_at,
    trade_id,
    SUM(profit) OVER (PARTITION BY user_id ORDER BY closed_at, trade_id) AS cum_pnl
  FROM ft
),
dd_calc AS (
  SELECT
    user_id,
    (MAX(cum_pnl) OVER (
      PARTITION BY user_id
      ORDER BY closed_at, trade_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) - cum_pnl) AS dd
  FROM equity
),
dd AS (
  SELECT user_id, MAX(dd) AS max_drawdown
  FROM dd_calc
  GROUP BY user_id
),
day_pnl AS (
  SELECT
    user_id,
    date_trunc('day', to_timestamp(closed_at)) AS day,
    SUM(profit) AS pnl
  FROM ft
  GROUP BY user_id, day
),
best_day AS (
  SELECT
    user_id,
    MAX(pnl) AS best_day_pnl,
    SUM(pnl) AS total_pnl
  FROM day_pnl
  GROUP BY user_id
),
asset_mix AS (
  SELECT
    user_id,
    asset_class,
    COUNT(*)::int AS trades,
    SUM(profit) AS net_profit
  FROM ft
  GROUP BY user_id, asset_class
),
asset_json AS (
  SELECT
    user_id,
    jsonb_object_agg(
      asset_class,
      jsonb_build_object('trades', trades, 'netProfit', net_profit)
    ) AS asset_mix
  FROM asset_mix
  GROUP BY user_id
)
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  a.trades,
  a.win_rate,
  a.net_profit,
  a.gross_profit,
  a.gross_loss,
  (a.gross_profit / NULLIF(ABS(a.gross_loss), 0)) AS profit_factor,
  a.avg_hold_sec,
  a.max_hold_sec,
  a.min_hold_sec,
  COALESCE(d.max_drawdown, 0) AS max_drawdown,
  (bd.best_day_pnl / NULLIF(bd.total_pnl, 0)) AS best_day_pct,
  a.sl_usage,
  a.tp_usage,
  aj.asset_mix
FROM agg a
JOIN users u ON u.id = a.user_id
LEFT JOIN dd d ON d.user_id = a.user_id
LEFT JOIN best_day bd ON bd.user_id = a.user_id
LEFT JOIN asset_json aj ON aj.user_id = a.user_id
WHERE ($3::text IS NULL OR u.email ILIKE $3::text OR u.username ILIKE $3::text)
  AND a.trades >= $4::int
  AND ($5::float IS NULL OR (a.win_rate * 100.0) >= $5::float)
  AND ($6::float IS NULL OR COALESCE(d.max_drawdown, 0) <= $6::float)
  AND ($7::float IS NULL OR COALESCE(a.net_profit, 0) >= $7::float)
  AND ($8::float IS NULL OR (bd.best_day_pnl / NULLIF(bd.total_pnl, 0)) <= ($8::float / 100.0))
ORDER BY a.net_profit DESC
LIMIT $9::int;
      `;

      const params = [
        cutoffSec,
        assetClasses.length ? assetClasses : null,
        q,
        minTrades,
        Number.isFinite(minWinRatePct as any) ? minWinRatePct : null,
        Number.isFinite(maxDrawdown as any) ? maxDrawdown : null,
        Number.isFinite(minProfit as any) ? minProfit : null,
        Number.isFinite(maxBestDayPct as any) ? maxBestDayPct : null,
        limit,
      ];

      const rows = (await dbClient.query(sqlText, params)).rows;

      // Normalize numeric fields (node-postgres returns numerics as strings)
      const out = rows.map((r: any) => ({
        userId: Number(r.user_id),
        username: r.username ?? null,
        email: r.email ?? null,
        trades: Number(r.trades ?? 0),
        winRate: Number(r.win_rate ?? 0),
        netProfit: Number(r.net_profit ?? 0),
        grossProfit: Number(r.gross_profit ?? 0),
        grossLoss: Number(r.gross_loss ?? 0),
        profitFactor: r.profit_factor == null ? null : Number(r.profit_factor),
        avgHoldSec: Number(r.avg_hold_sec ?? 0),
        maxHoldSec: Number(r.max_hold_sec ?? 0),
        minHoldSec: Number(r.min_hold_sec ?? 0),
        maxDrawdown: Number(r.max_drawdown ?? 0),
        bestDayPct: r.best_day_pct == null ? null : Number(r.best_day_pct),
        slUsage: Number(r.sl_usage ?? 0),
        tpUsage: Number(r.tp_usage ?? 0),
        assetMix: r.asset_mix ?? null,
      }));

      res.json({ cutoffSec, days, count: out.length, rows: out });
    } catch (error) {
      console.error("Trader scouting search error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/trader-scouting/:userId/asset-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.userId), 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid userId" });

      const days = req.query.days ? Math.max(0, parseInt(req.query.days as string, 10)) : 30;
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

      const sqlText = `
SELECT
  COALESCE(NULLIF(sc.asset_class, ''), 'unknown') AS asset_class,
  COUNT(*)::int AS trades,
  SUM(COALESCE(NULLIF(t.profit, '')::numeric, 0)) AS net_profit,
  (SUM(CASE WHEN COALESCE(NULLIF(t.profit, '')::numeric, 0) > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS win_rate,
  AVG((t.closed_at - t.opened_at)::float) AS avg_hold_sec
FROM trades t
LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
WHERE t.user_id = $1::int
  AND t.status = 'CLOSED'
  AND t.closed_at IS NOT NULL
  AND ($2::int = 0 OR t.closed_at >= $2::int)
GROUP BY 1
ORDER BY net_profit DESC;
      `;

      const rows = (await dbClient.query(sqlText, [userId, cutoffSec])).rows.map((r: any) => ({
        assetClass: r.asset_class,
        trades: Number(r.trades ?? 0),
        netProfit: Number(r.net_profit ?? 0),
        winRate: Number(r.win_rate ?? 0),
        avgHoldSec: Number(r.avg_hold_sec ?? 0),
      }));

      res.json({ userId, days, cutoffSec, rows });
    } catch (error) {
      console.error("Trader scouting asset-class drilldown error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/trader-scouting/:userId/trade-extremes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.userId), 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid userId" });

      const days = req.query.days ? Math.max(0, parseInt(req.query.days as string, 10)) : 30;
      const limit = req.query.limit ? Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10))) : 20;
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

      const sqlText = `
WITH ft AS (
  SELECT
    t.id,
    sc.symbol,
    t.type,
    t.size,
    t.lots,
    t.open_price,
    t.close_price,
    t.stop_loss,
    t.take_profit,
    t.opened_at,
    t.closed_at,
    COALESCE(NULLIF(t.profit, '')::numeric, 0) AS profit
  FROM trades t
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.user_id = $1::int
    AND t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND ($2::int = 0 OR t.closed_at >= $2::int)
)
SELECT 'top' AS bucket, *
FROM (
  SELECT * FROM ft ORDER BY profit DESC, closed_at DESC LIMIT $3::int
) a
UNION ALL
SELECT 'bottom' AS bucket, *
FROM (
  SELECT * FROM ft ORDER BY profit ASC, closed_at DESC LIMIT $3::int
) b;
      `;

      const rowsRaw = (await dbClient.query(sqlText, [userId, cutoffSec, limit])).rows;
      const top: any[] = [];
      const bottom: any[] = [];

      for (const r of rowsRaw) {
        const item = {
          id: Number(r.id),
          symbol: r.symbol ?? null,
          type: r.type ?? null,
          size: r.size == null ? null : Number(r.size),
          lots: r.lots == null ? null : Number(r.lots),
          openPrice: r.open_price == null ? null : Number(r.open_price),
          closePrice: r.close_price == null ? null : Number(r.close_price),
          stopLoss: r.stop_loss == null ? null : Number(r.stop_loss),
          takeProfit: r.take_profit == null ? null : Number(r.take_profit),
          openedAt: r.opened_at == null ? null : Number(r.opened_at),
          closedAt: r.closed_at == null ? null : Number(r.closed_at),
          holdSec:
            r.closed_at != null && r.opened_at != null ? Number(r.closed_at) - Number(r.opened_at) : null,
          profit: Number(r.profit ?? 0),
        };
        if (r.bucket === 'top') top.push(item);
        else bottom.push(item);
      }

      res.json({ userId, days, cutoffSec, limit, top, bottom });
    } catch (error) {
      console.error("Trader scouting trade extremes error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
```
