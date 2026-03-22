import { evaluateChallengeEnrollmentsPass } from "../recruitment/engines";
import { clampIntOr } from "@shared/scalars";
import { onLiveEvent } from "../services/liveBus";
import { getChallengeSchedulerEffectiveState } from "../services/runtimeConfig/challengeScheduler";

let started = false;
let running = false;
let handle: ReturnType<typeof setTimeout> | null = null;
let lastRuntimeSignature = "";
let unsubscribeLiveBus: (() => void) | null = null;
let nextRunAtMs: number | null = null;
let lastResolvedRuntime: ChallengeEvalRuntime | null = null;

type ChallengeEvalRuntime = {
  enabled: boolean;
  intervalMin: number;
  intervalSec: number;
  maxRows: number;
  source: "DB" | "ENV";
};

async function resolveRuntime(): Promise<ChallengeEvalRuntime> {
  const state = await getChallengeSchedulerEffectiveState();
  const runtime = state.runtime;
  lastResolvedRuntime = runtime;
  return runtime;
}

function scheduleNext(delayMs: number) {
  if (handle) clearTimeout(handle);
  nextRunAtMs = Date.now() + Math.max(1000, delayMs);
  handle = setTimeout(() => {
    void tickScheduler();
  }, Math.max(1000, delayMs));
  (handle as any)?.unref?.();
}

function maybeLogRuntime(runtime: ChallengeEvalRuntime) {
  const signature = `${runtime.enabled ? "1" : "0"}:${runtime.intervalMin}:${runtime.intervalSec}:${runtime.maxRows}:${runtime.source}`;
  if (signature === lastRuntimeSignature) return;
  lastRuntimeSignature = signature;
  console.log(
    `[Challenges] Runtime settings source=${runtime.source} enabled=${runtime.enabled ? 1 : 0} ` +
      `intervalMin=${runtime.intervalMin} intervalSec=${runtime.intervalSec} maxRows=${runtime.maxRows}`,
  );
}

export async function runChallengeEvaluationPassNow(options?: { maxRows?: number }) {
  const state = await getChallengeSchedulerEffectiveState();
  if (!state.deployGuards.envEnabled || running) return;
  const runtime = await resolveRuntime();
  if (!runtime.enabled) return;
  running = true;
  try {
    const maxRows = clampIntOr(options?.maxRows, runtime.maxRows, 1, 5000);
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

function shouldRescheduleFromEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const liveEvent = event as { type?: unknown; payload?: Record<string, unknown> | null };
  if (liveEvent.type !== "challenges:updated") return false;
  const payload = liveEvent.payload;
  if (!payload || payload.action !== "settings-updated") return false;
  const patchKeys = Array.isArray(payload.patchKeys)
    ? payload.patchKeys.map((value) => String(value))
    : [];
  if (patchKeys.length === 0) return true;
  return patchKeys.some((key) =>
    key === "challengeEvalEnabled" ||
    key === "challengeEvalIntervalMin" ||
    key === "challengeEvaluationIntervalSec" ||
    key === "challengeEvalMaxRows",
  );
}

async function rescheduleFromRuntimeConfig() {
  if (!started) return;
  const runtime = await resolveRuntime();
  const state = await getChallengeSchedulerEffectiveState();
  maybeLogRuntime(runtime);
  if (runtime.enabled) {
    scheduleNext(runtime.intervalMin * 60 * 1000);
    return;
  }
  scheduleNext(state.deployGuards.disabledPollSec * 1000);
}

async function tickScheduler() {
  if (!started) return;

  const state = await getChallengeSchedulerEffectiveState();
  const runtime = await resolveRuntime();
  maybeLogRuntime(runtime);

  if (runtime.enabled) {
    await runChallengeEvaluationPassNow({ maxRows: runtime.maxRows });
    const nextRuntime = await resolveRuntime();
    maybeLogRuntime(nextRuntime);
    if (nextRuntime.enabled) {
      scheduleNext(nextRuntime.intervalMin * 60 * 1000);
      return;
    }
    scheduleNext(state.deployGuards.disabledPollSec * 1000);
    return;
  }

  scheduleNext(state.deployGuards.disabledPollSec * 1000);
}

export function startChallengeEvaluationCron() {
  if (started) return;
  started = true;
  const statePromise = getChallengeSchedulerEffectiveState();
  statePromise.then((state) => {
    if (!state.deployGuards.envEnabled) {
      console.log("[Challenges] Disabled via CHALLENGE_EVAL_ENABLED=0");
      return;
    }

    console.log(
      `[Challenges] Starting scheduler with runtime-config interval (initial delay ${state.deployGuards.startDelaySec}s, fallback interval ${state.deployGuards.fallbackIntervalMinutes}m, fallback maxRows ${state.deployGuards.fallbackMaxRows})`,
    );
    if (!unsubscribeLiveBus) {
      unsubscribeLiveBus = onLiveEvent((event) => {
        if (!shouldRescheduleFromEvent(event)) return;
        void rescheduleFromRuntimeConfig();
      });
    }
    scheduleNext(state.deployGuards.startDelaySec * 1000);
  }).catch((error) => {
    console.error("[Challenges] Failed to start scheduler:", error);
  });
}

export function stopChallengeEvaluationCron() {
  if (handle) {
    clearTimeout(handle);
    handle = null;
  }
  if (unsubscribeLiveBus) {
    unsubscribeLiveBus();
    unsubscribeLiveBus = null;
  }
  started = false;
  lastRuntimeSignature = "";
  nextRunAtMs = null;
  lastResolvedRuntime = null;
}

export function getChallengeSchedulerState() {
  return {
    started,
    running,
    nextRunAtMs,
    runtime: lastResolvedRuntime,
  };
}
