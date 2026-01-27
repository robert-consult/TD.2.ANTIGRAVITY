/**
 * TradeQuip Native - i18n Index
 * Re-exports for convenient importing
 */

export { I18nProvider, useI18n, I18nContext } from './I18nProvider';
export {
    t,
    getI18nState,
    setI18nLocale,
    setI18nConfig,
    setI18nBundle,
    getCachedBundle,
    isRtlLocale,
    FALLBACK_CONFIG,
    FALLBACK_SUPPORTED_LOCALES,
    type I18nConfig,
    type I18nBundle,
    type I18nState,
} from './store';
