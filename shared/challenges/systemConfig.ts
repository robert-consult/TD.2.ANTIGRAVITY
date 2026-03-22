export const DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN = 60;
export const MIN_CHALLENGE_EVAL_INTERVAL_MIN = 1;
export const MAX_CHALLENGE_EVAL_INTERVAL_MIN = 24 * 60;
export const DEFAULT_CHALLENGE_EVAL_INTERVAL_SEC = DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN * 60;
export const MIN_CHALLENGE_EVAL_INTERVAL_SEC = 60;
export const MAX_CHALLENGE_EVAL_INTERVAL_SEC = 24 * 3600;

type ChallengeEvalIntervalSource = {
  challengeEvalIntervalMin?: unknown;
  challengeEvaluationIntervalSec?: unknown;
};

export type ResolvedChallengeEvalInterval = {
  intervalMin: number;
  intervalSec: number;
  source: "minutes" | "legacy-seconds" | "default";
};

export type CanonicalChallengeEvalIntervalInput = {
  intervalMin?: number;
  intervalSec?: number;
  source: "minutes" | "legacy-seconds" | "absent";
  conflict: boolean;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = toFiniteNumber(value);
  if (n === null) return fallback;
  const normalized = Math.trunc(n);
  return Math.min(max, Math.max(min, normalized));
}

export function normalizeChallengeEvalIntervalMin(
  value: unknown,
  fallback = DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
): number {
  const safeFallback = clampInteger(
    fallback,
    DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
    MIN_CHALLENGE_EVAL_INTERVAL_MIN,
    MAX_CHALLENGE_EVAL_INTERVAL_MIN,
  );
  return clampInteger(value, safeFallback, MIN_CHALLENGE_EVAL_INTERVAL_MIN, MAX_CHALLENGE_EVAL_INTERVAL_MIN);
}

export function normalizeChallengeEvalIntervalSec(
  value: unknown,
  fallback = DEFAULT_CHALLENGE_EVAL_INTERVAL_SEC,
): number {
  const safeFallback = clampInteger(
    fallback,
    DEFAULT_CHALLENGE_EVAL_INTERVAL_SEC,
    MIN_CHALLENGE_EVAL_INTERVAL_SEC,
    MAX_CHALLENGE_EVAL_INTERVAL_SEC,
  );
  return clampInteger(value, safeFallback, MIN_CHALLENGE_EVAL_INTERVAL_SEC, MAX_CHALLENGE_EVAL_INTERVAL_SEC);
}

export function challengeEvalIntervalMinFromLegacySeconds(
  value: unknown,
  fallback = DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
): number {
  const fallbackSec = normalizeChallengeEvalIntervalSec(fallback * 60, DEFAULT_CHALLENGE_EVAL_INTERVAL_SEC);
  const intervalSec = normalizeChallengeEvalIntervalSec(value, fallbackSec);
  return normalizeChallengeEvalIntervalMin(Math.ceil(intervalSec / 60), fallback);
}

export function challengeEvalIntervalSecFromMinutes(
  value: unknown,
  fallback = DEFAULT_CHALLENGE_EVAL_INTERVAL_SEC,
): number {
  const intervalMin = normalizeChallengeEvalIntervalMin(value, Math.ceil(fallback / 60));
  return normalizeChallengeEvalIntervalSec(intervalMin * 60, fallback);
}

export function resolveChallengeEvalInterval(
  source: ChallengeEvalIntervalSource | null | undefined,
): ResolvedChallengeEvalInterval {
  const rawMinutes = toFiniteNumber(source?.challengeEvalIntervalMin);
  if (rawMinutes !== null) {
    const intervalMin = normalizeChallengeEvalIntervalMin(rawMinutes);
    return {
      intervalMin,
      intervalSec: challengeEvalIntervalSecFromMinutes(intervalMin),
      source: "minutes",
    };
  }

  const rawSeconds = toFiniteNumber(source?.challengeEvaluationIntervalSec);
  if (rawSeconds !== null) {
    const intervalMin = challengeEvalIntervalMinFromLegacySeconds(rawSeconds);
    return {
      intervalMin,
      intervalSec: challengeEvalIntervalSecFromMinutes(intervalMin),
      source: "legacy-seconds",
    };
  }

  return {
    intervalMin: DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
    intervalSec: DEFAULT_CHALLENGE_EVAL_INTERVAL_SEC,
    source: "default",
  };
}

export function canonicalizeChallengeEvalIntervalInput(
  input: ChallengeEvalIntervalSource | null | undefined,
): CanonicalChallengeEvalIntervalInput {
  const hasMinutes = input?.challengeEvalIntervalMin !== undefined;
  const hasSeconds = input?.challengeEvaluationIntervalSec !== undefined;

  if (!hasMinutes && !hasSeconds) {
    return {
      source: "absent",
      conflict: false,
    };
  }

  const intervalMinFromMinutes = hasMinutes
    ? normalizeChallengeEvalIntervalMin(input?.challengeEvalIntervalMin)
    : undefined;
  const intervalMinFromSeconds = hasSeconds
    ? challengeEvalIntervalMinFromLegacySeconds(input?.challengeEvaluationIntervalSec)
    : undefined;

  const conflict =
    intervalMinFromMinutes !== undefined &&
    intervalMinFromSeconds !== undefined &&
    intervalMinFromMinutes !== intervalMinFromSeconds;

  const intervalMin = intervalMinFromMinutes ?? intervalMinFromSeconds;
  return {
    intervalMin,
    intervalSec: intervalMin !== undefined ? challengeEvalIntervalSecFromMinutes(intervalMin) : undefined,
    source: hasMinutes ? "minutes" : "legacy-seconds",
    conflict,
  };
}
