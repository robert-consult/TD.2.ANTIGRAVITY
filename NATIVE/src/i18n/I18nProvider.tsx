/**
 * TradeQuip Native - i18n Provider
 * React Context provider for locale management
 * Matches webapp i18n/I18nProvider.tsx functionality
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { I18nManager } from 'react-native';
import { i18nApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
    getI18nState,
    setI18nBundle,
    setI18nConfig,
    setI18nLocale,
    getCachedBundle,
    isRtlLocale,
    FALLBACK_CONFIG,
    type I18nBundle,
    type I18nConfig,
} from './store';

export type I18nContextValue = {
    locale: string;
    setLocale: (locale: string) => void;
    loaded: boolean;
    enabled: boolean;
    supportedLocales: string[];
    defaultLocale: string;
    t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
    locale: 'en',
    setLocale: () => { },
    loaded: false,
    enabled: false,
    supportedLocales: ['en'],
    defaultLocale: 'en',
    t: (key) => key,
});

function baseLocale(locale: string | null | undefined): string {
    if (!locale) return 'en';
    return String(locale).trim().toLowerCase().split('-')[0] || 'en';
}

function normalizeLocale(
    locale: string | null | undefined,
    supportedLocales: string[],
    defaultLocale: string,
): string {
    const raw = String(locale || '').trim();
    if (!raw) return defaultLocale;
    const exact = supportedLocales.find((l) => l.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const base = baseLocale(raw);
    const baseMatch = supportedLocales.find((l) => l.toLowerCase() === base);
    return baseMatch ?? defaultLocale;
}

async function fetchConfig(): Promise<I18nConfig> {
    try {
        const data = await i18nApi.getConfig();
        return {
            enabled: !!data.enabled,
            defaultLocale: String(data.defaultLocale || 'en'),
            supportedLocales: Array.isArray(data.supportedLocales) && data.supportedLocales.length
                ? data.supportedLocales.map(String)
                : FALLBACK_CONFIG.supportedLocales,
        };
    } catch {
        return FALLBACK_CONFIG;
    }
}

async function fetchBundle(locale: string): Promise<I18nBundle> {
    const data = await i18nApi.getBundle(locale);
    return {
        locale: String(data?.locale || locale),
        strings: (data?.strings && typeof data.strings === 'object') ? data.strings : {},
        etag: data?.etag,
    };
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();

    const configQuery = useQuery({
        queryKey: ['i18nConfig'],
        queryFn: fetchConfig,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });

    const config = configQuery.data ?? FALLBACK_CONFIG;

    const [locale, _setLocale] = useState<string>(() => {
        return getI18nState().locale;
    });

    // Normalize locale when config changes
    useEffect(() => {
        const normalized = normalizeLocale(locale, config.supportedLocales, config.defaultLocale);
        if (normalized !== locale) _setLocale(normalized);
    }, [config.defaultLocale, config.supportedLocales.join(','), locale]);

    // Sync locale from user preference
    useEffect(() => {
        const currentUserLang = user?.language;
        if (!currentUserLang) return;

        const normalized = normalizeLocale(currentUserLang, config.supportedLocales, config.defaultLocale);
        if (normalized !== locale) {
            _setLocale(normalized);
        }
    }, [user?.language, config.defaultLocale, config.supportedLocales.join(','), locale]);

    // Update config in store
    useEffect(() => {
        setI18nConfig(config);
    }, [config.enabled, config.defaultLocale, config.supportedLocales.join(',')]);

    // Update locale in store
    useEffect(() => {
        setI18nLocale(locale);
    }, [locale]);

    // Handle RTL layout
    useEffect(() => {
        const isRtl = isRtlLocale(locale);
        if (I18nManager.isRTL !== isRtl) {
            I18nManager.allowRTL(isRtl);
            I18nManager.forceRTL(isRtl);
        }
    }, [locale]);

    // Fetch translation bundle
    const bundleQuery = useQuery({
        queryKey: ['i18nBundle', locale],
        queryFn: () => fetchBundle(locale),
        enabled: config.enabled && !!locale,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });

    // Update bundle in store
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
        }
    }, [bundleQuery.data, config.enabled, locale]);

    const setLocale = useCallback(
        (next: string) => {
            const normalized = normalizeLocale(next, config.supportedLocales, config.defaultLocale);
            _setLocale(normalized);
        },
        [config.defaultLocale, config.supportedLocales.join(',')],
    );

    const t = useCallback((key: string, fallback?: string): string => {
        const bundle = bundleQuery.data;
        if (bundle?.strings?.[key]) {
            return bundle.strings[key];
        }
        return fallback ?? key;
    }, [bundleQuery.data]);

    const value = useMemo<I18nContextValue>(
        () => ({
            locale,
            setLocale,
            loaded: !!bundleQuery.data || !config.enabled,
            enabled: config.enabled,
            supportedLocales: config.supportedLocales,
            defaultLocale: config.defaultLocale,
            t,
        }),
        [locale, setLocale, bundleQuery.data, config.enabled, config.defaultLocale, config.supportedLocales.join(','), t],
    );

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
    return useContext(I18nContext);
}

export { I18nContext };
