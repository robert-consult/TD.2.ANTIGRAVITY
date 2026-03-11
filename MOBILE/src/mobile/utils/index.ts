/**
 * Mobile utilities index
 * Export all mobile utility functions
 */

export {
    isNativeApp,
    isAndroid,
    isIOS,
    isWeb,
    getPlatform,
    statusBar,
    haptics,
    keyboard,
    network,
    splash,
    appLifecycle,
    getSafeAreaInsets,
    initializeMobile,
} from "./mobile-utils";

export {
    parseDeepLink,
    initDeepLinking,
    generateDeepLink,
} from "./deep-linking";

export type { DeepLinkRoute, DeepLinkResult } from "./deep-linking";

export {
    fetchCsrfToken,
    fetchWithCsrf,
} from "./csrf";

export {
    registerPushNotifications,
    getStoredPushToken,
    sendTokenToServer,
    unregisterPushToken,
    unregisterStoredPushToken,
    initPushNotificationListeners,
    arePushNotificationsEnabled,
    getDeliveredNotifications,
    clearAllNotifications,
} from "./push-notifications";

export type { PushNotificationToken, PushNotificationData } from "./push-notifications";

export {
    checkSessionStatus,
    refreshSession,
    handleSessionExpired,
    initSessionMonitoring,
    secureLogout,
    debugCookies,
} from "./session-manager";

export type { SessionStatus } from "./session-manager";
