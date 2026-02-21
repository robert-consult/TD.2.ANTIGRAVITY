import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { LiveUpdatesProvider } from "@/live/LiveUpdatesProvider";
import { WS_MSG_AUTH_HELLO } from "@shared/ws/protocol";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
}));

vi.mock("@/lib/wsUrl", () => ({
  getWsUrl: () => "ws://localhost/ws",
}));

vi.mock("@/lib/perfHints", () => ({
  usePerfHints: vi.fn(() => ({ tier: "CONSTRAINED" })),
  wsReconnectBaseDelayMs: vi.fn(() => 3000),
  wsReconnectAttempts: vi.fn(() => 30),
}));

vi.mock("@/hooks/use-performance-settings", () => ({
  usePerformanceSettings: vi.fn(() => ({
    restFallbackPollMs: 500,
    wsPushFrequencyMs: 0,
    quoteFlushIntervalMs: 50,
    maxWsReconnectAttempts: 30,
    wsReconnectBaseDelayMs: 1500,
    prefetchStrategy: "all",
    prefetchMaxConcurrency: 4,
    prefetchStartDelayMs: 0,
    prefetchFastConcurrencyCap: 3,
    prefetchModerateConcurrencyCap: 2,
    prefetchConstrainedConcurrencyCap: 1,
    prefetchNetworkFastStartDelayMs: 75,
    prefetchNetworkModerateStartDelayMs: 200,
    prefetchNetworkConstrainedStartDelayMs: 450,
    prefetchDeviceModerateStartDelayMs: 50,
    prefetchDeviceConstrainedStartDelayMs: 150,
    prefetchDeviceMinimalStartDelayMs: 300,
    pollInstantMs: 200,
    pollFastMs: 500,
    pollModerateMs: 1500,
    pollConstrainedMs: 4000,
    pollMinimalMs: 6000,
    flushInstantMs: 50,
    flushFastMs: 150,
    flushModerateMs: 300,
    flushConstrainedMs: 500,
    flushMinimalMs: 1000,
  })),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: vi.fn(),
}));

import { useWebSocket } from "@/hooks/use-websocket";

function Harness({ children }: { children?: ReactNode }) {
  return <LiveUpdatesProvider>{children ?? <div data-testid="child" />}</LiveUpdatesProvider>;
}

describe("LiveUpdatesProvider", () => {
  beforeEach(() => {
    vi.mocked(useWebSocket).mockReset();
  });

  it("uses adaptive reconnect delay and attempt cap", () => {
    vi.mocked(useWebSocket).mockReturnValue({
      isConnected: false,
      sendMessage: vi.fn(),
      error: null,
    });

    render(<Harness />);

    expect(useWebSocket).toHaveBeenCalledWith(
      "ws://localhost/ws",
      expect.objectContaining({
        enabled: true,
        reconnectInterval: 3000,
        reconnectAttempts: 30,
      }),
    );
  });

  it("sends auth hello after websocket connects", async () => {
    const sendMessage = vi.fn();
    vi.mocked(useWebSocket).mockReturnValue({
      isConnected: true,
      sendMessage,
      error: null,
    });

    render(<Harness />);

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({ type: WS_MSG_AUTH_HELLO });
    });
  });
});
