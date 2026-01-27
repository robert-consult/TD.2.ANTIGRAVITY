/**
 * TradeQuip Android - Auth Hook
 * Aligned with webapp use-auth.tsx
 */

import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';
import { authApi } from '../services/api';
import { wsService } from '../services/websocket';

const storage = new MMKV();

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
    // Tier system
    userTier?: 'CANDIDATE' | 'PERFORMER' | 'SELECTED';
    contenderTier?: string;
    // Verification
    emailVerified?: boolean;
    emailVerifiedAt?: number | null;
    inGracePeriod?: boolean;
    gracePeriodEndsAt?: number | null;
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
            await authApi.logout();
        } catch (error) {
            console.warn('Logout API error:', error);
        } finally {
            // Always clear local state
            storage.delete('authToken');
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
        const token = storage.getString('authToken');
        if (!token) {
            set({ isLoading: false, isAuthenticated: false, user: null });
            return;
        }

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
            storage.delete('authToken');
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
