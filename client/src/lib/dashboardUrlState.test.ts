import { describe, expect, it } from "vitest";
import { PRODUCTION_APP_BASE_URL } from "@shared/appSurfaceConfig";
import {
  areDashboardRouteStatesEqual,
  buildDashboardUrl,
  normalizeDashboardRouteState,
  readDashboardRouteState,
} from "./dashboardUrlState";

describe("dashboardUrlState", () => {
  it("builds clean dashboard urls for supported tabs", () => {
    expect(buildDashboardUrl({ tab: "quotes" })).toBe("/");
    expect(buildDashboardUrl({ tab: "trade", symbol: "usdjpy" })).toBe("/?tab=trade&symbol=USDJPY");
    expect(buildDashboardUrl({ tab: "account", panel: "mailbox" })).toBe("/?tab=account&panel=mailbox");
  });

  it("drops stale symbol and panel values when the tab does not use them", () => {
    expect(
      normalizeDashboardRouteState({
        tab: "history",
        symbol: "USDJPY",
        panel: "mailbox",
      }),
    ).toEqual({ tab: "history" });
  });

  it("reads query-backed dashboard state from urls", () => {
    const state = readDashboardRouteState(
      new URL(`${PRODUCTION_APP_BASE_URL}/?tab=chart&symbol=eurusd`),
    );
    expect(state).toEqual({
      tab: "chart",
      symbol: "EURUSD",
    });
  });

  it("treats equivalent normalized route states as equal", () => {
    expect(
      areDashboardRouteStatesEqual(
        { tab: "quotes", symbol: "USDJPY" },
        { tab: "quotes" },
      ),
    ).toBe(true);
  });
});
