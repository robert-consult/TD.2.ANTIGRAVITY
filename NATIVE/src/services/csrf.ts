import axios from 'axios';
import {
    CSRF_HEADER_NAME,
    CSRF_TOKEN_ENDPOINT,
    normalizeHttpMethod,
} from '@shared/security/csrf';
import { isApiPath, isSafeHttpMethod } from '@shared/transport/httpProtocol';

const CSRF_TOKEN_MIN_LEN = 32;
const CSRF_TOKEN_MAX_LEN = 256;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const CSRF_FAILURE_CODE = 'CSRF_TOKEN_INVALID';

let csrfTokenCache: string | null = null;
let csrfTokenPromise: Promise<string | null> | null = null;

function normalizeToken(raw: unknown): string | null {
    const token = String(raw ?? '').trim();
    if (!token) return null;
    if (token.length < CSRF_TOKEN_MIN_LEN || token.length > CSRF_TOKEN_MAX_LEN) return null;
    if (!CSRF_TOKEN_PATTERN.test(token)) return null;
    return token;
}

function resolveUrl(baseUrl: string, path: string): URL | null {
    try {
        return new URL(path, baseUrl);
    } catch {
        return null;
    }
}

export function shouldAttachCsrfHeader(baseUrl: string, rawUrl: string | undefined, method: string | undefined): boolean {
    if (!rawUrl) return false;
    if (isSafeHttpMethod(normalizeHttpMethod(method))) return false;

    const resolved = resolveUrl(baseUrl, rawUrl);
    if (!resolved) return false;
    return isApiPath(resolved.pathname);
}

async function fetchCsrfToken(baseUrl: string, forceRefresh = false): Promise<string | null> {
    if (!forceRefresh && csrfTokenCache) return csrfTokenCache;
    if (!forceRefresh && csrfTokenPromise) return csrfTokenPromise;

    const task = (async () => {
        try {
            const response = await axios.get(CSRF_TOKEN_ENDPOINT, {
                baseURL: baseUrl,
                withCredentials: true,
                timeout: 10000,
                headers: {
                    'Cache-Control': 'no-store',
                },
            });
            const token = normalizeToken(response?.data?.csrfToken);
            csrfTokenCache = token;
            return token;
        } catch {
            return csrfTokenCache;
        }
    })();

    csrfTokenPromise = task.finally(() => {
        csrfTokenPromise = null;
    });

    return csrfTokenPromise;
}

export async function attachCsrfHeader(
    baseUrl: string,
    rawUrl: string | undefined,
    method: string | undefined,
    headers: Record<string, string>,
    options?: { forceRefresh?: boolean },
): Promise<Record<string, string>> {
    if (!shouldAttachCsrfHeader(baseUrl, rawUrl, method)) return headers;

    const token = await fetchCsrfToken(baseUrl, Boolean(options?.forceRefresh));
    if (!token) return headers;

    return {
        ...headers,
        [CSRF_HEADER_NAME]: token,
    };
}

export function isCsrfFailurePayload(payload: unknown): boolean {
    const code = String((payload as { code?: unknown } | null | undefined)?.code ?? '').trim().toUpperCase();
    return code === CSRF_FAILURE_CODE;
}

export async function refreshCsrfToken(baseUrl: string): Promise<string | null> {
    return fetchCsrfToken(baseUrl, true);
}

export function clearCsrfTokenCache(): void {
    csrfTokenCache = null;
    csrfTokenPromise = null;
}
