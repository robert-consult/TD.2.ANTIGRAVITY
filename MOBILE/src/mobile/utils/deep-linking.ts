/**
 * Deep Linking Configuration and Handlers
 * Handles App Links and in-app navigation for TradeQuip mobile
 */

import { App, URLOpenListenerEvent } from "@capacitor/app";
import { isNativeApp } from "./mobile-utils";

// Deep link routes configuration
export interface DeepLinkRoute {
    pattern: RegExp;
    handler: (matches: RegExpMatchArray) => { screen: string; params: Record<string, string> };
}

const deepLinkRoutes: DeepLinkRoute[] = [
    // Trade a specific symbol: tradequip://trade/USDJPY
    {
        pattern: /^\/trade\/([A-Z]{6})$/i,
        handler: (matches) => ({
            screen: "trade",
            params: { symbol: matches[1].toUpperCase() },
        }),
    },
    // View chart: tradequip://chart/EURUSD
    {
        pattern: /^\/chart\/([A-Z]{6})$/i,
        handler: (matches) => ({
            screen: "chart",
            params: { symbol: matches[1].toUpperCase() },
        }),
    },
    // Profile settings: tradequip://settings
    {
        pattern: /^\/settings$/i,
        handler: () => ({
            screen: "settings",
            params: {},
        }),
    },
    // Account section: tradequip://account
    {
        pattern: /^\/account$/i,
        handler: () => ({
            screen: "account",
            params: {},
        }),
    },
    // History: tradequip://history
    {
        pattern: /^\/history$/i,
        handler: () => ({
            screen: "history",
            params: {},
        }),
    },
    // Dashboard/home: tradequip://home or tradequip://
    {
        pattern: /^\/?(home)?$/i,
        handler: () => ({
            screen: "quotes",
            params: {},
        }),
    },
];

export interface DeepLinkResult {
    screen: string;
    params: Record<string, string>;
    originalUrl: string;
}

/**
 * Parse a deep link URL and extract navigation info
 */
export function parseDeepLink(url: string): DeepLinkResult | null {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname;

        for (const route of deepLinkRoutes) {
            const matches = path.match(route.pattern);
            if (matches) {
                const result = route.handler(matches);
                return {
                    ...result,
                    originalUrl: url,
                };
            }
        }

        // Default to home if no match
        return {
            screen: "quotes",
            params: {},
            originalUrl: url,
        };
    } catch (e) {
        console.warn("Failed to parse deep link:", url, e);
        return null;
    }
}

/**
 * Initialize deep link listener
 * Call this on app startup
 */
export function initDeepLinking(
    onNavigate: (result: DeepLinkResult) => void
): () => void {
    if (!isNativeApp()) {
        return () => { };
    }

    // Handle URL when app is opened via deep link
    const listener = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
        const result = parseDeepLink(event.url);
        if (result) {
            onNavigate(result);
        }
    });

    // Check if app was launched with a URL
    App.getLaunchUrl().then((launchUrl) => {
        if (launchUrl?.url) {
            const result = parseDeepLink(launchUrl.url);
            if (result) {
                onNavigate(result);
            }
        }
    });

    // Return cleanup function
    return () => {
        listener.then((l) => l.remove());
    };
}

/**
 * Generate a deep link URL for sharing
 */
export function generateDeepLink(
    screen: string,
    params?: Record<string, string>
): string {
    const baseUrl = "https://tradequip.app"; // Production domain for App Links

    switch (screen) {
        case "trade":
            return params?.symbol
                ? `${baseUrl}/trade/${params.symbol}`
                : `${baseUrl}/trade`;
        case "chart":
            return params?.symbol
                ? `${baseUrl}/chart/${params.symbol}`
                : `${baseUrl}/chart`;
        case "settings":
            return `${baseUrl}/settings`;
        case "account":
            return `${baseUrl}/account`;
        case "history":
            return `${baseUrl}/history`;
        default:
            return baseUrl;
    }
}
