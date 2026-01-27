/**
 * TradeQuip Android - API Service
 * Aligned with webapp API structure for secure communication
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { MMKV } from 'react-native-mmkv';
import DeviceInfo from 'react-native-device-info';

const storage = new MMKV();

// Base URL - set via environment or config
const API_BASE_URL = __DEV__
    ? 'http://localhost:5000' // Dev: use adb reverse tcp:5000 tcp:5000
    : 'https://your-production-domain.com';

/**
 * Get device identity headers matching webapp identity.ts
 */
async function getIdentityHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    try {
        // Device ID (persistent)
        let deviceId = storage.getString('deviceId');
        if (!deviceId) {
            deviceId = await DeviceInfo.getUniqueId();
            storage.set('deviceId', deviceId);
        }
        headers['x-device-id'] = deviceId;

        // Device fingerprint
        headers['x-device-fingerprint'] = await generateFingerprint();

        // Platform identifier
        headers['x-platform'] = 'android-native';
        headers['x-app-version'] = DeviceInfo.getVersion();

    } catch (error) {
        console.warn('Failed to generate identity headers:', error);
    }

    return headers;
}

/**
 * Generate device fingerprint for bot-proof system
 */
async function generateFingerprint(): Promise<string> {
    const components = [
        await DeviceInfo.getUniqueId(),
        DeviceInfo.getDeviceId(),
        DeviceInfo.getSystemVersion(),
        DeviceInfo.getBrand(),
        DeviceInfo.getModel(),
    ];

    // Simple hash of components
    const str = components.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

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

    // Request interceptor - add auth token and identity headers
    api.interceptors.request.use(
        async (config: InternalAxiosRequestConfig) => {
            // Add auth token if available
            const token = storage.getString('authToken');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }

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

            // Handle 401 Unauthorized
            if (error.response?.status === 401 && !originalRequest._retry) {
                storage.delete('authToken');
                // Dispatch logout event
                // eventEmitter.emit('auth:logout');
            }

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
 * Solve bot challenge (simplified for mobile - server may use different challenge for native)
 */
async function solveBotChallenge(challenge: any): Promise<string> {
    // Simplified challenge solving for mobile
    // In production, implement proper challenge-response based on server requirements
    const { difficulty = 4, prefix = '' } = challenge;
    let nonce = 0;
    const target = '0'.repeat(difficulty);

    while (nonce < 1000000) {
        const attempt = `${prefix}:${nonce}`;
        // Simple hash check - replace with proper implementation
        const hash = simpleHash(attempt);
        if (hash.startsWith(target)) {
            return `${nonce}:${hash}`;
        }
        nonce++;
    }

    throw new Error('Failed to solve bot challenge');
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
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
        if (response.data.token) {
            storage.set('authToken', response.data.token);
        }
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
        if (response.data.token) {
            storage.set('authToken', response.data.token);
        }
        return response.data;
    },

    /**
     * Logout user
     * POST /api/auth/logout
     */
    logout: async () => {
        try {
            await api.post('/api/auth/logout');
        } finally {
            storage.delete('authToken');
        }
    },

    /**
     * Get current user
     * GET /api/auth/current-user
     */
    getCurrentUser: async () => {
        const response = await api.get('/api/auth/current-user');
        return response.data;
    },

    /**
     * Request password reset
     * POST /api/auth/forgot-password
     */
    forgotPassword: async (email: string) => {
        const response = await api.post('/api/auth/forgot-password', { email });
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
        size: number;
        openPrice: number;
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
    getQuotes: async () => {
        const response = await api.get('/api/quotes');
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
     * PATCH /api/user/profile
     */
    updateProfile: async (data: { name?: string; phone?: string }) => {
        const response = await api.patch('/api/user/profile', data);
        return response.data;
    },

    /**
     * Change password
     * POST /api/auth/change-password
     */
    changePassword: async (data: { currentPassword: string; newPassword: string }) => {
        const response = await api.post('/api/auth/change-password', data);
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
