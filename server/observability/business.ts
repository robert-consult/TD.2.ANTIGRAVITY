import {
  changeBackgroundJobRunning,
  incOperationFailure,
  observeBackgroundJobRun,
  observeBusinessFlowStep,
} from "../routes/metricsState";
import {
  annotateSpanFailure,
  currentTraceContextLabels,
  withObservedSpan,
} from "./tracing";

function elapsedSeconds(startedAtMs: number | undefined): number | undefined {
  if (!Number.isFinite(startedAtMs)) return undefined;
  return Math.max(0, (Date.now() - Number(startedAtMs)) / 1000);
}

export function recordBusinessFlowStep(params: {
  flow: string;
  step: string;
  outcome: "success" | "failure" | "attempt" | "blocked";
  startedAtMs?: number;
}): void {
  const trace = currentTraceContextLabels();
  observeBusinessFlowStep({
    flow: params.flow,
    step: params.step,
    outcome: params.outcome,
    durationSec: elapsedSeconds(params.startedAtMs),
    traceID: trace.traceID,
    spanID: trace.spanID,
  });
}

export function recordOperationFailure(params: {
  operation: string;
  reason: string;
  flow?: string;
  step?: string;
  outcome?: "failure" | "blocked";
  startedAtMs?: number;
}): void {
  incOperationFailure(params.operation, params.reason);
  annotateSpanFailure(params.operation, params.reason);
  if (params.flow && params.step) {
    recordBusinessFlowStep({
      flow: params.flow,
      step: params.step,
      outcome: params.outcome ?? "failure",
      startedAtMs: params.startedAtMs,
    });
  }
}

export async function withObservedBackgroundJob<T>(params: {
  job: string;
  spanName?: string;
  attributes?: Record<string, string | number | boolean>;
  resolveOutcome?: (result: T) => "success" | "canceled";
  fn: () => Promise<T>;
}): Promise<T> {
  const startedAtMs = Date.now();
  changeBackgroundJobRunning(params.job, 1);
  try {
    const result = await withObservedSpan({
      name: params.spanName || `job.${params.job}`,
      attributes: {
        "tradehub.job": params.job,
        ...(params.attributes ?? {}),
      },
      fn: params.fn,
    });
    const outcome = params.resolveOutcome?.(result) ?? "success";
    const trace = currentTraceContextLabels();
    observeBackgroundJobRun({
      job: params.job,
      outcome,
      durationSec: Math.max(0, (Date.now() - startedAtMs) / 1000),
      traceID: trace.traceID,
      spanID: trace.spanID,
    });
    return result;
  } catch (error: any) {
    const reason = String(error?.message || error || "job_failed")
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "job_failed";
    recordOperationFailure({
      operation: params.job,
      reason,
    });
    const trace = currentTraceContextLabels();
    observeBackgroundJobRun({
      job: params.job,
      outcome: "failure",
      durationSec: Math.max(0, (Date.now() - startedAtMs) / 1000),
      traceID: trace.traceID,
      spanID: trace.spanID,
    });
    throw error;
  } finally {
    changeBackgroundJobRunning(params.job, -1);
  }
}
