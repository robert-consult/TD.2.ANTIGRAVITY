import {
  APP_LOGIN_ROUTE_PATH,
  APP_VERIFY_EMAIL_ROUTE_PATH,
  PRODUCTION_APP_BASE_URL,
  STAGING_APP_BASE_URL,
  TRADEQUIP_DEEP_LINK_PREFIX,
  TRADEQUIP_DEEP_LINK_PROTOCOL,
  buildAppPageUrl,
  buildLoginPageUrl,
  buildVerifyEmailPageUrl,
  getTradequipHttpsHosts,
  normalizeAppBaseUrl,
  normalizeAppHost,
} from "./appSurfaceConfig";

export type AppLinkSurface = "web" | "wrapper" | "native";

export type AppLinkScreen =
  | "quotes"
  | "chart"
  | "trade"
  | "history"
  | "leaderboard"
  | "account"
  | "mailbox"
  | "profile"
  | "journal"
  | "verify-email"
  | "signin"
  | "signup"
  | "partner"
  | "admin";

export type ResolvedAppLink = {
  screen: AppLinkScreen;
  params: Record<string, string>;
  appPath: string;
  canonicalUrl: string;
  schemeUrl: string;
};

const WRAPPER_SUPPORTED_SCREENS = new Set<AppLinkScreen>([
  "quotes",
  "chart",
  "trade",
  "history",
  "leaderboard",
  "account",
  "mailbox",
  "profile",
  "journal",
  "verify-email",
  "signin",
  "signup",
  "partner",
  "admin",
]);

const NATIVE_SUPPORTED_SCREENS = new Set<AppLinkScreen>([
  "quotes",
  "chart",
  "trade",
  "history",
  "leaderboard",
  "account",
  "mailbox",
  "profile",
  "journal",
  "verify-email",
  "signin",
  "signup",
]);

function isSupportedOnSurface(surface: AppLinkSurface, screen: AppLinkScreen): boolean {
  if (surface === "native") {
    return NATIVE_SUPPORTED_SCREENS.has(screen);
  }
  return WRAPPER_SUPPORTED_SCREENS.has(screen);
}

function normalizeSymbol(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9._-]{3,16}$/.test(normalized) ? normalized : null;
}

function normalizeTradequipSchemeUrl(raw: string, baseUrl: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== TRADEQUIP_DEEP_LINK_PROTOCOL) {
      return null;
    }

    const path = `/${parsed.hostname || ""}${parsed.pathname || ""}`.replace(/\/{2,}/g, "/");
    return new URL(`${baseUrl}${path}${parsed.search || ""}${parsed.hash || ""}`);
  } catch {
    return null;
  }
}

