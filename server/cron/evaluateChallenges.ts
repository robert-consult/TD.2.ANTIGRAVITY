import { evaluateChallengeEnrollmentsPass } from "../recruitment/engines";
import { getSystemChallengeConfig } from "../recruitment/challengesV4/challengeConfig";

let started = false;
let running = false;
let handle: ReturnType<typeof setTimeout> | null = null;
let lastRuntimeSignature = "";

function parsePositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

const ENABLED = String(process.env.CHALLENGE_EVAL_ENABLED ?? "1") !== "0";
const INTERVAL_FALLBACK_MINUTES = parsePositiveInt("CHALLENGE_EVAL_INTERVAL_MINUTES", 60);
const START_DELAY_SEC = parsePositiveInt("CHALLENGE_EVAL_START_DELAY_SEC", 120);
const MAX_ROWS_FALLBACK = parsePositiveInt("CHALLENGE_EVAL_MAX_ROWS", 500);
const DISABLED_POLL_SEC = parsePositiveInt("CHALLENGE_EVAL_DISABLED_POLL_SEC", 60);

type ChallengeEvalRuntime = {
  enabled: boolean;
  intervalMin: number;
  maxRows: number;
  source: "DB" | "ENV";
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function resolveRuntime(): Promise<ChallengeEvalRuntime> {
  if (!ENABLED) {
    return {
      enabled: false,
      intervalMin: clampInt(INTERVAL_FALLBACK_MINUTES, 60, 1, 24 * 60),
      maxRows: clampInt(MAX_ROWS_FALLBACK, 500, 1, 5000),
      source: "ENV",
    };
  }

  try {
    const cfg = await getSystemChallengeConfig();
    return {
      enabled: Boolean(cfg.challengeEvalEnabled),
      intervalMin: clampInt(cfg.challengeEvalIntervalMin, INTERVAL_FALLBACK_MINUTES, 1, 24 * 60),
      maxRows: clampInt(cfg.challengeEvalMaxRows, MAX_ROWS_FALLBACK, 1, 5000),
      source: "DB",
    };
  } catch {
    return {
      enabled: true,
      intervalMin: clampInt(INTERVAL_FALLBACK_MINUTES, 60, 1, 24 * 60),
      maxRows: clampInt(MAX_ROWS_FALLBACK, 500, 1, 5000),
      source: "ENV",
    };
  }
}

function scheduleNext(delayMs: number) {
  if (handle) clearTimeout(handle);
  handle = setTimeout(() => {
    void tickScheduler();
  }, Math.max(1000, delayMs));
  (handle as any)?.unref?.();
}

function maybeLogRuntime(runtime: ChallengeEvalRuntime) {
  const signature = `${runtime.enabled ? "1" : "0"}:${runtime.intervalMin}:${runtime.maxRows}:${runtime.source}`;
  if (signature === lastRuntimeSignature) return;
  lastRuntimeSignature = signature;
  console.log(
    `[Challenges] Runtime settings source=${runtime.source} enabled=${runtime.enabled ? 1 : 0} ` +
      `intervalMin=${runtime.intervalMin} maxRows=${runtime.maxRows}`,
  );
}

export async function runChallengeEvaluationPassNow(options?: { maxRows?: number }) {
  if (!ENABLED || running) return;
  const runtime = await resolveRuntime();
  if (!runtime.enabled) return;
  running = true;
  try {
    const maxRows = clampInt(options?.maxRows, runtime.maxRows, 1, 5000);
    const out = await evaluateChallengeEnrollmentsPass({ maxRows });
    console.log(
      `[Challenges] PASS processed=${out.processed} changed=${out.changed} ` +
        `advanced=${(out as any).advanced ?? 0} passed=${(out as any).passed ?? 0} ` +
        `failed=${(out as any).failed ?? 0} warned=${(out as any).warned ?? 0} maxRows=${maxRows}`,
    );
  } catch (error) {
    console.error("[Challenges] PASS failed:", error);
  } finally {
    running = false;
  }
}

async function tickScheduler() {
  if (!started) return;

  const runtime = await resolveRuntime();
  maybeLogRuntime(runtime);

  if (runtime.enabled) {
    await runChallengeEvaluationPassNow({ maxRows: runtime.maxRows });
    scheduleNext(runtime.intervalMin * 60 * 1000);
    return;
  }

  scheduleNext(DISABLED_POLL_SEC * 1000);
}

export function startChallengeEvaluationCron() {
  if (started) return;
  started = true;
  if (!ENABLED) {
    console.log("[Challenges] Disabled via CHALLENGE_EVAL_ENABLED=0");
    return;
  }

  console.log(
    `[Challenges] Starting scheduler with runtime-config interval (initial delay ${START_DELAY_SEC}s, fallback interval ${INTERVAL_FALLBACK_MINUTES}m, fallback maxRows ${MAX_ROWS_FALLBACK})`,
  );
  scheduleNext(START_DELAY_SEC * 1000);
}

export function stopChallengeEvaluationCron() {
  if (handle) {
    clearTimeout(handle);
    handle = null;
  }
  started = false;
  lastRuntimeSignature = "";
}
