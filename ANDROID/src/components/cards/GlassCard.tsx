/**
 * TradeQuip Android - GlassCard Component
 * Glassmorphism card base used throughout the app
 */

import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, spacing, shadows } from '../../theme';

interface GlassCardProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    variant?: 'default' | 'hero' | 'accent';
    padding?: keyof typeof spacing | number;
}

export const GlassCard: React.FC<GlassCardProps> = ({
    children,
    style,
    variant = 'default',
    padding = 'cardPadding',
}) => {
    const paddingValue = typeof padding === 'number' ? padding : spacing[padding];

    return (
        <View
            style={[
                styles.base,
                variant === 'hero' && styles.hero,
                variant === 'accent' && styles.accent,
                { padding: paddingValue },
                style,
            ]}
        >
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    base: {
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadius,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.card,
    },
    hero: {
        backgroundColor: 'transparent',
        borderColor: colors.borderAccent,
        overflow: 'hidden',
    },
    accent: {
        borderColor: colors.borderAccent,
    },
});

export default GlassCard;
