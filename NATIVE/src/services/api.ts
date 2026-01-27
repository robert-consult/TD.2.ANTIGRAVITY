/**
 * TradeQuip Android - API Service
 * Aligned with webapp API structure for secure communication
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { MMKV } from 'react-native-mmkv';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';

const storage = new MMKV();

// Base URL - set via environment or config
const DEV_API_BASE_URL =
    Platform.OS === 'android'
        // Android emulator → host machine. For physical devices prefer `adb reverse tcp:5000 tcp:5000` and use localhost.
        ? 'http://10.0.2.2:5000'
        : 'http://localhost:5000';

const API_BASE_URL = __DEV__ ? DEV_API_BASE_URL : 'https://your-production-domain.com';

const INSTALL_ID_KEY = 'grift_device_install_id';
const LEGACY_ID_KEY = 'grift_device_id';
let fingerprintPromise: Promise<string> | null = null;

/**
 * Get device identity headers matching webapp identity.ts
 */
function generateId(): string {
    const cryptoObj: any = (globalThis as any).crypto;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
    if (cryptoObj?.getRandomValues) {
        const bytes = new Uint8Array(16);
        cryptoObj.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function getOrCreateString(key: string): string {
    const existing = storage.getString(key);
    if (existing && existing.trim()) return existing;
    const next = generateId();
    storage.set(key, next);
    return next;
}

function getClientTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

function getClientLanguage(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
    } catch {
        return 'en-US';
    }
}

/* eslint-disable no-bitwise */
function toUtf8Bytes(s: string): Uint8Array {
    try {
        // Prefer native TextEncoder when available (Hermes / JSC / Node)
        const enc = new TextEncoder();
        return enc.encode(s);
    } catch {
        // Minimal UTF-8 fallback (ASCII-safe)
        const out: number[] = [];
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) {
                out.push(0xc0 | (c >> 6));
                out.push(0x80 | (c & 0x3f));
            } else {
                out.push(0xe0 | (c >> 12));
                out.push(0x80 | ((c >> 6) & 0x3f));
                out.push(0x80 | (c & 0x3f));
            }
        }
        return new Uint8Array(out);
    }
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

// Minimal SHA-256 fallback (only used if WebCrypto isn't available).
function sha256Fallback(bytes: Uint8Array): Uint8Array {
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);

    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

    const len = bytes.length;
    const bitLenHi = Math.floor((len * 8) / 2 ** 32);
    const bitLenLo = (len * 8) >>> 0;

    const withOne = len + 1;
    const padLen = (withOne % 64 <= 56) ? (56 - (withOne % 64)) : (56 + (64 - (withOne % 64)));
    const totalLen = withOne + padLen + 8;

    const msg = new Uint8Array(totalLen);
    msg.set(bytes, 0);
    msg[len] = 0x80;
    // 64-bit big-endian length
    msg[totalLen - 8] = (bitLenHi >>> 24) & 0xff;
    msg[totalLen - 7] = (bitLenHi >>> 16) & 0xff;
    msg[totalLen - 6] = (bitLenHi >>> 8) & 0xff;
    msg[totalLen - 5] = bitLenHi & 0xff;
    msg[totalLen - 4] = (bitLenLo >>> 24) & 0xff;
    msg[totalLen - 3] = (bitLenLo >>> 16) & 0xff;
    msg[totalLen - 2] = (bitLenLo >>> 8) & 0xff;
    msg[totalLen - 1] = bitLenLo & 0xff;

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);
    for (let i = 0; i < msg.length; i += 64) {
        for (let t = 0; t < 16; t++) {
            const j = i + t * 4;
            w[t] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
        }
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;

        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const words = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < words.length; i++) {
        const v = words[i];
        out[i * 4] = (v >>> 24) & 0xff;
        out[i * 4 + 1] = (v >>> 16) & 0xff;
        out[i * 4 + 2] = (v >>> 8) & 0xff;
        out[i * 4 + 3] = v & 0xff;
    }
    return out;
}

