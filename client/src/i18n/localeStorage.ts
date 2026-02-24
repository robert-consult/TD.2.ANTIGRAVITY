import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALE_USER_STORAGE_PREFIX } from "@shared/locale/preferences";

function safeReadStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

function normalizeLocale(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeUserId(value: number | string | null | undefined): number | null {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) return null;
  return normalized;
}

function baseLocale(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return DEFAULT_LOCALE.split("-")[0];
  return normalized.split("-")[0] || DEFAULT_LOCALE.split("-")[0];
}

function userLocaleStorageKey(userId: number): string {
  return `${LOCALE_USER_STORAGE_PREFIX}${userId}`;
}

export function readStoredLocale(): string | null {
  return normalizeLocale(safeReadStorage(LOCALE_STORAGE_KEY));
}

export function writeStoredLocale(locale: string): void {
  const normalized = normalizeLocale(locale);
  if (!normalized) return;
  safeWriteStorage(LOCALE_STORAGE_KEY, normalized);
}

export function readStoredLocaleForUser(userId: number | string | null | undefined): string | null {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  return normalizeLocale(safeReadStorage(userLocaleStorageKey(normalizedUserId)));
}

export function writeStoredLocaleForUser(
  userId: number | string | null | undefined,
  locale: string,
): void {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedLocale = normalizeLocale(locale);
  if (!normalizedUserId || !normalizedLocale) return;
  safeWriteStorage(userLocaleStorageKey(normalizedUserId), normalizedLocale);
}

export function shouldPreferStoredUserLocale(
  userLocale: string | null | undefined,
  storedLocale: string | null | undefined,
  defaultLocale: string | null | undefined,
): boolean {
  const storedBase = baseLocale(storedLocale);
  const userBase = baseLocale(userLocale);
  const defaultBase = baseLocale(defaultLocale);

  if (!normalizeLocale(storedLocale)) return false;
  if (!normalizeLocale(userLocale)) return true;
  return userBase === defaultBase && storedBase !== defaultBase;
}

/**
 * Apply stored-locale override only when current UI locale still differs from
 * the server locale. This avoids flipping back after the user explicitly
 * chooses the default locale in-session.
 */
export function shouldApplyStoredUserLocaleOverride(
  userLocale: string | null | undefined,
  storedLocale: string | null | undefined,
  defaultLocale: string | null | undefined,
  currentLocale: string | null | undefined,
): boolean {
  if (!shouldPreferStoredUserLocale(userLocale, storedLocale, defaultLocale)) {
    return false;
  }

  return baseLocale(currentLocale) !== baseLocale(userLocale);
}
