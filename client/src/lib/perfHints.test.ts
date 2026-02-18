import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushIntervalForTier,
  getPerfHints,
  pollIntervalForTier,
  refreshPerfHints,
  resolvePerformanceSettings,
  subscribeHints,
} from "@/lib/perfHints";

type ConnectionLike = {
  effectiveType: string;
  saveData: boolean;
  rtt: number;
  downlink: number;
  addEventListener: (event: "change", listener: () => void) => void;
  removeEventListener: (event: "change", listener: () => void) => void;
};

const connectionListeners = new Set<() => void>();
const mockConnection: ConnectionLike = {
  effectiveType: "4g",
  saveData: false,
  rtt: 40,
  downlink: 20,
  addEventListener: (_event, listener) => {
    connectionListeners.add(listener);
  },
  removeEventListener: (_event, listener) => {
    connectionListeners.delete(listener);
  },
};

const nav = navigator as any;
let originalConnectionDescriptor: PropertyDescriptor | undefined;
let originalDeviceMemoryDescriptor: PropertyDescriptor | undefined;
let originalHardwareConcurrencyDescriptor: PropertyDescriptor | undefined;

function emitConnectionChange() {
  for (const listener of Array.from(connectionListeners)) {
    listener();
  }
}

function setNavigatorProfile(options: {
  effectiveType: string;
  saveData: boolean;
  rtt: number;
  downlink: number;
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
}) {
  mockConnection.effectiveType = options.effectiveType;
  mockConnection.saveData = options.saveData;
  mockConnection.rtt = options.rtt;
  mockConnection.downlink = options.downlink;
  Object.defineProperty(nav, "deviceMemory", {
    configurable: true,
    value: options.deviceMemoryGB == null ? undefined : options.deviceMemoryGB,
  });
  Object.defineProperty(nav, "hardwareConcurrency", {
    configurable: true,
    value: options.hardwareConcurrency == null ? undefined : options.hardwareConcurrency,
  });
}

