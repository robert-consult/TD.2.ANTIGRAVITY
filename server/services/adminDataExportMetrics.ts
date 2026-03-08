import { nowSec } from "@shared/scalars";

type ExportMetricsState = {
  createdTotal: number;
  dedupedTotal: number;
  startedTotal: number;
  succeededTotal: number;
  failedTotal: number;
  canceledTotal: number;
  expiredTotal: number;
  retentionSweepTotal: number;
  retentionExpiredTotal: number;
  runningGauge: number;
  queueWaiting: number;
  queueActive: number;
  queueDelayed: number;
  queueFailed: number;
  queueCompleted: number;
  bytesWrittenTotal: number;
  lastJobDurationMs: number;
  lastSuccessAtSec: number;
  lastFailureAtSec: number;
};

const state: ExportMetricsState = {
  createdTotal: 0,
  dedupedTotal: 0,
  startedTotal: 0,
  succeededTotal: 0,
  failedTotal: 0,
  canceledTotal: 0,
  expiredTotal: 0,
  retentionSweepTotal: 0,
  retentionExpiredTotal: 0,
  runningGauge: 0,
  queueWaiting: 0,
  queueActive: 0,
  queueDelayed: 0,
  queueFailed: 0,
  queueCompleted: 0,
  bytesWrittenTotal: 0,
  lastJobDurationMs: 0,
  lastSuccessAtSec: 0,
  lastFailureAtSec: 0,
};

export function onAdminExportJobCreated(params: { deduped: boolean }): void {
  state.createdTotal += 1;
  if (params.deduped) state.dedupedTotal += 1;
}

export function onAdminExportJobStarted(): void {
  state.startedTotal += 1;
  state.runningGauge += 1;
}

export function onAdminExportJobFinished(params: { success: boolean; canceled?: boolean; durationMs?: number }): void {
  state.runningGauge = Math.max(0, state.runningGauge - 1);
  if (Number.isFinite(params.durationMs) && Number(params.durationMs) >= 0) {
    state.lastJobDurationMs = Math.trunc(Number(params.durationMs));
  }

  if (params.canceled) {
    state.canceledTotal += 1;
    return;
  }

  if (params.success) {
    state.succeededTotal += 1;
    state.lastSuccessAtSec = nowSec();
  } else {
    state.failedTotal += 1;
    state.lastFailureAtSec = nowSec();
  }
}

export function onAdminExportJobExpired(): void {
  state.expiredTotal += 1;
}

export function onAdminExportRetentionSweep(params: { expiredCount: number }): void {
  state.retentionSweepTotal += 1;
  state.retentionExpiredTotal += Math.max(0, Math.trunc(params.expiredCount || 0));
}

export function setAdminExportQueueDepth(params: {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}): void {
  state.queueWaiting = Math.max(0, Math.trunc(params.waiting || 0));
  state.queueActive = Math.max(0, Math.trunc(params.active || 0));
  state.queueDelayed = Math.max(0, Math.trunc(params.delayed || 0));
  state.queueFailed = Math.max(0, Math.trunc(params.failed || 0));
  state.queueCompleted = Math.max(0, Math.trunc(params.completed || 0));
}

export function onAdminExportBytesWritten(bytesWritten: number): void {
  const delta = Math.max(0, Math.trunc(Number(bytesWritten) || 0));
  if (delta <= 0) return;
  state.bytesWrittenTotal += delta;
}

export function getAdminExportMetricsSnapshot(): ExportMetricsState {
  return { ...state };
}
