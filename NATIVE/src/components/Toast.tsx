/**
 * TradeQuip Native - Toast Component
 * Native toast notification component with dismiss and auto-hide
 */

import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    TouchableOpacity,
    Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { colors, typography, spacing } from '../theme';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
    visible: boolean;
    title?: string;
    message: string;
    type?: ToastType;
    duration?: number;
    onDismiss: () => void;
}

const TOAST_CONFIG = {
    success: { icon: 'check-circle', color: colors.success, bg: 'rgba(0, 230, 118, 0.15)' },
    error: { icon: 'x-circle', color: colors.error, bg: 'rgba(255, 82, 82, 0.15)' },
    warning: { icon: 'alert-triangle', color: colors.warning, bg: 'rgba(255, 193, 7, 0.15)' },
    info: { icon: 'info', color: colors.accent, bg: 'rgba(0, 229, 255, 0.15)' },
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const Toast: React.FC<ToastProps> = ({
    visible,
    title,
    message,
    type = 'info',
    duration = 4000,
    onDismiss,
}) => {
    const insets = useSafeAreaInsets();
    const translateY = useRef(new Animated.Value(-100)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const config = TOAST_CONFIG[type];

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: 0,
                    friction: 8,
                    tension: 40,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();

            const timer = setTimeout(() => {
                handleDismiss();
            }, duration);

            return () => clearTimeout(timer);
        } else {
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: -100,
                    duration: 200,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible, duration]);

    const handleDismiss = () => {
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: -100,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start(() => onDismiss());
    };

    if (!visible) return null;

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    top: insets.top + spacing.md,
                    transform: [{ translateY }],
                    opacity,
                    backgroundColor: config.bg,
                    borderLeftColor: config.color,
                },
            ]}
        >
            <View style={styles.iconContainer}>
                <Icon name={config.icon} size={22} color={config.color} />
            </View>
            <View style={styles.content}>
                {title && <Text style={styles.title}>{title}</Text>}
                <Text style={styles.message}>{message}</Text>
            </View>
            <TouchableOpacity onPress={handleDismiss} style={styles.dismissButton}>
                <Icon name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: spacing.md,
        right: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: 12,
        borderLeftWidth: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        zIndex: 9999,
    },
    iconContainer: {
        marginRight: spacing.sm,
    },
    content: {
        flex: 1,
    },
    title: {
        ...typography.bodyBold,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    message: {
        ...typography.body,
        color: colors.textSecondary,
    },
    dismissButton: {
        padding: spacing.xs,
        marginLeft: spacing.sm,
    },
});

export default Toast;
