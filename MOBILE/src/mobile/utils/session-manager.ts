/**
 * Mobile Session Management
 * Handles session persistence and validation for Capacitor app
 */

import { App } from "@capacitor/app";
import { isNativeApp } from "./mobile-utils";

export interface SessionStatus {
    isAuthenticated: boolean;
    userId?: number;
    email?: string;
    isAdmin?: boolean;
    expiresAt?: number;
}

/**
 * Check current session status with backend
 */
export async function checkSessionStatus(): Promise<SessionStatus> {
    try {
        const response = await fetch("/api/auth/current-user", {
            method: "GET",
            credentials: "include",
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
    }
}

/**
 * Refresh session to extend expiration
 */
export async function refreshSession(): Promise<boolean> {
    try {
        const response = await fetch("/api/auth/refresh", {
            method: "POST",
            credentials: "include",
        });
        return response.ok;
    } catch {
        return false;
    }
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

    let intervalId: NodeJS.Timeout | null = null;

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
    }, 5 * 60 * 1000);

    // Return cleanup function
    return () => {
        appStateListener.then((l) => l.remove());
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
        const response = await fetch("/api/logout", {
            method: "POST",
            credentials: "include",
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
    if (process.env.NODE_ENV !== "production") {
        console.log("Document cookies:", document.cookie);
        console.log("Cookie enabled:", navigator.cookieEnabled);
    }
}
