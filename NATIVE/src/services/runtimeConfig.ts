import { Platform } from 'react-native';
import {
    MOBILE_SESSION_POLL_INTERVAL_MS,
    PRODUCTION_APP_BASE_URL,
    TRADEQUIP_DEEP_LINK_SCHEME,
    resolveNativeRuntimeBaseUrl,
    type NativeRuntimePlatform,
} from '@shared/appSurfaceConfig';
import { getTradequipDeepLinkPrefixes, resolveSurfaceAppLink } from '@shared/appLinks';
import { resolveWsUrl } from '@shared/ws/protocol';

export const PRODUCTION_APP_URL = PRODUCTION_APP_BASE_URL;
export const DEEP_LINK_SCHEME = TRADEQUIP_DEEP_LINK_SCHEME;
export const CANONICAL_WEB_HOST = new URL(PRODUCTION_APP_URL).host;

export type NativeRuntimeConfig = {
    apiBaseUrl: string;
    wsBaseUrl: string;
    deepLinkPrefixes: string[];
    pushEnvironment: 'development' | 'production';
    sessionPollIntervalMs: number;
};

function resolveRuntimePlatform(): NativeRuntimePlatform {
    return Platform.OS === 'android' ? 'android' : 'ios';
}

export function getNativeRuntimeConfig(): NativeRuntimeConfig {
    const apiBaseUrl = resolveNativeRuntimeBaseUrl({
        platform: resolveRuntimePlatform(),
        isDev: __DEV__,
    });

    return {
        apiBaseUrl,
        wsBaseUrl: resolveWsUrl(apiBaseUrl),
        deepLinkPrefixes: getTradequipDeepLinkPrefixes(PRODUCTION_APP_URL, [apiBaseUrl]),
        pushEnvironment: __DEV__ ? 'development' : 'production',
        sessionPollIntervalMs: MOBILE_SESSION_POLL_INTERVAL_MS,
    };
}

export function getApiBaseUrl(): string {
    return getNativeRuntimeConfig().apiBaseUrl;
}

export function getWsBaseUrl(): string {
    return getNativeRuntimeConfig().wsBaseUrl;
}

export function getDeepLinkPrefixes(): string[] {
    return getNativeRuntimeConfig().deepLinkPrefixes;
}

export function getPushEnvironment(): 'development' | 'production' {
    return getNativeRuntimeConfig().pushEnvironment;
}

export function getSessionPollIntervalMs(): number {
    return getNativeRuntimeConfig().sessionPollIntervalMs;
}

export function resolveAllowedDeepLink(input: string): string | null {
    return resolveSurfaceAppLink(input, {
        surface: 'native',
        baseUrl: PRODUCTION_APP_URL,
        additionalBaseUrls: [getApiBaseUrl()],
    })?.schemeUrl ?? null;
}
