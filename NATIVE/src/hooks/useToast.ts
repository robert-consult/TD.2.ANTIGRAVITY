/**
 * TradeQuip Native - Toast Hook
 * Native toast notifications
 */

import { useCallback, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastOptions {
    title?: string;
    description?: string;
    type?: ToastType;
    duration?: number;
}

interface ToastState {
    visible: boolean;
    title: string;
    description: string;
    type: ToastType;
}

export const useToast = () => {
    const [toast, setToast] = useState<ToastState>({
        visible: false,
        title: '',
        description: '',
        type: 'info',
    });

    const showToast = useCallback((options: ToastOptions) => {
        const { title = '', description = '', type = 'info', duration = 3000 } = options;

        // On Android, use native ToastAndroid for simple messages
        if (Platform.OS === 'android' && !title && description) {
            ToastAndroid.show(description, ToastAndroid.SHORT);
            return;
        }

        // For iOS or complex toasts, use Alert (or could integrate with a toast library)
        if (title || description) {
            // Simple implementation using Alert
            // In production, consider react-native-toast-message or similar
            if (type === 'error') {
                Alert.alert(title || 'Error', description);
            } else if (type === 'success') {
                Alert.alert(title || 'Success', description);
            } else if (type === 'warning') {
                Alert.alert(title || 'Warning', description);
            } else {
                // For info, just show on Android or use Alert on iOS
                if (Platform.OS === 'android') {
                    ToastAndroid.show(description || title, ToastAndroid.SHORT);
                } else {
                    Alert.alert(title || 'Info', description);
                }
            }
        }

        // Also update state for custom toast UI if needed
        setToast({ visible: true, title, description, type });

        // Auto-hide
        setTimeout(() => {
            setToast((prev) => ({ ...prev, visible: false }));
        }, duration);
    }, []);

    const hideToast = useCallback(() => {
        setToast((prev) => ({ ...prev, visible: false }));
    }, []);

    return {
        toast: showToast,
        toastState: toast,
        hideToast,
    };
};

export default useToast;
