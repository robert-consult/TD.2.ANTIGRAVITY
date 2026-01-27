/**
 * TradeQuip Native - Grift Ping Service
 * Sends periodic identity pings to server for anti-fraud tracking
 * Matches webapp griftPing.ts functionality
 */

import { griftApi } from './api';

type GriftPingOptions = {
    intervalMs?: number;
};

let stopFn: (() => void) | null = null;

/**
 * Start the grift ping service
 * Sends identity headers with periodic pings to /api/grift/ping
 * Headers are automatically attached by the api interceptor
 */
export function startGriftPing(options?: GriftPingOptions): () => void {
    // Clamp interval between 30 seconds and 5 minutes, default 60 seconds
    const intervalMs = Math.max(30_000, Math.min(5 * 60_000, options?.intervalMs ?? 60_000));
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const send = async () => {
        try {
            await griftApi.ping();
            console.log('[GriftPing] Ping sent successfully');
        } catch (error) {
            // Ignore ping failures to avoid impacting app flow
            console.warn('[GriftPing] Ping failed (non-blocking):', error);
        }
    };

    const loop = async () => {
        if (stopped) return;
        await send();
        if (stopped) return;
        timer = setTimeout(loop, intervalMs);
    };

    // Start the loop
    loop();

    // Return cleanup function
    const cleanup = () => {
        stopped = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    stopFn = cleanup;
    return cleanup;
}

/**
 * Stop any running grift ping service
 */
export function stopGriftPing(): void {
    if (stopFn) {
        stopFn();
        stopFn = null;
    }
}

/**
 * Check if grift ping is currently running
 */
export function isGriftPingRunning(): boolean {
    return stopFn !== null;
}
