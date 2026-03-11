/**
 * TradeQuip Native - Auth Hook
 * Aligned with webapp use-auth.tsx
 */

import { create } from 'zustand';
import { authApi } from '../services/api';
import { clearCsrfTokenCache } from '../services/csrf';
import pushNotificationService from '../services/pushNotifications';
import { wsService } from '../services/websocket';

// User interface matching webapp User type
export interface User {
    id: number;
    email: string;
    username: string;
    name?: string;
    phone?: string;
    countryIso2?: string | null;
    language?: string;
    balance: string;
    equity?: number;
    freeMargin?: number;
    usedMargin?: number;
    leverage?: number;
    isAdmin?: boolean;
    createdAt?: string;
    // View As impersonation fields (web parity; not currently exposed in native UI)
    isImpersonating?: boolean;
    realAdminId?: number | null;
    realAdminEmail?: string | null;
    // Tier system
    userTier?: 'CANDIDATE' | 'PERFORMER' | 'SELECTED';
    contenderTier?: string;
    // Verification
    emailVerified?: boolean;
    emailVerifiedAt?: number | null;
    inGracePeriod?: boolean;
    gracePeriodEndsAt?: number | null;
    // Legal re-acceptance gate (DOC1)
    legalReacceptRequired?: boolean;
    legalReacceptBlocked?: boolean;
    legalReacceptBlockedReason?: string | null;
    legalRequiredCombinedSha256?: string | null;
    legalLastAcceptedCombinedSha256?: string | null;
}

interface RegisterOptions {
    countryIso2?: string;
    phone?: string;
    termsToken?: string;
    combinedSha256?: string;
    captchaToken?: string;
}

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;

    // Actions
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, username: string, password: string, opts?: RegisterOptions) => Promise<void>;
    logout: () => Promise<void>;
    checkAuth: () => Promise<void>;
    updateUser: (patch: Partial<User>) => void;
    clearError: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,

    login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
            const data = await authApi.login(email, password);
            set({
                user: data,
                isAuthenticated: true,
                isLoading: false,
            });
            // Enable WebSocket after login
            wsService.enable();
        } catch (error: any) {
            const message = error.response?.data?.message || error.message || 'Login failed';
            set({
                error: message,
                isLoading: false,
            });
            throw new Error(message);
        }
    },

    register: async (email: string, username: string, password: string, opts?: RegisterOptions) => {
        set({ isLoading: true, error: null });
        try {
            const data = await authApi.register({
                email,
                username,
                password,
                ...opts,
            });
            set({
                user: data,
                isAuthenticated: true,
                isLoading: false,
            });
            wsService.enable();
        } catch (error: any) {
            const message = error.response?.data?.message || error.message || 'Registration failed';
            set({
                error: message,
                isLoading: false,
            });
            throw new Error(message);
        }
    },

    logout: async () => {
        set({ isLoading: true });
        try {
            await pushNotificationService.unregisterToken().catch((error) => {
                console.warn('Push token unregister error:', error);
            });
            await authApi.logout();
        } catch (error) {
            console.warn('Logout API error:', error);
        } finally {
            // Always clear local state
            pushNotificationService.clearStoredToken();
            clearCsrfTokenCache();
            wsService.disable();
            set({
                user: null,
                isAuthenticated: false,
                isLoading: false,
                error: null,
            });
        }
    },

    checkAuth: async () => {
        set({ isLoading: true });
        try {
            const data = await authApi.getCurrentUser();
            set({
                user: data,
                isAuthenticated: true,
                isLoading: false,
            });
            wsService.enable();
        } catch {
            clearCsrfTokenCache();
            wsService.disable();
            set({
                user: null,
                isAuthenticated: false,
                isLoading: false,
            });
        }
    },

    updateUser: (patch: Partial<User>) => {
        const { user } = get();
        if (user) {
            set({ user: { ...user, ...patch } });
        }
    },

    clearError: () => {
        set({ error: null });
    },
}));

export default useAuth;
