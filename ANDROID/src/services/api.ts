/**
 * TradeQuip Android - API Service
 */

import axios from 'axios';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

const API_BASE_URL = 'https://your-api-domain.com'; // TODO: Replace with actual API URL

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to add auth token
api.interceptors.request.use(
    (config) => {
        const token = storage.getString('authToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Handle unauthorized - redirect to login
            storage.delete('authToken');
        }
        return Promise.reject(error);
    }
);

// Auth endpoints
export const authApi = {
    login: async (email: string, password: string) => {
        const response = await api.post('/api/login', { email, password });
        return response.data;
    },
    register: async (data: {
        email: string;
        password: string;
        phone: string;
        countryCode: string;
    }) => {
        const response = await api.post('/api/register', data);
        return response.data;
    },
    logout: async () => {
        const response = await api.post('/api/logout');
        storage.delete('authToken');
        return response.data;
    },
    getUser: async () => {
        const response = await api.get('/api/me');
        return response.data;
    },
};

// Trading endpoints
export const tradingApi = {
    getQuotes: async () => {
        const response = await api.get('/api/quotes');
        return response.data;
    },
    getSymbols: async () => {
        const response = await api.get('/api/config/symbols');
        return response.data;
    },
    executeTrade: async (order: {
        symbol: string;
        side: 'buy' | 'sell';
        type: 'market' | 'limit' | 'stop';
        quantity: number;
        price?: number;
        timeInForce?: string;
    }) => {
        const response = await api.post('/api/trades/execute', order);
        return response.data;
    },
    getPositions: async () => {
        const response = await api.get('/api/trades/positions');
        return response.data;
    },
    getHistory: async () => {
        const response = await api.get('/api/trades/history');
        return response.data;
    },
};

// Leaderboard endpoints
export const leaderboardApi = {
    getTopTraders: async () => {
        const response = await api.get('/api/leaderboard');
        return response.data;
    },
};

export default api;
