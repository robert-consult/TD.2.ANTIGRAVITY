import { normalizeAppBaseUrl } from "@shared/appSurfaceConfig";

function getEnvString(name: string): string | undefined {
  const value = (import.meta as any).env?.[name];
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

export function getApiBaseUrl(): string {
  const configured =
    normalizeAppBaseUrl(getEnvString("VITE_API_URL")) ||
    normalizeAppBaseUrl(getEnvString("VITE_APP_URL"));

  if (configured) {
    return configured;
  }

  return typeof window !== "undefined"
    ? normalizeAppBaseUrl(window.location.origin) ?? ""
    : "";
}

export function resolveApiUrl(url: string): string {
  const raw = String(url || "");
  if (!raw.startsWith("/")) return raw;

  const base = getApiBaseUrl();
  if (!base) return raw;

  return `${base}${raw}`;
}
