/**
 * TradeQuip Native - i18n Store
 * MMKV-based locale persistence and translation bundle cache
 * Matches webapp i18n/store.ts functionality
 */

import { MMKV } from 'react-native-mmkv';
import { NativeModules, Platform } from 'react-native';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from '@shared/locale/preferences';

const storage = new MMKV();

export type I18nConfig = {
    enabled: boolean;
    defaultLocale: string;
    supportedLocales: string[];
};

export type I18nBundle = {
    locale: string;
    strings: Record<string, string>;
    etag?: string;
};

export type I18nState = {
    locale: string;
    config: I18nConfig | null;
    bundle: I18nBundle | null;
};

const LOCALE_KEY = LOCALE_STORAGE_KEY;
const BUNDLE_CACHE_PREFIX = 'i18n.bundle.';
const CONFIG_KEY = 'i18n.config';

const FALLBACK_SUPPORTED_LOCALES = [
    'en', 'fr', 'pt', 'es', 'de', 'ar', 'hi', 'id',
    'zh', 'ms', 'tl', 'ko', 'ja', 'sw', 'th', 'bn', 'tr',
];

const FALLBACK_CONFIG: I18nConfig = {
    enabled: true,
    defaultLocale: DEFAULT_LOCALE.split('-')[0],
    supportedLocales: FALLBACK_SUPPORTED_LOCALES,
};

// In-memory state
let currentState: I18nState = {
    locale: getStoredLocale() || getDeviceLocale(),
    config: getStoredConfig(),
    bundle: null,
};

/**
 * Get device locale from system
 */
function getDeviceLocale(): string {
    try {
        const locale =
            Platform.OS === 'ios'
                ? NativeModules.SettingsManager?.settings?.AppleLocale ||
                NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
                : NativeModules.I18nManager?.localeIdentifier;

        if (locale) {
            return locale.split('_')[0].split('-')[0].toLowerCase();
        }
    } catch {
        // Ignore errors
    }
    return DEFAULT_LOCALE.split('-')[0];
}

/**
 * Get stored locale from MMKV
 */
function getStoredLocale(): string | null {
    return storage.getString(LOCALE_KEY) || null;
}

/**
 * Get stored config from MMKV
 */
function getStoredConfig(): I18nConfig | null {
    const json = storage.getString(CONFIG_KEY);
    if (!json) return null;
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/**
 * Get current i18n state
 */
export function getI18nState(): I18nState {
    return currentState;
}

/**
 * Set current locale
 */
export function setI18nLocale(locale: string): void {
    currentState = { ...currentState, locale };
    storage.set(LOCALE_KEY, locale);
}

/**
 * Set i18n config
 */
export function setI18nConfig(config: I18nConfig): void {
    currentState = { ...currentState, config };
    storage.set(CONFIG_KEY, JSON.stringify(config));
}

/**
 * Set translation bundle
 */
export function setI18nBundle(bundle: I18nBundle | null): void {
    currentState = { ...currentState, bundle };
    if (bundle) {
        storage.set(BUNDLE_CACHE_PREFIX + bundle.locale, JSON.stringify(bundle));
    }
}

/**
 * Get cached bundle for locale
 */
export function getCachedBundle(locale: string): I18nBundle | null {
    const json = storage.getString(BUNDLE_CACHE_PREFIX + locale);
    if (!json) return null;
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/**
 * Translate a key
 */
export function t(key: string, fallback?: string): string {
    const bundle = currentState.bundle;
    if (bundle?.strings?.[key]) {
        return bundle.strings[key];
    }
    return fallback ?? key;
}

/**
 * Check if locale is RTL
 */
export function isRtlLocale(locale: string): boolean {
    const base = locale.split('-')[0].toLowerCase();
    return base === 'ar' || base === 'fa' || base === 'he' || base === 'ur';
}

export { FALLBACK_CONFIG, FALLBACK_SUPPORTED_LOCALES };
