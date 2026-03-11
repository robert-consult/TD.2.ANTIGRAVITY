import { Platform } from 'react-native';
import { resolveWsUrl } from '@shared/ws/protocol';

export const PRODUCTION_APP_URL = 'https://tradehub.example.com';
export const DEEP_LINK_SCHEME = 'tradequip';
export const CANONICAL_WEB_HOST = new URL(PRODUCTION_APP_URL).host;

const DEV_APP_URL =
    Platform.OS === 'android'
        ? 'http://10.0.2.2:5000'
        : 'http://localhost:5000';

export function getApiBaseUrl(): string {
    return __DEV__ ? DEV_APP_URL : PRODUCTION_APP_URL;
}

export function getWsBaseUrl(): string {
    return resolveWsUrl(getApiBaseUrl());
}

export function getDeepLinkPrefixes(): string[] {
    return [`${DEEP_LINK_SCHEME}://`, PRODUCTION_APP_URL];
}

export function getPushEnvironment(): 'development' | 'production' {
    return __DEV__ ? 'development' : 'production';
}

function normalizeSymbol(value: string | null): string | null {
    const normalized = String(value ?? '').trim().toUpperCase();
    return /^[A-Z0-9._-]{3,16}$/.test(normalized) ? normalized : null;
}

function buildSchemeUrl(path: string, params?: URLSearchParams): string {
    const normalizedPath = String(path || '').replace(/^\/+/, '');
    const query = params?.toString();
    return `${DEEP_LINK_SCHEME}://${normalizedPath}${query ? `?${query}` : ''}`;
}

function normalizeSchemeUrl(raw: string): URL | null {
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
            return null;
        }
        const path = `/${parsed.hostname || ''}${parsed.pathname || ''}`.replace(/\/{2,}/g, '/');
        return new URL(`${PRODUCTION_APP_URL}${path}${parsed.search || ''}`);
    } catch {
        return null;
    }
}

function normalizeCandidateUrl(input: string): URL | null {
    const raw = String(input ?? '').trim();
    if (!raw) return null;

    if (raw.startsWith('/')) {
        return new URL(raw, PRODUCTION_APP_URL);
    }

    const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    if (!hasExplicitScheme && !raw.includes('://')) {
        return new URL(`/${raw.replace(/^\/+/, '')}`, PRODUCTION_APP_URL);
    }

    const schemeUrl = normalizeSchemeUrl(raw);
    if (schemeUrl) return schemeUrl;

    try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'https:' && parsed.host === CANONICAL_WEB_HOST) {
            return parsed;
        }
        if (__DEV__ && parsed.protocol === 'http:' && parsed.host === new URL(DEV_APP_URL).host) {
            return new URL(`${PRODUCTION_APP_URL}${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}`);
        }
    } catch {
        return null;
    }

    return null;
}

function mapCanonicalUrlToNativeDeepLink(parsed: URL): string | null {
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const search = parsed.searchParams;
    const tab = String(search.get('tab') ?? '').trim().toLowerCase();
    const panel = String(search.get('panel') ?? '').trim().toLowerCase();
    const token = String(search.get('token') ?? '').trim();

    if (pathname === '/' || pathname === '/home' || pathname === '/dashboard' || pathname === '/quotes') {
        switch (tab) {
            case '':
                return buildSchemeUrl(pathname === '/quotes' ? 'quotes' : 'dashboard');
            case 'quotes':
                return buildSchemeUrl('quotes');
            case 'chart': {
                const symbol = normalizeSymbol(search.get('symbol'));
                return buildSchemeUrl(symbol ? `chart/${symbol}` : 'chart');
            }
            case 'trade': {
                const symbol = normalizeSymbol(search.get('symbol'));
                return buildSchemeUrl(symbol ? `trade/${symbol}` : 'trade');
            }
            case 'history':
                return buildSchemeUrl('history');
            case 'account': {
                const params = new URLSearchParams();
                if (panel === 'mailbox') {
                    params.set('panel', 'mailbox');
                }
                return buildSchemeUrl('account', params);
            }
            case 'leaderboard':
                return buildSchemeUrl('leaderboard');
            default:
                return null;
        }
    }

    if (pathname === '/trade') {
        const symbol = normalizeSymbol(search.get('symbol'));
        return buildSchemeUrl(symbol ? `trade/${symbol}` : 'trade');
    }

    if (pathname === '/chart') {
        const symbol = normalizeSymbol(search.get('symbol'));
        return buildSchemeUrl(symbol ? `chart/${symbol}` : 'chart');
    }

    const tradeMatch = pathname.match(/^\/trade\/([A-Z0-9._-]{3,16})$/i);
    if (tradeMatch) {
        return buildSchemeUrl(`trade/${tradeMatch[1].toUpperCase()}`);
    }

    const chartMatch = pathname.match(/^\/chart\/([A-Z0-9._-]{3,16})$/i);
    if (chartMatch) {
        return buildSchemeUrl(`chart/${chartMatch[1].toUpperCase()}`);
    }

    if (pathname === '/history') return buildSchemeUrl('history');
    if (pathname === '/account' || pathname === '/mailbox' || pathname === '/account/mailbox') {
        const params = new URLSearchParams();
        if (pathname !== '/account' || panel === 'mailbox') {
            params.set('panel', 'mailbox');
        }
        return buildSchemeUrl('account', params);
    }
    if (pathname === '/profile' || pathname === '/settings') return buildSchemeUrl('profile');
    if (pathname === '/journal') return buildSchemeUrl('journal');
    if (pathname === '/leaderboard') return buildSchemeUrl('leaderboard');
    if (pathname === '/verify-email') {
        const params = new URLSearchParams();
        if (token) {
            params.set('token', token);
        }
        return buildSchemeUrl('verify-email', params);
    }
    if (pathname === '/signin' || pathname === '/login') return buildSchemeUrl('signin');
    if (pathname === '/signup') return buildSchemeUrl('signup');

    return null;
}

export function resolveAllowedDeepLink(input: string): string | null {
    const parsed = normalizeCandidateUrl(input);
    if (!parsed) return null;
    return mapCanonicalUrlToNativeDeepLink(parsed);
}
