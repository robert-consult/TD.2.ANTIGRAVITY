import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSurfaceAppLink, resolveSurfaceAppLink } from "@shared/appLinks";
import {
  LOCAL_ANDROID_EMULATOR_APP_BASE_URL,
  LOCAL_WEB_DEV_APP_BASE_URL,
  MOBILE_SESSION_POLL_INTERVAL_MS,
  PRODUCTION_APP_BASE_URL,
  STAGING_APP_BASE_URL,
  buildLoginPageUrl,
  buildVerifyEmailPageUrl,
  getWrapperAllowNavigationHosts,
  resolveNativeRuntimeBaseUrl,
  resolveServerAppBaseUrl,
  resolveWrapperRuntimeBaseUrl,
} from "@shared/appSurfaceConfig";
import { APP_CONFIG } from "../../WEBSITE/client/src/lib/app-config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("app surface config", () => {
  it("resolves server and wrapper base URLs with explicit precedence", () => {
    expect(resolveServerAppBaseUrl(undefined, { mode: "development" })).toBe(LOCAL_WEB_DEV_APP_BASE_URL);
    expect(resolveServerAppBaseUrl(undefined, { mode: "production" })).toBe(PRODUCTION_APP_BASE_URL);
    expect(
      resolveWrapperRuntimeBaseUrl({
        explicitBaseUrl: "https://staging.tradehub.example.com/",
        appBaseUrl: LOCAL_WEB_DEV_APP_BASE_URL,
        mode: "production",
      }),
    ).toBe(STAGING_APP_BASE_URL);
    expect(resolveWrapperRuntimeBaseUrl({ mode: "development" })).toBeNull();
  });

  it("resolves native runtime URLs by platform without hidden production fallback in dev", () => {
    expect(resolveNativeRuntimeBaseUrl({ platform: "ios", isDev: true })).toBe(LOCAL_WEB_DEV_APP_BASE_URL);
    expect(resolveNativeRuntimeBaseUrl({ platform: "android", isDev: true })).toBe(
      LOCAL_ANDROID_EMULATOR_APP_BASE_URL,
    );
    expect(resolveNativeRuntimeBaseUrl({ platform: "ios", isDev: false })).toBe(PRODUCTION_APP_BASE_URL);
  });

  it("builds canonical login and verify-email links from one owner", () => {
    expect(buildLoginPageUrl(PRODUCTION_APP_BASE_URL, "register")).toBe(
      "https://tradehub.example.com/login?tab=register",
    );
    expect(buildVerifyEmailPageUrl(STAGING_APP_BASE_URL, "abc123")).toBe(
      "https://staging.tradehub.example.com/verify-email?token=abc123",
    );
  });

  it("resolves wrapper and native links through the same route model with surface-specific allow lists", () => {
    expect(
      resolveSurfaceAppLink("https://tradehub.example.com/login?tab=register", {
        surface: "wrapper",
      }),
    ).toMatchObject({
      screen: "signup",
      appPath: "/login?tab=register",
    });

    expect(
      resolveSurfaceAppLink("https://tradehub.example.com/admin", {
        surface: "wrapper",
      }),
    ).toMatchObject({
      screen: "admin",
      appPath: "/admin",
    });

    expect(
      resolveSurfaceAppLink("https://tradehub.example.com/admin", {
        surface: "native",
      }),
    ).toBeNull();

    expect(
      resolveSurfaceAppLink(`${LOCAL_ANDROID_EMULATOR_APP_BASE_URL}/?tab=chart&symbol=eurusd`, {
        surface: "native",
        additionalBaseUrls: [LOCAL_ANDROID_EMULATOR_APP_BASE_URL],
      }),
    ).toMatchObject({
      screen: "chart",
      appPath: "/?tab=chart&symbol=EURUSD",
      schemeUrl: "tradequip://chart/EURUSD",
    });
  });

  it("builds canonical surface links without duplicating route-specific literals", () => {
    expect(buildSurfaceAppLink("signup", {}, { surface: "wrapper", baseUrl: STAGING_APP_BASE_URL })).toBe(
      "https://staging.tradehub.example.com/login?tab=register",
    );
    expect(buildSurfaceAppLink("mailbox", {}, { surface: "native" })).toBe(
      "tradequip://account?panel=mailbox",
    );
  });

  it("keeps website app config aligned with the canonical production app routes", () => {
    expect(APP_CONFIG).toEqual({
      tradingAppUrl: "https://tradehub.example.com/",
      loginUrl: "https://tradehub.example.com/login?tab=login",
      signupUrl: "https://tradehub.example.com/login?tab=register",
    });
  });

  it("keeps wrapper shell allow-list and platform shell manifests aligned with the canonical host", () => {
    const productionHost = new URL(PRODUCTION_APP_BASE_URL).host;
    const stagingHost = new URL(STAGING_APP_BASE_URL).host;
    expect(getWrapperAllowNavigationHosts(STAGING_APP_BASE_URL)).toEqual(
      expect.arrayContaining([productionHost, stagingHost]),
    );

    const shellFiles = [
      "MOBILE/android/app/src/main/AndroidManifest.xml",
      "MOBILE/android/app/src/main/res/xml/network_security_config.xml",
      "MOBILE/ios/App/App/Info.plist",
      "MOBILE/ios/App/App/App.entitlements",
      "NATIVE/android/app/src/main/AndroidManifest.xml",
      "NATIVE/ios/TradeQuipNative/Info.plist",
      "NATIVE/ios/TradeQuipNative/TradeQuipNative.entitlements",
    ];

    for (const relativePath of shellFiles) {
      const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
      expect(content).toContain(productionHost);
    }
  });

  it("keeps the shared mobile session poll interval explicit", () => {
    expect(MOBILE_SESSION_POLL_INTERVAL_MS).toBe(300_000);
  });
});
