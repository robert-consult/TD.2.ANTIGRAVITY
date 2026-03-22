import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { onLiveEvent } from "../liveBus";

type BotConfigSource = Partial<typeof systemConfig.$inferSelect> | null | undefined;

export type ResolvedBotGuardConfig = {
  botScoreThreshold: number;
  powEnabled: boolean;
  powEnforceSignup: boolean;
  powEnforceLogin: boolean;
  powChallengeScore: number;
  tradePowChallengeScore: number;
  powBaseDifficulty: number;
  powMaxDifficulty: number;
  powTtlSec: number;
  valkeyEnabled: boolean;
  heuristicVersion: string;
};

export type ResolvedActivityLifecycleConfig = {
  inactivityThresholdDays: number;
  deletionGraceDays: number;
  botScoreThreshold: number;
  autoQueueInactive: boolean;
  autoSoftDelete: boolean;
};

export type ResolvedActivityAdminConfig = ResolvedBotGuardConfig &
  ResolvedActivityLifecycleConfig & {
    updatedAt: number | null;
  };

export type EffectiveActivityConfigState = {
  config: ResolvedActivityAdminConfig;
  lifecycle: ResolvedActivityLifecycleConfig;
  botGuard: ResolvedBotGuardConfig;
  diagnostics: {
    cacheTtlMs: number;
    heuristicVersion: string;
  };
};

export const BOT_GUARD_HEURISTIC_VERSION = "wave3-2026-03-v1";
const BOT_CONFIG_CACHE_TTL_MS = 15_000;

let cache: { atMs: number; value: ResolvedActivityAdminConfig } | null = null;
let inflight: Promise<ResolvedActivityAdminConfig> | null = null;
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  onLiveEvent((event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "activity-config:updated" || event.type === "system-config:updated") {
      invalidateActivityAdminConfigCache();
    }
  });
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = toInt(value, fallback);
  return Math.min(max, Math.max(min, n));
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function resolveBotGuardConfig(source: BotConfigSource): ResolvedBotGuardConfig {
  const baseDifficulty = clampInt(source?.botPowBaseDifficulty, 14, 1, 32);
  const challengeScore = clampInt(source?.botPowChallengeScore, 25, 0, 100);
  const maxDifficulty = Math.max(baseDifficulty, clampInt(source?.botPowMaxDifficulty, 20, 1, 32));
  return {
    botScoreThreshold: clampInt(source?.botScoreThreshold, 40, 0, 100),
    powEnabled: toBool(source?.botPowEnabled, true),
    powEnforceSignup: toBool(source?.botPowEnforceSignup, true),
    powEnforceLogin: toBool(source?.botPowEnforceLogin, false),
    powChallengeScore: challengeScore,
    tradePowChallengeScore: Math.min(100, challengeScore + 10),
    powBaseDifficulty: baseDifficulty,
    powMaxDifficulty: maxDifficulty,
    powTtlSec: clampInt(source?.botPowTtlSec, 120, 10, 3600),
    valkeyEnabled: toBool(source?.botValkeyEnabled, true),
    heuristicVersion: BOT_GUARD_HEURISTIC_VERSION,
  };
}

export function resolveActivityLifecycleConfig(source: BotConfigSource): ResolvedActivityLifecycleConfig {
  return {
    inactivityThresholdDays: clampInt(source?.inactivityThresholdDays, 90, 1, 3650),
    deletionGraceDays: clampInt(source?.deletionGraceDays, 30, 0, 3650),
    botScoreThreshold: clampInt(source?.botScoreThreshold, 40, 0, 100),
    autoQueueInactive: toBool(source?.activityAutoQueueInactive, true),
    autoSoftDelete: toBool(source?.activityAutoSoftDelete, false),
  };
}

export function resolveActivityAdminConfig(source: BotConfigSource): ResolvedActivityAdminConfig {
  return {
    ...resolveActivityLifecycleConfig(source),
    ...resolveBotGuardConfig(source),
    updatedAt: typeof source?.updatedAt === "number" ? Math.trunc(source.updatedAt) : null,
  };
}

export function buildActivityConfigWrite(input: BotConfigSource): Partial<typeof systemConfig.$inferInsert> {
  const resolved = resolveActivityAdminConfig(input);
  return {
    inactivityThresholdDays: resolved.inactivityThresholdDays,
    deletionGraceDays: resolved.deletionGraceDays,
    botScoreThreshold: resolved.botScoreThreshold,
    botPowEnabled: resolved.powEnabled,
    botPowEnforceSignup: resolved.powEnforceSignup,
    botPowEnforceLogin: resolved.powEnforceLogin,
    botPowChallengeScore: resolved.powChallengeScore,
    botPowBaseDifficulty: resolved.powBaseDifficulty,
    botPowMaxDifficulty: resolved.powMaxDifficulty,
    botPowTtlSec: resolved.powTtlSec,
    botValkeyEnabled: resolved.valkeyEnabled,
    activityAutoQueueInactive: resolved.autoQueueInactive,
    activityAutoSoftDelete: resolved.autoSoftDelete,
  };
}

export function buildActivityEffectiveState(
  source: ResolvedActivityAdminConfig,
): EffectiveActivityConfigState {
  return {
    config: source,
    lifecycle: resolveActivityLifecycleConfig(source),
    botGuard: resolveBotGuardConfig(source),
    diagnostics: {
      cacheTtlMs: BOT_CONFIG_CACHE_TTL_MS,
      heuristicVersion: BOT_GUARD_HEURISTIC_VERSION,
    },
  };
}

export function invalidateActivityAdminConfigCache() {
  cache = null;
}

export async function getActivityAdminConfig(): Promise<ResolvedActivityAdminConfig> {
  ensureSubscribed();
  const now = Date.now();
  if (cache && now - cache.atMs < BOT_CONFIG_CACHE_TTL_MS) {
    return cache.value;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const row = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1),
      });
      const resolved = resolveActivityAdminConfig(row ?? null);
      cache = { atMs: Date.now(), value: resolved };
      return resolved;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function getActivityEffectiveState(): Promise<EffectiveActivityConfigState> {
  const config = await getActivityAdminConfig();
  return buildActivityEffectiveState(config);
}

export async function getBotGuardConfig(): Promise<ResolvedBotGuardConfig> {
  const config = await getActivityAdminConfig();
  return resolveBotGuardConfig(config);
}

export async function getActivityLifecycleConfig(): Promise<ResolvedActivityLifecycleConfig> {
  const config = await getActivityAdminConfig();
  return resolveActivityLifecycleConfig(config);
}
