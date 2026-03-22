import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOLVED_TRADING_RISK_CONFIG,
  isTradingAllowedBySchedule,
  resolveEffectiveMinHoldSec,
  resolveEffectiveTradeLeverage,
  resolveTradeConcurrencyLimits,
  resolveTradingRiskConfig,
} from "@shared/tradingRiskConfig";

describe("tradingRiskConfig", () => {
  it("resolves canonical defaults from one shared owner", () => {
    expect(resolveTradingRiskConfig()).toEqual(DEFAULT_RESOLVED_TRADING_RISK_CONFIG);
  });

  it("normalizes invalid values to bounded defaults", () => {
    const resolved = resolveTradingRiskConfig({
      defaultLeverage: -1,
      maxPositionSize: "nope",
      maxTradesPerUser: 0,
      maxTradesPerInstrument: -5,
      maxConcurrentLots: -10,
      minPriceDistancePips: "bad",
      marketOpenTime: "99:99",
      marketCloseTime: "1pm",
      allowWeekendTrading: "true",
      minHoldSec: -3,
      enableLossLimits: "false",
      dailyLossLimitPct: -1,
      lifetimeLossLimitPct: 999,
    });

    expect(resolved).toEqual({
      ...DEFAULT_RESOLVED_TRADING_RISK_CONFIG,
      defaultLeverage: 0.01,
      maxTradesPerUser: 1,
      maxTradesPerInstrument: 1,
      maxConcurrentLots: 1,
      allowWeekendTrading: true,
      minHoldSec: 1,
      enableLossLimits: false,
      dailyLossLimitPct: 0,
      lifetimeLossLimitPct: 100,
    });
  });

  it("applies user overrides over global trade concurrency limits", () => {
    const limits = resolveTradeConcurrencyLimits(
      {
        maxTradesPerUser: 10,
        maxTradesPerInstrument: 3,
        maxConcurrentLots: 50,
        minHoldSec: 60,
        dailyLossLimitPct: 10,
        lifetimeLossLimitPct: 20,
        enableLossLimits: true,
      },
      {
        maxConcurrent: 12,
        maxConcurrentPerInstrument: 4,
        maxConcurrentLots: 80,
        minHoldSec: 120,
      },
    );

    expect(limits).toEqual({
      maxTradesPerUser: 12,
      maxTradesPerInstrument: 4,
      maxConcurrentLots: 80,
      minHoldSec: 120,
      enableLossLimits: true,
      dailyLossLimitPct: 10,
      lifetimeLossLimitPct: 20,
    });
    expect(resolveEffectiveMinHoldSec(DEFAULT_RESOLVED_TRADING_RISK_CONFIG, { minHoldSec: 90 })).toBe(90);
  });

  it("resolves effective leverage from one normalized rule path", () => {
    expect(resolveEffectiveTradeLeverage({ defaultLeverage: 50 }, undefined, undefined)).toBe(50);
    expect(resolveEffectiveTradeLeverage({ defaultLeverage: 50 }, 75, 0.5)).toBe(37.5);
    expect(resolveEffectiveTradeLeverage({ defaultLeverage: 50 }, "bad", 0)).toBe(0.5);
  });

  it("enforces market schedule consistently for normal and overnight sessions", () => {
    expect(
      isTradingAllowedBySchedule(
        { marketOpenTime: "09:00", marketCloseTime: "17:00", allowWeekendTrading: false },
        new Date("2026-03-18T12:00:00.000Z"),
      ),
    ).toEqual({ allowed: true, reason: "" });

    expect(
      isTradingAllowedBySchedule(
        { marketOpenTime: "09:00", marketCloseTime: "17:00", allowWeekendTrading: false },
        new Date("2026-03-21T12:00:00.000Z"),
      ),
    ).toEqual({
      allowed: false,
      reason: "Weekend trading is disabled. Markets open Monday.",
    });

    expect(
      isTradingAllowedBySchedule(
        { marketOpenTime: "22:00", marketCloseTime: "05:00", allowWeekendTrading: true },
        new Date("2026-03-18T23:30:00.000Z"),
      ),
    ).toEqual({ allowed: true, reason: "" });
  });
});
