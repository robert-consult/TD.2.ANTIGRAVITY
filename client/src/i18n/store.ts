import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "@shared/locale/preferences";

type Listener = () => void;

export type I18nBundle = {
  locale: string;
  etag?: string;
  strings: Record<string, string>;
};

export type I18nConfig = {
  enabled: boolean;
  defaultLocale: string;
  supportedLocales: string[];
};

type I18nState = {
  locale: string;
  bundle: I18nBundle | null;
  config: I18nConfig | null;
  version: number;
};

const listeners = new Set<Listener>();
const BUNDLE_STORAGE_PREFIX = "i18n.bundle.";

function baseLocale(locale: string | null | undefined): string {
  if (!locale) return DEFAULT_LOCALE.split("-")[0];
  return String(locale).trim().toLowerCase().split("-")[0] || DEFAULT_LOCALE.split("-")[0];
}

function parseBundle(raw: string | null): I18nBundle | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.locale !== "string") return null;
    if (!parsed.strings || typeof parsed.strings !== "object") return null;
    return {
      locale: String(parsed.locale),
      etag: typeof parsed.etag === "string" ? parsed.etag : undefined,
      strings: parsed.strings as Record<string, string>,
    };
  } catch {
    return null;
  }
}

export function getCachedBundle(locale: string): I18nBundle | null {
  if (typeof window === "undefined") return null;
  const normalized = String(locale || "").trim();
  if (!normalized) return null;

  const keys = [normalized, baseLocale(normalized)];
  for (const key of keys) {
    const cached = parseBundle(window.localStorage.getItem(`${BUNDLE_STORAGE_PREFIX}${key}`));
    if (cached) return cached;
  }
  return null;
}

function persistBundle(bundle: I18nBundle) {
  if (typeof window === "undefined") return;
  if (!bundle?.locale) return;
  try {
    window.localStorage.setItem(
      `${BUNDLE_STORAGE_PREFIX}${bundle.locale}`,
      JSON.stringify(bundle)
    );
  } catch {
    // best-effort cache
  }
}

const initialLocale =
  typeof window !== "undefined"
    ? (window.localStorage.getItem(LOCALE_STORAGE_KEY) || DEFAULT_LOCALE.split("-")[0])
    : DEFAULT_LOCALE.split("-")[0];
const initialBundle = getCachedBundle(initialLocale);

let state: I18nState = {
  locale: initialLocale,
  bundle: initialBundle,
  config: null,
  version: 0,
};

export function getI18nState(): I18nState {
  return state;
}

export function subscribeI18n(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setI18nLocale(locale: string) {
  if (!locale) return;
  if (state.locale === locale) return;
  state = { ...state, locale };
  for (const l of listeners) l();
}

export function setI18nBundle(bundle: I18nBundle | null) {
  state = { ...state, bundle, version: state.version + 1 };
  if (bundle) persistBundle(bundle);
  for (const l of listeners) l();
}

export function setI18nConfig(config: I18nConfig | null) {
  state = { ...state, config };
  for (const l of listeners) l();
}
