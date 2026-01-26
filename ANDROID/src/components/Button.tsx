/**
 * TradeQuip Android - Button Components
 * Primary, Buy, Sell buttons with proper styling
 */

import React from 'react';
import {
    TouchableOpacity,
    Text,
    StyleSheet,
    ViewStyle,
    ActivityIndicator,
    View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { colors, typography, spacing, shadows } from '../theme';

interface ButtonProps {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'buy' | 'sell' | 'outline' | 'ghost';
    size?: 'small' | 'medium' | 'large';
    disabled?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
    title,
    onPress,
    variant = 'primary',
    size = 'medium',
    disabled = false,
    loading = false,
    icon,
    style,
}) => {
    const getGradientColors = () => {
        switch (variant) {
            case 'buy':
                return [colors.buyGradientStart, colors.buyGradientEnd];
            case 'sell':
                return [colors.sellGradientStart, colors.sellGradientEnd];
            case 'primary':
            default:
                return [colors.accentGradientStart, colors.accentGradientEnd];
        }
    };

    const getShadowStyle = () => {
        switch (variant) {
            case 'buy':
                return shadows.buttonBuy;
            case 'sell':
                return shadows.buttonSell;
            default:
                return shadows.button;
        }
    };

    const sizeStyles = {
        small: { height: 40, paddingHorizontal: 16 },
        medium: { height: 50, paddingHorizontal: 24 },
        large: { height: 56, paddingHorizontal: 32 },
    };

    const textSizeStyles = {
        small: { fontSize: 14 },
        medium: { fontSize: 16 },
        large: { fontSize: 18 },
    };

    if (variant === 'outline' || variant === 'ghost') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled || loading}
                style={[
                    styles.base,
                    sizeStyles[size],
                    variant === 'outline' && styles.outline,
                    variant === 'ghost' && styles.ghost,
                    disabled && styles.disabled,
                    style,
                ]}
                activeOpacity={0.7}
            >
                {loading ? (
                    <ActivityIndicator color={colors.accent} />
                ) : (
                    <View style={styles.content}>
                        {icon}
                        <Text
                            style={[
                                styles.text,
                                textSizeStyles[size],
                                variant === 'outline' && styles.outlineText,
                                variant === 'ghost' && styles.ghostText,
                            ]}
                        >
                            {title}
                        </Text>
                    </View>
                )}
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.8}
            style={[disabled && styles.disabled, style]}
        >
            <LinearGradient
                colors={getGradientColors()}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                    styles.gradient,
                    sizeStyles[size],
                    getShadowStyle(),
                ]}
            >
                {loading ? (
                    <ActivityIndicator color={colors.textPrimary} />
                ) : (
                    <View style={styles.content}>
                        {icon}
                        <Text style={[styles.text, textSizeStyles[size]]}>{title}</Text>
                    </View>
                )}
            </LinearGradient>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    base: {
        borderRadius: spacing.buttonRadius,
        alignItems: 'center',
        justifyContent: 'center',
    },
    gradient: {
        borderRadius: spacing.buttonRadius,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    text: {
        ...typography.button,
        color: colors.textPrimary,
    },
    outline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.accent,
    },
    outlineText: {
        color: colors.accent,
    },
    ghost: {
        backgroundColor: 'transparent',
    },
    ghostText: {
        color: colors.textSecondary,
    },
    disabled: {
        opacity: 0.5,
    },
});

export default Button;
