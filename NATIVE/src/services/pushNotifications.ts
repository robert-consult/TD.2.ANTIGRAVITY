/**
 * TradeQuip Native - Push Notification Service
 * Handles Android/iOS registration and syncs the active token to the backend.
 */

import { Platform } from 'react-native';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { MMKV } from 'react-native-mmkv';
import DeviceInfo from 'react-native-device-info';
import { pushApi } from './api';
import { getPushEnvironment } from './runtimeConfig';

const storage = new MMKV();
const FCM_TOKEN_KEY = 'fcm_token';

type NotificationHandler = (notification: FirebaseMessagingTypes.RemoteMessage) => void;

class PushNotificationService {
    private onNotificationHandler: NotificationHandler | null = null;
    private onNotificationOpenedHandler: NotificationHandler | null = null;
    private initialized: boolean = false;

    async requestPermission(): Promise<boolean> {
        if (Platform.OS === 'ios') {
            const authStatus = await messaging().requestPermission();
            return (
                authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                authStatus === messaging.AuthorizationStatus.PROVISIONAL
            );
        }
        return true;
    }

    async getToken(): Promise<string | null> {
        try {
            const hasPermission = await this.requestPermission();
            if (!hasPermission) return null;

            const token = await messaging().getToken();
            if (token) {
                storage.set(FCM_TOKEN_KEY, token);
            }
            return token;
        } catch (error) {
            console.error('[Push] Error getting token:', error);
            return null;
        }
    }

    getStoredToken(): string | null {
        return storage.getString(FCM_TOKEN_KEY) || null;
    }

    clearStoredToken(): void {
        storage.delete(FCM_TOKEN_KEY);
    }

    async syncTokenWithServer(token: string): Promise<void> {
        if (!token) return;
        await pushApi.registerDevice({
            token,
            appVariant: 'native',
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            environment: getPushEnvironment(),
            pushProvider: 'FCM',
            appVersion: DeviceInfo.getVersion(),
            locale: Intl.DateTimeFormat().resolvedOptions().locale,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            metadata: {
                deviceModel: DeviceInfo.getModel(),
                deviceId: DeviceInfo.getDeviceId(),
                systemVersion: DeviceInfo.getSystemVersion(),
            },
        });
    }

    async unregisterToken(token?: string | null): Promise<void> {
        const resolved = token || this.getStoredToken();
        if (!resolved) return;
        try {
            await pushApi.unregisterDevice({ token: resolved });
        } finally {
            if (this.getStoredToken() === resolved) {
                this.clearStoredToken();
            }
        }
    }

    onTokenRefresh(callback: (token: string) => void): () => void {
        return messaging().onTokenRefresh(token => {
            storage.set(FCM_TOKEN_KEY, token);
            this.syncTokenWithServer(token).catch((error) => {
                console.warn('[Push] token refresh sync failed', error);
            });
            callback(token);
        });
    }

    setOnNotification(handler: NotificationHandler): void {
        this.onNotificationHandler = handler;
    }

    setOnNotificationOpened(handler: NotificationHandler): void {
        this.onNotificationOpenedHandler = handler;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            const token = this.getStoredToken() || await this.getToken();
            if (token) {
                await this.syncTokenWithServer(token);
            }
            return;
        }

        this.initialized = true;
        const hasPermission = await this.requestPermission();
        if (!hasPermission) return;

        if (Platform.OS === 'android') {
            await notifee.createChannel({
                id: 'tradequip-default',
                name: 'TradeQuip Notifications',
                importance: AndroidImportance.HIGH,
                sound: 'default',
                vibration: true,
            });
            await notifee.createChannel({
                id: 'tradequip-trades',
                name: 'Trade Alerts',
                importance: AndroidImportance.HIGH,
                sound: 'default',
                vibration: true,
            });
            await notifee.createChannel({
                id: 'tradequip-price',
                name: 'Price Alerts',
                importance: AndroidImportance.DEFAULT,
                sound: 'default',
            });
        }

        const token = await this.getToken();
        if (token) {
            await this.syncTokenWithServer(token);
        }

        messaging().onMessage(async remoteMessage => {
            if (remoteMessage.notification) {
                await notifee.displayNotification({
                    title: remoteMessage.notification.title,
                    body: remoteMessage.notification.body,
                    android: {
                        channelId: 'tradequip-default',
                        pressAction: { id: 'default' },
                    },
                    ios: {
                        sound: 'default',
                    },
                });
            }
            this.onNotificationHandler?.(remoteMessage);
        });

        messaging().onNotificationOpenedApp(remoteMessage => {
            this.onNotificationOpenedHandler?.(remoteMessage);
        });

        const initialNotification = await messaging().getInitialNotification();
        if (initialNotification) {
            this.onNotificationOpenedHandler?.(initialNotification);
        }

        notifee.onForegroundEvent(({ type }) => {
            if (type === EventType.PRESS) {
                // no-op: Navigation handling is delegated through setOnNotificationOpened.
            }
        });
    }

    async subscribeToTopic(topic: string): Promise<void> {
        try {
            await messaging().subscribeToTopic(topic);
        } catch (error) {
            console.error(`[Push] Error subscribing to topic ${topic}:`, error);
        }
    }

    async unsubscribeFromTopic(topic: string): Promise<void> {
        try {
            await messaging().unsubscribeFromTopic(topic);
        } catch (error) {
            console.error(`[Push] Error unsubscribing from topic ${topic}:`, error);
        }
    }

    async getNotificationSettings(): Promise<FirebaseMessagingTypes.AuthorizationStatus> {
        return messaging().hasPermission();
    }

    async areNotificationsEnabled(): Promise<boolean> {
        const status = await this.getNotificationSettings();
        return status === messaging.AuthorizationStatus.AUTHORIZED ||
            status === messaging.AuthorizationStatus.PROVISIONAL;
    }
}

export const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
