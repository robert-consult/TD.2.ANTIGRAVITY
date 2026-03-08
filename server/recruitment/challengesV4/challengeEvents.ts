import { db } from "@db";
import { nowSec } from "@shared/scalars";
import { challengeEnrollmentEvents } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { chainHash, stableStringify } from "./hashChain";

export type ChallengeEventActorType = "SYSTEM" | "TRADER" | "ADMIN";

export type AppendChallengeEventInput = {
  enrollmentId: number;
  eventType: string;
  eventAt?: number;
  actorType?: ChallengeEventActorType;
  actorUserId?: number | null;
  phaseNumber?: number | null;
  details?: unknown;
  pnlSnapshotPct?: number | null;
  dailyLossSnapshot?: number | null;
  totalDdSnapshot?: number | null;
  tradingDaysSnapshot?: number | null;
  note?: string | null;
};

// Append-only, tamper-evident chain: event_hash = sha256(prev_hash + canonical payload)
export async function appendChallengeEvent(input: AppendChallengeEventInput, tx: typeof db = db): Promise<void> {
  const eventAt = input.eventAt ?? nowSec();
  const actorType = input.actorType ?? "SYSTEM";
  const detailsJson = stableStringify(input.details ?? {});

  const [last] = await tx
    .select({ prev: challengeEnrollmentEvents.eventHash })
    .from(challengeEnrollmentEvents)
    .where(eq(challengeEnrollmentEvents.enrollmentId, input.enrollmentId))
    .orderBy(desc(challengeEnrollmentEvents.eventAt), desc(challengeEnrollmentEvents.id))
    .limit(1);

  const prevHash = last?.prev ?? null;

  const payload = {
    enrollmentId: input.enrollmentId,
    eventType: input.eventType,
    eventAt,
    actorType,
    actorUserId: input.actorUserId ?? null,
    phaseNumber: input.phaseNumber ?? null,
    detailsJson,
    pnlSnapshotPct: input.pnlSnapshotPct ?? null,
    dailyLossSnapshot: input.dailyLossSnapshot ?? null,
    totalDdSnapshot: input.totalDdSnapshot ?? null,
    tradingDaysSnapshot: input.tradingDaysSnapshot ?? null,
    note: input.note ?? null,
  };

  const eventHash = chainHash(prevHash, payload);

  await tx.insert(challengeEnrollmentEvents).values({
    enrollmentId: input.enrollmentId,
    eventType: input.eventType,
    eventAt,
    actorType,
    actorUserId: input.actorUserId ?? null,
    phaseNumber: input.phaseNumber ?? null,
    detailsJson,
    pnlSnapshotPct: input.pnlSnapshotPct ?? null,
    dailyLossSnapshot: input.dailyLossSnapshot ?? null,
    totalDdSnapshot: input.totalDdSnapshot ?? null,
    tradingDaysSnapshot: input.tradingDaysSnapshot ?? null,
    note: input.note ?? null,
    prevHash,
    eventHash,
  });
}
