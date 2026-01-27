/**
 * TradeQuip Native - Push Notification Service
 * Handles iOS push notification registration and handling
 */

import { Platform } from 'react-native';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();
const FCM_TOKEN_KEY = 'fcm_token';

type NotificationHandler = (notification: FirebaseMessagingTypes.RemoteMessage) => void;

class PushNotificationService {
    private onNotificationHandler: NotificationHandler | null = null;
    private onNotificationOpenedHandler: NotificationHandler | null = null;

    /**
     * Request notification permissions (iOS)
     */
    async requestPermission(): Promise<boolean> {
        if (Platform.OS === 'ios') {
            const authStatus = await messaging().requestPermission();
            const enabled =
                authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                authStatus === messaging.AuthorizationStatus.PROVISIONAL;

            if (enabled) {
                console.log('[Push] Authorization status:', authStatus);
            }
            return enabled;
        }
        return true; // Android permissions handled differently
    }

    /**
     * Get FCM token for push notifications
     */
    async getToken(): Promise<string | null> {
        try {
            // Check if permission granted
            const hasPermission = await this.requestPermission();
            if (!hasPermission) {
                console.log('[Push] Permission not granted');
                return null;
            }

            // Get the token
            const token = await messaging().getToken();

            // Store locally
            if (token) {
                storage.set(FCM_TOKEN_KEY, token);
                console.log('[Push] FCM Token obtained');
            }

            return token;
        } catch (error) {
            console.error('[Push] Error getting token:', error);
            return null;
        }
    }

    /**
     * Get stored FCM token
     */
    getStoredToken(): string | null {
        return storage.getString(FCM_TOKEN_KEY) || null;
    }

    /**
     * Register token refresh listener
     */
    onTokenRefresh(callback: (token: string) => void): () => void {
        return messaging().onTokenRefresh(token => {
            storage.set(FCM_TOKEN_KEY, token);
            callback(token);
        });
    }

    /**
     * Set foreground notification handler
     */
    setOnNotification(handler: NotificationHandler): void {
        this.onNotificationHandler = handler;
    }

    /**
     * Set notification opened handler
     */
    setOnNotificationOpened(handler: NotificationHandler): void {
        this.onNotificationOpenedHandler = handler;
    }

    /**
     * Initialize push notifications
     */
    async initialize(): Promise<void> {
        // Request permission
        await this.requestPermission();

        // Create notification channel for Android
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

        // Handle foreground messages
        messaging().onMessage(async remoteMessage => {
            console.log('[Push] Foreground message:', remoteMessage);

            // Display local notification
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

        // Handle notification opened app from background
        messaging().onNotificationOpenedApp(remoteMessage => {
            console.log('[Push] Notification opened app:', remoteMessage);
            this.onNotificationOpenedHandler?.(remoteMessage);
        });

        // Check if app was opened from a notification (cold start)
        const initialNotification = await messaging().getInitialNotification();
        if (initialNotification) {
            console.log('[Push] App opened from notification:', initialNotification);
            this.onNotificationOpenedHandler?.(initialNotification);
        }

        // Handle background/quit notification events
        notifee.onForegroundEvent(({ type, detail }) => {
            if (type === EventType.PRESS) {
                console.log('[Push] Notification pressed:', detail);
            }
        });
    }

    /**
     * Subscribe to a topic
     */
    async subscribeToTopic(topic: string): Promise<void> {
        try {
            await messaging().subscribeToTopic(topic);
            console.log(`[Push] Subscribed to topic: ${topic}`);
        } catch (error) {
            console.error(`[Push] Error subscribing to topic ${topic}:`, error);
        }
    }

    /**
     * Unsubscribe from a topic
     */
    async unsubscribeFromTopic(topic: string): Promise<void> {
        try {
            await messaging().unsubscribeFromTopic(topic);
            console.log(`[Push] Unsubscribed from topic: ${topic}`);
        } catch (error) {
            console.error(`[Push] Error unsubscribing from topic ${topic}:`, error);
        }
    }

    /**
     * Get notification settings
     */
    async getNotificationSettings(): Promise<FirebaseMessagingTypes.AuthorizationStatus> {
        return messaging().hasPermission();
    }

    /**
     * Check if notifications are enabled
     */
    async areNotificationsEnabled(): Promise<boolean> {
        const status = await this.getNotificationSettings();
        return status === messaging.AuthorizationStatus.AUTHORIZED ||
            status === messaging.AuthorizationStatus.PROVISIONAL;
    }
}

export const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
