/**
 * Deep-link parsing for the Capacitor wrapper.
 * Wrapper navigation must resolve onto live web routes rather than shadow wrapper screens.
 */

import { App, URLOpenListenerEvent } from "@capacitor/app";
import { isNativeApp } from "./mobile-utils";

const CANONICAL_WEB_HOST = "tradehub.example.com";
const CANONICAL_SCHEME = "tradequip:";

type DeepLinkMatch = {
  screen: string;
  params: Record<string, string>;
  appPath: string;
};

export interface DeepLinkRoute {
  pattern: RegExp;
  handler: (matches: RegExpMatchArray, parsed: URL) => DeepLinkMatch;
}

const deepLinkRoutes: DeepLinkRoute[] = [
  {
    pattern: /^\/?$/i,
    handler: (_matches, parsed) => ({
      screen: "quotes",
      params: {},
      appPath: parsed.search || parsed.hash ? `/${parsed.search}${parsed.hash}` : "/",
    }),
  },
  {
    pattern: /^\/(?:home|dashboard|quotes)$/i,
    handler: () => ({
      screen: "quotes",
      params: {},
      appPath: "/",
    }),
  },
  {
    pattern: /^\/chart\/([A-Z0-9._-]{3,16})$/i,
    handler: (matches) => {
      const symbol = matches[1].toUpperCase();
      return {
        screen: "chart",
        params: { symbol },
        appPath: `/?tab=chart&symbol=${encodeURIComponent(symbol)}`,
      };
    },
  },
  {
    pattern: /^\/trade\/([A-Z0-9._-]{3,16})$/i,
    handler: (matches) => {
      const symbol = matches[1].toUpperCase();
      return {
        screen: "trade",
        params: { symbol },
        appPath: `/?tab=trade&symbol=${encodeURIComponent(symbol)}`,
      };
    },
  },
  {
    pattern: /^\/history$/i,
    handler: () => ({
      screen: "history",
      params: {},
      appPath: "/?tab=history",
    }),
  },
  {
    pattern: /^\/leaderboard$/i,
    handler: () => ({
      screen: "leaderboard",
      params: {},
      appPath: "/?tab=leaderboard",
    }),
  },
  {
    pattern: /^\/account$/i,
    handler: () => ({
      screen: "account",
      params: {},
      appPath: "/?tab=account",
    }),
  },
  {
    pattern: /^\/(?:account\/mailbox|mailbox)$/i,
    handler: () => ({
      screen: "mailbox",
      params: { panel: "mailbox" },
      appPath: "/?tab=account&panel=mailbox",
    }),
  },
  {
    pattern: /^\/(?:settings|profile)$/i,
    handler: () => ({
      screen: "profile",
      params: {},
      appPath: "/profile",
    }),
  },
  {
    pattern: /^\/journal$/i,
    handler: () => ({
      screen: "journal",
      params: {},
      appPath: "/journal",
    }),
  },
  {
    pattern: /^\/verify-email$/i,
    handler: (_matches, parsed) => ({
      screen: "verify-email",
      params: parsed.searchParams.get("token")
        ? { token: String(parsed.searchParams.get("token")) }
        : {},
      appPath: `/verify-email${parsed.search}`,
    }),
  },
  {
    pattern: /^\/partner$/i,
    handler: (_matches, parsed) => ({
      screen: "partner",
      params: {},
      appPath: `/partner${parsed.search}`,
    }),
  },
  {
    pattern: /^\/admin$/i,
    handler: (_matches, parsed) => ({
      screen: "admin",
      params: {},
      appPath: `/admin${parsed.search}`,
    }),
  },
];

export interface DeepLinkResult {
  screen: string;
  params: Record<string, string>;
  appPath: string;
  originalUrl: string;
}

function extractNormalizedPath(parsed: URL): string {
  if (parsed.protocol !== CANONICAL_SCHEME) {
    return parsed.pathname || "/";
  }

  const schemePath = `${parsed.hostname || ""}${parsed.pathname || ""}`.replace(/\/{2,}/g, "/");
  if (!schemePath) {
    return "/";
  }
  return schemePath.startsWith("/") ? schemePath : `/${schemePath}`;
}

export function parseDeepLink(url: string): DeepLinkResult | null {
  try {
    const parsed = new URL(url);
    const isAllowedScheme = parsed.protocol === CANONICAL_SCHEME;
    const isAllowedHost = parsed.protocol === "https:" && parsed.host === CANONICAL_WEB_HOST;
    if (!isAllowedScheme && !isAllowedHost) {
      return null;
    }

    const path = extractNormalizedPath(parsed);
    for (const route of deepLinkRoutes) {
      const matches = path.match(route.pattern);
      if (!matches) continue;

      const result = route.handler(matches, parsed);
      return {
        ...result,
        originalUrl: url,
      };
    }

    return null;
  } catch (error) {
    console.warn("Failed to parse deep link:", url, error);
    return null;
  }
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
  const url = new URL(`https://${CANONICAL_WEB_HOST}`);
  const normalizedScreen = String(screen || "").trim().toLowerCase();
  const symbol = String(params?.symbol || "").trim().toUpperCase();
  const panel = String(params?.panel || "").trim().toLowerCase();
  const token = String(params?.token || "").trim();

  switch (normalizedScreen) {
    case "trade":
      url.searchParams.set("tab", "trade");
      if (symbol) url.searchParams.set("symbol", symbol);
      break;
    case "chart":
      url.searchParams.set("tab", "chart");
      if (symbol) url.searchParams.set("symbol", symbol);
      break;
    case "history":
      url.searchParams.set("tab", "history");
      break;
    case "leaderboard":
      url.searchParams.set("tab", "leaderboard");
      break;
    case "account":
      url.searchParams.set("tab", "account");
      if (panel === "mailbox") {
        url.searchParams.set("panel", "mailbox");
      }
      break;
    case "mailbox":
      url.searchParams.set("tab", "account");
      url.searchParams.set("panel", "mailbox");
      break;
    case "settings":
    case "profile":
      url.pathname = "/profile";
      break;
    case "journal":
      url.pathname = "/journal";
      break;
    case "verify-email":
      url.pathname = "/verify-email";
      if (token) {
        url.searchParams.set("token", token);
      }
      break;
    case "partner":
      url.pathname = "/partner";
      break;
    case "admin":
      url.pathname = "/admin";
      break;
    default:
      break;
  }

  return url.toString();
}
