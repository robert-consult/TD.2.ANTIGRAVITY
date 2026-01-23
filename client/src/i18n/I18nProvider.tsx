import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getCachedBundle, getI18nState, setI18nBundle, setI18nConfig, setI18nLocale, type I18nBundle, type I18nConfig } from "./store";
import { resolveApiUrl } from "@/lib/appUrl";

export type I18nContextValue = {
  locale: string;
  setLocale: (locale: string) => void;
  loaded: boolean;
  enabled: boolean;
  supportedLocales: string[];
  defaultLocale: string;
};

export const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => {},
  loaded: false,
  enabled: false,
  supportedLocales: ["en"],
  defaultLocale: "en",
});

const FALLBACK_SUPPORTED_LOCALES = [
  "en",
  "fr",
  "pt",
  "es",
  "de",
  "ar",
  "hi",
  "id",
  "zh",
  "ms",
  "tl",
  "ko",
  "ja",
  "sw",
  "th",
  "bn",
  "tr",
];

const FALLBACK_CONFIG: I18nConfig = {
  enabled: true,
  defaultLocale: "en",
  supportedLocales: FALLBACK_SUPPORTED_LOCALES,
};

function baseLocale(locale: string | null | undefined): string {
  if (!locale) return "en";
  return String(locale).trim().toLowerCase().split("-")[0] || "en";
}

function normalizeLocale(
  locale: string | null | undefined,
  supportedLocales: string[],
  defaultLocale: string,
): string {
  const raw = String(locale || "").trim();
  if (!raw) return defaultLocale;
  const exact = supportedLocales.find((l) => l.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const base = baseLocale(raw);
  const baseMatch = supportedLocales.find((l) => l.toLowerCase() === base);
  return baseMatch ?? defaultLocale;
}

function isRtlLocale(locale: string): boolean {
  const base = baseLocale(locale);
  return base === "ar" || base === "fa" || base === "he" || base === "ur";
}

function getInitialLocale(): string {
  try {
    const saved = localStorage.getItem("i18n.locale");
    if (saved) {
      return normalizeLocale(saved, FALLBACK_CONFIG.supportedLocales, FALLBACK_CONFIG.defaultLocale);
    }
  } catch {}

  const navLang = typeof navigator !== "undefined" ? navigator.language : "en";
  return normalizeLocale(navLang, FALLBACK_CONFIG.supportedLocales, FALLBACK_CONFIG.defaultLocale);
}

async function fetchConfig(): Promise<I18nConfig> {
  const res = await fetch(resolveApiUrl("/api/i18n/config"));
  if (!res.ok) {
    return FALLBACK_CONFIG;
  }
  const data = (await res.json()) as any;
  return {
    enabled: !!data.enabled,
    defaultLocale: String(data.defaultLocale || "en"),
    supportedLocales: Array.isArray(data.supportedLocales) && data.supportedLocales.length
      ? data.supportedLocales.map(String)
      : FALLBACK_SUPPORTED_LOCALES,
  };
}

async function fetchBundle(locale: string, etag?: string): Promise<I18nBundle> {
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch(resolveApiUrl(`/api/i18n/bundle?locale=${encodeURIComponent(locale)}`), { headers });

  if (res.status === 304) {
    const cur = getI18nState().bundle;
    if (!cur) throw new Error("Got 304 but no cached bundle exists");
    if (baseLocale(cur.locale) !== baseLocale(locale)) {
      throw new Error("Got 304 but cached bundle locale differs");
    }
    return cur;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to load i18n bundle (${res.status}): ${body}`);
  }

  const next = (await res.json()) as any;
  const nextEtag = res.headers.get("ETag") ?? undefined;

  return {
    locale: String(next?.locale || locale),
    strings: (next?.strings && typeof next.strings === "object") ? next.strings : {},
    etag: nextEtag,
  };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const configQuery = useQuery({
    queryKey: ["i18nConfig"],
    queryFn: fetchConfig,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Use a permissive fallback to avoid resetting locale when React Query cache is cleared (e.g., on logout),
  // and to prevent "unsupported locale" normalization races before config loads.
  const config = configQuery.data ?? FALLBACK_CONFIG;

  const [locale, _setLocale] = useState<string>(() => {
    return getInitialLocale();
  });

  // Whenever config arrives/changes, normalize current locale.
  useEffect(() => {
    const normalized = normalizeLocale(locale, config.supportedLocales, config.defaultLocale);
    if (normalized !== locale) _setLocale(normalized);
  }, [config.defaultLocale, config.supportedLocales.join(","), locale]);

  // Sync locale from user.language whenever a user preference is available.
  useEffect(() => {
    const currentUserLang = user?.language;
    if (!currentUserLang) return;

    const normalized = normalizeLocale(currentUserLang, config.supportedLocales, config.defaultLocale);
    let storedLocale: string | null = null;
    try {
      storedLocale = localStorage.getItem("i18n.locale");
    } catch {}
    const storedNormalized = storedLocale
      ? normalizeLocale(storedLocale, config.supportedLocales, config.defaultLocale)
      : null;

    // If the server reports the default locale but the user previously selected a different locale,
    // keep the locally chosen language to avoid unwanted resets.
    if (storedNormalized && storedNormalized !== normalized && normalized === config.defaultLocale) {
      return;
    }

    if (normalized !== locale) {
      _setLocale(normalized);
    }
    try {
      localStorage.setItem("i18n.locale", normalized);
    } catch {}
  }, [user?.language, config.defaultLocale, config.supportedLocales.join(","), locale]);

  useEffect(() => {
    setI18nConfig(config);
  }, [config.enabled, config.defaultLocale, config.supportedLocales.join(",")]);

  useEffect(() => {
    setI18nLocale(locale);
    try {
      localStorage.setItem("i18n.locale", locale);
    } catch {}
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
  }, [locale]);

  const bundleQuery = useQuery({
    queryKey: ["i18nBundle", locale],
    queryFn: async () => {
      const currentEtag = getI18nState().bundle?.etag;
      return await fetchBundle(locale, currentEtag);
    },
    enabled: config.enabled && !!locale,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!config.enabled) {
      setI18nBundle(null);
      return;
    }
    if (bundleQuery.data) {
      setI18nBundle(bundleQuery.data);
      return;
    }

    const cached = getCachedBundle(locale);
    if (cached) {
      setI18nBundle(cached);
      return;
    }

    // Keep the current bundle to avoid a brief English fallback while fetching a new locale.
    // The bundle will update as soon as the network response arrives.
  }, [bundleQuery.data, config.enabled, locale]);

  const setLocale = useCallback(
    (next: string) => {
      const normalized = normalizeLocale(next, config.supportedLocales, config.defaultLocale);
      _setLocale(normalized);
    },
    [config.defaultLocale, config.supportedLocales.join(",")],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      loaded: !!bundleQuery.data || !config.enabled,
      enabled: config.enabled,
      supportedLocales: config.supportedLocales,
      defaultLocale: config.defaultLocale,
    }),
    [locale, setLocale, bundleQuery.data, config.enabled, config.defaultLocale, config.supportedLocales.join(",")],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
