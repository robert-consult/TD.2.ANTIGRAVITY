// server/grift/griftScheduler.ts
import * as cron from "node-cron";
import { recomputeUserAggregates, getConfig } from "./griftEngine";
import { maybeApplyAutoEnforcement } from "./griftAutoEnforcement";
import { enrichIpAsnCacheBatch } from "./griftIpAsn";
import { runGriftRetention } from "./griftRetention";
import { appendAuditEntry } from "./griftAdminAudit";
import { withGriftClient } from "./griftDb";

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
let lastRetentionRunAtMs = 0;
const RETENTION_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startGriftEvaluationScheduler() {
  if (scheduledTask) {
    console.log("[Grift Scheduler] Already running, skipping initialization");
    return;
  }

  // Run every hour at minute 0
  scheduledTask = cron.schedule("0 * * * *", () => {
    console.log("[Grift Scheduler] Running periodic risk re-evaluation...");
    void runPeriodicEvaluation();
  });

  console.log("[Grift Scheduler] Periodic risk evaluation scheduled (hourly)");
}

export function stopGriftEvaluationScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log("[Grift Scheduler] Stopped");
  }
}

export async function runPeriodicEvaluation() {
  return await withGriftClient(async (db) => {
    const cfg = await getConfig(db);
    // Daily retention pruning (raw telemetry) to prevent unbounded DB growth.
    const nowMs = Date.now();
    if (!lastRetentionRunAtMs || nowMs - lastRetentionRunAtMs >= RETENTION_RUN_INTERVAL_MS) {
      try {
        const result = await runGriftRetention(db, cfg);
        lastRetentionRunAtMs = nowMs;
        await appendAuditEntry(db, 0, "RETENTION_PRUNE", "maintenance", 1, result);
        console.log(
          `[Grift Scheduler] Retention prune: obs=${result.deleted.observations}, tradeObs=${result.deleted.tradeObservations}, auth=${result.deleted.authEvents}, ipAsnCache=${result.deleted.ipAsnCache} (took ${result.tookMs}ms)`
        );
      } catch (err) {
        console.error("[Grift Scheduler] Retention prune error:", err);
      }
    }

    if (!cfg.enabled) {
      console.log("[Grift Scheduler] Detection disabled, skipping evaluation");
      return { evaluated: 0 };
    }

    // Opportunistically enrich IP -> ASN/Org (optional; runs only when provider env is configured).
    try {
      const enrichment = await enrichIpAsnCacheBatch(db, { limit: 50, lookbackMs: 24 * 60 * 60 * 1000 });
      if (enrichment.skipped) {
        if (enrichment.reason) {
          console.log(`[Grift Scheduler] IP→ASN enrichment skipped: ${enrichment.reason}`);
        }
      } else {
        console.log(
          `[Grift Scheduler] IP→ASN enrichment: attempted ${enrichment.attempted}, enriched ${enrichment.enriched}`
        );
      }
    } catch (err) {
      console.error("[Grift Scheduler] IP→ASN enrichment error:", err);
    }

    // Find users with open signals or recent activity
    const usersWithOpenSignals = await db.prepare(`
      SELECT DISTINCT user_id as userId FROM grift_signals WHERE status = 'OPEN'
    `).all() as { userId: number }[];

    // Also include users with recent observations (last 24 hours)
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const usersWithRecentActivity = await db.prepare(`
      SELECT DISTINCT user_id as userId FROM grift_observations WHERE observed_at >= ?
    `).all(recentCutoff) as { userId: number }[];

    const userIds = new Set<number>();
    for (const u of usersWithOpenSignals) userIds.add(u.userId);
    for (const u of usersWithRecentActivity) userIds.add(u.userId);

    let evaluated = 0;
    for (const userId of Array.from(userIds)) {
      try {
        // Recompute all aggregate fields (signals + observations based).
        await recomputeUserAggregates(db, userId);
        evaluated++;

        // Auto-enforcement (optional and admin-configurable).
        try {
          await maybeApplyAutoEnforcement(db, { userId });
        } catch (enfErr) {
          console.error(`[Grift Scheduler] Auto-enforcement error for user ${userId}:`, enfErr);
        }
      } catch (err) {
        console.error(`[Grift Scheduler] Error evaluating user ${userId}:`, err);
      }
    }

    console.log(`[Grift Scheduler] Recomputed aggregates for ${evaluated} users`);
    return { evaluated };
  });
}

export function runImmediateEvaluation() {
  console.log("[Grift Scheduler] Running immediate risk re-evaluation...");
  return runPeriodicEvaluation();
}
