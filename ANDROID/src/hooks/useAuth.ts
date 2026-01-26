/**
 * TradeQuip Android - Auth Hook
 */

import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';
import { authApi } from '../services/api';

const storage = new MMKV();

interface User {
    id: string;
    email: string;
    name: string;
    balance: number;
    isAdmin: boolean;
}

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    checkAuth: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,

    login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
            const response = await authApi.login(email, password);
            storage.set('authToken', response.token);
            set({
                user: response.user,
                isAuthenticated: true,
                isLoading: false,
            });
        } catch (error: any) {
            set({
                error: error.response?.data?.message || 'Login failed',
                isLoading: false,
            });
            throw error;
        }
    },

    logout: async () => {
        set({ isLoading: true });
        try {
            await authApi.logout();
        } catch (error) {
            // Continue logout even if API call fails
        }
        storage.delete('authToken');
        set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
        });
    },

    checkAuth: async () => {
        const token = storage.getString('authToken');
        if (!token) {
            set({ isLoading: false, isAuthenticated: false });
            return;
        }

        try {
            const response = await authApi.getUser();
            set({
                user: response.user,
                isAuthenticated: true,
                isLoading: false,
            });
        } catch (error) {
            storage.delete('authToken');
            set({
                user: null,
                isAuthenticated: false,
                isLoading: false,
            });
        }
    },
}));

export default useAuth;