async function sha256Hex(s: string): Promise<string> {
    const bytes = toUtf8Bytes(s);
    const cryptoObj: any = (globalThis as any).crypto;

    try {
        if (cryptoObj?.subtle?.digest) {
            const buf = await cryptoObj.subtle.digest('SHA-256', bytes);
            return bytesToHex(new Uint8Array(buf));
        }
    } catch {
        // fall back
    }

    return bytesToHex(sha256Fallback(bytes));
}

async function getDeviceFingerprint(): Promise<string> {
    if (fingerprintPromise) return fingerprintPromise;

    fingerprintPromise = (async () => {
        const installId = getOrCreateString(INSTALL_ID_KEY);
        const components = [
            await DeviceInfo.getUniqueId(),
            DeviceInfo.getDeviceId(),
            DeviceInfo.getSystemVersion(),
            DeviceInfo.getBrand(),
            DeviceInfo.getModel(),
            installId,
        ].join('|');

        return sha256Hex(components);
    })();

    return fingerprintPromise;
}

async function getIdentityHeaders(): Promise<Record<string, string>> {
    const deviceInstallId = getOrCreateString(INSTALL_ID_KEY);
    const deviceIdLegacy = getOrCreateString(LEGACY_ID_KEY);
    const deviceFp = await getDeviceFingerprint();

    return {
        'x-device-install-id': deviceInstallId,
        'x-device-id': deviceIdLegacy,
        'x-device-fp': deviceFp,
        'x-client-tz': getClientTimezone(),
        'x-client-lang': getClientLanguage(),
        // Helpful server-side visibility for native clients (not used for auth)
        'x-platform': Platform.OS === 'android' ? 'android-native' : 'ios-native',
        'x-app-version': DeviceInfo.getVersion(),
    };
}

function leadingZeroBits(hex: string): number {
    let bits = 0;
    for (let i = 0; i < hex.length; i++) {
        const v = parseInt(hex[i]!, 16);
        if (v === 0) {
            bits += 4;
            continue;
        }
        if (v < 8) bits += 1;
        if (v < 4) bits += 1;
        if (v < 2) bits += 1;
        return bits;
    }
    return bits;
}

function base64UrlEncode(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';
    let i = 0;

    while (i < bytes.length) {
        const b0 = bytes[i++] ?? 0;
        const b1 = bytes[i++] ?? 0;
        const b2 = bytes[i++] ?? 0;

        const triplet = (b0 << 16) | (b1 << 8) | b2;
        output += alphabet[(triplet >> 18) & 0x3f];
        output += alphabet[(triplet >> 12) & 0x3f];
        output += i - 2 < bytes.length ? alphabet[(triplet >> 6) & 0x3f] : '=';
        output += i - 1 < bytes.length ? alphabet[triplet & 0x3f] : '=';
    }

    return output
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(new RegExp('=+$'), '');
}

function base64UrlEncodeUtf8(s: string): string {
    return base64UrlEncode(toUtf8Bytes(s));
}

/* eslint-enable no-bitwise */

/**
 * Create axios instance with interceptors
 */
function createApiInstance(): AxiosInstance {
    const api = axios.create({
        baseURL: API_BASE_URL,
        timeout: 15000,
        headers: {
            'Content-Type': 'application/json',
        },
        withCredentials: true,
    });

    // Request interceptor - add identity headers
    api.interceptors.request.use(
        async (config: InternalAxiosRequestConfig) => {
            // Add identity headers
            const identityHeaders = await getIdentityHeaders();
            Object.entries(identityHeaders).forEach(([key, value]) => {
                config.headers[key] = value;
            });

            return config;
        },
        (error) => Promise.reject(error)
    );

    // Response interceptor - handle 401 and bot challenges
    api.interceptors.response.use(
        (response: AxiosResponse) => response,
        async (error) => {
            const originalRequest = error.config;

            // Handle 428 Bot Challenge (matching webapp botProof.ts)
            if (error.response?.status === 428) {
                const payload = error.response.data;
                if (payload?.code === 'BOT_CHALLENGE_REQUIRED' && payload?.challenge) {
                    const proof = await solveBotChallenge(payload.challenge);
                    originalRequest.headers['x-bot-proof'] = proof;
                    originalRequest._retry = true;
                    return api(originalRequest);
                }
            }

            return Promise.reject(error);
        }
    );

    return api;
}

