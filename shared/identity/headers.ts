export const DEVICE_INSTALL_ID_STORAGE_KEY = "grift_device_install_id";
export const LEGACY_DEVICE_ID_STORAGE_KEY = "grift_device_id";

export const IDENTITY_HEADER_DEVICE_INSTALL_ID = "x-device-install-id";
export const IDENTITY_HEADER_DEVICE_ID = "x-device-id";
export const IDENTITY_HEADER_DEVICE_FP = "x-device-fp";
export const IDENTITY_HEADER_DEVICE_FP_FALLBACK = "x-fingerprint";
export const IDENTITY_HEADER_CLIENT_TZ = "x-client-tz";
export const IDENTITY_HEADER_CLIENT_LANG = "x-client-lang";
export const IDENTITY_HEADER_PLATFORM = "x-platform";
export const IDENTITY_HEADER_APP_VERSION = "x-app-version";
export const IDENTITY_HEADER_BOT_PROOF = "x-bot-proof";

export const IDENTITY_HEADER_NAMES = [
  IDENTITY_HEADER_DEVICE_INSTALL_ID,
  IDENTITY_HEADER_DEVICE_ID,
  IDENTITY_HEADER_DEVICE_FP,
  IDENTITY_HEADER_CLIENT_TZ,
  IDENTITY_HEADER_CLIENT_LANG,
  IDENTITY_HEADER_PLATFORM,
  IDENTITY_HEADER_APP_VERSION,
] as const;

export type IdentityHeaderName = (typeof IDENTITY_HEADER_NAMES)[number];

export type IdentityHeaders = Partial<Record<IdentityHeaderName, string>>;

export function normalizeIdentityHeaderValue(value: unknown, maxLen: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/[\x00-\x1F\x7F]/.test(text)) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

export function readIdentityHeader(
  headers: Record<string, unknown> | null | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return normalizeIdentityHeaderValue(raw[0], 512);
  }
  return normalizeIdentityHeaderValue(raw, 512);
}
