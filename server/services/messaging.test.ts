// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const mockState = {
    insertedRows: [] as Array<Record<string, unknown>>,
    publishedEvents: [] as Array<Record<string, unknown>>,
    settings: {
      notificationsEnabled: true,
      notificationRealtimeEnabled: true,
      notificationSoundDefaultEnabled: true,
      notificationE2eeEnabled: false,
      notificationE2eeRequired: false,
      notificationTradePendingFillEnabled: true,
      notificationTradeTakeProfitEnabled: true,
      notificationTradeStopLossEnabled: true,
      notificationTradeMaxHoldEnabled: true,
      notificationAccountFreezeEnabled: true,
      notificationAccountUnfreezeEnabled: true,
      notificationKycUpdatesEnabled: true,
      notificationChallengeEnabled: true,
    } as Record<string, unknown>,
    nowSec: 1_741_513_600,
    insert: vi.fn(),
    getCommunicationSettings: vi.fn(async () => mockState.settings),
    publishLiveEvent: vi.fn((event: Record<string, unknown>) => {
      mockState.publishedEvents.push(event);
    }),
  };

  mockState.insert.mockImplementation(() => ({
    values: (values: Record<string, unknown>) => {
      const row = { id: mockState.insertedRows.length + 1, ...values };
      mockState.insertedRows.push(row);
      return {
        returning: async () => [row],
      };
    },
  }));

  return mockState;
});

vi.mock("@db", () => ({
  db: {
    insert: state.insert,
  },
  dbClient: {},
}));

vi.mock("./liveBus", () => ({
  publishLiveEvent: state.publishLiveEvent,
}));

vi.mock("./messagingSettings", () => ({
  getCommunicationSettings: state.getCommunicationSettings,
  invalidateCommunicationSettingsCache: vi.fn(),
  updateCommunicationSettings: vi.fn(),
}));

vi.mock("./crypto", () => ({
  encryptString: (value: string) => `enc:${value}`,
  decryptString: (value: string) => value.replace(/^enc:/, ""),
  sha256Hex: (value: string) => `sha:${value}`,
}));

vi.mock("@shared/scalars", () => ({
  clampIntOr: (value: unknown, fallback: number, min: number, max: number) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(numeric)));
  },
  nowSec: () => state.nowSec,
}));

import { createNotification } from "./messaging";

describe("createNotification", () => {
  beforeEach(() => {
    state.insertedRows = [];
    state.publishedEvents = [];
    state.insert.mockClear();
    state.getCommunicationSettings.mockClear();
    state.publishLiveEvent.mockClear();
    state.settings = {
      notificationsEnabled: true,
      notificationRealtimeEnabled: true,
      notificationSoundDefaultEnabled: true,
      notificationE2eeEnabled: false,
      notificationE2eeRequired: false,
      notificationTradePendingFillEnabled: true,
      notificationTradeTakeProfitEnabled: true,
      notificationTradeStopLossEnabled: true,
      notificationTradeMaxHoldEnabled: true,
      notificationAccountFreezeEnabled: true,
      notificationAccountUnfreezeEnabled: true,
      notificationKycUpdatesEnabled: true,
      notificationChallengeEnabled: true,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips disabled stop-loss notifications", async () => {
    state.settings = {
      ...state.settings,
      notificationTradeStopLossEnabled: false,
    };

    const result = await createNotification({
      userId: 7,
      type: "TRADE",
      severity: "warning",
      title: "Stop loss hit",
      message: "Trade 77 closed by risk controls.",
      sourceEvent: "STOP_LOSS_HIT:77",
    });

    expect(result).toBeNull();
    expect(state.insert).not.toHaveBeenCalled();
    expect(state.publishedEvents).toHaveLength(0);
  });

  it("stores encrypted notification content and publishes a decoded realtime payload", async () => {
    const result = await createNotification({
      userId: 7,
      type: "ACCOUNT",
      severity: "critical",
      title: "  Account frozen  ",
      message: "  Review account immediately.  ",
      link: "/account/security",
      sourceEvent: "ACCOUNT_FREEZE:7",
      playSound: false,
    });

    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      userId: 7,
      type: "ACCOUNT",
      severity: "CRITICAL",
      title: "Encrypted notification",
      message: "Encrypted notification",
      titleEncrypted: "enc:Account frozen",
      messageEncrypted: "enc:Review account immediately.",
      contentEncoding: "ATREST_AES256GCM_V1",
      contentDigestSha256: "sha:Account frozen\nReview account immediately.",
      createdAt: state.nowSec,
    });

    expect(result).toMatchObject({
      id: 1,
      type: "ACCOUNT",
      severity: "CRITICAL",
      title: "Account frozen",
      message: "Review account immediately.",
      link: "/account/security",
      sourceEvent: "ACCOUNT_FREEZE:7",
    });
    expect(state.publishedEvents).toHaveLength(1);
    expect(state.publishedEvents[0]).toMatchObject({
      type: "notifications:new",
      userId: 7,
      payload: {
        id: 1,
        type: "ACCOUNT",
        severity: "CRITICAL",
        title: "Account frozen",
        message: "Review account immediately.",
        playSound: false,
      },
    });
  });
});
