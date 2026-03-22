/**
 * Deep-link parsing for the Capacitor wrapper.
 * Wrapper navigation must resolve onto live web routes rather than shadow wrapper screens.
 */

import { App, URLOpenListenerEvent } from "@capacitor/app";
import {
  buildSurfaceAppLink,
  resolveSurfaceAppLink,
  type AppLinkScreen,
} from "@shared/appLinks";
import { PRODUCTION_APP_BASE_URL } from "@shared/appSurfaceConfig";
import { isNativeApp } from "./mobile-utils";

export interface DeepLinkRoute {
  screen: AppLinkScreen;
}

export interface DeepLinkResult {
  screen: string;
  params: Record<string, string>;
  appPath: string;
  originalUrl: string;
}

function normalizeDeepLinkScreen(raw: string): AppLinkScreen {
  const screen = String(raw || "").trim().toLowerCase();
  switch (screen) {
    case "chart":
    case "trade":
    case "history":
    case "leaderboard":
    case "account":
    case "mailbox":
    case "profile":
    case "journal":
    case "verify-email":
    case "signin":
    case "signup":
    case "partner":
    case "admin":
      return screen;
    case "settings":
      return "profile";
    case "register":
      return "signup";
    case "login":
      return "signin";
    default:
      return "quotes";
  }
}

export function parseDeepLink(url: string): DeepLinkResult | null {
  const resolved = resolveSurfaceAppLink(url, {
    surface: "wrapper",
    baseUrl: PRODUCTION_APP_BASE_URL,
  });

  if (!resolved) {
    return null;
  }

  return {
    screen: resolved.screen,
    params: resolved.params,
    appPath: resolved.appPath,
    originalUrl: url,
  };
}

export function initDeepLinking(onNavigate: (result: DeepLinkResult) => void): () => void {
  if (!isNativeApp()) {
    return () => {};
  }

  const listener = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
    const result = parseDeepLink(event.url);
    if (result) {
      onNavigate(result);
    }
  });

  void App.getLaunchUrl().then((launchUrl) => {
    if (!launchUrl?.url) return;
    const result = parseDeepLink(launchUrl.url);
    if (result) {
      onNavigate(result);
    }
  });

  return () => {
    void listener.then((handle) => handle.remove());
  };
}

export function generateDeepLink(
  screen: string,
  params?: Record<string, string>,
): string {
  return buildSurfaceAppLink(normalizeDeepLinkScreen(screen), params ?? {}, {
    surface: "wrapper",
    baseUrl: PRODUCTION_APP_BASE_URL,
  });
}
