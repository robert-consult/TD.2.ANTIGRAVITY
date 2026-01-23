/**
 * Push Notification Service
 * Handles Firebase Cloud Messaging (FCM) for TradeQuip mobile app
 */

import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "./mobile-utils";

export interface PushNotificationToken {
    value: string;
}

export interface PushNotificationData {
    id: string;
    title?: string;
    body?: string;
    data: Record<string, string>;
}

/**
 * Register device for push notifications
 * Returns the FCM token on success
 */
export async function registerPushNotifications(): Promise<string | null> {
    if (!isNativeApp()) {
        console.log("Push notifications only available on native platforms");
        return null;
    }

    try {
        // Request permission
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === "prompt") {
            permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== "granted") {
            console.warn("Push notification permission denied");
            return null;
        }

        // Register with FCM
        await PushNotifications.register();

        // Get the token
        return new Promise((resolve) => {
            PushNotifications.addListener("registration", (token: PushNotificationToken) => {
                console.log("Push registration success, token:", token.value);
                resolve(token.value);
            });

            PushNotifications.addListener("registrationError", (error: any) => {
                console.error("Push registration error:", error);
                resolve(null);
            });
        });
    } catch (error) {
        console.error("Failed to register push notifications:", error);
        return null;
    }
}

/**
 * Send FCM token to backend for storage
 */
export async function sendTokenToServer(token: string): Promise<boolean> {
    try {
        const response = await fetch("/api/push/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ token, platform: "android" }),
        });

        return response.ok;
    } catch (error) {
        console.error("Failed to send push token to server:", error);
        return false;
    }
}

/**
 * Initialize push notification listeners
 */
export function initPushNotificationListeners(handlers: {
    onNotificationReceived?: (notification: PushNotificationData) => void;
    onNotificationTapped?: (notification: PushNotificationData) => void;
}): () => void {
    if (!isNativeApp()) {
        return () => { };
    }

    const listeners: Promise<any>[] = [];

    // Handle notification received while app is in foreground
    listeners.push(
        PushNotifications.addListener("pushNotificationReceived", (notification) => {
            console.log("Push notification received:", notification);
            handlers.onNotificationReceived?.({
                id: notification.id,
                title: notification.title,
                body: notification.body,
                data: notification.data,
            });
        })
    );

    // Handle notification tapped (app opened from notification)
    listeners.push(
        PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            console.log("Push notification tapped:", action);
            handlers.onNotificationTapped?.({
                id: action.notification.id,
                title: action.notification.title,
                body: action.notification.body,
                data: action.notification.data,
            });
        })
    );

    // Return cleanup function
    return () => {
        listeners.forEach((listener) => {
            listener.then((l) => l.remove());
        });
    };
}

/**
 * Check if push notifications are enabled
 */
export async function arePushNotificationsEnabled(): Promise<boolean> {
    if (!isNativeApp()) {
        return false;
    }

    try {
        const status = await PushNotifications.checkPermissions();
        return status.receive === "granted";
    } catch {
        return false;
    }
}

/**
 * Get list of delivered notifications (Android only)
 */
export async function getDeliveredNotifications(): Promise<PushNotificationData[]> {
    if (!isNativeApp()) {
        return [];
    }

    try {
        const result = await PushNotifications.getDeliveredNotifications();
        return result.notifications.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            data: n.data,
        }));
    } catch {
        return [];
    }
}

/**
 * Remove all delivered notifications
 */
export async function clearAllNotifications(): Promise<void> {
    if (!isNativeApp()) {
        return;
    }

    try {
        await PushNotifications.removeAllDeliveredNotifications();
    } catch (error) {
        console.error("Failed to clear notifications:", error);
    }
}
