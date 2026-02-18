import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perfHints", () => ({
  computeWsReconnectDelayMs: vi.fn((attempt: number, baseMs: number) => {
    return baseMs + attempt * 10;
  }),
}));

import { computeWsReconnectDelayMs } from "@/lib/perfHints";
import { useWebSocket } from "@/hooks/use-websocket";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "closed" } as CloseEvent);
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

describe("useWebSocket adaptive reconnect behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("does not tear down an active socket when reconnect settings change", () => {
    const { rerender, unmount } = renderHook(
      ({ reconnectInterval, reconnectAttempts }) =>
        useWebSocket("ws://localhost/ws", {
          enabled: true,
          reconnectInterval,
          reconnectAttempts,
        }),
      {
        initialProps: { reconnectInterval: 1200, reconnectAttempts: 10 },
      },
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];

    rerender({ reconnectInterval: 4800, reconnectAttempts: 3 });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.close).not.toHaveBeenCalled();

    unmount();
  });

  it("uses latest reconnect interval after options update", () => {
    const { rerender, unmount } = renderHook(
      ({ reconnectInterval, reconnectAttempts }) =>
        useWebSocket("ws://localhost/ws", {
          enabled: true,
          reconnectInterval,
          reconnectAttempts,
        }),
      {
        initialProps: { reconnectInterval: 1000, reconnectAttempts: 5 },
      },
    );

    const socket = MockWebSocket.instances[0];
    rerender({ reconnectInterval: 3500, reconnectAttempts: 1 });

    act(() => {
      socket.onclose?.({ code: 1006, reason: "network" } as CloseEvent);
    });

    expect(computeWsReconnectDelayMs).toHaveBeenCalledWith(0, 3500);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(MockWebSocket.instances).toHaveLength(2);
    unmount();
  });

  it("never reconnects to a stale URL after the URL prop changes", () => {
    const { rerender, unmount } = renderHook(
      ({ url }) =>
        useWebSocket(url, {
          enabled: true,
          reconnectInterval: 1000,
          reconnectAttempts: 3,
        }),
      {
        initialProps: { url: "ws://localhost/old" },
      },
    );

    const firstSocket = MockWebSocket.instances[0];
    act(() => {
      firstSocket.onclose?.({ code: 1006, reason: "network" } as CloseEvent);
    });

    rerender({ url: "ws://localhost/new" });

    const latestSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(latestSocket.url).toBe("ws://localhost/new");

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const oldUrlReconnects = MockWebSocket.instances.filter((ws) => ws.url === "ws://localhost/old");
    expect(oldUrlReconnects).toHaveLength(1);
    unmount();
  });
});
