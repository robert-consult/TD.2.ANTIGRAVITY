import { evaluateChallengeEnrollmentsPass } from "../recruitment/engines";

let started = false;
let running = false;
let handle: ReturnType<typeof setInterval> | null = null;

function parsePositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

const ENABLED = String(process.env.CHALLENGE_EVAL_ENABLED ?? "1") !== "0";
const INTERVAL_MINUTES = parsePositiveInt("CHALLENGE_EVAL_INTERVAL_MINUTES", 60);
const START_DELAY_SEC = parsePositiveInt("CHALLENGE_EVAL_START_DELAY_SEC", 120);
const MAX_ROWS = parsePositiveInt("CHALLENGE_EVAL_MAX_ROWS", 500);

export async function runChallengeEvaluationPassNow() {
  if (!ENABLED || running) return;
  running = true;
  try {
    const out = await evaluateChallengeEnrollmentsPass({ maxRows: MAX_ROWS });
    console.log(`[Challenges] PASS processed=${out.processed} changed=${out.changed} maxRows=${MAX_ROWS}`);
  } catch (error) {
    console.error("[Challenges] PASS failed:", error);
  } finally {
    running = false;
  }
}

export function startChallengeEvaluationCron() {
  if (started) return;
  started = true;
  if (!ENABLED) {
    console.log("[Challenges] Disabled via CHALLENGE_EVAL_ENABLED=0");
    return;
  }

  console.log(`[Challenges] Starting scheduler every ${INTERVAL_MINUTES}m (delay ${START_DELAY_SEC}s)`);
  setTimeout(() => {
    void runChallengeEvaluationPassNow();
  }, START_DELAY_SEC * 1000);

  handle = setInterval(() => {
    void runChallengeEvaluationPassNow();
  }, INTERVAL_MINUTES * 60 * 1000);
  (handle as any)?.unref?.();
}

export function stopChallengeEvaluationCron() {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  started = false;
}
