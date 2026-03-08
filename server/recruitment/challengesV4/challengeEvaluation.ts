import { db } from "@db";
import { recalcAccount } from "../../recalcAccount";
import {
  challengeBadgeAwards,
  challengeBadges,
  challengeCertificates,
  challengeCertificateTemplates,
  challengeEnrollments,
  challengeEvaluationRuns,
  challengeLeaderboardSnapshot,
  challengePhaseSnapshots,
  challengePhases,
  challengePrizeAwards,
  challengeProgressionTiers,
  challengeRewardLedger,
  challengeSelectionBoosts,
  challengeUserProgression,
  challenges,
  recruitingPipeline,
  scoutWatchlists,
  trades,
  users,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createMailboxThreadWithMessage, createNotification } from "../../services/messaging";
import { appendIdentityAudit } from "../../services/identityAudit";
import { appendChallengeEvent } from "./challengeEvents";
import { getSystemChallengeConfig, type SystemChallengeConfig } from "./challengeConfig";
import { generateCertificateVerificationBundle } from "./certificateCode";
import {
  parseCustomRewardRules,
  scopedCustomRewardKey,
  type CustomRewardActionType,
  type CustomRewardTrigger,
} from "./customRewards";
import { chainHash, stableStringify } from "./hashChain";
import { getPhaseForEnrollment, hasRestrictedSymbolTrade, nowSec, parseCsvSet } from "./challengeService";

type EvalResult = {
  processed: number;
  advanced: number;
  passed: number;
  failed: number;
  warned: number;
};

export type PhaseStats = {
  pnlBasis: "REALIZED_ONLY" | "REALIZED_PLUS_FLOATING";
  roundingMode: "HALF_AWAY_FROM_ZERO_8DP";
  inputHash: string;
  tradeCount: number;
  totalPnl: number;
  pnlPct: number;
  tradingDays: number;
  worstDayLossPct: number;
  bestDayProfitPct: number;
  startDdPct: number;
  trailingDdPct: number;
  peakEquity: number;
};

type RankedPassedRow = {
  enrollmentId: number;
  userId: number;
  rank: number;
  pnlPct: number;
  tradingDays: number;
};

type PrizeRecomputeResult = {
  rankByEnrollmentId: Map<number, number>;
  newlyAwardedEnrollmentIds: Set<number>;
};

type TierRule = {
  name: string;
  minChallengesPassed: number;
  minTop3: number;
  minAvgPnlPct: number;
  maxDqs: number | null;
  order: number;
};

import { EVALUATION_RUN_LOCK_KEY, customRewardRuleCache, buildEvalRunId, withRunDetails, appendChallengeTransitionAudit, normalizeChallengeMailboxCategory, toPositiveInt, toNumber, roundMoney, roundDeterministic, parseJsonValue, normalizePrizeDistribution, resolvePrizeAwardTiming, resolveBreachPolicy, resolvePrizeCandidateMode, parseTierRules, resolveProgressionTierName, appendChallengeEventWithRun, maybeSendChallengeMailboxMessage, applyCustomRewardsForTrigger, rankPrizeCandidates, recomputePrizeAwards, notifyPrizeAwardsForChallenge, maybeRefreshChallengeLeaderboard, applyCompletionRewards, computePhaseStats, persistPhaseSnapshot } from "./challengeEvaluationSupport";

export { computePhaseStats } from "./challengeEvaluationSupport";
function nearLimit(hit: number, limit: number, thresholdPct: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const threshold = Math.max(0, Math.min(1, thresholdPct));
  const warnAt = limit * threshold;
  return hit >= warnAt && hit < limit;
}