/**
 * Solve bot challenge (PoW) matching server/security/botChallenge.ts + web botProof.ts
 */
type BotChallengePayload = {
    id: string;
    serverNonce: string;
    difficulty: number;
    expiresAt: number;
};

async function solveBotChallenge(challenge: BotChallengePayload): Promise<string> {
    const identity = await getIdentityHeaders();
    const deviceFp = identity['x-device-fp'] || '';
    const deviceInstallId = identity['x-device-install-id'] || '';

    const start = Date.now();
    let nonce = 0;

    // Guardrails so we don't hang the UI thread
    const maxMs = 2500;
    const yieldEvery = 250;

    while (Date.now() - start < maxMs) {
        const material = `${challenge.id}|${challenge.serverNonce}|${nonce}|${deviceFp}|${deviceInstallId}`;
        const digest = await sha256Hex(material);
        if (leadingZeroBits(digest) >= challenge.difficulty) {
            const tokenObj = {
                id: challenge.id,
                solutionNonce: nonce,
                ts: Math.floor(Date.now() / 1000),
                deviceFp: deviceFp || undefined,
                deviceInstallId: deviceInstallId || undefined,
                digest,
            };
            return base64UrlEncodeUtf8(JSON.stringify(tokenObj));
        }
        nonce++;
        if (nonce % yieldEvery === 0) {
            await new Promise((r) => setTimeout(r, 0));
        }
    }

    throw new Error('BOT_PROOF_TIMEOUT');
}

// Create the API instance
export const api = createApiInstance();

// ============================================
// AUTH ENDPOINTS (matching webapp use-auth.tsx)
// ============================================
export const authApi = {
    /**
     * Login user
     * POST /api/auth/login
     */
    login: async (email: string, password: string) => {
        const response = await api.post('/api/auth/login', { email, password });
        return response.data;
    },

    /**
     * Register new user
     * POST /api/auth/register
     */
    register: async (data: {
        email: string;
        username: string;
        password: string;
        countryIso2?: string;
        phone?: string;
        termsToken?: string;
        combinedSha256?: string;
        captchaToken?: string;
    }) => {
        const response = await api.post('/api/auth/register', data);
        return response.data;
    },

    /**
     * Logout user
     * POST /api/auth/logout
     */
    logout: async () => {
        await api.post('/api/auth/logout');
    },

    /**
     * Get current user
     * GET /api/auth/current-user
     */
    getCurrentUser: async () => {
        const response = await api.get('/api/auth/current-user');
        return response.data;
    },
};

// ============================================
// TRADING ENDPOINTS (matching webapp use-trades.tsx)
// ============================================
export const tradingApi = {
    /**
     * Get all trades (history)
     * GET /api/trades
     */
    getTrades: async () => {
        const response = await api.get('/api/trades');
        return response.data;
    },

    /**
     * Get open trades (positions)
     * GET /api/trades/open
     */
    getOpenTrades: async () => {
        const response = await api.get('/api/trades/open');
        return response.data;
    },

    /**
     * Get pending orders
     * GET /api/trades/pending
     */
    getPendingOrders: async () => {
        const response = await api.get('/api/trades/pending');
        return response.data;
    },

    /**
     * Create new trade
     * POST /api/trades
     */
    createTrade: async (data: {
        symbolId: number;
        type: 'BUY' | 'SELL';
        lots: number;
        orderType: 'Market' | 'Limit' | 'Stop';
        openPrice?: number;
        limitPrice?: number;
        stopPrice?: number;
        takeProfit?: number;
        stopLoss?: number;
    }) => {
        const response = await api.post('/api/trades', data);
        return response.data;
    },

    /**
     * Close a trade
     * POST /api/trades/:id/close
     */
    closeTrade: async (tradeId: number) => {
        const response = await api.post(`/api/trades/${tradeId}/close`, {});
        return response.data;
    },

    /**
     * Cancel pending order
     * POST /api/trades/:id/cancel
     */
    cancelOrder: async (orderId: number) => {
        const response = await api.post(`/api/trades/${orderId}/cancel`, {});
        return response.data;
    },
};

