/**
 * Mobile-specific utilities for Capacitor integration
 * Provides platform detection, safe area handling, and native feature access
 */

import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";

/**
 * Check if running inside a Capacitor native app
 */
export function isNativeApp(): boolean {
    return Capacitor.isNativePlatform();
}

/**
 * Check if running on Android
 */
export function isAndroid(): boolean {
    return Capacitor.getPlatform() === "android";
}

/**
 * Check if running on iOS
 */
export function isIOS(): boolean {
    return Capacitor.getPlatform() === "ios";
}

/**
 * Check if running in web browser
 */
export function isWeb(): boolean {
    return Capacitor.getPlatform() === "web";
}

/**
 * Get current platform name
 */
export function getPlatform(): "android" | "ios" | "web" {
    return Capacitor.getPlatform() as "android" | "ios" | "web";
}

/**
 * Status Bar Controls
 */
export const statusBar = {
    async setDark() {
        if (!isNativeApp()) return;
        await StatusBar.setStyle({ style: Style.Dark });
    },

    async setLight() {
        if (!isNativeApp()) return;
        await StatusBar.setStyle({ style: Style.Light });
    },

    async setBackgroundColor(color: string) {
        if (!isNativeApp()) return;
        await StatusBar.setBackgroundColor({ color });
    },

    async hide() {
        if (!isNativeApp()) return;
        await StatusBar.hide();
    },

    async show() {
        if (!isNativeApp()) return;
        await StatusBar.show();
    },
};

/**
 * Haptic Feedback
 */
export const haptics = {
    async light() {
        if (!isNativeApp()) return;
        await Haptics.impact({ style: ImpactStyle.Light });
    },

    async medium() {
        if (!isNativeApp()) return;
        await Haptics.impact({ style: ImpactStyle.Medium });
    },

    async heavy() {
        if (!isNativeApp()) return;
        await Haptics.impact({ style: ImpactStyle.Heavy });
    },

    async vibrate() {
        if (!isNativeApp()) return;
        await Haptics.vibrate();
    },
};

/**
 * Keyboard Controls
 */
export const keyboard = {
    async hide() {
        if (!isNativeApp()) return;
        await Keyboard.hide();
    },

    async show() {
        if (!isNativeApp()) return;
        await Keyboard.show();
    },

    onShow(callback: (info: { keyboardHeight: number }) => void) {
        if (!isNativeApp()) return () => { };
        const listener = Keyboard.addListener("keyboardWillShow", callback);
        return () => listener.then((l) => l.remove());
    },

    onHide(callback: () => void) {
        if (!isNativeApp()) return () => { };
        const listener = Keyboard.addListener("keyboardWillHide", callback);
        return () => listener.then((l) => l.remove());
    },
};

/**
 * Network Status
 */
export const network = {
    async getStatus() {
        const status = await Network.getStatus();
        return status;
    },

    async isConnected() {
        const status = await Network.getStatus();
        return status.connected;
    },

    onChange(callback: (status: { connected: boolean; connectionType: string }) => void) {
        const listener = Network.addListener("networkStatusChange", callback);
        return () => listener.then((l) => l.remove());
    },
};

/**
 * Splash Screen
 */
export const splash = {
    async hide() {
        if (!isNativeApp()) return;
        await SplashScreen.hide();
    },

    async show() {
        if (!isNativeApp()) return;
        await SplashScreen.show({
            autoHide: false,
        });
    },
};

/**
 * App Lifecycle
 */
export const appLifecycle = {
    onStateChange(callback: (state: { isActive: boolean }) => void) {
        const listener = App.addListener("appStateChange", callback);
        return () => listener.then((l) => l.remove());
    },

    onBackButton(callback: () => void) {
        if (!isAndroid()) return () => { };
        const listener = App.addListener("backButton", callback);
        return () => listener.then((l) => l.remove());
    },

    async exitApp() {
        if (!isNativeApp()) return;
        await App.exitApp();
    },
};

/**
 * Safe Area Insets (for notches, navigation bars, etc.)
 * Returns CSS custom properties that can be applied
 */
export function getSafeAreaInsets(): {
    top: string;
    bottom: string;
    left: string;
    right: string;
} {
    if (typeof window === "undefined" || !window.getComputedStyle) {
        return { top: "0px", bottom: "0px", left: "0px", right: "0px" };
    }

    const style = window.getComputedStyle(document.documentElement);
    return {
        top: style.getPropertyValue("--sat") || style.getPropertyValue("env(safe-area-inset-top)") || "0px",
        bottom: style.getPropertyValue("--sab") || style.getPropertyValue("env(safe-area-inset-bottom)") || "0px",
        left: style.getPropertyValue("--sal") || style.getPropertyValue("env(safe-area-inset-left)") || "0px",
        right: style.getPropertyValue("--sar") || style.getPropertyValue("env(safe-area-inset-right)") || "0px",
    };
}

/**
 * Initialize mobile features
 * Call this on app startup
 */
export async function initializeMobile() {
    if (!isNativeApp()) return;

    // Set status bar style
    await statusBar.setDark();
    await statusBar.setBackgroundColor("#0a1628");

    // Hide splash screen after app is ready
    await splash.hide();

    // Set up keyboard resize behavior
    if (isAndroid()) {
        // Android-specific initialization
    }
}