function normalizeInputToUrl(
  rawInput: string,
  options?: {
    baseUrl?: string;
    additionalBaseUrls?: Array<unknown>;
  },
): URL | null {
  const raw = String(rawInput ?? "").trim();
  if (!raw) return null;

  const baseUrl = normalizeAppBaseUrl(options?.baseUrl) ?? PRODUCTION_APP_BASE_URL;
  const allowedHosts = new Set(
    getTradequipHttpsHosts([
      baseUrl,
      PRODUCTION_APP_BASE_URL,
      STAGING_APP_BASE_URL,
      ...(options?.additionalBaseUrls ?? []),
    ]),
  );

  if (raw.startsWith("?")) {
    return new URL(`/${raw}`, `${baseUrl}/`);
  }

  if (raw.startsWith("/")) {
    return new URL(raw, `${baseUrl}/`);
  }

  const schemeUrl = normalizeTradequipSchemeUrl(raw, baseUrl);
  if (schemeUrl) {
    return schemeUrl;
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return new URL(`/${raw.replace(/^\/+/, "")}`, `${baseUrl}/`);
  }

  try {
    const parsed = new URL(raw);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && allowedHosts.has(parsed.host)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function buildAppPathForScreen(screen: AppLinkScreen, params: Record<string, string>): string {
  switch (screen) {
    case "quotes":
      return params.rawRootQuery ? `/${params.rawRootQuery}` : "/";
    case "chart":
      return params.symbol ? `/?tab=chart&symbol=${encodeURIComponent(params.symbol)}` : "/?tab=chart";
    case "trade":
      return params.symbol ? `/?tab=trade&symbol=${encodeURIComponent(params.symbol)}` : "/?tab=trade";
    case "history":
      return "/?tab=history";
    case "leaderboard":
      return "/?tab=leaderboard";
    case "account":
      return "/?tab=account";
    case "mailbox":
      return "/?tab=account&panel=mailbox";
    case "profile":
      return "/profile";
    case "journal":
      return "/journal";
    case "verify-email":
      return params.token ? `/verify-email?token=${encodeURIComponent(params.token)}` : "/verify-email";
    case "signin":
      return "/login?tab=login";
    case "signup":
      return "/login?tab=register";
    case "partner":
      return params.search ? `/partner${params.search}` : "/partner";
    case "admin":
      return params.search ? `/admin${params.search}` : "/admin";
    default:
      return "/";
  }
}

function buildCanonicalUrl(screen: AppLinkScreen, params: Record<string, string>, baseUrl: string): string {
  switch (screen) {
    case "quotes":
      return params.rawRootQuery ? buildAppPageUrl(baseUrl, "/", undefined).replace(/\/$/, "") + `/${params.rawRootQuery}` : buildAppPageUrl(baseUrl, "/");
    case "chart":
      return buildAppPageUrl(baseUrl, "/", {
        tab: "chart",
        ...(params.symbol ? { symbol: params.symbol } : {}),
      });
    case "trade":
      return buildAppPageUrl(baseUrl, "/", {
        tab: "trade",
        ...(params.symbol ? { symbol: params.symbol } : {}),
      });
    case "history":
      return buildAppPageUrl(baseUrl, "/", { tab: "history" });
    case "leaderboard":
      return buildAppPageUrl(baseUrl, "/", { tab: "leaderboard" });
    case "account":
      return buildAppPageUrl(baseUrl, "/", { tab: "account" });
    case "mailbox":
      return buildAppPageUrl(baseUrl, "/", { tab: "account", panel: "mailbox" });
    case "profile":
      return buildAppPageUrl(baseUrl, "/profile");
    case "journal":
      return buildAppPageUrl(baseUrl, "/journal");
    case "verify-email":
      return buildVerifyEmailPageUrl(baseUrl, params.token ?? "");
    case "signin":
      return buildLoginPageUrl(baseUrl, "login");
    case "signup":
      return buildLoginPageUrl(baseUrl, "register");
    case "partner":
      return buildAppPageUrl(baseUrl, "/partner", undefined) + (params.search ?? "");
    case "admin":
      return buildAppPageUrl(baseUrl, "/admin", undefined) + (params.search ?? "");
    default:
      return buildAppPageUrl(baseUrl, "/");
  }
}

function buildSchemeUrl(screen: AppLinkScreen, params: Record<string, string>): string {
  switch (screen) {
    case "quotes":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}dashboard`;
    case "chart":
      return params.symbol
        ? `${TRADEQUIP_DEEP_LINK_PREFIX}chart/${encodeURIComponent(params.symbol)}`
        : `${TRADEQUIP_DEEP_LINK_PREFIX}chart`;
    case "trade":
      return params.symbol
        ? `${TRADEQUIP_DEEP_LINK_PREFIX}trade/${encodeURIComponent(params.symbol)}`
        : `${TRADEQUIP_DEEP_LINK_PREFIX}trade`;
    case "history":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}history`;
    case "leaderboard":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}leaderboard`;
    case "account":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}account`;
    case "mailbox":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}account?panel=mailbox`;
    case "profile":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}profile`;
    case "journal":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}journal`;
    case "verify-email":
      return params.token
        ? `${TRADEQUIP_DEEP_LINK_PREFIX}verify-email?token=${encodeURIComponent(params.token)}`
        : `${TRADEQUIP_DEEP_LINK_PREFIX}verify-email`;
    case "signin":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}signin`;
    case "signup":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}signup`;
    case "partner":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}partner`;
    case "admin":
      return `${TRADEQUIP_DEEP_LINK_PREFIX}admin`;
    default:
      return `${TRADEQUIP_DEEP_LINK_PREFIX}dashboard`;
  }
}

