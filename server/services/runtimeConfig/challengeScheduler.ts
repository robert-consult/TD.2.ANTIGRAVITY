import { clampIntOr } from "@shared/scalars";
import { buildChallengeSchedulerRuntimeConfig, getSystemChallengeConfig } from "../../recruitment/challengesV4/challengeConfig";

export type ChallengeSchedulerRuntime = {
  enabled: boolean;
  intervalMin: number;
  intervalSec: number;
  maxRows: number;
  source: "DB" | "ENV";
};

export type ChallengeSchedulerDeployGuards = {
  envEnabled: boolean;
  fallbackIntervalMinutes: number;
  fallbackMaxRows: number;
  startDelaySec: number;
  disabledPollSec: number;
};

export type EffectiveChallengeSchedulerState = {
  runtime: ChallengeSchedulerRuntime;
  deployGuards: ChallengeSchedulerDeployGuards;
};

function parsePositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

export function getChallengeSchedulerDeployGuards(): ChallengeSchedulerDeployGuards {
  return {
    envEnabled: String(process.env.CHALLENGE_EVAL_ENABLED ?? "1") !== "0",
    fallbackIntervalMinutes: parsePositiveInt("CHALLENGE_EVAL_INTERVAL_MINUTES", 60),
    fallbackMaxRows: parsePositiveInt("CHALLENGE_EVAL_MAX_ROWS", 500),
    startDelaySec: parsePositiveInt("CHALLENGE_EVAL_START_DELAY_SEC", 120),
    disabledPollSec: parsePositiveInt("CHALLENGE_EVAL_DISABLED_POLL_SEC", 60),
  };
}

export async function getChallengeSchedulerEffectiveState(): Promise<EffectiveChallengeSchedulerState> {
  const deployGuards = getChallengeSchedulerDeployGuards();
  if (!deployGuards.envEnabled) {
    return {
      deployGuards,
      runtime: {
        enabled: false,
        intervalMin: clampIntOr(deployGuards.fallbackIntervalMinutes, 60, 1, 24 * 60),
        intervalSec: clampIntOr(deployGuards.fallbackIntervalMinutes, 60, 1, 24 * 60) * 60,
        maxRows: clampIntOr(deployGuards.fallbackMaxRows, 500, 1, 5000),
        source: "ENV",
      },
    };
  }

  try {
    const cfg = await getSystemChallengeConfig();
    const runtime = buildChallengeSchedulerRuntimeConfig(cfg as any);
    return {
      deployGuards,
      runtime: {
        enabled: Boolean(runtime.enabled),
        intervalMin: clampIntOr(runtime.intervalMin, deployGuards.fallbackIntervalMinutes, 1, 24 * 60),
        intervalSec: clampIntOr(runtime.intervalSec, deployGuards.fallbackIntervalMinutes * 60, 60, 24 * 60 * 60),
        maxRows: clampIntOr(runtime.maxRows, deployGuards.fallbackMaxRows, 1, 5000),
        source: "DB",
      },
    };
  } catch {
    return {
      deployGuards,
      runtime: {
        enabled: true,
        intervalMin: clampIntOr(deployGuards.fallbackIntervalMinutes, 60, 1, 24 * 60),
        intervalSec: clampIntOr(deployGuards.fallbackIntervalMinutes, 60, 1, 24 * 60) * 60,
        maxRows: clampIntOr(deployGuards.fallbackMaxRows, 500, 1, 5000),
        source: "ENV",
      },
    };
  }
}