describe("perfHints", () => {
  beforeAll(() => {
    originalConnectionDescriptor = Object.getOwnPropertyDescriptor(nav, "connection");
    originalDeviceMemoryDescriptor = Object.getOwnPropertyDescriptor(nav, "deviceMemory");
    originalHardwareConcurrencyDescriptor = Object.getOwnPropertyDescriptor(nav, "hardwareConcurrency");

    Object.defineProperty(nav, "connection", {
      configurable: true,
      value: mockConnection,
    });
  });

  afterAll(() => {
    if (originalConnectionDescriptor) {
      Object.defineProperty(nav, "connection", originalConnectionDescriptor);
    }
    if (originalDeviceMemoryDescriptor) {
      Object.defineProperty(nav, "deviceMemory", originalDeviceMemoryDescriptor);
    }
    if (originalHardwareConcurrencyDescriptor) {
      Object.defineProperty(nav, "hardwareConcurrency", originalHardwareConcurrencyDescriptor);
    }
    connectionListeners.clear();
  });

  beforeEach(() => {
    setNavigatorProfile({
      effectiveType: "4g",
      saveData: false,
      rtt: 40,
      downlink: 20,
      deviceMemoryGB: 16,
      hardwareConcurrency: 12,
    });
    refreshPerfHints();
  });

  it("classifies desktop-grade profiles as INSTANT", () => {
    const hints = getPerfHints();
    expect(hints.networkTier).toBe("INSTANT");
    expect(hints.deviceTier).toBe("INSTANT");
    expect(hints.tier).toBe("INSTANT");
    expect(hints.isConstrained).toBe(false);
  });

  it("separates network and device constraints", () => {
    setNavigatorProfile({
      effectiveType: "4g",
      saveData: false,
      rtt: 45,
      downlink: 30,
      deviceMemoryGB: 2,
      hardwareConcurrency: 2,
    });
    const hints = refreshPerfHints();
    expect(hints.networkTier).toBe("INSTANT");
    expect(hints.deviceTier).toBe("CONSTRAINED");
    expect(hints.tier).toBe("MODERATE");
    expect(hints.isNetworkConstrained).toBe(false);
    expect(hints.isDeviceConstrained).toBe(true);
  });

  it("recomputes hints when connection change events fire", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHints(listener);

    mockConnection.effectiveType = "3g";
    mockConnection.rtt = 800;
    mockConnection.downlink = 0.5;
    emitConnectionChange();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPerfHints().networkTier).toBe("CONSTRAINED");
    unsubscribe();
  });

  it("classifies 3g networks as constrained, not minimal", () => {
    setNavigatorProfile({
      effectiveType: "3g",
      saveData: false,
      rtt: 220,
      downlink: 3,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
    });
    const hints = refreshPerfHints();
    expect(hints.networkTier).toBe("CONSTRAINED");
  });

  it("keeps 150ms RTT links in FAST tier when throughput is healthy", () => {
    setNavigatorProfile({
      effectiveType: "4g",
      saveData: false,
      rtt: 150,
      downlink: 6,
      deviceMemoryGB: 8,
      hardwareConcurrency: 8,
    });
    const hints = refreshPerfHints();
    expect(hints.networkTier).toBe("FAST");
  });

  it("treats 3GB devices with unknown core count as MODERATE", () => {
    setNavigatorProfile({
      effectiveType: "4g",
      saveData: false,
      rtt: 40,
      downlink: 20,
      deviceMemoryGB: 3,
      hardwareConcurrency: null,
    });
    const hints = refreshPerfHints();
    expect(hints.deviceTier).toBe("MODERATE");
    expect(hints.tier).toBe("MODERATE");
  });

  it("keeps snapshot identity stable when hints are unchanged", () => {
    const first = refreshPerfHints();
    const second = refreshPerfHints();
    expect(second).toBe(first);
  });

  it("maps poll and flush intervals by tier", () => {
    expect(pollIntervalForTier("INSTANT", 500)).toBe(200);
    expect(pollIntervalForTier("FAST", 500)).toBe(500);
    expect(pollIntervalForTier("FAST", 2000)).toBe(500);
    expect(pollIntervalForTier("MODERATE", 200)).toBe(1500);
    expect(pollIntervalForTier("MODERATE", 9000)).toBe(6000);
    expect(pollIntervalForTier("CONSTRAINED", 500)).toBe(4000);
    expect(pollIntervalForTier("MINIMAL", 500)).toBe(6000);

    expect(flushIntervalForTier("INSTANT", 50)).toBe(50);
    expect(flushIntervalForTier("FAST", 50)).toBe(150);
    expect(flushIntervalForTier("CONSTRAINED", 50)).toBe(500);
    expect(flushIntervalForTier("MINIMAL", 50)).toBe(1000);
  });

  it("defaults unknown tiers to MODERATE safeguards", () => {
    expect(pollIntervalForTier("UNKNOWN" as any, 500)).toBe(1500);
    expect(flushIntervalForTier("UNKNOWN" as any, 50)).toBe(300);
  });

  it("honors explicit admin tier overrides", () => {
    const overrides = {
      pollInstantMs: 150,
      pollFastMs: 420,
      pollModerateMs: 1800,
      pollConstrainedMs: 4500,
      pollMinimalMs: 7000,
      flushInstantMs: 40,
      flushFastMs: 120,
      flushModerateMs: 280,
      flushConstrainedMs: 560,
      flushMinimalMs: 1100,
    };
    expect(pollIntervalForTier("FAST", 500, overrides)).toBe(420);
    expect(pollIntervalForTier("MINIMAL", 500, overrides)).toBe(7000);
    expect(flushIntervalForTier("INSTANT", 50, overrides)).toBe(40);
    expect(flushIntervalForTier("CONSTRAINED", 50, overrides)).toBe(560);
  });

  it("derives tier defaults from base poll/flush when overrides are absent", () => {
    const resolved = resolvePerformanceSettings({
      restFallbackPollMs: 900,
      quoteFlushIntervalMs: 80,
    });
    expect(resolved.pollInstantMs).toBe(200);
    expect(resolved.pollFastMs).toBe(500);
    expect(resolved.pollModerateMs).toBe(1500);
    expect(resolved.pollConstrainedMs).toBe(4000);
    expect(resolved.flushFastMs).toBe(240);
    expect(resolved.flushConstrainedMs).toBe(800);
  });
});
