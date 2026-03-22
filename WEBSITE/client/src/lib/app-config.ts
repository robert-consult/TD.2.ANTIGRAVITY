/**
 * Centralized configuration for the trading application URL.
 *
 * The public website (example.com) links to the trading app at tradehub.example.com
 * using native <a> tags — NOT wouter <Link> — because they are separate origins.
 *
 * To change the trading app domain, edit ONLY this file. All pages and components
 * import these constants instead of hardcoding URLs.
 */
const DEFAULT_TRADING_APP_URL = "https://tradehub.example.com";

function normalizeTradingAppUrl(raw: string | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return DEFAULT_TRADING_APP_URL;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_TRADING_APP_URL;
    }
    const normalizedPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return DEFAULT_TRADING_APP_URL;
  }
}

function buildTradingAppUrl(baseUrl: string, path: string, params?: Record<string, string>): string {
  const url = new URL(path, `${baseUrl}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const normalizedPath = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${normalizedPath}${url.search}${url.hash}`;
}

const tradingAppBaseUrl = normalizeTradingAppUrl((import.meta as any).env?.VITE_TRADING_APP_URL);

export const APP_CONFIG = {
  /** Base URL of the trading application */
  tradingAppUrl: buildTradingAppUrl(tradingAppBaseUrl, "/"),

  /** Direct link to the login page on the trading app */
  loginUrl: buildTradingAppUrl(tradingAppBaseUrl, "/login", { tab: "login" }),

  /** Direct link to the registration tab on the trading app */
  signupUrl: buildTradingAppUrl(tradingAppBaseUrl, "/login", { tab: "register" }),
} as const;
