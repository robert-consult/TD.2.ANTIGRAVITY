function getEnvString(name: string): string | undefined {
  const value = (import.meta as any).env?.[name];
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBaseUrl(raw: string): string {
  return String(raw).trim().replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const base =
    getEnvString("VITE_API_URL") ||
    getEnvString("VITE_APP_URL") ||
    (typeof window !== "undefined" ? window.location.origin : "");

  return normalizeBaseUrl(base);
}

export function resolveApiUrl(url: string): string {
  const raw = String(url || "");
  if (!raw.startsWith("/")) return raw;

  const base = getApiBaseUrl();
  if (!base) return raw;

  return `${base}${raw}`;
}

