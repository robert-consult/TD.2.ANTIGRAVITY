/**
 * Mobile Session Management
 * Handles session persistence and validation for Capacitor app
 */

import { App } from "@capacitor/app";
import {
    AUTH_CURRENT_USER_API_PATH,
    AUTH_LOGOUT_API_PATH,
    MOBILE_SESSION_POLL_INTERVAL_MS,
} from "@shared/appSurfaceConfig";
import { isNativeApp } from "./mobile-utils";
import { fetchCsrfToken } from "./csrf";

let currentUserStatusRequest: Promise<SessionStatus> | null = null;

export interface SessionStatus {
    isAuthenticated: boolean;
    userId?: number;
    email?: string;
    isAdmin?: boolean;
    expiresAt?: number;
}

async function fetchCurrentUserStatus(): Promise<SessionStatus> {
    if (currentUserStatusRequest) {
        return currentUserStatusRequest;
    }

    currentUserStatusRequest = (async () => {
        try {
            const response = await fetch(AUTH_CURRENT_USER_API_PATH, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Accept": "application/json",
                },
            });

            if (!response.ok) {
                return { isAuthenticated: false };
            }

            const data = await response.json();
            return {
                isAuthenticated: true,
                userId: data.id,
                email: data.email,
                isAdmin: data.isAdmin,
            };
        } catch (error) {
            console.error("Session check failed:", error);
            return { isAuthenticated: false };
        } finally {
            currentUserStatusRequest = null;
        }
    })();

    return currentUserStatusRequest;
}

/**
 * Check current session status with backend
 */
export async function checkSessionStatus(): Promise<SessionStatus> {
    return fetchCurrentUserStatus();
}

/**
 * Refresh session to extend expiration
 */
export async function refreshSession(): Promise<boolean> {
    const status = await fetchCurrentUserStatus();
    return status.isAuthenticated;
}

/**
 * Handle session expiration
 */
export async function handleSessionExpired(onExpired: () => void): Promise<void> {
    const status = await checkSessionStatus();
    if (!status.isAuthenticated) {
        onExpired();
    }
}

/**
 * Initialize session monitoring for mobile app
 * Checks session on app resume and periodically
 */
export function initSessionMonitoring(callbacks: {
    onSessionValid?: (status: SessionStatus) => void;
    onSessionExpired?: () => void;
    onNetworkError?: () => void;
}): () => void {
    if (!isNativeApp()) {
        return () => { };
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Check session when app comes to foreground
    const appStateListener = App.addListener("appStateChange", async (state) => {
        if (state.isActive) {
            try {
                const status = await checkSessionStatus();
                if (status.isAuthenticated) {
                    callbacks.onSessionValid?.(status);
                } else {
                    callbacks.onSessionExpired?.();
                }
            } catch {
                callbacks.onNetworkError?.();
            }
        }
    });

    // Periodic session check (every 5 minutes)
    intervalId = setInterval(async () => {
        try {
            const status = await checkSessionStatus();
            if (!status.isAuthenticated) {
                callbacks.onSessionExpired?.();
            }
        } catch {
            // Silent fail for background checks
        }
    }, MOBILE_SESSION_POLL_INTERVAL_MS);

    // Return cleanup function
    return () => {
        void appStateListener.then((l) => l.remove());
        if (intervalId) {
            clearInterval(intervalId);
        }
    };
}

/**
 * Secure logout - clears session on both client and server
 */
export async function secureLogout(): Promise<boolean> {
    try {
        const token = await fetchCsrfToken();
        const response = await fetch(AUTH_LOGOUT_API_PATH, {
            method: "POST",
            credentials: "include",
            headers: token ? { "x-csrf-token": token } : undefined,
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Cookie debugging helper (development only)
 */
export function debugCookies(): void {
    if (import.meta.env.DEV) {
        console.log("Document cookies:", document.cookie);
        console.log("Cookie enabled:", navigator.cookieEnabled);
    }
}