export async function evaluateChallengesTick(options?: { batchSize?: number; runId?: string }): Promise<EvalResult> {
  const batchSize = options?.batchSize ?? 500;
  const emptyResult: EvalResult = { processed: 0, advanced: 0, passed: 0, failed: 0, warned: 0 };
  const runStartedAt = nowSec();
  const runId = String(options?.runId ?? "").trim() || buildEvalRunId(runStartedAt);
  let runInserted = false;
  let lockAcquired = false;

  const finishRun = async (status: "SUCCESS" | "FAILED", result: EvalResult, error?: unknown) => {
    if (!runInserted) return;
    await db
      .update(challengeEvaluationRuns)
      .set({
        status,
        endedAt: nowSec(),
        processedCount: result.processed,
        advancedCount: result.advanced,
        passedCount: result.passed,
        failedCount: result.failed,
        warnedCount: result.warned,
        errorJson: error ? stableStringify({ message: String((error as any)?.message ?? error), error }) : null,
      })
      .where(eq(challengeEvaluationRuns.runId, runId));
  };

  try {
    const lockRow = await db.execute(sql`SELECT pg_try_advisory_lock(${EVALUATION_RUN_LOCK_KEY}) AS locked`);
    lockAcquired = Boolean((lockRow as any).rows?.[0]?.locked);
    if (!lockAcquired) {
      await db
        .insert(challengeEvaluationRuns)
        .values({
          runId,
          status: "SKIPPED_LOCK",
          startedAt: runStartedAt,
          endedAt: runStartedAt,
          createdAt: runStartedAt,
        })
        .onConflictDoNothing();
      return emptyResult;
    }

    await db
      .insert(challengeEvaluationRuns)
      .values({
        runId,
        status: "RUNNING",
        startedAt: runStartedAt,
        createdAt: runStartedAt,
      })
      .onConflictDoNothing();
    runInserted = true;

    const cfg = await getSystemChallengeConfig();

    if (!cfg.traderCompeteEnabled || !cfg.challengeEvalEnabled) {
      await finishRun("SUCCESS", emptyResult);
      return emptyResult;
    }

    const now = nowSec();

    const enrolls = await db
      .select({
        enrollment: challengeEnrollments,
        challenge: challenges,
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challengeEnrollments.challengeId, challenges.id))
      .where(and(eq(challengeEnrollments.status, "ACTIVE"), eq(challenges.isActive, true)))
      .orderBy(asc(challengeEnrollments.updatedAt))
      .limit(batchSize);

    if (!enrolls.length) {
      await finishRun("SUCCESS", emptyResult);
      return emptyResult;
    }

    const challengeIds = Array.from(new Set(enrolls.map((r) => r.challenge.id)));
    const challengeById = new Map<number, any>();
    for (const row of enrolls) challengeById.set(row.challenge.id, row.challenge);

    const phases = await db.select().from(challengePhases).where(inArray(challengePhases.challengeId, challengeIds));

    let processed = 0;
    let advanced = 0;
    let passed = 0;
    let failed = 0;
    let warned = 0;

    const touchedChallenges = new Set<number>();
    const forceLeaderboardRefresh = new Set<number>();

    for (const r of enrolls) {
      processed += 1;

      const enrollment = r.enrollment as any;
      const challenge = r.challenge as any;
      touchedChallenges.add(challenge.id);

      try {
        const currentPhase = Number(enrollment.currentPhase ?? 1);
        const phase = phases.find((p) => p.challengeId === challenge.id && p.phaseNumber === currentPhase);
        const phaseRules = phase ?? getPhaseForEnrollment({ ...challenge, phases: [] } as any, currentPhase);

        const phaseStart = Number(enrollment.phaseStartedAt ?? enrollment.enrolledAt ?? now);
        const durationDays = Number((phaseRules as any).durationDays ?? challenge.durationDays ?? 0);
        const phaseDeadline = durationDays > 0 ? phaseStart + durationDays * 86400 : null;
        const evalEnd = phaseDeadline ? Math.min(now, phaseDeadline) : now;

        const capitalBaseRaw = Number(enrollment.capitalBaseUsed ?? challenge.virtualCapitalUsd ?? 100000);
        const capitalBase = Number.isFinite(capitalBaseRaw) && capitalBaseRaw > 0 ? capitalBaseRaw : 100000;

        // Force a live floating PnL recalculation before computing stats to ensure drawdowns are accurate
        await recalcAccount(enrollment.userId).catch(e => console.error("[challengeEval] recalcAccount failed:", e));

        const stats = await computePhaseStats({
          userId: enrollment.userId,
          startAt: phaseStart,
          endAt: evalEnd,
          capitalBase,
        });
        await persistPhaseSnapshot({
          enrollmentId: enrollment.id,
          challengeId: challenge.id,
          userId: enrollment.userId,
          phaseNumber: currentPhase,
          runId,
          computedAt: now,
          stats,
        });

        const profitTarget = Number((phaseRules as any).profitTargetPct ?? challenge.profitTargetPct ?? 0);
        const maxDailyLoss = Number((phaseRules as any).maxDailyLossPct ?? challenge.maxDailyLossPct ?? 1);
        const maxTotalLoss = Number((phaseRules as any).maxTotalLossPct ?? challenge.maxTotalLossPct ?? 1);
        const drawdownType = String((phaseRules as any).drawdownType ?? cfg.challengeDefaultDrawdownType ?? "STATIC").toUpperCase();
        const totalDdHit = drawdownType === "TRAILING" ? stats.trailingDdPct : stats.startDdPct;
        const minTradingDays = Number((phaseRules as any).minTradingDays ?? challenge.minTradingDays ?? 0);
        const maxSingleDayProfit =
          (phaseRules as any).maxSingleDayProfitPct == null ? null : Number((phaseRules as any).maxSingleDayProfitPct);

        const restricted = parseCsvSet((phaseRules as any).restrictedSymbolsCsv);
        const restrictedHit = restricted.size
          ? await hasRestrictedSymbolTrade(enrollment.userId, phaseStart, evalEnd, restricted)
          : false;

        const dailyBreach = maxDailyLoss > 0 && stats.worstDayLossPct >= maxDailyLoss;
        const totalBreach = maxTotalLoss > 0 && totalDdHit >= maxTotalLoss;
        const consistencyBreach = maxSingleDayProfit != null && stats.bestDayProfitPct > maxSingleDayProfit;

        const targetHit = profitTarget <= 0 ? true : stats.pnlPct >= profitTarget;
        const daysOk = minTradingDays <= 0 ? true : stats.tradingDays >= minTradingDays;
        const timeoutFail = Boolean(phaseDeadline && now > phaseDeadline && !(targetHit && daysOk));

        const nowUpdate: any = {
          currentPnlPct: stats.pnlPct,
          tradingDays: stats.tradingDays,
          maxDailyLossHit: stats.worstDayLossPct,
          maxTotalLossHit: totalDdHit,
          peakEquity: stats.peakEquity,
          updatedAt: now,
        };

        const ruleBreach = dailyBreach || totalBreach || consistencyBreach || restrictedHit;
        if (ruleBreach || timeoutFail) {
          const reason = dailyBreach
            ? "MAX_DAILY_LOSS_BREACH"
            : totalBreach
              ? "MAX_TOTAL_LOSS_BREACH"
              : consistencyBreach
                ? "CONSISTENCY_RULE_BREACH"
                : restrictedHit
                  ? "RESTRICTED_SYMBOL_BREACH"
                  : "DEADLINE_EXPIRED";
          const breachPolicy = timeoutFail ? "FAIL" : resolveBreachPolicy(challenge, cfg);

          if (!timeoutFail && breachPolicy === "BREACH_AND_CONTINUE") {
            await db
              .update(challengeEnrollments)
              .set({
                ...nowUpdate,
                lastWarningEvent: `CHALLENGE_BREACH_CONTINUE_${reason}`,
                lastWarningAt: now,
              })
              .where(eq(challengeEnrollments.id, enrollment.id));

            await appendChallengeEventWithRun(
              {
                enrollmentId: enrollment.id,
                eventType: `CHALLENGE_BREACH_CONTINUE_${reason}`,
                phaseNumber: currentPhase,
                details: {
                  pnlInputHash: stats.inputHash,
                  breachPolicy,
                  reason,
                  pnlPct: stats.pnlPct,
                  tradingDays: stats.tradingDays,
                  worstDayLossPct: stats.worstDayLossPct,
                  totalDdHit,
                  bestDayProfitPct: stats.bestDayProfitPct,
                },
              },
              runId,
            );
            appendChallengeTransitionAudit({
              runId,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              type: "CHALLENGE_BREACH_CONTINUED",
              data: { reason, phaseNumber: currentPhase, breachPolicy },
            });

            if (cfg.challengeNotifyOnBreach) {
              await createNotification({
                userId: enrollment.userId,
                type: "CHALLENGE",
                severity: "WARNING",
                title: "Challenge rule breached",
                message: `A breach was recorded in Phase ${currentPhase} of ${challenge.name}, but progression remains active (${reason}).`,
                sourceEvent: `CHALLENGE_BREACH_CONTINUE_${reason}`,
              });
            }

            warned += 1;
            continue;
          }

          if (!timeoutFail && breachPolicy === "MANUAL_REVIEW" && cfg.challengeManualReviewEnabled) {
            await db
              .update(challengeEnrollments)
              .set({ ...nowUpdate, status: "REVIEW_REQUIRED", completedAt: now })
              .where(eq(challengeEnrollments.id, enrollment.id));

            await appendChallengeEventWithRun(
              {
                enrollmentId: enrollment.id,
                eventType: "CHALLENGE_REVIEW_REQUIRED",
                phaseNumber: currentPhase,
                details: {
                  pnlInputHash: stats.inputHash,
                  breachPolicy,
                  reason,
                  pnlPct: stats.pnlPct,
                  tradingDays: stats.tradingDays,
                  worstDayLossPct: stats.worstDayLossPct,
                  totalDdHit,
                  bestDayProfitPct: stats.bestDayProfitPct,
                  phaseDeadline,
                },
              },
              runId,
            );
            appendChallengeTransitionAudit({
              runId,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              type: "CHALLENGE_REVIEW_REQUIRED",
              data: { reason, phaseNumber: currentPhase, breachPolicy },
            });

            if (cfg.challengeNotifyOnBreach) {
              await createNotification({
                userId: enrollment.userId,
                type: "CHALLENGE",
                severity: "WARNING",
                title: "Challenge under review",
                message: `Your ${challenge.name} enrollment is now in manual review (${reason}).`,
                sourceEvent: "CHALLENGE_REVIEW_REQUIRED",
              });
              await maybeSendChallengeMailboxMessage({
                cfg,
                userId: enrollment.userId,
                challengeId: challenge.id,
                enrollmentId: enrollment.id,
                sourceEvent: "CHALLENGE_REVIEW_REQUIRED",
                subject: `Manual review required: ${challenge.name}`,
                body: `Your enrollment was moved to manual review in Phase ${currentPhase} (${reason}).`,
              });
            }

            warned += 1;
            forceLeaderboardRefresh.add(challenge.id);
            continue;
          }

          await db
            .update(challengeEnrollments)
            .set({ ...nowUpdate, status: "FAILED", completedAt: now })
            .where(eq(challengeEnrollments.id, enrollment.id));

          await appendChallengeEventWithRun({
            enrollmentId: enrollment.id,
            eventType: `CHALLENGE_FAIL_${reason}`,
            phaseNumber: currentPhase,
            details: {
              pnlInputHash: stats.inputHash,
              breachPolicy,
              pnlPct: stats.pnlPct,
              tradingDays: stats.tradingDays,
              worstDayLossPct: stats.worstDayLossPct,
              totalDdHit,
              bestDayProfitPct: stats.bestDayProfitPct,
              profitTarget,
              maxDailyLoss,
              maxTotalLoss,
              maxSingleDayProfit,
              restrictedSymbols: restricted.size ? Array.from(restricted).slice(0, 50) : [],
              phaseDeadline,
            },
            pnlSnapshotPct: stats.pnlPct,
            dailyLossSnapshot: stats.worstDayLossPct,
            totalDdSnapshot: totalDdHit,
            tradingDaysSnapshot: stats.tradingDays,
          }, runId);
          appendChallengeTransitionAudit({
            runId,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            type: "CHALLENGE_FAILED",
            data: { reason, phaseNumber: currentPhase, breachPolicy },
          });

          if (cfg.challengeNotifyOnFail || cfg.challengeNotifyOnBreach) {
            await createNotification({
              userId: enrollment.userId,
              type: "CHALLENGE",
              severity: "WARNING",
              title: "Challenge failed",
              message: `You breached a rule in Phase ${currentPhase} of ${challenge.name} (${reason}).`,
              sourceEvent: `CHALLENGE_FAIL_${reason}`,
            });
            await maybeSendChallengeMailboxMessage({
              cfg,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              sourceEvent: `CHALLENGE_FAIL_${reason}`,
              subject: `Challenge failed: ${challenge.name}`,
              body: `Phase ${currentPhase} failed due to ${reason}. Review your timeline for details.`,
            });
          }

          failed += 1;
          forceLeaderboardRefresh.add(challenge.id);
          continue;
        }

        if (targetHit && daysOk) {
          await appendChallengeEventWithRun({
            enrollmentId: enrollment.id,
            eventType: "CHALLENGE_PHASE_PASS",
            phaseNumber: currentPhase,
            details: { pnlInputHash: stats.inputHash, pnlPct: stats.pnlPct, tradingDays: stats.tradingDays },
            pnlSnapshotPct: stats.pnlPct,
            dailyLossSnapshot: stats.worstDayLossPct,
            totalDdSnapshot: totalDdHit,
            tradingDaysSnapshot: stats.tradingDays,
          }, runId);
          appendChallengeTransitionAudit({
            runId,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            type: "CHALLENGE_PHASE_PASS",
            data: { phaseNumber: currentPhase },
          });
          await applyCustomRewardsForTrigger({
            cfg,
            enrollment,
            challenge,
            trigger: "ON_PHASE_PASS",
            now,
            runId,
            phaseNumber: currentPhase,
          });

          const maxPhase = phases
            .filter((p) => p.challengeId === challenge.id)
            .reduce((acc, p) => Math.max(acc, p.phaseNumber), 1);

          if (currentPhase >= maxPhase) {
            await db
              .update(challengeEnrollments)
              .set({ ...nowUpdate, status: "PASSED", completedAt: now, lastWarningEvent: null, lastWarningAt: null })
              .where(eq(challengeEnrollments.id, enrollment.id));

            await appendChallengeEventWithRun({
              enrollmentId: enrollment.id,
              eventType: "CHALLENGE_COMPLETE",
              phaseNumber: currentPhase,
              details: {
                pnlInputHash: stats.inputHash,
                pnlPct: stats.pnlPct,
                tradingDays: stats.tradingDays,
                maxPhase,
              },
              pnlSnapshotPct: stats.pnlPct,
              dailyLossSnapshot: stats.worstDayLossPct,
              totalDdSnapshot: totalDdHit,
              tradingDaysSnapshot: stats.tradingDays,
            }, runId);
            appendChallengeTransitionAudit({
              runId,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              type: "CHALLENGE_COMPLETE",
              data: { phaseNumber: currentPhase, maxPhase },
            });

            if (cfg.challengeNotifyOnComplete) {
              await createNotification({
                userId: enrollment.userId,
                type: "CHALLENGE",
                severity: "SUCCESS",
                title: "Challenge completed",
                message: `You completed ${challenge.name}.`,
                sourceEvent: "CHALLENGE_COMPLETE",
              });
              await maybeSendChallengeMailboxMessage({
                cfg,
                userId: enrollment.userId,
                challengeId: challenge.id,
                enrollmentId: enrollment.id,
                sourceEvent: "CHALLENGE_COMPLETE",
                subject: `Challenge completed: ${challenge.name}`,
                body: `Congratulations. You completed ${challenge.name} at phase ${currentPhase}. Rewards are being processed.`,
              });
            }

            await applyCompletionRewards({
              enrollment,
              challenge,
              stats,
              cfg,
              now,
              runId,
            });

            passed += 1;
            forceLeaderboardRefresh.add(challenge.id);
            continue;
          }

          if (cfg.challengeAutoAdvancePhase) {
            const nextPhase = currentPhase + 1;
            await db
              .update(challengeEnrollments)
              .set({
                ...nowUpdate,
                currentPhase: nextPhase,
                phaseStartedAt: now,
                lastWarningEvent: null,
                lastWarningAt: null,
              })
              .where(eq(challengeEnrollments.id, enrollment.id));

            await appendChallengeEventWithRun({
              enrollmentId: enrollment.id,
              eventType: "CHALLENGE_PHASE_ADVANCE",
              phaseNumber: nextPhase,
              details: { fromPhase: currentPhase, toPhase: nextPhase },
            }, runId);
            appendChallengeTransitionAudit({
              runId,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              type: "CHALLENGE_PHASE_ADVANCE",
              data: { fromPhase: currentPhase, toPhase: nextPhase },
            });

            if (cfg.challengeNotifyOnPhasePass) {
              await createNotification({
                userId: enrollment.userId,
                type: "CHALLENGE",
                severity: "SUCCESS",
                title: "Phase passed",
                message: `You passed Phase ${currentPhase} of ${challenge.name}.`,
                sourceEvent: "CHALLENGE_PHASE_PASS",
              });
            }

            advanced += 1;
            forceLeaderboardRefresh.add(challenge.id);
            continue;
          }
        }

        const warnDaily = nearLimit(stats.worstDayLossPct, maxDailyLoss, cfg.challengeWarningThresholdPct);
        const warnTotal = nearLimit(totalDdHit, maxTotalLoss, cfg.challengeWarningThresholdPct);
        if (warnDaily || warnTotal) {
          const warningEvent = warnDaily ? "CHALLENGE_WARN_DAILY" : "CHALLENGE_WARN_TOTAL";
          const lastEvent = String(enrollment.lastWarningEvent ?? "");

          if (lastEvent !== warningEvent) {
            await db
              .update(challengeEnrollments)
              .set({ ...nowUpdate, lastWarningEvent: warningEvent, lastWarningAt: now })
              .where(eq(challengeEnrollments.id, enrollment.id));

            await appendChallengeEventWithRun({
              enrollmentId: enrollment.id,
              eventType: warningEvent,
              phaseNumber: currentPhase,
              details: {
                pnlInputHash: stats.inputHash,
                maxDailyLoss,
                maxTotalLoss,
                totalDdHit,
                worstDayLossPct: stats.worstDayLossPct,
              },
              pnlSnapshotPct: stats.pnlPct,
              dailyLossSnapshot: stats.worstDayLossPct,
              totalDdSnapshot: totalDdHit,
              tradingDaysSnapshot: stats.tradingDays,
            }, runId);

            if (cfg.challengeNotifyOnPhaseWarning) {
              await createNotification({
                userId: enrollment.userId,
                type: "CHALLENGE",
                severity: "INFO",
                title: "Challenge warning",
                message: `You're close to a risk limit in Phase ${currentPhase} of ${challenge.name}.`,
                sourceEvent: warningEvent,
              });
            }

            warned += 1;
          } else {
            await db.update(challengeEnrollments).set(nowUpdate).where(eq(challengeEnrollments.id, enrollment.id));
          }
        } else {
          await db
            .update(challengeEnrollments)
            .set({ ...nowUpdate, lastWarningEvent: null, lastWarningAt: null })
            .where(eq(challengeEnrollments.id, enrollment.id));
        }
      } catch (error) {
        console.error("[challenges-v4] evaluation row failed:", {
          enrollmentId: enrollment.id,
          challengeId: challenge.id,
          error,
        });
      }
    }

    for (const challengeId of touchedChallenges) {
      try {
        const challenge = challengeById.get(challengeId);
        if (!challenge) continue;

        const prizeTiming = resolvePrizeAwardTiming(challenge, cfg);
        if (prizeTiming !== "ON_CHALLENGE_END") continue;

        const endAt = Number(challenge.endAt ?? 0);
        if (!Number.isFinite(endAt) || endAt <= 0 || now < endAt) continue;

        const prizeCandidateMode = resolvePrizeCandidateMode(challenge, cfg);
        const rankedCandidates = await rankPrizeCandidates(challengeId, prizeCandidateMode);
        const prizeResult = await recomputePrizeAwards({
          challenge,
          cfg,
          rankedCandidates,
          now,
        });
        await notifyPrizeAwardsForChallenge({
          challenge,
          cfg,
          runId,
          newlyAwardedEnrollmentIds: prizeResult.newlyAwardedEnrollmentIds,
        });
      } catch (error) {
        console.error("[challenges-v4] challenge-end prize processing failed:", {
          runId,
          challengeId,
          error,
        });
      }
    }

    for (const challengeId of touchedChallenges) {
      try {
        const challenge = challengeById.get(challengeId);
        if (!challenge) continue;

        await maybeRefreshChallengeLeaderboard({
          challenge,
          cfg,
          now,
          force: forceLeaderboardRefresh.has(challengeId),
        });
      } catch (error) {
        console.error("[challenges-v4] leaderboard refresh failed:", {
          challengeId,
          error,
        });
      }
    }

    const result: EvalResult = { processed, advanced, passed, failed, warned };
    await finishRun("SUCCESS", result);
    return result;
  } catch (error) {
    console.error("[challenges-v4] evaluation run failed:", { runId, error });
    await finishRun("FAILED", emptyResult, error);
    return emptyResult;
  } finally {
    if (lockAcquired) {
      await db.execute(sql`SELECT pg_advisory_unlock(${EVALUATION_RUN_LOCK_KEY})`);
    }
  }
}
