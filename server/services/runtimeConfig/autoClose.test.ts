// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../globalSettings", () => ({
  getGlobalSettingsCached: vi.fn(async () => null),
}));

import {
  getAutoCloseDeployGuards,
  resolveAutoClosePolicy,
} from "./autoClose";

const ORIGINAL_STALE_DEFER = process.env.AUTOCLOSE_STALE_DEFER_MAX_MIN;
const ORIGINAL_ALLOW_STALE = process.env.AUTOCLOSE_ALLOW_STALE_CLOSE;

describe("auto-close runtime config", () => {
  afterEach(() => {
    process.env.AUTOCLOSE_STALE_DEFER_MAX_MIN = ORIGINAL_STALE_DEFER;
    process.env.AUTOCLOSE_ALLOW_STALE_CLOSE = ORIGINAL_ALLOW_STALE;
  });

  it("normalizes business-owned auto-close policy from global settings", () => {
    const policy = resolveAutoClosePolicy({
      enableAutoClose: 0 as any,
      autoCloseAfterDays: -1,
      autoCloseCheckFrequencyMinutes: 99999,
    } as any);

    expect(policy).toEqual({
      enableAutoClose: false,
      autoCloseAfterDays: 1,
      autoCloseCheckFrequencyMinutes: 24 * 60,
    });
  });

  it("reads deploy-owned stale-close guards from the environment", () => {
    process.env.AUTOCLOSE_STALE_DEFER_MAX_MIN = "15";
    process.env.AUTOCLOSE_ALLOW_STALE_CLOSE = "true";

    expect(getAutoCloseDeployGuards()).toEqual({
      staleDeferMaxMinutes: 15,
      allowStaleClose: true,
    });
  });
});
