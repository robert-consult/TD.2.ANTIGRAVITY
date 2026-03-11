/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './client/src/test/setup.ts',
        css: false,
        include: [
            'client/src/**/*.{test,spec}.{js,jsx,ts,tsx}',
            'MOBILE/src/**/*.{test,spec}.{js,jsx,ts,tsx}',
            'server/**/*.{test,spec}.{js,ts}',
            'db/**/*.{test,spec}.{js,ts}'
        ],
        alias: {
            '@': path.resolve(__dirname, './client/src'),
            '@shared': path.resolve(__dirname, './shared'),
            '@db': path.resolve(__dirname, './db'),
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './client/src'),
            '@shared': path.resolve(__dirname, './shared'),
            '@db': path.resolve(__dirname, './db'),
        },
    },
});