function resolveLinkFromUrl(url: URL, baseUrl: string): ResolvedAppLink | null {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const rawSearch = url.search;
  const rawHash = url.hash;
  const tab = String(url.searchParams.get("tab") ?? "").trim().toLowerCase();
  const panel = String(url.searchParams.get("panel") ?? "").trim().toLowerCase();
  const token = String(url.searchParams.get("token") ?? "").trim();

  const finalize = (screen: AppLinkScreen, params: Record<string, string> = {}): ResolvedAppLink => ({
    screen,
    params,
    appPath: buildAppPathForScreen(screen, params),
    canonicalUrl: buildCanonicalUrl(screen, params, baseUrl),
    schemeUrl: buildSchemeUrl(screen, params),
  });

  if (pathname === "/" || pathname === "/home" || pathname === "/dashboard" || pathname === "/quotes") {
    if (tab === "chart") {
      const symbol = normalizeSymbol(url.searchParams.get("symbol"));
      return finalize("chart", symbol ? { symbol } : {});
    }
    if (tab === "trade") {
      const symbol = normalizeSymbol(url.searchParams.get("symbol"));
      return finalize("trade", symbol ? { symbol } : {});
    }
    if (tab === "history") return finalize("history");
    if (tab === "leaderboard") return finalize("leaderboard");
    if (tab === "account" && panel === "mailbox") return finalize("mailbox");
    if (tab === "account") return finalize("account");
    const rawRootQuery = `${rawSearch || ""}${rawHash || ""}`.replace(/^\?$/, "");
    return finalize("quotes", rawRootQuery ? { rawRootQuery } : {});
  }

  const chartMatch = pathname.match(/^\/chart\/([A-Z0-9._-]{3,16})$/i);
  if (chartMatch) {
    return finalize("chart", { symbol: chartMatch[1].toUpperCase() });
  }

  if (pathname === "/chart") {
    const symbol = normalizeSymbol(url.searchParams.get("symbol"));
    return finalize("chart", symbol ? { symbol } : {});
  }

  const tradeMatch = pathname.match(/^\/trade\/([A-Z0-9._-]{3,16})$/i);
  if (tradeMatch) {
    return finalize("trade", { symbol: tradeMatch[1].toUpperCase() });
  }

  if (pathname === "/trade") {
    const symbol = normalizeSymbol(url.searchParams.get("symbol"));
    return finalize("trade", symbol ? { symbol } : {});
  }

  if (pathname === "/history") return finalize("history");
  if (pathname === "/leaderboard") return finalize("leaderboard");
  if (pathname === "/account" && panel === "mailbox") return finalize("mailbox");
  if (pathname === "/account") return finalize("account");
  if (pathname === "/account/mailbox" || pathname === "/mailbox") return finalize("mailbox");
  if (pathname === "/profile" || pathname === "/settings") return finalize("profile");
  if (pathname === "/journal") return finalize("journal");
  if (pathname === "/partner") return finalize("partner", rawSearch ? { search: rawSearch } : {});
  if (pathname === "/admin") return finalize("admin", rawSearch ? { search: rawSearch } : {});
  if (pathname === APP_VERIFY_EMAIL_ROUTE_PATH) {
    return finalize("verify-email", token ? { token } : {});
  }
  if (pathname === APP_LOGIN_ROUTE_PATH || pathname === "/signin") {
    return finalize(tab === "register" ? "signup" : "signin");
  }
  if (pathname === "/signup") {
    return finalize("signup");
  }

  return null;
}

export function resolveSurfaceAppLink(
  rawInput: string,
  options: {
    surface: AppLinkSurface;
    baseUrl?: string;
    additionalBaseUrls?: Array<unknown>;
  },
): ResolvedAppLink | null {
  const baseUrl = normalizeAppBaseUrl(options.baseUrl) ?? PRODUCTION_APP_BASE_URL;
  const parsed = normalizeInputToUrl(rawInput, {
    baseUrl,
    additionalBaseUrls: options.additionalBaseUrls,
  });
  if (!parsed) {
    return null;
  }

  const resolved = resolveLinkFromUrl(parsed, baseUrl);
  if (!resolved) {
    return null;
  }

  return isSupportedOnSurface(options.surface, resolved.screen) ? resolved : null;
}

export function buildSurfaceAppLink(
  screen: AppLinkScreen,
  params?: Record<string, string | null | undefined>,
  options?: {
    baseUrl?: string;
    surface?: "web" | "wrapper" | "native";
  },
): string {
  const normalizedParams = Object.fromEntries(
    Object.entries(params ?? {}).flatMap(([key, value]) => (value == null ? [] : [[key, String(value)]])),
  );
  if ((options?.surface ?? "web") === "native") {
    return buildSchemeUrl(screen, normalizedParams);
  }
  return buildCanonicalUrl(screen, normalizedParams, normalizeAppBaseUrl(options?.baseUrl) ?? PRODUCTION_APP_BASE_URL);
}

export function getTradequipDeepLinkPrefixes(baseUrl: unknown, additionalBaseUrls?: Array<unknown>): string[] {
  const prefixes = new Set<string>([TRADEQUIP_DEEP_LINK_PREFIX]);
  const candidates = [
    normalizeAppBaseUrl(baseUrl),
    PRODUCTION_APP_BASE_URL,
    ...(additionalBaseUrls ?? []).map((value) => normalizeAppBaseUrl(value)),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    prefixes.add(candidate);
  }

  return Array.from(prefixes);
}

export function normalizeAppPathCandidate(rawInput: string, baseUrl?: string): string | null {
  return resolveSurfaceAppLink(rawInput, { surface: "wrapper", baseUrl })?.appPath ?? null;
}

export function isAllowedTradequipHttpsHost(rawUrl: string, additionalBaseUrls?: Array<unknown>): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const allowedHosts = new Set(getTradequipHttpsHosts(additionalBaseUrls));
    const currentHost = normalizeAppHost(parsed.toString());
    return Boolean(currentHost && allowedHosts.has(currentHost));
  } catch {
    return false;
  }
}
