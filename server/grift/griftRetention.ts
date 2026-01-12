import type { GriftDb } from "./griftDb";
import type { GriftConfig } from "./griftTypes";

export type GriftRetentionResult = {
  nowMs: number;
  effectiveRetentionDays: {
    observations: number;
    tradeObservations: number;
    authEvents: number;
    ipAsnCache: number;
  };
  cutoffs: {
    observationsBeforeMs: number;
    tradeObservationsBeforeMs: number;
    authEventsBeforeMs: number;
    ipAsnCacheBeforeMs: number;
  };
  deleted: {
    observations: number;
    tradeObservations: number;
    authEvents: number;
    ipAsnCache: number;
  };
  batches: {
    observations: number;
    tradeObservations: number;
    authEvents: number;
    ipAsnCache: number;
  };
  tookMs: number;
};

function daysToMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function deleteBatchedById(
  db: GriftDb,
  table: string,
  idColumn: string,
  tsColumn: string,
  cutoffMs: number,
  batchSize: number,
  maxBatches: number
): Promise<{ deleted: number; batches: number }> {
  const stmt = db.prepare(
    `DELETE FROM ${table} WHERE ${idColumn} IN (SELECT ${idColumn} FROM ${table} WHERE ${tsColumn} < ? LIMIT ?)`
  );

  let deleted = 0;
  let batches = 0;
  for (let i = 0; i < maxBatches; i++) {
    const info = await stmt.run(cutoffMs, batchSize) as { changes: number };
    const changes = Number(info?.changes ?? 0);
    if (changes <= 0) break;
    deleted += changes;
    batches += 1;
  }

  return { deleted, batches };
}

export async function runGriftRetention(
  db: GriftDb,
  cfg: GriftConfig,
  opts?: { nowMs?: number; batchSize?: number; maxBatches?: number }
): Promise<GriftRetentionResult> {
  const startedAt = Date.now();
  const nowMs = opts?.nowMs ?? startedAt;
  const batchSize = clampInt(opts?.batchSize, 100, 50_000, 5_000);
  const maxBatches = clampInt(opts?.maxBatches, 1, 1_000, 50);

  const requiredObsDays = Math.max(7, cfg.multiAccountWindowDays, Math.ceil(cfg.churnWindowHours / 24));
  const requiredTradeDays = Math.max(7, cfg.ladderingWindowDays);
  const requiredAuthDays = Math.max(7, cfg.multiAccountWindowDays);
  const requiredCacheDays = 30;

  const effectiveObsDays = Math.max(requiredObsDays, cfg.retentionObservationsDays);
  const effectiveTradeDays = Math.max(requiredTradeDays, cfg.retentionTradeObservationsDays);
  const effectiveAuthDays = Math.max(requiredAuthDays, cfg.retentionAuthEventsDays);
  const effectiveCacheDays = Math.max(requiredCacheDays, cfg.retentionIpAsnCacheDays);

  const observationsBeforeMs = nowMs - daysToMs(effectiveObsDays);
  const tradeObservationsBeforeMs = nowMs - daysToMs(effectiveTradeDays);
  const authEventsBeforeMs = nowMs - daysToMs(effectiveAuthDays);
  const ipAsnCacheBeforeMs = nowMs - daysToMs(effectiveCacheDays);

  const obs = await deleteBatchedById(
    db,
    "grift_observations",
    "id",
    "observed_at",
    observationsBeforeMs,
    batchSize,
    maxBatches
  );

  const tradeObs = await deleteBatchedById(
    db,
    "grift_trade_observations",
    "id",
    "observed_at",
    tradeObservationsBeforeMs,
    batchSize,
    maxBatches
  );

  const auth = await deleteBatchedById(
    db,
    "auth_events",
    "id",
    "created_at",
    authEventsBeforeMs,
    batchSize,
    maxBatches
  );

  const cache = await deleteBatchedById(
    db,
    "grift_ip_asn_cache",
    "ip",
    "last_seen_at",
    ipAsnCacheBeforeMs,
    batchSize,
    maxBatches
  );

  return {
    nowMs,
    effectiveRetentionDays: {
      observations: effectiveObsDays,
      tradeObservations: effectiveTradeDays,
      authEvents: effectiveAuthDays,
      ipAsnCache: effectiveCacheDays,
    },
    cutoffs: {
      observationsBeforeMs,
      tradeObservationsBeforeMs,
      authEventsBeforeMs,
      ipAsnCacheBeforeMs,
    },
    deleted: {
      observations: obs.deleted,
      tradeObservations: tradeObs.deleted,
      authEvents: auth.deleted,
      ipAsnCache: cache.deleted,
    },
    batches: {
      observations: obs.batches,
      tradeObservations: tradeObs.batches,
      authEvents: auth.batches,
      ipAsnCache: cache.batches,
    },
    tookMs: Date.now() - startedAt,
  };
}
