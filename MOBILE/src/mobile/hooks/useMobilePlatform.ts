/**
 * Mobile platform detection and native feature hooks
 * Enhanced version of use-mobile hook with Capacitor integration
 */

import { useState, useEffect, useCallback } from "react";
import {
    isNativeApp,
    isAndroid,
    isIOS,
    getPlatform,
    keyboard,
    network,
    appLifecycle,
    haptics
} from "../utils/mobile-utils";

/**
 * Extended mobile state interface
 */
interface MobileState {
    isMobile: boolean;
    isNative: boolean;
    isAndroid: boolean;
    isIOS: boolean;
    platform: "android" | "ios" | "web";
    keyboardHeight: number;
    keyboardVisible: boolean;
    isConnected: boolean;
    connectionType: string;
    isAppActive: boolean;
}

/**
 * Hook for mobile platform features
 * Provides platform detection, keyboard state, network status, and app lifecycle
 */
export function useMobilePlatform(): MobileState & {
    triggerHaptic: (style?: "light" | "medium" | "heavy") => Promise<void>;
    hideKeyboard: () => Promise<void>;
} {
    const [state, setState] = useState<MobileState>({
        isMobile: false,
        isNative: false,
        isAndroid: false,
        isIOS: false,
        platform: "web",
        keyboardHeight: 0,
        keyboardVisible: false,
        isConnected: true,
        connectionType: "unknown",
        isAppActive: true,
    });

    useEffect(() => {
        // Initial platform detection
        const checkMobile = () => {
            const mobile = window.matchMedia("(max-width: 768px)").matches;
            setState((prev) => ({
                ...prev,
                isMobile: mobile,
                isNative: isNativeApp(),
                isAndroid: isAndroid(),
                isIOS: isIOS(),
                platform: getPlatform(),
            }));
        };

        checkMobile();
        window.addEventListener("resize", checkMobile);

        // Network status listener
        const unsubNetwork = network.onChange((status) => {
            setState((prev) => ({
                ...prev,
                isConnected: status.connected,
                connectionType: status.connectionType,
            }));
        });

        // Initial network check
        network.getStatus().then((status) => {
            setState((prev) => ({
                ...prev,
                isConnected: status.connected,
                connectionType: status.connectionType,
            }));
        });

        // Keyboard listeners (native only)
        const unsubKeyboardShow = keyboard.onShow((info) => {
            setState((prev) => ({
                ...prev,
                keyboardHeight: info.keyboardHeight,
                keyboardVisible: true,
            }));
        });

        const unsubKeyboardHide = keyboard.onHide(() => {
            setState((prev) => ({
                ...prev,
                keyboardHeight: 0,
                keyboardVisible: false,
            }));
        });

        // App lifecycle listener
        const unsubLifecycle = appLifecycle.onStateChange((appState) => {
            setState((prev) => ({
                ...prev,
                isAppActive: appState.isActive,
            }));
        });

        return () => {
            window.removeEventListener("resize", checkMobile);
            unsubNetwork();
            unsubKeyboardShow();
            unsubKeyboardHide();
            unsubLifecycle();
        };
    }, []);

    const triggerHaptic = useCallback(async (style: "light" | "medium" | "heavy" = "light") => {
        switch (style) {
            case "light":
                await haptics.light();
                break;
            case "medium":
                await haptics.medium();
                break;
            case "heavy":
                await haptics.heavy();
                break;
        }
    }, []);

    const hideKeyboard = useCallback(async () => {
        await keyboard.hide();
    }, []);

    return {
        ...state,
        triggerHaptic,
        hideKeyboard,
    };
}

/**
 * Hook for safe area insets
 * Handles notches, home indicators, and system bars
 */
export function useSafeArea(): {
    top: number;
    bottom: number;
    left: number;
    right: number;
} {
    const [insets, setInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });

    useEffect(() => {
        const updateInsets = () => {
            const style = getComputedStyle(document.documentElement);

            const parseValue = (value: string): number => {
                const num = parseFloat(value);
                return isNaN(num) ? 0 : num;
            };

            setInsets({
                top: parseValue(style.getPropertyValue("--safe-area-inset-top") || "0"),
                bottom: parseValue(style.getPropertyValue("--safe-area-inset-bottom") || "0"),
                left: parseValue(style.getPropertyValue("--safe-area-inset-left") || "0"),
                right: parseValue(style.getPropertyValue("--safe-area-inset-right") || "0"),
            });
        };

        updateInsets();
        window.addEventListener("resize", updateInsets);

        return () => window.removeEventListener("resize", updateInsets);
    }, []);

    return insets;
}

/**
 * Hook for Android back button handling
 */
export function useBackButton(handler: () => boolean | void) {
    useEffect(() => {
        if (!isAndroid()) return;

        const unsubscribe = appLifecycle.onBackButton(() => {
            const handled = handler();
            // If handler returns false, exit the app
            if (handled === false) {
                appLifecycle.exitApp();
            }
        });

        return unsubscribe;
    }, [handler]);
}

/**
 * Hook for network connectivity status
 */
export function useNetworkStatus() {
    const [status, setStatus] = useState<{
        connected: boolean;
        connectionType: string;
    }>({
        connected: true,
        connectionType: "unknown",
    });

    useEffect(() => {
        network.getStatus().then(setStatus);
        const unsubscribe = network.onChange(setStatus);
        return unsubscribe;
    }, []);

    return status;
}