// ============================================
// QUOTES & SYMBOLS ENDPOINTS
// ============================================
export const quotesApi = {
    /**
     * Get all symbols
     * GET /api/config/symbols
     */
    getSymbols: async () => {
        const response = await api.get('/api/config/symbols');
        return response.data;
    },

    /**
     * Get quotes for symbols
     * GET /api/quotes
     */
    getQuotes: async (symbols?: string[]) => {
        const params = symbols && symbols.length ? { symbols: symbols.join(',') } : undefined;
        const response = await api.get('/api/quotes/latest', { params });
        return response.data;
    },
};

// ============================================
// ACCOUNT ENDPOINTS
// ============================================
export const accountApi = {
    /**
     * Get account summary (balance, equity, margin, etc.)
     * GET /api/account/summary
     */
    getSummary: async () => {
        const response = await api.get('/api/account/summary');
        return response.data;
    },

    /**
     * Update user profile
     * POST /api/profile/update
     */
    updateProfile: async (data: { username: string; name?: string; phone?: string }) => {
        const response = await api.post('/api/profile/update', data);
        return response.data;
    },

    /**
     * Change password
     * POST /api/profile/change-password
     */
    changePassword: async (data: { currentPassword: string; newPassword: string }) => {
        const response = await api.post('/api/profile/change-password', data);
        return response.data;
    },
};

// ============================================
// LEADERBOARD ENDPOINTS
// ============================================
export const leaderboardApi = {
    /**
     * Get top traders
     * GET /api/leaderboard
     */
    getTopTraders: async () => {
        const response = await api.get('/api/leaderboard');
        return response.data;
    },
};

// ============================================
// LEGAL ENDPOINTS (matching webapp legal gate)
// ============================================
export const legalApi = {
    /**
     * Get public legal/captcha config
     * GET /api/legal/public-config
     */
    getPublicConfig: async () => {
        const response = await api.get('/api/legal/public-config');
        return response.data;
    },

    /**
     * Get re-accept status for current user
     * GET /api/legal/doc1/reaccept
     */
    getReacceptStatus: async () => {
        const response = await api.get('/api/legal/doc1/reaccept');
        return response.data;
    },

    /**
     * Accept terms (for re-acceptance flow)
     * POST /api/legal/doc1/accept
     */
    acceptTerms: async (data: { termsToken: string; combinedSha256: string }) => {
        const response = await api.post('/api/legal/doc1/accept', data);
        return response.data;
    },

    /**
     * Resolve terms for a country (signup flow)
     * GET /api/legal/doc1/resolve
     */
    resolveTerms: async (country: string) => {
        const response = await api.get(`/api/legal/doc1/resolve?country=${country}`);
        return response.data;
    },

    /**
     * Check terms availability for a country
     * GET /api/legal/doc1/availability
     */
    checkAvailability: async (country: string) => {
        const response = await api.get(`/api/legal/doc1/availability?country=${country}`);
        return response.data;
    },

    /**
     * Check if terms exist for country
     * GET /api/legal/doc1/check
     */
    checkTerms: async (countryIso2: string) => {
        const response = await api.get(`/api/legal/doc1/check?countryIso2=${countryIso2}`);
        return response.data;
    },
};

// ============================================
// I18N ENDPOINTS (matching webapp i18n system)
// ============================================
export const i18nApi = {
    /**
     * Get i18n config (supported locales, default locale)
     * GET /api/i18n/config
     */
    getConfig: async () => {
        const response = await api.get('/api/i18n/config');
        return response.data;
    },

    /**
     * Get translation bundle for a locale
     * GET /api/i18n/bundle
     */
    getBundle: async (locale: string) => {
        const response = await api.get(`/api/i18n/bundle?locale=${locale}`);
        return response.data;
    },
};

// ============================================
// GRIFT/ANTI-FRAUD ENDPOINTS
// ============================================
export const griftApi = {
    /**
     * Send identity ping to server for anti-fraud tracking
     * POST /api/grift/ping
     */
    ping: async () => {
        const response = await api.post('/api/grift/ping', {});
        return response.data;
    },
};

export default api;
