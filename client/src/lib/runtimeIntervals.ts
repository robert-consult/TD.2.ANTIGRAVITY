import {
  resolvePerformanceSettings,
  tierFlushIntervalMs,
  tierPollIntervalMs,
  wsReconnectAttempts,
  wsReconnectBaseDelayMs,
  type PerfHints,
  type PerformanceSettings,
} from "@/lib/perfHints";

export type RuntimeIntervals = {
  quotes: {
    flushMs: number;
    restFallbackPollMs: number;
    permissionsRefreshMs: number;
  };
  quoteSubscriptions: {
    modePollMs: number;
  };
  trades: {
    restFallbackPollMs: number;
  };
  accountSummary: {
    restFallbackPollMs: number;
  };
  pendingOrders: {
    restFallbackPollMs: number;
  };
  leaderboard: {
    modePollMs: number;
    entriesPollMs: number;
  };
  admin: {
    standardPollMs: number;
    fastPollMs: number;
  };
  ws: {
    reconnectBaseDelayMs: number;
    reconnectAttempts: number;
  };
};

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return min;
  return Math.max(min, Math.min(max, rounded));
}

function resolvePermissionRefreshMs(hints: PerfHints): number {
  switch (hints.networkTier) {
    case "INSTANT":
    case "FAST":
      return 10_000;
    case "MODERATE":
      return 15_000;
    case "CONSTRAINED":
    case "MINIMAL":
      return 20_000;
  }
}

function resolveLeaderboardPollMs(restFallbackPollMs: number): number {
  return clampInt(restFallbackPollMs * 20, 15_000, 45_000);
}

function resolveAdminFastPollMs(restFallbackPollMs: number): number {
  return clampInt(restFallbackPollMs * 4, 5_000, 15_000);
}

export function resolveRuntimeIntervals(
  hints: PerfHints,
  settingsInput?: unknown,
): RuntimeIntervals {
  const settings: PerformanceSettings = resolvePerformanceSettings(settingsInput);
  const restFallbackPollMs = tierPollIntervalMs(settings.restFallbackPollMs, hints, settings);

  return {
    quotes: {
      flushMs: tierFlushIntervalMs(hints, settings),
      restFallbackPollMs,
      permissionsRefreshMs: resolvePermissionRefreshMs(hints),
    },
    quoteSubscriptions: {
      modePollMs: resolvePermissionRefreshMs(hints),
    },
    trades: {
      restFallbackPollMs,
    },
    accountSummary: {
      restFallbackPollMs,
    },
    pendingOrders: {
      restFallbackPollMs,
    },
    leaderboard: {
      modePollMs: resolveLeaderboardPollMs(restFallbackPollMs),
      entriesPollMs: resolveLeaderboardPollMs(restFallbackPollMs),
    },
    admin: {
      standardPollMs: resolveLeaderboardPollMs(restFallbackPollMs),
      fastPollMs: resolveAdminFastPollMs(restFallbackPollMs),
    },
    ws: {
      reconnectBaseDelayMs: wsReconnectBaseDelayMs(hints, settings),
      reconnectAttempts: wsReconnectAttempts(settings),
    },
  };
}
