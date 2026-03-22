export const PRODUCTION_APP_BASE_URL = "https://tradehub.example.com";
export const STAGING_APP_BASE_URL = "https://staging.tradehub.example.com";
export const LOCAL_WEB_DEV_APP_BASE_URL = "http://localhost:5000";
export const LOCAL_ANDROID_EMULATOR_APP_BASE_URL = "http://10.0.2.2:5000";

export const TRADEQUIP_DEEP_LINK_SCHEME = "tradequip";
export const TRADEQUIP_DEEP_LINK_PREFIX = `${TRADEQUIP_DEEP_LINK_SCHEME}://`;
export const TRADEQUIP_DEEP_LINK_PROTOCOL = `${TRADEQUIP_DEEP_LINK_SCHEME}:`;

export const APP_LOGIN_ROUTE_PATH = "/login";
export const APP_VERIFY_EMAIL_ROUTE_PATH = "/verify-email";

export const AUTH_CURRENT_USER_API_PATH = "/api/auth/current-user";
export const AUTH_LOGOUT_API_PATH = "/api/auth/logout";

export const MOBILE_SESSION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export type AppAuthTab = "login" | "register";
export type RuntimeMode = "development" | "production" | "test";
export type NativeRuntimePlatform = "android" | "ios";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeAppBaseUrl(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    const normalizedPath = parsed.pathname === "/" ? "" : trimTrailingSlash(parsed.pathname);
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
}

export function normalizeAppHost(raw: unknown): string | null {
  const baseUrl = normalizeAppBaseUrl(raw);
  if (!baseUrl) return null;

  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

export function getDefaultAppBaseUrlForMode(mode: RuntimeMode | undefined): string {
  return mode === "production" ? PRODUCTION_APP_BASE_URL : LOCAL_WEB_DEV_APP_BASE_URL;
}

export function resolveServerAppBaseUrl(
  configuredBaseUrl: unknown,
  options?: {
    mode?: RuntimeMode | null | undefined;
    fallbackBaseUrl?: unknown;
  },
): string {
  return (
    normalizeAppBaseUrl(configuredBaseUrl) ??
    normalizeAppBaseUrl(options?.fallbackBaseUrl) ??
    getDefaultAppBaseUrlForMode(options?.mode ?? undefined)
  );
}

export function resolveWrapperRuntimeBaseUrl(input: {
  explicitBaseUrl?: unknown;
  appBaseUrl?: unknown;
  mode?: RuntimeMode | null | undefined;
}): string | null {
  const configured =
    normalizeAppBaseUrl(input.explicitBaseUrl) ??
    normalizeAppBaseUrl(input.appBaseUrl);

  if (configured) {
    return configured;
  }

  return input.mode === "production" ? PRODUCTION_APP_BASE_URL : null;
}

export function resolveNativeRuntimeBaseUrl(input: {
  platform: NativeRuntimePlatform;
  isDev: boolean;
  overrideBaseUrl?: unknown;
}): string {
  const configured = normalizeAppBaseUrl(input.overrideBaseUrl);
  if (configured) {
    return configured;
  }

  if (!input.isDev) {
    return PRODUCTION_APP_BASE_URL;
  }

  return input.platform === "android"
    ? LOCAL_ANDROID_EMULATOR_APP_BASE_URL
    : LOCAL_WEB_DEV_APP_BASE_URL;
}

export function getTradequipHttpsHosts(additionalBaseUrls?: Array<unknown>): string[] {
  const hosts = new Set<string>();
  const candidates = [
    PRODUCTION_APP_BASE_URL,
    STAGING_APP_BASE_URL,
    ...(additionalBaseUrls ?? []),
  ];

  for (const candidate of candidates) {
    const host = normalizeAppHost(candidate);
    if (host) {
      hosts.add(host);
    }
  }

  return Array.from(hosts);
}

export function getWrapperAllowNavigationHosts(runtimeBaseUrl: unknown): string[] {
  return getTradequipHttpsHosts([runtimeBaseUrl]);
}

export function buildAppPageUrl(
  baseUrl: unknown,
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  const normalizedBaseUrl = normalizeAppBaseUrl(baseUrl) ?? PRODUCTION_APP_BASE_URL;
  const url = new URL(path, `${normalizedBaseUrl}/`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const normalizedPath = url.pathname === "/" ? "/" : trimTrailingSlash(url.pathname);
  return `${url.origin}${normalizedPath}${url.search}${url.hash}`;
}

export function buildLoginPageUrl(baseUrl: unknown, tab: AppAuthTab = "login"): string {
  return buildAppPageUrl(baseUrl, APP_LOGIN_ROUTE_PATH, { tab });
}

export function buildVerifyEmailPageUrl(baseUrl: unknown, token: string): string {
  const trimmedToken = String(token ?? "").trim();
  return buildAppPageUrl(baseUrl, APP_VERIFY_EMAIL_ROUTE_PATH, trimmedToken ? { token: trimmedToken } : undefined);
}
