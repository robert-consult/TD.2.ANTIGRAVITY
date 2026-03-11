/**
 * Push notification helpers for the Capacitor wrapper.
 * The wrapper stores its active token locally so logout/session flows can revoke it safely.
 */

import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import { getPlatform, isNativeApp } from "./mobile-utils";
import { fetchWithCsrf } from "./csrf";
import {
  DEVICE_INSTALL_ID_STORAGE_KEY,
  LEGACY_DEVICE_ID_STORAGE_KEY,
} from "@shared/identity/headers";
import { generateIdentityId } from "@shared/identity/device";

declare const __TQ_BUILD_HASH__: string;

const PUSH_TOKEN_STORAGE_KEY = "tradequip.wrapper.push-token";
const PUSH_REGISTRATION_TIMEOUT_MS = 15_000;

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function getOrCreateStorageValue(key: string): string {
  const existing = safeGetItem(key);
  if (existing) return existing;
  const created = generateIdentityId();
  safeSetItem(key, created);
  return created;
}

function resolvePushEnvironment(): "development" | "staging" | "production" {
  const mode = String(import.meta.env.MODE || "").trim().toLowerCase();
  if (import.meta.env.PROD) return "production";
  if (mode === "staging") return "staging";
  return "development";
}

function getAppVersion(): string {
  const value = String(import.meta.env.VITE_APP_VERSION || "").trim();
  if (value) return value;
  return __TQ_BUILD_HASH__;
}

function getBuildNumber(): string {
  const value = String(import.meta.env.VITE_BUILD_NUMBER || "").trim();
  if (value) return value;
  return __TQ_BUILD_HASH__;
}

function getLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || navigator.language || "en-US";
  } catch {
    return navigator.language || "en-US";
  }
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function removeListener(listenerPromise: Promise<PluginListenerHandle> | null): Promise<void> {
  if (!listenerPromise) return;
  try {
    const listener = await listenerPromise;
    await listener.remove();
  } catch {
    // Ignore cleanup failures.
  }
}

export interface PushNotificationToken {
  value: string;
}

export interface PushNotificationData {
  id: string;
  title?: string;
  body?: string;
  data: Record<string, string>;
}

export function getStoredPushToken(): string | null {
  return safeGetItem(PUSH_TOKEN_STORAGE_KEY);
}

function storePushToken(token: string): void {
  safeSetItem(PUSH_TOKEN_STORAGE_KEY, token);
}

function clearStoredPushToken(): void {
  safeRemoveItem(PUSH_TOKEN_STORAGE_KEY);
}

export async function registerPushNotifications(): Promise<string | null> {
  if (!isNativeApp()) {
    return null;
  }

  try {
    let permissionStatus = await PushNotifications.checkPermissions();
    if (permissionStatus.receive === "prompt") {
      permissionStatus = await PushNotifications.requestPermissions();
    }
    if (permissionStatus.receive !== "granted") {
      console.warn("Push notification permission denied");
      return null;
    }

    return await new Promise((resolve) => {
      let settled = false;
      let registrationListener: Promise<PluginListenerHandle> | null = null;
      let errorListener: Promise<PluginListenerHandle> | null = null;

      const settle = (token: string | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        void removeListener(registrationListener);
        void removeListener(errorListener);
        if (token) {
          storePushToken(token);
        }
        resolve(token);
      };

      registrationListener = PushNotifications.addListener("registration", (token: PushNotificationToken) => {
        settle(token.value);
      });

      errorListener = PushNotifications.addListener("registrationError", (error: unknown) => {
        console.error("Push registration error:", error);
        settle(getStoredPushToken());
      });

      const timeoutId = window.setTimeout(() => {
        console.warn("Push registration timed out");
        settle(getStoredPushToken());
      }, PUSH_REGISTRATION_TIMEOUT_MS);

      void PushNotifications.register().catch((error) => {
        console.error("Failed to register push notifications:", error);
        settle(getStoredPushToken());
      });
    });
  } catch (error) {
    console.error("Failed to register push notifications:", error);
    return getStoredPushToken();
  }
}

export async function sendTokenToServer(token: string): Promise<boolean> {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return false;
  }

  try {
    const response = await fetchWithCsrf("/api/push/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: normalizedToken,
        appVariant: "wrapper",
        platform: getPlatform(),
        environment: resolvePushEnvironment(),
        pushProvider: "FCM",
        deviceId: getOrCreateStorageValue(LEGACY_DEVICE_ID_STORAGE_KEY),
        deviceInstallId: getOrCreateStorageValue(DEVICE_INSTALL_ID_STORAGE_KEY),
        appVersion: getAppVersion(),
        buildNumber: getBuildNumber(),
        locale: getLocale(),
        timezone: getTimezone(),
        metadata: {
          userAgent: navigator.userAgent,
          nativePlatform: getPlatform(),
          wrapperMode: "remote-url",
        },
      }),
    });

    if (response.ok) {
      storePushToken(normalizedToken);
    }
    return response.ok;
  } catch (error) {
    console.error("Failed to send push token to server:", error);
    return false;
  }
}

export async function unregisterPushToken(token: string): Promise<boolean> {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return true;
  }

  try {
    const response = await fetchWithCsrf("/api/push/unregister", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: normalizedToken }),
    });
    if (response.ok && getStoredPushToken() === normalizedToken) {
      clearStoredPushToken();
    }
    return response.ok;
  } catch (error) {
    console.error("Failed to unregister push token:", error);
    return false;
  }
}

export async function unregisterStoredPushToken(): Promise<boolean> {
  const token = getStoredPushToken();
  if (!token) {
    return true;
  }
  return unregisterPushToken(token);
}

export function initPushNotificationListeners(handlers: {
  onNotificationReceived?: (notification: PushNotificationData) => void;
  onNotificationTapped?: (notification: PushNotificationData) => void;
}): () => void {
  if (!isNativeApp()) {
    return () => {};
  }

  const listeners: Promise<PluginListenerHandle>[] = [];

  listeners.push(
    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      handlers.onNotificationReceived?.({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        data: notification.data,
      });
    }),
  );

  listeners.push(
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      handlers.onNotificationTapped?.({
        id: action.notification.id,
        title: action.notification.title,
        body: action.notification.body,
        data: action.notification.data,
      });
    }),
  );

  return () => {
    for (const listener of listeners) {
      void listener.then((handle) => handle.remove()).catch(() => undefined);
    }
  };
}

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

export async function getDeliveredNotifications(): Promise<PushNotificationData[]> {
  if (!isNativeApp()) {
    return [];
  }

  try {
    const result = await PushNotifications.getDeliveredNotifications();
    return result.notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      data: notification.data,
    }));
  } catch {
    return [];
  }
}

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
